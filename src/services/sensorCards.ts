import { v4 as uuid } from "uuid";
import { query } from "../db/index.js";
import { getDevice } from "./devices.js";
import { enqueue } from "./queue.js";
import { renderTemplate, type Priority } from "./render.js";

export type SensorCardRow = {
  id: string;
  entity_id: string;
  title: string;
  description: string;
  sort_order: number;
  enabled: boolean;
  created_at: string | Date;
  alert_enabled: boolean;
  when_gt: number | null;
  when_lt: number | null;
  min_delta: number | null;
  interval_sec: number | null;
  priority: Priority;
  sound: boolean;
  alert_template: string;
  device_id: string | null;
  device_ids: string[] | null;
  last_value: string | null;
  last_sent_at: string | Date | null;
};

export type SensorCard = {
  id: string;
  entityId: string;
  title: string;
  description: string;
  sortOrder: number;
  enabled: boolean;
  createdAt: string | Date;
  alertEnabled: boolean;
  whenGt: number | null;
  whenLt: number | null;
  minDelta: number | null;
  intervalSec: number | null;
  priority: Priority;
  sound: boolean;
  alertTemplate: string;
  deviceId: string | null;
  deviceIds: string[] | null;
  lastValue: string | null;
  lastSentAt: string | Date | null;
};

export type SensorCardLive = SensorCard & {
  state: string | null;
  unit: string | null;
  domain: string;
  friendlyName: string | null;
  deviceClass: string | null;
  alertSummary: string | null;
};

function toSensorCard(row: SensorCardRow): SensorCard {
  return {
    id: row.id,
    entityId: row.entity_id,
    title: row.title,
    description: row.description,
    sortOrder: row.sort_order,
    enabled: row.enabled,
    createdAt: row.created_at,
    alertEnabled: Boolean(row.alert_enabled),
    whenGt: row.when_gt,
    whenLt: row.when_lt,
    minDelta: row.min_delta,
    intervalSec: row.interval_sec,
    priority: row.priority ?? "warning",
    sound: Boolean(row.sound),
    alertTemplate:
      row.alert_template || "{{ name }}: {{ state }}{{ unit }}",
    deviceId: row.device_id,
    deviceIds: row.device_ids ?? null,
    lastValue: row.last_value,
    lastSentAt: row.last_sent_at,
  };
}

function formatAlertSummary(card: SensorCard): string | null {
  if (!card.alertEnabled) return null;
  const parts: string[] = [];
  if (card.whenGt != null) parts.push(`>${card.whenGt}`);
  if (card.whenLt != null) parts.push(`<${card.whenLt}`);
  if (card.intervalSec != null) {
    parts.push(`cada ${Math.round(card.intervalSec / 60)} min`);
  }
  if (card.minDelta != null) parts.push(`Δ≥${card.minDelta}`);
  if (!parts.length) parts.push("al cambiar");
  parts.push(card.priority);
  if (card.sound) parts.push("sonido");
  return parts.join(" · ");
}

export function publicSensorCard(card: SensorCard) {
  return {
    id: card.id,
    entityId: card.entityId,
    title: card.title,
    description: card.description,
    sortOrder: card.sortOrder,
    enabled: card.enabled,
    alertEnabled: card.alertEnabled,
    whenGt: card.whenGt,
    whenLt: card.whenLt,
    minDelta: card.minDelta,
    intervalSec: card.intervalSec,
    priority: card.priority,
    sound: card.sound,
    alertTemplate: card.alertTemplate,
    deviceId: card.deviceId,
    deviceIds: card.deviceIds,
    alertSummary: formatAlertSummary(card),
  };
}

export async function listSensorCards(enabledOnly = false): Promise<SensorCard[]> {
  const res = await query<SensorCardRow>(
    `SELECT * FROM sensor_cards
     ${enabledOnly ? "WHERE enabled = TRUE" : ""}
     ORDER BY sort_order ASC, created_at ASC`,
  );
  return res.rows.map(toSensorCard);
}

export async function getSensorCard(id: string): Promise<SensorCard | null> {
  const res = await query<SensorCardRow>(
    "SELECT * FROM sensor_cards WHERE id = $1",
    [id],
  );
  return res.rows[0] ? toSensorCard(res.rows[0]) : null;
}

