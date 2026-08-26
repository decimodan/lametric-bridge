-- Connection sources (Sentinel, etc.) alongside HA entity automations
ALTER TABLE card_automations
  ADD COLUMN IF NOT EXISTS source TEXT NOT NULL DEFAULT 'ha';

ALTER TABLE card_automations
  DROP CONSTRAINT IF EXISTS card_automations_source_check;

ALTER TABLE card_automations
  ADD CONSTRAINT card_automations_source_check
  CHECK (source IN ('ha', 'connection'));

ALTER TABLE card_automations
  ADD COLUMN IF NOT EXISTS app_name TEXT;

ALTER TABLE card_automations
  ADD COLUMN IF NOT EXISTS event_name TEXT;

ALTER TABLE card_automations
  ALTER COLUMN entity_id DROP NOT NULL;

CREATE INDEX IF NOT EXISTS card_automations_connection_idx
  ON card_automations (app_name, event_name)
  WHERE enabled = TRUE AND source = 'connection';

-- Helpful presets for Sentinel → clock flows
INSERT INTO alert_cards (id, slug, name, text, icon, priority, sound, is_preset, sort_order)
VALUES
  ('card-sentinel-new', 'sentinel-nueva', 'Sentinel nueva', 'Nueva: {{ name }}', 'a2438', 'info', FALSE, TRUE, 110),
  ('card-sentinel-done', 'sentinel-done', 'Sentinel done', 'Hot {{ hot_free }} libre', 'a120', 'info', TRUE, TRUE, 120),
  ('card-sentinel-copy', 'sentinel-copy', 'Sentinel copia', '{{ text }}', 'a2867', 'info', FALSE, TRUE, 130)
ON CONFLICT (slug) DO NOTHING;
