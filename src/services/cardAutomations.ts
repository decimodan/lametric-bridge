import { v4 as uuid } from "uuid";
import { query } from "../db/index.js";
import { getDevice } from "./devices.js";
import { getCard, type AlertCard } from "./cards.js";
import { enqueue } from "./queue.js";
import { renderTemplate, type Priority } from "./render.js";
import { getSensorCard, type SensorCard } from "./sensorCards.js";
import { normalizeSoundId } from "./sounds.js";

export type AutomationSource = "ha" | "connection" | "sensor";
export type AutomationTrigger = "change" | "equals" | "gt" | "lt";

export type CardAutomation = {
  id: string;
  name: string;
  source: AutomationSource;
  cardId: string;
  entityId: string | null;
  sensorCardId: string | null;
  appName: string | null;
  eventName: string | null;
  deviceId: string | null;
  enabled: boolean;
  /** null = inherit from card; true/false = force on/off (mute). */
  sound: boolean | null;
  /** Override LaMetric sound id; null = inherit from card when sounding. */
  soundId: string | null;
  trigger: AutomationTrigger;
  triggerValue: string | null;
  lastValue: string | null;
  lastSentAt: string | Date | null;
  createdAt: string | Date;
};

type CardAutomationRow = {
  id: string;
  name: string;
  source: AutomationSource;
  card_id: string;
  entity_id: string | null;
  sensor_card_id: string | null;
  app_name: string | null;
  event_name: string | null;
  device_id: string | null;
  enabled: boolean;
  sound: boolean | null;
  sound_id: string | null;
  trigger: AutomationTrigger;
  trigger_value: string | null;
  last_value: string | null;
  last_sent_at: string | Date | null;
  created_at: string | Date;
};

/** Catalog shown in panel as "Conexiones". */
export const CONNECTION_CATALOG = [
  {
    id: "sentinel",
    name: "Sentinel",
    events: [
      { id: "torrent.added", label: "Nueva tarea" },
      { id: "torrent.completed", label: "Descarga terminada" },
      { id: "torrent.removed", label: "Tarea eliminada" },
      { id: "copy.done", label: "Copia terminada" },
    ],
  },
  {
    id: "frigate",
    name: "Frigate",
    events: [
      { id: "detection", label: "Cualquier detección" },
      { id: "person", label: "Persona" },
      { id: "car", label: "Auto" },
      { id: "dog", label: "Perro" },
      { id: "cat", label: "Gato" },
      { id: "package", label: "Paquete" },
    ],
  },
] as const;

/** Friendly Spanish labels for common Frigate objects. */
export const FRIGATE_LABEL_ES: Record<string, string> = {
  person: "Persona",
  car: "Auto",
  truck: "Camion",
  bus: "Colectivo",
  motorcycle: "Moto",
  bicycle: "Bici",
  dog: "Perro",
  cat: "Gato",
  bird: "Ave",
  package: "Paquete",
};

function toAutomation(row: CardAutomationRow): CardAutomation {
  return {
    id: row.id,
    name: row.name,
    source: row.source ?? "ha",
    cardId: row.card_id,
    entityId: row.entity_id,
    sensorCardId: row.sensor_card_id,
    appName: row.app_name,
    eventName: row.event_name,
    deviceId: row.device_id,
    enabled: row.enabled,
    sound: row.sound ?? null,
    soundId: row.sound_id ?? null,
    trigger: row.trigger,
    triggerValue: row.trigger_value,
    lastValue: row.last_value,
    lastSentAt: row.last_sent_at,
    createdAt: row.created_at,
  };
}

/** Resolve effective sound: automation override wins, else card default. */
export function resolveAutomationSound(
  auto: Pick<CardAutomation, "sound" | "soundId">,
  card: Pick<AlertCard, "sound" | "soundId">,
): boolean | string {
  const enabled =
    auto.sound === null || auto.sound === undefined ? card.sound : auto.sound;
  if (!enabled) return false;
  return auto.soundId?.trim() || card.soundId?.trim() || true;
}

