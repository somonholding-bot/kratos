import { withTx, type Db } from '../db.ts';
import { audit, getState, isHalted } from './state.ts';
import { instantiatePlaybook } from './playbooks.ts';
import { seedSolDef } from './sol-def.ts';
import { MAX_INTENTOS, aplicarResultado, correccionesExamen, tituloConCodigo } from './examen.ts';
export { CURRICULO_CHECKS } from './examen.ts';   // en playbookchecks.ts impórtalo de examen.ts (evita un ciclo ESM con playbooks.ts)

// Currículo interno de Sol. Lo dirige el código, sin IA.
//  · Estudio: un estudio cada vez (módulo antiguo o materia nueva) con el MISMO tope diario de siempre (system_state.omega_modulos_dia;
//    0 = pausado), compartido por los 36 módulos de Omega (sol_modulos) y las 56 materias de PROJECT SOL (sol_unidades S/H/V).
//    Orden: primero los módulos antiguos aún pendientes que una materia reutiliza (modulos_previos); después la siguiente materia por
//    «orden», salvo cada 5.º lanzamiento, que toma el siguiente módulo antiguo pendiente NO fusionado (19 y 25–36: aplicación a la empresa
//    y la creación) para que no se quede sin estudiar. Un módulo «fusionado» nunca se lanza: lo cubre la materia que lo absorbe.
//    Un módulo o una materia solo cuentan como estudiados si su tarea pasó la verificación del playbook; una materia, además, solo si
//    existe su expediente (proyecto tipo materia). Máximo 2 intentos de estudio; después, «fallido(a)».
//    Si lanzar una materia falla (p. ej. falta una herramienta o el playbook aún no está importado), ese tipo espera 10 min sin
//    gastar intentos y, mientras, se sigue con los módulos antiguos pendientes (el cupo diario no cambia).
//  · Exámenes (A03): tope diario propio (system_state.sol_examenes_dia) y una tarea de examen cada vez, independientes del estudio.
//    Toda materia «estudiada» sin examen aprobado pasa por crear (Saturno) → responder (Sol, sin rúbrica) → calificar (Saturno).
//    Aprobado → «evaluada», el único estado que prueba dominio. Suspenso → vuelve a «pendiente» con los comentarios del examinador
//    en los parámetros del siguiente estudio (o «fallida» si ya se estudió 2 veces).
const CADA = 5;                         // cada 5.º lanzamiento de estudio es un módulo antiguo no fusionado
const ESPERA_ERROR_MS = 10 * 60_000;    // tras un error de lanzamiento no se reintenta ese tipo durante 10 min (sin bucles de errores)
const espera: Record<string, number> = {};
const libre = (k: string) => !(espera[k] > Date.now());
const FALLO_TAREA = ['fallida', 'cancelada', 'requiere_revision'];

export type Estudio =
  | { tipo: 'modulo'; n: number; bloque: string; titulo: string }
  | { tipo: 'materia'; codigo: string; titulo: string; alcance: string; correcciones: string; intento: number };
type Launch = (db: Db, e: Estudio) => Promise<{ tarea?: number }>;

// Las 80 unidades existen siempre antes de planificar (siembra idempotente, una vez por proceso)
let sembrado: Promise<unknown> | null = null;
export function asegurarSiembra(db: Db) {
  return (sembrado ??= seedSolDef(db).catch((e) => { sembrado = null; throw e; }));
}
// Si la siembra falla, el currículo anterior (módulos) no se para: sin unidades no hay materias que lanzar y se sigue con los módulos
const siembraSinParar = (db: Db) => asegurarSiembra(db).catch((e) => console.error('[curriculo] siembra de sol-def:', String(e?.message ?? e).slice(0, 200)));

