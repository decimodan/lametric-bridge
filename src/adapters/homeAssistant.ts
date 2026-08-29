import { v4 as uuid } from "uuid";
import WebSocket from "ws";
import { query, type HaConfigRow, type HaEntityRow } from "../db/index.js";
import { decryptSecret, encryptSecret } from "../db/crypto.js";
import { pushAwtrixApp } from "./awtrix.js";
import { getCard } from "../services/cards.js";
import {
  haTemplateVars,
  listEnabledAutomationsForEntity,
  listWatchedAutomationEntityIds,
  markAutomationSent,
  renderCardText,
  resolveAutomationSound,
  shouldFireAutomation,
  touchAutomationValue,
} from "../services/cardAutomations.js";
import { upsertFrame } from "../services/channels.js";
import { getDevice, listDevices, resolveDevices } from "../services/devices.js";
import { enqueue, queueSize } from "../services/queue.js";
import { renderTemplate } from "../services/render.js";

export type HaConfig = {
  baseUrl: string;
  token: string;
};

let ws: WebSocket | null = null;
let msgId = 1;
let reconnectTimer: NodeJS.Timeout | null = null;
let pollTimer: NodeJS.Timeout | null = null;
let intervalTimer: NodeJS.Timeout | null = null;
let running = false;

function nextId(): number {
  msgId += 1;
  return msgId;
}

export async function getHaConfig(): Promise<HaConfig | null> {
  const res = await query<HaConfigRow>("SELECT * FROM ha_config WHERE id = 1");
  const row = res.rows[0];
  if (!row) return null;
  return {
    baseUrl: row.base_url.replace(/\/$/, ""),
    token: decryptSecret(row.token_enc),
  };
}

export async function saveHaConfig(baseUrl: string, token: string): Promise<void> {
  await query(
    `INSERT INTO ha_config (id, base_url, token_enc)
     VALUES (1, $1, $2)
     ON CONFLICT (id) DO UPDATE SET
       base_url = EXCLUDED.base_url,
       token_enc = EXCLUDED.token_enc`,
    [baseUrl.replace(/\/$/, ""), encryptSecret(token)],
  );
}

export async function listHaEntities(): Promise<HaEntityRow[]> {
  const res = await query<HaEntityRow>(
    "SELECT * FROM ha_entities ORDER BY entity_id ASC",
  );
  return res.rows;
}

