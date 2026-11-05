import fs from 'node:fs';
import path from 'node:path';
import type { Db } from '../db.ts';

// PROJECT SOL / ACD · A07: grafo de investigación que conecta las unidades (materias S/H/V, puentes B, ingeniería generativa G)
// sin perder nunca la distinción entre evidencia, interpretación y especulación. Dos clases de aristas:
//  · «estructura»: enlaces de diseño del currículo (sol_unidades.relacionadas, de sol-def.ts). Orientan el estudio; NO son evidencia.
//  · conexiones registradas por Sol (sol_conexiones con tema_desde/tema_hacia), cada una con su tipo y su naturaleza:
//    evidencia (experimental, causal, correlacional, contradictoria, histórica), interpretación (conceptual, metafórica) o
//    especulación (hipotética). Si una conexión antigua no trae naturaleza, se deduce de su tipo y, si no se puede, cuenta como
//    especulación (lo más prudente) y se marca naturaleza_inferida. Una «evidencia» sin fuente verificada lleva un aviso.
// Solo lectura. Las tablas acd_* las escribe el motor ACD; aquí solo se consultan.

export type Naturaleza = 'estructura' | 'evidencia' | 'interpretacion' | 'especulacion';
const NATURALEZAS: Naturaleza[] = ['estructura', 'evidencia', 'interpretacion', 'especulacion'];
const POR_TIPO: Record<string, Naturaleza> = { experimental: 'evidencia', causal: 'evidencia', correlacional: 'evidencia', contradictoria: 'evidencia', historica: 'evidencia', conceptual: 'interpretacion', metaforica: 'interpretacion', hipotetica: 'especulacion' };
const TITULO: Record<Naturaleza, string> = { estructura: 'Estructura del currículo', evidencia: 'Evidencia', interpretacion: 'Interpretación', especulacion: 'Especulación' };
const codigo = (v: unknown) => {
  const c = String(v ?? '').trim().toUpperCase();
  if (!/^(S|H|V|B|G)[0-9]{2}$/.test(c)) throw new Error('unidad: código S01–S20, H01–H24, V01–V12, B01–B12 o G01–G12');
  return c;
};

export type Arista = { id?: number; desde: string; hacia: string; tipo: string; naturaleza: Naturaleza; explicacion: string; fuente_ids: number[]; [k: string]: unknown };

// Naturaleza de una conexión de Sol. Si la guardada y la de su tipo no coinciden, gana la MENOS firme (especulación < interpretación
// < evidencia): una hipótesis nunca se cuenta como evidencia porque una columna diga otra cosa. Sin ninguna de las dos, especulación.
const FIRMEZA: Record<string, number> = { especulacion: 0, interpretacion: 1, evidencia: 2 };
export function naturalezaDe(c: { naturaleza?: string | null; tipo?: string | null }): { naturaleza: Naturaleza; inferida: boolean; discrepante: string | null } {
  const guardada = c.naturaleza && c.naturaleza in FIRMEZA ? c.naturaleza as Naturaleza : null, porTipo = POR_TIPO[String(c.tipo ?? '')] ?? null;
  if (!guardada) return { naturaleza: porTipo ?? 'especulacion', inferida: true, discrepante: null };
  if (!porTipo || porTipo === guardada) return { naturaleza: guardada, inferida: false, discrepante: null };
  const menor = FIRMEZA[porTipo] < FIRMEZA[guardada] ? porTipo : guardada;
  return { naturaleza: menor, inferida: false, discrepante: `guardada «${guardada}», por su tipo «${porTipo}»: se toma la menos firme` };
}

