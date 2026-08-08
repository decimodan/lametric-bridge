# Roadmap

## Done

- PRODUCT-00001: Initial infrastructure
- PRODUCT-00002: Core bridge (ingest API, panel, LaMetric notify, frames, Home Assistant, queue)
- PRODUCT-00002: Deployed on Dokploy project `lametric-bridge` (app `lametric-bridge-qqkxjg`, branch `PRODUCT-00002`, Postgres DB `lametric_bridge`, host `lametric-bridge.local`)
- PRODUCT-00002: Kept LAN-only — Dokploy domain `lametric.lan` (HTTP); router DNS `lametric.lan` → `192.168.50.230`
- PRODUCT-00002: LaMetric device config from `LAMETRIC_DEVICE_IP` / `LAMETRIC_API_KEY` env

## Next

- Multi-device LaMetric support
- Richer HA automation rules (conditions / thresholds)
- Rotate panel password from default
