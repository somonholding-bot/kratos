-- Páginas web de KRATOS (GitHub Pages) para vender y validar ideas; el botón suele ser un enlace de pago de Stripe.
CREATE TABLE IF NOT EXISTS paginas_web (
  id serial PRIMARY KEY, slug text NOT NULL UNIQUE, url text NOT NULL, titulo text NOT NULL, cta_url text NOT NULL,
  oportunidad_id int REFERENCES ksie_oportunidades(id), creado_por text NOT NULL, creado_en timestamptz NOT NULL DEFAULT now(), actualizado timestamptz NOT NULL DEFAULT now()
);
UPDATE agent_functions SET allowed_tools = (SELECT array(SELECT DISTINCT unnest(allowed_tools || ARRAY['paginas_web']))) WHERE id IN ('jupiter','mercurio','venus');
