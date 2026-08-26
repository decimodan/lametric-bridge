import { v4 as uuid } from "uuid";
import { query } from "../db/index.js";
import { getDevice } from "./devices.js";
import { getCard, type AlertCard } from "./cards.js";
import { renderTemplate, type Priority } from "./render.js";

export type AutomationSource = "ha" | "connection";
export type AutomationTrigger = "change" | "equals" | "gt" | "lt";

export type CardAutomation = {
  id: string;
  name: string;
  source: AutomationSource;
  cardId: string;
  entityId: string | null;
  appName: string | null;
  eventName: string | null;
  deviceId: string | null;
  enabled: boolean;
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
  app_name: string | null;
  event_name: string | null;
  device_id: string | null;
  enabled: boolean;
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
] as const;

function toAutomation(row: CardAutomationRow): CardAutomation {
  return {
    id: row.id,
    name: row.name,
    source: row.source ?? "ha",
    cardId: row.card_id,
    entityId: row.entity_id,
    appName: row.app_name,
    eventName: row.event_name,
    deviceId: row.device_id,
    enabled: row.enabled,
    trigger: row.trigger,
    triggerValue: row.trigger_value,
    lastValue: row.last_value,
    lastSentAt: row.last_sent_at,
    createdAt: row.created_at,
  };
}

export function publicAutomation(
  auto: CardAutomation,
  extras?: {
    card?: AlertCard | null;
    deviceName?: string | null;
    deviceSlug?: string | null;
  },
) {
  return {
    id: auto.id,
    name: auto.name,
    source: auto.source,
    cardId: auto.cardId,
    entityId: auto.entityId,
    appName: auto.appName,
    eventName: auto.eventName,
    deviceId: auto.deviceId,
    enabled: auto.enabled,
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
  appName?: string | null;
  eventName?: string | null;
  deviceId?: string | null;
  enabled?: boolean;
  trigger?: AutomationTrigger;
  triggerValue?: string | null;
}): Promise<CardAutomation> {
  const card = await getCard(input.cardId);
  if (!card) throw new Error("Card not found");

  const existing = input.id ? await getAutomation(input.id) : null;
  if (input.id && !existing) throw new Error("Automation not found");

  const source = input.source ?? existing?.source ?? "ha";

  let entityId: string | null = null;
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

  const id = existing?.id ?? uuid();
  const defaultName =
    source === "ha"
      ? `${card.name} ← ${entityId}`
      : `${card.name} ← ${appName}:${eventName}`;
  const name = (input.name ?? existing?.name ?? "").trim() || defaultName;

  await query(
    `INSERT INTO card_automations
       (id, name, source, card_id, entity_id, app_name, event_name,
        device_id, enabled, trigger, trigger_value)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
     ON CONFLICT (id) DO UPDATE SET
       name = EXCLUDED.name,
       source = EXCLUDED.source,
       card_id = EXCLUDED.card_id,
       entity_id = EXCLUDED.entity_id,
       app_name = EXCLUDED.app_name,
       event_name = EXCLUDED.event_name,
       device_id = EXCLUDED.device_id,
       enabled = EXCLUDED.enabled,
       trigger = EXCLUDED.trigger,
       trigger_value = EXCLUDED.trigger_value`,
    [
      id,
      name,
      source,
      card.id,
      entityId,
      appName,
      eventName,
      deviceId,
      input.enabled ?? existing?.enabled ?? true,
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
  sound: boolean;
  source: string;
  deviceId?: string;
  automationId: string;
  state: string;
};
