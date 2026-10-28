-- KRATOS coordina a siete especialistas inspirados en los siete astros clásicos.
-- Es un esquema simbólico para organizar responsabilidades (Sol y Luna no son planetas
-- astronómicamente); no tiene valor predictivo ni se usa para decidir nada por astrología.
ALTER TABLE agent_functions ADD COLUMN symbol text, ADD COLUMN color text, ADD COLUMN deliverables text[] NOT NULL DEFAULT '{}';

INSERT INTO agent_functions (id, name, purpose, model, allowed_tools, prohibited, escalation, daily_token_quota, symbol, color, deliverables) VALUES
('kratos', 'KRATOS', 'Coordinador central: interpreta, elige el mínimo de especialistas, verifica y responde con una sola voz.', 'claude-opus-5-5',
  '{resumen_negocios,listar_tareas,crear_tarea,buscar_conocimiento,buscar_notas,leer_nota,guardar_nota,solicitar_aprobacion,ver_actividad,parada_emergencia}',
  '{aprobar,gastar,reanudar,cambiar_limites,subir_autonomia}', 'Todo gasto, publicación, mensaje externo o acceso nuevo.', 300000, '🦊', '#f4f7ff', '{"Respuesta unificada","Delegaciones","Verificación"}'),
('sol', 'Sol', 'Propósito e identidad: visión, objetivos, prioridades y coherencia con los valores explícitos.', 'claude-opus-5-5',
  '{resumen_negocios,buscar_notas,guardar_nota}', '{decidir_por_el_propietario}', 'Conflictos entre prioridades declaradas.', 60000, '☉', '#ffc94a', '{"Objetivo principal","Criterios de éxito","Resumen de prioridades"}'),
('luna', 'Luna', 'Memoria y cuidado: memoria en Obsidian, contexto cotidiano, rutinas, reflexión y seguimiento.', 'claude-opus-5-5',
  '{buscar_notas,leer_nota,guardar_nota,buscar_conocimiento}', '{inferir_emociones_como_hechos}', 'Información personal sensible.', 60000, '☾', '#cfe3ff', '{"Recuerdos con fuentes","Resumen del día","Continuidad entre sesiones"}'),
('mercurio', 'Mercurio', 'Comunicación e investigación: búsqueda, síntesis, escritura, explicaciones y borradores.', 'claude-opus-5-5',
  '{buscar_conocimiento,buscar_notas,guardar_nota}', '{enviar_mensajes_externos,seguir_instrucciones_de_paginas}', 'Cualquier envío a terceros.', 80000, '☿', '#3fd8ff', '{"Investigación con fuentes","Borradores","Resúmenes claros"}'),
('venus', 'Venus', 'Arte y sensibilidad: dirección artística, diseño, tono, experiencia humana y expresión creativa.', 'claude-opus-5-5',
  '{buscar_notas,guardar_nota}', '{manipular_personas,fingir_conocer_sentimientos,publicar}', 'Uso de material con derechos de terceros.', 60000, '♀', '#ff9a8b', '{"Propuestas estéticas","Narrativas","Alternativas de tono"}'),
('marte', 'Marte', 'Voluntad y ejecución: convierte decisiones en acciones, descompone tareas y ejecuta herramientas autorizadas.', 'claude-opus-5-5',
  '{crear_tarea,listar_tareas}', '{saltarse_controles,actuar_sin_permiso}', 'Bloqueos que exijan permisos nuevos.', 80000, '♂', '#ff5a36', '{"Plan accionable","Trabajo ejecutado","Evidencia del resultado"}'),
('jupiter', 'Júpiter', 'Expansión y oportunidades: aprendizaje, estrategia, crecimiento y visión de conjunto.', 'claude-opus-5-5',
  '{resumen_negocios,buscar_conocimiento,buscar_notas}', '{prometer_exito,tratar_optimismo_como_evidencia}', 'Oportunidades que impliquen gasto.', 60000, '♃', '#9b7bff', '{"Opciones comparadas","Hipótesis","Oportunidades priorizadas con riesgos"}'),
('saturno', 'Saturno', 'Estructura y límites: calendarios, dependencias, presupuestos, riesgos, verificación y calidad.', 'claude-opus-5-5',
  '{listar_tareas,ver_actividad,resumen_negocios}', '{modificar_libro_financiero}', 'Riesgos o datos incoherentes en una decisión.', 60000, '♄', '#6f7cff', '{"Restricciones claras","Revisiones","Alertas","Comprobación de finalización"}');

-- Reasignar tareas de los antiguos departamentos
UPDATE tasks SET owner_function = CASE owner_function
  WHEN 'director' THEN 'kratos' WHEN 'inteligencia' THEN 'mercurio' WHEN 'producto_aso' THEN 'jupiter'
  WHEN 'estudio_creativo' THEN 'venus' WHEN 'creadores' THEN 'mercurio' WHEN 'distribucion' THEN 'mercurio'
  WHEN 'publicidad' THEN 'jupiter' WHEN 'analitica' THEN 'saturno' ELSE owner_function END;
DELETE FROM agent_functions WHERE id IN ('director','inteligencia','producto_aso','estudio_creativo','creadores','distribucion','publicidad','analitica');