export async function upsertHaEntity(input: {
  id?: string;
  entity_id: string;
  mode: "notify" | "frame";
  template?: string;
  icon?: string;
  channel_id?: string | null;
  enabled?: boolean;
  priority?: "info" | "warning" | "critical";
  sound?: boolean;
  interval_sec?: number | null;
  min_delta?: number | null;
  when_gt?: number | null;
  when_lt?: number | null;
  device_id?: string | null;
  device_ids?: string[] | null;
}): Promise<HaEntityRow> {
  const id = input.id ?? uuid();
  const existingRes = input.id
    ? await query<HaEntityRow>("SELECT * FROM ha_entities WHERE id = $1", [input.id])
    : { rows: [] as HaEntityRow[] };
  const existing = existingRes.rows[0];

  const priority = input.priority ?? existing?.priority ?? "info";
  const sound = input.sound ?? existing?.sound ?? false;
  const intervalSec =
    input.interval_sec === undefined
      ? (existing?.interval_sec ?? null)
      : input.interval_sec;
  const minDelta =
    input.min_delta === undefined
      ? (existing?.min_delta ?? null)
      : input.min_delta;
  const whenGt =
    input.when_gt === undefined ? (existing?.when_gt ?? null) : input.when_gt;
  const whenLt =
    input.when_lt === undefined ? (existing?.when_lt ?? null) : input.when_lt;
  let deviceId = existing?.device_id ?? null;
  let deviceIds: string[] | null = existing?.device_ids ?? null;

  if (input.device_ids !== undefined && input.device_ids !== null) {
    deviceIds = input.device_ids.length
      ? (
          await Promise.all(
            input.device_ids.map(async (ref) => (await getDevice(ref))?.id),
          )
        ).filter((id): id is string => Boolean(id))
      : null;
    deviceIds = deviceIds?.length ? [...new Set(deviceIds)] : null;
    deviceId = null;
  } else if (input.device_id !== undefined) {
    deviceId = input.device_id
      ? ((await getDevice(input.device_id))?.id ?? null)
      : null;
    deviceIds = null;
  }

  if (existing) {
    await query(
      `UPDATE ha_entities SET
         entity_id = $1,
         mode = $2,
         template = $3,
         icon = $4,
         channel_id = $5,
         enabled = $6,
         priority = $7,
         sound = $8,
         interval_sec = $9,
         min_delta = $10,
         when_gt = $11,
         when_lt = $12,
         device_id = $13,
         device_ids = $14
       WHERE id = $15`,
      [
        input.entity_id,
        input.mode,
        input.template ?? existing.template,
        input.icon ?? existing.icon,
        input.channel_id === undefined ? existing.channel_id : input.channel_id,
        input.enabled === undefined ? existing.enabled : input.enabled,
        priority,
        sound,
        intervalSec,
        minDelta,
        whenGt,
        whenLt,
        deviceId,
        deviceIds,
        existing.id,
      ],
    );
    const res = await query<HaEntityRow>(
      "SELECT * FROM ha_entities WHERE id = $1",
      [existing.id],
    );
    return res.rows[0]!;
  }

  await query(
    `INSERT INTO ha_entities (
       id, entity_id, mode, template, icon, channel_id, enabled,
       priority, sound, interval_sec, min_delta, when_gt, when_lt, device_id, device_ids
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)`,
    [
      id,
      input.entity_id,
      input.mode,
      input.template ?? "{{ name }}: {{ state | round:2 }}{{ unit }}",
      input.icon ?? "a2867",
      input.channel_id ?? null,
      input.enabled !== false,
      priority,
      sound,
      intervalSec,
      minDelta,
      whenGt,
      whenLt,
      deviceId,
      deviceIds,
    ],
  );

  const res = await query<HaEntityRow>(
    "SELECT * FROM ha_entities WHERE id = $1",
    [id],
  );
  return res.rows[0]!;
}

export async function deleteHaEntity(id: string): Promise<boolean> {
  const res = await query("DELETE FROM ha_entities WHERE id = $1", [id]);
  return (res.rowCount ?? 0) > 0;
}

export async function testHaConnection(): Promise<{ ok: boolean; detail: string }> {
  const cfg = await getHaConfig();
  if (!cfg) return { ok: false, detail: "Home Assistant is not configured" };

  try {
    const res = await fetch(`${cfg.baseUrl}/api/`, {
      headers: {
        Authorization: `Bearer ${cfg.token}`,
        "Content-Type": "application/json",
      },
    });
    if (!res.ok) return { ok: false, detail: `HTTP ${res.status}` };
    const body = (await res.json()) as { message?: string };
    return { ok: true, detail: body.message ?? "OK" };
  } catch (err) {
    return {
      ok: false,
      detail: err instanceof Error ? err.message : String(err),
    };
  }
}

export async function fetchHaStates(): Promise<
  Array<{ entity_id: string; state: string; attributes: Record<string, unknown> }>
> {
  const cfg = await getHaConfig();
  if (!cfg) return [];
  const res = await fetch(`${cfg.baseUrl}/api/states`, {
    headers: { Authorization: `Bearer ${cfg.token}` },
  });
  if (!res.ok) throw new Error(`HA states HTTP ${res.status}`);
  return (await res.json()) as Array<{
    entity_id: string;
    state: string;
    attributes: Record<string, unknown>;
  }>;
}

