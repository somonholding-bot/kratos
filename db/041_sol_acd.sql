-- PROJECT SOL / ACD (directiva del propietario del 5-nov-2026, docs/SOL-DIRECTIVA-ACD.md). Esquema común; no se borra nada previo.

-- 1) Procedencia ampliada de las fuentes (R01–R16, A05)
ALTER TABLE sol_fuentes ADD COLUMN IF NOT EXISTS doi text;
ALTER TABLE sol_fuentes ADD COLUMN IF NOT EXISTS identificador text;          -- arXiv id, PMCID, OSTI id, identificador de Internet Archive, ruta de archivo…
ALTER TABLE sol_fuentes ADD COLUMN IF NOT EXISTS conector text;               -- R01…R16 que la trajo (NULL = registrada a mano)
ALTER TABLE sol_fuentes ADD COLUMN IF NOT EXISTS estado_publicacion text NOT NULL DEFAULT 'desconocido'
  CHECK (estado_publicacion IN ('publicado','preprint','retractado','corregido','manuscrito','libro','documento','desconocido'));
ALTER TABLE sol_fuentes ADD COLUMN IF NOT EXISTS fecha_publicacion text;      -- tal como la da el origen (año o fecha)
ALTER TABLE sol_fuentes ADD COLUMN IF NOT EXISTS texto_disponible boolean;    -- hay texto completo legal disponible
ALTER TABLE sol_fuentes ADD COLUMN IF NOT EXISTS permisos text;               -- licencia, dominio público, solo metadatos…
ALTER TABLE sol_fuentes ADD COLUMN IF NOT EXISTS correcciones text;           -- erratas, retractaciones, contradicciones conocidas
ALTER TABLE sol_fuentes ADD COLUMN IF NOT EXISTS revisada_en timestamptz;     -- última comprobación de retractación/corrección
CREATE UNIQUE INDEX IF NOT EXISTS sol_fuentes_doi_unico ON sol_fuentes (lower(doi)) WHERE doi IS NOT NULL;

-- Pruebas en vivo de cada conector (evidencia de A04)
CREATE TABLE IF NOT EXISTS sol_conectores_pruebas (
  id serial PRIMARY KEY,
  codigo text NOT NULL CHECK (codigo ~ '^R[0-9]{2}$'),
  ok boolean NOT NULL, resultados int, ms int, detalle text,
  probado_en timestamptz NOT NULL DEFAULT now()
);

-- 2) Grafo: naturaleza de cada conexión y materias que une (A07)
ALTER TABLE sol_conexiones ADD COLUMN IF NOT EXISTS naturaleza text CHECK (naturaleza IN ('evidencia','interpretacion','especulacion'));
ALTER TABLE sol_conexiones ADD COLUMN IF NOT EXISTS tema_desde text;
ALTER TABLE sol_conexiones ADD COLUMN IF NOT EXISTS tema_hacia text;
UPDATE sol_conexiones SET naturaleza = CASE
  WHEN tipo IN ('experimental','causal','correlacional','contradictoria','historica') THEN 'evidencia'
  WHEN tipo IN ('conceptual','metaforica') THEN 'interpretacion' ELSE 'especulacion' END
WHERE naturaleza IS NULL;

