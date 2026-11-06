-- Anuncios de Meta para experimentos de KRATOS (gasto solo del presupuesto mensual de pruebas ya aprobado).
CREATE TABLE IF NOT EXISTS meta_campanas (
  id serial PRIMARY KEY, experimento_id int NOT NULL UNIQUE REFERENCES experiments(id), campana_id text NOT NULL, conjunto_id text NOT NULL, anuncio_id text NOT NULL,
  presupuesto_cents int NOT NULL, dias int NOT NULL, destino text NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
);
UPDATE agent_functions SET allowed_tools = (SELECT array(SELECT DISTINCT unnest(allowed_tools || ARRAY['meta_anuncios']))) WHERE id IN ('jupiter','mercurio');
