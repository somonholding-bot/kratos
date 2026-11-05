-- Motor ACD (src/core/acd.ts): lo que el esquema común de la 041 no cubre. Idempotente; no borra ni cambia nada previo.

-- E04: cuándo y con qué criterios explícitos se seleccionó una hipótesis (el estado cambia después; la selección queda)
ALTER TABLE acd_hipotesis ADD COLUMN IF NOT EXISTS seleccionada_en timestamptz;
ALTER TABLE acd_hipotesis ADD COLUMN IF NOT EXISTS criterios_seleccion text;

-- D07 / E10 / E11: historial de cada cambio de estado de una hipótesis (quién, cuándo, por qué y con qué evidencia)
CREATE TABLE IF NOT EXISTS acd_historial (
  id serial PRIMARY KEY,
  hipotesis_id int NOT NULL REFERENCES acd_hipotesis(id),
  de text,
  a text NOT NULL,
  motivo text,
  evidencia jsonb,
  actor text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS acd_historial_hipotesis ON acd_historial (hipotesis_id);

-- D03: por qué un experimento no terminó bien (error, tiempo agotado, contrato roto, interrupción)
ALTER TABLE acd_experimentos ADD COLUMN IF NOT EXISTS detalle text;
-- D10: un solo experimento en ejecución a la vez en toda la máquina (lo garantiza la base de datos, no el proceso)
CREATE UNIQUE INDEX IF NOT EXISTS acd_experimentos_uno_en_curso ON acd_experimentos ((true)) WHERE estado = 'ejecutando';
CREATE INDEX IF NOT EXISTS acd_experimentos_modelo ON acd_experimentos (modelo_id);
CREATE INDEX IF NOT EXISTS acd_modelos_hipotesis ON acd_modelos (hipotesis_id);
CREATE INDEX IF NOT EXISTS acd_criticas_objeto ON acd_criticas (objeto, objeto_id);

-- Permisos de los playbooks ACD (como en la 032): Sol genera; Saturno critica y necesita leer la biblioteca y las fuentes.
-- Solo surten efecto cuando la herramienta existe en el código (agentAllowedTools filtra por TOOLS y AGENT_SAFE_TOOLS).
UPDATE agent_functions SET allowed_tools = allowed_tools || ARRAY(SELECT t FROM unnest(ARRAY['acd','investigar_sol']) t WHERE NOT (t = ANY(allowed_tools)))
  WHERE id = 'sol';
UPDATE agent_functions SET allowed_tools = allowed_tools || ARRAY(SELECT t FROM unnest(ARRAY['acd','investigar_sol','biblioteca_sol','registrar_leccion','WebSearch','WebFetch']) t WHERE NOT (t = ANY(allowed_tools)))
  WHERE id = 'saturno';