function parseNumericState(value: string): number | null {
  const n = Number(String(value).trim().replace(",", "."));
  return Number.isFinite(n) ? n : null;
}

/** True when state change should trigger notify/frame (min_delta aware). */
export function shouldEmitOnChange(
  mapping: Pick<HaEntityRow, "last_value" | "min_delta">,
  newState: string,
): boolean {
  const prev = mapping.last_value;
  if (prev == null) return true;
  if (prev === newState) return false;

  const threshold = mapping.min_delta;
  if (threshold == null) return true;

  const a = parseNumericState(prev);
  const b = parseNumericState(newState);
  if (a === null || b === null) return true;
  return Math.abs(b - a) >= threshold;
}

/** Absolute thresholds: only emit when value is > when_gt and/or < when_lt. */
export function passesAbsoluteRules(
  mapping: Pick<HaEntityRow, "when_gt" | "when_lt">,
  state: string,
): boolean {
  const hasGt = mapping.when_gt != null;
  const hasLt = mapping.when_lt != null;
  if (!hasGt && !hasLt) return true;

  const n = parseNumericState(state);
  if (n === null) return false;

  if (hasGt && n > Number(mapping.when_gt)) return true;
  if (hasLt && n < Number(mapping.when_lt)) return true;
  return false;
}

function hasAbsoluteRules(
  mapping: Pick<HaEntityRow, "when_gt" | "when_lt">,
): boolean {
  return mapping.when_gt != null || mapping.when_lt != null;
}

/**
 * Change-path gate:
 * - always require a real change (and min_delta when set)
 * - with when_gt/when_lt: fire on edge into the zone; while still inside,
 *   only re-fire if min_delta is set and the delta is met
 */
export function shouldEmitForStateChange(
  mapping: Pick<HaEntityRow, "last_value" | "min_delta" | "when_gt" | "when_lt">,
  newState: string,
): boolean {
  if (!passesAbsoluteRules(mapping, newState)) return false;
  if (!shouldEmitOnChange(mapping, newState)) return false;

  if (!hasAbsoluteRules(mapping)) return true;

  const prev = mapping.last_value;
  if (prev == null) return true;

  const wasInside = passesAbsoluteRules(mapping, prev);
  if (!wasInside) return true; // edge into zone

  // Still inside the zone: only re-alert when min_delta is configured.
  return mapping.min_delta != null;
}

function isIntervalDriven(mapping: Pick<HaEntityRow, "interval_sec">): boolean {
  return mapping.interval_sec != null && Number(mapping.interval_sec) >= 10;
}

export function haEntityEnqueueTargets(
  mapping: Pick<HaEntityRow, "device_id" | "device_ids">,
): { deviceId?: string; deviceIds?: string[] } {
  if (mapping.device_ids?.length) {
    return { deviceIds: mapping.device_ids };
  }
  if (mapping.device_id) {
    return { deviceId: mapping.device_id };
  }
  return {};
}

async function markEntitySent(id: string, value: string): Promise<void> {
  await query(
    `UPDATE ha_entities
     SET last_value = $1, last_sent_at = NOW()
     WHERE id = $2`,
    [value, id],
  );
}

async function emitEntity(
  mapping: HaEntityRow,
  state: string,
  attributes: Record<string, unknown>,
  sourcePrefix: string,
): Promise<boolean> {
  const text = renderTemplate(mapping.template, {
    state,
    name: String(attributes.friendly_name ?? mapping.entity_id),
    unit: String(attributes.unit_of_measurement ?? ""),
    entity_id: mapping.entity_id,
  }).trim();
  if (!text) return false;

  if (mapping.mode === "notify") {
    await enqueue({
      text,
      icon: mapping.icon,
      priority: mapping.priority ?? "info",
      sound: mapping.sound ?? false,
      source: `${sourcePrefix}:${mapping.entity_id}`,
      ...haEntityEnqueueTargets(mapping),
    });
    await markEntitySent(mapping.id, state);
    return true;
  }

  const targets = await resolveDevices(mapping.device_id);
  let sent = false;
  for (const device of targets) {
    if (device.kind === "awtrix") {
      const result = await pushAwtrixApp(
        device,
        `ha-${mapping.entity_id}`,
        text,
        mapping.icon,
      );
      if (result.ok) sent = true;
      else console.error("AWTRIX HA frame error", result.detail);
    } else if (mapping.channel_id) {
      await upsertFrame(mapping.channel_id, text, mapping.icon);
      sent = true;
    }
  }
  if (sent) await markEntitySent(mapping.id, state);
  return sent;
}