export async function listAlertSensorCardsForEntity(
  entityId: string,
): Promise<SensorCard[]> {
  const res = await query<SensorCardRow>(
    `SELECT * FROM sensor_cards
     WHERE entity_id = $1 AND alert_enabled = TRUE`,
    [entityId],
  );
  return res.rows.map(toSensorCard);
}

/** Sensor cards that should react to HA state (built-in alert and/or sensor automations). */
export async function listActiveSensorCardsForEntity(
  entityId: string,
): Promise<SensorCard[]> {
  const res = await query<SensorCardRow>(
    `SELECT DISTINCT sc.* FROM sensor_cards sc
     LEFT JOIN card_automations ca
       ON ca.sensor_card_id = sc.id
      AND ca.enabled = TRUE
      AND ca.source = 'sensor'
     WHERE sc.entity_id = $1
       AND sc.enabled = TRUE
       AND (sc.alert_enabled = TRUE OR ca.id IS NOT NULL)`,
    [entityId],
  );
  return res.rows.map(toSensorCard);
}

export async function listIntervalSensorCards(): Promise<SensorCard[]> {
  const res = await query<SensorCardRow>(
    `SELECT * FROM sensor_cards
     WHERE alert_enabled = TRUE
       AND interval_sec IS NOT NULL
       AND interval_sec >= 10
       AND (
         last_sent_at IS NULL
         OR last_sent_at <= NOW() - (interval_sec * INTERVAL '1 second')
       )
     ORDER BY title ASC`,
  );
  return res.rows.map(toSensorCard);
}

export async function listActiveIntervalSensorCards(): Promise<SensorCard[]> {
  const res = await query<SensorCardRow>(
    `SELECT DISTINCT sc.* FROM sensor_cards sc
     LEFT JOIN card_automations ca
       ON ca.sensor_card_id = sc.id
      AND ca.enabled = TRUE
      AND ca.source = 'sensor'
     WHERE sc.enabled = TRUE
       AND sc.interval_sec IS NOT NULL
       AND sc.interval_sec >= 10
       AND (sc.alert_enabled = TRUE OR ca.id IS NOT NULL)
       AND (
         sc.last_sent_at IS NULL
         OR sc.last_sent_at <= NOW() - (sc.interval_sec * INTERVAL '1 second')
       )
     ORDER BY sc.title ASC`,
  );
  return res.rows.map(toSensorCard);
}

async function resolveDeviceTargets(input: {
  deviceId?: string | null;
  deviceIds?: string[] | null;
}): Promise<{ deviceId: string | null; deviceIds: string[] | null }> {
  if (input.deviceIds !== undefined && input.deviceIds !== null) {
    if (!input.deviceIds.length) {
      return { deviceId: null, deviceIds: null };
    }
    const ids = (
      await Promise.all(input.deviceIds.map(async (ref) => (await getDevice(ref))?.id))
    ).filter((id): id is string => Boolean(id));
    return {
      deviceId: null,
      deviceIds: ids.length ? [...new Set(ids)] : null,
    };
  }
  if (input.deviceId !== undefined) {
    const id = input.deviceId
      ? ((await getDevice(input.deviceId))?.id ?? null)
      : null;
    return { deviceId: id, deviceIds: null };
  }
  return { deviceId: null, deviceIds: null };
}

