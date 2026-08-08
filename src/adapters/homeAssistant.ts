import { v4 as uuid } from "uuid";
import WebSocket from "ws";
import { query, type HaConfigRow, type HaEntityRow } from "../db/index.js";
import { decryptSecret, encryptSecret } from "../db/crypto.js";
import { upsertFrame } from "../services/channels.js";
import { enqueue } from "../services/queue.js";
import { renderTemplate } from "../services/render.js";

export type HaConfig = {
  baseUrl: string;
  token: string;
};

let ws: WebSocket | null = null;
let msgId = 1;
let reconnectTimer: NodeJS.Timeout | null = null;
let pollTimer: NodeJS.Timeout | null = null;
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
}): Promise<HaEntityRow> {
  const id = input.id ?? uuid();
  const existingRes = await query<HaEntityRow>(
    "SELECT * FROM ha_entities WHERE id = $1 OR entity_id = $2",
    [id, input.entity_id],
  );
  const existing = existingRes.rows[0];

  if (existing) {
    await query(
      `UPDATE ha_entities SET
         entity_id = $1,
         mode = $2,
         template = $3,
         icon = $4,
         channel_id = $5,
         enabled = $6
       WHERE id = $7`,
      [
        input.entity_id,
        input.mode,
        input.template ?? existing.template,
        input.icon ?? existing.icon,
        input.channel_id === undefined ? existing.channel_id : input.channel_id,
        input.enabled === undefined ? existing.enabled : input.enabled,
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
    `INSERT INTO ha_entities (id, entity_id, mode, template, icon, channel_id, enabled)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [
      id,
      input.entity_id,
      input.mode,
      input.template ?? "{{ name }}: {{ state }}{{ unit }}",
      input.icon ?? "a2867",
      input.channel_id ?? null,
      input.enabled !== false,
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

  const text = renderTemplate(mapping.template, {
    state,
    name: String(attributes.friendly_name ?? entityId),
    unit: String(attributes.unit_of_measurement ?? ""),
    entity_id: entityId,
  }).trim();

  if (!text) return;

  if (mapping.mode === "notify") {
    enqueue({
      text,
      icon: mapping.icon,
      priority: "info",
      source: `ha:${entityId}`,
    });
    return;
  }

  if (mapping.channel_id) {
    await upsertFrame(mapping.channel_id, text, mapping.icon);
  }
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
  reconnectTimer = null;
  pollTimer = null;
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