export function publicAutomation(
  auto: CardAutomation,
  extras?: {
    card?: AlertCard | null;
    deviceName?: string | null;
    deviceSlug?: string | null;
    sensorCardTitle?: string | null;
    sensorCardEntityId?: string | null;
    sensorCardAlertSummary?: string | null;
  },
) {
  const soundEffective = extras?.card
    ? resolveAutomationSound(auto, extras.card)
    : auto.sound;
  return {
    id: auto.id,
    name: auto.name,
    source: auto.source,
    cardId: auto.cardId,
    entityId: auto.entityId,
    sensorCardId: auto.sensorCardId,
    appName: auto.appName,
    eventName: auto.eventName,
    deviceId: auto.deviceId,
    enabled: auto.enabled,
    sound: auto.sound,
    soundId: auto.soundId,
    soundEffective: Boolean(soundEffective),
    soundEffectiveId:
      typeof soundEffective === "string" ? soundEffective : null,
    trigger: auto.trigger,
    triggerValue: auto.triggerValue,
    lastValue: auto.lastValue,
    lastSentAt: auto.lastSentAt,
    createdAt: auto.createdAt,
    cardSlug: extras?.card?.slug ?? null,
    cardName: extras?.card?.name ?? null,
    cardText: extras?.card?.text ?? null,
    cardIcon: extras?.card?.icon ?? null,
    cardPriority: extras?.card?.priority ?? null,
    deviceName: extras?.deviceName ?? null,
    deviceSlug: extras?.deviceSlug ?? null,
    sensorCardTitle: extras?.sensorCardTitle ?? null,
    sensorCardEntityId: extras?.sensorCardEntityId ?? null,
    sensorCardAlertSummary: extras?.sensorCardAlertSummary ?? null,
  };
}

export async function listAutomations(): Promise<CardAutomation[]> {
  const res = await query<CardAutomationRow>(
    `SELECT * FROM card_automations
     ORDER BY created_at DESC`,
  );
  return res.rows.map(toAutomation);
}

export async function listEnabledAutomationsForEntity(
  entityId: string,
): Promise<CardAutomation[]> {
  const res = await query<CardAutomationRow>(
    `SELECT * FROM card_automations
     WHERE enabled = TRUE
       AND source = 'ha'
       AND entity_id = $1`,
    [entityId],
  );
  return res.rows.map(toAutomation);
}

export async function listEnabledSensorAutomations(
  sensorCardId: string,
): Promise<CardAutomation[]> {
  const res = await query<CardAutomationRow>(
    `SELECT * FROM card_automations
     WHERE enabled = TRUE
       AND source = 'sensor'
       AND sensor_card_id = $1`,
    [sensorCardId],
  );
  return res.rows.map(toAutomation);
}

export async function listEnabledConnectionAutomations(
  appName: string,
  eventName: string,
): Promise<CardAutomation[]> {
  const res = await query<CardAutomationRow>(
    `SELECT * FROM card_automations
     WHERE enabled = TRUE
       AND source = 'connection'
       AND lower(app_name) = lower($1)
       AND event_name = $2`,
    [appName, eventName],
  );
  return res.rows.map(toAutomation);
}

export async function listWatchedAutomationEntityIds(): Promise<string[]> {
  const res = await query<{ entity_id: string }>(
    `SELECT DISTINCT entity_id FROM card_automations
     WHERE enabled = TRUE AND source = 'ha' AND entity_id IS NOT NULL`,
  );
  return res.rows.map((r) => r.entity_id);
}

export async function getAutomation(id: string): Promise<CardAutomation | null> {
  const res = await query<CardAutomationRow>(
    "SELECT * FROM card_automations WHERE id = $1",
    [id],
  );
  return res.rows[0] ? toAutomation(res.rows[0]) : null;
}

