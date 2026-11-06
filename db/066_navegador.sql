-- Navegador propio de KRATOS: formularios y registros en servicios gratuitos (perfil aparte; reglas de seguridad en código).
UPDATE agent_functions SET allowed_tools = (SELECT array(SELECT DISTINCT unnest(allowed_tools || ARRAY['navegador_kratos']))) WHERE id IN ('jupiter','mercurio','venus');
