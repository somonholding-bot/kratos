-- Meta de vida de KRATOS (fijada por el propietario el 28-oct-2026)
UPDATE system_state SET value = '"META DE VIDA: 100.000 usuarios y 250.000 USD de ingresos mensuales. Primer hito: 10.000 usuarios. Siempre de forma legal y ética, dentro de los presupuestos y aprobaciones."', updated_at = now(), updated_by = 'propietario'
WHERE key = 'mission';

UPDATE agent_functions SET charter = replace(charter,
  'Misión: llevar los productos del propietario a 10.000 usuarios y a ingresos sostenibles.',
  'Meta de vida: 100.000 usuarios y 250.000 USD de ingresos mensuales. Primer hito: 10.000 usuarios.')
WHERE id = 'kratos';

UPDATE tasks SET objective = 'Revisar estado y resultados, registrar aprendizajes y crear las próximas tareas de mayor impacto hacia la meta de vida (100.000 usuarios y 250.000 USD/mes; primer hito 10.000 usuarios)'
WHERE type = 'ciclo_ceo' AND status IN ('pendiente', 'en_ejecucion');
