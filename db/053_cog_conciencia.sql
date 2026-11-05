-- Expansión cognitiva C06: laboratorio de investigación de teorías de la conciencia. NO es una declaración de conciencia:
-- ninguna fila puede afirmar experiencia subjetiva (CHECK) y cada demostración es un modelo computacional pequeño y aislado.
CREATE TABLE IF NOT EXISTS cog_teorias (
  codigo text PRIMARY KEY, nombre text NOT NULL, fuentes text[] NOT NULL,
  supuestos text NOT NULL, formulacion text NOT NULL, evidencia text NOT NULL, criticas text NOT NULL,
  predicciones jsonb NOT NULL, experimentos jsonb NOT NULL, limites text NOT NULL,
  analogo_en_kratos text NOT NULL, categoria_analogo text NOT NULL CHECK (categoria_analogo IN ('A','B','C','ninguno')),
  afirma_experiencia boolean NOT NULL DEFAULT false CHECK (afirma_experiencia = false),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS cog_demos (
  id serial PRIMARY KEY, teoria text NOT NULL REFERENCES cog_teorias(codigo), nombre text NOT NULL,
  prediccion text NOT NULL, criterio jsonb NOT NULL,          -- registrados antes de ejecutar
  registrada_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  sha256_codigo text NOT NULL, carpeta text, sha256_salida text, estado text NOT NULL DEFAULT 'pendiente' CHECK (estado IN ('pendiente','ok','error','timeout')),
  metricas jsonb, cumple boolean, detalle text, ejecutada_at timestamptz,
  afirma_experiencia boolean NOT NULL DEFAULT false CHECK (afirma_experiencia = false)
);