export async function saveSensorCard(input: {
  id?: string;
  entityId: string;
  title: string;
  description?: string;
  sortOrder?: number;
  enabled?: boolean;
  alertEnabled?: boolean;
  whenGt?: number | null;
  whenLt?: number | null;
  minDelta?: number | null;
  intervalSec?: number | null;
  priority?: Priority;
  sound?: boolean;
  alertTemplate?: string;
  deviceId?: string | null;
  deviceIds?: string[] | null;
}): Promise<SensorCard> {
  const id = input.id ?? uuid();
  const existing = input.id ? await getSensorCard(input.id) : null;
  const sortOrder =
    input.sortOrder ??
    existing?.sortOrder ??
    Number(
      (
        await query<{ n: string }>(
          "SELECT COUNT(*)::text AS n FROM sensor_cards",
        )
      ).rows[0]?.n ?? 0,
    );

  let deviceId = existing?.deviceId ?? null;
  let deviceIds = existing?.deviceIds ?? null;
  if (input.deviceIds !== undefined) {
    const resolved = await resolveDeviceTargets({ deviceIds: input.deviceIds });
    deviceId = resolved.deviceId;
    deviceIds = resolved.deviceIds;
  } else if (input.deviceId !== undefined) {
    const resolved = await resolveDeviceTargets({ deviceId: input.deviceId });
    deviceId = resolved.deviceId;
    deviceIds = resolved.deviceIds;
  }

  await query(
    `INSERT INTO sensor_cards (
       id, entity_id, title, description, sort_order, enabled,
       alert_enabled, when_gt, when_lt, min_delta, interval_sec,
       priority, sound, alert_template, device_id, device_ids
     ) VALUES (
       $1,$2,$3,$4,$5,$6,
       $7,$8,$9,$10,$11,
       $12,$13,$14,$15,$16
     )
     ON CONFLICT (id) DO UPDATE SET
       entity_id = EXCLUDED.entity_id,
       title = EXCLUDED.title,
       description = EXCLUDED.description,
       sort_order = EXCLUDED.sort_order,
       enabled = EXCLUDED.enabled,
       alert_enabled = EXCLUDED.alert_enabled,
       when_gt = EXCLUDED.when_gt,
       when_lt = EXCLUDED.when_lt,
       min_delta = EXCLUDED.min_delta,
       interval_sec = EXCLUDED.interval_sec,
       priority = EXCLUDED.priority,
       sound = EXCLUDED.sound,
       alert_template = EXCLUDED.alert_template,
       device_id = EXCLUDED.device_id,
       device_ids = EXCLUDED.device_ids`,
    [
      id,
      input.entityId.trim(),
      input.title.trim(),
      (input.description ?? existing?.description ?? "").trim(),
      sortOrder,
      input.enabled ?? existing?.enabled ?? true,
      input.alertEnabled ?? existing?.alertEnabled ?? false,
      input.whenGt !== undefined ? input.whenGt : (existing?.whenGt ?? null),
      input.whenLt !== undefined ? input.whenLt : (existing?.whenLt ?? null),
      input.minDelta !== undefined ? input.minDelta : (existing?.minDelta ?? null),
      input.intervalSec !== undefined
        ? input.intervalSec
        : (existing?.intervalSec ?? null),
      input.priority ?? existing?.priority ?? "warning",
      input.sound ?? existing?.sound ?? false,
      (
        input.alertTemplate ??
        existing?.alertTemplate ??
        "{{ name }}: {{ state }}{{ unit }}"
      ).trim() || "{{ name }}: {{ state }}{{ unit }}",
      deviceId,
      deviceIds,
    ],
  );

  const saved = await getSensorCard(id);
  if (!saved) throw new Error("Failed to save sensor card");
  return saved;
}

export async function deleteSensorCard(id: string): Promise<boolean> {
  const res = await query("DELETE FROM sensor_cards WHERE id = $1", [id]);
  return (res.rowCount ?? 0) > 0;
}

export async function markSensorCardSent(
  id: string,
  value: string,
): Promise<void> {
  await query(
    `UPDATE sensor_cards
     SET last_value = $1, last_sent_at = NOW()
     WHERE id = $2`,
    [value, id],
  );
}

function parseNumericState(value: string): number | null {
  const n = Number(String(value).trim().replace(",", "."));
  return Number.isFinite(n) ? n : null;
}

function passesAbsoluteRules(
  card: Pick<SensorCard, "whenGt" | "whenLt">,
  state: string,
): boolean {
  const hasGt = card.whenGt != null;
  const hasLt = card.whenLt != null;
  if (!hasGt && !hasLt) return true;
  const n = parseNumericState(state);
  if (n === null) return false;
  if (hasGt && n > Number(card.whenGt)) return true;
  if (hasLt && n < Number(card.whenLt)) return true;
  return false;
}

