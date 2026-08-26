-- IFTTT-style: HA sensor → alert card → clock
CREATE TABLE IF NOT EXISTS card_automations (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL DEFAULT '',
  card_id TEXT NOT NULL REFERENCES alert_cards(id) ON DELETE CASCADE,
  entity_id TEXT NOT NULL,
  device_id TEXT REFERENCES devices(id) ON DELETE SET NULL,
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  trigger TEXT NOT NULL DEFAULT 'change'
    CHECK (trigger IN ('change', 'equals', 'gt', 'lt')),
  trigger_value TEXT,
  last_value TEXT,
  last_sent_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS card_automations_entity_idx
  ON card_automations (entity_id)
  WHERE enabled = TRUE;
