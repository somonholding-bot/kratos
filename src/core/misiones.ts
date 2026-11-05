import type { Db } from '../db.ts';
import { audit } from './state.ts';
import { crearOportunidad, beneficioReal } from './ksie.ts';

// Adenda del propietario (5-nov-2026) — misión doble con traducción opcional:
//  A) SOL/ACD busca conocimiento fundamental (incluida la tradición hermética como fuente de hipótesis) aunque no sea rentable.
//  B) KRATOS/KSIE busca beneficio neto verificable en cualquier sector, sin apego a las apps.
//  C) Si SOL encuentra algo prometedor, KRATOS PUEDE estudiar aplicaciones; comercializar es opcional y nunca justifica exagerar.
// Regla permanente: dos tableros independientes (científico y económico); nunca una puntuación combinada de rentabilidad.

export const LINEAS_A = [
  { codigo: 'A1', area: 'materia-fisica', titulo: 'Origen y transformación de la materia', descripcion: 'Origen, formación, estructura y transformación de la materia física.' },
  { codigo: 'A2', area: 'leyes-fundamentales', titulo: 'Leyes fundamentales', descripcion: 'Leyes que gobiernan energía, campos, partículas, espacio y tiempo.' },
  { codigo: 'A3', area: 'vibracion-informacion', titulo: 'Vibración, resonancia e información', descripcion: 'Vibraciones, resonancia, oscilaciones, información y emergencia de la organización física.' },
  { codigo: 'A4', area: 'conciencia', titulo: 'Conciencia, percepción, atención e intención', descripcion: 'Naturaleza de la conciencia, la percepción, la atención y la intención humana.' },
  { codigo: 'A5', area: 'intencion-fisica', titulo: 'Intención y sistemas físicos', descripcion: 'Si la conciencia o la intención humana tienen influencia medible sobre sistemas físicos más allá de los mecanismos establecidos.' },
  { codigo: 'A6', area: 'hermetismo', titulo: 'Hermetismo, alquimia y esoterismo', descripcion: 'Principios herméticos, alquimia y filosofías esotéricas e iniciáticas como fuente de conceptos e hipótesis comprobables.' },
  { codigo: 'A7', area: 'modelos-originales', titulo: 'Modelos originales con ACD', descripcion: 'Modelos científicos, predicciones y experimentos originales generados con ACD.' },
  { codigo: 'A8', area: 'preguntas-abiertas', titulo: 'Preguntas sin resolver', descripcion: 'Preguntas abiertas importantes aunque no tengan aplicación tecnológica ni financiera inmediata.' },
];
export const NATURALEZAS = ['ensenanza_historica', 'interpretacion_filosofica', 'hipotesis_especulativa', 'hipotesis_comprobable', 'hallazgo_computacional', 'hallazgo_experimental', 'hallazgo_replicado', 'descubrimiento_verificado'] as const;
export const NOMBRE_NATURALEZA: Record<string, string> = {
  ensenanza_historica: 'enseñanza histórica', interpretacion_filosofica: 'interpretación filosófica', hipotesis_especulativa: 'hipótesis especulativa', hipotesis_comprobable: 'hipótesis comprobable',
  hallazgo_computacional: 'hallazgo computacional (datos simulados)', hallazgo_experimental: 'hallazgo experimental (sin replicar)', hallazgo_replicado: 'hallazgo replicado', descubrimiento_verificado: 'descubrimiento verificado de forma independiente',
};

export async function sembrarLineas(db: Db) {
  for (const l of LINEAS_A) await db.query(`INSERT INTO sol_lineas (codigo, titulo, descripcion, area) VALUES ($1,$2,$3,$4) ON CONFLICT (codigo) DO UPDATE SET titulo = EXCLUDED.titulo, descripcion = EXCLUDED.descripcion, area = EXCLUDED.area`, [l.codigo, l.titulo, l.descripcion, l.area]);
  return LINEAS_A.length;
}

