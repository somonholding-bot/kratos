-- Mensajes de texto recibidos (iMessage/SMS) que la app de Mac lee en voz alta al llegar.
-- Se guardan para que KRATOS sepa a quién responder («respóndele que sí»). Solo los que llegan con la app abierta.
CREATE TABLE IF NOT EXISTS sms_inbox (
  id serial PRIMARY KEY,
  at timestamptz NOT NULL DEFAULT now(),
  source_rowid bigint UNIQUE,
  sender text NOT NULL,
  name text,
  body text NOT NULL,
  service text
);
CREATE INDEX IF NOT EXISTS sms_inbox_at ON sms_inbox (at DESC);
