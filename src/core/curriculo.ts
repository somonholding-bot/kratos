import type { Db } from '../db.ts';
import { audit, getState, isHalted } from './state.ts';
import { instantiatePlaybook } from './playbooks.ts';

// Currículo interno de Sol (operación Omega): 36 módulos que amplían su biblioteca de forma ordenada.
// Lo dirige el código, sin IA: un módulo cada vez, con tope diario (system_state.omega_modulos_dia; 0 = pausado) para no
// bloquear al resto de la empresa ni gastar la cuota de la suscripción. Un módulo solo cuenta como completado si su tarea
// pasó la verificación del playbook (fuentes abiertas, afirmaciones con nivel de evidencia y paquete recuperable).
const MAX_INTENTOS = 2;
type Launch = (db: Db, m: { n: number; bloque: string; titulo: string }) => Promise<{ tarea?: number }>;

const launchModule: Launch = async (db, m) => {
  const biz = (await db.query(`SELECT id FROM businesses ORDER BY is_demo, id LIMIT 1`)).rows[0];
  const r = await instantiatePlaybook(db, { id: 'sol-modulo', negocioId: biz.id, parametros: { numero: m.n, modulo: m.titulo, bloque: m.bloque } });
  if (!r.ok) throw new Error(String(r.error ?? JSON.stringify(r)).slice(0, 200));
  await db.query(`UPDATE tasks SET priority = 3 WHERE id = $1 AND status = 'pendiente'`, [r.tarea]);   // por detrás del trabajo de la empresa
  return { tarea: r.tarea };
};

export async function advanceCurriculum(db: Db, actor = 'curriculo', launch: Launch = launchModule) {
  // 1) Cerrar los módulos cuya tarea terminó
  const activos = (await db.query(`SELECT m.n, m.intentos, t.status, (SELECT id FROM sol_proyectos p WHERE p.tarea_id = m.tarea_id ORDER BY id DESC LIMIT 1) AS proyecto
    FROM sol_modulos m LEFT JOIN tasks t ON t.id = m.tarea_id WHERE m.estado = 'en_curso'`)).rows;
  for (const a of activos) {
    if (a.status === 'completada') {
      await db.query(`UPDATE sol_modulos SET estado = 'completado', proyecto_id = $2, completado_en = now() WHERE n = $1`, [a.n, a.proyecto]);
      await audit(db, actor, 'omega.modulo_completado', { modulo: a.n, proyecto: a.proyecto });
    } else if (!a.status || ['fallida', 'cancelada', 'requiere_revision'].includes(a.status)) {
      const fin = a.intentos >= MAX_INTENTOS;
      await db.query(`UPDATE sol_modulos SET estado = $2, tarea_id = NULL WHERE n = $1`, [a.n, fin ? 'fallido' : 'pendiente']);
      await audit(db, actor, fin ? 'omega.modulo_fallido' : 'omega.modulo_reintento', { modulo: a.n, estado_tarea: a.status ?? 'sin tarea' });
    }
  }
  // 2) Lanzar el siguiente, si no hay otro en curso y queda cupo de hoy
  if ((await isHalted(db)).halted) return { lanzado: null, motivo: 'KRATOS detenido' };
  const cupo = Number((await getState(db)).omega_modulos_dia ?? 4);
  if (!(cupo > 0)) return { lanzado: null, motivo: 'currículo en pausa (omega_modulos_dia = 0)' };
  const enCurso = (await db.query(`SELECT count(*)::int AS n FROM sol_modulos WHERE estado = 'en_curso'`)).rows[0].n;
  if (enCurso) return { lanzado: null, motivo: 'ya hay un módulo en curso' };
  const hoy = (await db.query(`SELECT count(*)::int AS n FROM sol_modulos WHERE lanzado_en > now() - interval '24 hours'`)).rows[0].n;
  if (hoy >= cupo) return { lanzado: null, motivo: `cupo diario alcanzado (${hoy}/${cupo})` };
  const m = (await db.query(`SELECT n, bloque, titulo FROM sol_modulos WHERE estado = 'pendiente' ORDER BY n LIMIT 1`)).rows[0];
  if (!m) return { lanzado: null, motivo: 'currículo terminado' };
  try {
    const r = await launch(db, m);
    await db.query(`UPDATE sol_modulos SET estado = 'en_curso', tarea_id = $2, intentos = intentos + 1, lanzado_en = now() WHERE n = $1`, [m.n, r.tarea ?? null]);
    await audit(db, actor, 'omega.modulo_lanzado', { modulo: m.n, titulo: m.titulo, tarea: r.tarea ?? null });
    return { lanzado: m.n, tarea: r.tarea ?? null };
  } catch (e: any) {
    await audit(db, actor, 'omega.modulo_error', { modulo: m.n, error: String(e?.message ?? e).slice(0, 200) });
    return { lanzado: null, motivo: String(e?.message ?? e).slice(0, 200) };
  }
}
