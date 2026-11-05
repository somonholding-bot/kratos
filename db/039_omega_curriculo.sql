-- Operación Omega: currículo interno de Sol (36 módulos de referencia). El trabajador lanza el siguiente módulo con un tope diario.
CREATE TABLE IF NOT EXISTS sol_modulos (
  n int PRIMARY KEY, bloque text NOT NULL, titulo text NOT NULL,
  estado text NOT NULL DEFAULT 'pendiente' CHECK (estado IN ('pendiente','en_curso','completado','fallido')),
  tarea_id int, proyecto_id int, intentos int NOT NULL DEFAULT 0, lanzado_en timestamptz, completado_en timestamptz
);
INSERT INTO sol_modulos (n, bloque, titulo) VALUES
  (1, 'Fundamentos', 'Neurociencia'),
  (2, 'Fundamentos', 'Psicología cognitiva'),
  (3, 'Fundamentos', 'Atención'),
  (4, 'Fundamentos', 'Memoria'),
  (5, 'Fundamentos', 'Emoción'),
  (6, 'Fundamentos', 'Aprendizaje'),
  (7, 'Fundamentos', 'Hipnosis'),
  (8, 'Fundamentos', 'Sugestión'),
  (9, 'Fundamentos', 'Sueño'),
  (10, 'Fundamentos', 'Meditación'),
  (11, 'Fundamentos', 'Metodología científica'),
  (12, 'Fundamentos', 'Estadística'),
  (13, 'Especialización', 'Jung'),
  (14, 'Especialización', 'Freud y psicología profunda'),
  (15, 'Especialización', 'Simbolismo'),
  (16, 'Especialización', 'Hermetismo'),
  (17, 'Especialización', 'Alquimia'),
  (18, 'Especialización', 'Cábala'),
  (19, 'Especialización', 'Mentalismo escénico'),
  (20, 'Especialización', 'Filosofía de la conciencia'),
  (21, 'Especialización', 'Biohacking'),
  (22, 'Especialización', 'Longevidad'),
  (23, 'Especialización', 'Neurotecnología'),
  (24, 'Especialización', 'Estados alterados de conciencia'),
  (25, 'Aplicación', 'Psicología de audiencias'),
  (26, 'Aplicación', 'Persuasión ética'),
  (27, 'Aplicación', 'Storytelling'),
  (28, 'Aplicación', 'Escritura'),
  (29, 'Aplicación', 'Cinematografía'),
  (30, 'Aplicación', 'Psicología audiovisual'),
  (31, 'Aplicación', 'Investigación de mercados'),
  (32, 'Aplicación', 'Predicción conductual'),
  (33, 'Aplicación', 'Experimentación'),
  (34, 'Aplicación', 'Analítica de contenido'),
  (35, 'Aplicación', 'Optimización creativa'),
  (36, 'Aplicación', 'Integración interdisciplinaria')
ON CONFLICT (n) DO NOTHING;
ALTER TABLE sol_proyectos DROP CONSTRAINT IF EXISTS sol_proyectos_tipo_check;
ALTER TABLE sol_proyectos ADD CONSTRAINT sol_proyectos_tipo_check CHECK (tipo IN ('video','libro','campana','investigacion','modulo'));
INSERT INTO system_state (key, value) VALUES ('omega_modulos_dia', '4') ON CONFLICT (key) DO NOTHING;
