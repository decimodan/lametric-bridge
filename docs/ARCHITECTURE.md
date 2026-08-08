# Architecture

## Role

`lametric-bridge` is a LAN service that sits between local applications / Home Assistant and a single LaMetric Time device.

- Apps push notifications and persistent frames via REST + API key.
- Home Assistant state changes map to notifications or frames.
- The bridge pushes notifications to the LaMetric local API and exposes `/lametric/frames` for an Indicator App.

## Stack

- Node.js 20+ / TypeScript
- Fastify HTTP server
- PostgreSQL via `DATABASE_URL` (SQL migrations in `migrations/`)
- Web panel with basic auth (`PANEL_USER` / `PANEL_PASSWORD`)

## Runtime layout

```
src/
  index.ts
  config.ts
  db/                 # schema + secret helpers
  api/                # ingest + health + indicator frames
  panel/              # config UI + panel API
  adapters/           # LaMetric + Home Assistant
  services/           # apps, channels, queue, render
```

## Data flow

1. Ingest (`POST /api/v1/notify` or HA WebSocket event)
2. Normalize to `Message`
3. Priority queue with rate limiting
4. LaMetric local notification API (`https://device:4343`)

Persistent channels write into `frames` and are served from `GET /lametric/frames`.

## Security

- App API keys stored as SHA-256 hashes; plaintext shown once at creation.
- HA token and LaMetric API key encrypted at rest with `CONFIG_SECRET`.
- Panel protected with HTTP basic auth.
- Intended for private LAN / Dokploy internal network only.

## Deploy (Dokploy)

Build from `Dockerfile`. Point `DATABASE_URL` at your existing Postgres (create an empty DB, e.g. `lametric_bridge`). Migrations run automatically on boot.

Required environment variables:

- `DATABASE_URL` — e.g. `postgres://user:pass@host:5432/lametric_bridge`
- `PANEL_USER`
- `PANEL_PASSWORD`
- `CONFIG_SECRET`
- `PORT` (default `3000`)

Healthcheck: `GET /api/v1/health`