async function handleState(
  entityId: string,
  state: string,
  attributes: Record<string, unknown>,
): Promise<void> {
  const res = await query<HaEntityRow>(
    "SELECT * FROM ha_entities WHERE entity_id = $1 AND enabled = TRUE",
    [entityId],
  );
  const mappings = res.rows;

  for (const mapping of mappings) {
    // Notify + interval: cadence is owned by the interval ticker (avoid flood).
    // Frames still update on change so the channel stays fresh.
    if (mapping.mode === "notify" && isIntervalDriven(mapping)) continue;
    if (!shouldEmitForStateChange(mapping, state)) continue;
    await emitEntity(mapping, state, attributes, "ha");
  }

  await handleCardAutomations(entityId, state, attributes);
  await handleSensorCardAlerts(entityId, state, attributes);
}

async function handleSensorCardAlerts(
  entityId: string,
  state: string,
  attributes: Record<string, unknown>,
): Promise<void> {
  const { listAlertSensorCardsForEntity, shouldEmitSensorCardOnChange, isSensorCardIntervalDriven, emitSensorCardAlert } =
    await import("../services/sensorCards.js");
  const cards = await listAlertSensorCardsForEntity(entityId);
  for (const card of cards) {
    if (isSensorCardIntervalDriven(card)) continue;
    if (!shouldEmitSensorCardOnChange(card, state)) continue;
    await emitSensorCardAlert(card, state, attributes, "ha");
  }
}

async function handleCardAutomations(
  entityId: string,
  state: string,
  attributes: Record<string, unknown>,
): Promise<void> {
  const autos = await listEnabledAutomationsForEntity(entityId);
  for (const auto of autos) {
    const fire = shouldFireAutomation(auto, state);
    if (!fire) {
      if (auto.lastValue !== state) {
        await touchAutomationValue(auto.id, state);
      }
      continue;
    }

    const card = await getCard(auto.cardId);
    if (!card) continue;

    const text = renderCardText(
      card,
      haTemplateVars(state, attributes, entityId),
    );
    if (!text) {
      await touchAutomationValue(auto.id, state);
      continue;
    }

    await enqueue({
      text,
      icon: card.icon,
      priority: card.priority,
      sound: resolveAutomationSound(auto, card),
      source: `card-auto:${card.slug}:${entityId}`,
      deviceId: auto.deviceId ?? undefined,
    });
    await markAutomationSent(auto.id, state);
  }
}

