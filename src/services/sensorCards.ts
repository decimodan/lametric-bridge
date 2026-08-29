import { v4 as uuid } from "uuid";
import { fetchHaStates } from "../adapters/homeAssistant.js";
import { query } from "../db/index.js";

export type SensorCardRow = {
  id: string;
  entity_id: string;
  title: string;
  description: string;
  sort_order: number;
  enabled: boolean;
  created_at: string | Date;
};

export type SensorCard = {
  id: string;
  entityId: string;
  title: string;
  description: string;
  sortOrder: number;
  enabled: boolean;
  createdAt: string | Date;
};

export type SensorCardLive = SensorCard & {
  state: string | null;
  unit: string | null;
  domain: string;
  friendlyName: string | null;
  deviceName: string | null;
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
  };
}

export function publicSensorCard(card: SensorCard) {
  return {
    id: card.id,
    entityId: card.entityId,
    title: card.title,
    description: card.description,
    sortOrder: card.sortOrder,
    enabled: card.enabled,
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

export async function saveSensorCard(input: {
  id?: string;
  entityId: string;
  title: string;
  description?: string;
  sortOrder?: number;
  enabled?: boolean;
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

  await query(
    `INSERT INTO sensor_cards (id, entity_id, title, description, sort_order, enabled)
     VALUES ($1, $2, $3, $4, $5, $6)
     ON CONFLICT (id) DO UPDATE SET
       entity_id = EXCLUDED.entity_id,
       title = EXCLUDED.title,
       description = EXCLUDED.description,
       sort_order = EXCLUDED.sort_order,
       enabled = EXCLUDED.enabled`,
    [
      id,
      input.entityId.trim(),
      input.title.trim(),
      (input.description ?? existing?.description ?? "").trim(),
      sortOrder,
      input.enabled ?? existing?.enabled ?? true,
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

function deviceNameFromEntityId(
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

export async function listSensorCardsLive(): Promise<SensorCardLive[]> {
  const cards = await listSensorCards(true);
  if (!cards.length) return [];

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
      deviceName: s
        ? deviceNameFromEntityId(card.entityId, s.attributes ?? {})
        : null,
    };
  });
}
