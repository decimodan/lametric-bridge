# Roadmap

## Done

- PRODUCT-00001: Initial infrastructure
- PRODUCT-00002: Core bridge (ingest API, panel, LaMetric notify, frames, Home Assistant, queue)
- PRODUCT-00002: Deployed on Dokploy project `lametric-bridge` (app `lametric-bridge-qqkxjg`, branch `main`, Postgres DB `lametric_bridge`, host `lametric.lan`)
- PRODUCT-00002: Kept LAN-only — Dokploy domain `lametric.lan` (HTTP); router DNS `lametric.lan` → `192.168.50.230`
- PRODUCT-00002: LaMetric device config from `LAMETRIC_DEVICE_IP` / `LAMETRIC_API_KEY` env
- PRODUCT-00003: Dual clocks — named LaMetric + Ulanzi (AWTRIX), HA sensor targeting, brightness from the panel
- PRODUCT-00002: Panel UI modular widget/card style deployed to `lametric.lan`
- PRODUCT-00002: Panel color scheme → dark + neon purple accents
- PRODUCT-00004: App webhook (`POST /api/v1/webhook`) for Sentinel / LAN apps — deployed to `lametric.lan`
- PRODUCT-00005: Alert cards — presets + custom cards in panel, send to any clock slug; `card` field on `/notify` and `/webhook` — deployed to `lametric.lan`
- PRODUCT-00006: Card automations (IFTTT) — HA sensor → card → clock from Alertas tab — deployed to `lametric.lan`
- PRODUCT-00007: Conexiones (Sentinel events) as IFTTT source — nueva tarea / descarga / copia → card + reloj — deployed to `lametric.lan`
- PRODUCT-00009: Frigate detections as Conexiones + configurable alert sounds (on/off + LaMetric sound id) — deployed to `lametric.lan`
- Sensores as IFTTT source — sensor cards (umbrales/intervalo) → alert card + reloj from Automatizaciones tab — deployed to `lametric.lan`
- Home dashboard: three circular clock gauges on Relojes tab (brightness + status at a glance) — deployed to `lametric.lan`
- MAC binding: clocks rediscover IP on LAN when MAC is configured — deployed to `lametric.lan`

## Next

- PRODUCT-00011: Rename product to **Notifications Bridge** (brand-agnostic hub; Hue / Aqara later) — code/docs done, not deployed yet
- Richer HA automation rules (templates / conditions beyond current thresholds)
- Rotate panel password from default
