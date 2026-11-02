-- El propietario quiere un CEO proactivo de verdad (1-nov-2026): el ciclo corre cada 20 minutos
-- mientras el uso del plan de Claude esté por debajo del 90 %; al llegar, espera al reinicio y vuelve solo.
INSERT INTO system_state (key, value, updated_by) VALUES ('autonomy_usage_cap', '0.9', 'propietario')
ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now(), updated_by = 'propietario';
UPDATE tasks SET recurrence_minutes = 20, run_at = least(run_at, now() + interval '2 minutes')
WHERE type = 'ciclo_ceo' AND status IN ('pendiente', 'esperando_ia');
