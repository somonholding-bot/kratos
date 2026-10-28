import { withTx, type Db } from '../db.ts';
import { audit, isHalted } from './state.ts';

// Libro financiero determinista. Claude nunca escribe aquí: solo este código.
// Cada movimiento lleva una clave de idempotencia única; repetirla devuelve el resultado original.

export type ReserveResult =
  | { ok: true; movementId: number; repeated: boolean }
  | { ok: false; reason: string };

export async function reserve(db: Db, accountId: number, amountCents: number, key: string, actor: string, taskId: number | null = null): Promise<ReserveResult> {
  if (!Number.isInteger(amountCents) || amountCents <= 0) return { ok: false, reason: 'importe inválido' };
  return withTx(db, async (tx) => {
    const prev = await tx.query('SELECT id, kind, account_id FROM budget_movements WHERE idempotency_key = $1', [key]);
    if (prev.rows[0]) return { ok: true, movementId: Number(prev.rows[0].id), repeated: true } as const;

    const halt = await isHalted(tx);
    if (halt.halted) return { ok: false, reason: halt.reason! } as const;

    // Bloqueo de fila: dos agentes reservando a la vez se ordenan aquí.
    const acc = (await tx.query('SELECT * FROM budget_accounts WHERE id = $1 FOR UPDATE', [accountId])).rows[0];
    if (!acc) return { ok: false, reason: 'cuenta inexistente' } as const;
    if (acc.status !== 'activa') return { ok: false, reason: 'cuenta suspendida' } as const;
    if (acc.valid_until && new Date(acc.valid_until) < new Date()) return { ok: false, reason: 'asignación caducada' } as const;
    const available = Number(acc.limit_cents) - Number(acc.reserved_cents) - Number(acc.spent_cents);
    if (amountCents > available) {
      await audit(tx, actor, 'presupuesto.reserva_rechazada', { accountId, amountCents, available, key });
      return { ok: false, reason: `saldo insuficiente (disponible ${available} centavos)` } as const;
    }
    await tx.query('UPDATE budget_accounts SET reserved_cents = reserved_cents + $2 WHERE id = $1', [accountId, amountCents]);
    const mv = await tx.query(
      `INSERT INTO budget_movements (account_id, kind, amount_cents, idempotency_key, task_id, actor) VALUES ($1, 'reserva', $2, $3, $4, $5) RETURNING id`,
      [accountId, amountCents, key, taskId, actor]);
    await audit(tx, actor, 'presupuesto.reserva', { accountId, amountCents, key });
    return { ok: true, movementId: Number(mv.rows[0].id), repeated: false } as const;
  });
}

// Libera una reserva (total o parcialmente) o la convierte en cargo efectivo.
export async function settle(db: Db, reserveKey: string, chargedCents: number, actor: string) {
  return withTx(db, async (tx) => {
    const r = (await tx.query(`SELECT * FROM budget_movements WHERE idempotency_key = $1 AND kind = 'reserva' FOR UPDATE`, [reserveKey])).rows[0];
    if (!r) throw new Error('reserva inexistente');
    const done = await tx.query('SELECT 1 FROM budget_movements WHERE idempotency_key = $1', [`${reserveKey}:cierre`]);
    if (done.rowCount) return { repeated: true };
    const reserved = Number(r.amount_cents);
    const charge = Math.min(chargedCents, reserved);
    await tx.query('UPDATE budget_accounts SET reserved_cents = reserved_cents - $2, spent_cents = spent_cents + $3 WHERE id = $1', [r.account_id, reserved, charge]);
    await tx.query(`INSERT INTO budget_movements (account_id, kind, amount_cents, idempotency_key, task_id, actor, note) VALUES ($1, 'cargo', $2, $3, $4, $5, $6)`,
      [r.account_id, charge, `${reserveKey}:cierre`, r.task_id, actor, `liberado ${reserved - charge}`]);
    await audit(tx, actor, 'presupuesto.cierre', { reserveKey, charge, released: reserved - charge });
    return { repeated: false, charge, released: reserved - charge };
  });
}

// Solo se llama al ejecutar una aprobación confirmada en el panel.
export async function allocate(db: Db, label: string, amountCents: number, validUntil: string | null, key: string, actor: string, businessId: number | null) {
  return withTx(db, async (tx) => {
    const prev = await tx.query('SELECT 1 FROM budget_movements WHERE idempotency_key = $1', [key]);
    if (prev.rowCount) return { repeated: true };
    let acc = (await tx.query('SELECT id FROM budget_accounts WHERE label = $1 FOR UPDATE', [label])).rows[0];
    if (!acc) {
      acc = (await tx.query(`INSERT INTO budget_accounts (business_id, scope, label, limit_cents, valid_until) VALUES ($1, $2, $3, 0, $4) RETURNING id`,
        [businessId, businessId ? 'negocio' : 'global', label, validUntil])).rows[0];
    }
    await tx.query('UPDATE budget_accounts SET limit_cents = limit_cents + $2, valid_until = COALESCE($3, valid_until) WHERE id = $1', [acc.id, amountCents, validUntil]);
    await tx.query(`INSERT INTO budget_movements (account_id, kind, amount_cents, idempotency_key, actor) VALUES ($1, 'asignacion', $2, $3, $4)`, [acc.id, amountCents, key, actor]);
    await audit(tx, actor, 'presupuesto.asignacion', { label, amountCents, validUntil }, businessId);
    return { repeated: false, accountId: acc.id };
  });
}
