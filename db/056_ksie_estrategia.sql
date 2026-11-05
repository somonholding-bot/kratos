-- KSIE TAREAS 03–08: marco de 100 preguntas, oportunidades, respuestas con evidencia, recomendaciones, experimentos (se amplía la tabla
-- experiments existente) y modelos financieros. Etiquetas de evidencia: HYPOTHESIS / ESTIMATE / OBSERVED / INDEPENDENTLY_VERIFIED.
CREATE TABLE IF NOT EXISTS ksie_preguntas (
  id text PRIMARY KEY, numero int NOT NULL UNIQUE, categoria text NOT NULL, categoria_nombre text NOT NULL, texto text NOT NULL, relevancia text NOT NULL,
  evidencia_necesaria text NOT NULL, operaciones text[] NOT NULL, capacidades text[] NOT NULL, critica_nivel1 boolean NOT NULL DEFAULT false
);
CREATE TABLE IF NOT EXISTS ksie_oportunidades (
  id serial PRIMARY KEY, nombre text NOT NULL, tipo text NOT NULL CHECK (tipo IN ('software','producto_fisico','fabricacion','agricultura','automocion','servicio_local','servicio_industrial','mejora_procesos','comercializacion_cientifica','producto_digital','suscripcion','contenido','hibrido')),
  sector text, descripcion text NOT NULL,
  origen text NOT NULL CHECK (origen IN ('propietario_sugerencia','propietario_orden','kratos','agente')),
  estado text NOT NULL DEFAULT 'candidata' CHECK (estado IN ('candidata','investigando','experimentando','ejecutando','pausada','descartada')),
  evaluacion jsonb NOT NULL DEFAULT '{}', etiqueta_evaluacion text CHECK (etiqueta_evaluacion IN ('HYPOTHESIS','ESTIMATE','OBSERVED','INDEPENDENTLY_VERIFIED')),
  incertidumbre numeric NOT NULL DEFAULT 0.8, inversion_usd numeric NOT NULL DEFAULT 0, riesgo numeric NOT NULL DEFAULT 0.5, irreversibilidad numeric NOT NULL DEFAULT 0.2,
  objetivo_id int REFERENCES cog_objetivos(id), creado_por text NOT NULL,
  motivo_abandono text, abandonada_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS ksie_una_ejecucion ON ksie_oportunidades ((true)) WHERE estado = 'ejecutando';
CREATE TABLE IF NOT EXISTS ksie_respuestas (
  id serial PRIMARY KEY, oportunidad_id int NOT NULL REFERENCES ksie_oportunidades(id), pregunta_id text NOT NULL REFERENCES ksie_preguntas(id),
  respuesta text NOT NULL, evidencia text NOT NULL, fuente text NOT NULL,
  etiqueta text NOT NULL CHECK (etiqueta IN ('HYPOTHESIS','ESTIMATE','OBSERVED','INDEPENDENTLY_VERIFIED')),
  confianza numeric NOT NULL CHECK (confianza BETWEEN 0 AND 1), supuestos text[] NOT NULL DEFAULT '{}', seguimiento text[] NOT NULL DEFAULT '{}',
  actor text NOT NULL, verificado_por text, alertas jsonb NOT NULL DEFAULT '[]', created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (etiqueta <> 'INDEPENDENTLY_VERIFIED' OR (verificado_por IS NOT NULL AND verificado_por <> actor))
);
CREATE TABLE IF NOT EXISTS ksie_recomendaciones (
  id serial PRIMARY KEY, oportunidad_id int NOT NULL REFERENCES ksie_oportunidades(id),
  decision text NOT NULL CHECK (decision IN ('INVESTIGATE','EXPERIMENT','EXECUTE','DISCARD')),
  motivo text NOT NULL, evidencia jsonb NOT NULL, nivel int NOT NULL, revision_previa jsonb NOT NULL DEFAULT '{}',
  difiere_de int REFERENCES ksie_recomendaciones(id), explicacion_cambio text, decision_c02 int, actor text NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS ksie_modelos_financieros (
  id serial PRIMARY KEY, oportunidad_id int REFERENCES ksie_oportunidades(id), supuestos jsonb NOT NULL, escenarios jsonb NOT NULL,
  etiqueta text NOT NULL CHECK (etiqueta IN ('HYPOTHESIS','ESTIMATE','OBSERVED','INDEPENDENTLY_VERIFIED')), created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE experiments ADD COLUMN IF NOT EXISTS oportunidad_id int REFERENCES ksie_oportunidades(id);
ALTER TABLE experiments ADD COLUMN IF NOT EXISTS tipo text;
ALTER TABLE experiments ADD COLUMN IF NOT EXISTS linea_base text;
ALTER TABLE experiments ADD COLUMN IF NOT EXISTS resultado_previsto text;
ALTER TABLE experiments ADD COLUMN IF NOT EXISTS umbral_exito numeric;
ALTER TABLE experiments ADD COLUMN IF NOT EXISTS umbral_fracaso numeric;
ALTER TABLE experiments ADD COLUMN IF NOT EXISTS resultados jsonb;
ALTER TABLE experiments ADD COLUMN IF NOT EXISTS interpretacion text;
ALTER TABLE experiments ADD COLUMN IF NOT EXISTS siguiente_decision text;
ALTER TABLE experiments ADD COLUMN IF NOT EXISTS approval_id int REFERENCES approvals(id);
ALTER TABLE experiments ADD COLUMN IF NOT EXISTS prediccion_id int REFERENCES cog_predicciones(id);
