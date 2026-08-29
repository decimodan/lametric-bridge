-- Alert rules on home sensor cards (thresholds → clock notification)
ALTER TABLE sensor_cards
  ADD COLUMN IF NOT EXISTS alert_enabled BOOLEAN NOT NULL DEFAULT FALSE;

ALTER TABLE sensor_cards
  ADD COLUMN IF NOT EXISTS when_gt DOUBLE PRECISION;

ALTER TABLE sensor_cards
  ADD COLUMN IF NOT EXISTS when_lt DOUBLE PRECISION;

ALTER TABLE sensor_cards
  ADD COLUMN IF NOT EXISTS min_delta DOUBLE PRECISION
    CHECK (min_delta IS NULL OR min_delta >= 0);

ALTER TABLE sensor_cards
  ADD COLUMN IF NOT EXISTS interval_sec INTEGER
    CHECK (interval_sec IS NULL OR interval_sec >= 10);

ALTER TABLE sensor_cards
  ADD COLUMN IF NOT EXISTS priority TEXT NOT NULL DEFAULT 'warning'
    CHECK (priority IN ('info', 'warning', 'critical'));

ALTER TABLE sensor_cards
  ADD COLUMN IF NOT EXISTS sound BOOLEAN NOT NULL DEFAULT FALSE;

ALTER TABLE sensor_cards
  ADD COLUMN IF NOT EXISTS alert_template TEXT NOT NULL DEFAULT '{{ name }}: {{ state }}{{ unit }}';

ALTER TABLE sensor_cards
  ADD COLUMN IF NOT EXISTS device_id TEXT REFERENCES devices(id) ON DELETE SET NULL;

ALTER TABLE sensor_cards
  ADD COLUMN IF NOT EXISTS device_ids TEXT[];

ALTER TABLE sensor_cards
  ADD COLUMN IF NOT EXISTS last_value TEXT;

ALTER TABLE sensor_cards
  ADD COLUMN IF NOT EXISTS last_sent_at TIMESTAMPTZ;