async function tickIntervalEntities(): Promise<void> {
  const entities = await query<HaEntityRow>(
    `SELECT * FROM ha_entities
     WHERE enabled = TRUE
       AND interval_sec IS NOT NULL
       AND interval_sec >= 10
       AND (
         last_sent_at IS NULL
         OR last_sent_at <= NOW() - (interval_sec * INTERVAL '1 second')
       )
     ORDER BY entity_id ASC`,
  );

  const {
    listIntervalSensorCards,
    emitSensorCardAlert,
  } = await import("../services/sensorCards.js");
  const sensorCards = await listIntervalSensorCards();

  if (!entities.rows.length && !sensorCards.length) return;

  let states: Array<{
    entity_id: string;
    state: string;
    attributes: Record<string, unknown>;
  }> = [];
  try {
    states = await fetchHaStates();
  } catch (err) {
    console.error("HA interval fetch error", err);
    return;
  }
  const byId = new Map(states.map((s) => [s.entity_id, s]));

  for (const mapping of entities.rows) {
    const s = byId.get(mapping.entity_id);
    if (!s) continue;
    if (!passesAbsoluteRules(mapping, s.state)) continue;
    if (
      mapping.min_delta != null &&
      mapping.last_value != null &&
      !shouldEmitOnChange(mapping, s.state)
    ) {
      continue;
    }
    await emitEntity(mapping, s.state, s.attributes ?? {}, "ha-interval");
  }

  for (const card of sensorCards) {
    const s = byId.get(card.entityId);
    if (!s) continue;
    if (
      card.minDelta != null &&
      card.lastValue != null &&
      card.lastValue === s.state
    ) {
      continue;
    }
    await emitSensorCardAlert(card, s.state, s.attributes ?? {}, "ha-interval");
  }
}

function startIntervalScheduler(): void {
  if (intervalTimer) return;
  intervalTimer = setInterval(() => {
    void tickIntervalEntities().catch((err) =>
      console.error("HA interval tick error", err),
    );
  }, 5_000);
}

/** Render current HA state for a mapped entity and enqueue a notification. */
export async function enqueueHaEntity(
  entityIdOrRowId: string,
  priority: "info" | "warning" | "critical" = "info",
  sound = false,
  targetDevices?: string[] | null,
): Promise<{ ok: boolean; detail: string; text?: string; queue?: number }> {
  const byId = await query<HaEntityRow>(
    "SELECT * FROM ha_entities WHERE id = $1 OR entity_id = $2",
    [entityIdOrRowId, entityIdOrRowId],
  );
  const mapping = byId.rows[0];
  if (!mapping) {
    return { ok: false, detail: "Entity mapping not found" };
  }

  const states = await fetchHaStates();
  const state = states.find((s) => s.entity_id === mapping.entity_id);
  if (!state) {
    return {
      ok: false,
      detail: `State not found in HA for ${mapping.entity_id}`,
    };
  }

  const text = renderTemplate(mapping.template, {
    state: state.state,
    name: String(state.attributes?.friendly_name ?? mapping.entity_id),
    unit: String(state.attributes?.unit_of_measurement ?? ""),
    entity_id: mapping.entity_id,
  }).trim();

  if (!text) {
    return { ok: false, detail: "Rendered template is empty" };
  }

  let deviceId = mapping.device_id ?? undefined;
  let deviceIds: string[] | undefined;
  if (targetDevices !== undefined && targetDevices !== null) {
    if (targetDevices.length === 0) {
      deviceId = undefined;
      deviceIds = undefined;
    } else {
      deviceId = undefined;
      deviceIds = targetDevices;
    }
  } else {
    const targets = haEntityEnqueueTargets(mapping);
    deviceId = targets.deviceId;
    deviceIds = targets.deviceIds;
  }

  await enqueue({
    text,
    icon: mapping.icon,
    priority,
    sound,
    source: `panel:ha:${mapping.entity_id}`,
    deviceId,
    deviceIds,
  });
  await markEntitySent(mapping.id, state.state);

  return {
    ok: true,
    detail: `Queued (${priority})`,
    text,
    queue: queueSize(),
  };
}

export async function previewHaEntities(): Promise<
  Array<{
    id: string;
    entity_id: string;
    mode: string;
    template: string;
    icon: string;
    enabled: boolean;
    priority: string;
    sound: boolean;
    interval_sec: number | null;
    min_delta: number | null;
    when_gt: number | null;
    when_lt: number | null;
    last_value: string | null;
    last_sent_at: string | Date | null;
    device_id: string | null;
    device_ids: string[] | null;
    device_name: string | null;
    state: string | null;
    friendly_name: string | null;
    preview: string | null;
  }>
