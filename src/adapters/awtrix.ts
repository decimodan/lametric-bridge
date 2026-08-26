import { lanFetch } from "./lanFetch.js";
import type { Device } from "../services/devices.js";
import { touchDevice } from "../services/devices.js";
import type { Message } from "../services/render.js";

function baseUrl(device: Device): string {
  const host = device.host.replace(/\/$/, "");
  if (host.startsWith("http://") || host.startsWith("https://")) {
    return host;
  }
  return `http://${host}`;
}

function headers(device: Device, body?: string): Record<string, string> {
  const headers: Record<string, string> = {};
  if (body) {
    headers["Content-Type"] = "application/json";
    headers["Content-Length"] = String(Buffer.byteLength(body));
  }
  if (device.apiKey.includes(":")) {
    headers.Authorization = `Basic ${Buffer.from(device.apiKey).toString("base64")}`;
  }
  return headers;
}

async function awtrixFetch(
  device: Device,
  path: string,
  init: { method?: string; body?: string } = {},
): Promise<{ ok: boolean; status: number; text: string; json: unknown }> {
  const res = await lanFetch(`${baseUrl(device)}${path}`, {
    method: init.method ?? "GET",
    headers: headers(device, init.body),
    body: init.body,
  });
  let json: unknown = null;
  if (res.text) {
    try {
      json = JSON.parse(res.text);
    } catch {
      json = { raw: res.text };
    }
  }
  return { ...res, json };
}

export async function testAwtrix(
  device: Device,
): Promise<{ ok: boolean; detail: string }> {
  try {
    const res = await awtrixFetch(device, "/api/v1/device");
    if (!res.ok) {
      return { ok: false, detail: `HTTP ${res.status}: ${res.text.slice(0, 200)}` };
    }
    await touchDevice(device.id);
    const body = res.json as { hostname?: string; version?: string };
    return {
      ok: true,
      detail: `AWTRIX ${body.version ?? ""} @ ${body.hostname ?? device.host}`.trim(),
    };
  } catch (err) {
    return {
      ok: false,
      detail: err instanceof Error ? err.message : String(err),
    };
  }
}

export async function sendToAwtrix(
  device: Device,
  message: Message,
): Promise<{ ok: boolean; detail: string }> {
  const payload: Record<string, unknown> = {
    text: message.text.slice(0, 256),
    wakeup: true,
    durationMs: message.lifetime ?? 5000,
    repeat: message.cycles ?? 1,
  };
  if (message.icon) payload.icon = message.icon;
  if (message.sound) {
    // AWTRIX expects RTTTL. LaMetric sound ids are not RTTTL — use a short beep.
    const raw = message.sound;
    payload.soundRtttl =
      typeof raw === "string" && raw.includes(":")
        ? raw
        : "d:d=4,o=5,b=140:c6,e6,g6";
  }
  try {
    const res = await awtrixFetch(device, "/api/v1/notifications", {
      method: "POST",
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      return { ok: false, detail: `HTTP ${res.status}: ${res.text.slice(0, 200)}` };
    }
    await touchDevice(device.id);
    return { ok: true, detail: `Sent to ${device.slug}` };
  } catch (err) {
    return {
      ok: false,
      detail: err instanceof Error ? err.message : String(err),
    };
  }
}

export async function pushAwtrixApp(
  device: Device,
  name: string,
  text: string,
  icon?: string,
): Promise<{ ok: boolean; detail: string }> {
  const appName = name.replace(/[^A-Za-z0-9_-]/g, "-").slice(0, 32);
  const payload: Record<string, unknown> = { text: text.slice(0, 256) };
  if (icon) payload.icon = icon;
  try {
    const res = await awtrixFetch(device, `/api/v1/apps/pushed/${appName}`, {
      method: "PUT",
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      return { ok: false, detail: `HTTP ${res.status}: ${res.text.slice(0, 200)}` };
    }
    await touchDevice(device.id);
    return { ok: true, detail: `App ${appName} updated` };
  } catch (err) {
    return {
      ok: false,
      detail: err instanceof Error ? err.message : String(err),
    };
  }
}

export async function getAwtrixStatus(device: Device): Promise<{
  ok: boolean;
  brightness?: number;
  autoBrightness?: boolean;
  power?: boolean;
  detail: string;
}> {
  try {
    const [display, settings] = await Promise.all([
      awtrixFetch(device, "/api/v1/display"),
      awtrixFetch(device, "/api/v1/settings"),
    ]);
    if (!display.ok) {
      return { ok: false, detail: `HTTP ${display.status}` };
    }
    const d = display.json as { brightness?: number; power?: boolean };
    const s = (settings.ok ? settings.json : {}) as {
      brightness?: number;
      autoBrightness?: boolean;
    };
    await touchDevice(device.id);
    const raw = s.brightness ?? d.brightness ?? 0;
    return {
      ok: true,
      brightness: Math.round((Number(raw) / 255) * 100),
      autoBrightness: Boolean(s.autoBrightness),
      power: d.power !== false,
      detail: "ok",
    };
  } catch (err) {
    return {
      ok: false,
      detail: err instanceof Error ? err.message : String(err),
    };
  }
}

export async function setAwtrixBrightness(
  device: Device,
  percent: number,
  autoBrightness?: boolean,
): Promise<{ ok: boolean; detail: string }> {
  const brightness = Math.max(0, Math.min(255, Math.round((percent / 100) * 255)));
  const payload: Record<string, unknown> = { brightness };
  if (autoBrightness !== undefined) payload.autoBrightness = autoBrightness;
  try {
    const res = await awtrixFetch(device, "/api/v1/settings", {
      method: "PATCH",
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      return { ok: false, detail: `HTTP ${res.status}: ${res.text.slice(0, 200)}` };
    }
    await touchDevice(device.id);
    return { ok: true, detail: `Brillo ${percent}%` };
  } catch (err) {
    return {
      ok: false,
      detail: err instanceof Error ? err.message : String(err),
    };
  }
}