-- 3) Unidades de investigación: 56 materias (S/H/V), 12 puentes (B) y 12 temas de ingeniería generativa (G).
--    Las siembra src/core/sol-def.ts; el planificador las lanza. El currículo anterior (sol_modulos) se conserva.
CREATE TABLE IF NOT EXISTS sol_unidades (
  codigo text PRIMARY KEY CHECK (codigo ~ '^(S|H|V|B|G)[0-9]{2}$'),
  tipo text NOT NULL CHECK (tipo IN ('materia','puente','generativa')),
  area text NOT NULL,
  titulo text NOT NULL,
  alcance text NOT NULL,
  orden int NOT NULL,
  relacionadas text[] NOT NULL DEFAULT '{}',        -- otras unidades con las que se enlaza (p. ej. un puente y sus materias)
  modulos_previos int[] NOT NULL DEFAULT '{}',       -- módulos de sol_modulos que ya cubren parte (se reutilizan, no se repiten)
  estado text NOT NULL DEFAULT 'pendiente' CHECK (estado IN ('pendiente','en_curso','estudiada','evaluada','fallida')),
  tarea_id int, proyecto_id int, intentos int NOT NULL DEFAULT 0,
  lanzado_en timestamptz, completado_en timestamptz
);
-- Módulos antiguos que una materia nueva absorbe (no se estudian dos veces)
ALTER TABLE sol_modulos DROP CONSTRAINT IF EXISTS sol_modulos_estado_check;
ALTER TABLE sol_modulos ADD CONSTRAINT sol_modulos_estado_check CHECK (estado IN ('pendiente','en_curso','completado','fallido','fusionado'));
ALTER TABLE sol_modulos ADD COLUMN IF NOT EXISTS fusionado_en text;    -- código de la materia nueva que lo absorbe

-- Exámenes de dominio (A03): los crea y califica un examinador independiente (Saturno); Sol solo responde y nunca ve la rúbrica.
CREATE TABLE IF NOT EXISTS sol_examenes (
  id serial PRIMARY KEY,
  unidad text NOT NULL REFERENCES sol_unidades(codigo),
  estado text NOT NULL DEFAULT 'creado' CHECK (estado IN ('creado','respondido','calificado')),
  preguntas jsonb NOT NULL,              -- [{n, pregunta}]
  rubrica jsonb NOT NULL,                -- [{n, criterios}] — nunca se muestra a Sol
  respuestas jsonb,                      -- [{n, respuesta}]
  notas jsonb,                           -- [{n, nota 0-1, comentario}]
  nota numeric, aprobado boolean,
  creado_por text NOT NULL, respondido_por text, calificado_por text,
  created_at timestamptz NOT NULL DEFAULT now(), respondido_en timestamptz, calificado_en timestamptz
);

ALTER TABLE sol_proyectos DROP CONSTRAINT IF EXISTS sol_proyectos_tipo_check;
ALTER TABLE sol_proyectos ADD CONSTRAINT sol_proyectos_tipo_check CHECK (tipo IN ('video','libro','campana','investigacion','modulo','materia','puente','acd'));
ALTER TABLE sol_proyectos ADD COLUMN IF NOT EXISTS requisito text;   -- S01…G12 cuando el proyecto es el expediente de una unidad

