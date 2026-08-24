import { config } from "./config.ts";
import type { AwtrixErrorBody, DeviceInfo, NotifyInput } from "./types.ts";

const REQUEST_TIMEOUT_MS = 8_000;

export class AwtrixError extends Error {
  readonly status: number;
  readonly code?: string;
  readonly field?: string;

  constructor(status: number, message: string, code?: string, field?: string) {
    super(message);
    this.name = "AwtrixError";
    this.status = status;
    this.code = code;
    this.field = field;
  }
}

function authHeader(): Record<string, string> {
  if (!config.awtrixUser || !config.awtrixPass) {
    return {};
  }
  const token = Buffer.from(`${config.awtrixUser}:${config.awtrixPass}`).toString(
    "base64",
  );
  return { Authorization: `Basic ${token}` };
}

async function awtrixFetch(path: string, init: RequestInit = {}): Promise<Response> {
  const headers = new Headers(init.headers);
  for (const [key, value] of Object.entries(authHeader())) {
    headers.set(key, value);
  }
  if (init.body && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    return await fetch(`${config.awtrixBaseUrl}${path}`, {
      ...init,
      headers,
      signal: controller.signal,
    });
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      throw new AwtrixError(504, `AWTRIX did not respond within ${REQUEST_TIMEOUT_MS}ms`);
    }
    const reason = error instanceof Error ? error.message : "unknown error";
    throw new AwtrixError(502, `Cannot reach AWTRIX at ${config.awtrixBaseUrl}: ${reason}`);
  } finally {
    clearTimeout(timer);
  }
}

async function readJson(response: Response): Promise<unknown> {
  const text = await response.text();
  if (!text) {
    return null;
  }
  try {
    return JSON.parse(text);
  } catch {
    return { raw: text };
  }
}

async function expectOk(response: Response): Promise<unknown> {
  const body = await readJson(response);
  if (response.ok) {
    return body;
  }
  const error = (body ?? {}) as AwtrixErrorBody;
  const message =
    error.error?.message ?? `AWTRIX request failed with HTTP ${response.status}`;
  throw new AwtrixError(response.status, message, error.error?.code, error.error?.field);
}

function compactPayload(input: NotifyInput): Record<string, unknown> {
  const payload: Record<string, unknown> = {};
  const keys: (keyof NotifyInput)[] = [
    "text",
    "icon",
    "textColor",
    "durationMs",
    "repeat",
    "name",
    "hold",
    "stack",
    "wakeup",
    "sound",
    "soundRtttl",
    "soundLoop",
    "effect",
    "overlay",
    "progress",
    "progressColor",
  ];
  for (const key of keys) {
    const value = input[key];
    if (value !== undefined && value !== null && value !== "") {
      payload[key] = value;
    }
  }
  return payload;
}

export async function getDevice(): Promise<DeviceInfo> {
  const body = (await expectOk(await awtrixFetch("/api/v1/device"))) as DeviceInfo;
  return body;
}

export async function sendNotification(input: NotifyInput): Promise<void> {
  const payload = compactPayload(input);
  if (!payload.text && !payload.icon && payload.progress === undefined) {
    throw new AwtrixError(422, "A notification needs text, an icon, or progress");
  }
  await expectOk(
    await awtrixFetch("/api/v1/notifications", {
      method: "POST",
      body: JSON.stringify(payload),
    }),
  );
}

export async function dismissNotification(name?: string): Promise<void> {
  const path =
    name && name !== "active"
      ? `/api/v1/notifications/${encodeURIComponent(name)}`
      : "/api/v1/notifications/active";
  await expectOk(await awtrixFetch(path, { method: "DELETE" }));
}
