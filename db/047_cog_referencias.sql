-- Expansión cognitiva, TAREA 01: registro buscable de referencias científicas y catálogo de repositorios evaluados.
CREATE TABLE IF NOT EXISTS cog_referencias (
  codigo text PRIMARY KEY,                    -- A1…F3 de la directiva
  grupo text NOT NULL,
  bibliografia text NOT NULL,
  doi_url text,
  verificada boolean NOT NULL DEFAULT false,  -- la URL/DOI se abrió y corresponde a la obra
  acceso text NOT NULL CHECK (acceso IN ('texto_completo','resumen','pagina','metadatos')),
  hipotesis text NOT NULL, metodologia text NOT NULL, evidencia text NOT NULL, limitaciones text NOT NULL,
  aplicacion text NOT NULL,
  justificacion text NOT NULL CHECK (justificacion IN ('justificada','parcial','especulativa','no_aplica')),
  fuente_id int,                              -- ficha en sol_fuentes (biblioteca de Sol)
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS cog_referencias_fts ON cog_referencias USING gin (to_tsvector('simple', codigo || ' ' || bibliografia || ' ' || hipotesis || ' ' || aplicacion));
CREATE TABLE IF NOT EXISTS cog_repositorios (
  nombre text PRIMARY KEY, url text NOT NULL,
  licencia text, version text, plataforma text, dependencias text,
  clasificacion text NOT NULL CHECK (clasificacion IN ('RESEARCH_ONLY','EXISTING_INTEGRATION','INTEGRATE_NOW','DEFER_HARDWARE','DEFER_COST','REJECT_INCOMPATIBLE','REJECT_UNNECESSARY')),
  motivo text NOT NULL, capacidad_que_resuelve text, memoria_disco text, riesgos text, instalacion text, prueba_minima text,
  verificado_en timestamptz NOT NULL DEFAULT now()
);
