import { v4 as uuid } from "uuid";
import WebSocket from "ws";
import { query, type HaConfigRow, type HaEntityRow } from "../db/index.js";
import { decryptSecret, encryptSecret } from "../db/crypto.js";
import { upsertFrame } from "../services/channels.js";
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
}): Promise<HaEntityRow> {
  const id = input.id ?? uuid();
  const existingRes = await query<HaEntityRow>(
    "SELECT * FROM ha_entities WHERE id = $1 OR entity_id = $2",
    [id, input.entity_id],
  );
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
         min_delta = $10
       WHERE id = $11`,
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
       priority, sound, interval_sec, min_delta
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
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
    enqueue({
      text,
      icon: mapping.icon,
      priority: mapping.priority ?? "info",
      sound: mapping.sound ?? false,
      source: `${sourcePrefix}:${mapping.entity_id}`,
    });
    await markEntitySent(mapping.id, state);
    return true;
  }

  if (mapping.channel_id) {
    await upsertFrame(mapping.channel_id, text, mapping.icon);
    await markEntitySent(mapping.id, state);
    return true;
  }
  return false;
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
  const mapping = res.rows[0];
  if (!mapping) return;
  if (!shouldEmitOnChange(mapping, state)) return;
  await emitEntity(mapping, state, attributes, "ha");
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
  if (!entities.rows.length) return;

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
    await emitEntity(mapping, s.state, s.attributes ?? {}, "ha-interval");
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

  enqueue({
    text,
    icon: mapping.icon,
    priority,
    sound,
    source: `panel:ha:${mapping.entity_id}`,
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
    last_value: string | null;
    last_sent_at: string | Date | null;
    state: string | null;
    friendly_name: string | null;
    preview: string | null;
  }>
> {
  const entities = await listHaEntities();
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
      last_value: ent.last_value,
      last_sent_at: ent.last_sent_at,
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

function startPollingFallback(): void {
  if (pollTimer) return;
  pollTimer = setInterval(() => {
    void (async () => {
      try {
        const states = await fetchHaStates();
        const watched = new Set(
          (await listHaEntities()).map((e) => e.entity_id),
        );
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
