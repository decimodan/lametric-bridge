import { Hono } from "hono";
import { cors } from "hono/cors";
import { dismissNotification, getDevice, sendNotification, AwtrixError } from "./awtrix.ts";
import { config } from "./config.ts";
import type { NotifyInput } from "./types.ts";
import { renderUi } from "./ui.ts";

function jsonError(status: number, error: string, field?: string) {
  return Response.json(field ? { error, field } : { error }, { status });
}

function isNotifyInput(value: unknown): value is NotifyInput {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export const app = new Hono();

app.use("/api/*", cors());

app.use("/api/*", async (c, next) => {
  if (c.req.path === "/api/health") {
    await next();
    return;
  }
  if (!config.bridgeToken) {
    await next();
    return;
  }
  const header = c.req.header("authorization") ?? "";
  const bearer = header.toLowerCase().startsWith("bearer ")
    ? header.slice(7).trim()
    : "";
  const token = bearer || c.req.header("x-bridge-token")?.trim();
  if (token !== config.bridgeToken) {
    return jsonError(401, "Missing or invalid bridge token");
  }
  await next();
});

app.onError((error, _c) => {
  if (error instanceof AwtrixError) {
    return jsonError(error.status, error.message, error.field);
  }
  const message = error instanceof Error ? error.message : "Unexpected error";
  return jsonError(500, message);
});

app.get("/", (c) => c.html(renderUi(config.bridgeToken)));

app.get("/api/health", async (c) => {
  try {
    const device = await getDevice();
    return c.json({
      ok: true,
      bridge: "lametric-bridge",
      awtrix: {
        version: device.version,
        hostname: device.hostname,
        ipAddress: device.ipAddress,
        currentApp: device.currentApp,
        matrixPower: device.matrixPower,
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "AWTRIX unreachable";
    return c.json({ ok: true, bridge: "lametric-bridge", awtrix: null, warning: message });
  }
});

app.get("/api/device", async (c) => c.json(await getDevice()));

app.post("/api/notify", async (c) => {
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return jsonError(400, "Request body is not valid JSON");
  }
  if (!isNotifyInput(body)) {
    return jsonError(422, "Notification body must be a JSON object");
  }
  await sendNotification(body);
  return c.json({ ok: true });
});

app.delete("/api/notify", async (c) => {
  await dismissNotification();
  return c.json({ ok: true });
});

app.delete("/api/notify/:name", async (c) => {
  await dismissNotification(c.req.param("name"));
  return c.json({ ok: true });
});
