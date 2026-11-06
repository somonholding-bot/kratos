-- Motor de dinero (orden del propietario, 5-nov-2026 noche): todos los agentes consultan el saber de KRATOS antes de decidir,
-- y un planificador empuja una cartera diversa de oportunidades (cupo diario configurable).
UPDATE agent_functions SET allowed_tools = (SELECT array(SELECT DISTINCT unnest(allowed_tools || ARRAY['saber']))) WHERE id <> 'kratos';
UPDATE agent_functions SET allowed_tools = (SELECT array(SELECT DISTINCT unnest(allowed_tools || ARRAY['estrategia_ksie']))) WHERE id IN ('jupiter','mercurio','saturno','sol');
INSERT INTO system_state (key, value) VALUES ('motor_dinero_dia', '3') ON CONFLICT (key) DO NOTHING;
