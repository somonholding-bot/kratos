-- Expansión cognitiva C02: monitorización metacognitiva. Cada decisión relevante queda registrada con su objetivo, estrategias,
-- evidencia, supuestos, incertidumbre y confianza; la confianza se calibra contra resultados medidos, no contra lo que se declara.
CREATE TABLE IF NOT EXISTS cog_decisiones (
  id serial PRIMARY KEY,
  actor text NOT NULL, tarea_id int, categoria text NOT NULL,
  objetivo text NOT NULL,
  estrategias jsonb NOT NULL,                 -- [{nombre, motivo}]
  elegida text NOT NULL,
  evidencia jsonb NOT NULL DEFAULT '[]',      -- [{texto, fuente, apoya: true|false}]
  supuestos jsonb NOT NULL DEFAULT '[]',
  incertidumbre numeric NOT NULL CHECK (incertidumbre BETWEEN 0 AND 1),
  confianza_declarada numeric NOT NULL CHECK (confianza_declarada BETWEEN 0 AND 1),
  confianza_calibrada numeric, calibracion jsonb,
  resultado_esperado text NOT NULL, resultado_real text, exito boolean,
  errores text, estrategia_revisada text,
  critica boolean NOT NULL DEFAULT false,
  alertas jsonb NOT NULL DEFAULT '[]',        -- contradicciones, sobreconfianza, estrategia ya fallida, evidencia insuficiente
  estado text NOT NULL DEFAULT 'abierta' CHECK (estado IN ('abierta','escalada','resuelta')),
  escalado_motivo text,
  revisor text, revision jsonb, revisada_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(), resuelta_at timestamptz
);
CREATE INDEX IF NOT EXISTS cog_decisiones_cat ON cog_decisiones (categoria, estado);