// Un solo planificador a la vez aunque haya varios trabajadores (claimNext admite varios): sin dobles lanzamientos ni cupos rebasados
const CERROJO_ESTUDIO = 7450, CERROJO_EXAMEN = 7451;
async function enExclusiva<T>(db: Db, clave: number, fn: () => Promise<T>, ocupado: T): Promise<T> {
  const c = await db.connect();
  try {
    if (!(await c.query('SELECT pg_try_advisory_lock($1) AS ok', [clave])).rows[0].ok) return ocupado;
    try { return await fn(); } finally { await c.query('SELECT pg_advisory_unlock($1)', [clave]).catch(() => {}); }
  } finally { c.release(); }
}

// Lanza un playbook comprobando antes (sin crear nada) que existe y que el agente tiene todas sus herramientas:
// así una herramienta que falta no quema intentos de estudio ni deja tareas en revisión.
async function lanzarPlaybook(db: Db, id: string, parametros: Record<string, unknown>, creadoPor: string) {
  const biz = (await db.query(`SELECT id FROM businesses ORDER BY is_demo, id LIMIT 1`)).rows[0];
  if (!biz) throw new Error('No hay ningún negocio al que asignar la tarea');
  const o = { id, negocioId: biz.id, parametros, creadoPor };
  const v = await instantiatePlaybook(db, { ...o, soloValidar: true });
  if (!v.ok) throw new Error(String(v.error ?? JSON.stringify(v.faltan?.length ? v.faltan : v.invalidos ?? v)).slice(0, 240));
  if (v.avisos?.length) throw new Error(`faltan herramientas para ${id}: ${v.avisos.join('; ')}`.slice(0, 300));
  const r = await instantiatePlaybook(db, o);
  if (!r.ok) throw new Error(String(r.error ?? JSON.stringify(r)).slice(0, 240));
  // Con los mismos parámetros el mismo día, instantiatePlaybook devuelve la tarea ya abierta. Si esa tarea está en revisión
  // (o ya terminó), reutilizarla quemaría un intento sin estudiar nada: se para y se avisa; mañana se crea una tarea nueva.
  if (r.creada === false && ['completada', ...FALLO_TAREA].includes(String(r.estado)))
    throw new Error(`la tarea #${r.tarea} de hoy con estos mismos parámetros está «${r.estado}»: revísala o cancélala; no se gasta otro intento`);
  await db.query(`UPDATE tasks SET priority = 3 WHERE id = $1 AND status = 'pendiente'`, [r.tarea]);   // por detrás del trabajo de la empresa
  return { tarea: r.tarea as number };
}

export const parametrosMateria = (e: Extract<Estudio, { tipo: 'materia' }>) => ({ codigo: e.codigo, titulo: e.titulo, alcance: e.alcance, correcciones: e.correcciones });
const launchStudy: Launch = async (db, e) => e.tipo === 'materia'
  ? lanzarPlaybook(db, 'sol-materia', parametrosMateria(e), 'curriculo (planificador)')
  : lanzarPlaybook(db, 'sol-modulo', { numero: e.n, modulo: e.titulo, bloque: e.bloque }, 'curriculo (planificador)');

// Expediente de una materia cuya tarea terminó: el proyecto tipo materia de esa tarea (o reentregado durante ella)
async function expediente(db: Db, a: any): Promise<number | null> {
  const p = (await db.query(`SELECT id FROM sol_proyectos WHERE tipo = 'materia' AND estado = 'completed'
      AND (tarea_id = $1 OR (updated_at >= $3 AND (requisito = $2 OR titulo ~* $4))) ORDER BY (tarea_id = $1) DESC NULLS LAST, id DESC LIMIT 1`,
    [a.tarea_id, a.codigo, a.started_at ?? a.t_creada ?? new Date(), tituloConCodigo(a.codigo)])).rows[0];
  return p?.id ?? null;
}

