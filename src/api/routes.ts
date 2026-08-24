import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import { findAppByApiKey } from "../services/apps.js";
import {
  createChannel,
  getIndicatorFrames,
  listChannels,
  upsertFrame,
} from "../services/channels.js";
import { listDevices, publicDevice } from "../services/devices.js";
import { checkRateLimit, enqueue, queueSize } from "../services/queue.js";
import type { Priority } from "../services/render.js";

const notifySchema = z.object({
  text: z.string().min(1).max(256),
  icon: z.string().max(64).optional(),
  priority: z.enum(["info", "warning", "critical"]).optional(),
  sound: z.union([z.boolean(), z.string()]).optional(),
  lifetime: z.number().int().positive().optional(),
  cycles: z.number().int().positive().optional(),
  device: z.string().min(1).max(64).optional(),
});

const frameSchema = z.object({
  channel_id: z.string().uuid().optional(),
  channel: z.string().min(1).max(64).optional(),
  text: z.string().min(1).max(256),
  icon: z.string().max(64).optional(),
});

async function requireApiKey(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<{ id: string; name: string } | null> {
  const header = request.headers["x-api-key"];
  const apiKey = Array.isArray(header) ? header[0] : header;
  if (!apiKey) {
    await reply.code(401).send({ error: "Missing X-API-Key header" });
    return null;
  }

  const app = await findAppByApiKey(apiKey);
  if (!app) {
    await reply.code(401).send({ error: "Invalid API key" });
    return null;
  }

  if (!checkRateLimit(app.id)) {
    await reply.code(429).send({ error: "Rate limit exceeded" });
    return null;
  }

  return app;
}

export async function registerApiRoutes(app: FastifyInstance): Promise<void> {
  app.get("/api/v1/health", async () => {
    const devices = await listDevices();
    return {
      ok: true,
      service: "lametric-bridge",
      queue: queueSize(),
      devices: devices.map(publicDevice),
      ts: new Date().toISOString(),
    };
  });

  app.get("/lametric/frames", async () => getIndicatorFrames());

  app.get("/api/v1/devices", async (request, reply) => {
    const caller = await requireApiKey(request, reply);
    if (!caller) return;
    return { devices: (await listDevices()).map(publicDevice) };
  });

  app.post("/api/v1/notify", async (request, reply) => {
    const caller = await requireApiKey(request, reply);
    if (!caller) return;

    const parsed = notifySchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: parsed.error.flatten() });
    }

    const body = parsed.data;
    enqueue({
      text: body.text,
      icon: body.icon,
      priority: (body.priority ?? "info") as Priority,
      sound: body.sound,
      lifetime: body.lifetime,
      cycles: body.cycles,
      source: `app:${caller.name}`,
      appId: caller.id,
      deviceId: body.device,
    });

    return reply.code(202).send({ accepted: true, queue: queueSize() });
  });

  app.post("/api/v1/frames", async (request, reply) => {
    const caller = await requireApiKey(request, reply);
    if (!caller) return;

    const parsed = frameSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: parsed.error.flatten() });
    }

    const body = parsed.data;
    let channelId = body.channel_id;

    if (!channelId && body.channel) {
      const existing = (await listChannels()).find(
        (c) => c.name.toLowerCase() === body.channel!.toLowerCase(),
      );
      channelId = existing?.id ?? (await createChannel(body.channel)).id;
    }

    if (!channelId) {
      return reply
        .code(400)
        .send({ error: "Provide channel_id or channel name" });
    }

    const frame = await upsertFrame(
      channelId,
      body.text,
      body.icon ?? "a2867",
    );
    return reply.code(200).send({ ok: true, frame });
  });

  app.put("/api/v1/sources/:id", async (request, reply) => {
    const caller = await requireApiKey(request, reply);
    if (!caller) return;

    const { id } = request.params as { id: string };
    const parsed = z
      .object({
        text: z.string().min(1).max(256),
        icon: z.string().max(64).optional(),
      })
      .safeParse(request.body);

    if (!parsed.success) {
      return reply.code(400).send({ error: parsed.error.flatten() });
    }

    const channels = await listChannels();
    const channel =
      channels.find((c) => c.id === id) ??
      channels.find((c) => c.name === id);

    if (!channel) {
      return reply.code(404).send({ error: "Channel/source not found" });
    }

    const frame = await upsertFrame(
      channel.id,
      parsed.data.text,
      parsed.data.icon ?? "a2867",
    );
    return { ok: true, frame };
  });
}
