import fs from "node:fs";
import path from "node:path";
import { Pool, type QueryResult, type QueryResultRow } from "pg";
import { config } from "../config.js";

export type AppRow = {
  id: string;
  name: string;
  api_key_hash: string;
  created_at: string | Date;
};

export type LametricDeviceRow = {
  id: number;
  host: string;
  api_key_enc: string;
  last_seen: string | Date | null;
};

export type HaConfigRow = {
  id: number;
  base_url: string;
  token_enc: string;
};

export type HaEntityRow = {
  id: string;
  entity_id: string;
  mode: "notify" | "frame";
  template: string;
  icon: string;
  channel_id: string | null;
  enabled: boolean;
  priority: "info" | "warning" | "critical";
  sound: boolean;
  interval_sec: number | null;
  min_delta: number | null;
  when_gt: number | null;
  when_lt: number | null;
  last_value: string | null;
  last_sent_at: string | Date | null;
};

export type ChannelRow = {
  id: string;
  name: string;
  sort_order: number;
  enabled: boolean;
};

export type FrameRow = {
  id: string;
  channel_id: string;
  text: string;
  icon: string;
  updated_at: string | Date;
};

export type NotifyLogRow = {
  id: number;
  source: string;
  app_id: string | null;
  text: string;
  priority: string;
  status: string;
  detail: string | null;
  created_at: string | Date;
};

let pool: Pool | null = null;

export function getPool(): Pool {
  if (!pool) {
    throw new Error("Database not initialized");
  }
  return pool;
}

export async function query<T extends QueryResultRow = QueryResultRow>(
  text: string,
  params?: unknown[],
): Promise<QueryResult<T>> {
  return getPool().query<T>(text, params);
}

export async function initDb(): Promise<void> {
  pool = new Pool({ connectionString: config.databaseUrl });
  await pool.query("SELECT 1");
  await runMigrations();
}

export async function closeDb(): Promise<void> {
  if (pool) {
    await pool.end();
    pool = null;
  }
}

export function dbDisplay(): string {
  try {
    const u = new URL(config.databaseUrl);
    return `${u.hostname}:${u.port || "5432"}${u.pathname}`;
  } catch {
    return "postgres";
  }
}

async function runMigrations(): Promise<void> {
  await query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      id TEXT PRIMARY KEY,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  const dir = resolveMigrationsDir();
  const files = fs
    .readdirSync(dir)
    .filter((f) => f.endsWith(".sql"))
    .sort();

  for (const file of files) {
    const id = file;
    const existing = await query<{ id: string }>(
      "SELECT id FROM schema_migrations WHERE id = $1",
      [id],
    );
    if (existing.rowCount && existing.rowCount > 0) continue;

    const sql = fs.readFileSync(path.join(dir, file), "utf8");
    const client = await getPool().connect();
    try {
      await client.query("BEGIN");
      await client.query(sql);
      await client.query("INSERT INTO schema_migrations (id) VALUES ($1)", [id]);
      await client.query("COMMIT");
      console.log(`Applied migration ${id}`);
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
    }
  }
}

function resolveMigrationsDir(): string {
  const candidates = [
    config.migrationsDir,
    path.resolve(process.cwd(), "migrations"),
    path.resolve(process.cwd(), "dist", "..", "migrations"),
  ];
  for (const dir of candidates) {
    if (fs.existsSync(dir)) return dir;
  }
  throw new Error(
    `Migrations directory not found. Set MIGRATIONS_DIR (tried: ${candidates.join(", ")})`,
  );
}
