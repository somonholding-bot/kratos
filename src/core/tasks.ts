import { withTx, type Db } from '../db.ts';
import { config } from '../config.ts';
import { audit } from './state.ts';

export type NewTask = {
  businessId: number;
  productId?: number | null;
  ownerFunction: string;
  type: string;
  title: string;
  objective: string;
  priority?: number;
  inputs?: Record<string, unknown>;
  allowedActions?: string[];
  quota?: Record<string, unknown>;
  hasSideEffects?: boolean;
  runAt?: Date;
  recurrenceMinutes?: number | null;
  dependsOn?: number | null;
  expectedResult: string;
  verification: string;
  maxAttempts?: number;
  idempotencyKey?: string;
  status?: string;
  isDemo?: boolean;
  createdBy: string;
  playbookId?: string | null;        // fase D: procedimiento que la originó y versión exacta con la que se verifica
  playbookVersion?: number | null;
};

// Crea una tarea. Si la clave de idempotencia ya existe, devuelve la existente (sin duplicar).
export async function createTask(db: Db, t: NewTask) {
  const { rows } = await db.query(
    `INSERT INTO tasks (business_id, product_id, owner_function, type, title, objective, priority, inputs, allowed_actions, quota,
       has_side_effects, run_at, recurrence_minutes, depends_on, expected_result, verification, max_attempts, idempotency_key, status, is_demo, created_by, playbook_id, playbook_version)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23)
     ON CONFLICT (idempotency_key) DO NOTHING RETURNING *`,
    [t.businessId, t.productId ?? null, t.ownerFunction, t.type, t.title, t.objective, t.priority ?? 3, t.inputs ?? {}, t.allowedActions ?? [],
     t.quota ?? {}, t.hasSideEffects ?? false, t.runAt ?? new Date(), t.recurrenceMinutes ?? null, t.dependsOn ?? null, t.expectedResult,
     t.verification, t.maxAttempts ?? 3, t.idempotencyKey ?? null, t.status ?? 'pendiente', t.isDemo ?? false, t.createdBy, t.playbookId ?? null, t.playbookVersion ?? null]);
  if (rows[0]) {
    await audit(db, t.createdBy, 'tarea.creada', { id: rows[0].id, title: t.title, type: t.type }, t.businessId);
    return { task: rows[0], created: true };
  }
  const existing = await db.query('SELECT * FROM tasks WHERE idempotency_key = $1', [t.idempotencyKey]);
  return { task: existing.rows[0], created: false };
}

// Reclama la siguiente tarea vencida que este trabajador sabe ejecutar.
// FOR UPDATE SKIP LOCKED garantiza que dos trabajadores nunca tomen la misma.
export async function claimNext(db: Db, workerId: string, types: string[]) {
  const { rows } = await db.query(
    `UPDATE tasks SET status = 'en_ejecucion', locked_by = $1, locked_until = now() + make_interval(mins => $3),
       attempts = attempts + 1, started_at = coalesce(started_at, now()), updated_at = now()
     WHERE id = (
       SELECT t.id FROM tasks t
       WHERE t.status = 'pendiente' AND t.run_at <= now() AND t.type = ANY($2)
         AND (t.depends_on IS NULL OR EXISTS (SELECT 1 FROM tasks d WHERE d.id = t.depends_on AND d.status = 'completada'))
       ORDER BY t.priority, t.run_at
       FOR UPDATE SKIP LOCKED LIMIT 1)
     RETURNING *`,
    [workerId, types, config.worker.lockMinutes]);
  return rows[0] ?? null;
}

// Completa una tarea. Si se pasa la verificación (fase B), guarda sus comprobaciones y artefactos; solo se completa
// desde «en_ejecucion» o «verificando» y con el bloqueo del mismo trabajador.
export async function completeTask(db: Db, task: any, workerId: string, result: Record<string, unknown>, verification?: { ok: boolean; comprobaciones: unknown[]; artefactos: unknown[] }) {
  return withTx(db, async (tx) => {
    const { rowCount } = await tx.query(
      `UPDATE tasks SET status = 'completada', result = $3, artifacts = coalesce($4, artifacts), verification_result = $5,
         verified_at = CASE WHEN $5::jsonb IS NULL THEN verified_at ELSE now() END, completed_at = now(),
         locked_by = NULL, locked_until = NULL, last_error = NULL, updated_at = now()
       WHERE id = $1 AND status IN ('en_ejecucion', 'verificando') AND locked_by = $2`,
      [task.id, workerId, result, verification ? JSON.stringify(verification.artefactos) : null, verification ? JSON.stringify({ ok: verification.ok, comprobaciones: verification.comprobaciones }) : null]);
    if (!rowCount) return { completed: false }; // cancelada o recuperada mientras corría
    await audit(tx, workerId, 'tarea.completada', { id: task.id, title: task.title }, task.business_id);
    if (task.recurrence_minutes) {
      const next = new Date(Math.max(Date.now(), new Date(task.run_at).getTime()) + task.recurrence_minutes * 60_000);
      next.setSeconds(0, 0);
      await tx.query(
        `INSERT INTO tasks (business_id, product_id, owner_function, type, title, objective, priority, inputs, allowed_actions, quota,
           has_side_effects, run_at, recurrence_minutes, expected_result, verification, max_attempts, idempotency_key, is_demo, created_by, playbook_id, playbook_version)
         SELECT business_id, product_id, owner_function, type, title, objective, priority, inputs, allowed_actions, quota,
           has_side_effects, $2, recurrence_minutes, expected_result, verification, max_attempts, $3, is_demo, 'planificador', playbook_id, playbook_version
         FROM tasks WHERE id = $1
         ON CONFLICT (idempotency_key) DO NOTHING`,
        [task.id, next, `${task.type}:${task.business_id}:${next.toISOString()}`]);
    }
    return { completed: true };
  });
}

