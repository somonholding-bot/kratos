-- Propietario (cómo saludarle), agenda con alarmas habladas, catálogo completo de conexiones y App Store Connect.

INSERT INTO system_state (key, value, updated_by) VALUES
  ('owner', '{"name": "Idalmi", "address": "señor Idalmi"}', 'propietario')
ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now(), updated_by = 'propietario';

-- Agenda: alarmas, recordatorios y eventos. A su hora, la app abre el universo y KRATOS lo dice en voz alta.
CREATE TABLE IF NOT EXISTS agenda (
  id serial PRIMARY KEY,
  at timestamptz NOT NULL,
  kind text NOT NULL DEFAULT 'recordatorio' CHECK (kind IN ('alarma','recordatorio','evento','aviso')),
  text text NOT NULL,
  repeat text CHECK (repeat IN ('diaria','laborables','semanal')),
  status text NOT NULL DEFAULT 'pendiente' CHECK (status IN ('pendiente','dada','cancelada')),
  created_by text NOT NULL DEFAULT 'propietario',
  created_at timestamptz NOT NULL DEFAULT now(),
  delivered_at timestamptz
);
CREATE INDEX IF NOT EXISTS agenda_pendiente ON agenda (at) WHERE status = 'pendiente';

-- Estado de las apps en App Store Connect (solo lectura)
CREATE TABLE IF NOT EXISTS app_store_apps (
  apple_id text PRIMARY KEY,
  name text NOT NULL,
  bundle_id text,
  platform text,
  version text,
  state text,
  state_since timestamptz,
  rating_count int,
  latest_reviews jsonb NOT NULL DEFAULT '[]',
  checked_at timestamptz NOT NULL DEFAULT now()
);

UPDATE connections SET
  capabilities = 'Estado de revisión de tus apps en tiempo real, versiones y reseñas (solo lectura)',
  credentials_required = 'Clave de API de App Store Connect: Issuer ID, Key ID y archivo .p8 (en el Llavero: kratos-appstore)',
  cost = 'Gratis', revocation = 'App Store Connect › Usuarios y acceso › Integraciones › Revocar clave'
WHERE service = 'App Store Connect';

-- Catálogo de todo lo que KRATOS podría necesitar. Todo empieza sin conectar y en solo lectura.
INSERT INTO connections (service, capabilities, credentials_required, cost, revocation) VALUES
  ('Gmail', 'Leer correo y preparar borradores; enviar solo con tu aprobación', 'Autorizar con Google (OAuth)', 'Gratis', 'myaccount.google.com › Seguridad › Apps con acceso'),
  ('Google Calendar', 'Ver y crear eventos de tu agenda', 'Autorizar con Google (OAuth)', 'Gratis', 'myaccount.google.com › Seguridad › Apps con acceso'),
  ('Lista de correo (Mailchimp / Brevo / Kit)', 'Ver suscriptores y preparar campañas; enviar solo con aprobación', 'Clave de API del proveedor', 'Según el plan del proveedor', 'Panel del proveedor › Claves de API'),
  ('Vercel', 'Ver proyectos y despliegues', 'Token de solo lectura', 'Gratis', 'vercel.com › Account › Tokens'),
  ('Stripe', 'Ver ingresos, pagos y suscripciones', 'Clave restringida de solo lectura', 'Gratis', 'dashboard.stripe.com › Developers › API keys'),
  ('Banco (Plaid)', 'Ver saldos y movimientos; los pagos los autorizas tú siempre', 'Conector bancario de solo lectura', 'Según Plaid', 'Panel del banco o de Plaid'),
  ('Teléfono (Twilio)', 'Llamadas y mensajes de voz solo cuando tú lo ordenes', 'Cuenta de Twilio y tu número verificado', 'Por minuto', 'console.twilio.com'),
  ('WhatsApp Business', 'Avisos y mensajes solo con tu aprobación', 'Cuenta de WhatsApp Business API', 'Por conversación', 'business.facebook.com'),
  ('Telegram', 'Avisos de KRATOS a tu móvil', 'Bot de Telegram propio', 'Gratis', 'Telegram › @BotFather › /revoke'),
  ('Instagram / Facebook', 'Ver estadísticas; publicar solo con aprobación', 'Autorizar con Meta', 'Gratis', 'Meta › Integraciones empresariales'),
  ('TikTok', 'Ver estadísticas; publicar solo con aprobación', 'Autorizar con TikTok for Developers', 'Gratis', 'TikTok › Ajustes › Seguridad'),
  ('YouTube', 'Ver estadísticas del canal', 'Autorizar con Google (OAuth)', 'Gratis', 'myaccount.google.com › Seguridad'),
  ('X (Twitter)', 'Ver estadísticas; publicar solo con aprobación', 'Clave de API de X', 'Según el plan de X', 'developer.x.com'),
  ('LinkedIn', 'Ver estadísticas; publicar solo con aprobación', 'Autorizar con LinkedIn', 'Gratis', 'LinkedIn › Ajustes › Datos'),
  ('Apple Search Ads', 'Ver campañas; activar o gastar solo con aprobación', 'Credenciales de la API de Apple Ads', 'Según presupuesto aprobado', 'searchads.apple.com › Configuración de API'),
  ('Google Ads', 'Ver campañas; activar o gastar solo con aprobación', 'Autorizar con Google Ads', 'Según presupuesto aprobado', 'ads.google.com › Acceso'),
  ('Meta Ads', 'Ver campañas; activar o gastar solo con aprobación', 'Autorizar con Meta', 'Según presupuesto aprobado', 'business.facebook.com'),
  ('Upwork / Fiverr', 'Buscar freelancers y creadores; contratar solo con aprobación', 'Cuenta propia en la plataforma', 'Según cada encargo', 'Ajustes de la plataforma'),
  ('Collabstr / Insense', 'Buscar influencers y UGC; contratar solo con aprobación', 'Cuenta propia en la plataforma', 'Según cada encargo', 'Ajustes de la plataforma'),
  ('Búsqueda web', 'Investigar en internet (solo lectura)', 'Herramienta de búsqueda de Claude', 'Por búsqueda', 'Desactivar en KRATOS'),
  ('Claude Code', 'Encargar diseño y programación en una carpeta aislada, con tu aprobación', 'Claude Code instalado en este Mac', 'Según uso', 'Desactivar en KRATOS'),
  ('Voz neural (ElevenLabs)', 'Voz de KRATOS casi humana', 'Clave de API de ElevenLabs', 'Por carácter hablado', 'elevenlabs.io › Perfil › Claves'),
  ('Notion', 'Leer y escribir páginas de trabajo', 'Integración interna de Notion', 'Gratis', 'notion.so › Ajustes › Conexiones'),
  ('Slack', 'Avisos y resúmenes en tu espacio de trabajo', 'App de Slack propia', 'Gratis', 'api.slack.com/apps')
ON CONFLICT (service) DO NOTHING;

-- Revisión de App Store Connect cada 15 minutos (no hace nada mientras no haya clave)
INSERT INTO tasks (business_id, owner_function, type, title, objective, priority, expected_result, verification, recurrence_minutes, idempotency_key, run_at)
SELECT id, 'luna', 'apple_sync', 'Revisar App Store Connect', 'Leer el estado de revisión, versiones y reseñas de las apps del propietario', 2,
  'Estado actualizado y aviso hablado si cambia la revisión', 'Coincide con App Store Connect', 15, 'apple_sync:seed', now() + interval '1 minute'
FROM businesses WHERE name = 'Kratos · Operaciones internas'
ON CONFLICT (idempotency_key) DO NOTHING;
