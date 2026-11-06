-- Correo propio de KRATOS (streetlumos@gmail.com): registro de lo enviado y recibido, y lista de bajas que siempre se respeta.
CREATE TABLE IF NOT EXISTS correo_kratos (
  id serial PRIMARY KEY, direccion text NOT NULL CHECK (direccion IN ('enviado','recibido')), contraparte text NOT NULL, asunto text, cuerpo text,
  tipo text NOT NULL, message_id text, uid bigint, leido boolean NOT NULL DEFAULT false, fecha timestamptz NOT NULL DEFAULT now(), actor text NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS correo_kratos_uid ON correo_kratos (uid) WHERE direccion = 'recibido';
CREATE TABLE IF NOT EXISTS correo_bajas (email text PRIMARY KEY, at timestamptz NOT NULL DEFAULT now());
UPDATE agent_functions SET allowed_tools = (SELECT array(SELECT DISTINCT unnest(allowed_tools || ARRAY['correo_kratos']))) WHERE id IN ('jupiter','mercurio','venus','luna');
