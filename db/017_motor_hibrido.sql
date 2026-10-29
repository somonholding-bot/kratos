-- Motor híbrido: los agentes usan la suscripción de Claude del propietario; la voz, la API.
INSERT INTO system_state (key, value, updated_by) VALUES ('agents_engine', '"suscripcion"', 'propietario')
ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now(), updated_by = 'propietario';
