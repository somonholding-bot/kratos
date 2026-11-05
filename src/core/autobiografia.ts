import crypto from 'node:crypto';
import type { Db } from '../db.ts';
import { audit } from './state.ts';

// Expansión cognitiva C03 — memoria autobiográfica de KRATOS: qué hizo cada agente, con qué herramientas, qué salió y qué aprendió.
// Persistente en PostgreSQL (sobrevive a reinicios), sin duplicados (huella), con procedencia y certeza (verificado / inferido),
// corregible sin borrar (el original queda «corregido» y enlazado) y sin secretos (se redactan antes de guardar).

const SECRETOS: [RegExp, string][] = [
  [/\b(sk|pk|rk)-[A-Za-z0-9_-]{16,}\b/g, '[CLAVE]'], [/\bgh[pousr]_[A-Za-z0-9]{20,}\b/g, '[TOKEN]'], [/\bAKIA[0-9A-Z]{16}\b/g, '[CLAVE_AWS]'],
  [/\bxox[abprs]-[A-Za-z0-9-]{10,}\b/g, '[TOKEN]'], [/\bya29\.[A-Za-z0-9_-]{20,}\b/g, '[TOKEN]'], [/\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{5,}\b/g, '[JWT]'],
  [/\b(bearer|token|password|contraseña|clave|secret|api[_-]?key)\s*[:=]\s*\S+/gi, '$1: [REDACTADO]'],
  [/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, '[CORREO]'], [/\b[A-Fa-f0-9]{40,}\b/g, '[HEX]'],
];
export function limpiarSecretos(t: any): any {
  if (t == null || t instanceof Date || typeof t === 'number' || typeof t === 'boolean') return t;
  if (Array.isArray(t)) return t.map(limpiarSecretos);
  if (typeof t === 'object') return Object.fromEntries(Object.entries(t).map(([k, v]) => [k, limpiarSecretos(v)]));
  let s = String(t); for (const [re, rep] of SECRETOS) s = s.replace(re, rep); return s;
}
const norm = (s: any) => String(s ?? '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();
const huella = (e: any) => crypto.createHash('sha256').update([e.agente, e.tarea_id ?? '', norm(e.objetivo), e.resultado, norm(e.detalle_resultado), norm(e.leccion)].join('|')).digest('hex');

// La certeza «verificado» solo se concede con respaldo comprobable por código: tarea verificada, decisión resuelta con revisión o el propietario
async function certezaReal(db: Db, e: any): Promise<'verificado' | 'inferido'> {
  if (e.procedencia === 'propietario') return 'verificado';
  if (e.tarea_id) { const t = (await db.query(`SELECT status, verified_at FROM tasks WHERE id = $1`, [e.tarea_id])).rows[0]; if (t && (t.verified_at || t.status === 'fallida')) return 'verificado'; }
  const dec = (e.enlaces ?? []).find((x: any) => x?.tipo === 'decision');
  if (dec) { const d = (await db.query(`SELECT estado, revision FROM cog_decisiones WHERE id = $1`, [Number(dec.ref)])).rows[0]; if (d?.estado === 'resuelta' && d.revision) return 'verificado'; }
  return 'inferido';
}

export async function recordar(db: Db, entrada: any, actor: string) {
  const e = limpiarSecretos(entrada);
  for (const k of ['agente', 'objetivo', 'resultado']) if (!String(e?.[k] ?? '').trim()) throw new Error(`Falta ${k}`);
  if (!['exito', 'fallo', 'parcial', 'desconocido'].includes(e.resultado)) throw new Error('resultado: exito | fallo | parcial | desconocido');
  if (e.resultado === 'fallo' && !e.clasificacion_error) e.clasificacion_error = clasificarError(e.detalle_resultado ?? e.evidencia ?? '');
  e.procedencia = e.procedencia ?? actor;
  const h = huella(e);
  // Duplicado: no se crea otro registro; se cuenta la repetición y se añaden los enlaces nuevos (p. ej. el ciclo que lo repitió)
  const ya = (await db.query(`UPDATE cog_experiencias SET repeticiones = repeticiones + 1,
      enlaces = (SELECT coalesce(jsonb_agg(DISTINCT x), '[]'::jsonb) FROM jsonb_array_elements(enlaces || $2::jsonb) x) WHERE huella = $1 RETURNING id`, [h, JSON.stringify(e.enlaces ?? [])])).rows[0];
  if (ya) return { id: ya.id, duplicado: true };
  // Una afirmación de «verificado» que no se puede comprobar se guarda como inferida (no se fía de quien la escribe)
  const certeza = await certezaReal(db, e);
  const id = `EXP-${new Date().toISOString().slice(0, 10).replace(/-/g, '')}-${h.slice(0, 10)}`;
  await db.query(`INSERT INTO cog_experiencias (id, huella, fecha, agente, tarea_id, objetivo, acciones, herramientas, evidencia, resultado, detalle_resultado, clasificacion_error, correccion, leccion, enlaces, certeza, procedencia)
     VALUES ($1,$2,coalesce($3::timestamptz, now()),$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)`,
    [id, h, e.fecha ?? null, e.agente, e.tarea_id ?? null, String(e.objetivo).slice(0, 1000), JSON.stringify(e.acciones ?? []), (e.herramientas ?? []).map(String), e.evidencia ? String(e.evidencia).slice(0, 2000) : null,
      e.resultado, e.detalle_resultado ? String(e.detalle_resultado).slice(0, 2000) : null, e.clasificacion_error ?? null, e.correccion ?? null, e.leccion ? String(e.leccion).slice(0, 1500) : null,
      JSON.stringify(e.enlaces ?? []), certeza, e.procedencia]);
  return { id, duplicado: false, certeza, pidio_verificado: entrada?.certeza === 'verificado' && certeza !== 'verificado' ? 'Se pidió «verificado» pero no hay respaldo comprobable: queda como inferido' : undefined };
}

export function clasificarError(t: string) {
  const s = norm(t);
  if (/verificacion|verificar|no verific/.test(s)) return 'verificacion';
  if (/permiso|aprobacion|autoriz|401|403/.test(s)) return 'permisos';
  if (/timeout|tiempo|429|500|503|red|conexion|no respond/.test(s)) return 'entorno';
  if (/herramienta|tool|comando|script/.test(s)) return 'herramienta';
  if (/dato|fuente|invent|sin evidencia/.test(s)) return 'datos';
  if (/estrategia|cac|margen|demanda|ventas/.test(s)) return 'estrategia';
  return 'otro';
}

// Corrige un registro falso o incompleto: el original no se borra, queda «corregido» y apunta al nuevo
export async function corregir(db: Db, id: string, cambios: any, motivo: string, actor: string) {
  if (!String(motivo ?? '').trim()) throw new Error('Una corrección necesita el motivo');
  const o = (await db.query(`SELECT * FROM cog_experiencias WHERE id = $1`, [id])).rows[0];
  if (!o) throw new Error(`No existe ${id}`);
  if (o.estado !== 'vigente') throw new Error(`${id} ya fue ${o.estado}; corrige el registro vigente (${o.corregido_por ?? 'ninguno'})`);
  if (cambios?.retractar) {
    await db.query(`UPDATE cog_experiencias SET estado = 'retractado', motivo_correccion = $2 WHERE id = $1`, [id, limpiarSecretos(motivo)]);
    await audit(db, actor, 'cog.memoria_retractada', { id, motivo: String(motivo).slice(0, 200) });
    return { id, estado: 'retractado' };
  }
  const nuevo = { ...o, ...cambios, fecha: o.fecha, procedencia: actor, enlaces: [...(o.enlaces ?? []), { tipo: 'corrige', ref: id }] };
  delete nuevo.id; delete nuevo.huella; delete nuevo.certeza;
  const r = await recordar(db, nuevo, actor);
  if (r.duplicado) throw new Error('La corrección es idéntica a un registro existente');
  await db.query(`UPDATE cog_experiencias SET estado = 'corregido', corregido_por = $2, motivo_correccion = $3 WHERE id = $1`, [id, r.id, limpiarSecretos(motivo)]);
  await audit(db, actor, 'cog.memoria_corregida', { id, nuevo: r.id });
  return { id_original: id, id_nuevo: r.id, estado_original: 'corregido' };
}

// Recuperación por tarea, error, lección o texto libre. Por defecto solo registros vigentes; cada uno indica su certeza.
export async function buscarMemoria(db: Db, q: { texto?: string; tarea_id?: number; clasificacion_error?: string; agente?: string; resultado?: string; incluir_corregidos?: boolean; limite?: number }) {
  const w: string[] = [], p: any[] = [];
  if (!q.incluir_corregidos) w.push(`estado = 'vigente'`);
  if (q.tarea_id) { p.push(q.tarea_id); w.push(`tarea_id = $${p.length}`); }
  if (q.clasificacion_error) { p.push(q.clasificacion_error); w.push(`clasificacion_error = $${p.length}`); }
  if (q.agente) { p.push(q.agente); w.push(`agente = $${p.length}`); }
  if (q.resultado) { p.push(q.resultado); w.push(`resultado = $${p.length}`); }
  let orden = 'fecha DESC';
  if (q.texto?.trim()) {
    p.push(norm(q.texto).split(' ').filter((x) => x.length > 2).join(' | ') || norm(q.texto));
    const tv = `to_tsvector('spanish', objetivo || ' ' || coalesce(leccion, '') || ' ' || coalesce(detalle_resultado, '') || ' ' || coalesce(correccion, ''))`;
    w.push(`${tv} @@ to_tsquery('spanish', $${p.length})`); orden = `ts_rank(${tv}, to_tsquery('spanish', $${p.length})) DESC, fecha DESC`;
  }
  p.push(Math.min(Number(q.limite ?? 15), 50));
  return (await db.query(`SELECT id, fecha, agente, tarea_id, left(objetivo, 200) AS objetivo, herramientas, resultado, left(detalle_resultado, 300) AS detalle, clasificacion_error, correccion, leccion, certeza, procedencia, estado, corregido_por, repeticiones
     FROM cog_experiencias ${w.length ? 'WHERE ' + w.join(' AND ') : ''} ORDER BY ${orden} LIMIT $${p.length}`, p)).rows;
}

// Antes de actuar: ¿hay errores documentados para este objetivo o esta estrategia? Devuelve advertencias con la corrección que se aprendió.
export async function erroresDocumentados(db: Db, objetivo: string, estrategia?: string) {
  const r = await buscarMemoria(db, { texto: `${objetivo} ${estrategia ?? ''}`, resultado: 'fallo', limite: 10 });
  const e = norm(estrategia);
  return r.map((x) => ({ ...x, misma_estrategia: !!e && (norm(x.objetivo).includes(e) || norm(x.detalle).includes(e) || (x.acciones ?? []).some?.((a: any) => norm(a).includes(e))) }));
}

// Elegir entre estrategias usando la memoria: descarta las que tienen un error documentado sin corregir y explica por qué
export async function elegirConMemoria(db: Db, objetivo: string, candidatas: string[]) {
  const evaluadas = [] as any[];
  for (const c of candidatas) {
    const errs = (await buscarMemoria(db, { texto: `${objetivo} ${c}`, resultado: 'fallo', limite: 10 })).filter((x) => norm(`${x.objetivo} ${x.detalle} ${x.leccion}`).includes(norm(c)));
    evaluadas.push({ estrategia: c, errores_documentados: errs.map((x) => ({ id: x.id, detalle: x.detalle, leccion: x.leccion, certeza: x.certeza })) });
  }
  const limpias = evaluadas.filter((x) => !x.errores_documentados.length);
  const elegida = (limpias[0] ?? evaluadas.sort((a, b) => a.errores_documentados.length - b.errores_documentados.length)[0])?.estrategia ?? null;
  return { elegida, evaluadas, motivo: limpias.length < evaluadas.length ? `Se evita ${evaluadas.filter((x) => x.errores_documentados.length).map((x) => `«${x.estrategia}» (${x.errores_documentados.map((y: any) => y.id).join(', ')})`).join(', ')} por errores documentados` : 'Ninguna candidata tiene errores documentados' };
}

// Importa la historia real de KRATOS: tareas verificadas o fallidas, lecciones y decisiones resueltas (idempotente por huella)
export async function importarHistoria(db: Db, limite = 500) {
  let n = 0;
  const tareas = (await db.query(`SELECT t.id, t.owner_function, t.title, t.objective, t.status, t.verified_at, t.completed_at, t.updated_at, left(coalesce(t.last_error, ''), 600) AS error,
       left(coalesce(t.verification_result::text, ''), 600) AS verif, t.playbook_id
     FROM tasks t WHERE (t.status = 'fallida' OR (t.status = 'completada' AND t.verified_at IS NOT NULL)) AND NOT t.is_demo
       AND NOT EXISTS (SELECT 1 FROM cog_experiencias e WHERE e.tarea_id = t.id AND e.procedencia = 'tasks') ORDER BY t.id DESC LIMIT $1`, [limite])).rows;
  for (const t of tareas) {
    const fallo = t.status === 'fallida';
    const r = await recordar(db, { agente: t.owner_function, tarea_id: t.id, objetivo: `${t.title}: ${String(t.objective ?? '').slice(0, 300)}`, acciones: t.playbook_id ? [`playbook ${t.playbook_id}`] : [],
      resultado: fallo ? 'fallo' : 'exito', detalle_resultado: fallo ? t.error : `verificada ${new Date(t.verified_at).toISOString()}`, evidencia: t.verif || null, fecha: (t.verified_at ?? t.updated_at),
      enlaces: [{ tipo: 'tarea', ref: t.id }], procedencia: 'tasks' }, 'tasks');
    if (!r.duplicado) n++;
  }
  const lecciones = (await db.query(`SELECT l.id, l.at, l.agent, l.kind, l.content, l.evidence, l.task_id FROM lessons l
     WHERE NOT EXISTS (SELECT 1 FROM cog_experiencias e WHERE e.procedencia = 'lessons' AND e.enlaces @> jsonb_build_array(jsonb_build_object('tipo', 'leccion', 'ref', l.id))) ORDER BY l.id DESC LIMIT $1`, [limite])).rows;
  for (const l of lecciones) {
    const r = await recordar(db, { agente: l.agent ?? 'kratos', tarea_id: l.task_id ?? null, objetivo: String(l.content).slice(0, 300), resultado: l.kind === 'funciono' ? 'exito' : l.kind === 'no_funciono' ? 'fallo' : 'desconocido',
      detalle_resultado: l.kind === 'no_funciono' ? String(l.content).slice(0, 600) : null, leccion: String(l.content).slice(0, 1000), evidencia: l.evidence ?? null, fecha: l.at,
      enlaces: [{ tipo: 'leccion', ref: Number(l.id) }], procedencia: 'lessons' }, 'lessons');
    if (!r.duplicado) n++;
  }
  return { nuevas: n, total: (await db.query(`SELECT count(*)::int AS n FROM cog_experiencias`)).rows[0].n };
}

export const MEMORIA_TOOL = {
  description: 'Memoria autobiográfica de KRATOS (C03): experiencias con agente, tarea, objetivo, acciones, herramientas, evidencia, resultado, error, corrección y lección; cada una marcada VERIFICADO (respaldo comprobable) o INFERIDO. '
    + 'buscar (texto | tarea_id | clasificacion_error | agente | resultado). antes_de_actuar (objetivo, estrategia): errores documentados a evitar. elegir (objetivo, candidatas[]): estrategia sin errores documentados. recordar (agente, objetivo, resultado exito|fallo|parcial|desconocido, …). corregir (id, cambios, motivo) o retractar. Sin secretos: se redactan.',
  input_schema: { type: 'object', properties: { accion: { type: 'string', enum: ['buscar', 'antes_de_actuar', 'elegir', 'recordar', 'corregir', 'retractar'] }, texto: { type: 'string' }, tarea_id: { type: 'number' },
    clasificacion_error: { type: 'string' }, agente: { type: 'string' }, resultado: { type: 'string' }, objetivo: { type: 'string' }, estrategia: { type: 'string' }, candidatas: { type: 'array', items: { type: 'string' } },
    acciones: { type: 'array', items: { type: 'string' } }, herramientas: { type: 'array', items: { type: 'string' } }, evidencia: { type: 'string' }, detalle_resultado: { type: 'string' }, correccion: { type: 'string' }, leccion: { type: 'string' },
    id: { type: 'string' }, cambios: { type: 'object' }, motivo: { type: 'string' } }, required: ['accion'] },
};
export async function herramientaMemoria(db: Db, i: any, actor: string) {
  if (i.accion === 'buscar') return await buscarMemoria(db, i);
  if (i.accion === 'antes_de_actuar') return await erroresDocumentados(db, String(i.objetivo ?? ''), i.estrategia);
  if (i.accion === 'elegir') return await elegirConMemoria(db, String(i.objetivo ?? ''), (i.candidatas ?? []).map(String));
  if (i.accion === 'recordar') return await recordar(db, { ...i, agente: i.agente ?? actor, procedencia: actor }, actor);
  if (i.accion === 'corregir') return await corregir(db, String(i.id), i.cambios ?? {}, String(i.motivo ?? ''), actor);
  if (i.accion === 'retractar') return await corregir(db, String(i.id), { retractar: true }, String(i.motivo ?? ''), actor);
  return { error: 'Acción no válida' };
}
