-- Funciones nuevas que KRATOS se programa a sí mismo. Nunca tocan el código central:
-- son pequeños programas aislados que solo se activan cuando el propietario los aprueba en el panel.
CREATE TABLE IF NOT EXISTS plugins (
  id serial PRIMARY KEY,
  name text NOT NULL,
  slug text NOT NULL,
  description text NOT NULL,
  when_to_use text NOT NULL,
  input_schema jsonb NOT NULL DEFAULT '{"type":"object","properties":{},"required":[],"additionalProperties":false}',
  code text NOT NULL,
  version int NOT NULL DEFAULT 1,
  status text NOT NULL DEFAULT 'propuesta' CHECK (status IN ('propuesta','activa','rechazada','desactivada','sustituida')),
  approval_id int REFERENCES approvals(id),
  created_by text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  activated_at timestamptz,
  runs int NOT NULL DEFAULT 0,
  last_error text
);
CREATE UNIQUE INDEX IF NOT EXISTS plugins_activa ON plugins (slug) WHERE status = 'activa';