> {
  const entities = await listHaEntities();
  const devices = await listDevices();
  const deviceById = new Map(devices.map((d) => [d.id, d]));
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
  const byId = new Map(states.map((s) => [s.entity_id, s]));

  return entities.map((ent) => {
    const s = byId.get(ent.entity_id);
    const preview = s
      ? renderTemplate(ent.template, {
          state: s.state,
          name: String(s.attributes?.friendly_name ?? ent.entity_id),
          unit: String(s.attributes?.unit_of_measurement ?? ""),
          entity_id: ent.entity_id,
        }).trim()
      : null;
    const deviceNames =
      ent.device_ids?.length
        ? ent.device_ids
            .map((id) => deviceById.get(id)?.name ?? id)
            .join(", ")
        : ent.device_id
          ? (deviceById.get(ent.device_id)?.name ?? ent.device_id)
          : "todos";
    return {
      id: ent.id,
      entity_id: ent.entity_id,
      mode: ent.mode,
      template: ent.template,
      icon: ent.icon,
      enabled: ent.enabled,
      priority: ent.priority ?? "info",
      sound: Boolean(ent.sound),
      interval_sec: ent.interval_sec,
      min_delta: ent.min_delta,
      when_gt: ent.when_gt,
      when_lt: ent.when_lt,
      last_value: ent.last_value,
      last_sent_at: ent.last_sent_at,
      device_id: ent.device_id,
      device_ids: ent.device_ids ?? null,
      device_name: deviceNames,
      state: s?.state ?? null,
      friendly_name: s
        ? String(s.attributes?.friendly_name ?? "") || null
        : null,
      preview,
    };
  });
}

function scheduleReconnect(): void {
  if (!running) return;
  if (reconnectTimer) return;
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    void connectWs();
  }, 5000);
}

function stopPollingFallback(): void {
  if (!pollTimer) return;
  clearInterval(pollTimer);
  pollTimer = null;
}

function startPollingFallback(): void {
  if (pollTimer) return;
  pollTimer = setInterval(() => {
    void (async () => {
      try {
        const states = await fetchHaStates();
        const watched = new Set(
          (await listHaEntities()).map((e) => e.entity_id),
        );
        for (const id of await listWatchedAutomationEntityIds()) {
          watched.add(id);
        }
        for (const s of states) {
          if (watched.has(s.entity_id)) {
            await handleState(s.entity_id, s.state, s.attributes ?? {});
          }
        }
      } catch (err) {
        console.error("HA poll error", err);
      }
    })();
  }, 30_000);
}

async function connectWs(): Promise<void> {
  const cfg = await getHaConfig();
  if (!cfg || !running) return;

  if (ws) {
    try {
      ws.close();
    } catch {
      /* ignore */
    }
    ws = null;
  }

  const wsUrl = cfg.baseUrl
    .replace(/^http:/, "ws:")
    .replace(/^https:/, "wss:")
    .replace(/\/$/, "");

  try {
    ws = new WebSocket(`${wsUrl}/api/websocket`);
  } catch (err) {
    console.error("HA WS create failed", err);
    startPollingFallback();
    scheduleReconnect();
    return;
  }

  ws.on("open", () => {
    console.log("HA WebSocket connected");
  });

  ws.on("message", (raw) => {
    void (async () => {
      try {
        const data = JSON.parse(String(raw)) as {
          type: string;
          event?: {
            event_type?: string;
            data?: {
              entity_id?: string;
              new_state?: {
                state?: string;
                attributes?: Record<string, unknown>;
              };
            };
          };
        };

        if (data.type === "auth_required") {
          ws?.send(JSON.stringify({ type: "auth", access_token: cfg.token }));
          return;
        }

        if (data.type === "auth_ok") {
          stopPollingFallback();
          ws?.send(
            JSON.stringify({
              id: nextId(),
              type: "subscribe_events",
              event_type: "state_changed",
            }),
          );
          return;
        }

        if (data.type === "auth_invalid") {
          console.error("HA auth invalid");
          startPollingFallback();
          return;
        }

        if (
          data.type === "event" &&
          data.event?.event_type === "state_changed"
        ) {
          const entityId = data.event.data?.entity_id;
          const newState = data.event.data?.new_state;
          if (entityId && newState?.state !== undefined) {
            await handleState(entityId, newState.state, newState.attributes ?? {});
          }
        }
      } catch (err) {
        console.error("HA WS message error", err);
      }
    })();
  });

  ws.on("close", () => {
    console.warn("HA WebSocket closed");
    startPollingFallback();
    scheduleReconnect();
  });

  ws.on("error", (err) => {
    console.error("HA WebSocket error", err);
    startPollingFallback();
  });
}