async function siguienteEstudio(db: Db, lanzamientos: number): Promise<Estudio | null> {
  const modulo = async (soloPrevios: boolean) => (await db.query(`SELECT n, bloque, titulo FROM sol_modulos WHERE estado = 'pendiente' AND fusionado_en IS NULL
    ${soloPrevios ? 'AND n IN (SELECT unnest(modulos_previos) FROM sol_unidades)' : ''} ORDER BY n LIMIT 1`)).rows[0];
  if (libre('modulo')) { const p = await modulo(true); if (p) return { tipo: 'modulo', n: p.n, bloque: p.bloque, titulo: p.titulo }; }
  const m = libre('modulo') ? await modulo(false) : undefined;
  if (m && (lanzamientos + 1) % CADA === 0) return { tipo: 'modulo', n: m.n, bloque: m.bloque, titulo: m.titulo };
  const u = libre('materia') ? (await db.query(`SELECT codigo, titulo, alcance, intentos FROM sol_unidades WHERE tipo = 'materia' AND estado = 'pendiente' ORDER BY orden LIMIT 1`)).rows[0] : undefined;
  if (u) return { tipo: 'materia', codigo: u.codigo, titulo: u.titulo, alcance: u.alcance, correcciones: await correccionesExamen(db, u.codigo), intento: u.intentos + 1 };
  return m ? { tipo: 'modulo', n: m.n, bloque: m.bloque, titulo: m.titulo } : null;
}