// Línea de la Misión A con menos preguntas: la curiosidad de ACD la recibe como foco para que ninguna quede abandonada
export async function lineaMenosEstudiada(db: Db) {
  const r = (await db.query(`SELECT l.codigo, l.titulo, l.area, (SELECT count(*) FROM acd_preguntas p WHERE p.area = l.area)::int + (SELECT count(*) FROM acd_hipotesis h WHERE h.linea = l.codigo)::int AS n
     FROM sol_lineas l ORDER BY n, l.codigo LIMIT 1`).catch(() => ({ rows: [] as any[] }))).rows[0];
  return r ?? null;
}

// Clasifica una hipótesis ACD. Los niveles altos los exige la evidencia que el código comprueba, no la palabra de quien clasifica.
export async function clasificar(db: Db, hipotesis_id: number, naturaleza: string, motivo: string, actor: string, linea?: string) {
  if (!NATURALEZAS.includes(naturaleza as any)) throw new Error(`naturaleza: ${NATURALEZAS.join(' | ')}`);
  if (!String(motivo ?? '').trim()) throw new Error('La clasificación necesita un motivo');
  const h = (await db.query(`SELECT id, estado, created_by FROM acd_hipotesis WHERE id = $1`, [hipotesis_id])).rows[0];
  if (!h) throw new Error(`No existe la hipótesis #${hipotesis_id}`);
  const exps = (await db.query(`SELECT e.id, e.veredicto, e.datos, e.sha256_salida FROM acd_experimentos e JOIN acd_modelos m ON m.id = e.modelo_id WHERE m.hipotesis_id = $1 AND e.estado = 'ok'`, [hipotesis_id])).rows;
  const aFavor = exps.filter((e) => e.veredicto === 'a_favor'), reales = aFavor.filter((e) => ['observado', 'mixto'].includes(e.datos));
  const criticas = (await db.query(`SELECT critico, veredicto FROM acd_criticas WHERE objeto = 'hipotesis' AND objeto_id = $1`, [hipotesis_id])).rows;
  const criticaIndependiente = criticas.some((c) => c.veredicto === 'aceptar' && c.critico !== h.created_by);
  const exige: Record<string, () => string | null> = {
    hipotesis_comprobable: () => null,
    hallazgo_computacional: () => (aFavor.length ? null : 'necesita un experimento ACD terminado con veredicto a favor'),
    hallazgo_experimental: () => (reales.length ? null : 'necesita un experimento a favor con datos OBSERVADOS o mixtos (los datos simulados solo dan un hallazgo computacional)'),
    hallazgo_replicado: () => (new Set(reales.map((e) => e.sha256_salida)).size >= 2 && criticaIndependiente ? null : 'necesita ≥ 2 experimentos a favor con datos observados y salidas distintas, y una crítica independiente que acepte'),
    descubrimiento_verificado: () => (actor === 'propietario' ? null : 'solo lo declara el propietario tras una verificación externa independiente; KRATOS nunca se lo autoasigna'),
  };
  const falta = exige[naturaleza]?.();
  if (falta) throw new Error(`No se puede clasificar como «${NOMBRE_NATURALEZA[naturaleza]}»: ${falta}`);
  if (linea && !LINEAS_A.some((l) => l.codigo === linea)) throw new Error(`línea: ${LINEAS_A.map((l) => l.codigo).join(', ')}`);
  await db.query(`UPDATE acd_hipotesis SET naturaleza = $2, naturaleza_motivo = $3, linea = coalesce($4, linea), updated_at = now() WHERE id = $1`, [hipotesis_id, naturaleza, String(motivo).slice(0, 600), linea ?? null]);
  await audit(db, actor, 'mision_a.clasificacion', { hipotesis: hipotesis_id, naturaleza });
  return { hipotesis_id, naturaleza, nombre: NOMBRE_NATURALEZA[naturaleza] };
}

