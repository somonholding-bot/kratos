-- Fase B del sistema híbrido (1-nov-2026): resultados duraderos y verificables.
-- Una tarea solo pasa a «completada» tras una verificación objetiva (src/core/verify.ts); sus artefactos quedan referenciados.
ALTER TABLE tasks
  ADD COLUMN IF NOT EXISTS artifacts jsonb NOT NULL DEFAULT '[]',          -- [{tipo, ruta|url, bytes, nota}]
  ADD COLUMN IF NOT EXISTS checkpoints jsonb NOT NULL DEFAULT '[]',        -- [{at, paso, datos}] progreso recuperable
  ADD COLUMN IF NOT EXISTS verification_result jsonb,                      -- {ok, comprobaciones:[{nombre, ok, detalle}]}
  ADD COLUMN IF NOT EXISTS verified_at timestamptz,
  ADD COLUMN IF NOT EXISTS started_at timestamptz,
  ADD COLUMN IF NOT EXISTS completed_at timestamptz,
  ADD COLUMN IF NOT EXISTS playbook_id text;                               -- fase D: procedimiento reutilizable que la originó

-- Estados: pendiente (en cola) → en_ejecucion → verificando → completada | fallida | cancelada;
-- no terminales además: esperando_ia, esperando_permiso, requiere_revision, bloqueada.
ALTER TABLE tasks DROP CONSTRAINT IF EXISTS tasks_status_check;
ALTER TABLE tasks ADD CONSTRAINT tasks_status_check CHECK (status IN ('pendiente','en_ejecucion','verificando','completada','fallida','cancelada','esperando_permiso','esperando_ia','requiere_revision','bloqueada'));
CREATE INDEX IF NOT EXISTS tasks_busqueda_idx ON tasks USING gin (to_tsvector('spanish', coalesce(title,'') || ' ' || coalesce(objective,'') || ' ' || coalesce(result->>'deliverable','')));
CREATE INDEX IF NOT EXISTS tasks_agente_fecha_idx ON tasks (owner_function, updated_at DESC);
CREATE INDEX IF NOT EXISTS tasks_playbook_idx ON tasks (playbook_id) WHERE playbook_id IS NOT NULL;

-- Las tareas ya completadas se dan por verificadas por el criterio anterior (informe guardado y leído de vuelta)
UPDATE tasks SET completed_at = updated_at WHERE status = 'completada' AND completed_at IS NULL;
