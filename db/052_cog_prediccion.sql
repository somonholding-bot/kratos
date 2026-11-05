-- Expansión cognitiva C05: predicción y aprendizaje activo. La predicción se registra ANTES de observar y no se puede editar después
-- (lo impide un disparador); la observación se registra una sola vez y el error de predicción actualiza las creencias.
CREATE TABLE IF NOT EXISTS cog_creencias (
  contexto text NOT NULL, clave text NOT NULL,
  media double precision NOT NULL, varianza double precision NOT NULL CHECK (varianza > 0), ruido double precision NOT NULL CHECK (ruido > 0),
  n int NOT NULL DEFAULT 0, actualizado timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (contexto, clave)
);
CREATE TABLE IF NOT EXISTS cog_predicciones (
  id serial PRIMARY KEY, actor text NOT NULL, contexto text NOT NULL, clave text NOT NULL,
  hipotesis text, decision text,                       -- la decisión que se tomó apoyándose en esta predicción
  valor double precision NOT NULL, rango_min double precision NOT NULL, rango_max double precision NOT NULL, incertidumbre double precision NOT NULL,
  registrada_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  observado double precision, observado_at timestamptz, evidencia text,
  error double precision, dentro_rango boolean, revision text,
  creencia_antes jsonb, creencia_despues jsonb, experimento_ref text,
  CHECK (rango_min <= valor AND valor <= rango_max),
  CHECK (observado_at IS NULL OR observado_at >= registrada_at)
);
CREATE INDEX IF NOT EXISTS cog_predicciones_ctx ON cog_predicciones (contexto, clave);
CREATE OR REPLACE FUNCTION cog_prediccion_inmutable() RETURNS trigger AS $$
BEGIN
  IF NEW.valor IS DISTINCT FROM OLD.valor OR NEW.rango_min IS DISTINCT FROM OLD.rango_min OR NEW.rango_max IS DISTINCT FROM OLD.rango_max
     OR NEW.incertidumbre IS DISTINCT FROM OLD.incertidumbre OR NEW.registrada_at IS DISTINCT FROM OLD.registrada_at OR NEW.contexto IS DISTINCT FROM OLD.contexto OR NEW.clave IS DISTINCT FROM OLD.clave THEN
    RAISE EXCEPTION 'Una predicción registrada no se modifica (id %)', OLD.id;
  END IF;
  IF OLD.observado IS NOT NULL AND NEW.observado IS DISTINCT FROM OLD.observado THEN
    RAISE EXCEPTION 'La observación de la predicción % ya está registrada', OLD.id;
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS cog_prediccion_inmutable ON cog_predicciones;
CREATE TRIGGER cog_prediccion_inmutable BEFORE UPDATE ON cog_predicciones FOR EACH ROW EXECUTE FUNCTION cog_prediccion_inmutable();