export async function saveAutomation(input: {
  id?: string;
  name?: string;
  source?: AutomationSource;
  cardId: string;
  entityId?: string | null;
  sensorCardId?: string | null;
  appName?: string | null;
  eventName?: string | null;
  deviceId?: string | null;
  enabled?: boolean;
  /** null = inherit from card; true/false = force. Pass undefined to keep existing. */
  sound?: boolean | null;
  soundId?: string | null;
  trigger?: AutomationTrigger;
  triggerValue?: string | null;
}): Promise<CardAutomation> {
  const card = await getCard(input.cardId);
  if (!card) throw new Error("Card not found");

  const existing = input.id ? await getAutomation(input.id) : null;
  if (input.id && !existing) throw new Error("Automation not found");

  const source = input.source ?? existing?.source ?? "ha";

  let entityId: string | null = null;
  let sensorCardId: string | null = null;
  let appName: string | null = null;
  let eventName: string | null = null;
  let trigger: AutomationTrigger = "change";
  let triggerValue: string | null = null;

  if (source === "ha") {
    entityId = (input.entityId ?? existing?.entityId ?? "").trim() || null;
    if (!entityId) throw new Error("entity_id required for HA rules");
    trigger = input.trigger ?? existing?.trigger ?? "change";
    if (!["change", "equals", "gt", "lt"].includes(trigger)) {
      throw new Error("Invalid trigger");
    }
    triggerValue =
      input.triggerValue === undefined
        ? (existing?.triggerValue ?? null)
        : input.triggerValue?.trim() || null;
    if (trigger !== "change" && (triggerValue == null || triggerValue === "")) {
      throw new Error("trigger_value required for equals/gt/lt");
    }
    if (trigger === "change") triggerValue = null;
  } else if (source === "sensor") {
    sensorCardId =
      (input.sensorCardId ?? existing?.sensorCardId ?? "").trim() || null;
    if (!sensorCardId) throw new Error("sensor_card_id required for sensor rules");
    const sensorCard = await getSensorCard(sensorCardId);
    if (!sensorCard) throw new Error("Sensor card not found");
    entityId = sensorCard.entityId;
    trigger = "change";
    triggerValue = null;
  } else {
    appName = (input.appName ?? existing?.appName ?? "").trim().toLowerCase() || null;
    eventName = (input.eventName ?? existing?.eventName ?? "").trim() || null;
    if (!appName) throw new Error("app_name required for connection rules");
    if (!eventName) throw new Error("event_name required for connection rules");
    trigger = "change";
    triggerValue = null;
  }

  let deviceId: string | null = null;
  const deviceInput =
    input.deviceId === undefined ? existing?.deviceId : input.deviceId;
  if (deviceInput) {
    const device = await getDevice(deviceInput);
    if (!device) throw new Error("Device not found");
    deviceId = device.id;
  }

  const sound =
    input.sound === undefined ? (existing?.sound ?? null) : input.sound;
  const soundId =
    input.soundId === undefined
      ? (existing?.soundId ?? null)
      : normalizeSoundId(input.soundId);

  const id = existing?.id ?? uuid();
  const defaultName =
    source === "ha"
      ? `${card.name} ← ${entityId}`
      : source === "sensor"
        ? `${card.name} ← sensor:${sensorCardId?.slice(0, 8)}`
        : `${card.name} ← ${appName}:${eventName}`;
  const name = (input.name ?? existing?.name ?? "").trim() || defaultName;

  await query(
    `INSERT INTO card_automations
       (id, name, source, card_id, entity_id, sensor_card_id, app_name, event_name,
        device_id, enabled, sound, sound_id, trigger, trigger_value)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
     ON CONFLICT (id) DO UPDATE SET
       name = EXCLUDED.name,
       source = EXCLUDED.source,
       card_id = EXCLUDED.card_id,
       entity_id = EXCLUDED.entity_id,
       sensor_card_id = EXCLUDED.sensor_card_id,
       app_name = EXCLUDED.app_name,
       event_name = EXCLUDED.event_name,
       device_id = EXCLUDED.device_id,
       enabled = EXCLUDED.enabled,
       sound = EXCLUDED.sound,
       sound_id = EXCLUDED.sound_id,
       trigger = EXCLUDED.trigger,
       trigger_value = EXCLUDED.trigger_value`,
    [
      id,
      name,
      source,
      card.id,
      entityId,
      sensorCardId,
      appName,
      eventName,
      deviceId,
      input.enabled ?? existing?.enabled ?? true,
      sound,
      sound === false ? null : soundId,
      trigger,
      triggerValue,
    ],
  );

  const saved = await getAutomation(id);
  if (!saved) throw new Error("Failed to save automation");
  return saved;
}