export async function grafoInvestigacion(db: Db, opts: { unidad?: string } = {}) {
  const foco = opts.unidad ? codigo(opts.unidad) : null;
  const unidades = (await db.query(`SELECT codigo, tipo, area, titulo, estado, relacionadas FROM sol_unidades ORDER BY tipo, orden`)).rows;
  if (foco && !unidades.some((u) => u.codigo === foco)) throw new Error(`No existe la unidad ${foco}`);
  const hay = new Set(unidades.map((u) => u.codigo));
  // Estructura: un enlace por par (bidireccional si las dos unidades se citan)
  const pares = new Map<string, Arista>();
  for (const u of unidades) for (const r of u.relacionadas ?? []) {
    if (!hay.has(r) || r === u.codigo) continue;
    const k = [u.codigo, r].sort().join('|'), prev = pares.get(k);
    if (prev) prev.bidireccional = true;
    else pares.set(k, { desde: u.codigo, hacia: r, tipo: 'relacionada', naturaleza: 'estructura', explicacion: 'Enlace de diseño del currículo (sol-def): orienta el estudio, no es evidencia', fuente_ids: [], bidireccional: false });
  }
  // Conexiones de Sol entre dos unidades, con su respaldo real en la biblioteca
  const con = (await db.query(`SELECT c.id, c.desde, c.hacia, c.tipo, c.naturaleza, c.explicacion, c.fuente_ids, c.tema_desde, c.tema_hacia, c.created_by, c.created_at,
      (SELECT count(*)::int FROM sol_fuentes f WHERE f.id = ANY(c.fuente_ids) AND f.verificada) AS verificadas
    FROM sol_conexiones c WHERE c.tema_desde IS NOT NULL AND c.tema_hacia IS NOT NULL ORDER BY c.id`)).rows;
  // Entre dos unidades distintas: una conexión de una unidad consigo misma es interna y no la conecta con otra materia
  const entre = con.filter((c) => hay.has(c.tema_desde) && hay.has(c.tema_hacia));
  const sol: Arista[] = entre.filter((c) => c.tema_desde !== c.tema_hacia).map((c) => {
    const { naturaleza: nat, inferida, discrepante } = naturalezaDe(c);
    const respaldo = !(c.fuente_ids ?? []).length ? 'sin_fuente' : c.verificadas ? 'fuente_verificada' : 'fuente_no_verificada';
    return { id: c.id, desde: c.tema_desde, hacia: c.tema_hacia, tipo: c.tipo, naturaleza: nat, explicacion: c.explicacion, fuente_ids: c.fuente_ids ?? [], respaldo,
      etiquetas: { desde: c.desde, hacia: c.hacia }, registrada_por: c.created_by, fecha: c.created_at,
      ...(inferida ? { naturaleza_inferida: true } : {}), ...(discrepante ? { naturaleza_discrepante: discrepante } : {}),
      ...(nat === 'evidencia' && respaldo !== 'fuente_verificada' ? { aviso: 'marcada como evidencia sin fuente verificada: trátala con cautela' } : {}) };
  });
  const internas = entre.length - sol.length;
  let aristas: Arista[] = [...pares.values(), ...sol];
  let nodos = unidades.map(({ relacionadas, ...u }) => u);
  if (foco) {
    aristas = aristas.filter((a) => a.desde === foco || a.hacia === foco);
    const vecinos = new Set([foco, ...aristas.flatMap((a) => [a.desde, a.hacia])]);
    nodos = nodos.filter((u) => vecinos.has(u.codigo));
  }
  const cuenta = Object.fromEntries(NATURALEZAS.map((n) => [n, aristas.filter((a) => a.naturaleza === n).length])) as Record<Naturaleza, number>;
  const porEstado: Record<string, number> = {};
  for (const u of nodos) porEstado[`${u.tipo}:${u.estado}`] = (porEstado[`${u.tipo}:${u.estado}`] ?? 0) + 1;
  const conSol = new Set(sol.flatMap((a) => [a.desde, a.hacia]));
  const sinCodigo = foco ? undefined : (await db.query(`SELECT count(*)::int AS n FROM sol_conexiones WHERE tema_desde IS NULL OR tema_hacia IS NULL`)).rows[0].n;
  return {
    nodos, aristas,
    resumen: {
      unidades: nodos.length, por_estado: porEstado, aristas: cuenta,
      evidencia_sin_fuente_verificada: aristas.filter((a) => a.naturaleza === 'evidencia' && a.respaldo !== 'fuente_verificada').length,
      ...(foco ? { foco } : { materias_sin_conexiones: unidades.filter((u) => u.tipo === 'materia' && !conSol.has(u.codigo)).map((u) => u.codigo), conexiones_sin_codigo_fuera_del_grafo: sinCodigo, conexiones_internas_fuera_del_grafo: internas }),
      aviso: 'estructura = diseño del currículo, no es evidencia; evidencia/interpretación/especulación = conexiones de Sol con su tipo. Una interpretación o una especulación nunca cuentan como evidencia.',
    },
  };
}

