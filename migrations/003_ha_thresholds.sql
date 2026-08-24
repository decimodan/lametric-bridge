-- Absolute thresholds: emit only when numeric state is above/below
ALTER TABLE ha_entities
  ADD COLUMN IF NOT EXISTS when_gt DOUBLE PRECISION;

ALTER TABLE ha_entities
  ADD COLUMN IF NOT EXISTS when_lt DOUBLE PRECISION;
