# History

# Decisions made

## 2026-08-07 — PRODUCT-00002 architecture

- Single Node/TypeScript Fastify service for ingest, panel, and adapters.
- PostgreSQL via `DATABASE_URL` (shared instance; SQL migrations on boot).
- Apps authenticate with per-app API keys (`X-API-Key`); keys stored hashed.
- LaMetric: push notifications via local API + pollable `/lametric/frames` for persistent channels.
- Home Assistant: WebSocket `state_changed` with REST polling fallback.
- Panel protected with HTTP basic auth; secrets encrypted with `CONFIG_SECRET`.
- Deploy target: Dokploy container on LAN only (no public internet exposure).

## 2026-08-07 — Switch storage to PostgreSQL

- Replaced SQLite with Postgres (`pg` + `DATABASE_URL`) to reuse the existing shared DB instance.
- Schema applied via versioned SQL files in `migrations/` on startup.
