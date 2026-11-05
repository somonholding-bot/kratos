-- Expansión cognitiva C03: memoria autobiográfica. Registros inmutables con procedencia; una corrección crea un registro nuevo y
-- deja el original marcado (nunca se borra). Distingue recuerdos verificados de resúmenes inferidos.
CREATE TABLE IF NOT EXISTS cog_experiencias (
  id text PRIMARY KEY,                         -- EXP-<fecha>-<huella corta>
  huella text NOT NULL UNIQUE,                 -- sha256 del contenido normalizado (sin duplicados)
  fecha timestamptz NOT NULL DEFAULT now(),
  agente text NOT NULL, tarea_id int,
  objetivo text NOT NULL,
  acciones jsonb NOT NULL DEFAULT '[]', herramientas text[] NOT NULL DEFAULT '{}',
  evidencia text, resultado text NOT NULL CHECK (resultado IN ('exito','fallo','parcial','desconocido')),
  detalle_resultado text,
  clasificacion_error text,                    -- verificacion | herramienta | datos | estrategia | permisos | entorno | otro
  correccion text, leccion text,
  enlaces jsonb NOT NULL DEFAULT '[]',         -- [{tipo, ref}]
  certeza text NOT NULL CHECK (certeza IN ('verificado','inferido')),
  procedencia text NOT NULL,                   -- tasks | lessons | cog_decisiones | agente:<x> | propietario
  estado text NOT NULL DEFAULT 'vigente' CHECK (estado IN ('vigente','corregido','retractado')),
  corregido_por text REFERENCES cog_experiencias(id), motivo_correccion text,
  repeticiones int NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS cog_experiencias_tarea ON cog_experiencias (tarea_id);
CREATE INDEX IF NOT EXISTS cog_experiencias_busq ON cog_experiencias USING gin (to_tsvector('spanish', objetivo || ' ' || coalesce(leccion, '') || ' ' || coalesce(detalle_resultado, '') || ' ' || coalesce(correccion, '')));
