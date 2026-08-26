# Architecture

## Role

`lametric-bridge` is a LAN service that sits between local applications / Home Assistant and one or more pixel clocks (LaMetric Time and AWTRIX / Ulanzi TC001).

- Apps push notifications and persistent frames via REST + API key.
- Home Assistant state changes map to notifications or frames, targeted at a specific clock or all clocks.
- Frigate (and other LAN apps) post detection/events via webhook or `POST /api/v1/frigate`; panel Conexiones rules map them to alert cards.
- The bridge pushes notifications to each clock's local API and exposes `/lametric/frames` for a LaMetric Indicator App.
- Each clock has a unique `slug` (`lametric`, `ulanzi`, …) used in the panel, HA mappings, and `POST /api/v1/notify`.

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
2. Normalize to `Message` (optional `deviceId` / slug; optional `card` expands to text/icon/priority/sound)
3. Priority queue with rate limiting
4. Dispatch to LaMetric (`https://device:4343`) and/or AWTRIX (`http://device/api/v1/notifications`)

Persistent LaMetric channels write into `frames` and are served from `GET /lametric/frames`. HA `frame` mappings on an AWTRIX clock become a pushed app (`PUT /api/v1/apps/pushed/...`). Alert cards (`alert_cards`) are reusable notify templates managed from the panel.

## Security

- App API keys stored as SHA-256 hashes; plaintext shown once at creation.
- HA token and device API keys encrypted at rest with `CONFIG_SECRET`.
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

Optional clocks from env (upserted on boot; host/key are read-only in the panel):

- `LAMETRIC_DEVICE_IP` + `LAMETRIC_API_KEY` → slug `lametric`
- `AWTRIX_BASE_URL` (default `http://192.168.50.98`; optional `AWTRIX_USER` / `AWTRIX_PASS`) → slug `ulanzi`

Healthcheck: `GET /api/v1/health`
