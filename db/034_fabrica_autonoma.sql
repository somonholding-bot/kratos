-- Fábrica autónoma de Aion (2-nov-2026): KRATOS produce, revisa y sube como privado desde la cola (herramienta fabrica_aion).
-- La miniatura propia no se puede leer en la API de YouTube (siempre hay una automática): se registra cuando thumbnails.set responde bien.
ALTER TABLE content_queue ADD COLUMN IF NOT EXISTS miniatura_ruta text;
ALTER TABLE content_queue ADD COLUMN IF NOT EXISTS miniatura_at timestamptz;   -- cuándo YouTube aceptó la miniatura propia