// Resumen legible en español (para KRATOS y para el propietario)
export async function grafoMarkdown(db: Db, opts: { unidad?: string; max?: number } = {}) {
  return markdown(await grafoInvestigacion(db, opts), opts.max ?? 30);
}
function markdown(g: Awaited<ReturnType<typeof grafoInvestigacion>>, max: number) {
  const titulo = new Map(g.nodos.map((u: any) => [u.codigo, u.titulo]));
  const nombre = (c: string) => `${c} ${titulo.get(c) ?? ''}`.trim();
  const r = g.resumen as any, out: string[] = [];
  out.push(`# Grafo de investigación de Sol${r.foco ? ` · ${nombre(r.foco)}` : ''}`, '');
  out.push(`- Unidades: ${r.unidades} (${Object.entries(r.por_estado).map(([k, n]) => `${k} ${n}`).join(', ') || 'ninguna'})`);
  out.push(`- Aristas: estructura ${r.aristas.estructura} · evidencia ${r.aristas.evidencia} · interpretación ${r.aristas.interpretacion} · especulación ${r.aristas.especulacion}`);
  if (r.evidencia_sin_fuente_verificada) out.push(`- Atención: ${r.evidencia_sin_fuente_verificada} conexiones marcadas como evidencia no tienen fuente verificada`);
  out.push(`- ${r.aviso}`);
  const evaluadas = g.nodos.filter((u: any) => u.estado === 'evaluada').map((u: any) => u.codigo);
  out.push(`- Dominio demostrado por examen (evaluadas): ${evaluadas.length ? evaluadas.join(', ') : 'ninguna todavía'}`);
  for (const n of ['evidencia', 'interpretacion', 'especulacion'] as Naturaleza[]) {
    const xs = g.aristas.filter((a) => a.naturaleza === n);
    out.push('', `## ${TITULO[n]} (${xs.length})`);
    if (!xs.length) out.push('- ninguna registrada');
    for (const a of xs.slice(0, max)) out.push(`- ${nombre(a.desde)} → ${nombre(a.hacia)} · ${a.tipo}: ${String(a.explicacion).slice(0, 220)}${a.fuente_ids.length ? ` (fuentes ${a.fuente_ids.map((f) => `#${f}`).join(', ')})` : ' (sin fuentes)'}${a.aviso ? ' ⚠' : ''}`);
    if (xs.length > max) out.push(`- … y ${xs.length - max} más`);
  }
  const est = g.aristas.filter((a) => a.naturaleza === 'estructura');
  out.push('', `## ${TITULO.estructura} (${est.length})`, `- ${est.slice(0, max).map((a) => `${a.desde}–${a.hacia}`).join(', ')}${est.length > max ? ` … y ${est.length - max} más` : ''}`);
  if (r.materias_sin_conexiones?.length) out.push('', `## Materias sin conexiones registradas (${r.materias_sin_conexiones.length})`, `- ${r.materias_sin_conexiones.join(', ')}`);
  return out.join('\n');
}