export function startHomeAssistant(): void {
  running = true;
  startIntervalScheduler();
  void (async () => {
    const cfg = await getHaConfig();
    if (!cfg) {
      console.log("HA not configured; adapter idle");
      return;
    }
    await connectWs();
  })();
}

export function restartHomeAssistant(): void {
  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }
  if (pollTimer) {
    clearInterval(pollTimer);
    pollTimer = null;
  }
  startHomeAssistant();
}

export function stopHomeAssistant(): void {
  running = false;
  if (reconnectTimer) clearTimeout(reconnectTimer);
  if (pollTimer) clearInterval(pollTimer);
  if (intervalTimer) clearInterval(intervalTimer);
  reconnectTimer = null;
  pollTimer = null;
  intervalTimer = null;
  ws?.close();
  ws = null;
}

export async function haStatus(): Promise<{
  configured: boolean;
  connected: boolean;
}> {
  return {
    configured: Boolean(await getHaConfig()),
    connected: ws?.readyState === WebSocket.OPEN,
  };
}

type HaRegistryDevice = {
  id: string;
  name: string | null;
  name_by_user: string | null;
  manufacturer: string | null;
  model: string | null;
  area_id: string | null;
};

type HaRegistryEntity = {
  entity_id: string;
  device_id: string | null;
  name: string | null;
  original_name: string | null;
  platform: string | null;
  disabled_by: string | null;
  hidden_by: string | null;
};

async function haWsRequest<T>(type: string): Promise<T> {
  const cfg = await getHaConfig();
  if (!cfg) throw new Error("Home Assistant is not configured");

  const wsUrl = cfg.baseUrl
    .replace(/^http:/, "ws:")
    .replace(/^https:/, "wss:")
    .replace(/\/$/, "");

  return new Promise<T>((resolve, reject) => {
    let settled = false;
    let reqId = 0;
    const sock = new WebSocket(`${wsUrl}/api/websocket`);
    const timer = setTimeout(() => {
      if (!settled) {
        settled = true;
        try {
          sock.close();
        } catch {
          /* ignore */
        }
        reject(new Error("HA WebSocket request timed out"));
      }
    }, 12_000);

    const finish = (err?: Error, value?: T) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try {
        sock.close();
      } catch {
        /* ignore */
      }
      if (err) reject(err);
      else resolve(value as T);
    };

    sock.on("error", (err) => finish(err instanceof Error ? err : new Error(String(err))));
    sock.on("message", (raw) => {
      try {
        const data = JSON.parse(String(raw)) as {
          type: string;
          id?: number;
          success?: boolean;
          result?: T;
          message?: string;
        };
        if (data.type === "auth_required") {
          sock.send(JSON.stringify({ type: "auth", access_token: cfg.token }));
          return;
        }
        if (data.type === "auth_ok") {
          reqId = Date.now() % 1_000_000;
          sock.send(JSON.stringify({ id: reqId, type }));
          return;
        }
        if (data.type === "auth_invalid") {
          finish(new Error("HA auth invalid"));
          return;
        }
        if (data.type === "result" && data.id === reqId) {
          if (data.success === false) {
            finish(new Error(data.message || "HA registry request failed"));
            return;
          }
          finish(undefined, data.result);
        }
      } catch (err) {
        finish(err instanceof Error ? err : new Error(String(err)));
      }
    });
  });
}

