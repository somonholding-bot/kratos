-- PROJECT SOL / ACD · etapa 1: currículo de las 56 materias y exámenes de dominio (src/core/curriculo.ts, src/core/examen.ts). Idempotente.

-- Tareas de la familia de exámenes (crear → responder → calificar): una cada vez, con tope diario propio (system_state.sol_examenes_dia).
CREATE TABLE IF NOT EXISTS sol_examen_tareas (
  id serial PRIMARY KEY,
  unidad text NOT NULL REFERENCES sol_unidades(codigo),
  fase text NOT NULL CHECK (fase IN ('crear','responder','calificar')),
  examen_id int REFERENCES sol_examenes(id),
  tarea_id int,
  estado text NOT NULL DEFAULT 'en_curso' CHECK (estado IN ('en_curso','hecha','fallida')),
  detalle text,
  lanzado_en timestamptz NOT NULL DEFAULT now(),
  cerrado_en timestamptz
);
CREATE INDEX IF NOT EXISTS sol_examen_tareas_unidad ON sol_examen_tareas (unidad, lanzado_en DESC);

-- Un examen cuya rúbrica aparece en un informe (que Sol puede leer) queda anulado: no vale como prueba de dominio.
ALTER TABLE sol_examenes DROP CONSTRAINT IF EXISTS sol_examenes_estado_check;
ALTER TABLE sol_examenes ADD CONSTRAINT sol_examenes_estado_check CHECK (estado IN ('creado','respondido','calificado','anulado'));
ALTER TABLE sol_examenes ADD COLUMN IF NOT EXISTS anulado_motivo text;
CREATE INDEX IF NOT EXISTS sol_examenes_unidad ON sol_examenes (unidad, id DESC);

-- Contador de lanzamientos de estudio: cada 5.º es un módulo antiguo no fusionado (19 y 25–36). La cuota omega_modulos_dia no cambia.
INSERT INTO system_state (key, value) VALUES ('sol_estudio_lanzamientos', '0') ON CONFLICT (key) DO NOTHING;
