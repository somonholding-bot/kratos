-- Bitácora de fallas y de rendimiento, y ajustes que KRATOS puede cambiar por voz.
CREATE TABLE IF NOT EXISTS fault_log (
  id bigserial PRIMARY KEY,
  at timestamptz NOT NULL DEFAULT now(),
  source text NOT NULL,
  level text NOT NULL CHECK (level IN ('aviso','error')),
  message text NOT NULL
);
CREATE TABLE IF NOT EXISTS perf_log (
  id bigserial PRIMARY KEY,
  at timestamptz NOT NULL DEFAULT now(),
  cpu_busy numeric, ram_used_pct int, ram_free_pct int,
  kratos_ram_mb int, kratos_cpu numeric, top_app text, top_app_ram_mb int
);
INSERT INTO system_state (key, value, updated_by) VALUES
  ('ui_quality', '"media"', 'sistema'),
  ('voice_speed', '1', 'sistema'),
  ('follow_up', '60', 'sistema')
ON CONFLICT (key) DO NOTHING;
UPDATE system_state SET value = jsonb_set(value, '{address}', '"Idalmi"') WHERE key = 'owner' AND jsonb_typeof(value) = 'object';
