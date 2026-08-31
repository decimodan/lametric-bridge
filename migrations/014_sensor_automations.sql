-- Sensor cards as automation triggers (IF sensor card → THEN alert card)
ALTER TABLE card_automations
  DROP CONSTRAINT IF EXISTS card_automations_source_check;

ALTER TABLE card_automations
  ADD CONSTRAINT card_automations_source_check
    CHECK (source IN ('ha', 'connection', 'sensor'));

ALTER TABLE card_automations
  ADD COLUMN IF NOT EXISTS sensor_card_id TEXT REFERENCES sensor_cards(id) ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS card_automations_sensor_idx
  ON card_automations (sensor_card_id)
  WHERE enabled = TRUE AND source = 'sensor';
