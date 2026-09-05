# History

# Decisions made

## 2026-09-04 — Product rename to Notifications Bridge (PRODUCT-00011)

- User-facing name is **Notifications Bridge** (`notifications-bridge`): the service is a LAN notifications hub, not a LaMetric-only app. Future outputs include Hue, Aqara, and other brands.
- Renamed panel brand, package name, compose service, health `service` field, and docs. LaMetric remains one output adapter.
- GitHub repo renamed to `decimodan/notifications-bridge` (old URL redirects). Local folder is `notifications-bridge`.
- Left unchanged on purpose (would break deploy or integrations): Postgres DB `lametric_bridge`, host `lametric.lan`, Dokploy project/app names, API key prefix `lb_`, `/lametric/frames`, device kind `lametric`, and `LAMETRIC_*` env vars. Sentinel still reads `LAMETRIC_BRIDGE_*`.

## 2026-09-04 — `lametric.lan` DNS is AdGuard-only

- Stopped publishing `lametric.lan` from the Asus GT-BE98 (`/etc/hosts`, `/jffs/lametric-dns.sh`, router dnsmasq). Dual answers (router + AdGuard) caused resolution problems.
- The name stays on AdGuard Home only (`192.168.50.235`, rewrite → `192.168.50.230`). Dokploy Traefik host is unchanged.
- Homelab: PRODUCT-00085 (`docs/asus-lan-dns.sh` forgets the name so infra cron cannot re-add it).

## 2026-08-25 — Frigate detections + alert audio (PRODUCT-00009)

- Added Frigate to Conexiones catalog (`detection`, `person`, `car`, `dog`, `cat`, `package`).
- New ingest `POST /api/v1/frigate`: accepts native MQTT `frigate/events` JSON or flat `{ label, camera, zones }`.
- Only `type=new` by default (pass `?all=1` for update/end) to avoid spam.
- Template vars: `{{ label_es }}`, `{{ camera }}`, `{{ zone }}`, `{{ score }}`, `{{ sub_label }}`.
- Seeded card `deteccion` (`{{ label_es }} en {{ camera }}`, sound `open_door`).
- Cards and automations: sound on/off + LaMetric sound id (notifications/alarms). Automations can inherit / force / mute and override the sound.
- Card library: **Mudo** send; panel lists sounds via `GET /panel/api/sounds`.
- Bridge stays display-only; Frigate/MQTT/HA own the camera domain.

## 2026-08-25 — Connection automations / Sentinel (PRODUCT-00007)

- Extended IFTTT rules with source **Conexiones** (app + event), starting with Sentinel.
- Webhook matches `app name` + `event`; if rules fire, skips default notify to avoid doubles.
- Template vars: `{{ name }}`, `{{ hot_free }}`, `{{ text }}`, `{{ event }}`.
- Sentinel webhook payload now includes `name` and `hot_free` when available.

## 2026-08-25 — Card automations IFTTT-style (PRODUCT-00006)

- Added `card_automations`: SI entidad HA (cambia / es / > / <) → ENTONCES card → reloj.
- Card text supports `{{ state }}`, `{{ name }}`, `{{ unit }}` when fired from HA.
- Panel **Alertas** section for creating/pausing/testing rules; HA WS + poll watch those entities.

## 2026-08-25 — Alert cards (PRODUCT-00005)

- Added reusable alert cards (DB table `alert_cards`) with seeded presets and user-created cards.
- Panel tab **Alertas**: pick destination clock (any slug, including multiple Ulanzi), one-click send, create/edit/delete custom cards (presets editable, not deletable).
- Ingest: `card` on `POST /api/v1/notify` and `/webhook`; list via `GET /api/v1/cards`.
- Second+ Ulanzi clocks stay panel-managed with unique slugs; env still only upserts `ulanzi` from `AWTRIX_BASE_URL`.

## 2026-08-25 — App webhook for Sentinel

- Added `POST /api/v1/webhook` (API key) as an event-oriented ingest alongside `/notify`.
- Optional `event` tags the notify log source as `app:<name>:<event>`; optional `channel` upserts a frame in the same request.
- Sentinel owns Proxmox/hot-disk domain logic and pushes text to the bridge; the bridge stays display-only.

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
