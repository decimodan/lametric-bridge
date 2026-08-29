import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import { promisify } from "node:util";
import { config } from "../config.js";
import type { Device } from "./devices.js";

const execFileAsync = promisify(execFile);

const MAC_RE = /^([0-9a-f]{2}[:-]){5}[0-9a-f]{2}$/i;
const MAC_PLAIN_RE = /^[0-9a-f]{12}$/i;

export function isValidMac(mac: string): boolean {
  const normalized = normalizeMac(mac);
  return normalized !== null;
}

/** Always returns lowercase `aa:bb:cc:dd:ee:ff`, regardless of input casing/separators. */
export function normalizeMac(mac: string): string | null {
  const trimmed = mac.trim();
  if (!trimmed) return null;

  const lower = trimmed.toLowerCase();
  const colonForm = lower.replace(/-/g, ":");
  if (MAC_RE.test(colonForm)) return colonForm;

  const plain = lower.replace(/[^0-9a-f]/g, "");
  if (MAC_PLAIN_RE.test(plain)) {
    return plain.match(/.{2}/g)!.join(":");
  }

  return null;
}

function lookupMac(table: Map<string, string>, mac: string): string | undefined {
  const normalized = normalizeMac(mac);
  if (!normalized) return undefined;
  const direct = table.get(normalized);
  if (direct) return direct;
  // Belt-and-suspenders: neighbor tables may use mixed case keys.
  for (const [key, ip] of table) {
    if (key.toLowerCase() === normalized) return ip;
  }
  return undefined;
}

function hostIp(host: string): string | null {
  const cleaned = host.replace(/\/$/, "");
  if (cleaned.startsWith("http://") || cleaned.startsWith("https://")) {
    try {
      return new URL(cleaned).hostname;
    } catch {
      return null;
    }
  }
  if (/^\d+\.\d+\.\d+\.\d+$/.test(cleaned)) return cleaned;
  return null;
}

export function applyResolvedIp(device: Device, ip: string): string {
  const current = device.host.replace(/\/$/, "");
  if (current.startsWith("http://") || current.startsWith("https://")) {
    try {
      const url = new URL(current);
      url.hostname = ip;
      return url.origin;
    } catch {
      return `http://${ip}`;
    }
  }
  return ip;
}

function hostsInSubnet(cidr: string): string[] {
  const [base, bitsStr] = cidr.split("/");
  const bits = Number(bitsStr ?? "24");
  if (bits !== 24) {
    throw new Error(`LAN_SUBNET must be /24 (got /${bits})`);
  }
  const octets = base.split(".").map(Number);
  if (octets.length !== 4 || octets.some((o) => Number.isNaN(o))) {
    throw new Error(`Invalid LAN_SUBNET: ${cidr}`);
  }
  const prefix = `${octets[0]}.${octets[1]}.${octets[2]}`;
  const ips: string[] = [];
  for (let i = 1; i <= 254; i++) {
    ips.push(`${prefix}.${i}`);
  }
  return ips;
}

async function readNeighborTable(): Promise<Map<string, string>> {
  const map = new Map<string, string>();

  try {
    const arp = await fs.readFile("/proc/net/arp", "utf8");
    for (const line of arp.split("\n").slice(1)) {
      const parts = line.trim().split(/\s+/);
      if (parts.length < 4) continue;
      const mac = normalizeMac(parts[3]);
      if (!mac || mac === "00:00:00:00:00:00") continue;
      map.set(mac, parts[0]);
    }
  } catch {
    // not Linux or no permission
  }

  try {
    const { stdout } = await execFileAsync("ip", ["neigh", "show"]);
    for (const line of stdout.split("\n")) {
      const match = line.match(
        /^(\d+\.\d+\.\d+\.\d+)\s+dev\s+\S+\s+lladdr\s+([0-9a-f:]{17})/i,
      );
      if (!match) continue;
      const mac = normalizeMac(match[2]);
      if (!mac) continue;
      map.set(mac, match[1]);
    }
  } catch {
    // iproute2 missing
  }

  return map;
}

async function pingHost(ip: string): Promise<void> {
  try {
    await execFileAsync("ping", ["-c", "1", "-W", "1", ip]);
  } catch {
    // unreachable
  }
}

async function pingSweep(subnet: string): Promise<void> {
  if (process.platform !== "linux") return;
  const ips = hostsInSubnet(subnet);
  const batchSize = 40;
  for (let i = 0; i < ips.length; i += batchSize) {
    await Promise.allSettled(
      ips.slice(i, i + batchSize).map((ip) => pingHost(ip)),
    );
  }
}

const resolveCache = new Map<string, { host: string; at: number }>();
const lastSweepAt = new Map<string, number>();

const CACHE_TTL_MS = 60_000;
const SWEEP_COOLDOWN_MS = 5 * 60_000;

export async function resolveMacToIp(
  macAddress: string,
  options: { allowSweep?: boolean; forceSweep?: boolean } = {},
): Promise<string | null> {
  const mac = normalizeMac(macAddress);
  if (!mac) return null;

  let table = await readNeighborTable();
  let ip = lookupMac(table, mac);
  if (ip) return ip;

  const allowSweep = options.allowSweep ?? true;
  if (!allowSweep || process.platform !== "linux") return null;

  const sweepKey = config.lanSubnet;
  const lastSweep = lastSweepAt.get(sweepKey) ?? 0;
  const due =
    options.forceSweep || Date.now() - lastSweep >= SWEEP_COOLDOWN_MS;
  if (!due) return null;

  lastSweepAt.set(sweepKey, Date.now());
  await pingSweep(config.lanSubnet);
  table = await readNeighborTable();
  ip = lookupMac(table, mac);
  return ip ?? null;
}

export async function resolveDeviceHost(device: Device): Promise<Device> {
  const macAddress = device.macAddress
    ? normalizeMac(device.macAddress)
    : null;
  if (!macAddress) return device;

  const now = Date.now();
  const cached = resolveCache.get(device.id);
  if (cached && now - cached.at < CACHE_TTL_MS) {
    return { ...device, host: cached.host, macAddress };
  }

  const ip = await resolveMacToIp(macAddress);
  if (!ip) return { ...device, macAddress };

  const host = applyResolvedIp(device, ip);
  resolveCache.set(device.id, { host, at: now });
  return { ...device, host, macAddress };
}

export function seedResolveCache(deviceId: string, host: string): void {
  resolveCache.set(deviceId, { host, at: Date.now() });
}

export function invalidateResolveCache(deviceId?: string): void {
  if (deviceId) {
    resolveCache.delete(deviceId);
    return;
  }
  resolveCache.clear();
}

export async function warmNeighborForHost(host: string): Promise<void> {
  const ip = hostIp(host);
  if (!ip || process.platform !== "linux") return;
  await pingHost(ip);
}
