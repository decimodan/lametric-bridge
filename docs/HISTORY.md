# History

# Decisions made

## 2026-08-24 — Panel UI: modular widget style

- Refactored the web panel to a modular card/widget layout inspired by premium watch/dashboard UIs.
- Light neutral canvas with mixed white / charcoal / coral cards, large radii, lime accent for primary actions and live status.
- Status overview widgets on the LaMetric tab (device, HA, queue, apps/channels); forms grouped into interactive cards.

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
