-- Expansión cognitiva, TAREA 08: ciclo operativo integrado (KRATOS → C01 → C04 → SOL → ACD → cálculo → C02 → C05 → C03 → cierre).
CREATE TABLE IF NOT EXISTS cog_ciclos (
  id serial PRIMARY KEY, objetivo_id int REFERENCES cog_objetivos(id), titulo text NOT NULL,
  etapas jsonb NOT NULL DEFAULT '[]',            -- [{n, etapa, responsable, entrada, salida, criterio, cumple, dependencia_ausente}]
  estado text NOT NULL DEFAULT 'en_curso' CHECK (estado IN ('en_curso','completado','fallido','bloqueado')),
  resultado text, created_at timestamptz NOT NULL DEFAULT now(), cerrado_at timestamptz
);
-- Herramientas cognitivas para los agentes (no se crean agentes nuevos). Saturno, evaluador independiente, revisa decisiones.
UPDATE agent_functions SET allowed_tools = (SELECT array(SELECT DISTINCT unnest(allowed_tools || ARRAY['automodelo','memoria_autobiografica','espacio_global','metacognicion'])))
  WHERE id <> 'kratos';
UPDATE agent_functions SET allowed_tools = (SELECT array(SELECT DISTINCT unnest(allowed_tools || ARRAY['prediccion','conciencia_lab']))) WHERE id IN ('sol','saturno');
