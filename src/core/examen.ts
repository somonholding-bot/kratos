import fs from 'node:fs';
import { withTx, type Db, type Tx } from '../db.ts';
import { audit } from './state.ts';

// PROJECT SOL / ACD · A03: evaluación que demuestra comprensión real de cada materia (docs/SOL-DIRECTIVA-ACD.md, etapa 1, punto 6).
// Las garantías las aplica el código, no el agente:
//  · solo el examinador independiente (Saturno) crea y califica; solo Sol responde; quien respondió nunca califica;
//  · Sol nunca ve la rúbrica (ni aquí ni en el grafo); KRATOS ve preguntas, respuestas, estado y notas, pero no la rúbrica;
//  · la nota la calcula el código: media ≥ 0,7 y ninguna respuesta por debajo de 0,3. Solo un examen aprobado deja la materia
//    «evaluada», el único estado que prueba dominio; un suspenso la devuelve a estudio con los comentarios (máximo 2 estudios).
//  · si la rúbrica aparece en un informe (que Sol puede leer), el examen queda anulado y no vale como prueba.
// No importa playbooks.ts ni playbookchecks.ts: así playbookchecks.ts puede importar CURRICULO_CHECKS de aquí sin ciclos ESM.

type Q = Db | Tx;
export const MAX_INTENTOS = 2;                   // estudios por materia (el lanzamiento suma uno); después, «fallida»
export const APROBADO = 0.7, NOTA_MINIMA = 0.3;
const PREG_MIN = 6, PREG_MAX = 10, RESP_MIN = 80, RESP_MAX = 8000, COMENTARIO_MIN = 20, COMENTARIO_MAX = 2000, CRITERIOS_MIN = 40, CRITERIOS_MAX = 3000;
const EPS = 1e-9;   // solo para el error de redondeo binario (6 × 0,7 suma 4,1999…): nunca redondea una media por debajo del umbral hacia arriba

