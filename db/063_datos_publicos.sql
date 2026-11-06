-- Datos públicos reales para ACD (orden del propietario, 5-nov-2026): Sol deja de depender solo de simulaciones.
-- Los archivos se descargan desde fuentes permitidas a .jarvis/acd/datos/ y se copian a la carpeta del experimento (el sandbox sigue sin red).
CREATE TABLE IF NOT EXISTS datos_publicos (
  nombre text PRIMARY KEY,                 -- p. ej. gcp:2015-01-01
  fuente text NOT NULL, url text NOT NULL, ruta text NOT NULL, sha256 text NOT NULL, bytes bigint NOT NULL,
  descripcion text, descargado_at timestamptz NOT NULL DEFAULT now(), descargado_por text NOT NULL
);
ALTER TABLE acd_modelos ADD COLUMN IF NOT EXISTS datasets text[] NOT NULL DEFAULT '{}';
UPDATE agent_functions SET allowed_tools = (SELECT array(SELECT DISTINCT unnest(allowed_tools || ARRAY['datos_publicos']))) WHERE id IN ('sol','saturno');
