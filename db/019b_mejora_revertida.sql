-- Las mejoras revertidas tienen su propio estado (no son fallos).
ALTER TABLE code_jobs DROP CONSTRAINT IF EXISTS code_jobs_status_check;
ALTER TABLE code_jobs ADD CONSTRAINT code_jobs_status_check CHECK (status IN ('propuesta','aprobada','en_ejecucion','completada','fallida','rechazada','revertida'));
UPDATE code_jobs SET status = 'revertida' WHERE project = '__kratos__' AND result LIKE '%"revertida":true%';
-- Voz nativa en español (Piper es_MX, masculina): más natural y más rápida que Kokoro en español.
UPDATE system_state SET value = '"piper"', updated_at = now(), updated_by = 'propietario' WHERE key = 'tts_voice';
