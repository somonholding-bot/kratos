import type { Db } from '../db.ts';
import { audit, getState } from './state.ts';
import { allocate } from './budget.ts';
import { onApprovalDecided } from './plugins.ts';
import { onCodeApproval } from './claudecode.ts';
import { onSelfApproval } from './selfimprove.ts';
import { onYoutubeApproval } from './youtube.ts';

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
  // Autonomía total salvo dinero (decisión del propietario, 4-nov-2026): lo que no sea gastar ni suscribirse se aprueba y ejecuta al momento.
  // Los flujos que crean algo después (función nueva, encargo a Claude Code, auto-mejora, playbook) llaman a autoApprove ellos mismos cuando ya está todo enlazado.
  if (!DESPUES.has(r.scope?.tipo as string) && await autoApprove(db, rows[0].id).catch(() => false)) return (await db.query(`SELECT * FROM approvals WHERE id = $1`, [rows[0].id])).rows[0];
  return rows[0];
}

export async function expireApprovals(db: Db, actor: string) {
  const { rows } = await db.query(`UPDATE approvals SET status = 'caducada' WHERE status = 'pendiente' AND valid_until < now() RETURNING id`);
  if (rows.length) await audit(db, actor, 'aprobaciones.caducadas', { ids: rows.map((r) => r.id) });
  return rows.length;
}

// Autonomía total salvo dinero (decisión del propietario, 4-nov-2026). Solo exigen al propietario en el panel:
//  · dinero: asignaciones de presupuesto, cualquier importe, gastos, compras, pagos, publicidad y SUSCRIPCIONES;
//  · borrar vídeos del canal (irreversible; el propietario dijo «antes de borrar, me dice»).
// Todo lo demás (publicar, cambios de canal, funciones nuevas, Claude Code, auto-mejora, accesos…) se aprueba y ejecuta solo.
// El código sigue aplicando parada de emergencia, pausa de automatizaciones, el libro de presupuesto y la autonomía «estricta».
const DESPUES = new Set(['nueva_funcion', 'claude_code', 'auto_mejora', 'revertir_mejora', 'playbook_ejecucion', 'playbook_resultado']);
const DINERO_KINDS = new Set(['asignacion_presupuesto']);
const DINERO_TIPOS = new Set(['suscripcion', 'gasto', 'compra', 'pago', 'publicidad']);
const SIEMPRE_PANEL = new Set(['youtube_borrar']);
const PIDE_DINERO = /suscrip|subscri|\b(pago|pagar|compra|comprar|gasto|gastar|cobro|factura)\b|\bUSD\b|€|\$\s?\d/i;
export function needsOwner(a: { kind: string; scope?: any; description?: string; max_amount_cents?: number | null }): boolean {
  return DINERO_KINDS.has(a.kind) || Number(a.max_amount_cents ?? 0) > 0 || DINERO_TIPOS.has(a.scope?.tipo) || SIEMPRE_PANEL.has(a.scope?.tipo) || PIDE_DINERO.test(a.description ?? '');
}
export async function autoApprove(db: Db, id: number): Promise<boolean> {
  const st = await getState(db);
  if (st.autonomia === 'estricta' || st.emergency_stop === true || st.automations_paused === true) return false;
  const a = (await db.query(`SELECT kind, scope, description, max_amount_cents FROM approvals WHERE id = $1 AND status = 'pendiente'`, [id])).rows[0];
  if (!a || needsOwner(a)) return false;
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
  await onYoutubeApproval(db, a, approve).catch(async (e) => { await audit(db, 'youtube', 'youtube.publicar_error', { id, error: String(e?.message ?? e).slice(0, 200) }); });
  return { ok: true, approval: a };
}