export async function advanceCurriculum(db: Db, actor = 'curriculo', launch: Launch = launchStudy) {
  await siembraSinParar(db);
  return enExclusiva(db, CERROJO_ESTUDIO, () => avanzarEstudio(db, actor, launch), { lanzado: null, motivo: 'otro proceso está planificando el estudio ahora mismo' });
}
async function avanzarEstudio(db: Db, actor: string, launch: Launch) {
  // 1) Cerrar los módulos cuya tarea terminó (igual que siempre)
  const activos = (await db.query(`SELECT m.n, m.intentos, t.status, (SELECT id FROM sol_proyectos p WHERE p.tarea_id = m.tarea_id ORDER BY id DESC LIMIT 1) AS proyecto
    FROM sol_modulos m LEFT JOIN tasks t ON t.id = m.tarea_id WHERE m.estado = 'en_curso'`)).rows;
  for (const a of activos) {
    if (a.status === 'completada') {
      await db.query(`UPDATE sol_modulos SET estado = 'completado', proyecto_id = $2, completado_en = now() WHERE n = $1`, [a.n, a.proyecto]);
      await audit(db, actor, 'omega.modulo_completado', { modulo: a.n, proyecto: a.proyecto });
    } else if (!a.status || FALLO_TAREA.includes(a.status)) {
      const fin = a.intentos >= MAX_INTENTOS;
      await db.query(`UPDATE sol_modulos SET estado = $2, tarea_id = NULL WHERE n = $1`, [a.n, fin ? 'fallido' : 'pendiente']);
      await audit(db, actor, fin ? 'omega.modulo_fallido' : 'omega.modulo_reintento', { modulo: a.n, estado_tarea: a.status ?? 'sin tarea' });
    }
  }
  // 1b) Cerrar las materias cuya tarea terminó: «estudiada» solo con tarea verificada Y expediente recuperable
  const materias = (await db.query(`SELECT u.codigo, u.intentos, u.tarea_id, t.status, t.started_at, t.created_at AS t_creada
    FROM sol_unidades u LEFT JOIN tasks t ON t.id = u.tarea_id WHERE u.tipo = 'materia' AND u.estado = 'en_curso'`)).rows;
  for (const a of materias) {
    if (a.status !== 'completada' && a.status && !FALLO_TAREA.includes(a.status)) continue;   // sigue en marcha
    const p = a.status === 'completada' ? await expediente(db, a) : null;
    if (p) {
      await withTx(db, async (tx) => {
        await tx.query(`UPDATE sol_unidades SET estado = 'estudiada', proyecto_id = $2, completado_en = now() WHERE codigo = $1`, [a.codigo, p]);
        await tx.query(`UPDATE sol_proyectos SET requisito = $1 WHERE id = $2`, [a.codigo, p]);
        await audit(tx, actor, 'sol.materia_estudiada', { materia: a.codigo, proyecto: p, tarea: a.tarea_id, intento: a.intentos });
      });
      continue;
    }
    const fin = a.intentos >= MAX_INTENTOS;
    await db.query(`UPDATE sol_unidades SET estado = $2, tarea_id = NULL WHERE codigo = $1`, [a.codigo, fin ? 'fallida' : 'pendiente']);
    await audit(db, actor, fin ? 'sol.materia_fallida' : 'sol.materia_reintento', { materia: a.codigo, estado_tarea: a.status ?? 'sin tarea', intento: a.intentos,
      ...(a.status === 'completada' ? { motivo: 'la tarea terminó sin un expediente de materia completo: no cuenta como estudiada' } : {}) });
  }
  // 2) Lanzar el siguiente, si no hay otro estudio en curso y queda cupo de hoy (cupo compartido por módulos y materias)
  if ((await isHalted(db)).halted) return { lanzado: null, motivo: 'KRATOS detenido' };
  const st = await getState(db);
  const cupo = Number(st.omega_modulos_dia ?? 4);
  if (!(cupo > 0)) return { lanzado: null, motivo: 'currículo en pausa (omega_modulos_dia = 0)' };
  const c = (await db.query(`SELECT (SELECT string_agg('módulo ' || n, ', ') FROM sol_modulos WHERE estado = 'en_curso') AS modulos,
      (SELECT string_agg(codigo, ', ') FROM sol_unidades WHERE tipo = 'materia' AND estado = 'en_curso') AS materias,
      (SELECT count(*)::int FROM sol_modulos WHERE lanzado_en > now() - interval '24 hours') + (SELECT count(*)::int FROM sol_unidades WHERE tipo = 'materia' AND lanzado_en > now() - interval '24 hours') AS hoy`)).rows[0];
  if (c.modulos || c.materias) return { lanzado: null, motivo: `ya hay un estudio en curso (${[c.modulos, c.materias].filter(Boolean).join(', ')})` };
  if (c.hoy >= cupo) return { lanzado: null, motivo: `cupo diario alcanzado (${c.hoy}/${cupo})` };
  const e = await siguienteEstudio(db, Number(st.sol_estudio_lanzamientos ?? 0) || 0);
  if (!e) {
    const t = Math.max(espera.modulo ?? 0, espera.materia ?? 0);
    return { lanzado: null, motivo: t > Date.now() ? `en espera tras un error de lanzamiento (hasta ${new Date(t).toISOString()})` : 'currículo terminado' };
  }
  try {
    const r = await launch(db, e);
    if (e.tipo === 'modulo') {
      await db.query(`UPDATE sol_modulos SET estado = 'en_curso', tarea_id = $2, intentos = intentos + 1, lanzado_en = now() WHERE n = $1`, [e.n, r.tarea ?? null]);
      await audit(db, actor, 'omega.modulo_lanzado', { modulo: e.n, titulo: e.titulo, tarea: r.tarea ?? null });
    } else {
      await db.query(`UPDATE sol_unidades SET estado = 'en_curso', tarea_id = $2, intentos = intentos + 1, lanzado_en = now() WHERE codigo = $1`, [e.codigo, r.tarea ?? null]);
      await audit(db, actor, 'sol.materia_lanzada', { materia: e.codigo, titulo: e.titulo, tarea: r.tarea ?? null, intento: e.intento, con_correcciones: !!e.correcciones });
    }
    await db.query(`INSERT INTO system_state (key, value, updated_by) VALUES ('sol_estudio_lanzamientos', '1', $1)
      ON CONFLICT (key) DO UPDATE SET value = to_jsonb(coalesce((system_state.value #>> '{}')::int, 0) + 1), updated_at = now(), updated_by = $1`, [actor]);
    return { lanzado: e.tipo === 'modulo' ? e.n : e.codigo, tipo: e.tipo, tarea: r.tarea ?? null };
  } catch (err: any) {
    espera[e.tipo] = Date.now() + ESPERA_ERROR_MS;
    const motivo = String(err?.message ?? err).slice(0, 200);
    await audit(db, actor, e.tipo === 'modulo' ? 'omega.modulo_error' : 'sol.materia_error', { [e.tipo]: e.tipo === 'modulo' ? e.n : e.codigo, error: motivo });
    return { lanzado: null, motivo };
  }
}

