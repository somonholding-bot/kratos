-- Ventas con Stripe (productos y enlaces de pago creados por KRATOS) y presupuesto mensual de pruebas (100 USD, orden del propietario).
CREATE TABLE IF NOT EXISTS stripe_productos (
  id serial PRIMARY KEY, producto_id text NOT NULL UNIQUE, precio_id text NOT NULL, enlace_id text NOT NULL, url text NOT NULL,
  nombre text NOT NULL, precio_cents int NOT NULL, recurrente boolean NOT NULL DEFAULT false, preventa boolean NOT NULL DEFAULT false,
  oportunidad_id int REFERENCES ksie_oportunidades(id), creado_por text NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE experiments ADD COLUMN IF NOT EXISTS reserva_clave text;
INSERT INTO system_state (key, value) VALUES ('presupuesto_pruebas_mensual_cents', '10000') ON CONFLICT (key) DO NOTHING;