export type HaDeviceGroup = {
  id: string;
  name: string;
  manufacturer: string | null;
  model: string | null;
  entities: Array<{
    entity_id: string;
    name: string;
    domain: string;
    state: string | null;
    unit: string | null;
  }>;
};

export async function listHaDeviceGroups(opts?: {
  q?: string;
  domains?: string[];
}): Promise<{ devices: HaDeviceGroup[]; unassigned: HaDeviceGroup }> {
  const [devices, entities, states] = await Promise.all([
    haWsRequest<HaRegistryDevice[]>("config/device_registry/list"),
    haWsRequest<HaRegistryEntity[]>("config/entity_registry/list"),
    fetchHaStates().catch(() => [] as Awaited<ReturnType<typeof fetchHaStates>>),
  ]);

  const stateById = new Map(states.map((s) => [s.entity_id, s]));
  const domains = opts?.domains?.length
    ? new Set(opts.domains.map((d) => d.toLowerCase()))
    : null;
  const q = opts?.q?.trim().toLowerCase() || "";

  const byDevice = new Map<string, HaDeviceGroup["entities"]>();
  const unassignedEntities: HaDeviceGroup["entities"] = [];

  for (const ent of entities) {
    if (ent.disabled_by || ent.hidden_by) continue;
    const domain = ent.entity_id.split(".")[0] || "";
    if (domains && !domains.has(domain)) continue;

    const state = stateById.get(ent.entity_id);
    const name =
      ent.name ||
      ent.original_name ||
      String(state?.attributes?.friendly_name ?? "") ||
      ent.entity_id;
    const item = {
      entity_id: ent.entity_id,
      name,
      domain,
      state: state?.state ?? null,
      unit: state
        ? String(state.attributes?.unit_of_measurement ?? "") || null
        : null,
    };

    if (!ent.device_id) {
      unassignedEntities.push(item);
      continue;
    }
    const list = byDevice.get(ent.device_id) ?? [];
    list.push(item);
    byDevice.set(ent.device_id, list);
  }

  const deviceGroups: HaDeviceGroup[] = [];
  for (const device of devices) {
    const ents = byDevice.get(device.id);
    if (!ents?.length) continue;
    const name =
      device.name_by_user ||
      device.name ||
      [device.manufacturer, device.model].filter(Boolean).join(" ") ||
      device.id;
    if (q) {
      const deviceHay =
        `${name} ${device.manufacturer ?? ""} ${device.model ?? ""}`.toLowerCase();
      const entityMatch = ents.some((e) =>
        `${e.entity_id} ${e.name}`.toLowerCase().includes(q),
      );
      if (!deviceHay.includes(q) && !entityMatch) continue;
    }
    ents.sort((a, b) => a.name.localeCompare(b.name, "es"));
    deviceGroups.push({
      id: device.id,
      name,
      manufacturer: device.manufacturer,
      model: device.model,
      entities: ents,
    });
  }

  deviceGroups.sort((a, b) => a.name.localeCompare(b.name, "es"));
  unassignedEntities.sort((a, b) => a.name.localeCompare(b.name, "es"));

  let unassignedFiltered = unassignedEntities;
  if (q) {
    unassignedFiltered = unassignedEntities.filter((e) =>
      `${e.entity_id} ${e.name}`.toLowerCase().includes(q),
    );
  }

  return {
    devices: deviceGroups,
    unassigned: {
      id: "__unassigned__",
      name: "Sin equipo",
      manufacturer: null,
      model: null,
      entities: unassignedFiltered,
    },
  };
}