// Misión C: traducir un conocimiento a una aplicación posible. Nunca lo presenta como demostrado si no lo está.
const EXAGERA = /\b(probad[oa]s?|demostrad[oa]s?|cient[ií]ficamente (comprobad|probad|demostrad)\w*|garantiza\w*|cura\w*|milagro\w*|revolucionari[oa]|100 ?%|sin efectos secundarios)\b/i;
export const SECTORES = ['tecnologia_invenciones', 'materiales_energia_ingenieria', 'salud_cognicion', 'software_automatizacion_ia', 'procesos_industriales', 'modelos_negocio'];
export async function traducir(db: Db, i: { hipotesis_id?: number; afirmacion_id?: number; sector: string; descripcion: string; oportunidad?: { nombre: string; tipo: string } }, actor: string) {
  if (!SECTORES.includes(i.sector)) throw new Error(`sector: ${SECTORES.join(', ')}`);
  if (!String(i.descripcion ?? '').trim()) throw new Error('Falta la descripción de la aplicación');
  let naturaleza: string, titulo: string;
  if (i.hipotesis_id) {
    const h = (await db.query(`SELECT titulo, naturaleza, estado FROM acd_hipotesis WHERE id = $1`, [i.hipotesis_id])).rows[0];
    if (!h) throw new Error(`No existe la hipótesis #${i.hipotesis_id}`);
    naturaleza = h.naturaleza; titulo = h.titulo;
    if (['refutada', 'rechazada'].includes(h.estado)) throw new Error(`La hipótesis #${i.hipotesis_id} está ${h.estado}: no se traduce a un producto`);
  } else if (i.afirmacion_id) {
    const a = (await db.query(`SELECT texto, nivel FROM sol_afirmaciones WHERE id = $1`, [i.afirmacion_id])).rows[0];
    if (!a) throw new Error(`No existe la afirmación #${i.afirmacion_id}`);
    naturaleza = a.nivel === 'A' ? 'hallazgo_replicado' : a.nivel === 'H' ? 'ensenanza_historica' : a.nivel === 'E' ? 'refutada' : 'hipotesis_comprobable'; titulo = String(a.texto).slice(0, 120);
    if (naturaleza === 'refutada') throw new Error('La afirmación tiene nivel E (refutada): no se traduce a un producto');
  } else throw new Error('Indica hipotesis_id o afirmacion_id');
  const verificada = naturaleza === 'descubrimiento_verificado';
  if (EXAGERA.test(i.descripcion) && !verificada) throw new Error(`La descripción exagera («${EXAGERA.exec(i.descripcion)![0]}»): la base es una ${NOMBRE_NATURALEZA[naturaleza] ?? naturaleza}, no algo demostrado`);
  if (i.sector === 'salud_cognicion' && EXAGERA.test(i.descripcion)) throw new Error('En salud y cognición no se promete efecto alguno: requiere validación clínica y regulatoria');
  const aviso = `Basada en una ${NOMBRE_NATURALEZA[naturaleza] ?? naturaleza} («${titulo}»). ${verificada ? 'Verificada de forma independiente.' : 'NO está demostrada: cualquier uso comercial debe decirlo.'}${i.sector === 'salud_cognicion' ? ' Requiere validación clínica y regulatoria antes de cualquier uso con personas.' : ''} Comercializar es opcional.`;
  let oportunidad_id: number | null = null;
  if (i.oportunidad) {
    const o = await crearOportunidad(db, { nombre: i.oportunidad.nombre, tipo: i.oportunidad.tipo, sector: i.sector, descripcion: `${i.descripcion}\n\n[${aviso}]`, origen: 'agente', incertidumbre: verificada ? 0.6 : 0.9, riesgo: 0.6 }, actor);
    oportunidad_id = o.id;
  }
  const r = (await db.query(`INSERT INTO conocimiento_aplicaciones (hipotesis_id, afirmacion_id, sector, descripcion, naturaleza_fuente, aviso, oportunidad_id, created_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id`,
    [i.hipotesis_id ?? null, i.afirmacion_id ?? null, i.sector, i.descripcion, naturaleza, aviso, oportunidad_id, actor])).rows[0];
  await audit(db, actor, 'mision_c.aplicacion', { id: r.id, sector: i.sector, naturaleza });
  return { id: r.id, aviso, oportunidad_id };
}

