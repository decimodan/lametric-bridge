import type { Device } from "../services/devices.js";
import { touchDevice } from "../services/devices.js";
import type { Message, Priority } from "../services/render.js";
import { lametricSoundCategory } from "../services/sounds.js";
import { lanFetch } from "./lanFetch.js";

function authHeader(apiKey: string): string {
  return `Basic ${Buffer.from(`dev:${apiKey}`).toString("base64")}`;
}

function candidateBases(host: string): string[] {
  const cleaned = host.replace(/\/$/, "");
  if (cleaned.startsWith("http://") || cleaned.startsWith("https://")) {
    return [cleaned];
  }
  // Official local API: HTTPS :4343 and HTTP :8080.
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

async function requestLametric(
  device: Device,
  path: string,
  init: { method?: string; body?: string } = {},
): Promise<{ ok: boolean; status: number; text: string; base: string }> {
  let last = { ok: false, status: 0, text: "unknown error", base: "" };
  for (const base of candidateBases(device.host)) {
    try {
      const headers: Record<string, string> = {
        Authorization: authHeader(device.apiKey),
      };
      if (init.body) {
        headers["Content-Type"] = "application/json";
        headers["Content-Length"] = String(Buffer.byteLength(init.body));
      }
      const res = await lanFetch(`${base}${path}`, {
        method: init.method ?? "GET",
        headers,
        body: init.body,
      });
      last = { ...res, base };
      if (res.ok) {
        await touchDevice(device.id);
        return last;
      }
      last.text = formatLametricError(res.status, base, res.text);
    } catch (err) {
      last = {
        ok: false,
        status: 0,
        text: err instanceof Error ? err.message : String(err),
        base,
      };
    }
  }
  return last;
}

function mapPriority(priority: Priority = "info"): string {
  if (priority === "critical") return "critical";
  if (priority === "warning") return "warning";
  return "info";
}

export async function testLametric(
  device: Device,
): Promise<{ ok: boolean; detail: string }> {
  const res = await requestLametric(device, "/api/v2/device");
  if (res.ok) {
    return { ok: true, detail: `Connected via ${res.base}` };
  }
  return { ok: false, detail: res.text };
}

export async function sendToLametric(
  device: Device,
  message: Message,
): Promise<{ ok: boolean; detail: string }> {
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
            sound: (() => {
              const id =
                typeof message.sound === "string"
                  ? message.sound
                  : "notification";
              return {
                category: lametricSoundCategory(id),
                id,
              };
            })(),
          }
        : {}),
    },
  };

  const res = await requestLametric(device, "/api/v2/device/notifications", {
    method: "POST",
    body: JSON.stringify(payload),
  });
  if (res.ok) {
    return { ok: true, detail: `Sent to ${device.slug} via ${res.base}` };
  }
  return { ok: false, detail: res.text };
}

export async function getLametricStatus(device: Device): Promise<{
  ok: boolean;
  brightness?: number;
  autoBrightness?: boolean;
  power?: boolean;
  detail: string;
}> {
  const res = await requestLametric(device, "/api/v2/device");
  if (!res.ok) {
    return { ok: false, detail: res.text };
  }
  try {
    const body = JSON.parse(res.text) as {
      display?: { brightness?: number; brightness_mode?: string };
    };
    const brightness = Number(body.display?.brightness ?? 0);
    return {
      ok: true,
      brightness: Number.isFinite(brightness) ? brightness : 0,
      autoBrightness: body.display?.brightness_mode === "auto",
      power: true,
      detail: "ok",
    };
  } catch {
    return { ok: false, detail: "Invalid device payload" };
  }
}

export async function setLametricBrightness(
  device: Device,
  percent: number,
  autoBrightness?: boolean,
): Promise<{ ok: boolean; detail: string }> {
  const brightness = Math.max(0, Math.min(100, Math.round(percent)));
  const payload: Record<string, unknown> = {
    brightness,
    brightness_mode: autoBrightness ? "auto" : "manual",
  };
  const res = await requestLametric(device, "/api/v2/device", {
    method: "PUT",
    body: JSON.stringify(payload),
  });
  if (res.ok) {
    return { ok: true, detail: `Brillo ${brightness}%` };
  }
  return { ok: false, detail: res.text };
}
