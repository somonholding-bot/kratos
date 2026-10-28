-- Etapa C: métricas de voz (sin audio y sin texto: solo tiempos y resultado).
CREATE TABLE voice_metrics (
  id bigserial PRIMARY KEY,
  at timestamptz NOT NULL DEFAULT now(),
  audio_ms int,
  stt_ms int,
  think_ms int,
  tts_start_ms int,
  outcome text NOT NULL CHECK (outcome IN ('ok','silencio','muy_corto','muy_largo','ruido','error','cancelado'))
);

-- El asistente se llama Kratos.
UPDATE businesses SET name = 'Kratos · Operaciones internas' WHERE name = 'Jarvis · Operaciones internas';
UPDATE agent_functions SET name = 'Director Kratos' WHERE id = 'director';
INSERT INTO system_state (key, value) VALUES ('assistant_name', '"Kratos"') ON CONFLICT (key) DO NOTHING;
