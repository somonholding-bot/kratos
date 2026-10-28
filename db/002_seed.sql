-- Configuración real: las 8 funciones y el catálogo de conexiones (todas pendientes).
-- Datos de demostración: un negocio y un producto FICTICIOS, marcados is_demo = true.

INSERT INTO agent_functions (id, name, purpose, model, allowed_tools, prohibited, escalation, daily_token_quota) VALUES
('director', 'Director Jarvis', 'Coordina objetivos, tareas, departamentos y prioridades.', 'claude-sonnet-5-5',
  '{crear_tarea,priorizar,consultar_expediente,solicitar_aprobacion}', '{cambiar_politicas,cambiar_presupuesto,subir_nivel_autonomia,delegar_mas_de_un_nivel}',
  'Cualquier gasto, publicación, mensaje externo o acceso nuevo.', 200000),
('inteligencia', 'Inteligencia e investigación', 'Mercado, audiencia, competencia y oportunidades, siempre con fuentes.', 'claude-sonnet-5-5',
  '{busqueda_web,lectura_publica,escribir_observacion}', '{seguir_instrucciones_de_paginas,iniciar_sesion_en_cuentas}',
  'Fuentes contradictorias en una decisión relevante.', 150000),
('producto_aso', 'Producto, ASO y conversión', 'Fichas, landing, incorporación y activación.', 'claude-sonnet-5-5',
  '{leer_fichas,leer_analitica,borradores}', '{editar_fichas_publicadas}', 'Cambios en la ficha publicada.', 100000),
('estudio_creativo', 'Estudio creativo', 'Briefs, guiones, demostraciones, imágenes y videos.', 'claude-sonnet-5-5',
  '{borradores,render_local}', '{publicar,testimonios_falsos,funciones_inexistentes}', 'Uso de material con derechos de terceros.', 100000),
('creadores', 'Creadores y afiliados', 'Candidatos, briefs, entregas y derechos.', 'claude-haiku-5-5',
  '{investigacion,briefs}', '{contactar_terceros,pagar}', 'Cualquier contacto o pago a creadores.', 80000),
('distribucion', 'Distribución y comunidad', 'Calendarios y publicaciones por canal.', 'claude-haiku-5-5',
  '{calendario,borradores}', '{publicar_fuera_de_politica,responder_en_nombre_del_propietario}', 'Publicación sin política vigente.', 80000),
('publicidad', 'Publicidad y experimentos', 'Propone campañas y analiza resultados.', 'claude-sonnet-5-5',
  '{propuestas,simulacion}', '{activar_campanas,subir_presupuesto}', 'Activación o cambio de gasto.', 100000),
('analitica', 'Analítica, operaciones y control', 'Datos, presupuestos, compromisos, salud e informes.', 'claude-haiku-5-5',
  '{leer_metricas,leer_salud,informes}', '{modificar_libro_financiero}', 'Datos ausentes o incoherentes en una decisión.', 80000);

INSERT INTO connections (service, capabilities, credentials_required, cost, revocation) VALUES
('Claude (API de Anthropic)', 'Razonamiento de Jarvis y sus funciones', 'Clave de API de Claude Console en el Llavero', 'Por uso; tope en el libro financiero', 'Revocar la clave en Claude Console'),
('GitHub', 'Lectura de repositorios de tus apps', 'Token de solo lectura', '0 USD', 'Revocar el token en GitHub'),
('App Store Connect', 'Ventas, descargas, fichas', 'Clave de API de solo lectura (rol Sales/Reports)', '0 USD', 'Revocar la clave en App Store Connect'),
('Google Play Console', 'Instalaciones, valoraciones, fichas', 'Cuenta de servicio con permiso de lectura', '0 USD', 'Quitar la cuenta de servicio'),
('Analítica (PostHog / Firebase / GA4)', 'Activación, retención, embudos', 'Clave de lectura', 'Según plan', 'Revocar la clave'),
('Suscripciones (RevenueCat)', 'Compras, renovaciones, cancelaciones', 'Clave de API de lectura', 'Según plan', 'Revocar la clave'),
('Correo y calendario', 'Lectura de agenda y avisos', 'OAuth de solo lectura', '0 USD', 'Revocar acceso en la cuenta'),
('Plataformas de creadores (JoinBrands, Billo…)', 'Seguimiento de pedidos y derechos', 'Sin API confirmada: carga manual de informes', 'Por pedido', 'No aplica'),
('Meta / TikTok / YouTube / Google Ads / Apple Ads', 'Resultados de campañas y publicaciones', 'OAuth de solo lectura por plataforma', 'Gasto publicitario aparte', 'Revocar en cada plataforma'),
('Mensajería de avisos', 'Notificarte novedades útiles', 'Por definir', 'Por definir', 'Por definir');

INSERT INTO budget_accounts (business_id, scope, label, limit_cents) VALUES
(NULL, 'global', 'Global (sin asignar)', 0),
(NULL, 'operacion', 'Operación: API de Claude', 0);

