-- PROJECT SOL · conectores R01–R16 (src/core/conectores.ts). Idempotente; no cambia nada previo.
-- Índices para deduplicar por identificador y leer la última prueba en vivo de cada conector.
CREATE INDEX IF NOT EXISTS sol_fuentes_identificador ON sol_fuentes (identificador) WHERE identificador IS NOT NULL;
CREATE INDEX IF NOT EXISTS sol_conectores_pruebas_codigo ON sol_conectores_pruebas (codigo, id DESC);
-- Dónde está el texto legal de la fuente según el conector que la trajo (PDF abierto, texto de dominio público…): accion=leer lo usa
-- con solo fuente_id, y con fuente_id + url exige que la url sea la de la fuente o este texto_url (la lectura no se anota en otra fuente).
ALTER TABLE sol_fuentes ADD COLUMN IF NOT EXISTS texto_url text;
