-- Protocolo de investigación de doble perspectiva (propietario, 5-nov-2026): Hermes Trismegisto (tradición hermética) y
-- Albert Einstein (física documentada; lo posterior, separado). Una pregunta por vez; la investigación real queda guardada.
CREATE TABLE IF NOT EXISTS dp_preguntas (
  numero int PRIMARY KEY, titulo text NOT NULL, texto text NOT NULL, linea text NOT NULL,
  estado text NOT NULL DEFAULT 'pendiente' CHECK (estado IN ('pendiente','en_dialogo','estudiada'))
);
CREATE TABLE IF NOT EXISTS dp_sesiones (
  id serial PRIMARY KEY, numero int REFERENCES dp_preguntas(numero), pregunta text NOT NULL, linea text NOT NULL,
  respuesta_visible text, tarea_sol int REFERENCES tasks(id), tarea_saturno int REFERENCES tasks(id),
  estado text NOT NULL DEFAULT 'investigando' CHECK (estado IN ('investigando','revision','lista','fallida')),
  profundizaciones jsonb NOT NULL DEFAULT '[]', created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
