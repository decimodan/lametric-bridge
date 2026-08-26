import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import { findAppByApiKey } from "../services/apps.js";
import { getCard, listCards, publicCard } from "../services/cards.js";
import {
  connectionTemplateVars,
  listEnabledConnectionAutomations,
  markAutomationSent,
  renderCardText,
} from "../services/cardAutomations.js";
import {
  createChannel,
  getIndicatorFrames,
  listChannels,
  upsertFrame,
} from "../services/channels.js";
import { listDevices, publicDevice } from "../services/devices.js";
import { checkRateLimit, enqueue, queueSize } from "../services/queue.js";
import type { Priority } from "../services/render.js";

const notifySchema = z
  .object({
    /** Send a saved alert card by slug/id. Merges with optional overrides. */
    card: z.string().min(1).max(64).optional(),
    text: z.string().min(1).max(256).optional(),
    icon: z.string().max(64).optional(),
    priority: z.enum(["info", "warning", "critical"]).optional(),
    sound: z.union([z.boolean(), z.string()]).optional(),
    lifetime: z.number().int().positive().optional(),
    cycles: z.number().int().positive().optional(),
    device: z.string().min(1).max(64).optional(),
  })
  .refine((b) => Boolean(b.card || b.text), {
    message: "Provide text or card",
  });

/** Event-oriented ingest for apps (Sentinel, etc.). Same queue as /notify. */
const webhookSchema = z.object({
  event: z.string().min(1).max(64).optional(),
  card: z.string().min(1).max(64).optional(),
  text: z.string().min(1).max(256).optional(),
  message: z.string().min(1).max(256).optional(),
  icon: z.string().max(64).optional(),
  priority: z.enum(["info", "warning", "critical"]).optional(),
  sound: z.union([z.boolean(), z.string()]).optional(),
  lifetime: z.number().int().positive().optional(),
  cycles: z.number().int().positive().optional(),
  device: z.string().min(1).max(64).optional(),
  /** Optional structured vars for connection automations / card templates. */
  name: z.string().max(256).optional(),
  hot_free: z.string().max(32).optional(),
  vars: z.record(z.string(), z.string()).optional(),
  /** Optional: also upsert a persistent Indicator frame. */
  channel: z.string().min(1).max(64).optional(),
  frame_text: z.string().min(1).max(256).optional(),
  frame_icon: z.string().max(64).optional(),
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

  app.get("/api/v1/cards", async (request, reply) => {
    const caller = await requireApiKey(request, reply);
    if (!caller) return;
    return { cards: (await listCards()).map(publicCard) };
  });

  app.post("/api/v1/notify", async (request, reply) => {
    const caller = await requireApiKey(request, reply);
    if (!caller) return;

    const parsed = notifySchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: parsed.error.flatten() });
    }

    const body = parsed.data;
    let text = body.text?.trim() ?? "";
    let icon = body.icon;
    let priority = body.priority;
    let sound = body.sound;
    let source = `app:${caller.name}`;

    if (body.card) {
      const card = await getCard(body.card);
      if (!card) {
        return reply.code(404).send({ error: `Unknown card: ${body.card}` });
      }
      text = text || card.text;
      icon = icon ?? card.icon;
      priority = priority ?? card.priority;
      sound = sound ?? card.sound;
      source = `app:${caller.name}:card:${card.slug}`;
    }

    if (!text) {
      return reply.code(400).send({ error: "Provide text or card" });
    }

    enqueue({
      text,
      icon,
      priority: (priority ?? "info") as Priority,
      sound,
      lifetime: body.lifetime,
      cycles: body.cycles,
      source,
      appId: caller.id,
      deviceId: body.device,
    });

    return reply.code(202).send({ accepted: true, queue: queueSize() });
  });

  /**
   * Webhook for LAN apps (Sentinel, scripts, etc.).
   * Accepts event metadata + text/message; enqueues a clock notification.
   * Optionally upserts a persistent frame when `channel` is set.
   */
  app.post("/api/v1/webhook", async (request, reply) => {
    const caller = await requireApiKey(request, reply);
    if (!caller) return;

    const parsed = webhookSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: parsed.error.flatten() });
    }

    const body = parsed.data;
    let text = (body.text ?? body.message ?? "").trim();
    let icon = body.icon;
    let priority = body.priority;
    let sound = body.sound;

    if (body.card) {
      const card = await getCard(body.card);
      if (!card) {
        return reply.code(404).send({ error: `Unknown card: ${body.card}` });
      }
      text = text || card.text;
      icon = icon ?? card.icon;
      priority = priority ?? card.priority;
      sound = sound ?? card.sound;
    }

    const event = body.event?.trim();
    let automationHits = 0;

    if (event) {
      const autos = await listEnabledConnectionAutomations(caller.name, event);
      if (autos.length) {
        const vars = {
          ...connectionTemplateVars({
            event,
            app: caller.name,
            text: text || event,
            hotFree: body.hot_free,
            name: body.name,
          }),
          ...(body.vars ?? {}),
        };
        for (const auto of autos) {
          const card = await getCard(auto.cardId);
          if (!card) continue;
          const rendered = renderCardText(card, vars);
          if (!rendered) continue;
          enqueue({
            text: rendered,
            icon: card.icon,
            priority: card.priority,
            sound: card.sound,
            lifetime: body.lifetime,
            cycles: body.cycles,
            source: `card-auto:${caller.name}:${event}:${card.slug}`,
            appId: caller.id,
            deviceId: auto.deviceId ?? body.device,
          });
          await markAutomationSent(auto.id, event);
          automationHits += 1;
        }
      }
    }

    // If connection automations handled this event, skip default notify
    // (avoids double messages). Still allow explicit card/text without event rules.
    const skipDefault = automationHits > 0;

    if (!skipDefault) {
      if (!text) {
        return reply
          .code(400)
          .send({ error: "Provide text, message, or card (1–256 chars)" });
      }

      const source = [
        `app:${caller.name}`,
        event,
        body.card ? `card:${body.card}` : null,
      ]
        .filter(Boolean)
        .join(":");

      enqueue({
        text,
        icon,
        priority: (priority ?? "info") as Priority,
        sound,
        lifetime: body.lifetime,
        cycles: body.cycles,
        source,
        appId: caller.id,
        deviceId: body.device,
      });
    } else if (!text) {
      text = event ?? "ok";
    }

    let frame = null;
    if (body.channel) {
      const existing = (await listChannels()).find(
        (c) => c.name.toLowerCase() === body.channel!.toLowerCase(),
      );
      const channelId =
        existing?.id ?? (await createChannel(body.channel)).id;
      frame = await upsertFrame(
        channelId,
        body.frame_text ?? text,
        body.frame_icon ?? icon ?? "a2867",
      );
    }

    return reply.code(202).send({
      accepted: true,
      queue: queueSize(),
      event: event ?? null,
      automations: automationHits,
      frame,
    });
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
