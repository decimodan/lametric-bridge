import { v4 as uuid } from "uuid";
import { query, type AppRow } from "../db/index.js";
import { generateApiKey, hashApiKey } from "../db/crypto.js";

export async function listApps(): Promise<Omit<AppRow, "api_key_hash">[]> {
  const res = await query<Omit<AppRow, "api_key_hash">>(
    "SELECT id, name, created_at FROM apps ORDER BY created_at DESC",
  );
  return res.rows;
}

export async function createApp(
  name: string,
): Promise<{ app: Omit<AppRow, "api_key_hash">; apiKey: string }> {
  const id = uuid();
  const apiKey = generateApiKey();
  await query(
    "INSERT INTO apps (id, name, api_key_hash) VALUES ($1, $2, $3)",
    [id, name, hashApiKey(apiKey)],
  );
  const res = await query<Omit<AppRow, "api_key_hash">>(
    "SELECT id, name, created_at FROM apps WHERE id = $1",
    [id],
  );
  return { app: res.rows[0]!, apiKey };
}

export async function deleteApp(id: string): Promise<boolean> {
  const res = await query("DELETE FROM apps WHERE id = $1", [id]);
  return (res.rowCount ?? 0) > 0;
}

export async function findAppByApiKey(
  apiKey: string,
): Promise<Omit<AppRow, "api_key_hash"> | null> {
  const res = await query<Omit<AppRow, "api_key_hash">>(
    "SELECT id, name, created_at FROM apps WHERE api_key_hash = $1",
    [hashApiKey(apiKey)],
  );
  return res.rows[0] ?? null;
}

export async function rotateAppKey(id: string): Promise<string | null> {
  const exists = await query("SELECT id FROM apps WHERE id = $1", [id]);
  if (!exists.rows[0]) return null;
  const apiKey = generateApiKey();
  await query("UPDATE apps SET api_key_hash = $1 WHERE id = $2", [
    hashApiKey(apiKey),
    id,
  ]);
  return apiKey;
}
