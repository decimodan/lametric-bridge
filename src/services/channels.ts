import { v4 as uuid } from "uuid";
import { query, type ChannelRow, type FrameRow } from "../db/index.js";
import type { LametricFrame } from "./render.js";

export async function listChannels(): Promise<ChannelRow[]> {
  const res = await query<ChannelRow>(
    "SELECT * FROM channels ORDER BY sort_order ASC, name ASC",
  );
  return res.rows;
}

export async function createChannel(
  name: string,
  sortOrder = 0,
): Promise<ChannelRow> {
  const id = uuid();
  await query(
    "INSERT INTO channels (id, name, sort_order, enabled) VALUES ($1, $2, $3, TRUE)",
    [id, name, sortOrder],
  );
  const res = await query<ChannelRow>("SELECT * FROM channels WHERE id = $1", [
    id,
  ]);
  return res.rows[0]!;
}

export async function updateChannel(
  id: string,
  patch: { name?: string; sort_order?: number; enabled?: boolean },
): Promise<ChannelRow | null> {
  const currentRes = await query<ChannelRow>(
    "SELECT * FROM channels WHERE id = $1",
    [id],
  );
  const current = currentRes.rows[0];
  if (!current) return null;

  await query(
    `UPDATE channels SET
       name = $1,
       sort_order = $2,
       enabled = $3
     WHERE id = $4`,
    [
      patch.name ?? current.name,
      patch.sort_order ?? current.sort_order,
      patch.enabled === undefined ? current.enabled : patch.enabled,
      id,
    ],
  );

  const res = await query<ChannelRow>("SELECT * FROM channels WHERE id = $1", [
    id,
  ]);
  return res.rows[0] ?? null;
}

export async function deleteChannel(id: string): Promise<boolean> {
  const res = await query("DELETE FROM channels WHERE id = $1", [id]);
  return (res.rowCount ?? 0) > 0;
}

export async function upsertFrame(
  channelId: string,
  text: string,
  icon = "a2867",
): Promise<FrameRow> {
  await query(
    `INSERT INTO frames (id, channel_id, text, icon, updated_at)
     VALUES ($1, $2, $3, $4, NOW())
     ON CONFLICT (channel_id) DO UPDATE SET
       text = EXCLUDED.text,
       icon = EXCLUDED.icon,
       updated_at = NOW()`,
    [uuid(), channelId, text, icon],
  );

  const res = await query<FrameRow>(
    "SELECT * FROM frames WHERE channel_id = $1",
    [channelId],
  );
  return res.rows[0]!;
}

export async function getIndicatorFrames(): Promise<{ frames: LametricFrame[] }> {
  const res = await query<{ text: string; icon: string }>(
    `SELECT f.text, f.icon
     FROM frames f
     INNER JOIN channels c ON c.id = f.channel_id
     WHERE c.enabled = TRUE
     ORDER BY c.sort_order ASC, c.name ASC`,
  );

  if (res.rows.length === 0) {
    return { frames: [{ text: "lametric-bridge", icon: "a2867" }] };
  }

  return {
    frames: res.rows.map((r) => ({
      text: r.text.slice(0, 256),
      icon: r.icon || "a2867",
    })),
  };
}
