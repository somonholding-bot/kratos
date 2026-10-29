import type { Db } from '../db.ts';

// Reporte del propietario: dinero invertido y ganado, trabajo hecho y lo que espera su decisión.
// Solo cifras registradas; lo que no se conoce se dice «desconocido», nunca se inventa.

export async function buildReport(db: Db) {
  const q = async (sql: string, args: unknown[] = []) => (await db.query(sql, args)).rows;
  const [budget] = await q(`SELECT coalesce(sum(limit_cents),0)::bigint AS assigned, coalesce(sum(spent_cents),0)::bigint AS spent, coalesce(sum(reserved_cents),0)::bigint AS reserved FROM budget_accounts`);
  const accounts = await q(`SELECT label, limit_cents, spent_cents FROM budget_accounts WHERE limit_cents > 0 OR spent_cents > 0 ORDER BY spent_cents DESC`);
  const [ai] = await q(`SELECT coalesce(sum(cost_microusd),0)::bigint AS micro, count(*)::int AS calls FROM ai_usage WHERE at > now() - interval '30 days'`);
  const revenue = await q(`SELECT b.name, m.value, m.observed_at, m.is_demo FROM metrics m JOIN businesses b ON b.id = m.business_id WHERE m.metric = 'ingresos_netos' AND m.value IS NOT NULL ORDER BY m.observed_at DESC`);
  const realRevenue = revenue.filter((r) => !r.is_demo);
  const users = await q(`SELECT coalesce(sum(m.value),0)::numeric AS n, count(*)::int AS known FROM metrics m WHERE m.metric = 'instalaciones' AND m.value IS NOT NULL AND NOT m.is_demo`);
  const done = await q(`SELECT t.id, t.title, t.owner_function, t.updated_at FROM tasks t WHERE t.status = 'completada' AND t.type NOT IN ('revision_salud','apple_sync') AND t.updated_at > now() - interval '7 days' ORDER BY t.updated_at DESC LIMIT 8`);
  const [counts] = await q(`SELECT count(*) FILTER (WHERE status = 'en_ejecucion')::int AS running, count(*) FILTER (WHERE status IN ('pendiente','esperando_ia'))::int AS queued,
      count(*) FILTER (WHERE status = 'completada' AND updated_at > now() - interval '7 days')::int AS done7 FROM tasks WHERE type NOT IN ('revision_salud','apple_sync')`);
  const approvals = await q(`SELECT id, description, max_amount_cents FROM approvals WHERE status = 'pendiente' ORDER BY id`);
  const lessons = await q(`SELECT agent, kind, content FROM lessons ORDER BY id DESC LIMIT 3`);
  const apps = await q(`SELECT name, version, state FROM app_store_apps ORDER BY name`);
  const invested = Number(budget.spent);
  const earned = realRevenue.length ? realRevenue.reduce((s, r) => s + Number(r.value), 0) : null;
  return {
    at: new Date(),
    money: {
      investedUsd: invested / 100, assignedUsd: Number(budget.assigned) / 100, availableUsd: (Number(budget.assigned) - invested - Number(budget.reserved)) / 100,
      earnedUsd: earned, aiCost30dUsd: Number(ai.micro) / 1e6, aiCalls30d: ai.calls,
      accounts: accounts.map((a) => ({ label: a.label, assignedUsd: Number(a.limit_cents) / 100, spentUsd: Number(a.spent_cents) / 100 })),
    },
    goal: { users: Number(users[0].known) ? Number(users[0].n) : null, milestone: 10_000, target: 100_000, monthlyRevenueTarget: 250_000 },
    work: { running: counts.running, queued: counts.queued, done7: counts.done7, recent: done },
    approvals, lessons, apps,
  };
}

const usd = (n: number) => `${n.toLocaleString('es', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} dólares`;

export function spokenReport(r: Awaited<ReturnType<typeof buildReport>>, address: string): string {
  const parts = [`Su reporte, ${address}.`];
  parts.push(`Invertido hasta ahora: ${usd(r.money.investedUsd)} de ${usd(r.money.assignedUsd)} asignados.`);
  parts.push(r.money.earnedUsd === null ? 'Ingresos: todavía no hay ventas registradas.' : `Ingresos registrados: ${usd(r.money.earnedUsd)}.`);
  parts.push(`Esta semana se completaron ${r.work.done7} tareas; hay ${r.work.running} en curso y ${r.work.queued} en cola.`);
  if (r.approvals.length) parts.push(`Tiene ${r.approvals.length} ${r.approvals.length === 1 ? 'decisión pendiente' : 'decisiones pendientes'} en el panel.`);
  parts.push('Le dejo el detalle a la izquierda.');
  return parts.join(' ');
}