// Aplaza una tarea sin contarla como fallo (p. ej. límite de la suscripción hasta su hora de reinicio)
export async function deferTask(db: Db, task: any, workerId: string, until: Date, reason: string) {
  await db.query(`UPDATE tasks SET status = 'pendiente', run_at = $3, attempts = greatest(attempts - 1, 0), last_error = $4,
      locked_by = NULL, locked_until = NULL, updated_at = now() WHERE id = $1 AND status = 'en_ejecucion' AND locked_by = $2`,
    [task.id, workerId, until, reason.slice(0, 500)]);
  await audit(db, workerId, 'tarea.aplazada', { id: task.id, hasta: until.toISOString(), motivo: reason.slice(0, 200) }, task.business_id);
}

export async function failTask(db: Db, task: any, workerId: string, error: string) {
  const retry = task.attempts < task.max_attempts;
  const backoffMin = 2 ** task.attempts; // 2, 4, 8… minutos
  const { rowCount } = await db.query(
    `UPDATE tasks SET status = $3, last_error = $4, locked_by = NULL, locked_until = NULL,
       run_at = CASE WHEN $3 = 'pendiente' THEN now() + make_interval(mins => $5) ELSE run_at END, updated_at = now()
     WHERE id = $1 AND status IN ('en_ejecucion', 'verificando') AND locked_by = $2`,
    [task.id, workerId, retry ? 'pendiente' : 'fallida', error.slice(0, 500), backoffMin]);
  if (rowCount) await audit(db, workerId, retry ? 'tarea.reintento' : 'tarea.fallida', { id: task.id, error: error.slice(0, 200), intento: task.attempts }, task.business_id);
}

// Tras un reinicio o caída: las tareas con bloqueo vencido se recuperan.
// Si tenían efectos externos NO se repiten a ciegas: pasan a revisión humana.
export async function recoverStale(db: Db, actor: string) {
  const { rows } = await db.query(
    `UPDATE tasks SET
       status = CASE WHEN has_side_effects THEN 'requiere_revision' WHEN attempts < max_attempts THEN 'pendiente' ELSE 'fallida' END,
       last_error = 'Recuperada tras interrupción', locked_by = NULL, locked_until = NULL, updated_at = now()
     WHERE status IN ('en_ejecucion', 'verificando') AND locked_until < now() RETURNING id, status`);
  if (rows.length) await audit(db, actor, 'tareas.recuperadas', { tareas: rows });
  return rows;
}

export async function cancelTask(db: Db, id: number, actor: string) {
  const { rows } = await db.query(
    `UPDATE tasks SET status = 'cancelada', locked_by = NULL, locked_until = NULL, updated_at = now()
     WHERE id = $1 AND status NOT IN ('completada','cancelada') RETURNING id, business_id`, [id]);
  if (rows[0]) await audit(db, actor, 'tarea.cancelada', { id }, rows[0].business_id);
  return rows.length > 0;
}

// Marca que el resultado existe y se está comprobando (estado no terminal «verificando»)
export async function markVerifying(db: Db, task: any, workerId: string) {
  await db.query(`UPDATE tasks SET status = 'verificando', locked_until = now() + interval '5 minutes', updated_at = now()
    WHERE id = $1 AND status = 'en_ejecucion' AND locked_by = $2`, [task.id, workerId]);
}

// Progreso recuperable: cada paso terminado queda anotado en la tarea (el productor de vídeo, p. ej., reanuda por archivos)
export async function checkpoint(db: Db, taskId: number, paso: string, datos: Record<string, unknown> = {}) {
  await db.query(`UPDATE tasks SET checkpoints = checkpoints || $2::jsonb, updated_at = now() WHERE id = $1`,
    [taskId, JSON.stringify([{ at: new Date().toISOString(), paso: paso.slice(0, 120), datos }])]);
}
