-- KRATOS había cancelado su propio ciclo de CEO (tarea 318): se reactiva cada 20 minutos y ya no puede cancelarlo
INSERT INTO tasks (business_id, owner_function, type, title, objective, priority, run_at, recurrence_minutes, expected_result, verification, idempotency_key, created_by)
SELECT business_id, owner_function, type, title, objective, priority, now() + interval '1 minute', 20, expected_result, verification, 'ciclo_ceo:reactivado:2026-11-01', 'propietario'
FROM tasks WHERE id = (SELECT max(id) FROM tasks WHERE type = 'ciclo_ceo')
AND NOT EXISTS (SELECT 1 FROM tasks WHERE type = 'ciclo_ceo' AND status IN ('pendiente', 'en_ejecucion', 'esperando_ia'))
ON CONFLICT (idempotency_key) DO NOTHING;
