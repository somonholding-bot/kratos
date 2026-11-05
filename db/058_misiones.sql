-- Adenda del propietario (5-nov-2026): misión doble más traducción. A) investigación científica y hermética fundamental (SOL/ACD),
-- B) inteligencia económica (KSIE), C) traducción del conocimiento a valor práctico (opcional). Dos tableros independientes.
CREATE TABLE IF NOT EXISTS sol_lineas (
  codigo text PRIMARY KEY, titulo text NOT NULL, descripcion text NOT NULL, area text NOT NULL UNIQUE
);
-- Naturaleza del conocimiento de cada hipótesis ACD: enseñanzas históricas, interpretaciones, especulación y hallazgos se distinguen siempre
ALTER TABLE acd_hipotesis ADD COLUMN IF NOT EXISTS naturaleza text NOT NULL DEFAULT 'hipotesis_especulativa';
ALTER TABLE acd_hipotesis ADD COLUMN IF NOT EXISTS naturaleza_motivo text;
ALTER TABLE acd_hipotesis ADD COLUMN IF NOT EXISTS linea text REFERENCES sol_lineas(codigo);
DO $$ BEGIN
  ALTER TABLE acd_hipotesis ADD CONSTRAINT acd_hipotesis_naturaleza_check CHECK (naturaleza IN ('ensenanza_historica','interpretacion_filosofica','hipotesis_especulativa','hipotesis_comprobable','hallazgo_computacional','hallazgo_experimental','hallazgo_replicado','descubrimiento_verificado'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
CREATE TABLE IF NOT EXISTS conocimiento_aplicaciones (
  id serial PRIMARY KEY, hipotesis_id int REFERENCES acd_hipotesis(id), afirmacion_id int REFERENCES sol_afirmaciones(id),
  sector text NOT NULL CHECK (sector IN ('tecnologia_invenciones','materiales_energia_ingenieria','salud_cognicion','software_automatizacion_ia','procesos_industriales','modelos_negocio')),
  descripcion text NOT NULL, naturaleza_fuente text NOT NULL, aviso text NOT NULL,
  oportunidad_id int REFERENCES ksie_oportunidades(id), created_by text NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (hipotesis_id IS NOT NULL OR afirmacion_id IS NOT NULL)
);
-- Carta de Sol: la Misión A forma parte de su función permanente
UPDATE agent_functions SET charter = charter || E'\n\nMISIÓN A — INVESTIGACIÓN CIENTÍFICA Y HERMÉTICA FUNDAMENTAL (adenda del propietario, 5-nov-2026): investiga el origen, formación, estructura y transformación de la materia; las leyes fundamentales de energía, campos, partículas, espacio y tiempo; vibración, resonancia, oscilación, información y emergencia de la organización física; la naturaleza de la conciencia, la percepción, la atención y la intención humana; si la conciencia o la intención tienen alguna influencia medible sobre sistemas físicos más allá de los mecanismos ya establecidos; los principios herméticos, la alquimia y las filosofías esotéricas e iniciáticas como fuente de conceptos e hipótesis comprobables; modelos, predicciones y experimentos originales con ACD; y preguntas sin resolver aunque no tengan aplicación ni dinero inmediato. Distingue SIEMPRE: enseñanza histórica, interpretación filosófica, hipótesis especulativa, hipótesis comprobable, hallazgo computacional, hallazgo experimental, hallazgo replicado y descubrimiento verificado. No abandones una investigación importante porque no genere ingresos. La comercialización es opcional y nunca justifica exagerar.'
  WHERE id = 'sol' AND charter NOT LIKE '%MISIÓN A — INVESTIGACIÓN CIENTÍFICA%';
UPDATE agent_functions SET allowed_tools = (SELECT array(SELECT DISTINCT unnest(allowed_tools || ARRAY['misiones']))) WHERE id IN ('sol','saturno','jupiter','mercurio');