// ---------- Exámenes de dominio ----------
export type TareaExamen = { fase: 'crear' | 'responder' | 'calificar'; unidad: string; titulo: string; alcance: string; examen_id: number | null; expediente: string };
type LaunchExam = (db: Db, t: TareaExamen) => Promise<{ tarea?: number }>;
export const PLAYBOOK_EXAMEN = { crear: 'sol-examen-crear', responder: 'sol-examen-responder', calificar: 'sol-examen-calificar' } as const;
const BLOQUEO_FALLOS = 3;   // 3 tareas de examen fallidas en 72 h (del estudio vigente) apartan la materia de la cola durante ese tiempo

const launchExamTask: LaunchExam = (db, t) => lanzarPlaybook(db, PLAYBOOK_EXAMEN[t.fase],
  t.fase === 'crear' ? { unidad: t.unidad, titulo: t.titulo, alcance: t.alcance, expediente: t.expediente } : { unidad: t.unidad, titulo: t.titulo, examen: t.examen_id },
  'examen (planificador)');

// Qué examen dejó la fase al terminar su tarea (el estado real del examen manda, no lo que diga el informe)
async function examenTrasFase(db: Db, x: any): Promise<number | null> {
  const q = x.fase === 'crear'
    ? db.query(`SELECT id FROM sol_examenes WHERE unidad = $1 AND created_at >= $2 AND estado <> 'anulado' ORDER BY id DESC LIMIT 1`, [x.unidad, x.lanzado_en])
    : db.query(`SELECT id FROM sol_examenes WHERE id = $1 AND estado = ANY($2)`, [x.examen_id, x.fase === 'responder' ? ['respondido', 'calificado'] : ['calificado']]);
  return (await q).rows[0]?.id ?? null;
}

async function expedienteTexto(db: Db, codigo: string, proyecto: number | null) {
  if (proyecto) return `proyecto P${proyecto} (consulta solo su temario y objetivos para calibrar el alcance)`;
  const m = (await db.query(`SELECT string_agg(m.n || '. ' || m.titulo || coalesce(' (P' || m.proyecto_id || ')', ''), '; ' ORDER BY m.n) AS s
    FROM sol_modulos m JOIN sol_unidades u ON m.n = ANY(u.modulos_previos) WHERE u.codigo = $1 AND m.estado = 'completado'`, [codigo])).rows[0]?.s;
  return m ? `módulos anteriores completados que esta materia reutiliza: ${m}`.slice(0, 190) : 'sin expediente registrado';   // entrada de 200 como mucho
}

