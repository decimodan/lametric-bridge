import { v4 as uuid } from "uuid";
import { query } from "../db/index.js";
import type { Priority } from "./render.js";
import { isValidSlug } from "./devices.js";

export type AlertCard = {
  id: string;
  slug: string;
  name: string;
  text: string;
  icon: string;
  priority: Priority;
  sound: boolean;
  isPreset: boolean;
  sortOrder: number;
  createdAt: string | Date;
};

type AlertCardRow = {
  id: string;
  slug: string;
  name: string;
  text: string;
  icon: string;
  priority: Priority;
  sound: boolean;
  is_preset: boolean;
  sort_order: number;
  created_at: string | Date;
};

function toCard(row: AlertCardRow): AlertCard {
  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    text: row.text,
    icon: row.icon,
    priority: row.priority,
    sound: row.sound,
    isPreset: row.is_preset,
    sortOrder: row.sort_order,
    createdAt: row.created_at,
  };
}

export function publicCard(card: AlertCard) {
  return {
    id: card.id,
    slug: card.slug,
    name: card.name,
    text: card.text,
    icon: card.icon,
    priority: card.priority,
    sound: card.sound,
    isPreset: card.isPreset,
    sortOrder: card.sortOrder,
    createdAt: card.createdAt,
  };
}

export async function listCards(): Promise<AlertCard[]> {
  const res = await query<AlertCardRow>(
    `SELECT * FROM alert_cards
     ORDER BY is_preset DESC, sort_order ASC, name ASC`,
  );
  return res.rows.map(toCard);
}

export async function getCard(idOrSlug: string): Promise<AlertCard | null> {
  const res = await query<AlertCardRow>(
    "SELECT * FROM alert_cards WHERE id = $1 OR slug = $1",
    [idOrSlug],
  );
  return res.rows[0] ? toCard(res.rows[0]) : null;
}

export async function saveCard(input: {
  id?: string;
  slug: string;
  name: string;
  text: string;
  icon?: string;
  priority?: Priority;
  sound?: boolean;
  sortOrder?: number;
}): Promise<AlertCard> {
  const slug = input.slug.trim().toLowerCase();
  if (!isValidSlug(slug)) {
    throw new Error("slug must be lowercase letters, numbers and hyphens");
  }

  const existing = input.id ? await getCard(input.id) : null;
  if (input.id && !existing) {
    throw new Error("Card not found");
  }

  const slugOwner = await getCard(slug);
  if (slugOwner && slugOwner.id !== existing?.id) {
    throw new Error(`slug already exists: ${slug}`);
  }

  const id = existing?.id ?? uuid();
  const isPreset = existing?.isPreset ?? false;

  await query(
    `INSERT INTO alert_cards
       (id, slug, name, text, icon, priority, sound, is_preset, sort_order)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
     ON CONFLICT (id) DO UPDATE SET
       slug = EXCLUDED.slug,
       name = EXCLUDED.name,
       text = EXCLUDED.text,
       icon = EXCLUDED.icon,
       priority = EXCLUDED.priority,
       sound = EXCLUDED.sound,
       sort_order = EXCLUDED.sort_order`,
    [
      id,
      slug,
      input.name.trim(),
      input.text.trim(),
      (input.icon ?? existing?.icon ?? "a2867").trim() || "a2867",
      input.priority ?? existing?.priority ?? "info",
      input.sound ?? existing?.sound ?? false,
      isPreset,
      input.sortOrder ?? existing?.sortOrder ?? 0,
    ],
  );

  const saved = await getCard(id);
  if (!saved) throw new Error("Failed to save card");
  return saved;
}

export async function deleteCard(id: string): Promise<boolean> {
  const existing = await getCard(id);
  if (!existing) return false;
  if (existing.isPreset) {
    throw new Error("Preset cards cannot be deleted");
  }
  const res = await query("DELETE FROM alert_cards WHERE id = $1", [
    existing.id,
  ]);
  return (res.rowCount ?? 0) > 0;
}
