# Integration guide

Base URL example: `http://lametric-bridge:3000`

## Authenticate

Create an app in the panel. Send the key on every ingest request:

```http
X-API-Key: lb_...
```

## Send a notification

```bash
curl -X POST "$BRIDGE/api/v1/notify" \
  -H "Content-Type: application/json" \
  -H "X-API-Key: $API_KEY" \
  -d '{
    "text": "Build failed",
    "icon": "a2867",
    "priority": "warning",
    "sound": true
  }'
```

Response: `202 Accepted` with `{ "accepted": true, "queue": N }`.

Fields:

| Field | Type | Notes |
| --- | --- | --- |
| `text` | string | required, max 256 |
| `icon` | string | LaMetric icon id |
| `priority` | `info` \| `warning` \| `critical` | queue ordering |
| `sound` | boolean \| string | optional sound id |
| `lifetime` | number | ms |
| `cycles` | number | display cycles |

## Update a persistent frame

By channel name (creates channel if missing):

```bash
curl -X POST "$BRIDGE/api/v1/frames" \
  -H "Content-Type: application/json" \
  -H "X-API-Key: $API_KEY" \
  -d '{"channel":"weather","text":"22C clear","icon":"a2109"}'
```

By channel id:

```bash
curl -X PUT "$BRIDGE/api/v1/sources/<channel-id>" \
  -H "Content-Type: application/json" \
  -H "X-API-Key: $API_KEY" \
  -d '{"text":"ok","icon":"a2867"}'
```

## LaMetric Indicator App

Point a custom Indicator / polling app on the clock to:

```text
GET http://<bridge-host>:3000/lametric/frames
```

No API key required (LAN only). Response shape:

```json
{
  "frames": [
    { "text": "22C clear", "icon": "a2109" }
  ]
}
```

## Home Assistant

1. Create a long-lived access token in HA.
2. In the panel, set HA URL + token.
3. Add entities:
   - `notify` — enqueue a LaMetric notification on state change
   - `frame` — update a channel frame continuously
4. Templates support `{{ state }}`, `{{ name }}`, `{{ unit }}`, `{{ entity_id }}`.
   Filters: `{{ state | round:2 }}`, `{{ state | fixed:2 }}`, `{{ state | int }}`.
   Edit templates anytime in the panel (Home Assistant → entity card → Guardar texto).
5. Optional automation per entity:
   - `interval_sec` — for `notify`, owns the cadence (no per-change enqueue; min 10s). Frames still update on change.
   - `min_delta` — only emit on change when `|new - last| >= delta` (numeric)
   - `when_gt` / `when_lt` — emit when numeric state is `> X` and/or `< Y` (edge into zone; re-alert while inside only if `min_delta` is set)
   - `priority` / `sound` — used when notifying the LaMetric

## Health

```bash
curl "$BRIDGE/api/v1/health"
```
