-- Home dashboard sensor cards (value + user explanation)
CREATE TABLE IF NOT EXISTS sensor_cards (
  id TEXT PRIMARY KEY,
  entity_id TEXT NOT NULL,
  title TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  sort_order INTEGER NOT NULL DEFAULT 0,
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS sensor_cards_sort_idx ON sensor_cards (sort_order ASC, created_at ASC);
