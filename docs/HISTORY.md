# History

# Decisions made

## 2026-08-24 — Panel UI: neon purple dark theme

- Kept modular card/widget layout; switched palette to black canvas + neon violet (`#A855F7`) accents with soft glow on active controls.

## 2026-08-24 — Panel UI: modular widget style

- Refactored the web panel to a modular card/widget layout (watch/dashboard style).
- Status widgets for clocks, HA, queue, apps/channels; applied on dual-clock panel without changing API behavior.

## 2026-08-24 — Dual clocks (LaMetric + Ulanzi)

- Keep both devices: LaMetric Time (local API) and Ulanzi TC001 (AWTRIX NG).
- Identify clocks by unique `slug` (`lametric`, `ulanzi`) in the panel, HA mappings, and `POST /api/v1/notify` `device` field.
- Env upserts on boot: `LAMETRIC_*` → slug `lametric`; `AWTRIX_BASE_URL` (default `http://192.168.50.98`) → slug `ulanzi`. Docker cannot resolve `*.local` mDNS.
- HA entity mappings can target one clock or all; the same sensor may be mapped more than once.
- Brightness is 0–100% in the panel (LaMetric native; AWTRIX scaled 0–255).

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

## 2026-08-07 — LaMetric device via env

- Prefer `LAMETRIC_DEVICE_IP` + `LAMETRIC_API_KEY` over panel/DB device config when both are set.
- Panel device form becomes read-only in that mode.

- Decided against public subdomain `lametric.guerrerodev.com` (Cloudflare DNS / internet exposure).
- Dokploy Traefik host set to `lametric.lan` with HTTPS off and no Let's Encrypt.
- Asus GT-BE98 DNS: `/etc/hosts` entry `lametric.lan` → `192.168.50.230`, reapplied by `/jffs/lametric-dns.sh` via `cru` every 5 minutes (stock firmware has no Merlin `dnsmasq.conf.add`).
- LAN domain name set to `lan` (`nvram lan_domain=lan`).
