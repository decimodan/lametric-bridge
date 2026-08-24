import { v4 as uuid } from "uuid";
import { config } from "../config.js";
import { query } from "../db/index.js";
import { decryptSecret, encryptSecret } from "../db/crypto.js";

export type DeviceKind = "lametric" | "awtrix";

export type DeviceRow = {
  id: string;
  slug: string;
  name: string;
  kind: DeviceKind;
  host: string;
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

export async function resolveDevices(idOrSlug?: string | null): Promise<Device[]> {
  if (!idOrSlug) {
    return listDevices();
  }
  const device = await getDevice(idOrSlug);
  return device ? [device] : [];
}

export async function touchDevice(id: string): Promise<void> {
  await query("UPDATE devices SET last_seen = NOW() WHERE id = $1", [id]);
}

export async function saveDevice(input: {
  id?: string;
  slug: string;
  name: string;
  kind: DeviceKind;
  host: string;
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
    `INSERT INTO devices (id, slug, name, kind, host, api_key_enc, env_managed)
     VALUES ($1, $2, $3, $4, $5, $6, FALSE)
     ON CONFLICT (id) DO UPDATE SET
       slug = EXCLUDED.slug,
       name = EXCLUDED.name,
       kind = EXCLUDED.kind,
       host = EXCLUDED.host,
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
      apiKeyEnc,
    ],
  );
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
}): Promise<void> {
  const existing = await query<DeviceRow>(
    "SELECT * FROM devices WHERE slug = $1",
    [input.slug],
  );
  const id = existing.rows[0]?.id ?? uuid();
  await query(
    `INSERT INTO devices (id, slug, name, kind, host, api_key_enc, env_managed, last_seen)
     VALUES ($1, $2, $3, $4, $5, $6, TRUE, $7)
     ON CONFLICT (slug) DO UPDATE SET
       name = EXCLUDED.name,
       kind = EXCLUDED.kind,
       host = EXCLUDED.host,
       api_key_enc = EXCLUDED.api_key_enc,
       env_managed = TRUE`,
    [
      id,
      input.slug,
      input.name,
      input.kind,
      input.host.replace(/\/$/, ""),
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
    envManaged: device.envManaged,
    lastSeen: device.lastSeen,
    hasApiKey: Boolean(device.apiKey),
  };
}