export async function advanceExams(db: Db, actor = 'examen (planificador)', launch: LaunchExam = launchExamTask) {
  await siembraSinParar(db);
  return enExclusiva(db, CERROJO_EXAMEN, () => avanzarExamenes(db, actor, launch), { lanzado: null, motivo: 'otro proceso está planificando los exámenes ahora mismo' });
}
async function avanzarExamenes(db: Db, actor: string, launch: LaunchExam): Promise<{ lanzado: TareaExamen['fase'] | null; unidad?: string; examen_id?: number | null; tarea?: number | null; motivo?: string }> {
  // 1) Cerrar las tareas de examen que terminaron
  const abiertas = (await db.query(`SELECT x.*, t.status FROM sol_examen_tareas x LEFT JOIN tasks t ON t.id = x.tarea_id WHERE x.estado = 'en_curso' ORDER BY x.id`)).rows;
  for (const x of abiertas) {
    if (x.status !== 'completada' && x.status && !FALLO_TAREA.includes(x.status)) continue;
    const ex = x.status === 'completada' ? await examenTrasFase(db, x) : null;
    const detalle = ex ? null : x.status === 'completada' ? 'la tarea terminó pero el examen no avanzó' : `tarea ${x.status ?? 'inexistente'}`;
    await db.query(`UPDATE sol_examen_tareas SET estado = $2, examen_id = coalesce(examen_id, $3), detalle = $4, cerrado_en = now() WHERE id = $1`, [x.id, ex ? 'hecha' : 'fallida', ex, detalle]);
    await audit(db, actor, ex ? 'sol.examen_fase_hecha' : 'sol.examen_fase_fallida', { materia: x.unidad, fase: x.fase, examen: ex ?? x.examen_id, tarea: x.tarea_id, ...(detalle ? { detalle } : {}) });
    if (!ex) {
      const n = (await db.query(`SELECT count(*)::int AS n FROM sol_examen_tareas x JOIN sol_unidades u ON u.codigo = x.unidad WHERE x.unidad = $1 AND x.estado = 'fallida'
        AND x.lanzado_en > now() - interval '72 hours' AND x.lanzado_en >= coalesce(u.completado_en, '-infinity')`, [x.unidad])).rows[0].n;
      if (n === BLOQUEO_FALLOS) await audit(db, actor, 'sol.examen_bloqueado', { materia: x.unidad, fallos: n, nota: 'se aparta de la cola de exámenes durante 72 h; revisa las tareas fallidas' });
    }
  }
  // 2) Aplicar los exámenes ya calificados (también si se calificaron fuera de una tarea planificada)
  const calificados = (await db.query(`SELECT e.id FROM sol_unidades u JOIN LATERAL (SELECT id FROM sol_examenes e WHERE e.unidad = u.codigo AND e.estado = 'calificado'
      AND e.calificado_en >= coalesce(u.completado_en, '-infinity') ORDER BY e.id DESC LIMIT 1) e ON true WHERE u.tipo = 'materia' AND u.estado = 'estudiada'`)).rows;
  for (const r of calificados) await aplicarResultado(db, r.id, actor);
  // 3) Lanzar la siguiente fase (una tarea de examen cada vez; el tope diario cuenta exámenes empezados)
  if ((await isHalted(db)).halted) return { lanzado: null, motivo: 'KRATOS detenido' };
  const cupo = Number((await getState(db)).sol_examenes_dia ?? 4);
  if (!(cupo > 0)) return { lanzado: null, motivo: 'exámenes en pausa (sol_examenes_dia = 0)' };
  const curso = (await db.query(`SELECT unidad, fase, tarea_id FROM sol_examen_tareas WHERE estado = 'en_curso' LIMIT 1`)).rows[0];
  if (curso) return { lanzado: null, motivo: `ya hay una tarea de examen en curso (${curso.fase} ${curso.unidad}, tarea #${curso.tarea_id})` };
  if (!libre('examen')) return { lanzado: null, motivo: `en espera tras un error de lanzamiento (hasta ${new Date(espera.examen).toISOString()})` };
  // Primero los exámenes abiertos; después la materia estudiada más antigua (las que reutilizan módulos completados, S12/S13, van primero)
  const u = (await db.query(`SELECT u.codigo, u.titulo, u.alcance, u.proyecto_id, e.id AS examen_id, e.estado AS examen_estado FROM sol_unidades u
      LEFT JOIN LATERAL (SELECT id, estado FROM sol_examenes x WHERE x.unidad = u.codigo AND x.estado IN ('creado','respondido') ORDER BY x.id DESC LIMIT 1) e ON true
    WHERE u.tipo = 'materia' AND u.estado = 'estudiada'
      AND NOT EXISTS (SELECT 1 FROM sol_examenes c WHERE c.unidad = u.codigo AND c.estado = 'calificado' AND c.calificado_en >= coalesce(u.completado_en, '-infinity'))
      AND (SELECT count(*) FROM sol_examen_tareas f WHERE f.unidad = u.codigo AND f.estado = 'fallida' AND f.lanzado_en > now() - interval '72 hours'
        AND f.lanzado_en >= coalesce(u.completado_en, '-infinity')) < $1
    ORDER BY (e.id IS NULL), e.id, u.completado_en NULLS FIRST, u.orden LIMIT 1`, [BLOQUEO_FALLOS])).rows[0];
  if (!u) return { lanzado: null, motivo: 'ninguna materia estudiada espera examen' };
  const fase: TareaExamen['fase'] = !u.examen_id ? 'crear' : u.examen_estado === 'creado' ? 'responder' : 'calificar';
  if (fase === 'crear') {
    const hoy = (await db.query(`SELECT count(*)::int AS n FROM sol_examen_tareas WHERE fase = 'crear' AND lanzado_en > now() - interval '24 hours'`)).rows[0].n;
    if (hoy >= cupo) return { lanzado: null, motivo: `cupo diario de exámenes alcanzado (${hoy}/${cupo})` };
  }
  const t: TareaExamen = { fase, unidad: u.codigo, titulo: u.titulo, alcance: u.alcance, examen_id: u.examen_id ?? null, expediente: fase === 'crear' ? await expedienteTexto(db, u.codigo, u.proyecto_id) : '' };
  try {
    const r = await launch(db, t);
    await db.query(`INSERT INTO sol_examen_tareas (unidad, fase, examen_id, tarea_id) VALUES ($1, $2, $3, $4)`, [t.unidad, fase, t.examen_id, r.tarea ?? null]);
    await audit(db, actor, 'sol.examen_fase_lanzada', { materia: t.unidad, fase, examen: t.examen_id, tarea: r.tarea ?? null });
    return { lanzado: fase, unidad: t.unidad, examen_id: t.examen_id, tarea: r.tarea ?? null };
  } catch (err: any) {
    espera.examen = Date.now() + ESPERA_ERROR_MS;
    const motivo = String(err?.message ?? err).slice(0, 200);
    await audit(db, actor, 'sol.examen_error', { materia: t.unidad, fase, error: motivo });
    return { lanzado: null, motivo };
  }
}

