-- Misión, ciclo proactivo del CEO y motor de aprendizaje.
INSERT INTO system_state (key, value) VALUES
  ('mission', '"Llevar los productos del propietario a 10.000 usuarios y a ingresos sostenibles, de forma legal y ética, dentro de los presupuestos y aprobaciones."')
ON CONFLICT (key) DO NOTHING;

-- Aprendizajes: lo que funcionó, lo que no y por qué. Es la memoria acumulada de KRATOS.
CREATE TABLE IF NOT EXISTS lessons (
  id bigserial PRIMARY KEY,
  at timestamptz NOT NULL DEFAULT now(),
  agent text NOT NULL,
  kind text NOT NULL CHECK (kind IN ('funciono','no_funciono','aprendizaje')),
  content text NOT NULL,
  evidence text,
  task_id int REFERENCES tasks(id),
  confidence numeric NOT NULL DEFAULT 0.5 CHECK (confidence BETWEEN 0 AND 1)
);

UPDATE agent_functions SET charter = $$KRATOS — CEO y núcleo coordinador.
Misión: llevar los productos del propietario a 10.000 usuarios y a ingresos sostenibles.
Funciones:
1. Fijar el rumbo semanal: pocas prioridades de alto impacto alineadas con la misión.
2. Delegar en el especialista adecuado (Sol, Luna, Mercurio, Venus, Marte, Júpiter, Saturno) con objetivo, resultado esperado y verificación.
3. Revisar resultados, registrar qué funcionó y qué no (aprendizajes) y ajustar el plan.
4. Proponer al propietario las decisiones que requieren dinero, publicación, contacto con terceros o accesos nuevos.
Límites: nunca gasta, publica ni contacta a terceros sin aprobación; «hacer dinero» siempre por medios legales y honestos.$$ WHERE id = 'kratos';

-- Ciclo proactivo: cada 12 horas KRATOS revisa el estado y reparte trabajo (solo si hay IA y presupuesto)
INSERT INTO tasks (business_id, owner_function, type, title, objective, priority, expected_result, verification, recurrence_minutes, idempotency_key, run_at)
SELECT id, 'kratos', 'ciclo_ceo', 'Ciclo proactivo del CEO', 'Revisar estado y resultados, registrar aprendizajes y crear las próximas tareas de mayor impacto hacia 10.000 usuarios', 2,
  'Aprendizajes registrados y hasta 3 tareas nuevas asignadas', 'Las tareas nuevas tienen responsable, resultado esperado y verificación', 720, 'ciclo_ceo:seed', now() + interval '5 minutes'
FROM businesses WHERE name = 'Kratos · Operaciones internas'
ON CONFLICT (idempotency_key) DO NOTHING;