-- 4) Motor ACD (D01–D12, E01–E12)
CREATE TABLE IF NOT EXISTS acd_preguntas (
  id serial PRIMARY KEY,
  texto text NOT NULL,
  area text,
  origen text NOT NULL CHECK (origen IN ('curiosidad','campana','puente','materia','propietario','kratos')),
  motivo text,                                   -- qué contradicción, hueco o fallo la motivó
  unidades text[] NOT NULL DEFAULT '{}',         -- materias/puentes que la originan
  fuente_ids int[] NOT NULL DEFAULT '{}',
  campana text,
  estado text NOT NULL DEFAULT 'abierta' CHECK (estado IN ('abierta','en_estudio','respondida','descartada')),
  created_by text NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS acd_hipotesis (
  id serial PRIMARY KEY,
  pregunta_id int REFERENCES acd_preguntas(id),
  padres int[] NOT NULL DEFAULT '{}',            -- linaje (D04)
  operacion text NOT NULL DEFAULT 'imaginar' CHECK (operacion IN ('imaginar','modificar','combinar','refinar')),
  titulo text NOT NULL,
  enunciado text NOT NULL,
  mecanismo text NOT NULL,
  supuestos text,
  arte_previo text,                              -- E03: qué existe ya y en qué se diferencia
  fuente_ids int[] NOT NULL DEFAULT '{}',
  novedad text NOT NULL DEFAULT 'sin_revisar' CHECK (novedad IN ('sin_revisar','conocida','variante','posiblemente_nueva')),
  importancia numeric, novedad_puntos numeric, coherencia numeric, testabilidad numeric, coste numeric, evidencia numeric,
  prioridad numeric,
  estado text NOT NULL DEFAULT 'propuesta' CHECK (estado IN ('propuesta','seleccionada','formalizada','probada','apoyada_provisional','refutada','rechazada','revisada','archivada')),
  motivo_estado text,
  campana text,
  created_by text NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS acd_modelos (
  id serial PRIMARY KEY,
  hipotesis_id int NOT NULL REFERENCES acd_hipotesis(id),
  version int NOT NULL DEFAULT 1,
  tipo text NOT NULL CHECK (tipo IN ('ecuaciones','simulacion','algoritmo','causal','estadistico')),
  descripcion text NOT NULL,
  variables text NOT NULL,
  supuestos text,
  predicciones text NOT NULL,                    -- E06: predicciones falsables
  falsacion text NOT NULL,                       -- qué resultado la contradiría
  baseline text NOT NULL,                        -- E08: con qué se compara
  codigo text NOT NULL, lenguaje text NOT NULL DEFAULT 'python', sha256 text NOT NULL,
  created_by text NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS acd_experimentos (
  id serial PRIMARY KEY,
  modelo_id int NOT NULL REFERENCES acd_modelos(id),
  estado text NOT NULL CHECK (estado IN ('ejecutando','ok','error','timeout','contrato_invalido')),
  datos text CHECK (datos IN ('sintetico','observado','mixto','ninguno')),  -- D03: simulado u observado
  carpeta text, inicio timestamptz NOT NULL DEFAULT now(), fin timestamptz, duracion_ms int, exit_code int,
  sha256_codigo text, sha256_salida text,
  resultado jsonb, comparacion jsonb,
  veredicto text CHECK (veredicto IN ('a_favor','en_contra','no_concluyente','invalido')),
  created_by text NOT NULL
);
CREATE TABLE IF NOT EXISTS acd_criticas (
  id serial PRIMARY KEY,
  objeto text NOT NULL CHECK (objeto IN ('hipotesis','modelo','experimento')),
  objeto_id int NOT NULL,
  critico text NOT NULL,                         -- nunca el agente que generó el objeto (lo impone el código)
  veredicto text NOT NULL CHECK (veredicto IN ('aceptar','revisar','rechazar')),
  objeciones text NOT NULL,
  puntos jsonb,
  tarea_id int,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS acd_hipotesis_campana ON acd_hipotesis (campana);
CREATE INDEX IF NOT EXISTS acd_preguntas_campana ON acd_preguntas (campana);

-- Cuotas nuevas (las de aprendizaje existentes no cambian: omega_modulos_dia sigue igual)
INSERT INTO system_state (key, value) VALUES ('acd_tareas_dia', '4') ON CONFLICT (key) DO NOTHING;
INSERT INTO system_state (key, value) VALUES ('sol_examenes_dia', '4') ON CONFLICT (key) DO NOTHING;

-- 5) Rastreador permanente de los 139 requisitos
CREATE TABLE IF NOT EXISTS sol_requisitos (
  id text PRIMARY KEY CHECK (id ~ '^(S|H|V|R|B|G|D|E|A)[0-9]{2}$'),
  etapa int NOT NULL CHECK (etapa IN (1,2,3)),
  grupo text NOT NULL,
  descripcion text NOT NULL,
  estado text NOT NULL DEFAULT 'NOT_STARTED' CHECK (estado IN ('NOT_STARTED','IN_PROGRESS','IMPLEMENTED_UNVERIFIED','VERIFIED','PARTIAL','BLOCKED','FAILED')),
  evidencia text,
  verificado_en timestamptz,
  pendiente text,
  siguiente text,
  updated_at timestamptz NOT NULL DEFAULT now()
);
