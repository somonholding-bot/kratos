-- KSIE TAREA 09: el motor estratégico se integra en los agentes existentes (no se crea ninguno).
-- Júpiter (estrategia y oportunidades) lo dirige; Mercurio investiga y responde preguntas con evidencia; Saturno critica y revisa riesgos y presupuestos.
UPDATE agent_functions SET allowed_tools = (SELECT array(SELECT DISTINCT unnest(allowed_tools || ARRAY['estrategia_ksie','prediccion']))) WHERE id IN ('jupiter','mercurio','saturno');
