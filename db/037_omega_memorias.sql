-- Operación Omega, etapa 3 (memoria): memorias persistentes de Sol con trazabilidad.
-- Bibliográfica: fuentes con procedencia y condiciones de uso. «verificada» solo la pone el código tras abrir la URL.
CREATE TABLE IF NOT EXISTS sol_fuentes (
  id serial PRIMARY KEY,
  tipo text NOT NULL DEFAULT 'articulo',            -- libro, articulo, revision, metaanalisis, documento_oficial, enciclopedia, web…
  titulo text NOT NULL,
  autores text, anio int,
  url text UNIQUE, dominio text,
  acceso text NOT NULL DEFAULT 'metadatos' CHECK (acceso IN ('texto_completo','resumen','pagina','metadatos')),   -- qué se consultó de verdad
  condiciones_uso text NOT NULL DEFAULT 'cita y resumen propio; no reproducir',
  temas text[] NOT NULL DEFAULT '{}',
  verificada boolean NOT NULL DEFAULT false, http_status int, verificada_en timestamptz,
  notas text, created_by text NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
);
-- Semántica: afirmaciones con nivel de evidencia (A robusta … E refutada; H tradición histórica o simbólica) ligadas a su fuente.
CREATE TABLE IF NOT EXISTS sol_afirmaciones (
  id serial PRIMARY KEY,
  texto text NOT NULL, tema text,
  nivel text NOT NULL CHECK (nivel IN ('A','B','C','D','E','H')),
  fuente_id int NOT NULL REFERENCES sol_fuentes(id),
  tipo_evidencia text, limitaciones text, replicaciones text, criticas text,
  confianza numeric CHECK (confianza BETWEEN 0 AND 1),
  created_by text NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS sol_conexiones (
  id serial PRIMARY KEY,
  desde text NOT NULL, hacia text NOT NULL,
  tipo text NOT NULL CHECK (tipo IN ('historica','conceptual','experimental','causal','correlacional','metaforica','hipotetica','contradictoria')),
  explicacion text NOT NULL, fuente_ids int[] NOT NULL DEFAULT '{}',
  created_by text NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
);
-- Operativa y episódica: proyectos y entregables (contrato KRATOS–Sol). «completed» solo lo pone el código si los archivos existen.
CREATE TABLE IF NOT EXISTS sol_proyectos (
  id serial PRIMARY KEY,
  tarea_id int, titulo text NOT NULL,
  tipo text NOT NULL CHECK (tipo IN ('video','libro','campana','investigacion')),
  estado text NOT NULL DEFAULT 'queued' CHECK (estado IN ('queued','researching','planning','writing','reviewing','ready','completed','blocked','failed')),
  version int NOT NULL DEFAULT 0, carpeta text,
  componentes jsonb NOT NULL DEFAULT '{}', faltantes text[] NOT NULL DEFAULT '{}',
  solicitante text NOT NULL DEFAULT 'kratos', audiencia text, plataforma text,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
-- Experimental: predicciones con rango y confianza, comparadas luego con el resultado real.
CREATE TABLE IF NOT EXISTS sol_predicciones (
  id serial PRIMARY KEY,
  proyecto_id int REFERENCES sol_proyectos(id),
  hipotesis text NOT NULL, metrica text NOT NULL,
  rango_min numeric NOT NULL, rango_max numeric NOT NULL CHECK (rango_max >= rango_min),
  confianza numeric NOT NULL CHECK (confianza > 0 AND confianza < 1),
  base text NOT NULL,                                -- en qué se apoya: datos del canal, casos comparables, intuición…
  resultado numeric, acierto boolean, leccion text, resuelta_en timestamptz,
  created_by text NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS sol_fuentes_fts ON sol_fuentes USING gin (to_tsvector('simple', titulo || ' ' || coalesce(autores,'') || ' ' || coalesce(notas,'')));
CREATE INDEX IF NOT EXISTS sol_afirmaciones_fts ON sol_afirmaciones USING gin (to_tsvector('simple', texto || ' ' || coalesce(tema,'')));
UPDATE agent_functions SET allowed_tools = allowed_tools || ARRAY['biblioteca_sol','proyecto_sol','registrar_leccion'] WHERE id = 'sol' AND NOT ('biblioteca_sol' = ANY(allowed_tools));