// ---------- Tableros independientes. Ninguno contiene campos del otro ni una puntuación combinada. ----------
const n = async (db: Db, sql: string, p: any[] = []) => Number((await db.query(sql, p).catch(() => ({ rows: [{ n: 0 }] }))).rows[0]?.n ?? 0);
export async function tableroCientifico(db: Db) {
  const naturalezas = (await db.query(`SELECT naturaleza, count(*)::int AS n FROM acd_hipotesis GROUP BY 1 ORDER BY 1`)).rows;
  const replicadas = await n(db, `SELECT count(*)::int AS n FROM (SELECT m.hipotesis_id FROM acd_experimentos e JOIN acd_modelos m ON m.id = e.modelo_id WHERE e.estado = 'ok' AND e.veredicto = 'a_favor' GROUP BY 1 HAVING count(DISTINCT e.sha256_salida) >= 2) x`);
  const lineas = (await db.query(`SELECT l.codigo, l.titulo, (SELECT count(*) FROM acd_preguntas p WHERE p.area = l.area)::int AS preguntas, (SELECT count(*) FROM acd_hipotesis h WHERE h.linea = l.codigo)::int AS hipotesis FROM sol_lineas l ORDER BY l.codigo`).catch(() => ({ rows: [] as any[] }))).rows;
  return {
    tablero: 'Progreso científico (Misión A — SOL/ACD)',
    preguntas_investigadas: { total: await n(db, `SELECT count(*)::int AS n FROM acd_preguntas`), abiertas: await n(db, `SELECT count(*)::int AS n FROM acd_preguntas WHERE estado = 'abierta'`), en_estudio: await n(db, `SELECT count(*)::int AS n FROM acd_preguntas WHERE estado = 'en_estudio'`), respondidas: await n(db, `SELECT count(*)::int AS n FROM acd_preguntas WHERE estado = 'respondida'`) },
    hipotesis_formuladas: { total: await n(db, `SELECT count(*)::int AS n FROM acd_hipotesis`), por_naturaleza: naturalezas.map((x) => ({ naturaleza: NOMBRE_NATURALEZA[x.naturaleza] ?? x.naturaleza, n: x.n })) },
    modelos_matematicos: await n(db, `SELECT count(*)::int AS n FROM acd_modelos`),
    experimentos_ejecutados: { total: await n(db, `SELECT count(*)::int AS n FROM acd_experimentos WHERE estado <> 'ejecutando'`), a_favor: await n(db, `SELECT count(*)::int AS n FROM acd_experimentos WHERE veredicto = 'a_favor'`), en_contra: await n(db, `SELECT count(*)::int AS n FROM acd_experimentos WHERE veredicto = 'en_contra'`), no_concluyentes: await n(db, `SELECT count(*)::int AS n FROM acd_experimentos WHERE veredicto = 'no_concluyente'`), con_datos_observados: await n(db, `SELECT count(*)::int AS n FROM acd_experimentos WHERE datos IN ('observado','mixto')`) },
    resultados_replicados: replicadas,
    descubrimientos_verificados_independientemente: await n(db, `SELECT count(*)::int AS n FROM acd_hipotesis WHERE naturaleza = 'descubrimiento_verificado'`),
    lineas_mision_a: lineas,
    biblioteca: { fuentes: await n(db, `SELECT count(*)::int AS n FROM sol_fuentes`), afirmaciones: await n(db, `SELECT count(*)::int AS n FROM sol_afirmaciones`), tradicion_hermetica_nivel_H: await n(db, `SELECT count(*)::int AS n FROM sol_afirmaciones WHERE nivel = 'H'`) },
    requisitos_sol_verificados: await n(db, `SELECT count(*)::int AS n FROM sol_requisitos WHERE estado = 'VERIFIED'`),
    aplicaciones_exploradas_mision_c: await n(db, `SELECT count(*)::int AS n FROM conocimiento_aplicaciones`),
    nota: 'El éxito científico no depende de que haya aplicación comercial. Ninguna cifra de este tablero es económica.',
  };
}
export async function tableroEconomico(db: Db) {
  const real = await beneficioReal(db, 30);
  return {
    tablero: 'Progreso económico (Misión B — KRATOS/KSIE)',
    oportunidades_evaluadas: { total: await n(db, `SELECT count(*)::int AS n FROM ksie_oportunidades`), con_evaluacion: await n(db, `SELECT count(*)::int AS n FROM ksie_oportunidades WHERE evaluacion <> '{}'::jsonb`), descartadas: await n(db, `SELECT count(*)::int AS n FROM ksie_oportunidades WHERE estado = 'descartada'`), en_ejecucion: await n(db, `SELECT count(*)::int AS n FROM ksie_oportunidades WHERE estado = 'ejecutando'`), no_digitales: await n(db, `SELECT count(*)::int AS n FROM ksie_oportunidades WHERE tipo NOT IN ('software','producto_digital','suscripcion','contenido')`) },
    demanda_validada: { experimentos_con_exito_de_pago: await n(db, `SELECT count(*)::int AS n FROM experiments WHERE status = 'exito' AND (resultados->>'cuenta')::boolean`), respuestas_de_pago_observadas: await n(db, `SELECT count(*)::int AS n FROM ksie_respuestas WHERE pregunta_id IN ('Q015','Q020') AND etiqueta IN ('OBSERVED','INDEPENDENTLY_VERIFIED')`) },
    costes_30d_usd: real.gasto_registrado, ingresos_30d_usd: real.ingresos_observados, flujo_caja_30d_usd: real.beneficio_neto_observado,
    beneficio_neto_verificado_30d_usd: real.registros_ingresos ? real.beneficio_neto_observado : 0,
    avance_hito: real.avance_hito,
    nota: 'Solo cuenta beneficio neto verificado. Ninguna cifra de este tablero es científica.',
  };
}

