import type { Db } from '../db.ts';
import { config } from '../config.ts';
import { expireApprovals } from './approvals.ts';
import { appendDaily } from './vault.ts';
import { executeSpecialistTask } from './brain.ts';

// Manejadores deterministas que el trabajador ejecuta sin IA y sin coste.
// Las tareas de tipo 'agente' quedan en 'esperando_ia' hasta conectar Claude.

type Handler = (db: Db, task: any) => Promise<Record<string, unknown>>;

export const handlers: Record<string, Handler> = {
  async agente(db, task) {
    return executeSpecialistTask(db, task);
  },

  async revision_salud(db, task) {
    const expired = await expireApprovals(db, 'trabajador');
    const hb = (await db.query(`SELECT process, extract(epoch FROM now() - at)::int AS age FROM heartbeats`)).rows;
    const stale = hb.filter((h) => h.age > config.worker.heartbeatStaleSeconds && h.process !== 'worker').map((h) => h.process);
    const stuck = (await db.query(`SELECT count(*)::int AS n FROM tasks WHERE status = 'requiere_revision'`)).rows[0].n;
    const content = `Procesos sin latido reciente: ${stale.length ? stale.join(', ') : 'ninguno'}. Tareas que requieren revisión: ${stuck}. Aprobaciones caducadas ahora: ${expired}.`;
    await db.query(`INSERT INTO knowledge_items (business_id, kind, topic, content, source, created_by) VALUES ($1, 'observacion', 'Salud del sistema', $2, 'Revisión automática', 'saturno')`,
      [task.business_id, content]);
    return { stale, stuck, expired };
  },

  async informe_portafolio(db, task) {
    const m = (await db.query(`SELECT b.name, m.metric, m.value, m.source, m.observed_at, m.is_demo FROM metrics m JOIN businesses b ON b.id = m.business_id ORDER BY b.id, m.metric`)).rows;
    const known = m.filter((r) => r.value !== null).map((r) => `${r.name} · ${r.metric} = ${r.value}${r.is_demo ? ' (DEMO)' : ''} [${r.source}]`);
    const unknown = m.filter((r) => r.value === null).map((r) => `${r.name} · ${r.metric}`);
    const content = `Métricas conocidas: ${known.join('; ') || 'ninguna'}. Desconocidas (no se inventan): ${unknown.join('; ') || 'ninguna'}.`;
    await db.query(`INSERT INTO knowledge_items (business_id, kind, topic, content, source, created_by) VALUES ($1, 'observacion', 'Informe del portafolio', $2, 'Tabla metrics', 'saturno')`,
      [task.business_id, content]);
    appendDaily(`Informe del portafolio. ${content}`);
    return { known: known.length, unknown: unknown.length };
  },
};
