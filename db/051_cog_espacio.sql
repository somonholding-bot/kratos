-- Expansión cognitiva C04: espacio de trabajo global. Un solo objetivo principal ACTIVO; subtareas en secuencia; propiedad,
-- traspasos y mensajes con procedencia; conflictos; presupuesto; nunca COMPLETED sin artefacto de verificación independiente.
CREATE TABLE IF NOT EXISTS cog_objetivos (
  id serial PRIMARY KEY,
  padre_id int REFERENCES cog_objetivos(id), orden int NOT NULL DEFAULT 0,
  titulo text NOT NULL, descripcion text, criterio_exito text NOT NULL,
  estado text NOT NULL DEFAULT 'QUEUED' CHECK (estado IN ('QUEUED','ACTIVE','VERIFYING','COMPLETED','BLOCKED','FAILED','CANCELLED')),
  prioridad int NOT NULL DEFAULT 50,
  propietario text NOT NULL, creado_por text NOT NULL,
  presupuesto jsonb NOT NULL DEFAULT '{}', consumido jsonb NOT NULL DEFAULT '{}',
  aceptacion text NOT NULL,                    -- por qué se aceptó (explicación inspeccionable)
  artefacto_verificacion jsonb, motivo_cierre text,
  tarea_id int, huella text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), cerrado_at timestamptz
);
CREATE UNIQUE INDEX IF NOT EXISTS cog_un_objetivo_activo ON cog_objetivos ((true)) WHERE padre_id IS NULL AND estado IN ('ACTIVE','VERIFYING');
CREATE UNIQUE INDEX IF NOT EXISTS cog_una_subtarea_activa ON cog_objetivos (padre_id) WHERE padre_id IS NOT NULL AND estado IN ('ACTIVE','VERIFYING');
CREATE TABLE IF NOT EXISTS cog_transiciones (id serial PRIMARY KEY, objetivo_id int NOT NULL REFERENCES cog_objetivos(id), de text, a text NOT NULL, actor text NOT NULL, motivo text NOT NULL, at timestamptz NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS cog_mensajes (
  id serial PRIMARY KEY, objetivo_id int REFERENCES cog_objetivos(id),
  de text NOT NULL, para text NOT NULL DEFAULT 'todos',
  tipo text NOT NULL CHECK (tipo IN ('informacion','referencia','traspaso','conflicto','cierre','presupuesto')),
  prioridad int NOT NULL DEFAULT 50, contenido text NOT NULL, referencias jsonb NOT NULL DEFAULT '[]', procedencia text NOT NULL,
  leido_por text[] NOT NULL DEFAULT '{}', at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS cog_conflictos (
  id serial PRIMARY KEY, objetivo_id int NOT NULL REFERENCES cog_objetivos(id), partes text[] NOT NULL, descripcion text NOT NULL,
  estado text NOT NULL DEFAULT 'abierto' CHECK (estado IN ('abierto','resuelto')), resolucion text, resuelto_por text, at timestamptz NOT NULL DEFAULT now(), resuelto_at timestamptz
);
