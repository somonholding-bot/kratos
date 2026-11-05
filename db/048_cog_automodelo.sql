-- Expansión cognitiva C01: automodelo funcional. Las capacidades se evalúan con observaciones reales (pruebas y uso), no con autodescripciones.
CREATE TABLE IF NOT EXISTS cog_capacidades (
  capacidad text PRIMARY KEY,                    -- herramienta:<nombre>, conector:R01, subsistema:<nombre>, dependencia:<nombre>
  tipo text NOT NULL CHECK (tipo IN ('herramienta','conector','subsistema','dependencia','agente')),
  descripcion text,
  instalada boolean NOT NULL DEFAULT false,      -- el código o el binario existe
  disponible boolean NOT NULL DEFAULT false,     -- registrada/activa y con sus dependencias presentes
  pruebas_ok int NOT NULL DEFAULT 0, pruebas_fallo int NOT NULL DEFAULT 0,
  ultima_ok timestamptz, ultimo_fallo timestamptz, detalle_fallo text,
  evidencia text,
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS cog_capacidad_pruebas (   -- historial de cada prueba (base de la confianza)
  id serial PRIMARY KEY, capacidad text NOT NULL REFERENCES cog_capacidades(capacidad), ok boolean NOT NULL,
  evidencia text NOT NULL, origen text NOT NULL, at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS cog_automodelo (id serial PRIMARY KEY, modelo jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT now());
