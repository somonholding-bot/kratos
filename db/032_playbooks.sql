-- Fase D del sistema híbrido (2-nov-2026): playbooks (procedimientos reutilizables, versionados y verificables).
-- El archivo playbooks/<agente>/<id>.json es la semilla; la base de datos es la verdad (versiones, estado, historial).
CREATE TABLE IF NOT EXISTS playbooks (
  id text PRIMARY KEY,                                   -- minúsculas, guiones: yt-guion-ritual-lunar
  nombre text NOT NULL,
  agente text NOT NULL REFERENCES agent_functions(id),   -- especialista responsable
  estado text NOT NULL DEFAULT 'prueba' CHECK (estado IN ('prueba','produccion','retirado')),
  version_activa int NOT NULL DEFAULT 1,
  exitos int NOT NULL DEFAULT 0,                         -- ejecuciones completadas y verificadas
  fallos int NOT NULL DEFAULT 0,
  fallos_seguidos int NOT NULL DEFAULT 0,                -- se reinicia con cada éxito y al activar una versión
  coste_medido jsonb NOT NULL DEFAULT '{}',              -- {muestras, duracion_media_min, usd_medio}
  archivo text,                                          -- semilla en el repositorio (si la hay)
  creado_por text NOT NULL DEFAULT 'sistema',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS playbook_versions (
  id serial PRIMARY KEY,
  playbook_id text NOT NULL REFERENCES playbooks(id),
  version int NOT NULL,
  contenido jsonb NOT NULL,                              -- el playbook completo (ver playbooks/README.md)
  hash text NOT NULL,                                    -- sha256 del contenido canónico
  estado text NOT NULL DEFAULT 'activa' CHECK (estado IN ('activa','sustituida','borrador','rechazada')),
  origen text NOT NULL DEFAULT 'archivo',                -- archivo | ceo | propietario | reversion
  causa text,                                            -- mejora | fallo | archivo | reversion
  motivo text,
  revierte_a int,                                        -- versión restaurada (origen reversion)
  autor text NOT NULL DEFAULT 'sistema',
  created_at timestamptz NOT NULL DEFAULT now(),
  activated_at timestamptz,
  UNIQUE (playbook_id, version)
);
CREATE INDEX IF NOT EXISTS playbook_versions_activa_idx ON playbook_versions (playbook_id) WHERE estado = 'activa';

-- Cada tarea sabe con qué versión del playbook se creó: verify.ts usa exactamente esa versión
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS playbook_version int;

-- Saturno analiza el canal con datos reales (análisis semanal): necesita estado_youtube (solo lectura)
UPDATE agent_functions SET allowed_tools = array_append(allowed_tools, 'estado_youtube')
  WHERE id = 'saturno' AND NOT ('estado_youtube' = ANY(allowed_tools));
