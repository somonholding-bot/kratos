-- Jarvis · esquema inicial (Etapa B)
-- Reglas: importes en centavos enteros; toda tabla de negocio lleva business_id
-- y RLS para el rol jarvis_agent; el registro de auditoría es de solo inserción.

CREATE TABLE IF NOT EXISTS schema_migrations (
  version text PRIMARY KEY,
  applied_at timestamptz NOT NULL DEFAULT now()
);

-- Estado global (parada de emergencia, pausa de automatizaciones, nivel de autonomía)
CREATE TABLE system_state (
  key text PRIMARY KEY,
  value jsonb NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by text NOT NULL DEFAULT 'sistema'
);
INSERT INTO system_state (key, value) VALUES
  ('emergency_stop', 'false'),
  ('automations_paused', 'false'),
  ('autonomy_level', '0'),
  ('ai_mode', '"demo"');

-- Negocios y productos
CREATE TABLE businesses (
  id serial PRIMARY KEY,
  name text NOT NULL,
  owner text NOT NULL DEFAULT 'propietario',
  is_demo boolean NOT NULL DEFAULT false,
  goals jsonb NOT NULL DEFAULT '[]',
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE products (
  id serial PRIMARY KEY,
  business_id int NOT NULL REFERENCES businesses(id),
  name text NOT NULL,
  platforms text[] NOT NULL DEFAULT '{}',
  audience text,
  markets text[] NOT NULL DEFAULT '{}',
  revenue_model text,
  is_demo boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Expediente: cada entrada declara su naturaleza
CREATE TABLE knowledge_items (
  id serial PRIMARY KEY,
  business_id int NOT NULL REFERENCES businesses(id),
  product_id int REFERENCES products(id),
  kind text NOT NULL CHECK (kind IN ('hecho','hipotesis','decision_aprobada','observacion','externo_no_confiable','caducado')),
  topic text NOT NULL,
  content text NOT NULL,
  source text NOT NULL,
  valid_until timestamptz,
  is_demo boolean NOT NULL DEFAULT false,
  created_by text NOT NULL DEFAULT 'sistema',
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX knowledge_fts ON knowledge_items USING gin (to_tsvector('spanish', topic || ' ' || content));

-- Funciones (departamentos). Configuración, no procesos.
CREATE TABLE agent_functions (
  id text PRIMARY KEY,
  name text NOT NULL,
  purpose text NOT NULL,
  model text NOT NULL,
  allowed_tools text[] NOT NULL DEFAULT '{}',
  prohibited text[] NOT NULL DEFAULT '{}',
  escalation text NOT NULL,
  daily_token_quota int NOT NULL DEFAULT 0
);

-- Tareas persistentes
CREATE TABLE tasks (
  id serial PRIMARY KEY,
  business_id int NOT NULL REFERENCES businesses(id),
  product_id int REFERENCES products(id),
  owner_function text NOT NULL REFERENCES agent_functions(id),
  type text NOT NULL,                       -- manejador que la ejecuta
  title text NOT NULL,
  objective text NOT NULL,
  priority int NOT NULL DEFAULT 3 CHECK (priority BETWEEN 1 AND 5), -- 1 = máxima
  inputs jsonb NOT NULL DEFAULT '{}',
  allowed_actions text[] NOT NULL DEFAULT '{}',
  quota jsonb NOT NULL DEFAULT '{}',
  budget_account_id int,
  has_side_effects boolean NOT NULL DEFAULT false,
  run_at timestamptz NOT NULL DEFAULT now(),
  recurrence_minutes int,                   -- NULL = una sola vez
  depends_on int REFERENCES tasks(id),
  status text NOT NULL DEFAULT 'pendiente' CHECK (status IN
    ('pendiente','en_ejecucion','completada','fallida','cancelada','esperando_permiso','esperando_ia','requiere_revision','bloqueada')),
  expected_result text NOT NULL,
  verification text NOT NULL,
  attempts int NOT NULL DEFAULT 0,
  max_attempts int NOT NULL DEFAULT 3,
  locked_by text,
  locked_until timestamptz,
  idempotency_key text UNIQUE,
  result jsonb,
  last_error text,
  is_demo boolean NOT NULL DEFAULT false,
  created_by text NOT NULL DEFAULT 'sistema',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX tasks_due ON tasks (status, run_at, priority);

-- Presupuesto determinista
CREATE TABLE budget_accounts (
  id serial PRIMARY KEY,
  business_id int REFERENCES businesses(id),  -- NULL = global
  scope text NOT NULL CHECK (scope IN ('global','negocio','producto','canal','experimento','operacion')),
  label text NOT NULL,
  currency text NOT NULL DEFAULT 'USD',
  limit_cents bigint NOT NULL DEFAULT 0 CHECK (limit_cents >= 0),
  reserved_cents bigint NOT NULL DEFAULT 0 CHECK (reserved_cents >= 0),
  spent_cents bigint NOT NULL DEFAULT 0 CHECK (spent_cents >= 0),
  valid_until timestamptz,
  status text NOT NULL DEFAULT 'activa' CHECK (status IN ('activa','suspendida')),
  is_demo boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (reserved_cents + spent_cents <= limit_cents)
);
ALTER TABLE tasks ADD CONSTRAINT tasks_budget_fk FOREIGN KEY (budget_account_id) REFERENCES budget_accounts(id);

CREATE TABLE budget_movements (
  id bigserial PRIMARY KEY,
  account_id int NOT NULL REFERENCES budget_accounts(id),
  kind text NOT NULL CHECK (kind IN ('asignacion','reserva','liberacion','cargo')),
  amount_cents bigint NOT NULL CHECK (amount_cents >= 0),
  idempotency_key text NOT NULL UNIQUE,
  task_id int REFERENCES tasks(id),
  note text,
  actor text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Aprobaciones: alcance, cuenta, importe máximo y vigencia
CREATE TABLE approvals (
  id serial PRIMARY KEY,
  business_id int REFERENCES businesses(id),
  kind text NOT NULL,
  description text NOT NULL,
  scope jsonb NOT NULL DEFAULT '{}',
  account_label text,
  max_amount_cents bigint,
  valid_until timestamptz NOT NULL,
  status text NOT NULL DEFAULT 'pendiente' CHECK (status IN ('pendiente','aprobada','rechazada','caducada','ejecutada')),
  requested_by text NOT NULL,
  task_id int REFERENCES tasks(id),
  decided_at timestamptz,
  decided_via text,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Registro auditable (solo inserción)
CREATE TABLE audit_log (
  id bigserial PRIMARY KEY,
  at timestamptz NOT NULL DEFAULT now(),
  actor text NOT NULL,
  action text NOT NULL,
  business_id int,
  details jsonb NOT NULL DEFAULT '{}'
);
CREATE FUNCTION audit_log_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'audit_log es de solo inserción'; END $$;
CREATE TRIGGER audit_log_no_update BEFORE UPDATE OR DELETE ON audit_log
  FOR EACH ROW EXECUTE FUNCTION audit_log_immutable();

-- Conversación (texto y, desde la Etapa C, voz)
CREATE TABLE messages (
  id bigserial PRIMARY KEY,
  business_id int REFERENCES businesses(id),
  role text NOT NULL CHECK (role IN ('usuario','jarvis','sistema')),
  channel text NOT NULL DEFAULT 'texto' CHECK (channel IN ('texto','voz')),
  content text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Contenido y campañas: cada pieza con los campos obligatorios
CREATE TABLE content_pieces (
  id serial PRIMARY KEY,
  business_id int NOT NULL REFERENCES businesses(id),
  product_id int NOT NULL REFERENCES products(id),
  title text NOT NULL,
  audience text NOT NULL,
  hypothesis text NOT NULL,
  message text NOT NULL,
  verifiable_demo text NOT NULL,
  cta text NOT NULL,
  rights text NOT NULL,
  approval_status text NOT NULL DEFAULT 'borrador' CHECK (approval_status IN ('borrador','pendiente','aprobada','rechazada','publicada')),
  channel text NOT NULL,
  measurement_id text NOT NULL,
  is_demo boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Experimentos: definidos antes de empezar
CREATE TABLE experiments (
  id serial PRIMARY KEY,
  business_id int NOT NULL REFERENCES businesses(id),
  product_id int REFERENCES products(id),
  hypothesis text NOT NULL,
  metric text NOT NULL,
  budget_cents bigint NOT NULL DEFAULT 0,
  window_days int NOT NULL,
  stop_conditions text NOT NULL,
  uncertainty text NOT NULL,
  status text NOT NULL DEFAULT 'propuesto',
  result text,
  decision text,
  is_demo boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Métricas: valor NULL = desconocido (nunca se inventa)
CREATE TABLE metrics (
  id bigserial PRIMARY KEY,
  business_id int NOT NULL REFERENCES businesses(id),
  product_id int REFERENCES products(id),
  metric text NOT NULL,
  value numeric,
  unit text,
  source text NOT NULL,
  observed_at timestamptz NOT NULL,
  is_demo boolean NOT NULL DEFAULT false
);

-- Catálogo de conexiones
CREATE TABLE connections (
  id serial PRIMARY KEY,
  service text NOT NULL UNIQUE,
  capabilities text NOT NULL,
  account text,
  access text NOT NULL DEFAULT 'ninguno' CHECK (access IN ('ninguno','lectura','lectura_escritura')),
  credentials_required text NOT NULL,
  cost text NOT NULL,
  status text NOT NULL DEFAULT 'pendiente_de_conectar',
  last_check timestamptz,
  revocation text NOT NULL
);

-- Salud de procesos
CREATE TABLE heartbeats (
  process text PRIMARY KEY,
  pid int NOT NULL,
  at timestamptz NOT NULL DEFAULT now(),
  info jsonb NOT NULL DEFAULT '{}'
);

-- Aislamiento por negocio para el rol de agentes
GRANT USAGE ON SCHEMA public TO jarvis_agent;
GRANT SELECT ON businesses, products, knowledge_items, tasks, content_pieces, experiments, metrics, agent_functions, system_state TO jarvis_agent;
GRANT INSERT ON knowledge_items, audit_log TO jarvis_agent;
GRANT USAGE ON SEQUENCE knowledge_items_id_seq, audit_log_id_seq TO jarvis_agent;
-- Sin permisos sobre presupuesto, aprobaciones ni system_state (escritura): los agentes no pueden cambiar sus límites.

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['products','knowledge_items','tasks','content_pieces','experiments','metrics'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format($p$CREATE POLICY por_negocio ON %I TO jarvis_agent
      USING (business_id = nullif(current_setting('jarvis.business_id', true), '')::int)
      WITH CHECK (business_id = nullif(current_setting('jarvis.business_id', true), '')::int)$p$, t);
  END LOOP;
END $$;
ALTER TABLE businesses ENABLE ROW LEVEL SECURITY;
CREATE POLICY por_negocio ON businesses TO jarvis_agent
  USING (id = nullif(current_setting('jarvis.business_id', true), '')::int);
