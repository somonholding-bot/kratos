import type { Db } from '../db.ts';
import { audit, getState } from './state.ts';
import { allocate } from './budget.ts';
import { onApprovalDecided } from './plugins.ts';
import { onCodeApproval } from './claudecode.ts';
import { onSelfApproval } from './selfimprove.ts';

export type ApprovalRequest = {
  businessId?: number | null;
  kind: 'asignacion_presupuesto' | 'accion_externa' | 'nuevo_acceso' | 'publicacion' | 'otro';
  description: string;
  scope?: Record<string, unknown>;
  accountLabel?: string | null;
  maxAmountCents?: number | null;
  validDays?: number;
  requestedBy: string;
  taskId?: number | null;
};

// Cualquiera (incluido Jarvis) puede SOLICITAR. Solo el panel, con sesión local, puede DECIDIR,
// salvo lo que el propietario delegó con la autonomía amplia (ver autoApprove).
export async function requestApproval(db: Db, r: ApprovalRequest) {
  const { rows } = await db.query(
    `INSERT INTO approvals (business_id, kind, description, scope, account_label, max_amount_cents, valid_until, requested_by, task_id)
     VALUES ($1,$2,$3,$4,$5,$6, now() + make_interval(days => $7), $8, $9) RETURNING *`,
    [r.businessId ?? null, r.kind, r.description, r.scope ?? {}, r.accountLabel ?? null, r.maxAmountCents ?? null, r.validDays ?? 7, r.requestedBy, r.taskId ?? null]);
  await audit(db, r.requestedBy, 'aprobacion.solicitada', { id: rows[0].id, kind: r.kind, description: r.description }, r.businessId ?? null);
  return rows[0];
}

export async function expireApprovals(db: Db, actor: string) {
  const { rows } = await db.query(`UPDATE approvals SET status = 'caducada' WHERE status = 'pendiente' AND valid_until < now() RETURNING id`);
  if (rows.length) await audit(db, actor, 'aprobaciones.caducadas', { ids: rows.map((r) => r.id) });
  return rows.length;
}

// Autonomía amplia (decisión del propietario, 29-oct-2026): KRATOS aprueba solo estos tipos, que ya corren aislados:
// funciones nuevas (proceso sin archivos ni red local) y encargos a Claude Code (solo ~/KratosProyectos, sin terminal).
// Dinero, accesos, publicaciones y cambios en su propio código siguen exigiendo el panel.
const DELEGATED = new Set(['nueva_funcion', 'claude_code']);
export async function autoApprove(db: Db, id: number): Promise<boolean> {
  const st = await getState(db);
  if (st.autonomia === 'estricta' || st.emergency_stop === true || st.automations_paused === true) return false;
  const a = (await db.query(`SELECT kind, scope FROM approvals WHERE id = $1 AND status = 'pendiente'`, [id])).rows[0];
  if (!a || a.kind !== 'otro' || !DELEGATED.has(a.scope?.tipo)) return false;
  return (await decideApproval(db, id, true, 'autonomia')).ok;
}

export async function decideApproval(db: Db, id: number, approve: boolean, via: 'panel' | 'autonomia') {
  if (via !== 'panel' && via !== 'autonomia') throw new Error('Las aprobaciones solo se deciden en el panel');
  const { rows } = await db.query(
    `UPDATE approvals SET status = $2, decided_at = now(), decided_via = $3
     WHERE id = $1 AND status = 'pendiente' AND valid_until >= now() RETURNING *`,
    [id, approve ? 'aprobada' : 'rechazada', via]);
  const a = rows[0];
  if (!a) return { ok: false, reason: 'No existe, ya se decidió o caducó' };
  await audit(db, via === 'panel' ? 'propietario' : 'kratos (autonomía delegada)', approve ? 'aprobacion.aprobada' : 'aprobacion.rechazada', { id, kind: a.kind }, a.business_id);

  if (approve && a.kind === 'asignacion_presupuesto' && via === 'panel') {
    const validUntil = (a.scope?.valid_until as string | undefined) ?? null;
    await allocate(db, a.account_label, Number(a.max_amount_cents), validUntil, `aprobacion:${a.id}`, 'propietario', a.business_id);
    await db.query(`UPDATE approvals SET status = 'ejecutada' WHERE id = $1`, [id]);
  }
  await onApprovalDecided(db, a, approve);
  await onCodeApproval(db, a, approve);
  await onSelfApproval(db, a, approve);
  return { ok: true, approval: a };
}