type Rol = 'sol' | 'saturno' | 'kratos' | 'otro';
export const rolDe = (actor: string): Rol => actor === 'agente:sol' ? 'sol' : actor === 'agente:saturno' ? 'saturno' : /^kratos\b/.test(String(actor ?? '')) ? 'kratos' : 'otro';
const norm = (s: unknown) => String(s ?? '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, ' ').trim();
const codigoMateria = (v: unknown) => {
  const c = String(v ?? '').trim().toUpperCase();
  if (!/^(S|H|V)[0-9]{2}$/.test(c)) throw new Error('unidad: hace falta el código de una materia (S01–S20, H01–H24, V01–V12)');
  return c;
};
const lista = (v: unknown, campo: string): any[] => { if (!Array.isArray(v) || !v.length) throw new Error(`${campo}: hace falta una lista no vacía`); return v; };
const num = (v: unknown) => (v === null || v === undefined ? null : Number(v));

async function unidad(q: Q, codigo: string) {
  const u = (await q.query(`SELECT codigo, tipo, titulo, alcance, estado, intentos, proyecto_id, completado_en FROM sol_unidades WHERE codigo = $1`, [codigo])).rows[0];
  if (!u) throw new Error(`No existe la materia ${codigo} (¿falta sembrar sol-def?)`);
  if (u.tipo !== 'materia') throw new Error(`${codigo} no es una materia`);
  return u;
}
// Examen por id o, si no, el último de la unidad en el estado pedido
async function examen(q: Q, i: any, estado: string) {
  const id = Number(i.examen_id) || null, cod = i.unidad ? codigoMateria(i.unidad) : null;
  if (!id && !cod) throw new Error('Indica examen_id o unidad');
  const e = (await q.query(`SELECT * FROM sol_examenes WHERE ($1::int IS NULL OR id = $1) AND ($2::text IS NULL OR unidad = $2) AND ($1::int IS NOT NULL OR estado = $3) ORDER BY id DESC LIMIT 1`, [id, cod, estado])).rows[0];
  if (!e) throw new Error(id ? `No existe el examen #${id}${cod ? ` de ${cod}` : ''}` : `No hay ningún examen de ${cod} en estado «${estado}»`);
  if (e.estado !== estado) throw new Error(`El examen #${e.id} está «${e.estado}»; esta acción exige «${estado}»`);
  return e;
}

// ---------- crear (solo Saturno) ----------
async function crear(db: Db, i: any, actor: string) {
  if (rolDe(actor) !== 'saturno') throw new Error('Solo el examinador independiente (Saturno) crea exámenes; Sol nunca crea su examen ni ve la rúbrica');
  const u = await unidad(db, codigoMateria(i.unidad));
  if (u.estado !== 'estudiada') throw new Error(`La materia ${u.codigo} está «${u.estado}»: solo se examina una materia estudiada`);
  const abierto = (await db.query(`SELECT id, estado FROM sol_examenes WHERE unidad = $1 AND estado IN ('creado','respondido') ORDER BY id DESC LIMIT 1`, [u.codigo])).rows[0];
  if (abierto) throw new Error(`Ya hay un examen abierto de ${u.codigo} (#${abierto.id}, ${abierto.estado}): termínalo antes de crear otro`);
  const preguntas = lista(i.preguntas, 'preguntas').map((p: any) => ({ n: Number(p?.n), pregunta: String(p?.pregunta ?? '').trim() }));
  if (preguntas.length < PREG_MIN || preguntas.length > PREG_MAX) throw new Error(`Un examen lleva entre ${PREG_MIN} y ${PREG_MAX} preguntas (has dado ${preguntas.length})`);
  preguntas.forEach((p, k) => {
    if (p.n !== k + 1) throw new Error(`preguntas: numéralas 1, 2, 3… en orden (la ${k + 1}.ª trae n=${p.n})`);
    if (p.pregunta.length < 25 || p.pregunta.length > 1500) throw new Error(`pregunta ${p.n}: entre 25 y 1500 caracteres`);
  });
  if (new Set(preguntas.map((p) => norm(p.pregunta))).size !== preguntas.length) throw new Error('Hay preguntas repetidas');
  const rub = lista(i.rubrica, 'rubrica').map((r: any) => ({ n: Number(r?.n), criterios: String(r?.criterios ?? '').trim() }));
  for (const p of preguntas) {
    const r = rub.filter((x) => x.n === p.n);
    if (r.length !== 1) throw new Error(`rubrica: hace falta exactamente un criterio para la pregunta ${p.n}`);
    if (r[0].criterios.length < CRITERIOS_MIN) throw new Error(`rubrica ${p.n}: criterios concretos de al menos ${CRITERIOS_MIN} caracteres (qué debe contener una respuesta correcta y qué la invalida)`);
    if (r[0].criterios.length > CRITERIOS_MAX) throw new Error(`rubrica ${p.n}: como mucho ${CRITERIOS_MAX} caracteres`);
  }
  if (rub.length !== preguntas.length) throw new Error('rubrica: un criterio por pregunta, sin números de más');
  // Tras un suspenso Sol conoce las preguntas anteriores y sus comentarios: el examen nuevo debe preguntar cosas nuevas
  const previas = new Set((await db.query(`SELECT p->>'pregunta' AS t FROM sol_examenes, jsonb_array_elements(preguntas) p WHERE unidad = $1`, [u.codigo])).rows.map((r) => norm(r.t)));
  const repetidas = preguntas.filter((p) => previas.has(norm(p.pregunta))).map((p) => p.n);
  if (repetidas.length) throw new Error(`Las preguntas deben ser nuevas: ${repetidas.join(', ')} ya salieron en un examen anterior de ${u.codigo}`);
  const e = (await db.query(`INSERT INTO sol_examenes (unidad, preguntas, rubrica, creado_por) VALUES ($1, $2, $3, $4) RETURNING id`,
    [u.codigo, JSON.stringify(preguntas), JSON.stringify(rub), actor])).rows[0];
  await audit(db, actor, 'sol.examen_creado', { examen: e.id, materia: u.codigo, preguntas: preguntas.length });
  return { examen_id: e.id, unidad: u.codigo, estado: 'creado', preguntas: preguntas.length,
    nota: 'Sol verá solo las preguntas. No copies la rúbrica en tu informe: Sol puede leer los informes y, si aparece, el código anula el examen.' };
}

// ---------- ver ----------
const vista = (e: any, rol: Rol) => ({
  examen_id: e.id, unidad: e.unidad, estado: e.estado, preguntas: e.preguntas, respuestas: e.respuestas ?? null, notas: e.notas ?? null,
  nota: num(e.nota), aprobado: e.aprobado, creado_por: e.creado_por, respondido_por: e.respondido_por, calificado_por: e.calificado_por,
  creado: e.created_at, respondido_en: e.respondido_en, calificado_en: e.calificado_en, ...(e.anulado_motivo ? { anulado_motivo: e.anulado_motivo } : {}),
  ...(rol === 'saturno' ? { rubrica: e.rubrica } : {}),
});
async function ver(db: Db, i: any, actor: string) {
  const rol = rolDe(actor), id = Number(i.examen_id) || null, cod = i.unidad ? codigoMateria(i.unidad) : null;
  if (rol === 'sol') {   // la examinada: solo las preguntas de lo que tiene por responder
    const rows = (await db.query(`SELECT e.id, e.unidad, u.titulo, e.preguntas FROM sol_examenes e JOIN sol_unidades u ON u.codigo = e.unidad
      WHERE e.estado = 'creado' AND ($1::int IS NULL OR e.id = $1) AND ($2::text IS NULL OR e.unidad = $2) ORDER BY e.id`, [id, cod])).rows;
    return { examenes: rows.map((r) => ({ examen_id: r.id, unidad: r.unidad, titulo: r.titulo, preguntas: r.preguntas })),
      nota: rows.length ? 'Responde todas con examen accion=responder (examen_id, respuestas [{n, respuesta}], cada una ≥ 80 caracteres). Puedes consultar tu biblioteca y tus fuentes; explica con tus palabras.' : 'No tienes ningún examen pendiente de responder' };
  }
  const rows = (await db.query(`SELECT * FROM sol_examenes WHERE ($1::int IS NULL OR id = $1) AND ($2::text IS NULL OR unidad = $2) ORDER BY id DESC LIMIT 10`, [id, cod])).rows;
  return { examenes: rows.map((r) => vista(r, rol)), ...(rol === 'saturno' ? {} : { nota: 'La rúbrica solo la ve el examinador (Saturno)' }) };
}

// ---------- responder (solo Sol) ----------
async function responder(db: Db, i: any, actor: string) {
  if (rolDe(actor) !== 'sol') throw new Error('Solo Sol, la examinada, responde sus exámenes');
  const e = await examen(db, i, 'creado');
  const resp = lista(i.respuestas, 'respuestas').map((r: any) => ({ n: Number(r?.n), respuesta: String(r?.respuesta ?? '').trim() }));
  const ns = (e.preguntas as any[]).map((p) => Number(p.n));
  const sobran = resp.filter((r) => !ns.includes(r.n)).map((r) => r.n);
  if (sobran.length) throw new Error(`respuestas: el examen #${e.id} no tiene las preguntas ${sobran.join(', ')}`);
  const faltan = ns.filter((n) => resp.filter((r) => r.n === n).length !== 1);
  if (faltan.length) throw new Error(`Responde todas las preguntas, una vez cada una: faltan o se repiten ${faltan.join(', ')}`);
  const cortas = resp.filter((r) => r.respuesta.length < RESP_MIN).map((r) => r.n);
  if (cortas.length) throw new Error(`Cada respuesta debe tener al menos ${RESP_MIN} caracteres y explicar con tus palabras: ${cortas.join(', ')} son demasiado cortas`);
  const largas = resp.filter((r) => r.respuesta.length > RESP_MAX).map((r) => r.n);
  if (largas.length) throw new Error(`Cada respuesta como mucho ${RESP_MAX} caracteres: resume ${largas.join(', ')}`);
  resp.sort((a, b) => a.n - b.n);
  const r = await db.query(`UPDATE sol_examenes SET estado = 'respondido', respuestas = $2, respondido_por = $3, respondido_en = now() WHERE id = $1 AND estado = 'creado' RETURNING id`, [e.id, JSON.stringify(resp), actor]);
  if (!r.rowCount) throw new Error(`El examen #${e.id} ya no está por responder`);
  await audit(db, actor, 'sol.examen_respondido', { examen: e.id, materia: e.unidad, respuestas: resp.length });
  return { examen_id: e.id, unidad: e.unidad, estado: 'respondido', respuestas: resp.length, nota: 'Lo calificará el examinador independiente; tú no ves la rúbrica' };
}

// ---------- calificar (solo Saturno, nunca quien respondió) ----------
async function calificar(db: Db, i: any, actor: string) {
  if (rolDe(actor) !== 'saturno') throw new Error('Solo el examinador independiente (Saturno) califica; Sol no puede calificarse');
  const e = await examen(db, i, 'respondido');
  if (actor === e.respondido_por) throw new Error('Quien respondió el examen no puede calificarlo');
  // Solo un número (o un texto numérico): Number(true) = 1 o Number(null) = 0 no son notas puestas por el examinador
  const notaDe = (v: unknown) => typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' ? Number(v.replace(',', '.')) : NaN;
  const notas = lista(i.notas, 'notas').map((x: any) => ({ n: Number(x?.n), nota: notaDe(x?.nota), comentario: String(x?.comentario ?? '').trim() }));
  const ns = (e.preguntas as any[]).map((p) => Number(p.n));
  if (notas.some((x) => !ns.includes(x.n)) || ns.some((n) => notas.filter((x) => x.n === n).length !== 1)) throw new Error(`Califica cada pregunta una sola vez (preguntas ${ns.join(', ')})`);
  for (const x of notas) {
    if (!Number.isFinite(x.nota) || x.nota < 0 || x.nota > 1) throw new Error(`nota ${x.n}: un número entre 0 y 1`);
    if (x.comentario.length < COMENTARIO_MIN) throw new Error(`comentario ${x.n}: explica en al menos ${COMENTARIO_MIN} caracteres qué estuvo bien o qué faltó (Sol lo recibirá si suspende)`);
    if (x.comentario.length > COMENTARIO_MAX) throw new Error(`comentario ${x.n}: como mucho ${COMENTARIO_MAX} caracteres`);
  }
  notas.sort((a, b) => a.n - b.n);
  // Se decide con la media exacta (redondearla antes podía convertir un 0,69965 en un 0,7 aprobado) y se guarda con 6 decimales
  const bruta = notas.reduce((s, x) => s + x.nota, 0) / notas.length;
  const media = Math.round(bruta * 1e6) / 1e6;
  const aprobado = bruta + EPS >= APROBADO && notas.every((x) => x.nota >= NOTA_MINIMA);
  const materia = await withTx(db, async (tx) => {
    const r = await tx.query(`UPDATE sol_examenes SET estado = 'calificado', notas = $2, nota = $3, aprobado = $4, calificado_por = $5, calificado_en = now() WHERE id = $1 AND estado = 'respondido' RETURNING id`,
      [e.id, JSON.stringify(notas), media, aprobado, actor]);
    if (!r.rowCount) throw new Error(`El examen #${e.id} ya no está por calificar`);
    await audit(tx, actor, 'sol.examen_calificado', { examen: e.id, materia: e.unidad, nota: media, aprobado });
    return aplicarResultado(tx, e.id, actor);
  });
  return { examen_id: e.id, unidad: e.unidad, nota: media, aprobado, materia: materia ?? 'sin cambios',
    regla: `aprueba con media ≥ ${APROBADO} y ninguna respuesta por debajo de ${NOTA_MINIMA}`,
    nota_resultado: aprobado ? 'Materia evaluada: dominio demostrado por examen' : materia === 'fallida' ? 'Suspenso en el último intento de estudio: la materia queda fallida' : 'Suspenso: la materia vuelve a estudio y Sol recibirá tus comentarios' };
}

// Aplica a la materia el resultado de un examen calificado (idempotente: solo actúa si la materia sigue «estudiada»
// y el examen es de este estudio). Aprobado → evaluada; suspenso → pendiente (reestudio) o fallida tras MAX_INTENTOS estudios.
export async function aplicarResultado(q: Q, examenId: number, actor: string): Promise<string | null> {
  const e = (await q.query(`SELECT id, unidad, estado, nota, aprobado, calificado_en FROM sol_examenes WHERE id = $1`, [examenId])).rows[0];
  if (!e || e.estado !== 'calificado') return null;
  const u = (await q.query(`SELECT codigo, estado, intentos, completado_en FROM sol_unidades WHERE codigo = $1 FOR UPDATE`, [e.unidad])).rows[0];
  if (!u || u.estado !== 'estudiada') return null;
  if (u.completado_en && new Date(e.calificado_en) < new Date(u.completado_en)) return null;   // examen de un estudio anterior
  const nuevo = e.aprobado ? 'evaluada' : u.intentos >= MAX_INTENTOS ? 'fallida' : 'pendiente';
  await q.query(`UPDATE sol_unidades SET estado = $2::text, tarea_id = CASE WHEN $2::text = 'evaluada' THEN tarea_id END WHERE codigo = $1`, [u.codigo, nuevo]);
  await audit(q, actor, e.aprobado ? 'sol.materia_evaluada' : nuevo === 'fallida' ? 'sol.materia_fallida' : 'sol.materia_suspendida',
    { materia: u.codigo, examen: e.id, nota: Number(e.nota), estudios: u.intentos });
  return nuevo;
}

// Comentarios del último examen suspendido de una materia, para el siguiente estudio (van en los parámetros de la tarea de Sol).
// Primero las respuestas peor calificadas, para que el recorte nunca se coma lo importante; el informe entero del examinador
// (tarea de calificación) queda señalado para leerlo con ver_resultado_tarea. Corto a propósito: va en el brief del playbook, que
// tiene 3.000 caracteres; con más, los pasos del estudio (unidades del registro ACD, componentes del expediente) se recortarían.
export async function correccionesExamen(q: Q, codigo: string, max = 300): Promise<string> {
  const e = (await q.query(`SELECT e.id, e.nota, e.notas, e.preguntas, e.aprobado, u.proyecto_id,
      (SELECT x.tarea_id FROM sol_examen_tareas x WHERE x.examen_id = e.id AND x.fase = 'calificar' AND x.estado <> 'fallida' AND x.tarea_id IS NOT NULL ORDER BY x.id DESC LIMIT 1) AS informe
    FROM sol_examenes e JOIN sol_unidades u ON u.codigo = e.unidad WHERE e.unidad = $1 AND e.estado = 'calificado' ORDER BY e.id DESC LIMIT 1`, [codigo])).rows[0];
  if (!e || e.aprobado || !Array.isArray(e.notas)) return '';
  const preg = new Map((e.preguntas as any[]).map((p) => [Number(p.n), String(p.pregunta)]));
  const partes = [...e.notas].sort((a: any, b: any) => a.nota - b.nota).map((x: any) => `P${x.n} (${x.nota}) «${(preg.get(Number(x.n)) ?? '').slice(0, 30)}»: ${x.comentario}`);
  const cab = `Examen #${e.id} suspendido (media ${Number(e.nota)}).${e.informe ? ` Informe: tarea #${e.informe}.` : ''}${e.proyecto_id ? ` Reentrega P${e.proyecto_id} (proyecto_id).` : ''} `;
  const s = cab + partes.join(' | ');
  return s.length > max ? s.slice(0, max - 1) + '…' : s;
}

// ---------- estado ----------
async function estado(db: Db, i: any) {
  if (i.unidad) {
    const u = await unidad(db, codigoMateria(i.unidad));
    const ex = (await db.query(`SELECT id, estado, nota, aprobado, jsonb_array_length(preguntas) AS preguntas, created_at, respondido_en, calificado_en FROM sol_examenes WHERE unidad = $1 ORDER BY id DESC LIMIT 8`, [u.codigo])).rows;
    return { unidad: u.codigo, titulo: u.titulo, estado: u.estado, estudios: u.intentos, dominio: u.estado === 'evaluada' ? 'demostrado por examen aprobado' : 'no demostrado (solo un examen aprobado lo demuestra)',
      examenes: ex.map((x) => ({ examen_id: x.id, estado: x.estado, preguntas: x.preguntas, nota: num(x.nota), aprobado: x.aprobado, creado: x.created_at, respondido_en: x.respondido_en, calificado_en: x.calificado_en })) };
  }
  const porEstado = (await db.query(`SELECT estado, count(*)::int AS n FROM sol_unidades WHERE tipo = 'materia' GROUP BY estado ORDER BY estado`)).rows;
  const abiertos = (await db.query(`SELECT id, unidad, estado, created_at FROM sol_examenes WHERE estado IN ('creado','respondido') ORDER BY id`)).rows;
  const ultimos = (await db.query(`SELECT id, unidad, estado, nota, aprobado, calificado_en FROM sol_examenes ORDER BY id DESC LIMIT 10`)).rows;
  const sinExamen = (await db.query(`SELECT codigo FROM sol_unidades u WHERE tipo = 'materia' AND estado = 'estudiada' AND NOT EXISTS (SELECT 1 FROM sol_examenes e WHERE e.unidad = u.codigo AND e.estado IN ('creado','respondido')) ORDER BY completado_en NULLS FIRST, orden`)).rows.map((r) => r.codigo);
  return { materias_por_estado: porEstado, examenes_abiertos: abiertos.map((x) => ({ examen_id: x.id, unidad: x.unidad, estado: x.estado, creado: x.created_at })),
    estudiadas_esperando_examen: sinExamen, ultimos: ultimos.map((x) => ({ examen_id: x.id, unidad: x.unidad, estado: x.estado, nota: num(x.nota), aprobado: x.aprobado, calificado_en: x.calificado_en })),
    aviso: 'Solo «evaluada» (examen aprobado por el examinador independiente) prueba dominio; «estudiada» significa que el expediente existe, no que se domine.' };
}

export const EXAMEN_TOOL = {
  description: 'Exámenes de dominio de las materias de Sol (PROJECT SOL, A03). Un examinador independiente (Saturno) crea y califica; Sol solo responde y nunca ve la rúbrica. crear (solo Saturno; unidad, preguntas [{n, pregunta}] de 6 a 10, rubrica privada [{n, criterios}]; solo con la materia «estudiada» y sin otro examen abierto; preguntas nuevas si hubo examen anterior). ver (unidad o examen_id: Sol ve solo las preguntas de lo que tiene por responder; Saturno lo ve todo; KRATOS ve preguntas, respuestas, estado y notas, nunca la rúbrica). responder (solo Sol; examen_id o unidad, respuestas [{n, respuesta}] para todas, cada una ≥ 80 caracteres). calificar (solo Saturno y nunca quien respondió; examen_id, notas [{n, nota 0-1, comentario}] para todas): el código calcula la media; aprueba con ≥ 0,7 y ninguna respuesta < 0,3, y solo entonces la materia queda «evaluada»; si suspende vuelve a estudio con los comentarios. estado (unidad opcional).',
  input_schema: {
    type: 'object', additionalProperties: false, required: ['accion'],
    properties: {
      accion: { type: 'string', enum: ['crear', 'ver', 'responder', 'calificar', 'estado'] },
      unidad: { type: 'string', description: 'código de la materia (S01…V12)' },
      examen_id: { type: 'integer' },
      preguntas: { type: 'array', items: { type: 'object', properties: { n: { type: 'integer' }, pregunta: { type: 'string' } }, required: ['n', 'pregunta'] } },
      rubrica: { type: 'array', items: { type: 'object', properties: { n: { type: 'integer' }, criterios: { type: 'string' } }, required: ['n', 'criterios'] } },
      respuestas: { type: 'array', items: { type: 'object', properties: { n: { type: 'integer' }, respuesta: { type: 'string' } }, required: ['n', 'respuesta'] } },
      notas: { type: 'array', items: { type: 'object', properties: { n: { type: 'integer' }, nota: { type: 'number' }, comentario: { type: 'string' } }, required: ['n', 'nota', 'comentario'] } },
    },
  },
};

// La auditoría de herramientas (servidor MCP y motor API) guarda la ENTRADA de cada llamada tal cual, DESPUÉS de ejecutarla, y
// audit_log se lee con ver_actividad y consultar_bd: la rúbrica quedaría allí a la vista. Se sustituye en el mismo objeto de entrada
// (lo que se audita es ese objeto), haya ido bien o mal la llamada. El integrador debe además no auditar «rubrica» si copia la entrada.
export function ocultarRubrica(i: any) {
  if (i && typeof i === 'object' && i.rubrica !== undefined) i.rubrica = `[rúbrica privada: ${Array.isArray(i.rubrica) ? i.rubrica.length : 0} criterios; no se guarda en la auditoría]`;
  return i;
}

// actor: «agente:sol», «agente:saturno», «kratos (IA)», «kratos (ciclo CEO)»… (el rol se decide aquí, en código)
export async function herramientaExamen(db: Db, i: any, actor: string) {
  try {
    switch (i?.accion) {
      case 'crear': return await crear(db, i, actor);
      case 'ver': return await ver(db, i, actor);
      case 'responder': return await responder(db, i, actor);
      case 'calificar': return await calificar(db, i, actor);
      case 'estado': return await estado(db, i);
      default: return { error: 'Acción no válida. Usa: crear, ver, responder, calificar o estado' };
    }
  } catch (e: any) { return { error: String(e?.message ?? e).slice(0, 400) }; }
  finally { ocultarRubrica(i); }
}

// ---------- Fuga de la rúbrica ----------
// Hay fuga si un tramo de 8 palabras de los criterios (que no esté ya en las preguntas, que son públicas) aparece en el texto.
const palabras = (s: unknown) => norm(s).replace(/[^a-z0-9]+/g, ' ').trim().split(' ').filter(Boolean);
const tejas = (s: unknown, k = 8) => { const w = palabras(s), out = new Set<string>(); for (let i = 0; i + k <= w.length; i++) out.add(w.slice(i, i + k).join(' ')); return out; };
export function rubricaFiltrada(e: { preguntas: any[]; rubrica: any[] }, texto: string): string | null {
  const pub = new Set<string>();
  for (const p of e.preguntas ?? []) for (const t of tejas(p.pregunta)) pub.add(t);
  const inf = ` ${palabras(texto).join(' ')} `;
  for (const r of e.rubrica ?? []) {
    const w = palabras(r.criterios);
    if (w.length < 8) { const f = w.join(' '); if (f.length >= 30 && inf.includes(` ${f} `)) return f; continue; }
    for (const t of tejas(r.criterios)) if (!pub.has(t) && inf.includes(` ${t} `)) return t;
  }
  return null;
}

// ---------- Comprobaciones de playbook del currículo y de los exámenes ----------
// Mismo contrato que las de playbookchecks.ts: claves admitidas, descripción legible y comprobación con datos reales.
// ctx = { texto (informe), params (entradas de la tarea), extraido, db, task }. «Durante la tarea» = desde task.started_at.
type Ctx = { texto: string; params: Record<string, unknown>; extraido?: Record<string, any>; db?: Db; task?: any };
type CheckDef = { claves: string[]; describir: (c: any) => string; comprobar: (c: any, ctx: Ctx) => Promise<{ ok: boolean; detalle: string }> };
const desde = (t: any) => t?.started_at ?? t?.created_at ?? new Date(0);
// Inicio del intento en curso ($2 = inicio de la tarea, $3 = id): cada reintento es una sesión nueva del agente (no recuerda lo que
// leyó en la anterior). Se calcula en SQL: pasarlo por un Date de JS perdería los microsegundos y colaría llamadas del intento anterior.
const INICIO_INTENTO = `(SELECT coalesce(max(at), $2::timestamptz) FROM audit_log WHERE action = 'tarea.reintento' AND details->>'id' = $3::text AND at >= $2::timestamptz)`;
const motorApi = async (db: Db) => (await db.query(`SELECT value FROM system_state WHERE key = 'agents_engine'`)).rows[0]?.value === 'api';
const PERMITIDO_EXAMINADOR = `(details->'input'->>'accion' IN ('estado','listar') OR (details->'input'->>'accion' = 'leer' AND lower(coalesce(details->'input'->>'componente','')) IN ('temario','objetivos')))`;
// A03, independencia: del expediente de Sol el examinador solo lee el temario y los objetivos (para calibrar el alcance), nunca sus
// conclusiones. Lo dicen las llamadas a proyecto_sol que auditó el servidor de herramientas en ESTE intento, no el informe. Si leyó
// más, los exámenes que creó en este intento se anulan (no son independientes) y el reintento, en una sesión nueva, crea otro.
async function independencia(db: Db, task: any, cod: string): Promise<{ ok: boolean; detalle: string }> {
  if (await motorApi(db)) return { ok: true, detalle: 'motor API: las llamadas del examinador no se auditan por agente; la independencia no se puede comprobar' };
  const quien = agentes(task)[0], ventana = [quien, desde(task), String(task.id)];
  const malas = (await db.query(`SELECT details->'input'->>'accion' AS accion, details->'input'->>'componente' AS componente FROM audit_log
      WHERE actor = $1 AND action = 'herramienta.proyecto_sol' AND at >= ${INICIO_INTENTO} AND NOT ${PERMITIDO_EXAMINADOR} ORDER BY id LIMIT 10`, ventana)).rows;
  if (!malas.length) return { ok: true, detalle: 'del expediente de Sol solo se consultó el temario, los objetivos o el estado (o nada)' };
  const usos = [...new Set(malas.map((m) => `${m.accion ?? '?'}${m.componente ? ` ${m.componente}` : ''}`))].join(', ');
  const anulados = (await db.query(`UPDATE sol_examenes SET estado = 'anulado', anulado_motivo = $5 WHERE unidad = $4 AND creado_por = $1 AND created_at >= ${INICIO_INTENTO} AND estado IN ('creado','respondido') RETURNING id`,
    [...ventana, cod, `el examinador usó proyecto_sol (${usos}) en la tarea #${task.id}: no es independiente del expediente de Sol`.slice(0, 300)])).rows.map((r) => r.id);
  if (anulados.length) await audit(db, 'examen (verificación)', 'sol.examen_anulado', { examenes: anulados, materia: cod, tarea: task.id, motivo: 'independencia' });
  return { ok: false, detalle: `el examinador usó proyecto_sol ${usos}: del expediente de Sol solo puede leer temario y objetivos${anulados.length ? `; examen #${anulados.join(', #')} anulado: en el reintento crea otro sin leer sus conclusiones` : ''}` };
}
const agentes = (t: any) => [`agente:${t?.owner_function}`, String(t?.owner_function ?? '')];
const minimo = (c: any, def: number) => { const n = Number(c?.minimo); return Number.isFinite(n) && n > 0 ? n : def; };
const sinDb = { ok: false, detalle: 'sin base de datos para comprobarlo' };
const codigoDe = (ctx: Ctx, k: string) => String(ctx.params?.[k] ?? '').trim().toUpperCase();
const esMateria = (c: string) => /^(S|H|V)[0-9]{2}$/.test(c);
const sinCodigo = (k: string) => ({ ok: false, detalle: `la tarea no trae un código de materia válido en «${k}»` });
// Título del expediente con el código como palabra entera (S02 no casa con «S020» ni con un título que no lo nombre)
export const tituloConCodigo = (c: string) => `\\m${c}\\M`;
// Llamadas reales a los lectores (las audita el servidor de herramientas): biblioteca_sol leer_texto e investigar_sol/_fuentes leer
const LECTURAS_SQL = `((action = 'herramienta.biblioteca_sol' AND details->'input'->>'accion' = 'leer_texto')
  OR (action IN ('herramienta.investigar_sol','herramienta.investigar_fuentes') AND details->'input'->>'accion' = 'leer'))`;

export const CURRICULO_CHECKS: Record<string, CheckDef> = {
  // Punto 8 de la directiva: preguntas para la exploración ACD nacidas de la materia
  materia_preguntas_acd: {
    claves: ['minimo'],
    describir: (c) => `al menos ${minimo(c, 3)} preguntas para ACD registradas con acd (accion=registrar_pregunta, origen=materia, unidades=[código de la materia])`,
    comprobar: async (c, ctx) => {
      if (!ctx.db || !ctx.task) return sinDb;
      const cod = codigoDe(ctx, 'codigo'), min = minimo(c, 3);
      if (!esMateria(cod)) return sinCodigo('codigo');
      const r = (await ctx.db.query(`SELECT count(*)::int AS n, count(*) FILTER (WHERE origen = 'materia')::int AS de_materia FROM acd_preguntas WHERE $1 = ANY(unidades) AND created_at >= $2 AND created_by = ANY($3)`,
        [cod, desde(ctx.task), agentes(ctx.task)])).rows[0];
      return { ok: r.n >= min, detalle: `${r.n} preguntas ACD de ${cod} durante la tarea (mínimo ${min}); ${r.de_materia} con origen materia` };
    },
  },
  // Punto 5: conexiones con otras disciplinas, con los códigos de las dos materias (alimentan el grafo, A07)
  materia_conexiones: {
    claves: ['minimo'],
    describir: (c) => `al menos ${minimo(c, 3)} conexiones con otras materias (biblioteca_sol accion=registrar_conexion con tema_desde/tema_hacia: el código de esta materia y el de la otra)`,
    comprobar: async (c, ctx) => {
      if (!ctx.db || !ctx.task) return sinDb;
      const cod = codigoDe(ctx, 'codigo'), min = minimo(c, 3);
      if (!esMateria(cod)) return sinCodigo('codigo');
      const r = (await ctx.db.query(`SELECT count(*)::int AS n, count(*) FILTER (WHERE naturaleza = 'evidencia')::int AS ev, count(*) FILTER (WHERE naturaleza = 'interpretacion')::int AS int,
          count(*) FILTER (WHERE naturaleza = 'especulacion')::int AS esp, count(DISTINCT CASE WHEN tema_desde = $1 THEN tema_hacia ELSE tema_desde END)::int AS materias
        FROM sol_conexiones WHERE created_at >= $2 AND created_by = ANY($3) AND tema_desde IS NOT NULL AND tema_hacia IS NOT NULL AND tema_desde <> tema_hacia AND $1 IN (tema_desde, tema_hacia)`,
        [cod, desde(ctx.task), agentes(ctx.task)])).rows[0];
      return { ok: r.n >= min, detalle: `${r.n} conexiones de ${cod} con ${r.materias} materias (mínimo ${min}): ${r.ev} evidencia, ${r.int} interpretación, ${r.esp} especulación` };
    },
  },
  // Punto 2 y A05: fuentes registradas o citadas durante la tarea y lecturas reales anotadas por el código (leido_hasta).
  // sol_fuentes no guarda cuándo se leyó: una fuente leída en otra tarea y citada ahora tiene leido_hasta > 0. Por eso además
  // tiene que haber llamadas reales a los lectores DURANTE esta tarea (auditadas por el servidor de herramientas, no por el agente).
  materia_fuentes: {
    claves: ['minimo', 'leidas'],
    describir: (c) => `al menos ${minimo(c, 8)} fuentes registradas o citadas durante la tarea, ${c?.leidas ?? 2} de ellas con lectura real hecha en esta tarea (investigar_sol leer o biblioteca_sol leer_texto: el código anota lo leído)`,
    comprobar: async (c, ctx) => {
      if (!ctx.db || !ctx.task) return sinDb;
      const min = minimo(c, 8), leer = c?.leidas === undefined ? 2 : Math.max(0, Number(c.leidas) || 0), since = desde(ctx.task), who = agentes(ctx.task);
      const r = (await ctx.db.query(`WITH f AS (SELECT id FROM sol_fuentes WHERE created_by = ANY($2) AND created_at >= $1 UNION SELECT fuente_id FROM sol_afirmaciones WHERE created_by = ANY($2) AND created_at >= $1)
        SELECT count(*)::int AS n, count(*) FILTER (WHERE s.verificada)::int AS verificadas, count(*) FILTER (WHERE s.leido_hasta > 0)::int AS leidas,
          count(*) FILTER (WHERE s.acceso = 'texto_completo')::int AS completas,
          (SELECT count(*)::int FROM audit_log WHERE actor = ANY($2) AND at >= $1 AND ${LECTURAS_SQL}) AS llamadas
        FROM f JOIN sol_fuentes s ON s.id = f.id`, [since, who])).rows[0];
      // Con el motor API no hay auditoría por agente: no se puede probar que la lectura sea de esta tarea, y se dice
      const api = await motorApi(ctx.db), llamadasOk = api || r.llamadas >= leer;
      return { ok: r.n >= min && r.leidas >= leer && llamadasOk,
        detalle: `${r.n} fuentes (mínimo ${min}), ${r.verificadas} verificadas; ${r.leidas} con lectura real anotada (mínimo ${leer}), ${r.completas} leídas enteras; `
          + (api ? 'motor API: no se puede comprobar que las lecturas se hicieran en esta tarea' : `${r.llamadas} llamadas a los lectores durante la tarea (mínimo ${leer})`) };
    },
  },
  // Punto 7: el expediente es un proyecto de tipo materia, completo y con sus archivos en disco
  materia_expediente: {
    claves: [],
    describir: () => 'expediente de la materia entregado con proyecto_sol accion=entregar tipo=materia (titulo con el código), completo y con sus archivos en disco',
    comprobar: async (_c, ctx) => {
      if (!ctx.db || !ctx.task) return sinDb;
      const cod = codigoDe(ctx, 'codigo');
      if (!esMateria(cod)) return sinCodigo('codigo');
      const p = (await ctx.db.query(`SELECT id, estado, carpeta, version, faltantes FROM sol_proyectos WHERE tipo = 'materia'
          AND (tarea_id = $1 OR (updated_at >= $2 AND (requisito = $3 OR titulo ~* $4))) ORDER BY (tarea_id = $1) DESC NULLS LAST, id DESC LIMIT 1`, [ctx.task.id, desde(ctx.task), cod, tituloConCodigo(cod)])).rows[0];
      if (!p) return { ok: false, detalle: `no hay ningún expediente tipo materia de ${cod} entregado durante la tarea` };
      const dir = p.carpeta ? `${p.carpeta}/v${p.version}` : '';
      const n = dir && fs.existsSync(dir) ? fs.readdirSync(dir).filter((f) => f.endsWith('.md')).length : 0;
      if (p.estado !== 'completed' || !n) return { ok: false, detalle: `expediente P${p.id} en estado ${p.estado}${p.faltantes?.length ? `; falta: ${p.faltantes.join('; ')}` : ''}${n ? '' : '; sin archivos en disco'}` };
      await ctx.db.query(`UPDATE sol_proyectos SET tarea_id = coalesce(tarea_id, $2) WHERE id = $1`, [p.id, ctx.task.id]);
      return { ok: true, detalle: `expediente P${p.id} de ${cod}, ${n} archivos en ${p.carpeta}` };
    },
  },
  // Examen creado en la tarea, sin la rúbrica en el informe y por un examinador independiente del expediente de Sol (A03)
  examen_creado: {
    claves: [],
    describir: () => 'examen creado con examen accion=crear para la unidad durante la tarea (6-10 preguntas y rúbrica privada), sin copiar la rúbrica en el informe y sin leer del expediente de Sol más que el temario y los objetivos',
    comprobar: async (_c, ctx) => {
      if (!ctx.db || !ctx.task) return sinDb;
      const cod = codigoDe(ctx, 'unidad');
      const e = (await ctx.db.query(`SELECT * FROM sol_examenes WHERE unidad = $1 AND created_at >= $2 AND creado_por = $3 AND estado <> 'anulado' ORDER BY id DESC LIMIT 1`, [cod, desde(ctx.task), agentes(ctx.task)[0]])).rows[0];
      if (!e) return { ok: false, detalle: `no se creó ningún examen de ${cod} durante la tarea (examen accion=crear)` };
      const fuga = rubricaFiltrada(e, `${ctx.texto ?? ''}\n${JSON.stringify(ctx.extraido ?? {})}`);
      if (fuga) {
        await ctx.db.query(`UPDATE sol_examenes SET estado = 'anulado', anulado_motivo = $2 WHERE id = $1 AND estado <> 'calificado'`, [e.id, `rúbrica copiada en el informe de la tarea #${ctx.task.id}`]);
        await audit(ctx.db, 'examen (verificación)', 'sol.examen_anulado', { examen: e.id, materia: cod, tarea: ctx.task.id });
        // el detalle no repite el tramo filtrado: queda en la tarea, que Sol puede leer
        return { ok: false, detalle: `un tramo de la rúbrica aparece en el informe: examen #${e.id} anulado; crea otro con preguntas nuevas sin copiar la rúbrica en el informe` };
      }
      const ind = await independencia(ctx.db, ctx.task, cod);
      if (!ind.ok) return ind;
      return { ok: true, detalle: `examen #${e.id} de ${cod} con ${(e.preguntas ?? []).length} preguntas (${e.estado}); ${ind.detalle}` };
    },
  },
  examen_respondido: {
    claves: [],
    describir: () => 'examen de la unidad respondido entero con examen accion=responder durante la tarea',
    comprobar: async (_c, ctx) => {
      if (!ctx.db || !ctx.task) return sinDb;
      const cod = codigoDe(ctx, 'unidad'), id = Number(ctx.params?.examen) || null;
      const e = (await ctx.db.query(`SELECT id, estado FROM sol_examenes WHERE unidad = $1 AND ($2::int IS NULL OR id = $2) AND respondido_en >= $3 AND respondido_por = $4 AND estado IN ('respondido','calificado') ORDER BY id DESC LIMIT 1`,
        [cod, id, desde(ctx.task), agentes(ctx.task)[0]])).rows[0];
      return e ? { ok: true, detalle: `examen #${e.id} de ${cod} respondido` } : { ok: false, detalle: `el examen${id ? ` #${id}` : ''} de ${cod} no se respondió durante la tarea (examen accion=responder)` };
    },
  },
  examen_calificado: {
    claves: [],
    describir: () => 'examen de la unidad calificado pregunta a pregunta con examen accion=calificar durante la tarea',
    comprobar: async (_c, ctx) => {
      if (!ctx.db || !ctx.task) return sinDb;
      const cod = codigoDe(ctx, 'unidad'), id = Number(ctx.params?.examen) || null;
      const e = (await ctx.db.query(`SELECT id, nota, aprobado FROM sol_examenes WHERE unidad = $1 AND ($2::int IS NULL OR id = $2) AND calificado_en >= $3 AND calificado_por = $4 AND estado = 'calificado' ORDER BY id DESC LIMIT 1`,
        [cod, id, desde(ctx.task), agentes(ctx.task)[0]])).rows[0];
      return e ? { ok: true, detalle: `examen #${e.id} de ${cod} calificado: nota ${Number(e.nota)}, ${e.aprobado ? 'aprobado' : 'suspenso'}` } : { ok: false, detalle: `el examen${id ? ` #${id}` : ''} de ${cod} no se calificó durante la tarea (examen accion=calificar)` };
    },
  },
};
