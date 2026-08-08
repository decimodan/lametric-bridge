-- Automation rules for HA → LaMetric entity mappings
ALTER TABLE ha_entities
  ADD COLUMN IF NOT EXISTS priority TEXT NOT NULL DEFAULT 'info'
    CHECK (priority IN ('info', 'warning', 'critical'));

ALTER TABLE ha_entities
  ADD COLUMN IF NOT EXISTS sound BOOLEAN NOT NULL DEFAULT FALSE;

-- Periodic enqueue/update every N seconds (NULL = disabled)
ALTER TABLE ha_entities
  ADD COLUMN IF NOT EXISTS interval_sec INTEGER
    CHECK (interval_sec IS NULL OR interval_sec >= 10);

-- Only notify/update when numeric |delta| >= threshold (NULL = any change)
ALTER TABLE ha_entities
  ADD COLUMN IF NOT EXISTS min_delta DOUBLE PRECISION
    CHECK (min_delta IS NULL OR min_delta >= 0);

ALTER TABLE ha_entities
  ADD COLUMN IF NOT EXISTS last_value TEXT;

ALTER TABLE ha_entities
  ADD COLUMN IF NOT EXISTS last_sent_at TIMESTAMPTZ;
