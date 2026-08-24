-- Multiple clocks: LaMetric Time and AWTRIX / Ulanzi TC001
CREATE TABLE IF NOT EXISTS devices (
  id TEXT PRIMARY KEY,
  slug TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('lametric', 'awtrix')),
  host TEXT NOT NULL,
  api_key_enc TEXT NOT NULL DEFAULT '',
  env_managed BOOLEAN NOT NULL DEFAULT FALSE,
  last_seen TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO devices (id, slug, name, kind, host, api_key_enc, last_seen)
SELECT
  'legacy-lametric',
  'lametric',
  'LaMetric',
  'lametric',
  host,
  api_key_enc,
  last_seen
FROM lametric_device
WHERE id = 1
ON CONFLICT (slug) DO NOTHING;

ALTER TABLE ha_entities
  ADD COLUMN IF NOT EXISTS device_id TEXT REFERENCES devices(id) ON DELETE SET NULL;

ALTER TABLE ha_entities DROP CONSTRAINT IF EXISTS ha_entities_entity_id_key;
