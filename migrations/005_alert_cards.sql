-- Predesigned + custom alert cards for quick notify to any clock
CREATE TABLE IF NOT EXISTS alert_cards (
  id TEXT PRIMARY KEY,
  slug TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  text TEXT NOT NULL,
  icon TEXT NOT NULL DEFAULT 'a2867',
  priority TEXT NOT NULL DEFAULT 'info'
    CHECK (priority IN ('info', 'warning', 'critical')),
  sound BOOLEAN NOT NULL DEFAULT FALSE,
  is_preset BOOLEAN NOT NULL DEFAULT FALSE,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS alert_cards_sort_idx
  ON alert_cards (is_preset DESC, sort_order ASC, name ASC);

INSERT INTO alert_cards (id, slug, name, text, icon, priority, sound, is_preset, sort_order)
VALUES
  ('card-paquete', 'paquete', 'Paquete', 'Llego un paquete', 'a2438', 'info', TRUE, TRUE, 10),
  ('card-puerta', 'puerta', 'Puerta abierta', 'Puerta abierta', 'a7956', 'warning', TRUE, TRUE, 20),
  ('card-alarma', 'alarma', 'Alarma', 'ALARMA', 'a2096', 'critical', TRUE, TRUE, 30),
  ('card-visita', 'visita', 'Visita', 'Hay visita en la puerta', 'a2305', 'warning', TRUE, TRUE, 40),
  ('card-llamada', 'llamada', 'Llamada', 'Llamada entrante', 'a75', 'warning', TRUE, TRUE, 50),
  ('card-reunion', 'reunion', 'Reunion', 'Reunion en 5 min', 'a2803', 'info', FALSE, TRUE, 60),
  ('card-recordatorio', 'recordatorio', 'Recordatorio', 'Recordatorio', 'a2867', 'info', FALSE, TRUE, 70),
  ('card-temp-alta', 'temp-alta', 'Temp. alta', 'Temperatura alta', 'a2300', 'warning', TRUE, TRUE, 80),
  ('card-ok', 'ok', 'Todo OK', 'Todo OK', 'a120', 'info', FALSE, TRUE, 90),
  ('card-cena', 'cena', 'Cena lista', 'La cena esta lista', 'a2443', 'info', TRUE, TRUE, 100)
ON CONFLICT (slug) DO NOTHING;
