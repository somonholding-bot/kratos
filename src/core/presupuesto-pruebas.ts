import type { Db } from '../db.ts';
import { requestApproval } from './approvals.ts';
import { reserve, settle } from './budget.ts';
import { audit } from './state.ts';

// Presupuesto mensual de pruebas (orden del propietario, 5-nov-2026): 100 USD al mes que KRATOS gasta SOLO en experimentos de negocio,
// sin pedir permiso por cada uno. El propietario lo autoriza una vez al mes con un clic en el panel (asignación de presupuesto); lo que
// sobra se acumula. Cada gasto pasa por el libro de presupuesto (reserva → cargo), nunca supera el saldo y se ve en el registro.
export const CUENTA_PRUEBAS = 'Pruebas de negocio (KSIE)';

export async function saldoPruebas(db: Db) {
  const a = (await db.query(`SELECT id, limit_cents, reserved_cents, spent_cents, valid_until, status FROM budget_accounts WHERE label = $1`, [CUENTA_PRUEBAS])).rows[0];
  if (!a) return { activa: false, disponible_cents: 0 };
  const vigente = a.status === 'activa' && (!a.valid_until || new Date(a.valid_until) > new Date());
  return { activa: vigente, cuenta_id: a.id, disponible_cents: vigente ? Number(a.limit_cents) - Number(a.reserved_cents) - Number(a.spent_cents) : 0,
    gastado_cents: Number(a.spent_cents), asignado_cents: Number(a.limit_cents), vence: a.valid_until };
}

// Pide (una vez, o al renovarse cada mes) la asignación al propietario: un clic en el panel
export async function pedirAsignacionMensual(db: Db, actor = 'kratos (presupuesto de pruebas)') {
  const pendiente = (await db.query(`SELECT id FROM approvals WHERE status = 'pendiente' AND account_label = $1`, [CUENTA_PRUEBAS])).rows[0];
  if (pendiente) return { pedida: false, aprobacion: pendiente.id, motivo: 'ya está pendiente en el panel' };
  const s = await saldoPruebas(db);
  if (s.activa && s.vence && new Date(s.vence).getTime() - Date.now() > 3 * 86_400_000) return { pedida: false, motivo: 'la asignación de este mes sigue vigente' };
  const cents = Number((await db.query(`SELECT value FROM system_state WHERE key = 'presupuesto_pruebas_mensual_cents'`)).rows[0]?.value ?? 10000);
  const hasta = new Date(Date.now() + 33 * 86_400_000).toISOString();
  const a = await requestApproval(db, { kind: 'asignacion_presupuesto', accountLabel: CUENTA_PRUEBAS, maxAmountCents: cents, validDays: 30, requestedBy: actor,
    description: `Presupuesto mensual de pruebas de negocio: ${cents / 100} USD para que KRATOS haga experimentos baratos (anuncios pequeños, prototipos, presupuestos) sin pedir permiso por cada uno. Lo que sobre se acumula al mes siguiente.`,
    scope: { tipo: 'presupuesto_mensual_pruebas', valid_until: hasta } });
  await audit(db, actor, 'presupuesto_pruebas.solicitado', { aprobacion: a.id, cents });
  return { pedida: true, aprobacion: a.id, estado: a.status };
}

// Reserva el gasto de un experimento si cabe en el saldo; si no cabe, no se reserva nada (y se pedirá aprobación como siempre)
export async function reservarExperimento(db: Db, experimentoId: number, cents: number, actor: string) {
  const s = await saldoPruebas(db);
  if (!s.activa || cents > s.disponible_cents) return { ok: false, motivo: s.activa ? `saldo de pruebas insuficiente (${s.disponible_cents / 100} USD disponibles)` : 'no hay presupuesto de pruebas aprobado este mes' };
  const clave = `experimento:${experimentoId}`;
  const r = await reserve(db, s.cuenta_id!, cents, clave, actor);
  if (!r.ok) return { ok: false, motivo: r.reason };
  await db.query(`UPDATE experiments SET reserva_clave = $2 WHERE id = $1`, [experimentoId, clave]);
  return { ok: true, clave, disponible_restante_usd: (s.disponible_cents - cents) / 100 };
}
export async function cerrarGastoExperimento(db: Db, experimentoId: number, gastoRealCents: number, actor: string) {
  const e = (await db.query(`SELECT reserva_clave FROM experiments WHERE id = $1`, [experimentoId])).rows[0];
  if (!e?.reserva_clave) return null;
  return await settle(db, e.reserva_clave, Math.max(0, Math.round(gastoRealCents)), actor);
}

// Ampliación justificada (propietario, 6-nov-2026): el presupuesto de pruebas es de 100 USD al mes, pero KRATOS puede PEDIR más si lo justifica
// con resultados reales. Sigue decidiéndolo el propietario en el panel (un clic); aquí solo se exige que la petición tenga fundamento.
export async function pedirAmpliacion(db: Db, i: { usd: number; justificacion: string; experimento_ids?: number[] }, actor: string) {
  const usd = Number(i.usd), j = String(i.justificacion ?? '').trim();
  if (!(usd >= 10 && usd <= 500)) throw new Error('Pide entre 10 y 500 USD por vez');
  if (j.length < 120) throw new Error('La justificación debe explicar con datos por qué más dinero (≥ 120 caracteres): qué funcionó, qué se espera y cómo se medirá');
  const exps = (await db.query(`SELECT id, status, interpretacion FROM experiments WHERE id = ANY($1) AND oportunidad_id IS NOT NULL AND resultados IS NOT NULL`, [i.experimento_ids ?? []])).rows;
  const s = await saldoPruebas(db);
  if (s.activa && s.disponible_cents > 2000 && !exps.length) throw new Error(`Todavía quedan ${s.disponible_cents / 100} USD del presupuesto: gástalos primero en experimentos y pide más con sus resultados`);
  if (!exps.length && s.gastado_cents > 0) throw new Error('Cita al menos un experimento con resultados (experimento_ids) que respalde la petición');
  const pendiente = (await db.query(`SELECT id FROM approvals WHERE status = 'pendiente' AND account_label = $1`, [CUENTA_PRUEBAS])).rows[0];
  if (pendiente) return { pedida: false, aprobacion: pendiente.id, motivo: 'ya hay una petición pendiente en el panel' };
  const hasta = new Date(Date.now() + 33 * 86_400_000).toISOString();
  const a = await requestApproval(db, { kind: 'asignacion_presupuesto', accountLabel: CUENTA_PRUEBAS, maxAmountCents: Math.round(usd * 100), validDays: 14, requestedBy: actor,
    description: `Ampliar el presupuesto de pruebas en ${usd} USD. ${j}${exps.length ? ` Respaldo: ${exps.map((e) => `experimento #${e.id} (${e.status})`).join(', ')}.` : ''}`.slice(0, 900), scope: { tipo: 'ampliacion_presupuesto_pruebas', valid_until: hasta } });
  await audit(db, actor, 'presupuesto_pruebas.ampliacion', { aprobacion: a.id, usd });
  return { pedida: true, aprobacion: a.id, estado: a.status, nota: 'El propietario decide en el panel (Aprobaciones).' };
}
