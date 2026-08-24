# Roadmap

## Done

- PRODUCT-00001: Initial infrastructure
- PRODUCT-00002: Core bridge (ingest API, panel, LaMetric notify, frames, Home Assistant, queue)
- PRODUCT-00002: Deployed on Dokploy project `lametric-bridge` (app `lametric-bridge-qqkxjg`, branch `main`, Postgres DB `lametric_bridge`, host `lametric.lan`)
- PRODUCT-00002: Kept LAN-only — Dokploy domain `lametric.lan` (HTTP); router DNS `lametric.lan` → `192.168.50.230`
- PRODUCT-00002: LaMetric device config from `LAMETRIC_DEVICE_IP` / `LAMETRIC_API_KEY` env
- PRODUCT-00003: Dual clocks — named LaMetric + Ulanzi (AWTRIX), HA sensor targeting, brightness from the panel

## Next

- Richer HA automation rules (templates / conditions beyond current thresholds)
- Rotate panel password from default
