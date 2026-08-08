-- apps that push into the bridge
CREATE TABLE IF NOT EXISTS apps (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  api_key_hash TEXT NOT NULL UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- single LaMetric device (id must be 1)
CREATE TABLE IF NOT EXISTS lametric_device (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  host TEXT NOT NULL,
  api_key_enc TEXT NOT NULL,
  last_seen TIMESTAMPTZ
);

-- single Home Assistant connection (id must be 1)
CREATE TABLE IF NOT EXISTS ha_config (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  base_url TEXT NOT NULL,
  token_enc TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS channels (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  enabled BOOLEAN NOT NULL DEFAULT TRUE
);

CREATE TABLE IF NOT EXISTS ha_entities (
  id TEXT PRIMARY KEY,
  entity_id TEXT NOT NULL UNIQUE,
  mode TEXT NOT NULL CHECK (mode IN ('notify', 'frame')),
  template TEXT NOT NULL DEFAULT '{{ state }}',
  icon TEXT NOT NULL DEFAULT 'a2867',
  channel_id TEXT REFERENCES channels(id) ON DELETE SET NULL,
  enabled BOOLEAN NOT NULL DEFAULT TRUE
);

CREATE TABLE IF NOT EXISTS frames (
  id TEXT PRIMARY KEY,
  channel_id TEXT NOT NULL UNIQUE REFERENCES channels(id) ON DELETE CASCADE,
  text TEXT NOT NULL,
  icon TEXT NOT NULL DEFAULT 'a2867',
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS notify_log (
  id BIGSERIAL PRIMARY KEY,
  source TEXT NOT NULL,
  app_id TEXT,
  text TEXT NOT NULL,
  priority TEXT NOT NULL,
  status TEXT NOT NULL,
  detail TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS notify_log_created_at_idx ON notify_log (created_at DESC);
