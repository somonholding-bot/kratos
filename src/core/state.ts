import type { Db, Tx } from '../db.ts';

type Q = Db | Tx;

export async function audit(q: Q, actor: string, action: string, details: Record<string, unknown> = {}, businessId: number | null = null) {
  await q.query('INSERT INTO audit_log (actor, action, business_id, details) VALUES ($1, $2, $3, $4)', [actor, action, businessId, details]);
}

export async function getState(q: Q): Promise<Record<string, any>> {
  const { rows } = await q.query('SELECT key, value, updated_at, updated_by FROM system_state');
  return Object.fromEntries(rows.map((r) => [r.key, r.value]));
}

export async function isHalted(q: Q): Promise<{ halted: boolean; reason?: string }> {
  const s = await getState(q);
  if (s.emergency_stop === true) return { halted: true, reason: 'parada de emergencia activa' };
  if (s.automations_paused === true) return { halted: true, reason: 'automatizaciones en pausa' };
  return { halted: false };
}

async function setFlag(q: Q, key: string, value: unknown, actor: string) {
  await q.query('UPDATE system_state SET value = $2, updated_at = now(), updated_by = $3 WHERE key = $1', [key, JSON.stringify(value), actor]);
  await audit(q, actor, `estado.${key}`, { value });
}

// Parada de emergencia: bloquea nuevas acciones, cancela lo que esté en ejecución
// y deja constancia de lo que pueda seguir activo fuera (hoy: nada conectado).
export async function emergencyStop(q: Q, actor: string) {
  await setFlag(q, 'emergency_stop', true, actor);
  const { rows } = await q.query(
    `UPDATE tasks SET status = 'cancelada', last_error = 'Parada de emergencia', locked_by = NULL, locked_until = NULL, updated_at = now()
     WHERE status = 'en_ejecucion' RETURNING id`);
  const external = { campanas_externas: 'Ninguna conexión externa activa: no hay campañas que pausar.' };
  await audit(q, actor, 'emergencia.detalle', { tareas_canceladas: rows.map((r) => r.id), ...external });
  return { cancelled: rows.map((r) => r.id), external };
}

export async function resumeFromEmergency(q: Q, actor: string) {
  await setFlag(q, 'emergency_stop', false, actor);
}

export async function setAutomationsPaused(q: Q, paused: boolean, actor: string) {
  await setFlag(q, 'automations_paused', paused, actor);
}

export async function heartbeat(q: Q, processName: string, info: Record<string, unknown> = {}) {
  await q.query(
    `INSERT INTO heartbeats (process, pid, at, info) VALUES ($1, $2, now(), $3)
     ON CONFLICT (process) DO UPDATE SET pid = EXCLUDED.pid, at = now(), info = EXCLUDED.info`,
    [processName, process.pid, info]);
}
