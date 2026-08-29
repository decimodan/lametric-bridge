import { v4 as uuid } from "uuid";
import { config } from "../config.js";
import { query } from "../db/index.js";
import { decryptSecret, encryptSecret } from "../db/crypto.js";
import {
  invalidateResolveCache,
  resolveDeviceHost,
  resolveMacToIp,
  applyResolvedIp,
  normalizeMac,
  seedResolveCache,
} from "./macResolve.js";

export type DeviceKind = "lametric" | "awtrix";

export type DeviceRow = {
  id: string;
  slug: string;
  name: string;
  kind: DeviceKind;
  host: string;
  mac_address: string | null;
  api_key_enc: string;
  env_managed: boolean;
  last_seen: string | Date | null;
  created_at: string | Date;
};

export type Device = {
  id: string;
  slug: string;
  name: string;
  kind: DeviceKind;
  host: string;
  macAddress: string | null;
  apiKey: string;
  envManaged: boolean;
  lastSeen: string | Date | null;
};

const SLUG_RE = /^[a-z0-9][a-z0-9-]{0,31}$/;

export function isValidSlug(slug: string): boolean {
  return SLUG_RE.test(slug);
}

function toDevice(row: DeviceRow): Device {
  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    kind: row.kind,
    host: row.host.replace(/\/$/, ""),
    macAddress: row.mac_address ? normalizeMac(row.mac_address) : null,
    apiKey: row.api_key_enc ? decryptSecret(row.api_key_enc) : "",
    envManaged: row.env_managed,
    lastSeen: row.last_seen,
  };
}

export async function listDevices(): Promise<Device[]> {
  const res = await query<DeviceRow>(
    "SELECT * FROM devices ORDER BY kind ASC, name ASC",
  );
  return res.rows.map(toDevice);
}

export async function getDevice(idOrSlug: string): Promise<Device | null> {
  const res = await query<DeviceRow>(
    "SELECT * FROM devices WHERE id = $1 OR slug = $1",
    [idOrSlug],
  );
  return res.rows[0] ? toDevice(res.rows[0]) : null;
}

export async function getResolvedDevice(
  idOrSlug: string,
): Promise<Device | null> {
  const device = await getDevice(idOrSlug);
  if (!device) return null;
  return resolveAndPersistHost(device);
}

async function resolveAndPersistHost(device: Device): Promise<Device> {
  const resolved = await resolveDeviceHost(device);
  if (resolved.host !== device.host) {
    await updateDeviceHost(device.id, resolved.host);
    return resolved;
  }
  return resolved;
}

export async function refreshAllDeviceHosts(): Promise<
  Array<{ id: string; slug: string; host: string; resolved: boolean }>
> {
  const devices = await listDevices();
  const results: Array<{
    id: string;
    slug: string;
    host: string;
    resolved: boolean;
  }> = [];
  for (const device of devices) {
    if (!device.macAddress) {
      results.push({
        id: device.id,
        slug: device.slug,
        host: device.host,
        resolved: false,
      });
      continue;
    }
    invalidateResolveCache(device.id);
    const before = device.host;
    const updated = await resolveAndPersistHost(device);
    results.push({
      id: device.id,
      slug: device.slug,
      host: updated.host,
      resolved: updated.host !== before || Boolean(updated.macAddress),
    });
  }
  return results;
}

export async function resolveDeviceByMac(
  idOrSlug: string,
): Promise<{ ok: boolean; host?: string; detail: string }> {
  const device = await getDevice(idOrSlug);
  if (!device) return { ok: false, detail: "Device not found" };
  if (!device.macAddress) {
    return { ok: false, detail: "No MAC address configured" };
  }
  invalidateResolveCache(device.id);
  const ip = await resolveMacToIp(device.macAddress, {
    allowSweep: true,
    forceSweep: true,
  });
  if (!ip) {
    return {
      ok: false,
      detail: `MAC ${device.macAddress} not found on ${config.lanSubnet}`,
    };
  }
  const host = applyResolvedIp(device, ip);
  await updateDeviceHost(device.id, host);
  seedResolveCache(device.id, host);
  return { ok: true, host, detail: `Resolved ${device.macAddress} → ${host}` };
}

export async function updateDeviceHost(id: string, host: string): Promise<void> {
  await query("UPDATE devices SET host = $1 WHERE id = $2", [
    host.replace(/\/$/, ""),
    id,
  ]);
}

export async function updateDeviceMac(
  id: string,
  macAddress: string | null,
): Promise<Device | null> {
  const normalized = macAddress ? normalizeMac(macAddress) : null;
  if (macAddress && !normalized) {
    throw new Error("Invalid MAC address");
  }
  await query("UPDATE devices SET mac_address = $1 WHERE id = $2", [
    normalized,
    id,
  ]);
  invalidateResolveCache(id);
  return getDevice(id);
}

export async function resolveDevices(
  idOrSlug?: string | null,
): Promise<Device[]> {
  if (!idOrSlug) {
    const devices = await listDevices();
    return Promise.all(devices.map((d) => resolveAndPersistHost(d)));
  }
  const device = await getResolvedDevice(idOrSlug);
  return device ? [device] : [];
}

export async function touchDevice(id: string): Promise<void> {
  await query("UPDATE devices SET last_seen = NOW() WHERE id = $1", [id]);
}

