-- Decisiones del propietario (29-oct-2026):
-- 1) Autonomía amplia: KRATOS envía mensajes y correos que el propietario le ordena, y activa por sí mismo
--    funciones nuevas aisladas y encargos a Claude Code. Dinero, accesos, publicaciones y su propio código siguen en el panel.
--    Para volver atrás: UPDATE system_state SET value = '"estricta"' WHERE key = 'autonomia';
INSERT INTO system_state (key, value, updated_by) VALUES ('autonomia', '"amplia"', 'propietario')
ON CONFLICT (key) DO UPDATE SET value = '"amplia"', updated_at = now(), updated_by = 'propietario';

-- 2) La respuesta hablada usa la Voz Personal del propietario (si macOS no la autoriza, la app usa Piper).
INSERT INTO system_state (key, value, updated_by) VALUES ('tts_voice', '"personal"', 'propietario')
ON CONFLICT (key) DO UPDATE SET value = '"personal"', updated_at = now(), updated_by = 'propietario';
