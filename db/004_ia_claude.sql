-- Inteligencia con Claude: registro de consumo y configuración del modelo.
CREATE TABLE ai_usage (
  id bigserial PRIMARY KEY,
  at timestamptz NOT NULL DEFAULT now(),
  model text NOT NULL,
  input_tokens int NOT NULL DEFAULT 0,
  output_tokens int NOT NULL DEFAULT 0,
  cache_read_tokens int NOT NULL DEFAULT 0,
  cache_write_tokens int NOT NULL DEFAULT 0,
  cost_microusd bigint NOT NULL,   -- coste exacto en millonésimas de dólar
  charged_cents int NOT NULL,      -- lo descontado del libro (redondeo hacia arriba)
  purpose text NOT NULL
);

INSERT INTO system_state (key, value) VALUES
  ('ai_model', '"claude-opus-5-5"'),
  ('ai_effort', '"low"')
ON CONFLICT (key) DO NOTHING;

-- Propuesta inicial de presupuesto para la IA: solo tiene efecto si la apruebas en el panel.
INSERT INTO approvals (kind, description, scope, account_label, max_amount_cents, valid_until, requested_by)
VALUES ('asignacion_presupuesto',
        'Asignar 10,00 USD durante 30 días al uso de la API de Claude (inteligencia de Kratos). Sin esta asignación Kratos sigue en modo demostración.',
        jsonb_build_object('origen', 'instalación', 'valid_until', (now() + interval '30 days')::text),
        'Operación: API de Claude', 1000, now() + interval '30 days', 'instalación de Kratos');

UPDATE connections SET status = 'pendiente_de_clave', account = 'Claude Console (clave en el Llavero: kratos-anthropic)'
WHERE service = 'Claude (API de Anthropic)';
INSERT INTO connections (service, capabilities, account, access, credentials_required, cost, status, revocation) VALUES
('Obsidian', 'Memoria en notas Markdown: diario, expedientes y notas de Kratos', '~/Documents/Kratos (bóveda)', 'lectura_escritura',
 'Ninguna (carpeta local)', '0 USD', 'conectado', 'Borrar o mover la carpeta de la bóveda');
