import path from "node:path";
import { fileURLToPath } from "node:url";
import fastifyBasicAuth from "@fastify/basic-auth";
import fastifyStatic from "@fastify/static";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import {
  dispatchNotification,
  getDeviceStatus,
  identifyDevice,
  setDeviceBrightness,
  testDevice,
} from "../adapters/clocks.js";
import { searchLametricIcons } from "../adapters/lametricIcons.js";
import {
  deleteHaEntity,
  enqueueHaEntity,
  fetchHaStates,
  getHaConfig,
  haStatus,
  listHaDeviceGroups,
  listHaEntities,
  previewHaEntities,
  restartHomeAssistant,
  saveHaConfig,
  testHaConnection,
  upsertHaEntity,
} from "../adapters/homeAssistant.js";
import { config } from "../config.js";
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
  deleteCard,
  getCard,
  listCards,
  publicCard,
  resolveCardSound,
  saveCard,
} from "../services/cards.js";
import {
  CONNECTION_CATALOG,
  connectionTemplateVars,
  deleteAutomation,
  frigateTemplateVars,
  getAutomation,
  haTemplateVars,
  listAutomations,
  publicAutomation,
  renderCardText,
  resolveAutomationSound,
  saveAutomation,
  setAutomationEnabled,
} from "../services/cardAutomations.js";
import {
  deleteSensorCard,
  getSensorCard,
  listSensorCards,
  listSensorCardsLive,
  publicSensorCard,
  saveSensorCard,
} from "../services/sensorCards.js";
import { LAMETRIC_SOUNDS } from "../services/sounds.js";
import {
  deleteDevice,
  getDevice,
  listDevices,
  publicDevice,
  refreshAllDeviceHosts,
  resolveDeviceByMac,
  saveDevice,
  updateDeviceMac,
  updateDeviceNotifyPrefs,
} from "../services/devices.js";
import {
  clearQueue,
  enqueue,
  getCurrentQueueItem,
  getCurrentQueueItems,
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
    const devices = await listDevices();
    const cfg = await getHaConfig();
    const status = await haStatus();
    const apps = await listApps();
    const channels = await listChannels();
    return {
      devices: devices.map(publicDevice),
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

  app.get("/panel/api/sensor-cards", async () => ({
    cards: (await listSensorCards()).map(publicSensorCard),
  }));

  app.get("/panel/api/sensor-cards/live", async (request, reply) => {
    try {
      let states: Array<{
        entity_id: string;
        state: string;
        attributes: Record<string, unknown>;
      }> = [];
      try {
        states = await fetchHaStates();
      } catch {
        states = [];
      }
      return { cards: await listSensorCardsLive(states) };
    } catch (err) {
      return reply.code(502).send({
        error: err instanceof Error ? err.message : String(err),
      });
    }
  });

  app.post("/panel/api/sensor-cards", async (request, reply) => {
    const parsed = z
      .object({
        entityId: z.string().min(1).max(128),
        title: z.string().min(1).max(64),
        description: z.string().max(512).optional(),
        sortOrder: z.number().int().min(0).optional(),
        enabled: z.boolean().optional(),
        alertEnabled: z.boolean().optional(),
        whenGt: z.number().nullable().optional(),
        whenLt: z.number().nullable().optional(),
        minDelta: z.number().nonnegative().nullable().optional(),
        intervalSec: z.number().int().min(10).nullable().optional(),
        priority: z.enum(["info", "warning", "critical"]).optional(),
        sound: z.boolean().optional(),
        alertTemplate: z.string().max(256).optional(),
        deviceId: z.string().min(1).max(64).nullable().optional(),
        deviceIds: z.array(z.string().min(1).max(64)).nullable().optional(),
      })
      .safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: parsed.error.flatten() });
    }
    const card = await saveSensorCard(parsed.data);
    return { card: publicSensorCard(card) };
  });

  app.patch("/panel/api/sensor-cards/:id", async (request, reply) => {
    const { id } = request.params as { id: string };
    const existing = await getSensorCard(id);
    if (!existing) return reply.code(404).send({ error: "Not found" });
    const parsed = z
      .object({
        entityId: z.string().min(1).max(128).optional(),
        title: z.string().min(1).max(64).optional(),
        description: z.string().max(512).optional(),
        sortOrder: z.number().int().min(0).optional(),
        enabled: z.boolean().optional(),
        alertEnabled: z.boolean().optional(),
        whenGt: z.number().nullable().optional(),
        whenLt: z.number().nullable().optional(),
        minDelta: z.number().nonnegative().nullable().optional(),
        intervalSec: z.number().int().min(10).nullable().optional(),
        priority: z.enum(["info", "warning", "critical"]).optional(),
        sound: z.boolean().optional(),
        alertTemplate: z.string().max(256).optional(),
        deviceId: z.string().min(1).max(64).nullable().optional(),
        deviceIds: z.array(z.string().min(1).max(64)).nullable().optional(),
      })
      .safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: parsed.error.flatten() });
    }
    const card = await saveSensorCard({
      id,
      entityId: parsed.data.entityId ?? existing.entityId,
      title: parsed.data.title ?? existing.title,
      description:
        parsed.data.description === undefined
          ? existing.description
          : parsed.data.description,
      sortOrder: parsed.data.sortOrder ?? existing.sortOrder,
      enabled: parsed.data.enabled ?? existing.enabled,
      alertEnabled: parsed.data.alertEnabled ?? existing.alertEnabled,
      whenGt:
        parsed.data.whenGt === undefined ? existing.whenGt : parsed.data.whenGt,
      whenLt:
        parsed.data.whenLt === undefined ? existing.whenLt : parsed.data.whenLt,
      minDelta:
        parsed.data.minDelta === undefined
          ? existing.minDelta
          : parsed.data.minDelta,
      intervalSec:
        parsed.data.intervalSec === undefined
          ? existing.intervalSec
          : parsed.data.intervalSec,
      priority: parsed.data.priority ?? existing.priority,
      sound: parsed.data.sound ?? existing.sound,
      alertTemplate: parsed.data.alertTemplate ?? existing.alertTemplate,
      deviceId:
        parsed.data.deviceIds !== undefined
          ? null
          : parsed.data.deviceId === undefined
            ? existing.deviceId
            : parsed.data.deviceId,
      deviceIds:
        parsed.data.deviceIds !== undefined
          ? parsed.data.deviceIds
          : parsed.data.deviceId !== undefined
            ? null
            : existing.deviceIds,
    });
    return { card: publicSensorCard(card) };
  });

  app.delete("/panel/api/sensor-cards/:id", async (request, reply) => {
    const { id } = request.params as { id: string };
    if (!(await deleteSensorCard(id))) {
      return reply.code(404).send({ error: "Not found" });
    }
    return { ok: true };
  });

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

  app.get("/panel/api/queue", async (request) => {
    const query = request.query as { device?: string };
    let deviceFilter: string | undefined;
    if (query.device && query.device !== "all") {
      const dev = await getDevice(query.device);
      deviceFilter = dev?.id;
    }
    const filtered = Boolean(deviceFilter);
    return {
      size: queueSize(deviceFilter),
      current: filtered
        ? getCurrentQueueItem(deviceFilter)
        : getCurrentQueueItem(),
      currents: filtered ? undefined : getCurrentQueueItems(),
      items: listQueue(deviceFilter),
      recent: await listNotifyLog(20),
      deviceId: deviceFilter ?? null,
    };
  });

  app.delete("/panel/api/queue", async (request) => {
    const query = request.query as { device?: string };
    let deviceFilter: string | undefined;
    if (query.device && query.device !== "all") {
      const dev = await getDevice(query.device);
      deviceFilter = dev?.id;
    }
    return {
      cleared: clearQueue(deviceFilter),
      deviceId: deviceFilter ?? null,
    };
  });

  app.get("/panel/api/devices/:id/queue", async (request, reply) => {
    const { id } = request.params as { id: string };
    const dev = await getDevice(id);
    if (!dev) return reply.code(404).send({ error: "Not found" });
    return {
      size: queueSize(dev.id),
      current: getCurrentQueueItem(dev.id),
      items: listQueue(dev.id),
      device: publicDevice(dev),
    };
  });

  app.get("/panel/api/devices", async () => ({
    devices: (await listDevices()).map(publicDevice),
  }));

  app.post("/panel/api/devices", async (request, reply) => {
    const parsed = z
      .object({
        slug: z.string().min(1).max(32),
        name: z.string().min(1).max(64),
        kind: z.enum(["lametric", "awtrix"]),
        host: z.string().min(1),
        macAddress: z.string().max(32).optional(),
        apiKey: z.string().optional(),
      })
      .safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: parsed.error.flatten() });
    }
    try {
      const device = await saveDevice(parsed.data);
      if (device.macAddress) {
        await resolveDeviceByMac(device.id).catch(() => {});
      }
      const refreshed = (await getDevice(device.id)) ?? device;
      return { device: publicDevice(refreshed) };
    } catch (err) {
      return reply.code(409).send({
        error: err instanceof Error ? err.message : String(err),
      });
    }
  });

  app.patch("/panel/api/devices/:id", async (request, reply) => {
    const { id } = request.params as { id: string };
    const existing = await getDevice(id);
    if (!existing) return reply.code(404).send({ error: "Not found" });
    const parsed = z
      .object({
        slug: z.string().min(1).max(32).optional(),
        name: z.string().min(1).max(64).optional(),
        host: z.string().min(1).optional(),
        macAddress: z.string().max(32).nullable().optional(),
        apiKey: z.string().optional(),
        notifySoundMode: z.enum(["inherit", "on", "off"]).optional(),
        notifySoundId: z.string().max(64).nullable().optional(),
      })
      .safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: parsed.error.flatten() });
    }
    try {
      if (
        parsed.data.notifySoundMode !== undefined ||
        parsed.data.notifySoundId !== undefined
      ) {
        const updated = await updateDeviceNotifyPrefs(id, {
          notifySoundMode: parsed.data.notifySoundMode,
          notifySoundId: parsed.data.notifySoundId,
        });
        if (!updated) return reply.code(404).send({ error: "Not found" });
        if (
          parsed.data.slug === undefined &&
          parsed.data.name === undefined &&
          parsed.data.host === undefined &&
          parsed.data.macAddress === undefined &&
          parsed.data.apiKey === undefined
        ) {
          return { device: publicDevice(updated) };
        }
      }

      if (existing.envManaged) {
        if (
          parsed.data.slug !== undefined ||
          parsed.data.name !== undefined ||
          parsed.data.host !== undefined ||
          parsed.data.apiKey !== undefined
        ) {
          return reply.code(409).send({
            error: `${existing.name} is managed via environment variables`,
          });
        }
        if (parsed.data.macAddress !== undefined) {
          const updated = await updateDeviceMac(id, parsed.data.macAddress);
          if (!updated) return reply.code(404).send({ error: "Not found" });
          if (updated.macAddress) {
            await resolveDeviceByMac(updated.id).catch(() => {});
          }
          const refreshed = (await getDevice(updated.id)) ?? updated;
          return { device: publicDevice(refreshed) };
        }
        return { device: publicDevice(existing) };
      }

      const device = await saveDevice({
        id: existing.id,
        slug: parsed.data.slug ?? existing.slug,
        name: parsed.data.name ?? existing.name,
        kind: existing.kind,
        host: parsed.data.host ?? existing.host,
        macAddress:
          parsed.data.macAddress !== undefined
            ? parsed.data.macAddress
            : existing.macAddress,
        apiKey: parsed.data.apiKey,
      });
      if (device.macAddress) {
        await resolveDeviceByMac(device.id).catch(() => {});
      }
      const refreshed = (await getDevice(device.id)) ?? device;
      return { device: publicDevice(refreshed) };
    } catch (err) {
      return reply.code(409).send({
        error: err instanceof Error ? err.message : String(err),
      });
    }
  });

  app.post("/panel/api/devices/refresh-hosts", async () => ({
    devices: await refreshAllDeviceHosts(),
  }));

  app.post("/panel/api/devices/:id/resolve", async (request, reply) => {
    const { id } = request.params as { id: string };
    const result = await resolveDeviceByMac(id);
    if (!result.ok && result.detail === "Device not found") {
      return reply.code(404).send(result);
    }
    return result;
  });

  app.delete("/panel/api/devices/:id", async (request, reply) => {
    const { id } = request.params as { id: string };
    try {
      if (!(await deleteDevice(id))) {
        return reply.code(404).send({ error: "Not found" });
      }
      return { ok: true };
    } catch (err) {
      return reply.code(409).send({
        error: err instanceof Error ? err.message : String(err),
      });
    }
  });

  app.get("/panel/api/devices/:id/status", async (request, reply) => {
    const { id } = request.params as { id: string };
    const result = await getDeviceStatus(id);
    if (!result.ok && result.detail === "Device not found") {
      return reply.code(404).send(result);
    }
    return result;
  });

  app.post("/panel/api/devices/:id/test", async (request, reply) => {
    const { id } = request.params as { id: string };
    const result = await testDevice(id);
    if (!result.ok && result.detail === "Device not found") {
      return reply.code(404).send(result);
    }
    return result;
  });

  app.post("/panel/api/devices/:id/identify", async (request, reply) => {
    const { id } = request.params as { id: string };
    const result = await identifyDevice(id);
    await logNotify(
      "identify",
      `Soy ${id}`,
      "critical",
      result.ok ? "ok" : "error",
      result.detail,
    );
    return result;
  });

  app.patch("/panel/api/devices/:id/brightness", async (request, reply) => {
    const { id } = request.params as { id: string };
    const parsed = z
      .object({
        brightness: z.number().min(0).max(100),
        autoBrightness: z.boolean().optional(),
      })
      .safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: parsed.error.flatten() });
    }
    const result = await setDeviceBrightness(
      id,
      parsed.data.brightness,
      parsed.data.autoBrightness,
    );
    return result;
  });

  app.post("/panel/api/devices/:id/notify", async (request, reply) => {
    const { id } = request.params as { id: string };
    const device = await getDevice(id);
    if (!device) return reply.code(404).send({ error: "Not found" });
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
    const result = await dispatchNotification({
      text: body.text,
      icon: body.icon,
      priority: body.priority ?? "info",
      sound: body.sound,
      source: "panel",
      deviceId: device.id,
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

  app.post("/panel/api/notify", async (request, reply) => {
    const parsed = z
      .object({
        text: z.string().min(1).max(256),
        icon: z.string().max(64).optional(),
        priority: z.enum(["info", "warning", "critical"]).optional(),
        sound: z.union([z.boolean(), z.string()]).optional(),
        device: z.string().min(1).max(64).optional(),
      })
      .safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: parsed.error.flatten() });
    }
    const body = parsed.data;
    const result = await dispatchNotification({
      text: body.text,
      icon: body.icon,
      priority: body.priority ?? "info",
      sound: body.sound,
      source: "panel",
      deviceId: body.device,
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

  app.get("/panel/api/sounds", async () => ({
    sounds: LAMETRIC_SOUNDS,
  }));

  app.get("/panel/api/cards", async () => ({
    cards: (await listCards()).map(publicCard),
  }));

  app.post("/panel/api/cards", async (request, reply) => {
    const parsed = z
      .object({
        slug: z.string().min(1).max(32),
        name: z.string().min(1).max(64),
        text: z.string().min(1).max(256),
        icon: z.string().max(64).optional(),
        priority: z.enum(["info", "warning", "critical"]).optional(),
        sound: z.boolean().optional(),
        soundId: z.string().max(64).nullable().optional(),
        sortOrder: z.number().int().optional(),
      })
      .safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: parsed.error.flatten() });
    }
    try {
      const card = await saveCard(parsed.data);
      return { card: publicCard(card) };
    } catch (err) {
      return reply.code(409).send({
        error: err instanceof Error ? err.message : String(err),
      });
    }
  });

  app.patch("/panel/api/cards/:id", async (request, reply) => {
    const { id } = request.params as { id: string };
    const existing = await getCard(id);
    if (!existing) return reply.code(404).send({ error: "Not found" });
    const parsed = z
      .object({
        slug: z.string().min(1).max(32).optional(),
        name: z.string().min(1).max(64).optional(),
        text: z.string().min(1).max(256).optional(),
        icon: z.string().max(64).optional(),
        priority: z.enum(["info", "warning", "critical"]).optional(),
        sound: z.boolean().optional(),
        soundId: z.string().max(64).nullable().optional(),
        sortOrder: z.number().int().optional(),
      })
      .safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: parsed.error.flatten() });
    }
    try {
      const card = await saveCard({
        id: existing.id,
        slug: parsed.data.slug ?? existing.slug,
        name: parsed.data.name ?? existing.name,
        text: parsed.data.text ?? existing.text,
        icon: parsed.data.icon ?? existing.icon,
        priority: parsed.data.priority ?? existing.priority,
        sound: parsed.data.sound ?? existing.sound,
        soundId:
          parsed.data.soundId === undefined
            ? existing.soundId
            : parsed.data.soundId,
        sortOrder: parsed.data.sortOrder ?? existing.sortOrder,
      });
      return { card: publicCard(card) };
    } catch (err) {
      return reply.code(409).send({
        error: err instanceof Error ? err.message : String(err),
      });
    }
  });

  app.delete("/panel/api/cards/:id", async (request, reply) => {
    const { id } = request.params as { id: string };
    try {
      if (!(await deleteCard(id))) {
        return reply.code(404).send({ error: "Not found" });
      }
      return { ok: true };
    } catch (err) {
      return reply.code(409).send({
        error: err instanceof Error ? err.message : String(err),
      });
    }
  });

  app.post("/panel/api/cards/:id/send", async (request, reply) => {
    const { id } = request.params as { id: string };
    const card = await getCard(id);
    if (!card) return reply.code(404).send({ error: "Not found" });
    const parsed = z
      .object({
        device: z.string().min(1).max(64).optional(),
        text: z.string().min(1).max(256).optional(),
        sound: z.union([z.boolean(), z.string()]).optional(),
      })
      .safeParse(request.body ?? {});
    if (!parsed.success) {
      return reply.code(400).send({ error: parsed.error.flatten() });
    }
    const text = parsed.data.text?.trim() || card.text;
    const sound = resolveCardSound(card, parsed.data.sound);
    const result = await dispatchNotification({
      text,
      icon: card.icon,
      priority: card.priority,
      sound,
      source: `card:${card.slug}`,
      deviceId: parsed.data.device,
    });
    await logNotify(
      `card:${card.slug}`,
      text,
      card.priority,
      result.ok ? "ok" : "error",
      result.detail,
    );
    return result;
  });

  app.get("/panel/api/connections", async () => ({
    connections: CONNECTION_CATALOG,
  }));

  app.get("/panel/api/automations", async () => {
    const autos = await listAutomations();
    const devices = await listDevices();
    const deviceById = new Map(devices.map((d) => [d.id, d]));
    const enriched = await Promise.all(
      autos.map(async (auto) => {
        const card = await getCard(auto.cardId);
        const device = auto.deviceId ? deviceById.get(auto.deviceId) : null;
        return publicAutomation(auto, {
          card,
          deviceName: device?.name ?? (auto.deviceId ? null : "todos"),
          deviceSlug: device?.slug ?? null,
        });
      }),
    );
    return { automations: enriched };
  });

  app.post("/panel/api/automations", async (request, reply) => {
    const parsed = z
      .object({
        name: z.string().max(128).optional(),
        source: z.enum(["ha", "connection"]).optional(),
        cardId: z.string().min(1),
        entityId: z.string().min(1).max(128).nullable().optional(),
        appName: z.string().min(1).max(64).nullable().optional(),
        eventName: z.string().min(1).max(64).nullable().optional(),
        deviceId: z.string().min(1).max(64).nullable().optional(),
        enabled: z.boolean().optional(),
        sound: z.boolean().nullable().optional(),
        soundId: z.string().max(64).nullable().optional(),
        trigger: z.enum(["change", "equals", "gt", "lt"]).optional(),
        triggerValue: z.string().max(128).nullable().optional(),
      })
      .safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: parsed.error.flatten() });
    }
    try {
      const auto = await saveAutomation({
        name: parsed.data.name,
        source: parsed.data.source,
        cardId: parsed.data.cardId,
        entityId: parsed.data.entityId,
        appName: parsed.data.appName,
        eventName: parsed.data.eventName,
        deviceId: parsed.data.deviceId ?? null,
        enabled: parsed.data.enabled,
        sound: parsed.data.sound,
        soundId: parsed.data.soundId,
        trigger: parsed.data.trigger,
        triggerValue: parsed.data.triggerValue,
      });
      const card = await getCard(auto.cardId);
      const device = auto.deviceId ? await getDevice(auto.deviceId) : null;
      return {
        automation: publicAutomation(auto, {
          card,
          deviceName: device?.name ?? "todos",
          deviceSlug: device?.slug ?? null,
        }),
      };
    } catch (err) {
      return reply.code(409).send({
        error: err instanceof Error ? err.message : String(err),
      });
    }
  });

  app.patch("/panel/api/automations/:id", async (request, reply) => {
    const { id } = request.params as { id: string };
    const existing = await getAutomation(id);
    if (!existing) return reply.code(404).send({ error: "Not found" });
    const parsed = z
      .object({
        name: z.string().max(128).optional(),
        source: z.enum(["ha", "connection"]).optional(),
        cardId: z.string().min(1).optional(),
        entityId: z.string().min(1).max(128).nullable().optional(),
        appName: z.string().min(1).max(64).nullable().optional(),
        eventName: z.string().min(1).max(64).nullable().optional(),
        deviceId: z.string().min(1).max(64).nullable().optional(),
        enabled: z.boolean().optional(),
        sound: z.boolean().nullable().optional(),
        soundId: z.string().max(64).nullable().optional(),
        trigger: z.enum(["change", "equals", "gt", "lt"]).optional(),
        triggerValue: z.string().max(128).nullable().optional(),
      })
      .safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: parsed.error.flatten() });
    }
    try {
      if (
        parsed.data.enabled !== undefined &&
        Object.keys(parsed.data).length === 1
      ) {
        const auto = await setAutomationEnabled(id, parsed.data.enabled);
        const card = auto ? await getCard(auto.cardId) : null;
        const device = auto?.deviceId ? await getDevice(auto.deviceId) : null;
        return {
          automation: auto
            ? publicAutomation(auto, {
                card,
                deviceName: device?.name ?? "todos",
                deviceSlug: device?.slug ?? null,
              })
            : null,
        };
      }
      const auto = await saveAutomation({
        id,
        name: parsed.data.name ?? existing.name,
        source: parsed.data.source ?? existing.source,
        cardId: parsed.data.cardId ?? existing.cardId,
        entityId:
          parsed.data.entityId === undefined
            ? existing.entityId
            : parsed.data.entityId,
        appName:
          parsed.data.appName === undefined
            ? existing.appName
            : parsed.data.appName,
        eventName:
          parsed.data.eventName === undefined
            ? existing.eventName
            : parsed.data.eventName,
        deviceId:
          parsed.data.deviceId === undefined
            ? existing.deviceId
            : parsed.data.deviceId,
        enabled: parsed.data.enabled ?? existing.enabled,
        sound:
          parsed.data.sound === undefined
            ? existing.sound
            : parsed.data.sound,
        soundId:
          parsed.data.soundId === undefined
            ? existing.soundId
            : parsed.data.soundId,
        trigger: parsed.data.trigger ?? existing.trigger,
        triggerValue:
          parsed.data.triggerValue === undefined
            ? existing.triggerValue
            : parsed.data.triggerValue,
      });
      const card = await getCard(auto.cardId);
      const device = auto.deviceId ? await getDevice(auto.deviceId) : null;
      return {
        automation: publicAutomation(auto, {
          card,
          deviceName: device?.name ?? "todos",
          deviceSlug: device?.slug ?? null,
        }),
      };
    } catch (err) {
      return reply.code(409).send({
        error: err instanceof Error ? err.message : String(err),
      });
    }
  });

  app.delete("/panel/api/automations/:id", async (request, reply) => {
    const { id } = request.params as { id: string };
    if (!(await deleteAutomation(id))) {
      return reply.code(404).send({ error: "Not found" });
    }
    return { ok: true };
  });

  app.post("/panel/api/automations/:id/test", async (request, reply) => {
    const { id } = request.params as { id: string };
    const auto = await getAutomation(id);
    if (!auto) return reply.code(404).send({ error: "Not found" });
    const card = await getCard(auto.cardId);
    if (!card) return reply.code(404).send({ error: "Card not found" });

    let vars: Record<string, string>;
    if (auto.source === "connection") {
      if ((auto.appName ?? "").toLowerCase() === "frigate") {
        vars = frigateTemplateVars({
          event: auto.eventName ?? "person",
          label: auto.eventName === "detection" ? "person" : (auto.eventName ?? "person"),
          camera: "entrada",
          zones: ["porche"],
          score: 0.91,
          subLabel: "",
        });
      } else {
        vars = connectionTemplateVars({
          event: auto.eventName ?? "test",
          app: auto.appName ?? "app",
          text: "prueba Sentinel",
          hotFree: "42G",
          name: "Show.S01",
        });
      }
    } else {
      let state = "test";
      let attributes: Record<string, unknown> = {};
      try {
        const states = await fetchHaStates();
        const s = states.find((x) => x.entity_id === auto.entityId);
        if (s) {
          state = s.state;
          attributes = s.attributes ?? {};
        }
      } catch {
        /* use placeholder */
      }
      vars = haTemplateVars(state, attributes, auto.entityId ?? "entity");
    }

    const text = renderCardText(card, vars);
    await enqueue({
      text: text || card.text,
      icon: card.icon,
      priority: card.priority,
      sound: resolveAutomationSound(auto, card),
      source: `card-auto-test:${card.slug}`,
      deviceId: auto.deviceId ?? undefined,
    });
    await logNotify(
      `card-auto-test:${card.slug}`,
      text || card.text,
      card.priority,
      "ok",
      `queued → ${auto.deviceId ?? "all"}`,
    );
    return { ok: true, detail: `Queued: ${text || card.text}`, queue: queueSize() };
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

  app.get("/panel/api/ha/devices", async (request, reply) => {
    try {
      const query = request.query as { q?: string; domains?: string };
      const domains = query.domains
        ? query.domains.split(",").map((d) => d.trim()).filter(Boolean)
        : ["sensor", "binary_sensor", "switch", "light", "climate", "cover", "number"];
      return await listHaDeviceGroups({
        q: query.q,
        domains,
      });
    } catch (err) {
      return reply.code(502).send({
        error: err instanceof Error ? err.message : String(err),
      });
    }
  });

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
        when_gt: z.number().nullable().optional(),
        when_lt: z.number().nullable().optional(),
        device_id: z.string().min(1).nullable().optional(),
        device_ids: z.array(z.string().min(1).max(64)).nullable().optional(),
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
        when_gt: z.number().nullable().optional(),
        when_lt: z.number().nullable().optional(),
        device_id: z.string().min(1).nullable().optional(),
        device_ids: z.array(z.string().min(1).max(64)).nullable().optional(),
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
      when_gt:
        parsed.data.when_gt === undefined
          ? existing.when_gt
          : parsed.data.when_gt,
      when_lt:
        parsed.data.when_lt === undefined
          ? existing.when_lt
          : parsed.data.when_lt,
      device_id:
        parsed.data.device_id === undefined
          ? existing.device_id
          : parsed.data.device_id,
      device_ids:
        parsed.data.device_ids === undefined
          ? existing.device_ids
          : parsed.data.device_ids,
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
        devices: z.array(z.string().min(1).max(64)).optional(),
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
        parsed.data.devices,
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