export const MISIONES_TOOL = {
  description: 'Misiones de KRATOS (adenda del propietario): A) SOL/ACD investiga la naturaleza aunque no sea rentable; B) KSIE busca beneficio neto; C) traducción opcional del conocimiento a aplicaciones. '
    + 'tablero_cientifico | tablero_economico (siempre separados; nunca una puntuación combinada) | lineas (las 8 líneas de la Misión A y su cobertura) | clasificar (hipotesis_id, naturaleza ensenanza_historica|interpretacion_filosofica|hipotesis_especulativa|hipotesis_comprobable|hallazgo_computacional|hallazgo_experimental|hallazgo_replicado, motivo, linea A1–A8) | '
    + 'traducir (hipotesis_id o afirmacion_id, sector, descripcion, oportunidad{nombre, tipo} opcional): nunca presenta como demostrado lo que no lo está.',
  input_schema: { type: 'object', properties: { accion: { type: 'string', enum: ['tablero_cientifico', 'tablero_economico', 'lineas', 'clasificar', 'traducir'] }, hipotesis_id: { type: 'number' }, afirmacion_id: { type: 'number' }, naturaleza: { type: 'string' }, motivo: { type: 'string' },
    linea: { type: 'string' }, sector: { type: 'string' }, descripcion: { type: 'string' }, oportunidad: { type: 'object' } }, required: ['accion'] },
};
export async function herramientaMisiones(db: Db, i: any, actor: string) {
  if (i.accion === 'tablero_cientifico') return await tableroCientifico(db);
  if (i.accion === 'tablero_economico') return await tableroEconomico(db);
  if (i.accion === 'lineas') return { lineas: (await tableroCientifico(db)).lineas_mision_a, menos_estudiada: await lineaMenosEstudiada(db) };
  if (i.accion === 'clasificar') return await clasificar(db, Number(i.hipotesis_id), String(i.naturaleza), String(i.motivo ?? ''), actor, i.linea);
  if (i.accion === 'traducir') return await traducir(db, i, actor);
  return { error: 'Acción no válida' };
}