export async function deleteAutomation(id: string): Promise<boolean> {
  const res = await query("DELETE FROM card_automations WHERE id = $1", [id]);
  return (res.rowCount ?? 0) > 0;
}

export async function setAutomationEnabled(
  id: string,
  enabled: boolean,
): Promise<CardAutomation | null> {
  const existing = await getAutomation(id);
  if (!existing) return null;
  await query("UPDATE card_automations SET enabled = $1 WHERE id = $2", [
    enabled,
    id,
  ]);
  return getAutomation(id);
}

function parseNumeric(value: string): number | null {
  const n = Number(String(value).trim().replace(",", "."));
  return Number.isFinite(n) ? n : null;
}

/** Edge-triggered: fire when the condition becomes true. */
export function shouldFireAutomation(
  auto: Pick<CardAutomation, "trigger" | "triggerValue" | "lastValue">,
  newState: string,
): boolean {
  const prev = auto.lastValue;

  if (auto.trigger === "change") {
    if (prev == null) return true;
    return prev !== newState;
  }

  const target = auto.triggerValue ?? "";

  if (auto.trigger === "equals") {
    const nowMatch = newState === target;
    if (!nowMatch) return false;
    if (prev == null) return true;
    return prev !== target;
  }

  const n = parseNumeric(newState);
  const t = parseNumeric(target);
  if (n === null || t === null) return false;

  if (auto.trigger === "gt") {
    const nowInside = n > t;
    if (!nowInside) return false;
    if (prev == null) return true;
    const prevN = parseNumeric(prev);
    if (prevN === null) return true;
    return !(prevN > t);
  }

  const nowInside = n < t;
  if (!nowInside) return false;
  if (prev == null) return true;
  const prevN = parseNumeric(prev);
  if (prevN === null) return true;
  return !(prevN < t);
}

export function renderCardText(
  card: AlertCard,
  vars: Record<string, string>,
): string {
  return renderTemplate(card.text, vars).trim();
}

export function haTemplateVars(
  state: string,
  attributes: Record<string, unknown>,
  entityId: string,
): Record<string, string> {
  return {
    state,
    name: String(attributes.friendly_name ?? entityId),
    unit: String(attributes.unit_of_measurement ?? ""),
    entity_id: entityId,
    text: state,
  };
}

export function connectionTemplateVars(input: {
  event: string;
  app: string;
  text: string;
  hotFree?: string;
  name?: string;
}): Record<string, string> {
  return {
    event: input.event,
    app: input.app,
    text: input.text,
    message: input.text,
    state: input.text,
    hot_free: input.hotFree ?? "",
    name: input.name ?? "",
    unit: "",
    entity_id: `connection.${input.app}.${input.event}`,
  };
}

export function frigateTemplateVars(input: {
  event: string;
  label: string;
  camera: string;
  zones?: string[];
  score?: number | null;
  subLabel?: string;
  text?: string;
}): Record<string, string> {
  const label = (input.label || "object").trim().toLowerCase() || "object";
  const camera = (input.camera || "").trim();
  const zones = (input.zones ?? []).map((z) => String(z).trim()).filter(Boolean);
  const zone = zones[0] ?? "";
  const zonesStr = zones.join(", ");
  const labelEs = FRIGATE_LABEL_ES[label] ?? label;
  const subLabel = (input.subLabel ?? "").trim();
  const place = zone || camera || "camara";
  const text =
    (input.text ?? "").trim() ||
    (subLabel
      ? `${subLabel} en ${place}`
      : `${labelEs} en ${place}`);
  const scorePct =
    input.score != null && Number.isFinite(input.score)
      ? String(Math.round(Math.min(1, Math.max(0, input.score)) * 100))
      : "";

  return {
    ...connectionTemplateVars({
      event: input.event,
      app: "frigate",
      text,
      name: subLabel || camera || labelEs,
    }),
    label,
    label_es: labelEs,
    camera,
    zones: zonesStr,
    zone,
    score: scorePct,
    sub_label: subLabel,
  };
}

