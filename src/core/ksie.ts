import fs from 'node:fs';
import path from 'node:path';
import type { Db } from '../db.ts';
import { ROOT } from '../config.ts';
import { audit } from './state.ts';
import { requestApproval } from './approvals.ts';
import { reservarExperimento, cerrarGastoExperimento } from './presupuesto-pruebas.ts';
import { construirAutomodelo } from './automodelo.ts';
import { registrarDecision } from './metacognicion.ts';
import { buscarMemoria, recordar } from './autobiografia.ts';
import { activar, proponer } from './espacio.ts';
import { observar, predecir } from './prediccion.ts';
import { enrutar } from './ksie-herramientas.ts';

// KSIE TAREAS 03–08 — motor de inteligencia estratégica. Es una capacidad coordinada, no un agente: usa los agentes existentes y los módulos
// cognitivos (C01 capacidades, C02 decisiones calibradas, C03 memoria, C04 un objetivo activo, C05 predicciones). Reglas que el código impone:
// sin evidencia una pregunta queda sin resolver; ingresos ≠ beneficio neto ≠ caja; clics/likes/vistas/halagos no son compras; una idea del
// propietario es hipótesis salvo orden explícita; la repetición no es evidencia; nada externo, de pago o irreversible sin autorización.

export const ETIQUETAS = ['HYPOTHESIS', 'ESTIMATE', 'OBSERVED', 'INDEPENDENTLY_VERIFIED'] as const;
export const META_NETO_USD = 10_000;
export const TIPOS = ['software', 'producto_fisico', 'fabricacion', 'agricultura', 'automocion', 'servicio_local', 'servicio_industrial', 'mejora_procesos', 'comercializacion_cientifica', 'producto_digital', 'suscripcion', 'contenido', 'hibrido'];
const DIGITALES = new Set(['software', 'producto_digital', 'suscripcion', 'contenido']);
const norm = (s: any) => String(s ?? '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
const r2 = (x: number) => Math.round(x * 100) / 100;
const sig = (x: number) => { if (!Number.isFinite(x) || x === 0) return x; const p = Math.pow(10, Math.floor(Math.log10(Math.abs(x))) - 1); return Math.round(x / p) * p; };  // 2 cifras significativas: sin falsa precisión

// ---------- TAREA 03: marco de 100 preguntas ----------
export async function sembrarPreguntas(db: Db) {
  const j = JSON.parse(fs.readFileSync(path.join(ROOT, 'docs', 'kratos-strategic-intelligence', 'questions.json'), 'utf8'));
  for (const q of j.preguntas)
    await db.query(`INSERT INTO ksie_preguntas (id, numero, categoria, categoria_nombre, texto, relevancia, evidencia_necesaria, operaciones, capacidades, critica_nivel1) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
       ON CONFLICT (id) DO UPDATE SET texto = EXCLUDED.texto, relevancia = EXCLUDED.relevancia, evidencia_necesaria = EXCLUDED.evidencia_necesaria, operaciones = EXCLUDED.operaciones, capacidades = EXCLUDED.capacidades, critica_nivel1 = EXCLUDED.critica_nivel1`,
      [q.id, q.numero, q.categoria, q.categoria_nombre, q.texto, q.relevancia, q.evidencia_necesaria, q.operaciones_investigacion, q.capacidades_herramienta, q.critica_nivel1]);
  return j.preguntas.length as number;
}

// Afirmaciones sin respaldo: números, porcentajes o absolutos sin fuente; certezas que la evidencia no puede dar
const ABSOLUTOS = /\b(seguro que|garantizad[oa]s?|sin duda|todo el mundo|nadie|siempre|nunca falla|100 ?%|imposible que falle|exito asegurado)\b/;
export function afirmacionesSinRespaldo(texto: string, fuente?: string | null) {
  const t = norm(texto), out: string[] = [];
  if (ABSOLUTOS.test(t)) out.push('Contiene un absoluto o una certeza que ninguna evidencia de mercado puede garantizar');
  const fuenteDebil = !String(fuente ?? '').trim() || /opini|intuic|\bcreo\b|charla|sensaci|experiencia propia/.test(norm(fuente));
  if (/\d/.test(t) && fuenteDebil) out.push('Da cifras sin una fuente comprobable');
  if (/\b(segun|estudios? (dicen|muestran)|se sabe que|los expertos)\b/.test(t) && !/https?:\/\/|doi|sol_fuentes|metrics|experiments|tarea|#\d+/.test(norm(fuente))) out.push('Atribuye a fuentes que no cita');
  if (/\b(les encanta|lo quieren|lo comprarian?|quieren pagar|pagaria[n]?)\b/.test(t) && !/(compra|pago|preventa|deposito|venta)/.test(norm(fuente))) out.push('Afirma deseo o intención de compra sin evidencia de compra');
  return out;
}

export async function responder(db: Db, i: { oportunidad_id: number; pregunta_id: string; respuesta: string; evidencia: string; fuente: string; etiqueta: string; confianza: number; supuestos?: string[]; seguimiento?: string[]; verificado_por?: string }, actor: string) {
  const op = await oportunidad(db, i.oportunidad_id);
  const q = (await db.query(`SELECT * FROM ksie_preguntas WHERE id = $1`, [i.pregunta_id])).rows[0];
  if (!q) throw new Error(`No existe la pregunta ${i.pregunta_id}`);
  if (!String(i.evidencia ?? '').trim() || !String(i.fuente ?? '').trim()) throw new Error(`Sin evidencia y fuente la pregunta ${i.pregunta_id} queda SIN RESOLVER (no se inventan respuestas)`);
  if (!ETIQUETAS.includes(i.etiqueta as any)) throw new Error(`etiqueta: ${ETIQUETAS.join(' | ')}`);
  if (i.etiqueta === 'OBSERVED' && !/https?:\/\/|metrics|experiments|tarea|sol_fuentes|#\d+|doi/i.test(i.fuente)) throw new Error('OBSERVED exige una fuente comprobable (URL, DOI, registro interno con id)');
  if (i.etiqueta === 'INDEPENDENTLY_VERIFIED' && (!i.verificado_por || i.verificado_por === actor)) throw new Error('INDEPENDENTLY_VERIFIED exige un verificador distinto de quien responde');
  const alertas = afirmacionesSinRespaldo(`${i.respuesta} ${i.evidencia}`, i.fuente);
  const conf = Math.max(0, Math.min(1, Number(i.confianza)));
  const etiqueta = alertas.length && i.etiqueta !== 'HYPOTHESIS' ? 'HYPOTHESIS' : i.etiqueta;   // con afirmaciones sin respaldo baja a hipótesis
  const r = (await db.query(`INSERT INTO ksie_respuestas (oportunidad_id, pregunta_id, respuesta, evidencia, fuente, etiqueta, confianza, supuestos, seguimiento, actor, verificado_por, alertas) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING id`,
    [op.id, q.id, i.respuesta, i.evidencia, i.fuente, etiqueta, alertas.length ? Math.min(conf, 0.3) : conf, i.supuestos ?? [], i.seguimiento ?? [], actor, i.verificado_por ?? null, JSON.stringify(alertas)])).rows[0];
  await db.query(`UPDATE ksie_oportunidades SET updated_at = now(), estado = CASE WHEN estado = 'candidata' THEN 'investigando' ELSE estado END WHERE id = $1`, [op.id]);
  return { id: r.id, pregunta: q.id, etiqueta, rebajada: etiqueta !== i.etiqueta, alertas };
}

// ---------- TAREA 04: selección adaptativa ----------
export function profundidad(o: { incertidumbre: number; inversion_usd: number; riesgo: number; irreversibilidad: number }, ejecutar = false) {
  const inv = Number(o.inversion_usd), inc = Number(o.incertidumbre), rie = Number(o.riesgo), irr = Number(o.irreversibilidad);
  if (ejecutar || inv > 2000 || irr >= 0.7 || rie >= 0.7) return { nivel: 3, motivo: ejecutar ? 'revisión de ejecución' : `inversión ${inv} $ / riesgo ${rie} / irreversibilidad ${irr}: revisión completa con crítica independiente` };
  if (inv > 200 || rie >= 0.4 || irr >= 0.4 || inc >= 0.6) return { nivel: 2, motivo: `incertidumbre ${inc} o inversión ${inv} $: investigación estructurada` };
  return { nivel: 1, motivo: 'barato, reversible y de bajo riesgo: cribado con las 10 preguntas críticas' };
}
const PRIORIDAD_CAT: Record<string, string[]> = {   // categorías que pesan más según el tipo de oportunidad (nivel 2)
  fisico: ['H', 'G', 'B', 'C', 'F', 'I', 'A', 'D', 'E', 'J'], digital: ['C', 'F', 'B', 'D', 'G', 'A', 'E', 'I', 'H', 'J'], servicio: ['A', 'F', 'G', 'H', 'B', 'C', 'E', 'D', 'I', 'J'],
};
export async function preguntasPara(db: Db, oportunidad_id: number, nivelForzado?: number) {
  const o = await oportunidad(db, oportunidad_id);
  const p = profundidad(o, o.estado === 'ejecutando');
  const nivel = Math.max(nivelForzado ?? 0, p.nivel);
  const todas = (await db.query(`SELECT * FROM ksie_preguntas ORDER BY numero`)).rows;
  const resp = (await db.query(`SELECT DISTINCT ON (pregunta_id) pregunta_id, etiqueta, confianza FROM ksie_respuestas WHERE oportunidad_id = $1 ORDER BY pregunta_id, id DESC`, [o.id])).rows;
  const hecha = new Map(resp.map((r) => [r.pregunta_id, r]));
  let sel = todas.filter((q) => q.critica_nivel1);
  if (nivel >= 2) {
    const orden = PRIORIDAD_CAT[DIGITALES.has(o.tipo) ? 'digital' : /servicio|mejora/.test(o.tipo) ? 'servicio' : 'fisico'];
    const resto = todas.filter((q) => !q.critica_nivel1).sort((a, b) => orden.indexOf(a.categoria) - orden.indexOf(b.categoria) || a.numero - b.numero);
    const extra: any[] = []; const porCat: Record<string, number> = {};
    for (const q of resto) { if (extra.length >= 40) break; const k = porCat[q.categoria] ?? 0; const cupo = orden.indexOf(q.categoria) < 5 ? 6 : 3; if (k < cupo) { extra.push(q); porCat[q.categoria] = k + 1; } }
    sel = [...sel, ...extra];
  }
  if (nivel >= 3) sel = todas;
  const pendientes = sel.filter((q) => !hecha.has(q.id));
  return { oportunidad: o.id, nivel, motivo: p.motivo, total: sel.length, respondidas: sel.length - pendientes.length,
    sin_resolver: pendientes.map((q) => ({ id: q.id, critica: q.critica_nivel1, categoria: q.categoria, texto: q.texto, evidencia_necesaria: q.evidencia_necesaria, operaciones: q.operaciones })),
    requiere_critica_independiente: nivel >= 3, debiles: resp.filter((r) => r.etiqueta === 'HYPOTHESIS' || Number(r.confianza) < 0.4).map((r) => r.pregunta_id) };
}

// ---------- TAREA 05: oportunidades ----------
async function oportunidad(db: Db, id: number) { const o = (await db.query(`SELECT * FROM ksie_oportunidades WHERE id = $1`, [Number(id)])).rows[0]; if (!o) throw new Error(`No existe la oportunidad ${id}`); return o; }
export async function crearOportunidad(db: Db, i: any, actor: string) {
  if (!TIPOS.includes(i.tipo)) throw new Error(`tipo: ${TIPOS.join(', ')}`);
  for (const k of ['nombre', 'descripcion']) if (!String(i[k] ?? '').trim()) throw new Error(`Falta ${k}`);
  const origen = i.origen ?? 'kratos';
  const ya = (await db.query(`SELECT id, estado, motivo_abandono FROM ksie_oportunidades WHERE lower(nombre) = lower($1)`, [i.nombre])).rows[0];
  if (ya) return { id: ya.id, existente: true, estado: ya.estado, nota: ya.estado === 'descartada' ? `Ya se descartó: ${ya.motivo_abandono}. Solo se reabre con evidencia nueva (reabrir).` : 'Ya existe en la cartera' };
  const r = (await db.query(`INSERT INTO ksie_oportunidades (nombre, tipo, sector, descripcion, origen, incertidumbre, inversion_usd, riesgo, irreversibilidad, creado_por) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING id`,
    [i.nombre, i.tipo, i.sector ?? null, i.descripcion, origen, i.incertidumbre ?? 0.8, i.inversion_usd ?? 0, i.riesgo ?? 0.5, i.irreversibilidad ?? 0.2, actor])).rows[0];
  await audit(db, actor, 'ksie.oportunidad', { id: r.id, tipo: i.tipo, origen });
  return { id: r.id, existente: false, estado: 'candidata', nota: origen === 'propietario_sugerencia' ? 'Idea del propietario: se trata como HIPÓTESIS hasta que la evidencia la respalde (no es una orden de ejecutar)' : undefined };
}
type Rango = { min: number; base: number; max: number };
// Evaluación con rangos (sin falsa precisión): beneficio neto mensual en régimen, capital, meses al primer ingreso y factores 0–1
export async function evaluar(db: Db, id: number, e: { beneficio_neto_mensual: Rango; capital_usd: Rango; meses_primer_ingreso: Rango; evidencia_demanda: number; dificultad: number; competencia: number; defensibilidad: number; distribucion: number; riesgo_baja: number; encaje: number }, etiqueta: string, actor: string) {
  await oportunidad(db, id);
  if (!ETIQUETAS.includes(etiqueta as any)) throw new Error(`etiqueta: ${ETIQUETAS.join(' | ')}`);
  for (const k of ['beneficio_neto_mensual', 'capital_usd', 'meses_primer_ingreso'] as const) { const r = e[k]; if (!r || !(r.min <= r.base && r.base <= r.max)) throw new Error(`${k} debe ser un rango {min ≤ base ≤ max}`); }
  for (const k of ['evidencia_demanda', 'dificultad', 'competencia', 'defensibilidad', 'distribucion', 'riesgo_baja', 'encaje'] as const) if (!(e[k] >= 0 && e[k] <= 1)) throw new Error(`${k} va de 0 a 1`);
  await db.query(`UPDATE ksie_oportunidades SET evaluacion = $2, etiqueta_evaluacion = $3, inversion_usd = $4, updated_at = now() WHERE id = $1`, [id, JSON.stringify(e), etiqueta, e.capital_usd.base]);
  await audit(db, actor, 'ksie.evaluacion', { id, etiqueta });
  return { id, etiqueta };
}
export function valorEsperado(e: any) {
  const bn = e.beneficio_neto_mensual, pert = (bn.min + 4 * bn.base + bn.max) / 6;
  const prob = Math.max(0.02, Math.min(0.9, 0.35 * e.evidencia_demanda + 0.2 * e.encaje + 0.15 * (1 - e.dificultad) + 0.15 * e.distribucion + 0.15 * (1 - e.competencia * (1 - e.defensibilidad))));
  const ve = pert * prob, cap = Math.max(1, e.capital_usd.base);
  return { beneficio_neto_mensual_rango: [sig(bn.min), sig(bn.base), sig(bn.max)], probabilidad_exito: r2(prob), valor_esperado_mensual: sig(ve), retorno_por_dolar_anual: r2((ve * 12) / cap),
    meses_primer_ingreso: [e.meses_primer_ingreso.min, e.meses_primer_ingreso.max], riesgo_baja: e.riesgo_baja, contribucion_hito: `${Math.round((Math.max(0, bn.base) / META_NETO_USD) * 100)} % del hito de ${META_NETO_USD} $/mes de beneficio neto en el escenario base`,
    incertidumbre_rango: r2((bn.max - bn.min) / Math.max(1, Math.abs(bn.base))) };
}
export async function comparar(db: Db, ids?: number[]) {
  const ops = (await db.query(`SELECT * FROM ksie_oportunidades WHERE estado <> 'descartada' ${ids?.length ? 'AND id = ANY($1)' : ''} ORDER BY id`, ids?.length ? [ids] : [])).rows;
  const filas = ops.map((o) => ({ id: o.id, nombre: o.nombre, tipo: o.tipo, digital: DIGITALES.has(o.tipo), estado: o.estado, etiqueta: o.etiqueta_evaluacion, ...(Object.keys(o.evaluacion ?? {}).length ? valorEsperado(o.evaluacion) : { sin_evaluar: true }) }));
  const evaluadas = filas.filter((f: any) => !f.sin_evaluar).sort((a: any, b: any) => b.valor_esperado_mensual - a.valor_esperado_mensual);
  return { ranking: evaluadas, sin_evaluar: filas.filter((f: any) => f.sin_evaluar).map((f) => ({ id: f.id, nombre: f.nombre, tipo: f.tipo })),
    diversidad: { digitales: filas.filter((f) => f.digital).length, no_digitales: filas.filter((f) => !f.digital).length },
    aviso: 'Valores esperados con rangos y 2 cifras significativas; las etiquetas indican si son hipótesis, estimaciones u observaciones. Solo una oportunidad se ejecuta a la vez.' };
}

// ---------- TAREA 06: anti-fijación y crítica independiente ----------
const MODELOS: Record<string, RegExp> = { app: /\bapps?\b|aplicaci[oó]n/, saas: /\bsaas\b|suscripci[oó]n|software/, web: /\bweb\b|landing|p[aá]gina/, youtube: /youtube|canal|shorts|v[ií]deos?/, nfc: /\bnfc\b/ };
export async function detectarFijacion(db: Db) {
  const ops = (await db.query(`SELECT nombre, tipo, descripcion FROM ksie_oportunidades WHERE estado <> 'descartada'`)).rows;
  const recs = (await db.query(`SELECT o.tipo, o.nombre, o.descripcion FROM ksie_recomendaciones r JOIN ksie_oportunidades o ON o.id = r.oportunidad_id WHERE r.decision IN ('EXPERIMENT','EXECUTE') ORDER BY r.id DESC LIMIT 20`)).rows;
  const productos = (await db.query(`SELECT name, coalesce(revenue_model, '') AS rm, array_to_string(coalesce(platforms, '{}'), ' ') AS pl FROM products WHERE NOT is_demo`)).rows;
  const plan = (await db.query(`SELECT content FROM strategy_plan ORDER BY id DESC LIMIT 1`)).rows[0]?.content ?? '';
  const textos = [...ops.map((o) => `${o.nombre} ${o.descripcion}`), ...recs.map((r) => `${r.nombre} ${r.descripcion}`), ...productos.map((p) => `${p.name} ${p.rm} ${/ios|android/i.test(p.pl) ? 'app' : ''}`)].map(norm);
  const conteo = Object.fromEntries(Object.entries(MODELOS).map(([k, re]) => [k, textos.filter((t) => re.test(t)).length]));
  const total = Math.max(1, textos.length);
  const digitales = [...ops, ...recs].filter((o) => DIGITALES.has(o.tipo)).length, n = ops.length + recs.length;
  const alertas: string[] = [];
  for (const [k, c] of Object.entries(conteo)) if (c >= 3 && c / total >= 0.5) alertas.push(`«${k}» aparece en ${c} de ${total} propuestas, productos o recomendaciones: la repetición no es evidencia`);
  if (n >= 3 && digitales / n >= 0.75) alertas.push(`${digitales} de ${n} oportunidades/recomendaciones son digitales (software, contenido, suscripciones): faltan alternativas físicas, locales o de servicios`);
  const planModelos = Object.entries(MODELOS).filter(([, re]) => re.test(norm(plan))).map(([k]) => k);
  const ksieNoDigitales = ops.filter((o) => !DIGITALES.has(o.tipo)).length;
  if (productos.length >= 3 && !ksieNoDigitales) alertas.push(`Los ${productos.length} productos registrados son apps y no hay ninguna alternativa física, local o de servicios evaluada en la cartera`);
  return { fijacion: alertas.length > 0, alertas, conteo, total_textos: total, digitales, plan_vigente_menciona: planModelos };
}
// Lo que hay que tener ANTES de asignar recursos (experimentar o ejecutar)
export async function revisionPrevia(db: Db, id: number) {
  const o = await oportunidad(db, id);
  const otras = (await db.query(`SELECT id, nombre, tipo, evaluacion FROM ksie_oportunidades WHERE id <> $1 AND estado <> 'descartada' AND evaluacion <> '{}'::jsonb`, [id])).rows;
  const alternativas = otras.map((x) => ({ id: x.id, nombre: x.nombre, tipo: x.tipo, ve: valorEsperado(x.evaluacion).valor_esperado_mensual })).sort((a, b) => b.ve - a.ve);
  const resp = (await db.query(`SELECT DISTINCT ON (r.pregunta_id) r.pregunta_id, r.respuesta, r.etiqueta, r.confianza, q.texto, q.categoria FROM ksie_respuestas r JOIN ksie_preguntas q ON q.id = r.pregunta_id WHERE r.oportunidad_id = $1 ORDER BY r.pregunta_id, r.id DESC`, [id])).rows;
  const enContra = resp.filter((r) => r.etiqueta !== 'HYPOTHESIS' && /no hay|insuficiente|ninguna|satura|ya resuelto|gratis|baja|negativ|caro|no pag/.test(norm(r.respuesta)));
  const debiles = resp.filter((r) => r.etiqueta === 'HYPOTHESIS' || Number(r.confianza) < 0.4);
  const fallidos = await buscarMemoria(db, { texto: `${o.nombre} ${o.tipo}`, resultado: 'fallo', limite: 5 }).catch(() => [] as any[]);
  const exps = (await db.query(`SELECT id, hypothesis, status, decision FROM experiments WHERE oportunidad_id = $1 AND status IN ('fracaso','no_concluyente')`, [id])).rows;
  const miVe = Object.keys(o.evaluacion ?? {}).length ? valorEsperado(o.evaluacion).valor_esperado_mensual : null;
  const criticas = (await db.query(`SELECT count(*)::int AS n FROM ksie_preguntas WHERE critica_nivel1`)).rows[0].n;
  const criticasResp = resp.filter((r) => ['Q001', 'Q002', 'Q010', 'Q011', 'Q020', 'Q030', 'Q061', 'Q064', 'Q083', 'Q093'].includes(r.pregunta_id)).length;
  const r = {
    alternativas_creibles: alternativas.slice(0, 3),
    mejor_argumento_en_contra: enContra[0] ? `${enContra[0].texto} → «${String(enContra[0].respuesta).slice(0, 200)}»` : debiles[0] ? `Respuesta débil en «${debiles[0].texto}» (${debiles[0].etiqueta})` : criticasResp < criticas ? `Faltan ${criticas - criticasResp} de ${criticas} preguntas críticas sin evidencia` : null,
    coste_de_oportunidad: alternativas[0] && miVe != null ? `La mejor alternativa (${alternativas[0].nombre}) tiene un valor esperado de ${alternativas[0].ve} $/mes frente a ${miVe} $/mes` : null,
    experimentos_fallidos_previos: [...exps.map((e) => `experimento #${e.id}: ${e.hypothesis} (${e.status})`), ...fallidos.map((f: any) => `${f.id}: ${String(f.leccion ?? f.detalle ?? '').slice(0, 120)}`)],
    evidencia_que_invalidaria: resp.find((r) => r.pregunta_id === 'Q093')?.respuesta ?? null,
    preguntas_criticas_respondidas: `${criticasResp}/${criticas}`,
  };
  const faltan = [] as string[];
  if (r.alternativas_creibles.length < 2) faltan.push('al menos 2 alternativas creíbles evaluadas');
  if (!r.mejor_argumento_en_contra) faltan.push('el mejor argumento en contra');
  if (!r.coste_de_oportunidad) faltan.push('el coste de oportunidad (evaluación propia y de alternativas)');
  if (!r.evidencia_que_invalidaria) faltan.push('qué evidencia invalidaría la propuesta (Q093)');
  return { ...r, completa: faltan.length === 0, faltan };
}
// Crítica independiente de una idea (también del propietario): débil o no, con evidencia, alternativas y el experimento más barato
export async function criticar(db: Db, id: number) {
  const o = await oportunidad(db, id);
  const pr = await revisionPrevia(db, id), q = await preguntasPara(db, id, 1);
  const ve = Object.keys(o.evaluacion ?? {}).length ? valorEsperado(o.evaluacion) : null;
  const debil = !ve || q.sin_resolver.filter((x) => x.critica).length > 3 || (ve && ve.probabilidad_exito < 0.3) || !!pr.mejor_argumento_en_contra?.includes('→');
  const exp = q.sin_resolver.find((x) => ['Q010', 'Q020', 'Q011'].includes(x.id));
  return { oportunidad: o.nombre, origen: o.origen, es_orden_del_propietario: o.origen === 'propietario_orden',
    veredicto: debil ? 'Esta idea es DÉBIL con la evidencia actual' : 'La idea se sostiene con la evidencia actual (provisional)',
    evidencia: { valor_esperado: ve, preguntas_criticas_sin_resolver: q.sin_resolver.filter((x) => ['Q001', 'Q002', 'Q010', 'Q011', 'Q020', 'Q030', 'Q061', 'Q064', 'Q083', 'Q093'].includes(x.id)).map((x) => x.id), argumento_en_contra: pr.mejor_argumento_en_contra },
    alternativas: pr.alternativas_creibles, experimento_mas_barato_que_cambiaria_la_conclusion: exp ? `Responder ${exp.id} («${exp.texto}») con ${exp.evidencia_necesaria}` : 'Una preventa veraz o un presupuesto de proveedor que confirme el margen',
    nota: o.origen === 'propietario_orden' ? 'Es una orden del propietario: se ejecuta, pero KRATOS deja constancia de su desacuerdo respetuoso si la evidencia es débil.' : o.origen === 'propietario_sugerencia' ? 'Es una sugerencia del propietario: se trata como hipótesis.' : undefined };
}

// ---------- TAREA 07: experimentos y evaluación financiera ----------
export const TIPOS_EXPERIMENTO: Record<string, { pago: boolean; externo: boolean }> = {
  entrevistas: { pago: false, externo: true }, pagina_interes: { pago: false, externo: true }, lista_espera: { pago: false, externo: true }, demo_prototipo: { pago: false, externo: true },
  anuncio_pequeno: { pago: true, externo: true }, preventa: { pago: false, externo: true }, presupuestos_proveedor: { pago: false, externo: true }, simulacion_economia: { pago: false, externo: false },
};
const EVIDENCIA_DEBIL = new Set(['clic', 'like', 'vista', 'halago', 'comentario', 'seguidor']);
const EVIDENCIA_PAGO = new Set(['compra', 'preventa_pagada', 'deposito', 'contrato']);
export async function disenarExperimento(db: Db, i: { oportunidad_id: number; tipo: string; hipotesis: string; metrica: string; linea_base: string; presupuesto_usd: number; resultado_previsto: number; incertidumbre?: number; umbral_exito: number; umbral_fracaso: number; dias: number }, actor: string) {
  const o = await oportunidad(db, i.oportunidad_id);
  const t = TIPOS_EXPERIMENTO[i.tipo]; if (!t) throw new Error(`tipo de experimento: ${Object.keys(TIPOS_EXPERIMENTO).join(', ')}`);
  for (const k of ['hipotesis', 'metrica', 'linea_base'] as const) if (!String(i[k] ?? '').trim()) throw new Error(`Falta ${k}`);
  if (!(Number.isFinite(i.umbral_exito) && Number.isFinite(i.umbral_fracaso)) || i.umbral_fracaso >= i.umbral_exito) throw new Error('Umbrales falsables: umbral_fracaso < umbral_exito, decididos ANTES de ver resultados');
  const pago = t.pago || Number(i.presupuesto_usd) > 0;
  const negocio = (await db.query(`SELECT id FROM businesses WHERE NOT is_demo ORDER BY (id = 3) DESC, id LIMIT 1`)).rows[0]?.id ?? 1;
  const e = (await db.query(`INSERT INTO experiments (business_id, hypothesis, metric, budget_cents, window_days, stop_conditions, uncertainty, status, oportunidad_id, tipo, linea_base, resultado_previsto, umbral_exito, umbral_fracaso)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) RETURNING id`,
    [negocio, i.hipotesis, i.metrica, Math.round(Number(i.presupuesto_usd || 0) * 100), Math.max(1, Math.round(i.dias)), `éxito si ${i.metrica} ≥ ${i.umbral_exito}; corte si ≤ ${i.umbral_fracaso}`, i.incertidumbre ?? 0.5,
      pago || t.externo ? 'esperando_aprobacion' : 'propuesto', o.id, i.tipo, i.linea_base, String(i.resultado_previsto), i.umbral_exito, i.umbral_fracaso])).rows[0];
  // Predicción C05 registrada antes de observar
  const sd = Math.max(Math.abs(i.umbral_exito - i.umbral_fracaso) / 2, 1e-6);
  const p = await predecir(db, { contexto: `ksie:exp:${e.id}`, clave: i.metrica, prior: { media: Number(i.resultado_previsto), varianza: sd ** 2, ruido: sd / 2 }, hipotesis: i.hipotesis, experimento_ref: `experiments#${e.id}` }, actor);
  let aprobacion: any = null, reservado: any = null;
  // Gasto dentro del presupuesto mensual de pruebas que el propietario ya aprobó: se reserva y no se le pregunta otra vez
  if (pago && Number(i.presupuesto_usd) > 0) reservado = await reservarExperimento(db, e.id, Math.round(Number(i.presupuesto_usd) * 100), actor);
  // con el presupuesto mensual ya aprobado por el propietario no se pide otra aprobación: esa asignación es la autorización
  if (reservado?.ok) await db.query(`UPDATE experiments SET status = 'propuesto' WHERE id = $1`, [e.id]);
  else if (pago || t.externo) aprobacion = await requestApproval(db, { businessId: negocio, kind: pago ? 'asignacion_presupuesto' : 'accion_externa', description: `Experimento KSIE #${e.id} (${i.tipo}) para «${o.nombre}»: ${i.hipotesis}`.slice(0, 500),
    scope: { tipo: 'experimento_ksie', experimento: e.id }, maxAmountCents: pago ? Math.round(Number(i.presupuesto_usd || 0) * 100) : null, requestedBy: actor });
  await db.query(`UPDATE experiments SET approval_id = $2, prediccion_id = $3, status = CASE WHEN $4::text IN ('aprobada','ejecutada') THEN 'propuesto' ELSE status END WHERE id = $1`, [e.id, aprobacion?.id ?? null, p.id, aprobacion?.status ?? null]);
  await db.query(`UPDATE ksie_oportunidades SET estado = CASE WHEN estado IN ('candidata','investigando') THEN 'experimentando' ELSE estado END, updated_at = now() WHERE id = $1`, [o.id]);
  return { experimento_id: e.id, prediccion_id: p.id, requiere_autorizacion: (pago && !reservado?.ok) || t.externo, presupuesto_pruebas: reservado, aprobacion: aprobacion ? { id: aprobacion.id, estado: aprobacion.status, motivo: pago ? 'gasto: lo decide el propietario' : 'acción externa' } : null,
    nota: pago && aprobacion?.status === 'pendiente' ? 'No se ejecuta hasta que el propietario lo apruebe en el panel' : undefined };
}
export async function resultadoExperimento(db: Db, id: number, i: { valor: number; tipo_evidencia: string; evidencia: string; fuente: string; gasto_real_usd?: number }, actor: string) {
  const e = (await db.query(`SELECT e.*, a.status AS aprobacion FROM experiments e LEFT JOIN approvals a ON a.id = e.approval_id WHERE e.id = $1`, [id])).rows[0];
  if (!e) throw new Error(`No existe el experimento ${id}`);
  if (e.resultados) throw new Error(`El experimento ${id} ya tiene resultados`);
  if (e.approval_id && !['aprobada', 'ejecutada'].includes(e.aprobacion)) throw new Error(`El experimento ${id} no está autorizado (aprobación ${e.aprobacion}): no hay resultados que registrar`);
  if (!String(i.evidencia ?? '').trim() || !String(i.fuente ?? '').trim()) throw new Error('El resultado necesita evidencia y fuente');
  const debil = EVIDENCIA_DEBIL.has(i.tipo_evidencia), mideCompra = /compra|venta|pago|preventa|cliente|ingreso/.test(norm(e.metric));
  const cuenta = !(debil && mideCompra);
  const v = Number(i.valor);
  const veredicto = !cuenta ? 'no_concluyente' : v >= Number(e.umbral_exito) ? 'exito' : v <= Number(e.umbral_fracaso) ? 'fracaso' : 'no_concluyente';
  const interpretacion = !cuenta ? `«${i.tipo_evidencia}» no es una compra: la métrica «${e.metric}» exige ${[...EVIDENCIA_PAGO].join('/')}` : `${e.metric} = ${v} (éxito ≥ ${e.umbral_exito}, corte ≤ ${e.umbral_fracaso}) → ${veredicto}`;
  const siguiente = veredicto === 'exito' ? 'Pasar a revisión de ejecución (nivel 3, crítica independiente)' : veredicto === 'fracaso' ? 'Descartar o reformular con evidencia nueva; no repetir el mismo experimento' : 'Repetir con evidencia de pago o ampliar la muestra';
  if (e.reserva_clave) await cerrarGastoExperimento(db, id, i.gasto_real_usd != null ? Number(i.gasto_real_usd) * 100 : Number(e.budget_cents ?? 0), actor);
  const o = e.prediccion_id && cuenta ? await observar(db, e.prediccion_id, v, `experiments#${id}: ${i.fuente}`, actor) : null;
  await db.query(`UPDATE experiments SET resultados = $2, status = $3, result = $4, interpretacion = $5, siguiente_decision = $6, decision = $7 WHERE id = $1`,
    [id, JSON.stringify({ valor: v, tipo_evidencia: i.tipo_evidencia, evidencia: i.evidencia, fuente: i.fuente, cuenta }), veredicto, JSON.stringify({ valor: v }), interpretacion, siguiente, veredicto]);
  await recordar(db, { agente: actor.replace(/^agente:/, ''), objetivo: `experimento #${id}: ${e.hypothesis}`, resultado: veredicto === 'exito' ? 'exito' : veredicto === 'fracaso' ? 'fallo' : 'parcial', detalle_resultado: interpretacion,
    leccion: veredicto === 'fracaso' ? `La hipótesis «${e.hypothesis}» no superó su umbral (${interpretacion})` : null, evidencia: `${i.fuente}`, enlaces: [{ tipo: 'experimento', ref: id }, { tipo: 'oportunidad', ref: e.oportunidad_id }], procedencia: 'ksie' }, 'ksie');
  return { experimento_id: id, veredicto, cuenta_como_evidencia: cuenta, interpretacion, siguiente_decision: siguiente, error_prediccion: o?.error ?? null };
}
// Modelo financiero por escenarios: separa ingresos, margen bruto, beneficio neto y caja. Todo lo que entra es un supuesto etiquetado.
export type Supuestos = { precio: number; coste_variable: number; unidades_mes: { pesimista: number; base: number; optimista: number }; costes_fijos_mes: number; cac: number; clientes_nuevos_mes?: { pesimista: number; base: number; optimista: number };
  recurrente?: boolean; retencion_mensual?: number; comisiones_pct?: number; impuestos_pct?: number; capital_inicial: number; dias_cobro?: number; dias_pago?: number; meses_inventario?: number };
export function modeloFinanciero(s: Supuestos) {
  const esc = {} as Record<string, any>;
  for (const k of ['pesimista', 'base', 'optimista'] as const) {
    const u = s.unidades_mes[k], nuevos = s.clientes_nuevos_mes?.[k] ?? u;
    const ingresos = u * s.precio, comisiones = ingresos * (s.comisiones_pct ?? 0), coste_ventas = u * s.coste_variable + comisiones;
    const margen_bruto = ingresos - coste_ventas, captacion = nuevos * s.cac;
    const antes_impuestos = margen_bruto - captacion - s.costes_fijos_mes, impuestos = Math.max(0, antes_impuestos) * (s.impuestos_pct ?? 0.25);
    const beneficio_neto = antes_impuestos - impuestos;
    const circulante = coste_ventas * ((s.meses_inventario ?? 0) + ((s.dias_cobro ?? 0) - (s.dias_pago ?? 0)) / 30);
    const margen_unit = s.precio - s.coste_variable - s.precio * (s.comisiones_pct ?? 0);
    const ltv = s.recurrente ? margen_unit / Math.max(0.01, 1 - (s.retencion_mensual ?? 0)) : margen_unit;
    const equilibrio = margen_unit > 0 ? Math.ceil((s.costes_fijos_mes + captacion) / margen_unit) : null;
    let caja = -s.capital_inicial - Math.max(0, circulante), mesRecupera: number | null = null; const serie: number[] = [];
    for (let m = 1; m <= 12; m++) { caja += beneficio_neto; serie.push(Math.round(caja)); if (mesRecupera == null && caja >= 0) mesRecupera = m; }
    esc[k] = { ingresos: Math.round(ingresos), coste_ventas: Math.round(coste_ventas), margen_bruto: Math.round(margen_bruto), margen_bruto_pct: ingresos ? r2(margen_bruto / ingresos) : null,
      gasto_captacion: Math.round(captacion), costes_fijos: s.costes_fijos_mes, beneficio_antes_impuestos: Math.round(antes_impuestos), impuestos: Math.round(impuestos), beneficio_neto: Math.round(beneficio_neto),
      capital_circulante: Math.round(Math.max(0, circulante)), caja_acumulada_12m: serie, mes_recupera_capital: mesRecupera, ltv: Math.round(ltv), ltv_cac: s.cac > 0 ? r2(ltv / s.cac) : null, unidades_equilibrio: equilibrio,
      avance_hito_neto: `${Math.round((Math.max(0, beneficio_neto) / META_NETO_USD) * 100)} % de ${META_NETO_USD} $/mes` };
  }
  return { escenarios: esc, lectura: 'Ingresos no es beneficio: el hito se mide SOLO con beneficio neto verificado. La caja incluye el capital inicial y el circulante.',
    alertas: [...(esc.base.beneficio_neto <= 0 ? ['El escenario base pierde dinero'] : []), ...(esc.base.ltv_cac != null && esc.base.ltv_cac < 3 ? [`LTV/CAC ${esc.base.ltv_cac} < 3 en el escenario base`] : []), ...(esc.pesimista.mes_recupera_capital == null ? ['En el escenario pesimista no se recupera el capital en 12 meses'] : [])] };
}
export async function guardarModelo(db: Db, oportunidad_id: number | null, s: Supuestos, etiqueta = 'ESTIMATE') {
  const m = modeloFinanciero(s);
  const r = (await db.query(`INSERT INTO ksie_modelos_financieros (oportunidad_id, supuestos, escenarios, etiqueta) VALUES ($1,$2,$3,$4) RETURNING id`, [oportunidad_id, JSON.stringify(s), JSON.stringify(m), etiqueta])).rows[0];
  return { id: r.id, etiqueta, ...m };
}
// Beneficio neto REAL (observado): ingresos registrados con fuente en metrics menos gasto real del libro de presupuesto
export async function beneficioReal(db: Db, dias = 30) {
  const ing = (await db.query(`SELECT coalesce(sum(value), 0)::float AS v, count(*)::int AS n FROM metrics WHERE NOT is_demo AND metric IN ('ingresos', 'ingresos_usd', 'ventas_usd') AND observed_at > now() - make_interval(days => $1)`, [dias])).rows[0];
  const gasto = (await db.query(`SELECT coalesce(sum(amount_cents), 0)::float / 100 AS v FROM budget_movements WHERE kind = 'cargo' AND created_at > now() - make_interval(days => $1)`, [dias])).rows[0];
  const otros = (await db.query(`SELECT coalesce(sum(value), 0)::float AS v FROM metrics WHERE NOT is_demo AND metric IN ('costes_usd', 'gastos_usd') AND observed_at > now() - make_interval(days => $1)`, [dias])).rows[0];
  const neto = ing.v - gasto.v - otros.v;
  return { dias, ingresos_observados: r2(ing.v), registros_ingresos: ing.n, gasto_registrado: r2(gasto.v + otros.v), beneficio_neto_observado: r2(neto), etiqueta: ing.n ? 'OBSERVED' : 'OBSERVED (sin ingresos registrados)',
    avance_hito: `${Math.max(0, Math.round((neto / META_NETO_USD) * 100))} % de ${META_NETO_USD} $/mes` };
}

// ---------- TAREA 08: memoria estratégica, recomendaciones y reaperturas ----------
export async function recomendar(db: Db, id: number, actor: string) {
  const o = await oportunidad(db, id);
  if (o.estado === 'descartada') throw new Error(`«${o.nombre}» está descartada (${o.motivo_abandono}). Para revisarla hace falta evidencia nueva: reabrir`);
  const q1 = await preguntasPara(db, id, 1);
  const criticasPend = q1.sin_resolver.filter((x) => x.critica);
  const exps = (await db.query(`SELECT id, status, resultados FROM experiments WHERE oportunidad_id = $1 ORDER BY id`, [id])).rows;
  const exito = exps.filter((e) => e.status === 'exito' && e.resultados?.cuenta), fracaso = exps.filter((e) => e.status === 'fracaso');
  const ve = Object.keys(o.evaluacion ?? {}).length ? valorEsperado(o.evaluacion) : null;
  const pr = await revisionPrevia(db, id);
  let decision: 'INVESTIGATE' | 'EXPERIMENT' | 'EXECUTE' | 'DISCARD', motivo: string;
  if (fracaso.length && !exito.length) { decision = 'DISCARD'; motivo = `El experimento #${fracaso.at(-1).id} cruzó su umbral de corte`; }
  else if (ve && ve.probabilidad_exito < 0.15 && ve.valor_esperado_mensual < 100) { decision = 'DISCARD'; motivo = `Valor esperado ${ve.valor_esperado_mensual} $/mes con probabilidad ${ve.probabilidad_exito}: no compensa frente a las alternativas`; }
  else if (criticasPend.length > 3 || !ve) { decision = 'INVESTIGATE'; motivo = `${criticasPend.length} de 10 preguntas críticas sin evidencia${ve ? '' : ' y sin evaluación con rangos'}`; }
  else if (!exito.length) { decision = 'EXPERIMENT'; motivo = 'Las preguntas críticas tienen respuesta, pero no hay evidencia de pago: toca el experimento útil más barato'; }
  else {
    const q3 = await preguntasPara(db, id, 3);
    if (!pr.completa || q3.debiles.length > 10) { decision = 'INVESTIGATE'; motivo = `Hay un experimento con éxito, pero la revisión de ejecución no está completa (${pr.faltan.join('; ') || `${q3.debiles.length} respuestas débiles`})`; }
    else { decision = 'EXECUTE'; motivo = `Experimento #${exito.at(-1).id} con evidencia de pago y revisión completa`; }
  }
  if ((decision === 'EXPERIMENT' || decision === 'EXECUTE') && !pr.completa) { motivo += `. Antes de asignar recursos falta: ${pr.faltan.join('; ')}`; if (decision === 'EXECUTE') decision = 'INVESTIGATE'; }
  const fij = await detectarFijacion(db);
  const evidencia = { valor_esperado: ve, preguntas_criticas_sin_resolver: criticasPend.map((x) => x.id), experimentos: exps.map((e) => ({ id: e.id, estado: e.status })), fijacion: fij.alertas, respuestas: (await db.query(`SELECT count(*)::int AS n, max(id) AS ultima FROM ksie_respuestas WHERE oportunidad_id = $1`, [id])).rows[0] };
  // C02: la recomendación es una decisión relevante con confianza calibrada
  const dec = await registrarDecision(db, { categoria: 'ksie:recomendacion', objetivo: `Qué hacer con «${o.nombre}»`, estrategias: [{ nombre: 'INVESTIGATE' }, { nombre: 'EXPERIMENT' }, { nombre: 'EXECUTE' }, { nombre: 'DISCARD' }], elegida: decision,
    evidencia: [{ texto: motivo, fuente: `ksie_oportunidades#${id}`, apoya: true }, ...(pr.mejor_argumento_en_contra ? [{ texto: pr.mejor_argumento_en_contra, fuente: 'revision_previa', apoya: decision === 'DISCARD' || decision === 'INVESTIGATE' }] : [])],
    supuestos: ['las evaluaciones con rangos reflejan el mercado'], incertidumbre: Number(o.incertidumbre), confianza_declarada: decision === 'INVESTIGATE' ? 0.7 : 0.55, resultado_esperado: `la decisión ${decision} acerca al hito de beneficio neto`, critica: decision === 'EXECUTE' }, actor).catch(() => null);
  const previa = (await db.query(`SELECT * FROM ksie_recomendaciones WHERE oportunidad_id = $1 ORDER BY id DESC LIMIT 1`, [id])).rows[0];
  let explicacion: string | null = null;
  if (previa && previa.decision !== decision) {
    const nuevas = (await db.query(`SELECT r.pregunta_id, r.etiqueta, left(r.respuesta, 120) AS respuesta FROM ksie_respuestas r WHERE r.oportunidad_id = $1 AND r.created_at > $2 ORDER BY r.id`, [id, previa.created_at])).rows;
    const expsNuevos = (await db.query(`SELECT id, status FROM experiments WHERE oportunidad_id = $1 AND (created_at > $2 OR resultados IS NOT NULL)`, [id, previa.created_at])).rows;
    explicacion = `Antes ${previa.decision} (${previa.motivo}); ahora ${decision} porque cambió la evidencia: ${nuevas.length} respuesta(s) nueva(s) [${nuevas.map((n) => `${n.pregunta_id} ${n.etiqueta}`).join(', ')}]${expsNuevos.length ? `, experimentos ${expsNuevos.map((e) => `#${e.id} ${e.status}`).join(', ')}` : ''}${!nuevas.length && !expsNuevos.length ? ' (sin evidencia nueva: revisar por qué cambió)' : ''}`;
  }
  const r = (await db.query(`INSERT INTO ksie_recomendaciones (oportunidad_id, decision, motivo, evidencia, nivel, revision_previa, difiere_de, explicacion_cambio, decision_c02, actor) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING id`,
    [id, decision, motivo, JSON.stringify(evidencia), q1.nivel, JSON.stringify(pr), previa && previa.decision !== decision ? previa.id : null, explicacion, dec?.id ?? null, actor])).rows[0];
  if (decision === 'DISCARD') await descartar(db, id, motivo, actor);
  return { recomendacion_id: r.id, oportunidad: o.nombre, decision, motivo, revision_previa: pr, explicacion_cambio: explicacion, fijacion: fij.alertas, decision_c02: dec ? { id: dec.id, estado: dec.estado, confianza_calibrada: dec.confianza_calibrada } : null };
}
export async function descartar(db: Db, id: number, motivo: string, actor: string) {
  const o = await oportunidad(db, id);
  await db.query(`UPDATE ksie_oportunidades SET estado = 'descartada', motivo_abandono = $2, abandonada_at = now(), updated_at = now() WHERE id = $1`, [id, motivo]);
  await recordar(db, { agente: actor.replace(/^agente:/, ''), objetivo: `oportunidad «${o.nombre}» (${o.tipo})`, resultado: 'fallo', detalle_resultado: `descartada: ${motivo}`, leccion: `No reabrir «${o.nombre}» sin evidencia nueva: ${motivo}`,
    enlaces: [{ tipo: 'oportunidad', ref: id }], procedencia: 'ksie' }, 'ksie');
  return { id, estado: 'descartada' };
}
// Reabrir solo con evidencia nueva posterior al abandono
export async function reabrir(db: Db, id: number, actor: string) {
  const o = await oportunidad(db, id);
  if (o.estado !== 'descartada') return { id, reabierta: false, motivo: `No está descartada (${o.estado})` };
  const nuevas = (await db.query(`SELECT count(*)::int AS n FROM ksie_respuestas WHERE oportunidad_id = $1 AND created_at > $2 AND etiqueta IN ('OBSERVED','INDEPENDENTLY_VERIFIED')`, [id, o.abandonada_at])).rows[0].n;
  if (!nuevas) return { id, reabierta: false, motivo: `Se descartó por: ${o.motivo_abandono}. No hay evidencia nueva (OBSERVED o verificada) desde ${new Date(o.abandonada_at).toISOString().slice(0, 10)}: no se reabre` };
  await db.query(`UPDATE ksie_oportunidades SET estado = 'investigando', updated_at = now() WHERE id = $1`, [id]);
  await audit(db, actor, 'ksie.reabierta', { id, evidencias_nuevas: nuevas });
  return { id, reabierta: true, motivo: `${nuevas} evidencia(s) nueva(s) observada(s) tras el abandono` };
}
// Ejecución: una sola a la vez (índice único) y como objetivo principal de C04
export async function ejecutar(db: Db, id: number, actor: string) {
  const o = await oportunidad(db, id);
  const ult = (await db.query(`SELECT decision FROM ksie_recomendaciones WHERE oportunidad_id = $1 ORDER BY id DESC LIMIT 1`, [id])).rows[0];
  if (o.origen !== 'propietario_orden' && ult?.decision !== 'EXECUTE') throw new Error(`«${o.nombre}» no tiene una recomendación EXECUTE (última: ${ult?.decision ?? 'ninguna'})`);
  const otra = (await db.query(`SELECT id, nombre FROM ksie_oportunidades WHERE estado = 'ejecutando' AND id <> $1`, [id])).rows[0];
  if (otra) throw new Error(`Ya se está ejecutando «${otra.nombre}» (#${otra.id}): un solo objetivo de ejecución a la vez`);
  const obj = await proponer(db, { titulo: `Ejecutar oportunidad: ${o.nombre}`, criterio_exito: 'beneficio neto verificado positivo y creciente', propietario: 'jupiter', aceptacion: `KSIE: ${ult?.decision === 'EXECUTE' ? 'recomendación EXECUTE con experimento de pago' : 'orden explícita del propietario'}` }, actor);
  await activar(db, obj.id, actor.replace(/^agente:/, ''), 'ejecución KSIE');
  await db.query(`UPDATE ksie_oportunidades SET estado = 'ejecutando', objetivo_id = $2, updated_at = now() WHERE id = $1`, [id, obj.id]);
  return { id, estado: 'ejecutando', objetivo_id: obj.id };
}
export async function memoriaEstrategica(db: Db, id?: number) {
  if (id) {
    const o = await oportunidad(db, id);
    return { oportunidad: o, respuestas: (await db.query(`SELECT pregunta_id, etiqueta, confianza, left(respuesta, 200) AS respuesta, fuente, created_at FROM ksie_respuestas WHERE oportunidad_id = $1 ORDER BY id`, [id])).rows,
      recomendaciones: (await db.query(`SELECT id, decision, motivo, explicacion_cambio, created_at FROM ksie_recomendaciones WHERE oportunidad_id = $1 ORDER BY id`, [id])).rows,
      experimentos: (await db.query(`SELECT id, tipo, hypothesis, status, interpretacion, siguiente_decision FROM experiments WHERE oportunidad_id = $1 ORDER BY id`, [id])).rows,
      modelos: (await db.query(`SELECT id, etiqueta, escenarios->'escenarios'->'base'->>'beneficio_neto' AS neto_base, created_at FROM ksie_modelos_financieros WHERE oportunidad_id = $1 ORDER BY id`, [id])).rows };
  }
  return { cartera: (await db.query(`SELECT id, nombre, tipo, origen, estado, etiqueta_evaluacion, motivo_abandono FROM ksie_oportunidades ORDER BY id`)).rows, beneficio_real: await beneficioReal(db) };
}

// ---------- 10. Permisos ----------
export const PERMITIDO = ['investigar_informacion_publica', 'analizar_datos_autorizados', 'generar_hipotesis', 'comparar', 'modelo_financiero', 'disenar_experimento', 'criticar', 'registrar', 'recomendar'];
export const REQUIERE_AUTORIZACION = ['gastar', 'anunciar', 'publicar', 'contactar_clientes', 'comprar_inventario', 'firmar_contrato', 'modificar_produccion', 'crear_cuenta_privada', 'experimento_regulado'];
export function permiso(accion: string) {
  if (PERMITIDO.includes(accion)) return { accion, permitido: true, requiere_autorizacion: false };
  if (REQUIERE_AUTORIZACION.includes(accion)) return { accion, permitido: false, requiere_autorizacion: true, como: 'solicitar_aprobacion (el dinero lo decide siempre el propietario en el panel)' };
  return { accion, permitido: false, requiere_autorizacion: true, como: 'acción no catalogada: se trata como externa y necesita autorización' };
}

// ---------- 11/14. Ciclo: «encuentra una forma realista de generar 10.000 $/mes» ----------
export async function encontrarForma(db: Db, objetivo: string, actor: string) {
  const am: any = await construirAutomodelo(db, false);
  const real = await beneficioReal(db);
  const cartera = await comparar(db);
  const fij = await detectarFijacion(db);
  const prefs = (await db.query(`SELECT id, left(text, 160) AS c FROM preferences WHERE active ORDER BY id`).catch(() => ({ rows: [] as any[] }))).rows;
  const presup = (await db.query(`SELECT label, limit_cents, spent_cents, status FROM budget_accounts WHERE NOT is_demo AND status = 'activa'`).catch(() => ({ rows: [] as any[] }))).rows;
  const investigacion = await enrutar(db, { descripcion: `investigar oportunidades actuales para: ${objetivo}`, operaciones: ['investigar_mercado', 'investigar_competencia', 'buscar_precios', 'buscar_literatura', 'consultar_errores_previos', 'modelo_financiero'] }, actor);
  const noEvaluadas = cartera.sin_evaluar;
  const tipos = new Set([...cartera.ranking.map((r: any) => r.tipo), ...noEvaluadas.map((x: any) => x.tipo)]);
  const huecosSector = ['producto_fisico', 'servicio_local', 'mejora_procesos', 'servicio_industrial', 'producto_digital'].filter((t) => !tipos.has(t));
  const mejor = cartera.ranking[0] ?? null;
  return {
    objetivo, meta: `${META_NETO_USD} $/mes de BENEFICIO NETO verificado (no ingresos)`,
    situacion_real: { beneficio_neto_observado_30d: real.beneficio_neto_observado, ingresos_registrados: real.registros_ingresos, presupuesto_activo: presup, limitaciones: am.limitaciones.slice(0, 6), preferencias_del_propietario: prefs.slice(0, 8) },
    no_hago: ['no creo una app', 'no lanzo un canal', 'no recomiendo suscripciones por defecto', 'no doy ideas genéricas', 'no programo', 'no compro nada'],
    herramientas_de_investigacion: { plan: investigacion.plan, huecos: investigacion.huecos },
    alternativas: { evaluadas: cartera.ranking.slice(0, 5), sin_evaluar: noEvaluadas, sectores_sin_explorar: huecosSector },
    cuestiono_mis_supuestos: [...fij.alertas, ...(mejor ? [] : ['No hay ninguna oportunidad evaluada con rangos: cualquier recomendación hoy sería una opinión'])],
    prioridad: mejor ? `La mejor respaldada por evidencia es «${mejor.nombre}» (${mejor.tipo}): valor esperado ${mejor.valor_esperado_mensual} $/mes, etiqueta ${mejor.etiqueta}` : 'Ninguna: primero hay que evaluar al menos 3 alternativas de sectores distintos',
    experimento_mas_barato: mejor ? (await criticar(db, mejor.id)).experimento_mas_barato_que_cambiaria_la_conclusion : 'Entrevistas a 10 personas del segmento de cada alternativa y presupuestos de proveedores (coste 0 $): convierte hipótesis en observaciones',
    autorizacion_necesaria: ['cualquier gasto o anuncio (propietario, en el panel)', 'contactar clientes o proveedores', 'publicar o crear cuentas'].map((a) => a),
    siguiente: 'Responder las 10 preguntas críticas de cada alternativa con las herramientas del plan, evaluar con rangos y recomendar con ksie accion=recomendar',
  };
}

export const KSIE_TOOL = {
  description: 'Motor de inteligencia estratégica (KSIE): asesor independiente orientado a BENEFICIO NETO verificado (hito 10.000 $/mes). Acciones: herramientas_estado | enrutar (necesidad, operaciones[]) | resultado_herramienta (seleccion_id, herramienta, resultado exito|insuficiente|fallo, detalle) | '
    + 'oportunidad_crear (nombre, tipo, descripcion, origen propietario_sugerencia|propietario_orden|kratos|agente, incertidumbre, inversion_usd, riesgo, irreversibilidad) | preguntas (oportunidad_id, nivel) | responder (oportunidad_id, pregunta_id, respuesta, evidencia, fuente, etiqueta HYPOTHESIS|ESTIMATE|OBSERVED|INDEPENDENTLY_VERIFIED, confianza) | '
    + 'evaluar (oportunidad_id, evaluacion{beneficio_neto_mensual{min,base,max}, capital_usd{…}, meses_primer_ingreso{…}, evidencia_demanda, dificultad, competencia, defensibilidad, distribucion, riesgo_baja, encaje}, etiqueta) | comparar | fijacion | criticar (oportunidad_id) | '
    + 'experimento (oportunidad_id, tipo, hipotesis, metrica, linea_base, presupuesto_usd, resultado_previsto, umbral_exito, umbral_fracaso, dias) | resultado_experimento (experimento_id, valor, tipo_evidencia, evidencia, fuente) | modelo_financiero (oportunidad_id, supuestos) | beneficio_real | '
    + 'recomendar (oportunidad_id) | reabrir (oportunidad_id) | ejecutar (oportunidad_id) | memoria (oportunidad_id) | permiso (accion) | encontrar_forma (objetivo). Clics, likes, vistas y halagos no son compras. Sin evidencia, una pregunta queda sin resolver.',
  input_schema: { type: 'object', properties: { accion: { type: 'string' }, oportunidad_id: { type: 'number' }, experimento_id: { type: 'number' }, seleccion_id: { type: 'number' }, nivel: { type: 'number' }, nombre: { type: 'string' }, tipo: { type: 'string' }, descripcion: { type: 'string' }, origen: { type: 'string' },
    sector: { type: 'string' }, incertidumbre: { type: 'number' }, inversion_usd: { type: 'number' }, riesgo: { type: 'number' }, irreversibilidad: { type: 'number' }, pregunta_id: { type: 'string' }, respuesta: { type: 'string' }, evidencia: { type: 'string' }, fuente: { type: 'string' }, etiqueta: { type: 'string' },
    confianza: { type: 'number' }, verificado_por: { type: 'string' }, evaluacion: { type: 'object' }, hipotesis: { type: 'string' }, metrica: { type: 'string' }, linea_base: { type: 'string' }, presupuesto_usd: { type: 'number' }, resultado_previsto: { type: 'number' }, umbral_exito: { type: 'number' },
    umbral_fracaso: { type: 'number' }, dias: { type: 'number' }, valor: { type: 'number' }, gasto_real_usd: { type: 'number' }, tipo_evidencia: { type: 'string' }, supuestos: { type: 'object' }, necesidad: { type: 'string' }, operaciones: { type: 'array', items: { type: 'string' } }, herramienta: { type: 'string' }, resultado: { type: 'string' }, detalle: { type: 'string' }, objetivo: { type: 'string' } }, required: ['accion'] },
};
export async function herramientaKsie(db: Db, i: any, actor: string) {
  const id = Number(i.oportunidad_id);
  const H = await import('./ksie-herramientas.ts');
  switch (i.accion) {
    case 'herramientas_estado': return { estados: await H.sincronizarRegistro(db), aprendizaje: await H.aprendizaje(db) };
    case 'enrutar': return await H.enrutar(db, { descripcion: String(i.necesidad ?? i.descripcion ?? ''), operaciones: i.operaciones ?? [], privacidad: i.privacidad, presupuesto: i.presupuesto }, actor);
    case 'resultado_herramienta': return await H.registrarResultado(db, Number(i.seleccion_id), String(i.herramienta), i.resultado, String(i.detalle ?? ''), actor);
    case 'oportunidad_crear': return await crearOportunidad(db, i, actor);
    case 'preguntas': return await preguntasPara(db, id, i.nivel ? Number(i.nivel) : undefined);
    case 'responder': return await responder(db, { ...i, oportunidad_id: id }, actor);
    case 'evaluar': return await evaluar(db, id, i.evaluacion, String(i.etiqueta ?? 'ESTIMATE'), actor);
    case 'comparar': return await comparar(db);
    case 'fijacion': return await detectarFijacion(db);
    case 'criticar': return await criticar(db, id);
    case 'experimento': return await disenarExperimento(db, { ...i, oportunidad_id: id }, actor);
    case 'resultado_experimento': return await resultadoExperimento(db, Number(i.experimento_id), i, actor);
    case 'modelo_financiero': return await guardarModelo(db, id || null, i.supuestos, String(i.etiqueta ?? 'ESTIMATE'));
    case 'beneficio_real': return await beneficioReal(db);
    case 'recomendar': return await recomendar(db, id, actor);
    case 'reabrir': return await reabrir(db, id, actor);
    case 'ejecutar': return await ejecutar(db, id, actor);
    case 'memoria': return await memoriaEstrategica(db, id || undefined);
    case 'permiso': return permiso(String(i.accion_externa ?? i.tipo ?? i.detalle ?? ''));
    case 'encontrar_forma': return await encontrarForma(db, String(i.objetivo ?? 'generar 10.000 $/mes de beneficio neto'), actor);
  }
  return { error: 'Acción no válida' };
}