INSERT INTO businesses (name, owner, is_demo, goals) VALUES
('Jarvis · Operaciones internas', 'propietario', false, '["Mantener el sistema sano, auditable y dentro de cuotas"]');

-- ===== DEMOSTRACIÓN (ficticio) =====
INSERT INTO businesses (name, owner, is_demo, goals) VALUES
('DEMO · Estudio de Apps Ficticio', 'propietario', true,
 '["Conseguir usuarios activados para NotaFácil (DEMO)", "Mantener el coste por usuario activado bajo control"]');

INSERT INTO products (business_id, name, platforms, audience, markets, revenue_model, is_demo)
SELECT id, 'DEMO · NotaFácil (app ficticia)', '{iOS,Android}', 'Estudiantes hispanohablantes (ficticio)', '{MX,ES}', 'Freemium con suscripción (ficticio)', true
FROM businesses WHERE is_demo;

INSERT INTO knowledge_items (business_id, product_id, kind, topic, content, source, is_demo)
SELECT b.id, p.id, k.kind, k.topic, k.content, 'Datos de demostración', true
FROM businesses b JOIN products p ON p.business_id = b.id,
(VALUES
  ('hecho', 'Funcionalidad', 'NotaFácil permite crear notas por voz (ficticio).'),
  ('hipotesis', 'Audiencia', 'Los estudiantes universitarios activan más que los de secundaria.'),
  ('decision_aprobada', 'Marca', 'Tono cercano, sin promesas de resultados académicos.'),
  ('externo_no_confiable', 'Competencia', 'Una reseña dice que la competencia es más rápida (sin verificar).')
) AS k(kind, topic, content)
WHERE b.is_demo;

INSERT INTO content_pieces (business_id, product_id, title, audience, hypothesis, message, verifiable_demo, cta, rights, approval_status, channel, measurement_id, is_demo)
SELECT b.id, p.id, 'DEMO · Video corto: nota por voz en 5 s', 'Universitarios (ficticio)',
  'Mostrar la velocidad aumenta la activación', 'Dicta y queda organizado', 'Grabación real de pantalla de la función de voz',
  'Descarga gratis', 'Propios', 'borrador', 'TikTok orgánico', 'demo-tt-001', true
FROM businesses b JOIN products p ON p.business_id = b.id WHERE b.is_demo;

INSERT INTO experiments (business_id, product_id, hypothesis, metric, budget_cents, window_days, stop_conditions, uncertainty, is_demo)
SELECT b.id, p.id, 'Un onboarding de 2 pasos activa más que el de 4', 'Activación D1', 0, 14,
  'Parar si la activación cae >20 % durante 3 días', 'Alta: muestra pequeña', true
FROM businesses b JOIN products p ON p.business_id = b.id WHERE b.is_demo;

INSERT INTO metrics (business_id, product_id, metric, value, unit, source, observed_at, is_demo)
SELECT b.id, p.id, m.metric, m.value, m.unit, 'Datos de demostración', now() - interval '1 day', true
FROM businesses b JOIN products p ON p.business_id = b.id,
(VALUES ('instalaciones', 120::numeric, 'usuarios'), ('activacion', 0.34, 'ratio'), ('retencion_d7', NULL, 'ratio'), ('ingresos_netos', NULL, 'USD'))
AS m(metric, value, unit)
WHERE b.is_demo;

-- Tareas recurrentes reales del sistema (operan sobre datos locales; sin coste ni acciones externas)
INSERT INTO tasks (business_id, owner_function, type, title, objective, priority, expected_result, verification, recurrence_minutes, idempotency_key, is_demo, run_at)
SELECT id, 'analitica', 'revision_salud', 'Revisión de salud del sistema', 'Detectar procesos caídos, tareas atascadas y aprobaciones caducadas', 2,
  'Observación en el expediente con el estado del sistema', 'Existe una observación nueva con marca de tiempo', 15, 'revision_salud:seed', false, now()
FROM businesses WHERE name = 'Jarvis · Operaciones internas';
INSERT INTO tasks (business_id, owner_function, type, title, objective, priority, expected_result, verification, recurrence_minutes, idempotency_key, is_demo, run_at)
SELECT id, 'analitica', 'informe_portafolio', 'Informe diario del portafolio', 'Resumir tareas, métricas conocidas y desconocidas, y aprobaciones', 3,
  'Informe guardado como observación', 'La observación cita sus fuentes y marca datos ausentes', 1440, 'informe_portafolio:seed', false, now()
FROM businesses WHERE name = 'Jarvis · Operaciones internas';
INSERT INTO tasks (business_id, owner_function, type, title, objective, priority, expected_result, verification, status, idempotency_key, is_demo)
SELECT id, 'inteligencia', 'agente', 'DEMO · Analizar 5 competidores de NotaFácil', 'Investigar fichas y precios con fuentes', 3,
  'Tabla de competidores con fuentes y fechas', 'Cada fila tiene enlace y fecha', 'esperando_ia', 'demo:competidores', true
FROM businesses WHERE is_demo;
