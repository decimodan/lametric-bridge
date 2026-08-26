import { v4 as uuid } from "uuid";
import { query } from "../db/index.js";
import type { Priority } from "./render.js";
import { isValidSlug } from "./devices.js";
import { normalizeSoundId } from "./sounds.js";

export type AlertCard = {
  id: string;
  slug: string;
  name: string;
  text: string;
  icon: string;
  priority: Priority;
  sound: boolean;
  /** LaMetric sound id when sound is enabled; null = default "notification". */
  soundId: string | null;
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
  sound_id: string | null;
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
    soundId: row.sound_id ?? null,
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
    soundId: card.soundId,
    isPreset: card.isPreset,
    sortOrder: card.sortOrder,
    createdAt: card.createdAt,
  };
}

/** Effective Message.sound for a card (false | true | sound id string). */
export function resolveCardSound(
  card: Pick<AlertCard, "sound" | "soundId">,
  override?: boolean | string,
): boolean | string {
  if (override === false) return false;
  if (typeof override === "string") {
    const id = override.trim();
    return id || true;
  }
  if (override === true) return card.soundId?.trim() || true;
  if (!card.sound) return false;
  return card.soundId?.trim() || true;
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
  soundId?: string | null;
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
  const sound = input.sound ?? existing?.sound ?? false;
  const soundId =
    input.soundId === undefined
      ? (existing?.soundId ?? null)
      : normalizeSoundId(input.soundId);

  await query(
    `INSERT INTO alert_cards
       (id, slug, name, text, icon, priority, sound, sound_id, is_preset, sort_order)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
     ON CONFLICT (id) DO UPDATE SET
       slug = EXCLUDED.slug,
       name = EXCLUDED.name,
       text = EXCLUDED.text,
       icon = EXCLUDED.icon,
       priority = EXCLUDED.priority,
       sound = EXCLUDED.sound,
       sound_id = EXCLUDED.sound_id,
       sort_order = EXCLUDED.sort_order`,
    [
      id,
      slug,
      input.name.trim(),
      input.text.trim(),
      (input.icon ?? existing?.icon ?? "a2867").trim() || "a2867",
      input.priority ?? existing?.priority ?? "info",
      sound,
      sound ? soundId : null,
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
