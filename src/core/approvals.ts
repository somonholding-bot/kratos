import type { Db } from '../db.ts';
import { audit } from './state.ts';
import { allocate } from './budget.ts';
import { onApprovalDecided } from './plugins.ts';
import { onCodeApproval } from './claudecode.ts';

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

// Cualquiera (incluido Jarvis) puede SOLICITAR. Solo el panel, con sesión local, puede DECIDIR.
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

export async function decideApproval(db: Db, id: number, approve: boolean, via: 'panel') {
  if (via !== 'panel') throw new Error('Las aprobaciones solo se deciden en el panel');
  const { rows } = await db.query(
    `UPDATE approvals SET status = $2, decided_at = now(), decided_via = $3
     WHERE id = $1 AND status = 'pendiente' AND valid_until >= now() RETURNING *`,
    [id, approve ? 'aprobada' : 'rechazada', via]);
  const a = rows[0];
  if (!a) return { ok: false, reason: 'No existe, ya se decidió o caducó' };
  await audit(db, 'propietario', approve ? 'aprobacion.aprobada' : 'aprobacion.rechazada', { id, kind: a.kind }, a.business_id);

  if (approve && a.kind === 'asignacion_presupuesto') {
    const validUntil = (a.scope?.valid_until as string | undefined) ?? null;
    await allocate(db, a.account_label, Number(a.max_amount_cents), validUntil, `aprobacion:${a.id}`, 'propietario', a.business_id);
    await db.query(`UPDATE approvals SET status = 'ejecutada' WHERE id = $1`, [id]);
  }
  await onApprovalDecided(db, a, approve);
  await onCodeApproval(db, a, approve);
  return { ok: true, approval: a };
}
