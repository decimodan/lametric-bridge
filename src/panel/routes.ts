import path from "node:path";
import { fileURLToPath } from "node:url";
import fastifyBasicAuth from "@fastify/basic-auth";
import fastifyStatic from "@fastify/static";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { searchLametricIcons } from "../adapters/lametricIcons.js";
import {
  deleteHaEntity,
  enqueueHaEntity,
  fetchHaStates,
  getHaConfig,
  haStatus,
  listHaEntities,
  previewHaEntities,
  restartHomeAssistant,
  saveHaConfig,
  testHaConnection,
  upsertHaEntity,
} from "../adapters/homeAssistant.js";
import {
  getDeviceConfig,
  saveDeviceConfig,
  sendNotification,
  testConnection,
} from "../adapters/lametric.js";
import { config, lametricFromEnv } from "../config.js";
import {
  createApp,
  deleteApp,
  listApps,
  rotateAppKey,
} from "../services/apps.js";
import {
  createChannel,
  deleteChannel,
  listChannels,
  updateChannel,
  upsertFrame,
} from "../services/channels.js";
import {
  clearQueue,
  listNotifyLog,
  listQueue,
  logNotify,
  queueSize,
} from "../services/queue.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export async function registerPanelRoutes(app: FastifyInstance): Promise<void> {
  await app.register(async (scoped) => {
    await scoped.register(fastifyBasicAuth, {
      validate: async (username, password, _req, _reply) => {
        if (username !== config.panelUser || password !== config.panelPassword) {
          throw new Error("Unauthorized");
        }
      },
      authenticate: true,
    });

    scoped.addHook("onRequest", scoped.basicAuth);

    await scoped.register(fastifyStatic, {
      root: path.join(__dirname, "public"),
      prefix: "/",
      decorateReply: false,
    });

    registerPanelApi(scoped);
  });
}

