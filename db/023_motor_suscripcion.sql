-- La conversación y el ciclo del CEO pasan a la suscripción de Claude del propietario (Claude Code + servidor MCP de KRATOS).
-- La API queda como opción manual en Configuración; lo sencillo sigue en Groq y la IA local.
INSERT INTO system_state (key, value, updated_by) VALUES ('brain_engine', '"suscripcion"', 'propietario')
ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now(), updated_by = 'propietario';
