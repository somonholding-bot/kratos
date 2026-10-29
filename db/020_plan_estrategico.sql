-- Misión actualizada por el propietario (29-oct-2026) y plan estratégico vivo del CEO.
UPDATE system_state SET value = '"META DE VIDA: 250.000 USD de ingresos mensuales y 200.000 usuarios. Primer hito: 10.000 usuarios. Siempre de forma legal y ética, dentro de los presupuestos y aprobaciones."', updated_at = now(), updated_by = 'propietario'
WHERE key = 'mission';

-- Plan maestro: KRATOS lo crea, lo revisa en cada ciclo y lo ajusta según resultados (cada cambio es una versión nueva)
CREATE TABLE IF NOT EXISTS strategy_plan (
  id serial PRIMARY KEY,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by text NOT NULL,
  content text NOT NULL,
  kpis jsonb NOT NULL DEFAULT '{}',
  reason text
);

-- Ciclo del CEO cada 6 horas (antes 12) para ser más proactivo
UPDATE tasks SET recurrence_minutes = 360, run_at = least(run_at, now() + interval '10 minutes') WHERE type = 'ciclo_ceo' AND status = 'pendiente';