function registerPanelApi(app: FastifyInstance): void {
  app.get("/panel/api/status", async () => {
    const d = await getDeviceConfig();
    const cfg = await getHaConfig();
    const status = await haStatus();
    const apps = await listApps();
    const channels = await listChannels();
    return {
      device: d
        ? {
            host: d.host,
            lastSeen: d.lastSeen,
            configured: true,
            source: d.source,
          }
        : { configured: false },
      ha: {
        ...status,
        baseUrl: cfg?.baseUrl ?? null,
      },
      queue: queueSize(),
      apps: apps.length,
      channels: channels.length,
    };
  });

  app.get("/panel/api/logs", async () => ({
    logs: await listNotifyLog(100),
  }));

  app.get("/panel/api/icons", async (request, reply) => {
    const query = request.query as {
      q?: string;
      page?: string;
      count?: string;
    };
    try {
      const result = await searchLametricIcons({
        q: query.q,
        page: query.page ? Number(query.page) : 0,
        count: query.count ? Number(query.count) : 48,
      });
      return result;
    } catch (err) {
      return reply.code(502).send({
        error: err instanceof Error ? err.message : String(err),
      });
    }
  });

  app.get("/panel/api/queue", async () => ({
    size: queueSize(),
    items: listQueue(),
    recent: await listNotifyLog(20),
  }));

  app.delete("/panel/api/queue", async () => ({
    cleared: clearQueue(),
  }));

  app.get("/panel/api/device", async () => {
    const d = await getDeviceConfig();
    if (!d) return { configured: false };
    return {
      configured: true,
      host: d.host,
      lastSeen: d.lastSeen,
      source: d.source,
    };
  });

  app.put("/panel/api/device", async (request, reply) => {
    if (lametricFromEnv()) {
      return reply.code(409).send({
        error:
          "LaMetric device is managed via LAMETRIC_DEVICE_IP / LAMETRIC_API_KEY",
      });
    }
    const parsed = z
      .object({
        host: z.string().min(1),
        apiKey: z.string().min(1),
      })
      .safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: parsed.error.flatten() });
    }
    await saveDeviceConfig(parsed.data.host, parsed.data.apiKey);
    return { ok: true };
  });

  app.post("/panel/api/device/test", async () => testConnection());

  app.post("/panel/api/device/notify", async (request, reply) => {
    const parsed = z
      .object({
        text: z.string().min(1).max(256),
        icon: z.string().max(64).optional(),
        priority: z.enum(["info", "warning", "critical"]).optional(),
        sound: z.boolean().optional(),
      })
      .safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: parsed.error.flatten() });
    }

    const body = parsed.data;
    const result = await sendNotification({
      text: body.text,
      icon: body.icon,
      priority: body.priority ?? "info",
      sound: body.sound,
      source: "panel",
    });
    await logNotify(
      "panel",
      body.text,
      body.priority ?? "info",
      result.ok ? "ok" : "error",
      result.detail,
    );
    return result;
  });

  app.get("/panel/api/apps", async () => ({ apps: await listApps() }));

  app.post("/panel/api/apps", async (request, reply) => {
    const parsed = z
      .object({ name: z.string().min(1).max(64) })
      .safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: parsed.error.flatten() });
    }
    const created = await createApp(parsed.data.name);
    return {
      app: created.app,
      apiKey: created.apiKey,
      warning: "Store this API key now; it will not be shown again.",
    };
  });

  app.delete("/panel/api/apps/:id", async (request, reply) => {
    const { id } = request.params as { id: string };
    if (!(await deleteApp(id))) {
      return reply.code(404).send({ error: "Not found" });
    }
    return { ok: true };
  });

  app.post("/panel/api/apps/:id/rotate", async (request, reply) => {
    const { id } = request.params as { id: string };
    const apiKey = await rotateAppKey(id);
    if (!apiKey) return reply.code(404).send({ error: "Not found" });
    return {
      apiKey,
      warning: "Store this API key now; it will not be shown again.",
    };
  });

  app.get("/panel/api/channels", async () => ({
    channels: await listChannels(),
  }));

  app.post("/panel/api/channels", async (request, reply) => {
    const parsed = z
      .object({
        name: z.string().min(1).max(64),
        sort_order: z.number().int().optional(),
      })
      .safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: parsed.error.flatten() });
    }
    return {
      channel: await createChannel(
        parsed.data.name,
        parsed.data.sort_order ?? 0,
      ),
    };
  });

  app.patch("/panel/api/channels/:id", async (request, reply) => {
    const { id } = request.params as { id: string };
    const parsed = z
      .object({
        name: z.string().min(1).max(64).optional(),
        sort_order: z.number().int().optional(),
        enabled: z.boolean().optional(),
      })
      .safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: parsed.error.flatten() });
    }
    const channel = await updateChannel(id, parsed.data);
    if (!channel) return reply.code(404).send({ error: "Not found" });
    return { channel };
  });

  app.delete("/panel/api/channels/:id", async (request, reply) => {
    const { id } = request.params as { id: string };
    if (!(await deleteChannel(id))) {
      return reply.code(404).send({ error: "Not found" });
    }
    return { ok: true };
  });

  app.put("/panel/api/channels/:id/frame", async (request, reply) => {
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
    const frame = await upsertFrame(
      id,
      parsed.data.text,
      parsed.data.icon ?? "a2867",
    );
    return { frame };
  });

  app.get("/panel/api/ha", async () => {
    const cfg = await getHaConfig();
    return {
      configured: Boolean(cfg),
      baseUrl: cfg?.baseUrl ?? null,
      status: await haStatus(),
      entities: await listHaEntities(),
    };
  });

  app.put("/panel/api/ha", async (request, reply) => {
    const parsed = z
      .object({
        baseUrl: z.string().url(),
        token: z.string().min(1),
      })
      .safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: parsed.error.flatten() });
    }
    await saveHaConfig(parsed.data.baseUrl, parsed.data.token);
    restartHomeAssistant();
    return { ok: true };
  });

  app.post("/panel/api/ha/test", async () => testHaConnection());

  app.get("/panel/api/ha/states", async (request, reply) => {
    try {
      const states = await fetchHaStates();
      const q = (request.query as { q?: string }).q?.toLowerCase();
      const filtered = q
        ? states.filter(
            (s) =>
              s.entity_id.toLowerCase().includes(q) ||
              String(s.attributes?.friendly_name ?? "")
                .toLowerCase()
                .includes(q),
          )
        : states;
      return {
        states: filtered.slice(0, 200).map((s) => ({
          entity_id: s.entity_id,
          state: s.state,
          friendly_name: s.attributes?.friendly_name ?? null,
        })),
      };
    } catch (err) {
      return reply.code(502).send({
        error: err instanceof Error ? err.message : String(err),
      });
    }
  });

  app.post("/panel/api/ha/entities", async (request, reply) => {
    const parsed = z
      .object({
        entity_id: z.string().min(1),
        mode: z.enum(["notify", "frame"]),
        template: z.string().optional(),
        icon: z.string().optional(),
        channel_id: z.string().uuid().nullable().optional(),
        enabled: z.boolean().optional(),
        priority: z.enum(["info", "warning", "critical"]).optional(),
        sound: z.boolean().optional(),
        interval_sec: z.number().int().min(10).nullable().optional(),
        min_delta: z.number().nonnegative().nullable().optional(),
      })
      .safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: parsed.error.flatten() });
    }
    return { entity: await upsertHaEntity(parsed.data) };
  });

  app.patch("/panel/api/ha/entities/:id", async (request, reply) => {
    const { id } = request.params as { id: string };
    const parsed = z
      .object({
        entity_id: z.string().min(1).optional(),
        mode: z.enum(["notify", "frame"]).optional(),
        template: z.string().min(1).optional(),
        icon: z.string().min(1).optional(),
        channel_id: z.string().uuid().nullable().optional(),
        enabled: z.boolean().optional(),
        priority: z.enum(["info", "warning", "critical"]).optional(),
        sound: z.boolean().optional(),
        interval_sec: z.number().int().min(10).nullable().optional(),
        min_delta: z.number().nonnegative().nullable().optional(),
      })
      .safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: parsed.error.flatten() });
    }
    const existing = (await listHaEntities()).find((e) => e.id === id);
    if (!existing) {
      return reply.code(404).send({ error: "Not found" });
    }
    const entity = await upsertHaEntity({
      id,
      entity_id: parsed.data.entity_id ?? existing.entity_id,
      mode: parsed.data.mode ?? existing.mode,
      template: parsed.data.template ?? existing.template,
      icon: parsed.data.icon ?? existing.icon,
      channel_id:
        parsed.data.channel_id === undefined
          ? existing.channel_id
          : parsed.data.channel_id,
      enabled:
        parsed.data.enabled === undefined
          ? existing.enabled
          : parsed.data.enabled,
      priority: parsed.data.priority ?? existing.priority,
      sound: parsed.data.sound ?? existing.sound,
      interval_sec:
        parsed.data.interval_sec === undefined
          ? existing.interval_sec
          : parsed.data.interval_sec,
      min_delta:
        parsed.data.min_delta === undefined
          ? existing.min_delta
          : parsed.data.min_delta,
    });
    return { entity };
  });

  app.delete("/panel/api/ha/entities/:id", async (request, reply) => {
    const { id } = request.params as { id: string };
    if (!(await deleteHaEntity(id))) {
      return reply.code(404).send({ error: "Not found" });
    }
    return { ok: true };
  });

  app.get("/panel/api/ha/previews", async () => ({
    entities: await previewHaEntities(),
  }));

  app.post("/panel/api/ha/entities/:id/send", async (request, reply) => {
    const { id } = request.params as { id: string };
    const parsed = z
      .object({
        priority: z.enum(["info", "warning", "critical"]).optional(),
        sound: z.boolean().optional(),
      })
      .safeParse(request.body ?? {});
    if (!parsed.success) {
      return reply.code(400).send({ error: parsed.error.flatten() });
    }
    try {
      const result = await enqueueHaEntity(
        id,
        parsed.data.priority ?? "info",
        parsed.data.sound ?? false,
      );
      if (!result.ok) return reply.code(400).send(result);
      return result;
    } catch (err) {
      return reply.code(502).send({
        ok: false,
        detail: err instanceof Error ? err.message : String(err),
      });
    }
  });
}