function shouldEmitOnChange(
  card: Pick<SensorCard, "lastValue" | "minDelta">,
  newState: string,
): boolean {
  const prev = card.lastValue;
  if (prev == null) return true;
  if (prev === newState) return false;
  const threshold = card.minDelta;
  if (threshold == null) return true;
  const a = parseNumericState(prev);
  const b = parseNumericState(newState);
  if (a === null || b === null) return true;
  return Math.abs(b - a) >= threshold;
}

export function shouldEmitSensorCardOnChange(
  card: SensorCard,
  newState: string,
): boolean {
  if (!passesAbsoluteRules(card, newState)) return false;
  if (!shouldEmitOnChange(card, newState)) return false;
  if (card.whenGt == null && card.whenLt == null) return true;
  const prev = card.lastValue;
  if (prev == null) return true;
  const wasInside = passesAbsoluteRules(card, prev);
  if (!wasInside) return true;
  return card.minDelta != null;
}

export function isSensorCardIntervalDriven(card: SensorCard): boolean {
  return card.intervalSec != null && Number(card.intervalSec) >= 10;
}

function enqueueTargets(card: SensorCard): {
  deviceId?: string;
  deviceIds?: string[];
} {
  if (card.deviceIds?.length) return { deviceIds: card.deviceIds };
  if (card.deviceId) return { deviceId: card.deviceId };
  return {};
}

export async function emitSensorCardAlert(
  card: SensorCard,
  state: string,
  attributes: Record<string, unknown>,
  sourcePrefix: string,
  markSent = true,
): Promise<boolean> {
  if (!passesAbsoluteRules(card, state)) return false;

  const text = renderTemplate(card.alertTemplate, {
    state,
    name: String(attributes.friendly_name ?? card.title),
    title: card.title,
    unit: String(attributes.unit_of_measurement ?? ""),
    entity_id: card.entityId,
  }).trim();
  if (!text) return false;

  await enqueue({
    text,
    icon: "a2867",
    priority: card.priority,
    sound: card.sound,
    source: `${sourcePrefix}:sensor-card:${card.id}`,
    ...enqueueTargets(card),
  });
  if (markSent) await markSensorCardSent(card.id, state);
  return true;
}

export async function processSensorCardTrigger(
  card: SensorCard,
  state: string,
  attributes: Record<string, unknown>,
  sourcePrefix: string,
): Promise<void> {
  const { enqueueSensorAutomations } = await import("./cardAutomations.js");
  let fired = false;
  if (card.alertEnabled) {
    fired = await emitSensorCardAlert(card, state, attributes, sourcePrefix, false);
  }
  const autoHits = await enqueueSensorAutomations({
    sensorCard: card,
    state,
    attributes,
  });
  if (autoHits > 0) fired = true;
  if (fired) await markSensorCardSent(card.id, state);
}

function deviceClassFromEntity(
  entityId: string,
  attributes: Record<string, unknown>,
): string | null {
  const deviceClass = attributes.device_class;
  if (typeof deviceClass === "string" && deviceClass) return deviceClass;
  const parts = entityId.split(".");
  if (parts.length > 1) {
    const slug = parts[1].split("_")[0];
    if (slug && slug !== parts[1]) return slug;
  }
  return null;
}

export async function listSensorCardsLive(
  states: Array<{
    entity_id: string;
    state: string;
    attributes: Record<string, unknown>;
  }>,
): Promise<SensorCardLive[]> {
  const cards = await listSensorCards(true);
  if (!cards.length) return [];
  const byId = new Map(states.map((s) => [s.entity_id, s]));

  return cards.map((card) => {
    const s = byId.get(card.entityId);
    const domain = card.entityId.split(".")[0] || "sensor";
    return {
      ...card,
      state: s?.state ?? null,
      unit: s
        ? String(s.attributes?.unit_of_measurement ?? "") || null
        : null,
      domain,
      friendlyName: s
        ? String(s.attributes?.friendly_name ?? "") || null
        : null,
      deviceClass: s
        ? deviceClassFromEntity(card.entityId, s.attributes ?? {})
        : null,
      alertSummary: formatAlertSummary(card),
    };
  });
}