function parseMacInput(macAddress?: string | null): string | null {
  if (macAddress === undefined || macAddress === null || macAddress === "") {
    return null;
  }
  const normalized = normalizeMac(macAddress);
  if (!normalized) throw new Error("Invalid MAC address");
  return normalized;
}

export async function saveDevice(input: {
  id?: string;
  slug: string;
  name: string;
  kind: DeviceKind;
  host: string;
  macAddress?: string | null;
  apiKey?: string;
}): Promise<Device> {
  const slug = input.slug.trim().toLowerCase();
  if (!isValidSlug(slug)) {
    throw new Error("slug must be lowercase letters, numbers and hyphens");
  }
  const existing = input.id
    ? await getDevice(input.id)
    : await getDevice(slug);
  if (existing?.envManaged) {
    throw new Error(`${existing.name} is managed via environment variables`);
  }

  const macAddress =
    input.macAddress !== undefined
      ? parseMacInput(input.macAddress)
      : (existing?.macAddress ?? null);

  const id = existing?.id ?? input.id ?? uuid();
  const apiKeyEnc =
    input.apiKey !== undefined && input.apiKey !== ""
      ? encryptSecret(input.apiKey)
      : (existing
          ? (
              await query<DeviceRow>("SELECT * FROM devices WHERE id = $1", [id])
            ).rows[0]?.api_key_enc ?? ""
          : "");

  await query(
    `INSERT INTO devices (id, slug, name, kind, host, mac_address, api_key_enc, env_managed)
     VALUES ($1, $2, $3, $4, $5, $6, $7, FALSE)
     ON CONFLICT (id) DO UPDATE SET
       slug = EXCLUDED.slug,
       name = EXCLUDED.name,
       kind = EXCLUDED.kind,
       host = EXCLUDED.host,
       mac_address = EXCLUDED.mac_address,
       api_key_enc = CASE
         WHEN EXCLUDED.api_key_enc = '' THEN devices.api_key_enc
         ELSE EXCLUDED.api_key_enc
       END
     `,
    [
      id,
      slug,
      input.name.trim(),
      input.kind,
      input.host.replace(/\/$/, ""),
      macAddress,
      apiKeyEnc,
    ],
  );
  invalidateResolveCache(id);
  const saved = await getDevice(id);
  if (!saved) throw new Error("Failed to save device");
  return saved;
}

export async function deleteDevice(id: string): Promise<boolean> {
  const existing = await getDevice(id);
  if (!existing) return false;
  if (existing.envManaged) {
    throw new Error(`${existing.name} is managed via environment variables`);
  }
  const res = await query("DELETE FROM devices WHERE id = $1", [existing.id]);
  return (res.rowCount ?? 0) > 0;
}

async function upsertEnvDevice(input: {
  slug: string;
  name: string;
  kind: DeviceKind;
  host: string;
  apiKey: string;
  macAddress?: string;
}): Promise<void> {
  const existing = await query<DeviceRow>(
    "SELECT * FROM devices WHERE slug = $1",
    [input.slug],
  );
  const id = existing.rows[0]?.id ?? uuid();
  const macAddress = input.macAddress
    ? normalizeMac(input.macAddress)
    : existing.rows[0]?.mac_address
      ? normalizeMac(String(existing.rows[0].mac_address))
      : null;
  await query(
    `INSERT INTO devices (id, slug, name, kind, host, mac_address, api_key_enc, env_managed, last_seen)
     VALUES ($1, $2, $3, $4, $5, $6, $7, TRUE, $8)
     ON CONFLICT (slug) DO UPDATE SET
       name = EXCLUDED.name,
       kind = EXCLUDED.kind,
       host = EXCLUDED.host,
       mac_address = COALESCE(EXCLUDED.mac_address, devices.mac_address),
       api_key_enc = EXCLUDED.api_key_enc,
       env_managed = TRUE`,
    [
      id,
      input.slug,
      input.name,
      input.kind,
      input.host.replace(/\/$/, ""),
      macAddress,
      input.apiKey ? encryptSecret(input.apiKey) : "",
      existing.rows[0]?.last_seen ?? null,
    ],
  );
}

export async function syncEnvDevices(): Promise<void> {
  if (config.lametricDeviceIp && config.lametricApiKey) {
    await upsertEnvDevice({
      slug: "lametric",
      name: "LaMetric",
      kind: "lametric",
      host: config.lametricDeviceIp,
      apiKey: config.lametricApiKey,
      macAddress: normalizeMac(config.lametricDeviceMac) || undefined,
    });
  }
  if (config.awtrixBaseUrl) {
    await upsertEnvDevice({
      slug: "ulanzi",
      name: "Ulanzi",
      kind: "awtrix",
      host: config.awtrixBaseUrl,
      apiKey:
        config.awtrixUser && config.awtrixPass
          ? `${config.awtrixUser}:${config.awtrixPass}`
          : "",
      macAddress: normalizeMac(config.awtrixMac) || undefined,
    });
  }
}

export function publicDevice(device: Device) {
  return {
    id: device.id,
    slug: device.slug,
    name: device.name,
    kind: device.kind,
    host: device.host,
    macAddress: device.macAddress,
    envManaged: device.envManaged,
    lastSeen: device.lastSeen,
    hasApiKey: Boolean(device.apiKey),
  };
}
