import path from "node:path";
import { fileURLToPath } from "node:url";

function env(name: string, fallback?: string): string {
  const value = process.env[name] ?? fallback;
  if (value === undefined || value === "") {
    throw new Error(`Missing required env var: ${name}`);
  }
  return value;
}

const here = path.dirname(fileURLToPath(import.meta.url));

export const config = {
  port: Number(process.env.PORT ?? "3000"),
  databaseUrl: env("DATABASE_URL"),
  panelUser: env("PANEL_USER", "admin"),
  panelPassword: env("PANEL_PASSWORD", "changeme"),
  configSecret: env("CONFIG_SECRET", "dev-only-secret-change-me"),
  /** When both are set, the LaMetric clock is upserted as slug `lametric`. */
  lametricDeviceIp: process.env.LAMETRIC_DEVICE_IP?.trim() || "",
  lametricApiKey: process.env.LAMETRIC_API_KEY?.trim() || "",
  /** AWTRIX / Ulanzi TC001. Upserted as slug `ulanzi` when set. */
  awtrixBaseUrl:
    process.env.AWTRIX_BASE_URL?.trim() || "http://192.168.50.98",
  awtrixUser: process.env.AWTRIX_USER?.trim() || "",
  awtrixPass: process.env.AWTRIX_PASS?.trim() || "",
  rateLimitPerMinute: Number(process.env.RATE_LIMIT_PER_MINUTE ?? "60"),
  queueIntervalMs: Number(process.env.QUEUE_INTERVAL_MS ?? "400"),
  migrationsDir: path.resolve(
    process.env.MIGRATIONS_DIR ?? path.join(here, "..", "..", "migrations"),
  ),
};

export function lametricFromEnv(): boolean {
  return Boolean(config.lametricDeviceIp && config.lametricApiKey);
}
