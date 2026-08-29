-- Multi-clock targeting for HA entity alert rules
ALTER TABLE ha_entities
  ADD COLUMN IF NOT EXISTS device_ids TEXT[];
