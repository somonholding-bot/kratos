-- KSIE TAREAS 01–02: registro de capacidades de herramientas (complementa tool_registry y cog_capacidades, no los sustituye)
-- y registro de selecciones de herramientas para enrutar, replanificar y medir el aprendizaje.
CREATE TABLE IF NOT EXISTS ksie_herramientas (
  nombre text PRIMARY KEY,                       -- = tool_registry.name, o «sistema:<binario>» si solo se descubrió en el equipo
  descripcion text, operaciones text[] NOT NULL DEFAULT '{}', entradas text, salidas text,
  autenticacion text NOT NULL DEFAULT 'ninguna', autenticacion_ok boolean,
  permisos text NOT NULL DEFAULT 'libre',        -- libre | aprobacion_propietario | solo_propietario
  compatibilidad text NOT NULL DEFAULT 'macOS (Apple Silicon)',
  coste text NOT NULL DEFAULT 'gratis_local',    -- gratis_local | gratis_externo | suscripcion | api_pago
  latencia text NOT NULL DEFAULT 'segundos',     -- instantanea | segundos | minutos | horas
  recursos text, limitaciones text,
  privacidad text NOT NULL DEFAULT 'local',      -- local | externo_publico | externo_privado
  estado text NOT NULL CHECK (estado IN ('DISCOVERED','INSTALLED','CONFIGURED','AVAILABLE','VERIFIED','DEGRADED','UNAVAILABLE')),
  estado_motivo text, ultimo_exito timestamptz, ultimo_fallo timestamptz, fiabilidad numeric, evidencia text,
  actualizado timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS ksie_selecciones (
  id serial PRIMARY KEY, actor text NOT NULL, necesidad text NOT NULL, operaciones text[] NOT NULL,
  candidatas jsonb NOT NULL, elegidas text[] NOT NULL, sin_herramientas boolean NOT NULL DEFAULT false, huecos jsonb NOT NULL DEFAULT '[]',
  motivo text NOT NULL, resultado text NOT NULL DEFAULT 'pendiente' CHECK (resultado IN ('pendiente','exito','insuficiente','fallo')),
  herramienta_resultado text, detalle text, replanificada_de int REFERENCES ksie_selecciones(id),
  created_at timestamptz NOT NULL DEFAULT now(), resuelta_at timestamptz
);
