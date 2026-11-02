-- Fábrica de contenido del canal Aion (2-nov-2026): base de ideas (evita repetir) y cola de producción/publicación.
CREATE TABLE IF NOT EXISTS content_ideas (
  id serial PRIMARY KEY,
  ciclo date NOT NULL,                       -- lunes del ciclo semanal
  titulo text NOT NULL,
  pilar text NOT NULL DEFAULT 'suenos',      -- suenos | jung | hermetica | misterios | meditacion
  fuente text,                               -- agente/idea que la propuso (trend, jung, misterio, historia, comodin)
  evidencia jsonb NOT NULL DEFAULT '[]',     -- [{url, dato}] solo datos comprobados; nunca volúmenes inventados
  puntuacion jsonb NOT NULL DEFAULT '{}',    -- {curiosidad, relevancia, demanda, competencia, originalidad, relato, credibilidad, viabilidad, shorts, coste}
  total numeric(4,2),                        -- media ponderada 0-10 (rúbrica en docs/fabrica-aion.md)
  estado text NOT NULL DEFAULT 'propuesta' CHECK (estado IN ('propuesta','elegida','descartada','producida')),
  huella text NOT NULL,                      -- hash del título normalizado para detectar repeticiones
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (huella)
);

CREATE TABLE IF NOT EXISTS content_queue (
  id serial PRIMARY KEY,
  tipo text NOT NULL CHECK (tipo IN ('largo','short')),
  titulo text NOT NULL,
  idea_id int REFERENCES content_ideas(id),
  padre_id int REFERENCES content_queue(id), -- el episodio del que sale un Short
  estado text NOT NULL DEFAULT 'IDEA' CHECK (estado IN ('IDEA','RESEARCH','SCRIPT','REVIEW','PRODUCTION','QA','APPROVED','SCHEDULED','PUBLISHED','ANALYZED','BLOQUEADO')),
  guion_ruta text,                           -- scripts/media/episodio/epN.py o plan del Short
  video_ruta text,
  youtube_id text,
  sale_el timestamptz,                       -- fecha programada (UTC)
  qa jsonb NOT NULL DEFAULT '{}',            -- {comprobacion: {ok, detalle}} de la puerta de calidad
  coste jsonb NOT NULL DEFAULT '{}',         -- {estimado_usd, real_usd, creditos_voz}; solo valores medidos en 'real'
  analitica jsonb NOT NULL DEFAULT '{}',     -- datos reales de YouTube Analytics tras publicar
  notas text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS content_queue_youtube_id ON content_queue (youtube_id) WHERE youtube_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS content_queue_estado ON content_queue (estado, sale_el);

-- Lo ya publicado/programado (2-nov-2026)
INSERT INTO content_queue (tipo, titulo, estado, youtube_id, sale_el, notas) VALUES
 ('largo','The Ancient Secret to Waking Up Inside Your Dreams','PUBLISHED','jsIGF__VRSI',NULL,'Episodio 1, voz Liam, miniatura A'),
 ('short','What if you woke up INSIDE your dream? The 1975 experiment','PUBLISHED','0P_r2vPXvK0',NULL,'Short 1'),
 ('short','3 steps to lucid dream tonight','SCHEDULED','1ZlK9fJDkTU','2026-11-03 00:00+00','Short 2'),
 ('short','Jung''s nigredo: the dark night where you meet your shadow','SCHEDULED','Na7UB4gywAo','2026-11-04 00:00+00','Short 3'),
 ('short','As above, so below: the hermetic secret of your dreams','SCHEDULED','x2ILTw-SXAE','2026-11-05 00:00+00','Short 4'),
 ('short','The 7-fingers test: how to know you are dreaming','SCHEDULED','6-6WU3caPKw','2026-11-06 00:00+00','Short 5')
ON CONFLICT DO NOTHING;

-- Los agentes leen la cola y las ideas (consultar_bd); las escribe el script de la fábrica con el rol de la aplicación
GRANT SELECT ON content_ideas, content_queue TO jarvis_agent;

-- Herramientas de lectura que necesitan los playbooks de la fábrica (idempotente: unión sin duplicados)
UPDATE agent_functions SET allowed_tools = (SELECT ARRAY(SELECT DISTINCT unnest(allowed_tools || ARRAY['estado_youtube','consultar_bd']))) WHERE id IN ('mercurio','venus');
UPDATE agent_functions SET allowed_tools = (SELECT ARRAY(SELECT DISTINCT unnest(allowed_tools || ARRAY['estado_youtube','consultar_bd','ver_playbooks','crear_tarea','ver_plan','registrar_leccion']))) WHERE id = 'jupiter';
