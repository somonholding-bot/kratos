import type { Db } from '../db.ts';
import { audit } from './state.ts';
import { buscarMemoria } from './autobiografia.ts';

// Expansión cognitiva C02 — monitorización metacognitiva (Nelson & Narens 1990: monitorización y control; Fleming & Lau 2014:
// la confianza útil es la que discrimina aciertos de errores). Distingue «he producido una respuesta» de «tengo evidencia fiable
// de que es correcta»: la confianza declarada se sustituye por la calibrada con el historial medido de la misma categoría.

export const UMBRAL_ESCALADO = 0.5;      // por debajo de esta confianza calibrada, la decisión se escala
export const UMBRAL_INCERTIDUMBRE = 0.7;
const MIN_HISTORIAL = 3;                 // con menos casos resueltos no hay calibración: se dice que no se sabe

const norm = (s: string) => String(s ?? '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();

// Calibración de la categoría: tasa de éxito real (Laplace) de las decisiones resueltas, por tramo de confianza declarada
export async function calibracion(db: Db, categoria?: string) {
  const rows = (await db.query(`SELECT confianza_declarada::float AS c, exito FROM cog_decisiones WHERE estado = 'resuelta' AND exito IS NOT NULL ${categoria ? 'AND categoria = $1' : ''}`, categoria ? [categoria] : [])).rows;
  const tramos = [[0, 0.5], [0.5, 0.7], [0.7, 0.9], [0.9, 1.01]].map(([a, b]) => {
    const r = rows.filter((x) => x.c >= a && x.c < b), ok = r.filter((x) => x.exito).length;
    return { tramo: `${a}–${Math.min(b, 1)}`, casos: r.length, confianza_media: r.length ? Math.round((r.reduce((s, x) => s + x.c, 0) / r.length) * 100) / 100 : null, acierto_real: r.length ? Math.round((ok / r.length) * 100) / 100 : null };
  });
  const n = rows.length, brier = n ? rows.reduce((s, x) => s + (x.c - (x.exito ? 1 : 0)) ** 2, 0) / n : null;
  const ece = n ? tramos.reduce((s, t) => s + (t.casos && t.confianza_media != null && t.acierto_real != null ? (t.casos / n) * Math.abs(t.confianza_media - t.acierto_real) : 0), 0) : null;
  const ok = rows.filter((x) => x.exito).length;
  return { categoria: categoria ?? 'todas', casos: n, acierto_real: n ? Math.round((ok / n) * 100) / 100 : null, tasa_laplace: Math.round(((ok + 1) / (n + 2)) * 100) / 100,
    brier: brier == null ? null : Math.round(brier * 1000) / 1000, error_calibracion: ece == null ? null : Math.round(ece * 1000) / 1000, tramos,
    lectura: n < MIN_HISTORIAL ? `Solo ${n} decisiones resueltas: no hay historial suficiente para calibrar` : (ece ?? 0) > 0.2 ? 'Mal calibrada: la confianza declarada no coincide con los aciertos medidos' : 'Calibración aceptable' };
}

// Confianza calibrada para una nueva decisión: acierto real de las resueltas de la categoría en el mismo tramo de confianza (o de toda la categoría)
async function confianzaCalibrada(db: Db, categoria: string, declarada: number) {
  const cal = await calibracion(db, categoria);
  if (cal.casos < MIN_HISTORIAL) return { valor: null as number | null, base: cal.casos, cal };
  const t = cal.tramos.find((x) => { const [a, b] = x.tramo.split('–').map(Number); return declarada >= a && (declarada < b || b === 1); });
  const valor = t && t.casos >= MIN_HISTORIAL ? t.acierto_real! : cal.tasa_laplace;
  return { valor, base: t && t.casos >= MIN_HISTORIAL ? t.casos : cal.casos, cal };
}

// Estrategias que ya fallaron en la misma categoría (fallos repetidos)
export async function fallosPrevios(db: Db, categoria: string, estrategia: string) {
  const r = (await db.query(`SELECT id, elegida, errores, estrategia_revisada, resuelta_at FROM cog_decisiones WHERE categoria = $1 AND estado = 'resuelta' AND exito = false ORDER BY resuelta_at DESC LIMIT 50`, [categoria])).rows;
  const e = norm(estrategia);
  return r.filter((x) => norm(x.elegida) === e);
}

// Detección de contradicciones y errores en la propia decisión (antes de ejecutarla)
export function contradicciones(d: { estrategias: any[]; elegida: string; evidencia: any[]; supuestos: any[]; resultado_esperado: string; incertidumbre: number; confianza_declarada: number }) {
  const out: string[] = [];
  const nombres = (d.estrategias ?? []).map((e: any) => norm(e?.nombre ?? e));
  if (!nombres.includes(norm(d.elegida))) out.push('La estrategia elegida no está entre las candidatas evaluadas');
  const contra = (d.evidencia ?? []).filter((e: any) => e?.apoya === false), pro = (d.evidencia ?? []).filter((e: any) => e?.apoya !== false);
  if (contra.length && contra.length >= pro.length) out.push(`La evidencia en contra (${contra.length}) iguala o supera a la evidencia a favor (${pro.length})`);
  if (!pro.length) out.push('No hay evidencia a favor: es una respuesta producida, no una conclusión respaldada');
  if (d.confianza_declarada >= 0.8 && d.incertidumbre >= 0.5) out.push(`Confianza ${d.confianza_declarada} incompatible con incertidumbre ${d.incertidumbre}`);
  const sup = (d.supuestos ?? []).map((s: any) => norm(s?.texto ?? s));
  for (const e of contra) { const t = norm(e?.texto ?? e); if (sup.some((s) => s && t && (t.includes(s) || s.includes(t)))) out.push(`Un supuesto contradice la evidencia: «${String(e?.texto ?? e).slice(0, 80)}»`); }
  if (nombres.length < 2) out.push('Solo se consideró una estrategia: no hubo alternativas');
  return out;
}

export async function registrarDecision(db: Db, i: any, actor: string) {
  for (const k of ['categoria', 'objetivo', 'elegida', 'resultado_esperado']) if (!String(i?.[k] ?? '').trim()) throw new Error(`Falta ${k}`);
  if (!Array.isArray(i.estrategias) || !i.estrategias.length) throw new Error('Faltan las estrategias candidatas');
  const incert = Number(i.incertidumbre), decl = Number(i.confianza_declarada ?? i.confianza);
  if (!(incert >= 0 && incert <= 1) || !(decl >= 0 && decl <= 1)) throw new Error('incertidumbre y confianza_declarada van de 0 a 1');
  const d = { estrategias: i.estrategias.map((e: any) => (typeof e === 'string' ? { nombre: e } : e)), elegida: String(i.elegida), evidencia: (i.evidencia ?? []).map((e: any) => (typeof e === 'string' ? { texto: e, apoya: true } : e)),
    supuestos: i.supuestos ?? [], resultado_esperado: String(i.resultado_esperado), incertidumbre: incert, confianza_declarada: decl };
  const alertas = contradicciones(d).map((t) => ({ tipo: 'contradiccion', texto: t }));
  const cc = await confianzaCalibrada(db, String(i.categoria), decl);
  if (cc.valor == null) alertas.push({ tipo: 'sin_calibracion', texto: `Sin historial suficiente en «${i.categoria}» (${cc.base} resueltas): la confianza ${decl} no está respaldada por resultados` });
  else if (decl - cc.valor > 0.2) alertas.push({ tipo: 'sobreconfianza', texto: `Declara ${decl} pero en «${i.categoria}» el acierto medido es ${cc.valor} (${cc.base} casos)` });
  const previos = await fallosPrevios(db, String(i.categoria), d.elegida);
  if (previos.length) alertas.push({ tipo: 'estrategia_ya_fallida', texto: `La estrategia «${d.elegida}» ya falló ${previos.length} vez/veces en esta categoría (decisión ${previos.map((p) => p.id).join(', ')}): ${previos[0].errores ?? ''}${previos[0].estrategia_revisada ? ` — se propuso: ${previos[0].estrategia_revisada}` : ''}` });
  // Memoria autobiográfica (C03): errores documentados de esta estrategia para este objetivo
  const mem = (await buscarMemoria(db, { texto: `${i.objetivo} ${d.elegida}`, resultado: 'fallo', limite: 10 }).catch(() => [] as any[]))
    .filter((x: any) => norm(`${x.objetivo} ${x.detalle ?? ''} ${x.leccion ?? ''}`).includes(norm(d.elegida)));
  if (mem.length) alertas.push({ tipo: 'error_documentado', texto: `La memoria tiene ${mem.length} error(es) documentado(s) con «${d.elegida}»: ${mem.slice(0, 2).map((x: any) => `${x.id} (${x.certeza}) ${String(x.leccion ?? x.detalle ?? '').slice(0, 140)}`).join(' | ')}` });
  const efectiva = cc.valor ?? Math.min(decl, 1 - incert);
  const motivos = [] as string[];
  if (efectiva < UMBRAL_ESCALADO) motivos.push(`confianza calibrada ${Math.round(efectiva * 100) / 100} < ${UMBRAL_ESCALADO}`);
  if (incert > UMBRAL_INCERTIDUMBRE) motivos.push(`incertidumbre ${incert} > ${UMBRAL_INCERTIDUMBRE}`);
  if (alertas.some((a) => a.tipo === 'contradiccion')) motivos.push('contradicciones en la decisión');
  if (previos.length >= 2) motivos.push('estrategia fallida repetida');
  if (mem.some((x: any) => x.certeza === 'verificado')) motivos.push('error verificado en la memoria autobiográfica');
  const estado = motivos.length ? 'escalada' : 'abierta';
  const r = (await db.query(`INSERT INTO cog_decisiones (actor, tarea_id, categoria, objetivo, estrategias, elegida, evidencia, supuestos, incertidumbre, confianza_declarada, confianza_calibrada, calibracion, resultado_esperado, critica, alertas, estado, escalado_motivo)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17) RETURNING id`,
    [actor, i.tarea_id ?? null, i.categoria, i.objetivo, JSON.stringify(d.estrategias), d.elegida, JSON.stringify(d.evidencia), JSON.stringify(d.supuestos), incert, decl, cc.valor, JSON.stringify({ base: cc.base, brier: cc.cal.brier, error: cc.cal.error_calibracion }),
      d.resultado_esperado, !!i.critica, JSON.stringify(alertas), estado, motivos.join('; ') || null])).rows[0];
  await audit(db, actor, 'cog.decision', { id: r.id, categoria: i.categoria, estado, alertas: alertas.length });
  return { id: r.id, estado, confianza_declarada: decl, confianza_calibrada: cc.valor, alertas, escalado: estado === 'escalada' ? { motivo: motivos.join('; '), accion: 'No ejecutar sin revisión independiente o del propietario' } : null,
    requiere_revision_independiente: !!i.critica };
}

// Revisión independiente: el revisor no puede ser quien decidió
export async function revisarDecision(db: Db, id: number, revisor: string, veredicto: 'aprobada' | 'rechazada', notas: string) {
  const d = (await db.query(`SELECT * FROM cog_decisiones WHERE id = $1`, [id])).rows[0];
  if (!d) throw new Error(`No existe la decisión ${id}`);
  if (revisor === d.actor) throw new Error('Revisión no independiente: el revisor es quien tomó la decisión');
  if (!['aprobada', 'rechazada'].includes(veredicto)) throw new Error('veredicto: aprobada o rechazada');
  if (!String(notas ?? '').trim()) throw new Error('La revisión necesita notas con lo comprobado');
  await db.query(`UPDATE cog_decisiones SET revisor = $2, revision = $3, revisada_at = now(), estado = CASE WHEN estado = 'escalada' AND $4 THEN 'abierta' ELSE estado END WHERE id = $1`,
    [id, revisor, JSON.stringify({ veredicto, notas: String(notas).slice(0, 1000) }), veredicto === 'aprobada']);
  await audit(db, revisor, 'cog.revision', { id, veredicto });
  return { id, revisor, veredicto };
}

// Cierre con el resultado real: un éxito en una decisión crítica exige revisión independiente aprobada
export async function resolverDecision(db: Db, id: number, i: { exito: boolean; resultado_real: string; errores?: string; estrategia_revisada?: string }, actor: string) {
  const d = (await db.query(`SELECT * FROM cog_decisiones WHERE id = $1`, [id])).rows[0];
  if (!d) throw new Error(`No existe la decisión ${id}`);
  if (d.estado === 'resuelta') throw new Error('Ya está resuelta');
  if (!String(i.resultado_real ?? '').trim()) throw new Error('Falta el resultado real observado');
  if (i.exito && d.critica && d.revision?.veredicto !== 'aprobada') throw new Error('Decisión crítica: no se da por buena sin una revisión independiente aprobada');
  if (!i.exito && !String(i.estrategia_revisada ?? '').trim()) throw new Error('Un fallo necesita la estrategia revisada (qué se hará distinto)');
  await db.query(`UPDATE cog_decisiones SET exito = $2, resultado_real = $3, errores = $4, estrategia_revisada = $5, estado = 'resuelta', resuelta_at = now() WHERE id = $1`,
    [id, !!i.exito, i.resultado_real, i.errores ?? null, i.estrategia_revisada ?? null]);
  await audit(db, actor, 'cog.decision_resuelta', { id, exito: !!i.exito });
  return { id, exito: !!i.exito, calibracion: await calibracion(db, d.categoria) };
}

// Historial medido de tareas por agente (prior de calibración para decisiones de asignación)
export async function historialTareas(db: Db) {
  return (await db.query(`SELECT owner_function AS agente, count(*) FILTER (WHERE status = 'completada' AND verified_at IS NOT NULL)::int AS verificadas,
      count(*) FILTER (WHERE status = 'fallida')::int AS fallidas, count(*) FILTER (WHERE status = 'completada' AND verified_at IS NULL)::int AS completadas_sin_verificar
    FROM tasks WHERE NOT is_demo GROUP BY 1 ORDER BY 1`)).rows.map((r) => ({ ...r, fiabilidad: Math.round(((r.verificadas + 1) / (r.verificadas + r.fallidas + r.completadas_sin_verificar + 2)) * 100) / 100 }));
}

export const METACOGNICION_TOOL = {
  description: 'Monitorización metacognitiva (C02). registrar: antes de una decisión relevante (categoria, objetivo, estrategias [{nombre, motivo}], elegida, evidencia [{texto, fuente, apoya}], supuestos, incertidumbre 0–1, confianza_declarada 0–1, resultado_esperado, critica). '
    + 'Devuelve la confianza CALIBRADA con los resultados reales de la categoría, contradicciones, estrategias que ya fallaron y si se escala. resolver (id, exito, resultado_real, errores, estrategia_revisada). revisar (id, veredicto aprobada|rechazada, notas): solo otro actor. calibracion (categoria). historial: fiabilidad medida por agente. abiertas: decisiones abiertas y escaladas.',
  input_schema: { type: 'object', properties: { accion: { type: 'string', enum: ['registrar', 'resolver', 'revisar', 'calibracion', 'historial', 'abiertas'] }, id: { type: 'number' }, categoria: { type: 'string' }, objetivo: { type: 'string' },
    estrategias: { type: 'array', items: { type: 'object' } }, elegida: { type: 'string' }, evidencia: { type: 'array', items: { type: 'object' } }, supuestos: { type: 'array', items: { type: 'string' } },
    incertidumbre: { type: 'number' }, confianza_declarada: { type: 'number' }, resultado_esperado: { type: 'string' }, critica: { type: 'boolean' }, tarea_id: { type: 'number' },
    exito: { type: 'boolean' }, resultado_real: { type: 'string' }, errores: { type: 'string' }, estrategia_revisada: { type: 'string' }, veredicto: { type: 'string', enum: ['aprobada', 'rechazada'] }, notas: { type: 'string' } }, required: ['accion'] },
};
export async function herramientaMetacognicion(db: Db, i: any, actor: string) {
  if (i.accion === 'registrar') return await registrarDecision(db, i, actor);
  if (i.accion === 'resolver') return await resolverDecision(db, Number(i.id), i, actor);
  if (i.accion === 'revisar') return await revisarDecision(db, Number(i.id), actor, i.veredicto, i.notas);
  if (i.accion === 'calibracion') return await calibracion(db, i.categoria);
  if (i.accion === 'historial') return await historialTareas(db);
  if (i.accion === 'abiertas') return (await db.query(`SELECT id, actor, categoria, left(objetivo, 120) AS objetivo, elegida, estado, escalado_motivo, confianza_calibrada, created_at FROM cog_decisiones WHERE estado <> 'resuelta' ORDER BY id DESC LIMIT 30`)).rows;
  return { error: 'Acción no válida' };
}
