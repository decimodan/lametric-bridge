-- Frigate detection card + per-card / per-automation sound selection

ALTER TABLE alert_cards
  ADD COLUMN IF NOT EXISTS sound_id TEXT;

ALTER TABLE card_automations
  ADD COLUMN IF NOT EXISTS sound BOOLEAN;

ALTER TABLE card_automations
  ADD COLUMN IF NOT EXISTS sound_id TEXT;

INSERT INTO alert_cards (id, slug, name, text, icon, priority, sound, sound_id, is_preset, sort_order)
VALUES
  (
    'card-deteccion',
    'deteccion',
    'Deteccion',
    '{{ label_es }} en {{ camera }}',
    'a2305',
    'warning',
    TRUE,
    'open_door',
    TRUE,
    45
  )
ON CONFLICT (slug) DO NOTHING;

-- Sensible defaults for noisy presets (only if still unset)
UPDATE alert_cards SET sound_id = 'knock-knock' WHERE slug = 'puerta' AND sound_id IS NULL;
UPDATE alert_cards SET sound_id = 'alarm1' WHERE slug = 'alarma' AND sound_id IS NULL;
UPDATE alert_cards SET sound_id = 'notification3' WHERE slug = 'visita' AND sound_id IS NULL;
UPDATE alert_cards SET sound_id = 'letter_email' WHERE slug = 'paquete' AND sound_id IS NULL;
UPDATE alert_cards SET sound_id = 'notification' WHERE slug = 'llamada' AND sound_id IS NULL;
