-- Fase C del sistema híbrido (1-nov-2026): registro central de herramientas.
-- Se sincroniza desde el código al arrancar servidor y worker (src/core/toolregistry.ts); el uso y los errores salen de audit_log.
CREATE TABLE IF NOT EXISTS tool_registry (
  name text PRIMARY KEY,
  origin text NOT NULL,                       -- core | plugin | web
  description text NOT NULL DEFAULT '',
  toolsets text[] NOT NULL DEFAULT '{}',      -- texto | voz | ceo (quién la ve en conversación o en el ciclo del CEO)
  agents text[] NOT NULL DEFAULT '{}',        -- especialistas que pueden usarla (allowed_tools ∩ herramientas seguras)
  strict boolean NOT NULL DEFAULT false,      -- recibe datos y los valida (las de solo consulta no)
  needs_approval boolean NOT NULL DEFAULT false,
  active boolean NOT NULL DEFAULT true,
  synced_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS audit_log_herramienta_idx ON audit_log (action, at DESC) WHERE action LIKE 'herramienta.%';
