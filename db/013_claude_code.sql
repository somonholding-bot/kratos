-- Encargos de diseño y programación a Claude Code, siempre con aprobación y en una carpeta aislada por proyecto.
CREATE TABLE IF NOT EXISTS code_jobs (
  id serial PRIMARY KEY,
  project text NOT NULL,
  instructions text NOT NULL,
  status text NOT NULL DEFAULT 'propuesta' CHECK (status IN ('propuesta','aprobada','en_ejecucion','completada','fallida','rechazada')),
  approval_id int REFERENCES approvals(id),
  task_id int REFERENCES tasks(id),
  result text,
  cost_usd numeric,
  created_by text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz
);
UPDATE connections SET status = 'conectado', access = 'lectura_escritura', account = 'Claude Code en este Mac (carpeta ~/KratosProyectos)',
  capabilities = 'Diseño y programación en una carpeta aislada por proyecto; cada encargo con tu aprobación'
WHERE service = 'Claude Code';
UPDATE connections SET status = 'conectado', access = 'lectura', account = 'Herramienta web de Claude (10 USD / 1.000 búsquedas)'
WHERE service = 'Búsqueda web';
