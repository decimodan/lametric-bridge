import { config, lametricFromEnv } from "../config.js";
import { query, type LametricDeviceRow } from "../db/index.js";
import { decryptSecret, encryptSecret } from "../db/crypto.js";
import type { Message, Priority } from "../services/render.js";
import { lanFetch } from "./lanFetch.js";

export type DeviceConfig = {
  host: string;
  apiKey: string;
  lastSeen: string | Date | null;
  source: "env" | "db";
};

async function deviceRow(): Promise<LametricDeviceRow | undefined> {
  const res = await query<LametricDeviceRow>(
    "SELECT * FROM lametric_device WHERE id = 1",
  );
  return res.rows[0];
}

export async function getDeviceConfig(): Promise<DeviceConfig | null> {
  if (lametricFromEnv()) {
    const row = await deviceRow();
    return {
      host: config.lametricDeviceIp.replace(/\/$/, ""),
      apiKey: config.lametricApiKey,
      lastSeen: row?.last_seen ?? null,
      source: "env",
    };
  }

  const row = await deviceRow();
  if (!row) return null;
  return {
    host: row.host,
    apiKey: decryptSecret(row.api_key_enc),
    lastSeen: row.last_seen,
    source: "db",
  };
}

export async function saveDeviceConfig(host: string, apiKey: string): Promise<void> {
  if (lametricFromEnv()) {
    throw new Error(
      "LaMetric device is managed via LAMETRIC_DEVICE_IP / LAMETRIC_API_KEY",
    );
  }
  await query(
    `INSERT INTO lametric_device (id, host, api_key_enc, last_seen)
     VALUES (1, $1, $2, NULL)
     ON CONFLICT (id) DO UPDATE SET
       host = EXCLUDED.host,
       api_key_enc = EXCLUDED.api_key_enc`,
    [host.replace(/\/$/, ""), encryptSecret(apiKey)],
  );
}

function authHeader(apiKey: string): string {
  return `Basic ${Buffer.from(`dev:${apiKey}`).toString("base64")}`;
}

function candidateBases(host: string): string[] {
  const cleaned = host.replace(/\/$/, "");
  if (cleaned.startsWith("http://") || cleaned.startsWith("https://")) {
    return [cleaned];
  }
  // Official local API: HTTPS :4343 and HTTP :8080.
  // Bare :80/:443 return misleading 401s and are not used.
  return [`https://${cleaned}:4343`, `http://${cleaned}:8080`];
}

function formatLametricError(status: number, base: string, text: string): string {
  const snippet = text.slice(0, 300);
  try {
    const parsed = JSON.parse(text) as {
      errors?: Array<{ message?: string }>;
    };
    const msg = parsed.errors?.[0]?.message;
    if (msg) {
      if (/only notifications with priority ['"]critical['"]/i.test(msg)) {
        return `${msg} (el reloj está en modo silencioso / solo críticas; usa prioridad critical o desactiva DND en LaMetric)`;
      }
      return msg;
    }
  } catch {
    // not JSON
  }
  return `HTTP ${status} from ${base}: ${snippet}`;
}

async function touchLastSeen(): Promise<void> {
  if (lametricFromEnv()) {
    await query(
      `INSERT INTO lametric_device (id, host, api_key_enc, last_seen)
       VALUES (1, $1, $2, NOW())
       ON CONFLICT (id) DO UPDATE SET
         host = EXCLUDED.host,
         last_seen = NOW()`,
      [
        config.lametricDeviceIp.replace(/\/$/, ""),
        encryptSecret(config.lametricApiKey),
      ],
    );
    return;
  }
  await query("UPDATE lametric_device SET last_seen = NOW() WHERE id = 1");
}

export async function testConnection(): Promise<{ ok: boolean; detail: string }> {
  const device = await getDeviceConfig();
  if (!device) {
    return { ok: false, detail: "LaMetric device is not configured" };
  }

  let lastError = "unknown error";
  for (const base of candidateBases(device.host)) {
    try {
      const res = await lanFetch(`${base}/api/v2/device`, {
        method: "GET",
        headers: { Authorization: authHeader(device.apiKey) },
      });
      if (res.ok) {
        await touchLastSeen();
        return { ok: true, detail: `Connected via ${base}` };
      }
      lastError = formatLametricError(res.status, base, res.text);
    } catch (err) {
      lastError = err instanceof Error ? err.message : String(err);
    }
  }

  return { ok: false, detail: lastError };
}

function mapPriority(priority: Priority = "info"): string {
  if (priority === "critical") return "critical";
  if (priority === "warning") return "warning";
  return "info";
}

export async function sendNotification(
  message: Message,
): Promise<{ ok: boolean; detail: string }> {
  const device = await getDeviceConfig();
  if (!device) {
    return { ok: false, detail: "LaMetric device is not configured" };
  }

  const payload = {
    priority: mapPriority(message.priority),
    icon_type: message.priority === "critical" ? "alert" : "info",
    lifetime: message.lifetime ?? 5000,
    model: {
      frames: [
        {
          icon: message.icon ?? "a2867",
          text: message.text.slice(0, 256),
        },
      ],
      cycles: message.cycles ?? 2,
      ...(message.sound
        ? {
            sound: {
              category: "notifications",
              id:
                typeof message.sound === "string"
                  ? message.sound
                  : "notification",
            },
          }
        : {}),
    },
  };

  const body = JSON.stringify(payload);
  let lastError = "unknown error";

  for (const base of candidateBases(device.host)) {
    try {
      const res = await lanFetch(`${base}/api/v2/device/notifications`, {
        method: "POST",
        headers: {
          Authorization: authHeader(device.apiKey),
          "Content-Type": "application/json",
          "Content-Length": String(Buffer.byteLength(body)),
        },
        body,
      });
      if (res.ok) {
        await touchLastSeen();
        return { ok: true, detail: `Sent via ${base}` };
      }
      lastError = formatLametricError(res.status, base, res.text);
    } catch (err) {
      lastError = err instanceof Error ? err.message : String(err);
    }
  }

  return { ok: false, detail: lastError };
}