// Foto del currículo para KRATOS (D09): qué hay en curso, qué está estudiado, qué está demostrado y cuánto cupo queda hoy
export async function estadoCurriculo(db: Db) {
  const st = await getState(db);
  const materias = (await db.query(`SELECT estado, count(*)::int AS n FROM sol_unidades WHERE tipo = 'materia' GROUP BY estado ORDER BY estado`)).rows;
  const modulos = (await db.query(`SELECT estado, count(*)::int AS n FROM sol_modulos GROUP BY estado ORDER BY estado`)).rows;
  const c = (await db.query(`SELECT (SELECT string_agg('módulo ' || n, ', ') FROM sol_modulos WHERE estado = 'en_curso') AS modulos,
      (SELECT string_agg(codigo || ' (tarea #' || coalesce(tarea_id::text, '?') || ')', ', ') FROM sol_unidades WHERE tipo = 'materia' AND estado = 'en_curso') AS materias,
      (SELECT count(*)::int FROM sol_modulos WHERE lanzado_en > now() - interval '24 hours') + (SELECT count(*)::int FROM sol_unidades WHERE tipo = 'materia' AND lanzado_en > now() - interval '24 hours') AS estudios_hoy,
      (SELECT count(*)::int FROM sol_examen_tareas WHERE fase = 'crear' AND lanzado_en > now() - interval '24 hours') AS examenes_hoy,
      (SELECT fase || ' ' || unidad || ' (tarea #' || coalesce(tarea_id::text, '?') || ')' FROM sol_examen_tareas WHERE estado = 'en_curso' LIMIT 1) AS examen_en_curso,
      (SELECT string_agg(codigo, ', ' ORDER BY orden) FROM sol_unidades WHERE tipo = 'materia' AND estado = 'evaluada') AS evaluadas`)).rows[0];
  return { materias_por_estado: materias, modulos_por_estado: modulos, en_curso: [c.modulos, c.materias].filter(Boolean).join(', ') || null,
    cupo_estudio: { hoy: c.estudios_hoy, tope: Number(st.omega_modulos_dia ?? 4) }, cupo_examenes: { hoy: c.examenes_hoy, tope: Number(st.sol_examenes_dia ?? 4) },
    examen_en_curso: c.examen_en_curso, evaluadas: c.evaluadas ?? '',
    aviso: '«estudiada» = expediente verificado; «evaluada» = dominio demostrado por un examen aprobado por el examinador independiente. Nada más cuenta como dominio.' };
}
