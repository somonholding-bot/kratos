import type { Db } from '../db.ts';
import { audit } from './state.ts';

// Expansión cognitiva C04 — espacio de trabajo global (inspiración funcional en Baars 1988 / Dehaene: un contenido «en escena» a la vez
// que todos los especialistas ven). Es un mecanismo de coordinación, no conciencia. Garantías por código y por índices únicos de la base:
// un solo objetivo principal ACTIVO, subtareas en secuencia, propiedad explícita, traspasos y mensajes con procedencia, conflictos que
// bloquean el cierre, presupuesto que bloquea al agotarse, y ningún COMPLETED sin artefacto de verificación de otro actor.

export type Estado = 'QUEUED' | 'ACTIVE' | 'VERIFYING' | 'COMPLETED' | 'BLOCKED' | 'FAILED' | 'CANCELLED';
const TRANSICIONES: Record<Estado, Estado[]> = {
  QUEUED: ['ACTIVE', 'CANCELLED'], ACTIVE: ['VERIFYING', 'BLOCKED', 'FAILED', 'CANCELLED'], VERIFYING: ['COMPLETED', 'ACTIVE', 'FAILED'],
  BLOCKED: ['ACTIVE', 'FAILED', 'CANCELLED'], COMPLETED: [], FAILED: [], CANCELLED: [],
};
const TERMINALES: Estado[] = ['COMPLETED', 'FAILED', 'CANCELLED'];
const norm = (s: any) => String(s ?? '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();
const palabras = (s: string) => new Set(norm(s).split(' ').filter((w) => w.length > 3));
const parecido = (a: string, b: string) => { const x = palabras(a), y = palabras(b); if (!x.size || !y.size) return 0; let c = 0; for (const w of x) if (y.has(w)) c++; return c / Math.min(x.size, y.size); };

async function mensaje(db: Db, m: { objetivo_id?: number | null; de: string; para?: string; tipo: string; prioridad?: number; contenido: string; referencias?: any[]; procedencia: string }) {
  const r = (await db.query(`INSERT INTO cog_mensajes (objetivo_id, de, para, tipo, prioridad, contenido, referencias, procedencia) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id`,
    [m.objetivo_id ?? null, m.de, m.para ?? 'todos', m.tipo, m.prioridad ?? 50, String(m.contenido).slice(0, 2000), JSON.stringify(m.referencias ?? []), m.procedencia])).rows[0];
  return r.id as number;
}
async function transicion(db: Db, o: any, a: Estado, actor: string, motivo: string, extra: string = '', params: any[] = []) {
  if (!TRANSICIONES[o.estado as Estado].includes(a)) throw new Error(`Transición no permitida: ${o.estado} → ${a} (objetivo ${o.id})`);
  if (!String(motivo ?? '').trim()) throw new Error('Toda transición necesita un motivo');
  await db.query(`UPDATE cog_objetivos SET estado = $2, updated_at = now() ${TERMINALES.includes(a) ? ', cerrado_at = now()' : ''} ${extra} WHERE id = $1`, [o.id, a, ...params]);
  await db.query(`INSERT INTO cog_transiciones (objetivo_id, de, a, actor, motivo) VALUES ($1,$2,$3,$4,$5)`, [o.id, o.estado, a, actor, String(motivo).slice(0, 1000)]);
  await audit(db, actor, 'cog.objetivo', { id: o.id, de: o.estado, a });
}
async function obtener(db: Db, id: number) { const o = (await db.query(`SELECT * FROM cog_objetivos WHERE id = $1`, [id])).rows[0]; if (!o) throw new Error(`No existe el objetivo ${id}`); return o; }

// Propone un objetivo (o subtarea). Evita trabajo redundante: si ya hay uno equivalente abierto, devuelve ese en vez de duplicar.
export async function proponer(db: Db, i: any, actor: string) {
  for (const k of ['titulo', 'criterio_exito', 'propietario', 'aceptacion']) if (!String(i?.[k] ?? '').trim()) throw new Error(`Falta ${k}${k === 'aceptacion' ? ' (por qué se acepta este objetivo)' : ''}`);
  const padre = i.padre_id ? await obtener(db, Number(i.padre_id)) : null;
  if (padre && TERMINALES.includes(padre.estado)) throw new Error(`El objetivo padre ${padre.id} está cerrado (${padre.estado})`);
  const abiertos = (await db.query(`SELECT id, titulo, estado, propietario FROM cog_objetivos WHERE estado NOT IN ('FAILED','CANCELLED') AND (estado <> 'COMPLETED' OR cerrado_at > now() - interval '30 days') AND padre_id IS NOT DISTINCT FROM $1`, [padre?.id ?? null])).rows;
  const igual = abiertos.find((x) => parecido(x.titulo, i.titulo) >= 0.8);
  if (igual) { await mensaje(db, { objetivo_id: igual.id, de: actor, tipo: 'informacion', contenido: `Propuesta redundante evitada: «${i.titulo}» equivale a #${igual.id} (${igual.estado}, de ${igual.propietario})`, procedencia: 'espacio_global' }); return { id: igual.id, redundante: true, estado: igual.estado, motivo: `Ya existe #${igual.id} «${igual.titulo}» (${igual.estado})` }; }
  const orden = padre ? (await db.query(`SELECT coalesce(max(orden), 0) + 1 AS n FROM cog_objetivos WHERE padre_id = $1`, [padre.id])).rows[0].n : 0;
  const r = (await db.query(`INSERT INTO cog_objetivos (padre_id, orden, titulo, descripcion, criterio_exito, prioridad, propietario, creado_por, presupuesto, aceptacion, tarea_id, huella)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING id`,
    [padre?.id ?? null, orden, String(i.titulo).slice(0, 300), i.descripcion ?? null, i.criterio_exito, Number(i.prioridad ?? 50), i.propietario, actor, JSON.stringify(i.presupuesto ?? {}), i.aceptacion, i.tarea_id ?? null, norm(i.titulo)])).rows[0];
  await db.query(`INSERT INTO cog_transiciones (objetivo_id, de, a, actor, motivo) VALUES ($1, NULL, 'QUEUED', $2, $3)`, [r.id, actor, `Aceptado: ${i.aceptacion}`]);
  return { id: r.id, redundante: false, estado: 'QUEUED', orden };
}

// Activa: un solo objetivo principal activo; una subtarea activa por objetivo y en orden (las anteriores cerradas)
export async function activar(db: Db, id: number, actor: string, motivo = 'inicio') {
  const o = await obtener(db, id);
  if (o.padre_id == null) {
    const act = (await db.query(`SELECT id, titulo FROM cog_objetivos WHERE padre_id IS NULL AND estado IN ('ACTIVE','VERIFYING') AND id <> $1`, [id])).rows[0];
    if (act) throw new Error(`Ya hay un objetivo principal activo: #${act.id} «${act.titulo}». Ciérralo, bloquéalo o cancélalo antes.`);
  } else {
    const p = await obtener(db, o.padre_id);
    if (p.estado !== 'ACTIVE') throw new Error(`La subtarea necesita su objetivo #${p.id} ACTIVO (está ${p.estado})`);
    const prev = (await db.query(`SELECT id, estado FROM cog_objetivos WHERE padre_id = $1 AND orden < $2 AND estado NOT IN ('COMPLETED','CANCELLED')`, [o.padre_id, o.orden])).rows;
    if (prev.length) throw new Error(`Subtareas en secuencia: antes hay que cerrar ${prev.map((x) => `#${x.id} (${x.estado})`).join(', ')}`);
  }
  await transicion(db, o, 'ACTIVE', actor, motivo);
  return { id, estado: 'ACTIVE' };
}

export async function aVerificacion(db: Db, id: number, actor: string, entrega: string) {
  const o = await obtener(db, id);
  if (actor !== o.propietario) throw new Error(`Solo el propietario (${o.propietario}) entrega a verificación`);
  await transicion(db, o, 'VERIFYING', actor, `Entregado: ${entrega}`);
  await mensaje(db, { objetivo_id: id, de: actor, tipo: 'informacion', prioridad: 70, contenido: `Listo para verificar: ${entrega}`, procedencia: actor });
  return { id, estado: 'VERIFYING' };
}

// COMPLETED solo con artefacto de verificación de un actor distinto del propietario, resultado ok, sin conflictos abiertos y con las subtareas cerradas
export async function completar(db: Db, id: number, artefacto: { tipo: string; ref: string; verificador: string; resultado: string; detalle?: string }, actor: string) {
  const o = await obtener(db, id);
  if (o.estado !== 'VERIFYING') throw new Error(`Solo se completa desde VERIFYING (está ${o.estado})`);
  if (!artefacto?.tipo || !artefacto?.ref || !artefacto?.verificador) throw new Error('Nunca COMPLETED sin artefacto de verificación (tipo, ref, verificador, resultado)');
  if (artefacto.verificador === o.propietario) throw new Error('El artefacto de verificación debe venir de un actor distinto del propietario');
  if (actor !== artefacto.verificador) throw new Error('Solo el verificador registra su propio artefacto');
  if (artefacto.resultado !== 'ok') throw new Error(`La verificación no fue ok (${artefacto.resultado}): vuelve a ACTIVE o falla`);
  const conf = (await db.query(`SELECT id FROM cog_conflictos WHERE objetivo_id = $1 AND estado = 'abierto'`, [id])).rows;
  if (conf.length) throw new Error(`Hay conflictos abiertos (${conf.map((c) => `#${c.id}`).join(', ')}): resuélvelos antes de cerrar`);
  const subs = (await db.query(`SELECT id, estado FROM cog_objetivos WHERE padre_id = $1 AND estado NOT IN ('COMPLETED','CANCELLED')`, [id])).rows;
  if (subs.length) throw new Error(`Subtareas sin cerrar: ${subs.map((s) => `#${s.id} (${s.estado})`).join(', ')}`);
  await transicion(db, o, 'COMPLETED', actor, `Verificado por ${artefacto.verificador}: ${artefacto.tipo} ${artefacto.ref}`, `, artefacto_verificacion = $3, motivo_cierre = $4`, [JSON.stringify(artefacto), 'verificado']);
  await mensaje(db, { objetivo_id: id, de: actor, tipo: 'cierre', prioridad: 80, contenido: `#${id} COMPLETED con ${artefacto.tipo} ${artefacto.ref}`, referencias: [artefacto], procedencia: actor });
  return { id, estado: 'COMPLETED' };
}

export async function cerrarSinExito(db: Db, id: number, a: 'FAILED' | 'CANCELLED' | 'BLOCKED', motivo: string, actor: string) {
  const o = await obtener(db, id);
  await transicion(db, o, a, actor, motivo, `, motivo_cierre = $3`, [motivo]);
  if (a !== 'BLOCKED') { // las subtareas abiertas se cancelan con el padre
    const subs = (await db.query(`SELECT * FROM cog_objetivos WHERE padre_id = $1 AND estado NOT IN ('COMPLETED','FAILED','CANCELLED')`, [id])).rows;
    for (const s of subs) await transicion(db, s, 'CANCELLED', actor, `Objetivo padre ${a}: ${motivo}`, `, motivo_cierre = $3`, [`padre ${a}`]).catch(async () => { await db.query(`UPDATE cog_objetivos SET estado = 'CANCELLED', cerrado_at = now() WHERE id = $1`, [s.id]); });
  }
  await mensaje(db, { objetivo_id: id, de: actor, tipo: 'cierre', prioridad: 80, contenido: `#${id} ${a}: ${motivo}`, procedencia: actor });
  return { id, estado: a };
}
export async function rehacer(db: Db, id: number, motivo: string, actor: string) { const o = await obtener(db, id); await transicion(db, o, 'ACTIVE', actor, `Rehacer: ${motivo}`); return { id, estado: 'ACTIVE' }; }

// Traspaso de propiedad con procedencia: solo el propietario actual (o KRATOS) puede traspasar
export async function traspasar(db: Db, id: number, a: string, nota: string, actor: string) {
  const o = await obtener(db, id);
  if (actor !== o.propietario && actor !== 'kratos') throw new Error(`Solo el propietario (${o.propietario}) o KRATOS traspasa #${id}`);
  if (TERMINALES.includes(o.estado)) throw new Error('No se traspasa un objetivo cerrado');
  if (!String(nota ?? '').trim()) throw new Error('El traspaso necesita una nota con el estado y lo pendiente');
  await db.query(`UPDATE cog_objetivos SET propietario = $2, updated_at = now() WHERE id = $1`, [id, a]);
  await db.query(`INSERT INTO cog_transiciones (objetivo_id, de, a, actor, motivo) VALUES ($1,$2,$2,$3,$4)`, [id, o.estado, actor, `Traspaso ${o.propietario} → ${a}: ${nota}`]);
  await mensaje(db, { objetivo_id: id, de: actor, para: a, tipo: 'traspaso', prioridad: 75, contenido: `Te paso #${id} «${o.titulo}». ${nota}`, procedencia: actor });
  return { id, de: o.propietario, a };
}

export async function publicar(db: Db, i: any, actor: string) {
  if (!String(i?.contenido ?? '').trim()) throw new Error('Falta el contenido');
  if (!['informacion', 'referencia'].includes(i.tipo ?? 'informacion')) throw new Error('Tipo de mensaje publicable: informacion o referencia');
  return { id: await mensaje(db, { objetivo_id: i.objetivo_id ?? null, de: actor, para: i.para ?? 'todos', tipo: i.tipo ?? 'informacion', prioridad: Number(i.prioridad ?? 50), contenido: i.contenido, referencias: i.referencias ?? [], procedencia: i.procedencia ?? actor }) };
}
// Información priorizada para un agente: lo dirigido a él o a todos, sin leer, por prioridad
export async function leer(db: Db, agente: string, marcar = true) {
  const r = (await db.query(`SELECT id, objetivo_id, de, para, tipo, prioridad, contenido, referencias, procedencia, at FROM cog_mensajes WHERE (para = $1 OR para = 'todos') AND NOT ($1 = ANY(leido_por)) ORDER BY prioridad DESC, at LIMIT 30`, [agente])).rows;
  if (marcar && r.length) await db.query(`UPDATE cog_mensajes SET leido_por = array_append(leido_por, $1) WHERE id = ANY($2)`, [agente, r.map((x) => x.id)]);
  return r;
}

export async function conflicto(db: Db, objetivo_id: number, partes: string[], descripcion: string, actor: string) {
  await obtener(db, objetivo_id);
  const r = (await db.query(`INSERT INTO cog_conflictos (objetivo_id, partes, descripcion) VALUES ($1,$2,$3) RETURNING id`, [objetivo_id, partes, descripcion])).rows[0];
  await mensaje(db, { objetivo_id, de: actor, tipo: 'conflicto', prioridad: 90, contenido: `Conflicto #${r.id} entre ${partes.join(' y ')}: ${descripcion}`, procedencia: actor });
  return { id: r.id };
}
export async function resolverConflicto(db: Db, id: number, resolucion: string, actor: string) {
  const c = (await db.query(`SELECT * FROM cog_conflictos WHERE id = $1`, [id])).rows[0];
  if (!c) throw new Error(`No existe el conflicto ${id}`);
  if (c.partes.includes(actor) && actor !== 'kratos') throw new Error('Una parte del conflicto no lo resuelve sola: lo resuelve KRATOS u otro agente');
  await db.query(`UPDATE cog_conflictos SET estado = 'resuelto', resolucion = $2, resuelto_por = $3, resuelto_at = now() WHERE id = $1`, [id, resolucion, actor]);
  return { id, estado: 'resuelto' };
}

// Presupuesto: al superarlo el objetivo se BLOQUEA (no se sigue gastando)
export async function consumir(db: Db, id: number, gasto: Record<string, number>, actor: string) {
  const o = await obtener(db, id);
  const c = { ...(o.consumido ?? {}) } as Record<string, number>;
  for (const [k, v] of Object.entries(gasto ?? {})) c[k] = Math.round(((c[k] ?? 0) + Number(v)) * 1000) / 1000;
  await db.query(`UPDATE cog_objetivos SET consumido = $2, updated_at = now() WHERE id = $1`, [id, JSON.stringify(c)]);
  const excedido = Object.entries(o.presupuesto ?? {}).filter(([k, lim]) => (c[k] ?? 0) > Number(lim)).map(([k, lim]) => `${k} ${c[k]} > ${lim}`);
  if (excedido.length && o.estado === 'ACTIVE') {
    await cerrarSinExito(db, id, 'BLOCKED', `Presupuesto agotado: ${excedido.join(', ')}`, actor);
    return { id, consumido: c, bloqueado: true, excedido };
  }
  return { id, consumido: c, bloqueado: false };
}

// Explicación inspeccionable de por qué un objetivo se aceptó, cerró, rechazó o sigue sin resolver
export async function explicar(db: Db, id: number) {
  const o = await obtener(db, id);
  const tr = (await db.query(`SELECT de, a, actor, motivo, at FROM cog_transiciones WHERE objetivo_id = $1 ORDER BY id`, [id])).rows;
  const subs = (await db.query(`SELECT id, orden, titulo, estado, propietario FROM cog_objetivos WHERE padre_id = $1 ORDER BY orden`, [id])).rows;
  const conf = (await db.query(`SELECT id, partes, descripcion, estado, resolucion FROM cog_conflictos WHERE objetivo_id = $1`, [id])).rows;
  const sinResolver = !TERMINALES.includes(o.estado);
  return { id, titulo: o.titulo, estado: o.estado, propietario: o.propietario, criterio_exito: o.criterio_exito, por_que_se_acepto: o.aceptacion,
    cierre: o.estado === 'COMPLETED' ? { artefacto: o.artefacto_verificacion } : TERMINALES.includes(o.estado) ? { motivo: o.motivo_cierre } : null,
    sin_resolver: sinResolver ? `Sigue ${o.estado}${o.estado === 'BLOCKED' ? `: ${o.motivo_cierre}` : ''}${subs.filter((s) => !TERMINALES.includes(s.estado)).length ? `; subtareas abiertas ${subs.filter((s) => !TERMINALES.includes(s.estado)).map((s) => '#' + s.id).join(', ')}` : ''}${conf.filter((c) => c.estado === 'abierto').length ? '; conflictos abiertos' : ''}` : null,
    presupuesto: { limite: o.presupuesto, consumido: o.consumido }, historial: tr, subtareas: subs, conflictos: conf };
}

export async function estadoEspacio(db: Db) {
  const activo = (await db.query(`SELECT id, titulo, estado, propietario, criterio_exito, consumido, presupuesto FROM cog_objetivos WHERE padre_id IS NULL AND estado IN ('ACTIVE','VERIFYING')`)).rows[0] ?? null;
  return { objetivo_activo: activo,
    subtareas: activo ? (await db.query(`SELECT id, orden, titulo, estado, propietario FROM cog_objetivos WHERE padre_id = $1 ORDER BY orden`, [activo.id])).rows : [],
    cola: (await db.query(`SELECT id, titulo, prioridad, propietario FROM cog_objetivos WHERE padre_id IS NULL AND estado = 'QUEUED' ORDER BY prioridad DESC, id LIMIT 20`)).rows,
    bloqueados: (await db.query(`SELECT id, titulo, motivo_cierre FROM cog_objetivos WHERE estado = 'BLOCKED' ORDER BY id DESC LIMIT 10`)).rows,
    conflictos_abiertos: (await db.query(`SELECT id, objetivo_id, partes, descripcion FROM cog_conflictos WHERE estado = 'abierto'`)).rows };
}

export const ESPACIO_TOOL = {
  description: 'Espacio de trabajo global (C04): UN objetivo principal activo a la vez, subtareas en secuencia, estados QUEUED→ACTIVE→VERIFYING→COMPLETED (o BLOCKED/FAILED/CANCELLED). '
    + 'estado; proponer (titulo, criterio_exito, propietario, aceptacion, padre_id, prioridad, presupuesto{tokens,usd,minutos}); activar (id); entregar (id, entrega); completar (id, artefacto{tipo, ref, resultado:"ok", detalle}): solo un verificador distinto del propietario; '
    + 'fallar|cancelar|bloquear (id, motivo); rehacer (id, motivo); traspasar (id, a, nota); publicar (contenido, para, tipo informacion|referencia, prioridad, referencias); leer; conflicto (id, partes[], descripcion); resolver_conflicto (conflicto_id, resolucion); consumir (id, gasto{}); explicar (id).',
  input_schema: { type: 'object', properties: { accion: { type: 'string', enum: ['estado', 'proponer', 'activar', 'entregar', 'completar', 'fallar', 'cancelar', 'bloquear', 'rehacer', 'traspasar', 'publicar', 'leer', 'conflicto', 'resolver_conflicto', 'consumir', 'explicar'] },
    id: { type: 'number' }, padre_id: { type: 'number' }, titulo: { type: 'string' }, descripcion: { type: 'string' }, criterio_exito: { type: 'string' }, propietario: { type: 'string' }, aceptacion: { type: 'string' }, prioridad: { type: 'number' },
    presupuesto: { type: 'object' }, entrega: { type: 'string' }, artefacto: { type: 'object' }, motivo: { type: 'string' }, a: { type: 'string' }, nota: { type: 'string' }, contenido: { type: 'string' }, para: { type: 'string' }, tipo: { type: 'string' },
    referencias: { type: 'array', items: { type: 'object' } }, partes: { type: 'array', items: { type: 'string' } }, conflicto_id: { type: 'number' }, resolucion: { type: 'string' }, gasto: { type: 'object' }, tarea_id: { type: 'number' } }, required: ['accion'] },
};
// El actor de las herramientas llega como «agente:x» o «kratos (…)»: en el espacio se usa el id corto del agente
export const agenteDe = (actor: string) => (actor.startsWith('agente:') ? actor.slice(7) : actor.startsWith('kratos') ? 'kratos' : actor);
export async function herramientaEspacio(db: Db, i: any, actorBruto: string) {
  const actor = agenteDe(actorBruto), id = Number(i.id);
  switch (i.accion) {
    case 'estado': return await estadoEspacio(db);
    case 'proponer': return await proponer(db, i, actor);
    case 'activar': return await activar(db, id, actor, i.motivo ?? 'inicio');
    case 'entregar': return await aVerificacion(db, id, actor, String(i.entrega ?? ''));
    case 'completar': return await completar(db, id, { ...(i.artefacto ?? {}), verificador: actor }, actor);
    case 'fallar': return await cerrarSinExito(db, id, 'FAILED', String(i.motivo ?? ''), actor);
    case 'cancelar': return await cerrarSinExito(db, id, 'CANCELLED', String(i.motivo ?? ''), actor);
    case 'bloquear': return await cerrarSinExito(db, id, 'BLOCKED', String(i.motivo ?? ''), actor);
    case 'rehacer': return await rehacer(db, id, String(i.motivo ?? ''), actor);
    case 'traspasar': return await traspasar(db, id, String(i.a ?? ''), String(i.nota ?? ''), actor);
    case 'publicar': return await publicar(db, i, actor);
    case 'leer': return await leer(db, actor);
    case 'conflicto': return await conflicto(db, id, (i.partes ?? []).map(String), String(i.descripcion ?? ''), actor);
    case 'resolver_conflicto': return await resolverConflicto(db, Number(i.conflicto_id), String(i.resolucion ?? ''), actor);
    case 'consumir': return await consumir(db, id, i.gasto ?? {}, actor);
    case 'explicar': return await explicar(db, id);
  }
  return { error: 'Acción no válida' };
}
