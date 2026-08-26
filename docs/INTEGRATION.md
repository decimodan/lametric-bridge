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
| `text` | string | required unless `card` is set, max 256 |
| `card` | string | alert card slug/id from the panel (fills text/icon/priority/sound) |
| `icon` | string | LaMetric icon id |
| `priority` | `info` \| `warning` \| `critical` | queue ordering |
| `sound` | boolean \| string | optional; `true`/`false` or LaMetric sound id (e.g. `open_door`, `alarm1`) |
| `lifetime` | number | ms |
| `cycles` | number | display cycles |
| `device` | string | clock id or slug (`lametric`, `ulanzi`, `ulanzi-2`, …). Omit to send to every clock. |

### Alert cards

Predesigned and custom alert templates live in the panel tab **Alertas**. List them:

```bash
curl "$BRIDGE/api/v1/cards" -H "X-API-Key: $API_KEY"
```

Send a card to one clock (or omit `device` for all):

```bash
curl -X POST "$BRIDGE/api/v1/notify" \
  -H "Content-Type: application/json" \
  -H "X-API-Key: $API_KEY" \
  -d '{"card":"paquete","device":"ulanzi"}'
```

Optional overrides: `text`, `icon`, `priority`, `sound` on top of the card defaults.

Built-in presets (seeded): `paquete`, `puerta`, `alarma`, `visita`, `deteccion`, `llamada`, `reunion`, `recordatorio`, `temp-alta`, `ok`, `cena`.

### Card automations (IFTTT)

In the panel **Alertas** tab, create rules from two sources:

**Home Assistant**
```
SI  binary_sensor.puerta  cambia
ENTONCES  card:puerta  EN  ulanzi-cocina
```

**Conexiones** (LAN apps via webhook — e.g. Sentinel / Frigate)
```
SI  Sentinel → torrent.added
ENTONCES  card:sentinel-nueva  EN  ulanzi

SI  Sentinel → torrent.completed
ENTONCES  card:sentinel-done  EN  lametric

SI  Frigate → person
ENTONCES  card:deteccion  EN  ulanzi
```

The panel app name must match (`sentinel`, `frigate`). When a connection rule matches an event, the default webhook text is skipped (no double notify).

HA triggers: `change` | `equals` | `gt` | `lt`.  
Card text may use `{{ state }}`, `{{ name }}`, `{{ unit }}`, and for connections also `{{ hot_free }}`, `{{ text }}`, `{{ event }}`.  
Frigate cards also get `{{ label }}`, `{{ label_es }}`, `{{ camera }}`, `{{ zone }}`, `{{ zones }}`, `{{ score }}`, `{{ sub_label }}`.

**Audio:** each card has sound on/off plus optional LaMetric sound id (`notification`, `open_door`, `alarm1`, …). Automations can inherit / force on / mute and optionally override the sound id. Manual send has **Enviar** (card default) and **Mudo**.

### Multiple Ulanzi clocks

Add each AWTRIX clock in **Relojes** with a unique slug (e.g. `ulanzi`, `ulanzi-cocina`). Env only upserts the first as `ulanzi` (`AWTRIX_BASE_URL`); extras are panel-managed.

## App webhook (Sentinel / scripts)

Event-oriented ingest for LAN apps. Same queue as `/notify`, with optional `event` label in the log source (`app:<name>:<event>`) and optional persistent frame update.

```bash
curl -X POST "$BRIDGE/api/v1/webhook" \
  -H "Content-Type: application/json" \
  -H "X-API-Key: $API_KEY" \
  -d '{
    "event": "torrent.completed",
    "text": "DONE Show.S01 · hot 42G libre",
    "priority": "info",
    "icon": "a2867",
    "sound": true
  }'
```

| Field | Type | Notes |
| --- | --- | --- |
| `event` | string | optional label (e.g. `torrent.added`, `torrent.completed`, `torrent.removed`, `copy.done`) |
| `card` | string | optional alert card slug/id |
| `text` or `message` | string | required unless `card`, max 256 |
| `icon` / `priority` / `sound` / `lifetime` / `cycles` / `device` | — | same as `/notify` |
| `channel` | string | optional: also upsert Indicator frame on this channel |
| `frame_text` / `frame_icon` | string | frame content (defaults to `text` / `icon`) |

### Sentinel

1. Create an app named `sentinel` in the bridge panel; copy the API key once.
2. In Sentinel Dokploy `.env`:

```env
LAMETRIC_BRIDGE_URL=http://lametric.lan
LAMETRIC_BRIDGE_API_KEY=lb_...
# optional: LAMETRIC_BRIDGE_DEVICE=lametric
# optional: LAMETRIC_HOT_WARN_GIB=50
```

Sentinel posts webhook events for torrent added / download complete / removed / copy done, appending hot free space when available.

### Frigate

1. Create an app named `frigate` in the bridge panel; copy the API key.
2. In **Alertas**, add a Conexiones rule, e.g. `SI Frigate → person` → card `deteccion` → clock.
3. POST detections to `POST /api/v1/frigate` (native MQTT event JSON or flat body).

Native Frigate MQTT `frigate/events` shape (only `type=new` by default; `?all=1` includes update/end):

```bash
curl -X POST "$BRIDGE/api/v1/frigate" \
  -H "Content-Type: application/json" \
  -H "X-API-Key: $FRIGATE_API_KEY" \
  -d '{
    "type": "new",
    "after": {
      "id": "1700000000.1-abc",
      "camera": "entrada",
      "label": "person",
      "top_score": 0.91,
      "current_zones": ["porche"],
      "entered_zones": ["porche"]
    }
  }'
```

Flat body (scripts / HA `rest_command`):

```bash
curl -X POST "$BRIDGE/api/v1/frigate" \
  -H "Content-Type: application/json" \
  -H "X-API-Key: $FRIGATE_API_KEY" \
  -d '{"label":"person","camera":"entrada","zones":["porche"],"score":0.91}'
```

Each detection fires Conexiones rules for `detection` and for the object label (`person`, `car`, …). Without matching rules, the bridge still queues a short default text (`Persona en entrada`).

Wire Frigate → bridge with any of: MQTT→HTTP (Node-RED / mqttwarn), HA automation on `frigate` events calling `rest_command`, or a small script subscribed to `frigate/events`.

List clocks (id, slug, kind, host):

```bash
curl "$BRIDGE/api/v1/devices" -H "X-API-Key: $API_KEY"
```

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
   - `notify` — enqueue a notification on state change
   - `frame` — persistent display: LaMetric channel frame, or AWTRIX pushed app
   - `device` — target clock (or all clocks)
4. Templates support `{{ state }}`, `{{ name }}`, `{{ unit }}`, `{{ entity_id }}`.
   Filters: `{{ state | round:2 }}`, `{{ state | fixed:2 }}`, `{{ state | int }}`.
   Edit templates anytime in the panel (Home Assistant → entity card → Guardar texto).
5. Optional automation per entity:
   - `interval_sec` — for `notify`, owns the cadence (no per-change enqueue; min 10s). Frames still update on change.
   - `min_delta` — only emit on change when `|new - last| >= delta` (numeric)
   - `when_gt` / `when_lt` — emit when numeric state is `> X` and/or `< Y` (edge into zone; re-alert while inside only if `min_delta` is set)
   - `priority` / `sound` — used when notifying a clock

## Health

```bash
curl "$BRIDGE/api/v1/health"
```