// Ficha completa de una unidad: definición, estado, expediente, exámenes (nunca la rúbrica), conexiones y preguntas ACD
export async function fichaUnidad(db: Db, cod: string) {
  const c = codigo(cod);
  const u = (await db.query(`SELECT * FROM sol_unidades WHERE codigo = $1`, [c])).rows[0];
  if (!u) return { error: `No existe la unidad ${c}` };
  const proyecto = async (id: number | null) => {
    if (!id) return null;
    const p = (await db.query(`SELECT id, titulo, tipo, estado, version, carpeta, requisito, tarea_id, updated_at FROM sol_proyectos WHERE id = $1`, [id])).rows[0];
    if (!p) return { proyecto_id: id, error: 'el proyecto ya no existe' };
    const indice = p.carpeta ? path.join(p.carpeta, 'INDICE.md') : null;
    return { proyecto_id: p.id, titulo: p.titulo, tipo: p.tipo, estado: p.estado, version: p.version, carpeta: p.carpeta, indice, en_disco: !!indice && fs.existsSync(indice), actualizado: p.updated_at };
  };
  const [tarea, previos, fusionados, examenes, tareasExamen, conexiones, citadaPor, preguntas, historial] = await Promise.all([
    u.tarea_id ? db.query(`SELECT id, status, attempts, last_error, playbook_id, created_at FROM tasks WHERE id = $1`, [u.tarea_id]).then((r) => r.rows[0] ?? null) : null,
    db.query(`SELECT n, titulo, estado, proyecto_id FROM sol_modulos WHERE n = ANY($1::int[]) ORDER BY n`, [u.modulos_previos ?? []]).then((r) => r.rows),
    db.query(`SELECT n, titulo, estado FROM sol_modulos WHERE fusionado_en = $1 ORDER BY n`, [c]).then((r) => r.rows),
    db.query(`SELECT id, estado, nota, aprobado, jsonb_array_length(preguntas) AS preguntas, creado_por, calificado_por, created_at, respondido_en, calificado_en FROM sol_examenes WHERE unidad = $1 ORDER BY id DESC LIMIT 6`, [c]).then((r) => r.rows),
    db.query(`SELECT fase, estado, tarea_id, examen_id, detalle, lanzado_en, cerrado_en FROM sol_examen_tareas WHERE unidad = $1 ORDER BY id DESC LIMIT 6`, [c]).then((r) => r.rows).catch(() => []),
    db.query(`SELECT id, desde, hacia, tipo, naturaleza, explicacion, fuente_ids, tema_desde, tema_hacia, created_at FROM sol_conexiones WHERE tema_desde = $1 OR tema_hacia = $1 ORDER BY id DESC LIMIT 40`, [c]).then((r) => r.rows),
    db.query(`SELECT codigo FROM sol_unidades WHERE $1 = ANY(relacionadas) ORDER BY codigo`, [c]).then((r) => r.rows.map((x) => x.codigo)),
    db.query(`SELECT p.id, p.texto, p.estado, p.origen, p.motivo, p.created_at, (SELECT count(*)::int FROM acd_hipotesis h WHERE h.pregunta_id = p.id) AS hipotesis
      FROM acd_preguntas p WHERE $1 = ANY(p.unidades) ORDER BY p.id DESC LIMIT 30`, [c]).then((r) => r.rows),
    db.query(`SELECT id FROM sol_proyectos WHERE requisito = $1 AND id <> coalesce($2, 0) ORDER BY id DESC LIMIT 5`, [c, u.proyecto_id]).then((r) => r.rows.map((x) => x.id)),
  ]);
  const ultimo = examenes[0];
  const examen_estado = u.estado === 'evaluada' ? `dominio demostrado${ultimo?.aprobado ? `: examen #${ultimo.id} aprobado con ${Number(ultimo.nota)}` : ''}`
    : !ultimo ? (u.estado === 'estudiada' ? 'estudiada, esperando examen' : 'sin examen')
    : ultimo.estado === 'calificado' ? `último examen #${ultimo.id} ${ultimo.aprobado ? 'aprobado' : 'suspendido'} (${Number(ultimo.nota)})` : `examen #${ultimo.id} ${ultimo.estado}`;
  return {
    unidad: { codigo: u.codigo, tipo: u.tipo, area: u.area, titulo: u.titulo, alcance: u.alcance, orden: u.orden, estado: u.estado, estudios: u.intentos, lanzado_en: u.lanzado_en, completado_en: u.completado_en },
    dominio: u.estado === 'evaluada' ? 'demostrado por examen aprobado' : 'no demostrado (solo un examen aprobado por el examinador independiente lo demuestra)',
    tarea, expediente: await proyecto(u.proyecto_id), expedientes_anteriores: historial, modulos_previos: previos, modulos_fusionados: fusionados,
    examen_estado, examenes: examenes.map((e: any) => ({ examen_id: e.id, estado: e.estado, preguntas: e.preguntas, nota: e.nota === null ? null : Number(e.nota), aprobado: e.aprobado, creado_por: e.creado_por, calificado_por: e.calificado_por, creado: e.created_at, calificado_en: e.calificado_en })),
    tareas_examen: tareasExamen,
    estructura: { relacionadas: u.relacionadas ?? [], citada_por: citadaPor },
    conexiones: conexiones.map((x: any) => ({ ...x, naturaleza: naturalezaDe(x).naturaleza, otra: x.tema_desde === c ? x.tema_hacia : x.tema_desde })),
    preguntas_acd: preguntas,
  };
}

export const GRAFO_TOOL = {
  description: 'Grafo de investigación de PROJECT SOL (A07): las 80 unidades (materias S/H/V, puentes B, ingeniería generativa G) y sus conexiones, sin mezclar nunca evidencia, interpretación y especulación (los enlaces de «estructura» son diseño del currículo, no evidencia). grafo (unidad opcional): sin unidad devuelve el resumen y un informe legible; con unidad, el subgrafo de esa unidad y sus vecinas; completo=true devuelve todos los nodos y aristas. unidad (unidad): ficha completa: alcance, estado (solo «evaluada» prueba dominio), tarea, expediente, módulos previos y fusionados, estado de los exámenes (nunca la rúbrica), conexiones y preguntas ACD.',
  input_schema: {
    type: 'object', additionalProperties: false, required: ['accion'],
    properties: {
      accion: { type: 'string', enum: ['grafo', 'unidad'] },
      unidad: { type: 'string', description: 'código S01…V12, B01…B12 o G01…G12' },
      completo: { type: 'boolean', description: 'grafo sin unidad: todos los nodos y aristas (pesado)' },
    },
  },
};

export async function herramientaGrafo(db: Db, i: any, _actor: string) {
  try {
    if (i?.accion === 'unidad') { if (!i.unidad) return { error: 'Indica la unidad (p. ej. S04)' }; return await fichaUnidad(db, i.unidad); }
    if (i?.accion === 'grafo') {
      if (i.unidad || i.completo) return await grafoInvestigacion(db, { unidad: i.unidad || undefined });
      const g = await grafoInvestigacion(db);
      return { resumen: g.resumen, informe: markdown(g, 30) };
    }
    return { error: 'Acción no válida. Usa: grafo o unidad' };
  } catch (e: any) { return { error: String(e?.message ?? e).slice(0, 400) }; }
}