export function sensorAutomationTemplateVars(
  sensorCard: Pick<SensorCard, "title" | "entityId">,
  state: string,
  attributes: Record<string, unknown>,
): Record<string, string> {
  return {
    ...haTemplateVars(state, attributes, sensorCard.entityId),
    title: sensorCard.title,
  };
}

/** Enqueue matching sensor-card automations when a sensor card's conditions fire. */
export async function enqueueSensorAutomations(opts: {
  sensorCard: SensorCard;
  state: string;
  attributes: Record<string, unknown>;
}): Promise<number> {
  const autos = await listEnabledSensorAutomations(opts.sensorCard.id);
  let hits = 0;

  for (const auto of autos) {
    const card = await getCard(auto.cardId);
    if (!card) continue;
    const vars = sensorAutomationTemplateVars(
      opts.sensorCard,
      opts.state,
      opts.attributes,
    );
    const rendered = renderCardText(card, vars);
    if (!rendered) continue;
    await enqueue({
      text: rendered,
      icon: card.icon,
      priority: card.priority,
      sound: resolveAutomationSound(auto, card),
      source: `card-auto:sensor:${opts.sensorCard.id}:${card.slug}`,
      deviceId: auto.deviceId ?? undefined,
    });
    await markAutomationSent(auto.id, opts.state);
    hits += 1;
  }

  return hits;
}

/** Enqueue matching connection automations for one or more events (deduped by rule id). */
export async function enqueueConnectionRules(opts: {
  appName: string;
  events: string[];
  vars: Record<string, string>;
  appId?: string;
  deviceId?: string;
  lifetime?: number;
  cycles?: number;
  /** Extra source tag after app:event (e.g. card slug is added per rule). */
}): Promise<number> {
  const seen = new Set<string>();
  let hits = 0;

  for (const event of opts.events) {
    const ev = event.trim();
    if (!ev) continue;
    const autos = await listEnabledConnectionAutomations(opts.appName, ev);
    for (const auto of autos) {
      if (seen.has(auto.id)) continue;
      seen.add(auto.id);
      const card = await getCard(auto.cardId);
      if (!card) continue;
      const vars = { ...opts.vars, event: ev };
      const rendered = renderCardText(card, vars);
      if (!rendered) continue;
      await enqueue({
        text: rendered,
        icon: card.icon,
        priority: card.priority,
        sound: resolveAutomationSound(auto, card),
        lifetime: opts.lifetime,
        cycles: opts.cycles,
        source: `card-auto:${opts.appName}:${ev}:${card.slug}`,
        appId: opts.appId,
        deviceId: auto.deviceId ?? opts.deviceId,
      });
      await markAutomationSent(auto.id, ev);
      hits += 1;
    }
  }

  return hits;
}

export async function markAutomationSent(
  id: string,
  value: string,
): Promise<void> {
  await query(
    `UPDATE card_automations
     SET last_value = $1, last_sent_at = NOW()
     WHERE id = $2`,
    [value, id],
  );
}

export async function touchAutomationValue(
  id: string,
  value: string,
): Promise<void> {
  await query(`UPDATE card_automations SET last_value = $1 WHERE id = $2`, [
    value,
    id,
  ]);
}

export type FiredCardMessage = {
  text: string;
  icon: string;
  priority: Priority;
  sound: boolean | string;
  source: string;
  deviceId?: string;
  automationId: string;
  state: string;
};
