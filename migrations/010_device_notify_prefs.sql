-- Per-clock notification preferences (sound, extensible later)
ALTER TABLE devices
  ADD COLUMN IF NOT EXISTS notify_sound_mode TEXT NOT NULL DEFAULT 'inherit'
    CHECK (notify_sound_mode IN ('inherit', 'on', 'off'));

ALTER TABLE devices
  ADD COLUMN IF NOT EXISTS notify_sound_id TEXT;
