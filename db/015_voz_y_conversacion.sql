-- Voz masculina por defecto (Kokoro em_alex) y modelo rápido para la conversación por voz.
INSERT INTO system_state (key, value, updated_by) VALUES
  ('tts_voice', '"kokoro"', 'sistema'),
  ('voice_model', '"claude-haiku-5-5"', 'sistema')
ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now(), updated_by = 'sistema';
