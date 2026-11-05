import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { ROOT } from '../config.ts';
import { withTx, type Db, type Tx } from '../db.ts';
import { audit, getState, isHalted } from './state.ts';
import { FUSION_MODULOS, REQUISITOS, TOTAL_REQUISITOS, seedSolDef } from './sol-def.ts';

// PROJECT SOL / ACD: rastreador permanente de los requisitos de docs/SOL-DIRECTIVA-ACD.md (tabla sol_requisitos).
// El estado de cada identificador lo calcula el código a partir de evidencia real (filas de la base de datos y archivos en disco),
// nunca a partir de lo que diga un agente:
//  · VERIFIED solo con evidencia concreta (examen aprobado por un examinador independiente, prueba en vivo reciente, experimento
//    ejecutado con sus salidas en disco, crítica de un agente distinto del generador…); verificado_en solo mientras siga verificado;
//  · el estado puede BAJAR si la evidencia desaparece (un archivo borrado, una prueba caducada, un examen retirado);
//  · el código que existe pero no se ha visto funcionar queda IMPLEMENTED_UNVERIFIED; un resumen recuperado no es una lectura entera.
// Nota: la directiva dice «139 identificadores», pero su enumeración suma 147 (ver sol-def.ts): se rastrean y se cuentan los 147.

export const ESTADOS = ['NOT_STARTED', 'IN_PROGRESS', 'IMPLEMENTED_UNVERIFIED', 'VERIFIED', 'PARTIAL', 'BLOCKED', 'FAILED'] as const;
export type Estado = (typeof ESTADOS)[number];
export type Calculo = { estado: Estado; evidencia: string | null; pendiente: string | null; siguiente: string | null };
// Opciones solo para pruebas: raíz de los archivos, reloj, actor de la auditoría y desde cuándo leer audit_log (es de solo inserción:
// las pruebas no pueden borrar sus filas, así que ignoran las anteriores). En producción se llama sin opciones.
export type OpcionesReq = { raiz?: string; ahora?: Date; actor?: string; auditDesde?: Date };
type Out = Record<string, Calculo>;
type Q = Db | Tx;

const IDS = REQUISITOS.map((r) => r.id);
const ETAPAS: Record<number, string> = { 1: 'Conocimiento universal e infraestructura de investigación', 2: 'Síntesis hermético-científica', 3: 'Motor de descubrimiento generativo ACD' };
const NOMBRE: Record<Estado, string> = { NOT_STARTED: 'no iniciado', IN_PROGRESS: 'en progreso', IMPLEMENTED_UNVERIFIED: 'implementado sin verificar', VERIFIED: 'verificado', PARTIAL: 'parcial', BLOCKED: 'bloqueado', FAILED: 'fallido' };
const RANGO: Record<Estado, number> = { NOT_STARTED: 0, IN_PROGRESS: 1, BLOCKED: 1, FAILED: 1, PARTIAL: 2, IMPLEMENTED_UNVERIFIED: 2, VERIFIED: 3 };
const SEMANA = 7 * 24 * 3600_000;
const KRATOS = ['kratos (IA)', 'kratos (ciclo CEO)'];
const HERR_KRATOS = '^herramienta\\.(acd[a-z_]*|grafo[a-z_]*|requisitos_sol)$';   // herramientas con las que KRATOS recupera lo de Sol
const DECISION = ['rechazada', 'refutada', 'revisada', 'apoyada_provisional'];
const SELECCION = ['seleccionada', 'formalizada', 'probada', 'apoyada_provisional', 'refutada', 'revisada'];
const ESTADOS_HIP = ['propuesta', 'seleccionada', 'formalizada', 'probada', 'apoyada_provisional', 'refutada', 'rechazada', 'revisada', 'archivada'];
const CIENCIA = ['R01', 'R02', 'R03', 'R04', 'R05', 'R06', 'R07', 'R08', 'R09', 'R16'], ESOTERICO = ['R10', 'R11', 'R12', 'R13', 'R14'];

const r = (estado: Estado, evidencia: string | null, pendiente: string | null, siguiente: string | null): Calculo =>
  ({ estado, evidencia: evidencia ? corta(evidencia, 400) : null, pendiente: pendiente ? corta(pendiente, 300) : null, siguiente: siguiente ? corta(siguiente, 300) : null });
const corta = (s: unknown, n = 80) => { const t = String(s ?? '').replace(/\s+/g, ' ').trim(); return t.length > n ? `${t.slice(0, n - 1)}…` : t; };
const f = (d: unknown) => (d ? new Date(d as any).toISOString().slice(0, 10) : '?');
const t = (d: unknown) => (d ? new Date(d as any).getTime() : NaN);
const lista = (xs: (string | number)[], pre = '', n = 6) => (xs.length <= n ? xs.map((x) => pre + x).join(', ') : `${xs.slice(0, n).map((x) => pre + x).join(', ')} … (+${xs.length - n})`);
const nota = (x: unknown) => (x === null || x === undefined ? '?' : Number(x).toFixed(2));
const decap = (s: string) => s.charAt(0).toLowerCase() + s.slice(1);
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const punto = (s: string) => `${String(s).trim().replace(/[.\s]+$/, '')}.`;
const largo = (s: unknown, n: number) => String(s ?? '').trim().length >= n;
// Mínimo y máximo sin desplegar listas largas como argumentos (Math.min(...xs) revienta con decenas de miles de filas)
const minT = (xs: number[]) => xs.reduce((m, x) => (Number.isFinite(x) && x < m ? x : m), Infinity);
const maxT = (xs: number[]) => xs.reduce((m, x) => (Number.isFinite(x) && x > m ? x : m), -Infinity);
// Identidad de un actor sin depender de mayúsculas ni espacios: «Agente:Sol » sigue siendo Sol
const actorN = (a: unknown) => String(a ?? '').trim().toLowerCase();
const esSol = (a: unknown) => /^(agente:)?sol$/.test(actorN(a));
const esAutonomo = (a: unknown) => /^(agente:|acd)/.test(actorN(a));   // Sol, otro agente o el propio motor ACD (no el propietario ni KRATOS)
const NOTA_APROBADO = 0.7;   // como examen.ts (APROBADO); si allí sube, aquí se sigue sin contar de más

// Examen válido: calificado y aprobado (nota ≥ 0,7) por un agente que no es Sol ni quien respondió (el examinador independiente es
// Saturno), sobre un examen que alguien respondió de verdad y que Sol no creó. Un examen «anulado» (rúbrica filtrada) nunca cuenta.
export const examenAprobado = (e: any) => e.estado === 'calificado' && e.aprobado === true && Number(e.nota) >= NOTA_APROBADO
  && /^agente:/.test(actorN(e.calificado_por)) && !esSol(e.calificado_por) && !!actorN(e.respondido_por)
  && actorN(e.calificado_por) !== actorN(e.respondido_por) && !esSol(e.creado_por);
// Examen del estudio vigente: calificado después de que la materia se diera por estudiada (como aplicarResultado en examen.ts)
const deEsteEstudio = (u: any, e: any) => !u?.completado_en || (!!e.calificado_en && t(e.calificado_en) >= t(u.completado_en));
const ABIERTO = ['creado', 'respondido'];
const CADA_MODULO = 5;   // como curriculo.ts: cada 5.º lanzamiento de estudio es un módulo antiguo no fusionado

// ---------- Evidencia: se carga una vez por refresco ----------
type Ctx = {
  ahora: Date; raiz: string; existe: (rel: string) => boolean; leer: (rel: string) => string | null; abs: (p: string) => string;
  uni: Map<string, any>; exa: Map<string, any[]>; proById: Map<number, any>; proByReq: Map<string, any>; mod: Map<number, any>; pru: Map<string, any>;
  P: any[]; H: any[]; M: any[]; X: any[]; C: any[]; Hm: Map<number, any>; Mm: Map<number, any>; Xm: Map<number, any>;
  decT: Map<number, number>; selHist: Set<number>; con043: boolean;   // momento de la decisión vigente · seleccionadas alguna vez · existe seleccionada_en
  fu: any; cx: any; af: any; restriccion: string;
  au: { kratos: any[]; reinicios: number[]; lanz: any[]; reintentos: number; investigar: any[]; nBusq: number; nLlam: number; unConector: string[]; modCompletados: number[] };
  curiosidad: any[]; recuperadas: number;
};

async function cargar(q: Q, o: OpcionesReq): Promise<Ctx> {
  const raiz = o.raiz ?? ROOT, abs = (p: string) => (path.isAbsolute(p) ? p : path.join(raiz, p)), ad = o.auditDesde ?? new Date(0);
  const rows = async (sql: string, p: unknown[] = []) => (await q.query(sql, p)).rows;
  const uni = new Map((await rows(`SELECT codigo, tipo, area, titulo, orden, relacionadas, modulos_previos, estado, tarea_id, proyecto_id, intentos, lanzado_en, completado_en FROM sol_unidades`)).map((u) => [u.codigo, u]));
  const exa = new Map<string, any[]>();
  for (const e of await rows(`SELECT id, unidad, estado, nota, aprobado, creado_por, respondido_por, calificado_por, created_at, calificado_en FROM sol_examenes ORDER BY id`)) {
    if (!exa.has(e.unidad)) exa.set(e.unidad, []);
    exa.get(e.unidad)!.push(e);
  }
  // componentes que no sean un objeto JSON (no los escribe deliverProject) cuentan 0 en vez de romper el refresco entero
  const pro = await rows(`SELECT id, tipo, titulo, estado, version, carpeta, requisito, created_at, updated_at,
      CASE WHEN jsonb_typeof(componentes) = 'object' THEN (SELECT count(*)::int FROM jsonb_object_keys(componentes)) ELSE 0 END AS n_comp,
      length(trim(coalesce(componentes->>'conclusion', ''))) AS conclusion FROM sol_proyectos WHERE requisito IS NOT NULL OR id = ANY($1::int[]) ORDER BY id`,
    [[...uni.values()].map((u) => u.proyecto_id).filter(Boolean)]);
  const proByReq = new Map<string, any>(); for (const p of pro) if (p.requisito) proByReq.set(p.requisito, p);   // el último gana
  const P = await rows(`SELECT id, area, origen, motivo, unidades, fuente_ids, campana, estado, created_by, created_at FROM acd_preguntas ORDER BY id`);
  // seleccionada_en / criterios_seleccion los añade la 043 (motor ACD); se leen con to_jsonb para no depender de que exista la columna
  const H = await rows(`SELECT id, pregunta_id, padres, operacion, titulo, (length(trim(enunciado)) > 0 AND length(trim(mecanismo)) > 0 AND trim(enunciado) <> trim(mecanismo)) AS separa,
      length(trim(coalesce(arte_previo, ''))) AS arte, fuente_ids, novedad, prioridad, estado, motivo_estado, campana, created_by, created_at, updated_at,
      to_jsonb(h)->>'seleccionada_en' AS seleccionada_en, length(trim(coalesce(to_jsonb(h)->>'criterios_seleccion', ''))) AS criterios FROM acd_hipotesis h ORDER BY id`);
  // Historial de estados (043): fecha real de cada decisión; sin la tabla, se usa updated_at de la hipótesis
  const hist = (await rows(`SELECT to_regclass('public.acd_historial') IS NOT NULL AS ok`))[0].ok ? await rows(`SELECT hipotesis_id, a, created_at FROM acd_historial ORDER BY id`) : [];
  const decT = new Map<number, number>(), selHist = new Set<number>(), ultimoA = new Map<string, number>();
  for (const x of hist) { ultimoA.set(`${x.hipotesis_id}:${x.a}`, t(x.created_at)); if (x.a === 'seleccionada') selHist.add(x.hipotesis_id); }
  for (const h of H) decT.set(h.id, ultimoA.get(`${h.id}:${h.estado}`) ?? t(h.updated_at));
  const con043 = (await rows(`SELECT count(*) > 0 AS ok FROM pg_attribute WHERE attrelid = 'acd_hipotesis'::regclass AND attname = 'seleccionada_en' AND NOT attisdropped`))[0].ok;
  const M = await rows(`SELECT id, hipotesis_id, version, tipo, length(trim(predicciones)) AS pred, length(trim(falsacion)) AS fals, length(trim(baseline)) AS base, length(codigo) AS cod,
      encode(sha256(convert_to(codigo, 'UTF8')), 'hex') = lower(sha256) AS sha_ok, created_by, created_at FROM acd_modelos ORDER BY id`);
  // compara: comparación con el baseline calculada por el código (comparar() de acd.ts: lista de métricas y veredicto), no cualquier JSON
  const X = await rows(`SELECT id, modelo_id, estado, datos, carpeta, inicio, fin, sha256_codigo, sha256_salida, veredicto, created_by,
      (jsonb_typeof(comparacion) = 'object' AND jsonb_typeof(comparacion->'metricas') = 'array' AND CASE WHEN jsonb_typeof(comparacion->'metricas') = 'array' THEN jsonb_array_length(comparacion->'metricas') ELSE 0 END > 0
        AND veredicto IN ('a_favor', 'en_contra', 'no_concluyente')) AS compara FROM acd_experimentos ORDER BY id`);
  const C = await rows(`SELECT id, objeto, objeto_id, critico, veredicto, created_at FROM acd_criticas ORDER BY id`);
  // Procedencia (directiva: identificador original; título, fecha y estado de publicación; permisos de acceso). texto_disponible NULL
  // significa «desconocido» y es un registro honesto. Lectura real: avance contiguo sobre el texto completo (leer_texto de omega.ts).
  const fu = (await rows(`SELECT count(*) FILTER (WHERE conector IS NOT NULL)::int AS de_conector,
      count(*) FILTER (WHERE conector IS NOT NULL AND coalesce(doi, identificador, url) IS NOT NULL AND length(trim(coalesce(titulo, ''))) > 0
        AND length(trim(coalesce(permisos, ''))) > 0 AND estado_publicacion IS NOT NULL AND (length(trim(coalesce(fecha_publicacion, ''))) > 0 OR anio IS NOT NULL))::int AS procedencia,
      coalesce(array_agg(id || ' ' || round(100.0 * leido_hasta / longitud) || '%' ORDER BY id) FILTER (WHERE longitud > 0 AND leido_hasta > 0 AND leido_hasta <= longitud), '{}') AS lecturas,
      count(*) FILTER (WHERE longitud > 0 AND leido_hasta >= 0.9 * longitud AND leido_hasta <= longitud)::int AS enteras,
      count(*) FILTER (WHERE leido_hasta > coalesce(longitud, 0))::int AS inexactas,
      count(*) FILTER (WHERE acceso = 'texto_completo' AND (longitud IS NULL OR leido_hasta < 0.9 * longitud))::int AS declaradas,
      coalesce(array_agg(DISTINCT conector) FILTER (WHERE conector IS NOT NULL), '{}') AS conectores FROM sol_fuentes`))[0];
  const cx = (await rows(`SELECT count(*)::int AS total, count(*) FILTER (WHERE naturaleza IS NULL)::int AS sin_naturaleza,
      count(*) FILTER (WHERE naturaleza = 'evidencia')::int AS evidencia, count(*) FILTER (WHERE naturaleza = 'interpretacion')::int AS interpretacion,
      count(*) FILTER (WHERE naturaleza = 'especulacion')::int AS especulacion,
      count(*) FILTER (WHERE tema_desde <> tema_hacia AND EXISTS (SELECT 1 FROM sol_unidades u WHERE u.codigo = c.tema_desde AND u.tipo = 'materia')
        AND EXISTS (SELECT 1 FROM sol_unidades u WHERE u.codigo = c.tema_hacia AND u.tipo = 'materia'))::int AS enlazan FROM sol_conexiones c`))[0];
  const af = (await rows(`SELECT count(*) FILTER (WHERE nivel = 'H')::int AS h, count(*) FILTER (WHERE nivel <> 'H')::int AS ae FROM sol_afirmaciones`))[0];
  const restriccion = (await rows(`SELECT coalesce(string_agg(pg_get_constraintdef(oid), ' '), '') AS d FROM pg_constraint WHERE conrelid = 'acd_hipotesis'::regclass AND contype = 'c'`))[0].d;
  const au = {
    kratos: await rows(`SELECT action, max(at) AS ultimo, count(*)::int AS n FROM audit_log WHERE actor = ANY($1) AND action ~ $2 AND at >= $3 GROUP BY action ORDER BY action`, [KRATOS, HERR_KRATOS, ad]),
    reinicios: (await rows(`SELECT at FROM audit_log WHERE action = 'proceso.iniciado' AND at >= $1 ORDER BY at DESC LIMIT 2000`, [ad])).map((x) => t(x.at)),
    // lanzamientos de los planificadores (acd.lanzado, omega.modulo_lanzado, sol.materia_lanzada, sol.examen_fase_lanzada…)
    lanz: await rows(`SELECT action, max(at) AS ultimo, count(*)::int AS n FROM audit_log WHERE action ~ '^(acd|omega|sol)[.]' AND action ~ 'lanz' AND at >= $1 GROUP BY action ORDER BY action`, [ad]),
    reintentos: (await rows(`SELECT count(*)::int AS n FROM audit_log WHERE action ~ '(reintento|recuperad)' AND at >= $1`, [ad]))[0].n,
    // interfaz unificada: llamadas a la herramienta (las 500 últimas bastan: solo dicen qué se PIDIÓ) y cuántas búsquedas hubo
    investigar: await rows(`SELECT id, at, action, details FROM audit_log WHERE action IN ('herramienta.investigar_sol', 'herramienta.investigar_fuentes') AND at >= $1 ORDER BY id DESC LIMIT 500`, [ad]),
    nBusq: (await rows(`SELECT count(*)::int AS n FROM audit_log WHERE action = 'sol.investigar' AND at >= $1`, [ad]))[0].n,
    nLlam: (await rows(`SELECT count(*)::int AS n FROM audit_log WHERE action IN ('herramienta.investigar_sol', 'herramienta.investigar_fuentes') AND at >= $1`, [ad]))[0].n,
    // lo que el propio código registró como recuperado (sol.investigar): solo es atribuible si se consultó UN conector, no falló y hubo
    // resultados. Se busca en TODO el historial (no en las últimas filas), para que la evidencia no se pierda al crecer la auditoría.
    unConector: (await rows(`SELECT DISTINCT upper(details->'fuentes'->>0) AS c FROM audit_log WHERE action = 'sol.investigar' AND at >= $1
        AND CASE WHEN jsonb_typeof(details->'fuentes') = 'array' THEN jsonb_array_length(details->'fuentes') END = 1
        AND CASE WHEN coalesce(details->>'resultados', '') ~ '^[0-9]{1,9}$' THEN (details->>'resultados')::int END > 0
        AND NOT (CASE WHEN jsonb_typeof(details->'errores') = 'array' THEN details->'errores' ELSE '[]'::jsonb END ? (details->'fuentes'->>0))`, [ad]))
      .map((x) => String(x.c)).filter((x) => /^R(0[1-9]|1[0-6])$/.test(x)),
    modCompletados: (await rows(`SELECT DISTINCT (details->>'modulo')::int AS n FROM audit_log WHERE action = 'omega.modulo_completado' AND details->>'modulo' ~ '^[0-9]+$' AND at >= $1`, [ad])).map((x) => x.n),
  };
  return {
    ahora: o.ahora ?? new Date(), raiz, abs, existe: (rel) => fs.existsSync(abs(rel)), leer: (rel) => { try { return fs.readFileSync(abs(rel), 'utf8'); } catch { return null; } },
    uni, exa, proById: new Map(pro.map((p) => [p.id, p])), proByReq,
    mod: new Map((await rows(`SELECT n, titulo, estado, proyecto_id, tarea_id, fusionado_en FROM sol_modulos ORDER BY n`)).map((m) => [m.n, m])),
    // la última prueba es la última registrada (id), como en listarConectores: una fila con fecha futura no tapa las pruebas posteriores
    pru: new Map((await rows(`SELECT DISTINCT ON (codigo) id, codigo, ok, resultados, ms, detalle, probado_en FROM sol_conectores_pruebas ORDER BY codigo, id DESC`)).map((p) => [p.codigo, p])),
    P, H, M, X, C, Hm: new Map(H.map((h) => [h.id, h])), Mm: new Map(M.map((m) => [m.id, m])), Xm: new Map(X.map((x) => [x.id, x])), decT, selHist, con043, fu, cx, af, restriccion, au,
    curiosidad: await rows(`SELECT id, status, created_at FROM tasks WHERE created_by = 'acd (curiosidad)' ORDER BY id`),
    recuperadas: (await rows(`SELECT count(*)::int AS n FROM tasks WHERE owner_function IN ('sol', 'saturno') AND status = 'completada' AND attempts > 1`))[0].n,
  };
}

// ---------- Ayudas sobre la evidencia ----------
// Expediente vigente de una unidad: el que enlaza la unidad (si no es el expediente de OTRA unidad: un mismo proyecto no verifica
// dos requisitos), o el último con requisito = código
const proyecto = (c: Ctx, id: string) => {
  const u = c.uni.get(id), p = u?.proyecto_id ? c.proById.get(u.proyecto_id) : null;
  return (p && (!p.requisito || p.requisito === id) ? p : null) || c.proByReq.get(id) || null;
};
// Un proyecto solo cuenta si está «completed» y sus archivos se leen en disco (como projectStatus, pero sin modificar nada)
function archivos(p: any): boolean {
  if (!p || p.estado !== 'completed' || !p.carpeta) return false;
  const dir = path.join(p.carpeta, `v${p.version}`);
  try { return fs.readdirSync(dir).filter((x) => x.endsWith('.md')).length >= Math.max(1, p.n_comp ?? 0); } catch { return false; }
}
const carpetaOk = (c: Ctx, x: any) => !!x.carpeta && fs.existsSync(c.abs(x.carpeta));
// Experimento real: estado ok, su carpeta con salida.json en disco y la huella sha256 registrada que coincide (sin huella no hay forma
// de saber que la salida es la que produjo la ejecución: no cuenta). Se calcula una vez por experimento y refresco.
// El sha256 de cada salida.json se recalcula solo si cambia el archivo (tamaño, fechas de modificación y de cambio de inodo, que no se
// puede falsear con utimes): el refresco periódico no relee cientos de salidas de hasta 20 MB dentro de su transacción.
const hashes = new Map<string, { firma: string; sha: string | null }>();
function shaArchivo(f: string): string | null {
  try {
    const s = fs.statSync(f), firma = `${s.size}:${s.mtimeMs}:${s.ctimeMs}:${s.ino}`, h = hashes.get(f);
    if (h && h.firma === firma) return h.sha;
    const sha = crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex');
    hashes.set(f, { firma, sha });
    return sha;
  } catch { hashes.delete(f); return null; }
}
const salidaCache = new WeakMap<any, boolean>();
function salidaOk(c: Ctx, x: any): boolean {
  if (salidaCache.has(x)) return salidaCache.get(x)!;
  const ok = x.estado === 'ok' && !!x.sha256_salida && carpetaOk(c, x) && shaArchivo(path.join(c.abs(x.carpeta), 'salida.json')) === String(x.sha256_salida).trim().toLowerCase();
  salidaCache.set(x, ok);
  return ok;
}
const finDe = (x: any) => t(x.fin ?? x.inicio);
const hipDe = (c: Ctx, objeto: string, id: number): number | null => {
  if (objeto === 'hipotesis') return c.Hm.has(id) ? id : null;
  if (objeto === 'modelo') return c.Mm.get(id)?.hipotesis_id ?? null;
  const x = c.Xm.get(id); return x ? c.Mm.get(x.modelo_id)?.hipotesis_id ?? null : null;
};
// Crítica independiente: el crítico no es Sol (la generadora, como en acd.ts) ni generó el objeto ni la hipótesis de la que cuelga
// (ni su modelo). Se compara sin mayúsculas ni espacios: «Agente:Sol» no se cuela como otro agente.
function independiente(c: Ctx, cr: any): boolean {
  let g: (string | undefined)[] | null = null;
  if (cr.objeto === 'hipotesis') g = c.Hm.has(cr.objeto_id) ? [c.Hm.get(cr.objeto_id).created_by] : null;
  else if (cr.objeto === 'modelo') { const m = c.Mm.get(cr.objeto_id); g = m ? [m.created_by, c.Hm.get(m.hipotesis_id)?.created_by] : null; }
  else { const x = c.Xm.get(cr.objeto_id), m = x && c.Mm.get(x.modelo_id); g = x ? [x.created_by, m?.created_by, m && c.Hm.get(m.hipotesis_id)?.created_by] : null; }
  const quien = actorN(cr.critico);
  return !!g && !!quien && !esSol(quien) && !g.map(actorN).includes(quien);
}
const experimentosDe = (c: Ctx, hid: number) => c.X.filter((x) => c.Mm.get(x.modelo_id)?.hipotesis_id === hid);
// «apoyada_provisional» con respaldo real (lo que exige decidir() en acd.ts): un experimento ok a favor con su salida intacta y, después,
// una crítica «aceptar» independiente de la hipótesis, de ese modelo o de ese experimento. Sin eso, el estado afirma más de lo que hay.
const respaldada = (c: Ctx, h: any) => experimentosDe(c, h.id).some((x) => x.veredicto === 'a_favor' && salidaOk(c, x) && c.C.some((cr) => cr.veredicto === 'aceptar'
  && independiente(c, cr) && t(cr.created_at) >= finDe(x) && ((cr.objeto === 'hipotesis' && cr.objeto_id === h.id) || (cr.objeto === 'modelo' && cr.objeto_id === x.modelo_id) || (cr.objeto === 'experimento' && cr.objeto_id === x.id))));
// Decisión (rechazar, refutar, revisar o apoyo provisional) con motivo, tomada DESPUÉS de un resultado: un experimento que terminó ok
// con su salida intacta (uno que falló no da resultados en los que basarse) o una crítica independiente.
// El momento de la decisión sale de acd_historial (si existe) y, si no, de updated_at.
function decisiones(c: Ctx, soloExperimento = false) {
  const out: { h: any; tras: string; cuando: number }[] = [];
  for (const h of c.H) {
    if (!DECISION.includes(h.estado) || !largo(h.motivo_estado, 10)) continue;
    const cuando = c.decT.get(h.id) ?? t(h.updated_at);
    const x = experimentosDe(c, h.id).find((x) => salidaOk(c, x) && finDe(x) <= cuando);
    const cr = soloExperimento ? null : c.C.find((cr) => hipDe(c, cr.objeto, cr.objeto_id) === h.id && independiente(c, cr) && t(cr.created_at) <= cuando);
    if (x || cr) out.push({ h, tras: x ? `experimento #${x.id}` : `crítica #${cr.id}`, cuando });
  }
  return out;
}
const esC1 = (s: unknown) => String(s ?? '').trim().toUpperCase() === 'C1';
const primeraFilaAcd = (c: Ctx) => minT([...[...c.P, ...c.H, ...c.M, ...c.C].map((x) => t(x.created_at)), ...c.X.map((x) => t(x.inicio))]);
const reinicioTras = (c: Ctx, desde: number, hasta = Infinity) => c.au.reinicios.find((x) => x > desde && x < hasta) ?? null;

// ---------- Grupo S/H/V: las 56 materias ----------
// pendiente sin tarea → NOT_STARTED · pendiente con intentos o tarea, o en_curso → IN_PROGRESS · estudiada con expediente legible
// (o con TODOS sus módulos previos completados) → IMPLEMENTED_UNVERIFIED · examen aprobado por un examinador independiente, del
// estudio vigente, y expediente → VERIFIED · fallida → FAILED. Un registro «evaluada» sin examen aprobado no se da por verificado;
// un examen anulado (rúbrica filtrada) o de un estudio anterior no cuenta.
function reglaMaterias(c: Ctx, out: Out) {
  for (const { id } of REQUISITOS.filter((x) => 'SHV'.includes(x.id[0]))) {
    const u = c.uni.get(id);
    if (!u) { out[id] = r('NOT_STARTED', null, 'No existe el registro en sol_unidades', 'Sembrar la definición de PROJECT SOL (seedSolDef)'); continue; }
    const nom = `${id} (${u.titulo})`, ex = c.exa.get(id) ?? [], vale = (e: any) => examenAprobado(e) && deEsteEstudio(u, e);
    const ap = [...ex].reverse().find(vale), ult = [...ex].reverse().find((e) => e.estado !== 'anulado'), anulados = ex.filter((e) => e.estado === 'anulado').length;
    // último examen calificado que no vale: de un estudio anterior, suspendido, o «aprobado» sin examinador independiente
    const noVale = ult && ult.estado === 'calificado' && !vale(ult) ? ult : null, previo = noVale && !deEsteEstudio(u, noVale) ? noVale : null;
    const susp = noVale && !previo && !noVale.aprobado ? noVale : null, abierto = ult && ABIERTO.includes(ult.estado) ? ult : null;
    const exTxt = `${previo ? ` · examen #${previo.id} de un estudio anterior (no cuenta)` : susp ? ` · examen #${susp.id} suspendido (nota ${nota(susp.nota)})` : noVale ? ` · examen #${noVale.id} calificado sin examinador independiente (no cuenta)` : ''}${abierto ? ` · examen #${abierto.id} ${abierto.estado}` : ''}${anulados ? ` · ${anulados} examen(es) anulado(s) (no cuentan)` : ''}`;
    if (u.estado === 'fallida') { out[id] = r('FAILED', `sol_unidades ${id} fallida tras ${u.intentos} intento(s)${exTxt}`, 'El estudio falló: revisar la causa antes de reintentar', `Reprogramar ${nom} con otro enfoque`); continue; }
    if (u.estado === 'pendiente' && !u.tarea_id && !(u.intentos > 0)) { out[id] = r('NOT_STARTED', null, 'Expediente de 8 puntos y examen independiente de dominio', `Estudiar ${nom}: turno ${u.orden} de 56 en el planificador`); continue; }
    if (u.estado === 'pendiente' || u.estado === 'en_curso') {
      out[id] = r('IN_PROGRESS', `sol_unidades ${id} ${u.estado}${u.tarea_id ? ` · tarea #${u.tarea_id}` : ''}${u.lanzado_en ? ` · lanzada ${f(u.lanzado_en)}` : ''} · intento ${u.intentos}${exTxt}`,
        'Entregar el expediente completo y aprobar el examen independiente', u.estado === 'en_curso' ? `Terminar el expediente de ${nom}${u.tarea_id ? ` (tarea #${u.tarea_id})` : ''}` : `Relanzar el estudio de ${nom}`);
      continue;
    }
    const p = proyecto(c, id), pOk = !!p && p.tipo === 'materia' && archivos(p);
    const prev: number[] = u.modulos_previos ?? [], prevOk = prev.length > 0 && prev.every((n) => c.mod.get(n)?.estado === 'completado');
    const exp = pOk ? `expediente P${p.id} v${p.version} (${f(p.updated_at)})` : prevOk ? `módulos previos ${prev.join(', ')} completados (sol_modulos${prev.map((n) => c.mod.get(n)?.proyecto_id).filter(Boolean).map((x) => ` P${x}`).join(',')})` : null;
    const sigEx = abierto ? (abierto.estado === 'respondido' ? `Saturno califica el examen #${abierto.id} de ${nom}` : `Sol responde el examen #${abierto.id} de ${nom}`)
      : susp ? `Volver a estudiar ${nom} y repetir el examen` : `Saturno crea y califica el examen de dominio de ${nom}`;
    if (ap && exp) out[id] = r('VERIFIED', `examen #${ap.id} aprobado (nota ${nota(ap.nota)}, calificado por ${ap.calificado_por} el ${f(ap.calificado_en)}) · ${exp}`, null, null);
    else if (exp) out[id] = r('IMPLEMENTED_UNVERIFIED', `${exp} · sin examen aprobado${exTxt}`, 'Examen de dominio calificado por un examinador independiente', sigEx);
    else out[id] = r('PARTIAL', `sol_unidades ${id} ${u.estado}${p ? ` · expediente P${p.id} ${p.estado}${p.tipo !== 'materia' ? ` (tipo ${p.tipo})` : ''} sin archivos legibles` : ' · sin expediente'}${ap ? ` · examen #${ap.id} aprobado` : ''}${exTxt}`,
      'Consta como estudiada pero no hay expediente de materia completo y legible en disco', `Reentregar el expediente de ${nom} (proyecto_sol, tipo materia)`);
  }
}

// ---------- Grupo R: conectores ----------
// Última prueba en vivo (sol_conectores_pruebas): ninguna → NOT_STARTED, o IMPLEMENTED_UNVERIFIED si src/core/conectores.ts existe
// (y, si ese archivo nombra códigos R, nombra este) · ok con resultados y de ≤ 7 días → VERIFIED · ok pero antigua o sin resultados →
// IMPLEMENTED_UNVERIFIED (hay que repetirla) · fallo por clave, token, 403 o 429 → BLOCKED · cualquier otro fallo → FAILED.
function reglaConectores(c: Ctx, out: Out) {
  const src = c.leer('src/core/conectores.ts'), nombraCodigos = !!src && /\bR(0[1-9]|1[0-6])\b/.test(src);
  for (const { id } of REQUISITOS.filter((x) => x.id[0] === 'R')) {
    const p = c.pru.get(id), impl = !!src && (!nombraCodigos || new RegExp(`\\b${id}\\b`).test(src));
    const sigProbar = `Ejecutar la prueba en vivo de ${id} y registrarla en sol_conectores_pruebas`;
    if (!p) { out[id] = impl ? r('IMPLEMENTED_UNVERIFIED', `código src/core/conectores.ts (${id}) sin prueba en vivo registrada`, 'Prueba en vivo con resultados reales', sigProbar) : r('NOT_STARTED', null, 'Conector sin implementar ni probar', `Implementar ${id} en src/core/conectores.ts y probarlo en vivo`); continue; }
    const ev = `sol_conectores_pruebas #${p.id} ${p.ok ? 'ok' : 'fallo'} · ${p.resultados ?? 0} resultados${p.ms ? ` · ${p.ms} ms` : ''} · ${f(p.probado_en)}`;
    // edad de la prueba: una fecha en el futuro (reloj adelantado o fila mal escrita) no es una prueba vigente para siempre
    const edad = c.ahora.getTime() - t(p.probado_en), futura = edad < -5 * 60_000;
    if (p.ok && (p.resultados ?? 0) > 0 && !futura && edad <= SEMANA)
      out[id] = r('VERIFIED', ev, null, `Repetir la prueba en vivo antes del ${f(t(p.probado_en) + SEMANA)}`);
    else if (p.ok) out[id] = r('IMPLEMENTED_UNVERIFIED', `${ev}${futura ? ' · fecha de prueba en el futuro (no cuenta)' : (p.resultados ?? 0) > 0 ? ' · caducada (> 7 días)' : ' · sin resultados'}`, 'Una prueba en vivo vigente (≤ 7 días) con resultados', sigProbar);
    else if (/\b(api[ _-]?key|keys?|tokens?|claves?)\b|\b(401|403|429)\b/i.test(String(p.detalle ?? ''))) out[id] = r('BLOCKED', `${ev} · ${corta(p.detalle, 120)}`, `Bloqueado: ${corta(p.detalle, 120)}`, `Conseguir el acceso legal (clave/token) o esperar el límite de peticiones y volver a probar ${id}`);
    else out[id] = r('FAILED', `${ev}${p.detalle ? ` · ${corta(p.detalle, 120)}` : ''}`, 'La última prueba en vivo falló', `Revisar el analizador de ${id} contra una respuesta real y volver a probar`);
  }
}

// ---------- Grupos B y G: puentes e investigaciones generativas ----------
// pendiente → NOT_STARTED · en_curso → IN_PROGRESS · estudiada con expediente completed y legible (tipo puente para B; acd o
// investigacion para G) y, para B, al menos una pregunta ACD cuyas unidades incluyen el código → VERIFIED · estudiada a la que le
// falta algo → PARTIAL · fallida → FAILED.
function reglaPuentesGenerativas(c: Ctx, out: Out) {
  for (const { id } of REQUISITOS.filter((x) => 'BG'.includes(x.id[0]))) {
    const u = c.uni.get(id), B = id[0] === 'B', clase = B ? 'el puente' : 'la investigación generativa';
    if (!u) { out[id] = r('NOT_STARTED', null, 'No existe el registro en sol_unidades', 'Sembrar la definición de PROJECT SOL (seedSolDef)'); continue; }
    const nom = `${id} (${u.titulo})`;
    if (u.estado === 'fallida') { out[id] = r('FAILED', `sol_unidades ${id} fallida tras ${u.intentos} intento(s)`, 'El trabajo falló: revisar la causa', `Reprogramar ${clase} ${nom}`); continue; }
    if (u.estado === 'pendiente' && !u.tarea_id && !(u.intentos > 0)) { out[id] = r('NOT_STARTED', null, B ? 'Método de 9 pasos, expediente de puente y candidato ACD' : 'Investigación con referencias técnicas y aplicabilidad a ACD', `Empezar ${clase} ${nom}`); continue; }
    if (u.estado === 'pendiente' || u.estado === 'en_curso') { out[id] = r('IN_PROGRESS', `sol_unidades ${id} ${u.estado}${u.tarea_id ? ` · tarea #${u.tarea_id}` : ''} · intento ${u.intentos}`, 'Entregar el expediente completo', `Terminar ${clase} ${nom}`); continue; }
    const p = proyecto(c, id), tipoOk = !!p && (B ? p.tipo === 'puente' : ['acd', 'investigacion'].includes(p.tipo)), pOk = tipoOk && archivos(p);
    const preg = B ? c.P.filter((q) => (q.unidades ?? []).includes(id)) : [], nh = c.H.filter((h) => preg.some((q) => q.id === h.pregunta_id)).length;
    const faltas = [...(pOk ? [] : [p ? `el expediente P${p.id} (${p.tipo}, ${p.estado}) no está completo y legible` : 'no hay expediente']), ...(B && !preg.length ? ['ninguna pregunta ACD enlazada (acd_preguntas.unidades)'] : [])];
    const ev = `${p ? `expediente P${p.id} ${p.tipo} ${p.estado} v${p.version} (${f(p.updated_at)})` : `sol_unidades ${id} ${u.estado} sin expediente`}${B ? ` · ${preg.length} pregunta(s) ACD${preg.length ? ` (${lista(preg.map((q) => q.id), '#')})` : ''}, ${nh} hipótesis` : ''}`;
    out[id] = faltas.length ? r('PARTIAL', ev, cap(faltas.join('; ')), B && pOk ? `Formular al menos una pregunta ACD desde ${nom}` : `Reentregar el expediente de ${nom}`) : r('VERIFIED', ev, null, null);
  }
}

// ---------- Grupo D: capacidades ACD ----------
// Regla común: evidencia de ejecución completa + código (src/core/acd.ts) → VERIFIED; evidencia parcial, o datos sin el código →
// PARTIAL; solo el código → IMPLEMENTED_UNVERIFIED; nada → NOT_STARTED. D12 tiene su propia regla (guarda en código + decisiones).
type Ev = { ok: boolean; texto: string | null; falta: string };
function regla(codigo: boolean, archivo: string, ev: Ev, sig: string): Calculo {
  if (ev.ok && codigo) return r('VERIFIED', ev.texto, null, null);
  if (ev.texto) return r('PARTIAL', `${ev.texto}${codigo ? '' : ` · falta el código ${archivo}`}`, ev.ok ? `Falta el código ${archivo}` : ev.falta, sig);
  if (codigo) return r('IMPLEMENTED_UNVERIFIED', `código ${archivo} presente; sin ejecución registrada`, ev.falta, sig);
  return r('NOT_STARTED', null, ev.falta, sig);
}
function reglaCapacidades(c: Ctx, out: Out) {
  const A = 'src/core/acd.ts', acd = c.existe(A);
  // D01 IMAGINAR: al menos 3 hipótesis distintas generadas por Sol
  const hs = c.H.filter((h) => h.created_by === 'agente:sol'), tit = new Set(hs.map((h) => corta(h.titulo, 200).toLowerCase()));
  out.D01 = regla(acd, A, { ok: tit.size >= 3, texto: hs.length ? `acd_hipotesis de agente:sol: ${hs.length} (${tit.size} títulos distintos; ${lista(hs.map((h) => h.id), '#')})` : null, falta: `Sol debe imaginar al menos 3 hipótesis distintas (hay ${tit.size})` }, 'Lanzar una tarea ACD de imaginación sobre una pregunta abierta');
  // D02 MODELAR: un modelo con código íntegro (sha256 coincide), predicciones y falsación
  const mo = c.M.filter((m) => m.sha_ok && m.cod > 0 && m.pred > 0 && m.fals > 0);
  out.D02 = regla(acd, A, { ok: mo.length > 0, texto: c.M.length ? `acd_modelos: ${mo.length}/${c.M.length} con código íntegro (sha256), predicciones y falsación${mo.length ? ` (${lista(mo.map((m) => m.id), '#')})` : ''}` : null, falta: 'Formalizar una hipótesis en un modelo ejecutable con predicciones y criterio de falsación' }, 'Formalizar la hipótesis mejor priorizada en un modelo');
  // D03 EXPERIMENTAR: experimento ok con su carpeta y salida.json en disco, que coincide con su sha256
  const xo = c.X.filter((x) => salidaOk(c, x));
  out.D03 = regla(acd, A, { ok: xo.length > 0, texto: c.X.length ? `acd_experimentos: ${xo.length} ok con salida.json en disco de ${c.X.length} (${lista(c.X.map((x) => `${x.id} ${x.estado}`), '#')})` : null, falta: 'Ejecutar un experimento computacional real y conservar sus salidas' }, 'Ejecutar el modelo formalizado y conservar salida.json');
  // D04 EVOLUCIONAR: linaje (padres) o decisión tras un experimento o una crítica
  const evo = c.H.filter((h) => (h.padres ?? []).length > 0 && h.padres.every((p: number) => c.Hm.has(p))), dec = decisiones(c);
  out.D04 = regla(acd, A, { ok: evo.length + dec.length > 0, texto: evo.length + dec.length ? `${evo.length} hipótesis con linaje (${lista(evo.map((h) => h.id), '#')}) · ${dec.length} decisión(es) tras resultados${dec.length ? ` (${dec.slice(0, 4).map((d) => `#${d.h.id} ${d.h.estado} tras ${d.tras}`).join(', ')})` : ''}` : null, falta: 'Rechazar, revisar o combinar una hipótesis a partir de un resultado' }, 'Revisar una hipótesis con el resultado de su experimento o de su crítica');
  // D05 CURIOSIDAD: tarea completada creada por «acd (curiosidad)» y pregunta con origen curiosidad
  const tc = c.curiosidad.filter((x) => x.status === 'completada'), pc = c.P.filter((q) => q.origen === 'curiosidad');
  out.D05 = regla(acd, A, { ok: tc.length > 0 && pc.length > 0, texto: c.curiosidad.length || pc.length ? `tareas de acd (curiosidad): ${tc.length} completadas de ${c.curiosidad.length}${tc.length ? ` (${lista(tc.map((x) => x.id), '#')})` : ''} · ${pc.length} pregunta(s) con origen curiosidad` : null, falta: 'Que la curiosidad autónoma lance y complete una tarea y registre su pregunta' }, 'Dejar que el planificador de curiosidad lance su primera tarea');
  // D06 CRÍTICO INDEPENDIENTE: crítica cuyo autor no generó el objeto
  const ci = c.C.filter((cr) => independiente(c, cr));
  out.D06 = regla(acd, A, { ok: ci.length > 0, texto: c.C.length ? `acd_criticas independientes: ${ci.length}/${c.C.length}${ci.length ? ` (${lista(ci.map((cr) => `${cr.id} ${cr.critico}`), '#')})` : ''}${c.C.length > ci.length ? ` · ${c.C.length - ci.length} descartadas (mismo autor u objeto inexistente)` : ''}` : null, falta: 'Una crítica de un agente distinto del generador (Saturno)' }, 'Encargar a Saturno la crítica de la hipótesis mejor priorizada');
  // D07 MEMORIA: filas de cada tipo y carpetas de los experimentos en disco
  const tipos: [string, number][] = [['preguntas', c.P.length], ['hipótesis', c.H.length], ['modelos', c.M.length], ['experimentos', c.X.length], ['críticas', c.C.length]];
  const conCarpeta = c.X.filter((x) => x.carpeta), enDisco = conCarpeta.filter((x) => carpetaOk(c, x));
  out.D07 = regla(acd, A, { ok: tipos.every(([, n]) => n > 0) && conCarpeta.length > 0 && enDisco.length === conCarpeta.length,
    texto: tipos.some(([, n]) => n > 0) ? `${tipos.map(([k, n]) => `${n} ${k}`).join(', ')} · carpetas en disco ${enDisco.length}/${conCarpeta.length}` : null,
    falta: `Faltan: ${[...tipos.filter(([, n]) => !n).map(([k]) => k), ...(conCarpeta.length > enDisco.length ? [`${conCarpeta.length - enDisco.length} carpeta(s) de experimento`] : [])].join(', ') || 'nada'}` }, 'Completar el ciclo pregunta → hipótesis → modelo → experimento → crítica');
  // D08 PRIORIZACIÓN: al menos 3 hipótesis con prioridad calculada
  const hp = c.H.filter((h) => h.prioridad !== null && h.prioridad !== undefined);
  out.D08 = regla(acd, A, { ok: hp.length >= 3, texto: hp.length ? `${hp.length} hipótesis con prioridad (${hp.sort((a, b) => Number(b.prioridad) - Number(a.prioridad)).slice(0, 4).map((h) => `#${h.id}=${nota(h.prioridad)}`).join(', ')})` : null, falta: `Priorizar al menos 3 hipótesis (hay ${hp.length})` }, 'Puntuar las hipótesis abiertas con los criterios de priorización');
  // D09 INTEGRACIÓN CON KRATOS: KRATOS (IA o ciclo CEO) usó la herramienta acd o requisitos_sol
  const kd = c.au.kratos.filter((a) => /^herramienta\.(acd[a-z_]*|requisitos_sol)$/.test(a.action));
  out.D09 = regla(acd || c.existe('src/core/requisitos.ts'), 'src/core/acd.ts o src/core/requisitos.ts', { ok: kd.length > 0, texto: kd.length ? `audit_log por KRATOS: ${kd.map((a) => `${a.action}×${a.n} (último ${f(a.ultimo)})`).join(', ')}` : null, falta: 'Que KRATOS consulte el estado de Sol con sus herramientas (acd / requisitos_sol)' }, 'Que el ciclo CEO consulte requisitos_sol al planificar');
  // D10 FIABILIDAD: lanzamiento del planificador + tarea recuperada o reintentada + datos ACD que sobreviven a un reinicio
  const recup = c.au.reintentos + c.recuperadas, ini = primeraFilaAcd(c), rein = Number.isFinite(ini) ? reinicioTras(c, ini) : null;
  const partes = [c.au.lanz.length ? `planificador: ${c.au.lanz.map((a) => `${a.action}×${a.n}`).join(', ')}` : null, recup ? `${recup} recuperación(es) o reintento(s) de tareas` : null,
    rein ? `reinicio ${f(rein)} con ${c.P.length + c.H.length + c.M.length + c.X.length + c.C.length} filas ACD conservadas` : null];
  out.D10 = regla(acd, A, { ok: partes.every(Boolean), texto: partes.some(Boolean) ? partes.filter(Boolean).join(' · ') : null,
    falta: `Falta evidencia de: ${[!partes[0] && 'lanzamiento del planificador', !partes[1] && 'recuperación de una tarea', !partes[2] && 'persistencia tras un reinicio'].filter(Boolean).join(', ') || 'nada'}` }, 'Comprobar el planificador ACD tras el próximo reinicio del trabajador');
  // D11 PROPÓSITO GENERAL: preguntas o hipótesis en al menos 3 áreas distintas
  const areas = new Set([...c.P.map((q) => q.area), ...c.H.map((h) => c.P.find((q) => q.id === h.pregunta_id)?.area)].filter((a) => a && String(a).trim()).map((a) => String(a).trim().toLowerCase()));
  out.D11 = regla(acd, A, { ok: areas.size >= 3, texto: areas.size ? `áreas de preguntas/hipótesis: ${areas.size} (${[...areas].sort().slice(0, 6).join(', ')})` : null, falta: `Investigar en al menos 3 áreas distintas (hay ${areas.size})` }, 'Abrir una pregunta ACD en un área nueva (ingeniería, materiales, psicología o productos)');
  // D12 INFORME VERAZ: guarda en el código (ningún estado «confirmado» en acd.ts ni en la restricción de la base) y, con al menos un
  // experimento y una decisión, comprobación de que ninguna hipótesis supera «apoyada_provisional», de que cada «apoyada_provisional»
  // tiene su respaldo real (experimento ok a favor con salida intacta + crítica «aceptar» independiente posterior; si no, FAILED: el
  // estado afirma más de lo que hay) y de que ningún experimento consta «ok» sin conservar su salida (PARTIAL mientras no se corrija).
  const src = c.leer(A), restrOk = /apoyada_provisional/.test(c.restriccion) && !/confirm/i.test(c.restriccion);
  const literal = !!src && /['"`](confirmad[oa]s?|confirmed|descubrimiento_confirmado|ley_confirmada)['"`]/i.test(src);
  const exps = c.X.filter((x) => x.estado !== 'ejecutando'), decs = c.H.filter((h) => DECISION.includes(h.estado) && largo(h.motivo_estado, 10)), fuera = c.H.filter((h) => !ESTADOS_HIP.includes(h.estado));
  const sinRespaldo = c.H.filter((h) => h.estado === 'apoyada_provisional' && !respaldada(c, h)), okPerdidos = c.X.filter((x) => x.estado === 'ok' && !salidaOk(c, x));
  if (!src) out.D12 = r('NOT_STARTED', null, 'Falta src/core/acd.ts con la guarda de informe veraz', 'Implementar el motor ACD sin ningún estado «confirmado»');
  else if (literal || !restrOk || fuera.length) out.D12 = r('FAILED', literal ? 'src/core/acd.ts define un estado «confirmado»' : !restrOk ? 'la restricción de acd_hipotesis admite un estado confirmado o no existe' : `hipótesis en estados no permitidos: ${lista(fuera.map((h) => h.id), '#')}`, 'Eliminar cualquier estado de descubrimiento confirmado', 'Corregir la guarda de informe veraz');
  else if (sinRespaldo.length) out.D12 = r('FAILED', `hipótesis apoyada_provisional sin respaldo verificable (experimento ok a favor con salida intacta y crítica «aceptar» independiente posterior): ${lista(sinRespaldo.map((h) => h.id), '#')}`,
    'Un estado de apoyo provisional sin su evidencia presenta especulación como resultado', `Revisar las hipótesis ${lista(sinRespaldo.map((h) => h.id), '#')}: repetir el experimento y la crítica o rebajar su estado`);
  else if (exps.length && decs.length && okPerdidos.length) out.D12 = r('PARTIAL', `${okPerdidos.length} experimento(s) constan ok sin salida.json intacta en disco (${lista(okPerdidos.map((x) => x.id), '#')})`,
    'Un experimento no se puede informar como ejecutado con éxito si sus salidas no se conservan', 'Repetir esos experimentos o marcar que sus salidas se perdieron');
  else if (exps.length && decs.length) out.D12 = r('VERIFIED', `guarda en src/core/acd.ts y acd_hipotesis_estado_check (máximo apoyada_provisional) · ${exps.length} experimento(s), ${decs.length} decisión(es) · 0 hipótesis por encima de apoyada_provisional · ${c.H.filter((h) => h.estado === 'apoyada_provisional').length} apoyada(s) provisional(es), todas con experimento y crítica`, null, null);
  else out.D12 = r('IMPLEMENTED_UNVERIFIED', 'guarda en src/core/acd.ts y acd_hipotesis_estado_check (máximo apoyada_provisional); aún sin experimentos y decisiones que informar', `Falta ${[!exps.length && 'un experimento', !decs.length && 'una decisión con motivo'].filter(Boolean).join(' y ')}`, 'Ejecutar un experimento y decidir sobre su hipótesis');
}

// ---------- Grupo E: primera campaña (campana = C1) ----------
// Cada punto cuenta filas reales de la campaña C1: meta alcanzada → VERIFIED · avance parcial (o actividad relacionada que todavía no
// cuenta, p. ej. un experimento sin salidas) → IN_PROGRESS con cifras · nada → NOT_STARTED.
const meta = (n: number, obj: number, ev: string, falta: string, sig: string, hay = false): Calculo =>
  (n >= obj ? r('VERIFIED', ev, null, null) : n > 0 || hay ? r('IN_PROGRESS', ev, falta, sig) : r('NOT_STARTED', null, falta, sig));
function reglaCampana(c: Ctx, out: Out) {
  const p1 = c.P.filter((q) => esC1(q.campana) && q.estado !== 'descartada'), h1 = c.H.filter((h) => esC1(h.campana)), hid = new Set(h1.map((h) => h.id));
  const m1 = c.M.filter((m) => hid.has(m.hipotesis_id)), mid = new Set(m1.map((m) => m.id)), x1 = c.X.filter((x) => mid.has(x.modelo_id));
  const c1 = c.C.filter((cr) => hid.has(hipDe(c, cr.objeto, cr.objeto_id) as number) && independiente(c, cr)), d1 = decisiones(c).filter((d) => esC1(d.h.campana));
  out.E01 = meta(p1.length, 10, `acd_preguntas C1: ${p1.length}/10 (${lista(p1.map((q) => q.id), '#')})`, `Faltan ${Math.max(0, 10 - p1.length)} preguntas sin resolver`, 'Identificar preguntas abiertas sobre materia, energía, cuántica, información, tiempo o conciencia');
  const tit = new Set(h1.map((h) => corta(h.titulo, 200).toLowerCase()));
  out.E02 = meta(tit.size, 20, `acd_hipotesis C1: ${tit.size}/20 títulos distintos (${h1.length} filas)`, `Faltan ${Math.max(0, 20 - tit.size)} hipótesis distintas`, 'Imaginar hipótesis candidatas para las preguntas de C1');
  const a1 = h1.filter((h) => h.arte >= 20 && h.novedad !== 'sin_revisar');
  out.E03 = meta(a1.length, 20, `${a1.length}/20 hipótesis C1 con arte previo y novedad revisada (${['conocida', 'variante', 'posiblemente_nueva'].map((k) => `${k} ${a1.filter((h) => h.novedad === k).length}`).join(', ')})`, `Faltan ${Math.max(0, 20 - a1.length)} comparaciones con la literatura`, 'Comparar cada hipótesis C1 con la literatura (arte previo)');
  // Seleccionada: lo dice seleccionada_en (043) o el historial («seleccionada»). Solo si la base aún no tiene la 043 se acepta el
  // estado actual o tener modelo: con la 043, formalizar una propuesta sin pasar por seleccionar() no es seleccionarla con criterios
  // (estados como «revisada» nunca bastan: una madre queda revisada al evolucionar). Criterio explícito: texto de criterios o prioridad.
  const s1 = h1.filter((h) => (h.seleccionada_en || c.selHist.has(h.id) || (!c.con043 && (SELECCION.slice(0, 3).includes(h.estado) || m1.some((m) => m.hipotesis_id === h.id))))
    && (h.criterios > 0 || (h.prioridad !== null && h.prioridad !== undefined)));
  out.E04 = meta(s1.length, 5, `${s1.length}/5 hipótesis C1 seleccionadas con criterios explícitos (${s1.filter((h) => h.criterios > 0).length} con criterios escritos, ${s1.filter((h) => h.prioridad !== null && h.prioridad !== undefined).length} con prioridad; ${lista(s1.map((h) => h.id), '#')})`,
    `Faltan ${Math.max(0, 5 - s1.length)} selecciones con criterios`, 'Seleccionar las 5 candidatas mejor priorizadas');
  out.E05 = meta(m1.length, 1, `acd_modelos de C1: ${m1.length} (${lista(m1.map((m) => `${m.id} ${m.tipo}`), '#')})`, 'Ninguna hipótesis C1 formalizada', 'Formalizar una candidata seleccionada');
  const f1 = m1.filter((m) => m.pred >= 10 && m.fals >= 10);
  out.E06 = !m1.length ? r('NOT_STARTED', null, 'Requiere antes un modelo (E05)', 'Formalizar una candidata seleccionada') : f1.length === m1.length
    ? r('VERIFIED', `${f1.length}/${m1.length} modelos C1 con predicciones y criterio de falsación`, null, null)
    : r('IN_PROGRESS', `${f1.length}/${m1.length} modelos C1 con predicciones y criterio de falsación`, `Modelos sin predicción falsable: ${lista(m1.filter((m) => !f1.includes(m)).map((m) => m.id), '#')}`, 'Derivar predicciones falsables de cada modelo C1');
  const o1 = x1.filter((x) => salidaOk(c, x));
  out.E07 = meta(o1.length, 1, `experimentos C1 ok con salidas en disco: ${o1.length} de ${x1.length}${x1.length ? ` (${lista(x1.map((x) => `${x.id} ${x.estado}`), '#')})` : ''}`, 'Ningún experimento C1 ejecutado con salidas conservadas', 'Ejecutar el primer experimento computacional de C1', x1.length > 0);
  const b1 = o1.filter((x) => x.compara);
  out.E08 = meta(b1.length, 1, `experimentos C1 con salidas y comparados con su baseline: ${b1.length} de ${x1.length}${b1.length ? ` (${lista(b1.map((x) => x.id), '#')})` : ''}`, 'Falta comparar un resultado conservado con su baseline', 'Comparar el resultado del experimento con la referencia del modelo', x1.length > 0);
  const todas1 = c.C.filter((cr) => hid.has(hipDe(c, cr.objeto, cr.objeto_id) as number));
  out.E09 = meta(c1.length, 1, `críticas independientes de C1: ${c1.length} de ${todas1.length}${c1.length ? ` (${lista(c1.map((cr) => `${cr.id} ${cr.objeto} ${cr.critico}`), '#')})` : ''}`, 'Falta una crítica independiente de un objeto C1', 'Encargar a Saturno la crítica de un resultado C1', todas1.length > 0);
  const sinBase = h1.filter((h) => DECISION.includes(h.estado) && !d1.some((d) => d.h.id === h.id));
  out.E10 = meta(d1.length, 1, `decisiones C1 tras resultados: ${d1.length}${d1.length ? ` (${d1.slice(0, 4).map((d) => `#${d.h.id} ${d.h.estado} tras ${d.tras}`).join(', ')})` : ''}${sinBase.length ? ` · ${sinBase.length} sin experimento ni crítica previa o sin motivo (no cuentan)` : ''}`, 'Ninguna hipótesis C1 revisada o rechazada según resultados', 'Decidir sobre una hipótesis C1 con su experimento o crítica', sinBase.length > 0);
  // E11: salidas y linaje conservados. Cada experimento C1 terminado ok tiene su carpeta, la huella del código y salida.json intacta
  // (sha256); uno sin éxito que registró carpeta la conserva; ninguna hipótesis C1 apunta a padres inexistentes; y hay al menos uno ok.
  // Los que están ejecutándose no cuentan todavía (no tienen salidas; contarlos haría perder la verificación en cada ejecución).
  const xt = x1.filter((x) => x.estado !== 'ejecutando'), xok = xt.filter((x) => x.estado === 'ok');
  const malos = xt.filter((x) => (x.estado === 'ok' ? !(salidaOk(c, x) && x.sha256_codigo) : !!x.carpeta && !(carpetaOk(c, x) && x.sha256_codigo)));
  const huerfanas = h1.filter((h) => (h.padres ?? []).some((p: number) => !c.Hm.has(p)));
  const ev11 = `${xok.length - malos.filter((x) => x.estado === 'ok').length}/${xok.length} experimentos C1 ok con carpeta, sha256 y salida.json intacta · ${xt.length - xok.length} sin éxito${malos.some((x) => x.estado !== 'ok') ? ` (${malos.filter((x) => x.estado !== 'ok').length} sin su carpeta)` : ''} · linaje: ${h1.filter((h) => (h.padres ?? []).length).length} hipótesis evolucionadas, ${huerfanas.length} con padres inexistentes`;
  out.E11 = !xt.length ? r(x1.length ? 'IN_PROGRESS' : 'NOT_STARTED', x1.length ? `${x1.length} experimento(s) C1 ejecutándose` : null, 'Requiere antes un experimento C1 terminado (E07)', 'Ejecutar el primer experimento computacional de C1')
    : xok.length && !malos.length && !huerfanas.length ? r('VERIFIED', ev11, null, null)
      : r('IN_PROGRESS', ev11, [malos.length && `Sin salidas o huella: ${lista(malos.map((x) => x.id), '#')}`, huerfanas.length && `Linaje roto: ${lista(huerfanas.map((h) => h.id), '#')}`, !xok.length && 'Ningún experimento C1 terminado ok'].filter(Boolean).join('; '),
        malos.length ? 'Repetir los experimentos cuyas salidas no se conservan' : 'Ejecutar un experimento C1 que termine ok y conserve sus salidas');
  // E12: la siguiente pregunta la propone el sistema (Sol, otro agente o el motor ACD), no el propietario ni KRATOS
  const t0 = d1.length ? minT(d1.map((d) => d.cuando)) : null, sig = c.P.filter((q) => (String(q.campana ?? '').trim().toUpperCase() === 'C2' || q.origen === 'curiosidad')
    && !['propietario', 'kratos'].includes(q.origen) && esAutonomo(q.created_by));
  const tras = t0 === null ? [] : sig.filter((q) => t(q.created_at) > t0);
  out.E12 = tras.length ? r('VERIFIED', `pregunta(s) siguiente(s) tras la primera decisión (${f(t0)}): ${lista(tras.map((q) => q.id), '#')}`, null, null)
    : t0 === null ? r(sig.length ? 'IN_PROGRESS' : 'NOT_STARTED', sig.length ? `${sig.length} pregunta(s) C2/curiosidad, pero aún no hay decisión E10` : null, 'Requiere antes una decisión E10', 'Cerrar el ciclo de C1 y proponer la siguiente pregunta')
      : r('NOT_STARTED', null, 'Ninguna pregunta C2 o de curiosidad posterior a la primera decisión', 'Proponer la siguiente pregunta de investigación a partir de los resultados de C1');
}

// ---------- Grupo A: criterios de aceptación (agregan los grupos anteriores) ----------
function agrega(out: Out, ids: string[], etiqueta: string): Calculo {
  const v = ids.filter((i) => out[i].estado === 'VERIFIED'), faltan = ids.filter((i) => out[i].estado !== 'VERIFIED');
  if (!faltan.length) return r('VERIFIED', `${etiqueta}: ${v.length}/${ids.length} verificados`, null, null);
  const sig = `${faltan[0]}: ${out[faltan[0]].siguiente ?? 'conseguir la evidencia'}`;
  if (ids.every((i) => out[i].estado === 'NOT_STARTED')) return r('NOT_STARTED', null, `${etiqueta}: 0/${ids.length} verificados`, sig);
  const otros = ESTADOS.filter((e) => e !== 'VERIFIED').map((e) => [e, ids.filter((i) => out[i].estado === e).length] as const).filter(([, n]) => n).map(([e, n]) => `${n} ${NOMBRE[e]}`);
  return r('PARTIAL', `${etiqueta}: ${v.length}/${ids.length} verificados${v.length ? ` (${lista(v)})` : ''}; ${otros.join(', ')}`, `Faltan ${faltan.length}: ${lista(faltan, '', 10)}`, sig);
}
const espejo = (out: Out, id: string): Calculo => ({ ...out[id], evidencia: out[id].evidencia ? corta(`según ${id}: ${out[id].evidencia}`, 400) : null, pendiente: out[id].pendiente ? `${id}: ${out[id].pendiente}` : null, siguiente: out[id].siguiente ? `${id}: ${out[id].siguiente}` : null });
const conteo = (n: number, obj: number, ev: string, falta: string, sig: string): Calculo => (n >= obj ? r('VERIFIED', ev, null, null) : n > 0 ? r('PARTIAL', ev, falta, sig) : r('NOT_STARTED', null, falta, sig));
// Conectores que nombra una llamada a investigar_sol (solo campos de conector, nunca el texto de la consulta)
const NOMBRES: [RegExp, string][] = [[/openalex/i, 'R01'], [/arxiv/i, 'R02'], [/semantic/i, 'R03'], [/crossref/i, 'R04'], [/pubmed|europe ?pmc|europepmc/i, 'R05'], [/inspire/i, 'R06'], [/osti/i, 'R07'],
  [/nasa|ntrs|\bads\b/i, 'R08'], [/unpaywall/i, 'R09'], [/gutenberg|archive/i, 'R10'], [/hermetic|esoteric/i, 'R11'], [/sacred|iapsop/i, 'R12'], [/esswe|amsterdam|ritman|academic/i, 'R13'], [/manuscri|raro|rare/i, 'R14'], [/sci-?hub|doi_legal/i, 'R15'], [/negativ|retract|preprint/i, 'R16']];
// En el registro del propio código (sol.investigar: {fuentes, resultados, errores}) solo se puede atribuir lo recuperado cuando se
// consultó UN conector, no falló y hubo resultados; en una búsqueda por familia (ciencia, esoterismo, todas) el registro no dice qué
// conector respondió, así que no cuenta (cuentan, en cambio, las fuentes guardadas con su conector).
export function conectoresUsados(d: any): string[] {
  const cod = (v: string) => { const m = v.match(/\bR(0[1-9]|1[0-6])\b/gi); return m ? m.map((x) => x.toUpperCase()) : NOMBRES.filter(([re]) => re.test(v)).map(([, c]) => c); };
  if (!d?.input && Array.isArray(d?.fuentes) && Array.isArray(d?.errores)) {
    const mal = d.errores.map(String), ok = [...new Set(d.fuentes.map(String).flatMap(cod))].filter((c) => !mal.includes(c));
    return Number(d.resultados) > 0 && d.fuentes.length === 1 && ok.length === 1 ? ok : [];
  }
  const i = d?.input ?? d ?? {}, vals = ['conector', 'conectores', 'fuente', 'fuentes', 'codigo', 'codigos'].flatMap((k) => (Array.isArray(i[k]) ? i[k] : i[k] !== undefined ? [i[k]] : [])).map(String);
  return [...new Set(vals.flatMap(cod))];
}
function reglaAceptacion(c: Ctx, out: Out) {
  const de = (p: string) => IDS.filter((i) => i[0] === p), materias = IDS.filter((i) => 'SHV'.includes(i[0]));
  const um = [...c.uni.values()].filter((u) => u.tipo === 'materia' && materias.includes(u.codigo)), ord = new Set(um.map((u) => u.orden));
  // A01: las 56 materias como registros distintos y numerados
  out.A01 = um.length === 56 && ord.size === 56 ? r('VERIFIED', 'sol_unidades: 56/56 materias distintas (S01–S20, H01–H24, V01–V12), orden 1–56 sin repetir', null, null)
    : um.length ? r('PARTIAL', `sol_unidades: ${um.length}/56 materias, ${ord.size} órdenes distintos`, 'Faltan materias o hay órdenes repetidos', 'Volver a sembrar la definición (seedSolDef)') : r('NOT_STARTED', null, 'No hay materias registradas', 'Sembrar la definición (seedSolDef)');
  // A02: módulos 1–4 siguen completados y reutilizados; los absorbidos no se estudian dos veces
  const m14 = [1, 2, 3, 4].filter((n) => c.mod.get(n)?.estado === 'completado'), perdidos = c.au.modCompletados.filter((n) => n <= 4 && c.mod.get(n)?.estado !== 'completado');
  const reuso = [...c.uni.values()].filter((u) => (u.modulos_previos ?? []).length).sort((a, b) => a.codigo.localeCompare(b.codigo)), usados = new Set(reuso.flatMap((u) => u.modulos_previos));
  const fusPend = Object.keys(FUSION_MODULOS).map(Number).filter((n) => c.mod.get(n)?.estado === 'pendiente'), fus = [...c.mod.values()].filter((m) => m.estado === 'fusionado');
  const dup = Object.entries(FUSION_MODULOS).filter(([n, cod]) => c.mod.get(Number(n))?.estado === 'en_curso' && ['en_curso', 'estudiada', 'evaluada'].includes(c.uni.get(cod)?.estado)).map(([n]) => Number(n));
  const rotos = fus.filter((m) => !c.uni.has(m.fusionado_en)), problemas = [m14.length < 4 && `módulos ${[1, 2, 3, 4].filter((n) => !m14.includes(n)).join(', ')} no constan completados`,
    m14.some((n) => !usados.has(n)) && `módulos completados sin reutilizar: ${m14.filter((n) => !usados.has(n)).join(', ')}`, fusPend.length && `${fusPend.length} módulo(s) absorbido(s) aún pendientes (se estudiarían dos veces)`,
    dup.length && `módulos ${dup.join(', ')} en curso a la vez que su materia`, rotos.length && `${rotos.length} fusión(es) hacia una materia inexistente`].filter(Boolean) as string[];
  const evA02 = `sol_modulos completados ${m14.join(', ') || 'ninguno'}${m14.map((n) => c.mod.get(n)?.proyecto_id).filter(Boolean).map((x) => ` P${x}`).join(',')} · reutilizados en ${reuso.map((u) => `${u.codigo}←${u.modulos_previos.join(',')}`).join('; ') || 'ninguna materia'} · ${fus.length} fusionados`;
  out.A02 = !c.mod.size ? r('NOT_STARTED', null, 'No hay currículo anterior registrado (sol_modulos)', 'Aplicar las migraciones del currículo')
    : perdidos.length ? r('FAILED', `módulos ${perdidos.join(', ')} constaban completados (audit omega.modulo_completado) y ya no lo están`, 'Restaurar los módulos completados perdidos', 'Restaurar desde la copia de seguridad los módulos perdidos')
      : problemas.length ? r('PARTIAL', evA02, cap(problemas.join('; ')), m14.length < 4 ? 'Completar (o restaurar) los módulos 1–4 del currículo anterior' : 'Volver a sembrar la definición para reutilizar y fusionar los módulos')
        : r('VERIFIED', `${evA02}, 0 duplicados`, null, null);
  out.A03 = agrega(out, [...materias].sort((a, b) => (c.uni.get(a)?.orden ?? 99) - (c.uni.get(b)?.orden ?? 99)), 'materias con examen aprobado');   // en el orden del planificador
  out.A04 = agrega(out, de('R'), 'conectores probados en vivo');
  // A05: procedencia de las fuentes de conectores (≥ 20 completas) y grado de lectura real registrado sobre texto completo (≥ 3 con
  // avance contiguo leido_hasta/longitud). Un resumen recuperado o un «texto_completo» declarado sin lectura no cuentan.
  const lec = c.fu.lecturas as string[], evA05 = `sol_fuentes: ${c.fu.procedencia}/${c.fu.de_conector} de conectores con procedencia completa (${(c.fu.conectores ?? []).sort().join(', ') || 'ningún conector'}) · ${lec.length} con lectura real registrada${lec.length ? ` (${lista(lec, '#', 4)})` : ''}, ${c.fu.enteras} leídas enteras${c.fu.declaradas ? ` · ${c.fu.declaradas} declaradas texto_completo sin lectura registrada (no cuentan)` : ''}${c.fu.inexactas ? ` · ${c.fu.inexactas} con leido_hasta mayor que su longitud (no cuentan)` : ''}`;
  // «con exactitud»: mientras haya registros de lectura inexactos (más leído que la longitud) o fuentes declaradas texto_completo sin
  // lectura registrada, el grado de lectura no se registra con exactitud y A05 no se verifica.
  const inexacto = c.fu.inexactas + c.fu.declaradas;
  out.A05 = c.fu.procedencia >= 20 && lec.length >= 3 && !inexacto ? r('VERIFIED', evA05, null, null) : c.fu.de_conector + lec.length + inexacto > 0
    ? r('PARTIAL', evA05, c.fu.procedencia >= 20 && lec.length >= 3 ? `Corregir ${inexacto} registro(s) de lectura inexactos (leido_hasta > longitud o texto_completo declarado sin lectura)`
      : `Faltan ${Math.max(0, 20 - c.fu.procedencia)} fuentes de conectores con procedencia completa y ${Math.max(0, 3 - lec.length)} lecturas de texto completo registradas${inexacto ? `; corregir ${inexacto} registro(s) de lectura inexactos` : ''}`,
      'Registrar fuentes por los conectores con su procedencia y leer textos abiertos con leer_texto')
    : r('NOT_STARTED', null, 'Ninguna fuente traída por un conector ni lectura registrada', 'Ingerir las primeras fuentes por los conectores');
  // A06: la interfaz unificada (su código existe) recuperó material de un conector científico y de otro esotérico. Cuenta lo que
  // registró el propio código (sol.investigar sin error, o fuentes guardadas con su conector); una llamada a la herramienta sola
  // solo demuestra que se usó (PARTIAL), no que trajera nada.
  const llam = c.au.investigar;
  const exito = new Set([...c.au.unConector, ...(c.fu.conectores ?? [])]), cod6 = c.existe('src/core/conectores.ts');
  const ci = CIENCIA.filter((x) => exito.has(x)), eso = ESOTERICO.filter((x) => exito.has(x));
  // lo que se PIDIÓ por la herramienta (conectores o familias): demuestra uso, no recuperación
  const pedido = new Set(llam.flatMap((a) => { const fz = String(a.details?.input?.fuente ?? '').trim().toLowerCase(); return [...conectoresUsados(a.details), ...(['ciencia', 'esoterismo', 'todas'].includes(fz) ? [fz] : [])]; }));
  const usoCi = pedido.has('ciencia') || pedido.has('todas') || CIENCIA.some((x) => pedido.has(x)), usoEso = pedido.has('esoterismo') || pedido.has('todas') || ESOTERICO.some((x) => pedido.has(x));
  const evA06 = `interfaz unificada: ${c.au.nBusq} búsqueda(s) sol.investigar, ${c.au.nLlam} llamada(s) a la herramienta${llam.length ? ` (pedido ciencia ${usoCi ? 'sí' : 'no'}, esoterismo ${usoEso ? 'sí' : 'no'})` : ''} · recuperado de ciencia ${ci.join(', ') || 'ninguno'} · esoterismo ${eso.join(', ') || 'ninguno'}${cod6 ? '' : ' · falta el código src/core/conectores.ts'}`;
  out.A06 = ci.length && eso.length && cod6 ? r('VERIFIED', evA06, null, null)
    : c.au.nBusq + c.au.nLlam || exito.size ? r('PARTIAL', evA06, ci.length && eso.length ? 'Falta el código de la interfaz (src/core/conectores.ts)' : `Falta recuperar material de un conector ${ci.length ? 'esotérico (R10–R14)' : 'científico (R01–R09, R16)'}`, 'Investigar un mismo tema por los conectores científico y esotérico')
    : cod6 ? r('IMPLEMENTED_UNVERIFIED', 'código src/core/conectores.ts presente; investigar_sol sin uso registrado', 'Usar investigar_sol contra un conector científico y otro esotérico', 'Lanzar una investigación unificada de prueba')
      : r('NOT_STARTED', null, 'Falta la interfaz de investigación unificada', 'Implementar investigar_sol sobre los conectores');
  // A07: grafo con naturaleza en todas las conexiones y al menos 10 entre dos materias S/H/V distintas (un enlace con un puente B o un
  // tema G no conecta materias: es de las etapas 2 y 3)
  const evA07 = `sol_conexiones: ${c.cx.total} (evidencia ${c.cx.evidencia}, interpretación ${c.cx.interpretacion}, especulación ${c.cx.especulacion}, sin naturaleza ${c.cx.sin_naturaleza}) · ${c.cx.enlazan} enlazan materias`;
  out.A07 = !c.cx.total ? r('NOT_STARTED', null, 'El grafo no tiene conexiones', 'Registrar conexiones entre materias con su naturaleza') : !c.cx.sin_naturaleza && c.cx.enlazan >= 10 ? r('VERIFIED', evA07, null, null)
    : r('PARTIAL', evA07, `${c.cx.sin_naturaleza ? `${c.cx.sin_naturaleza} conexión(es) sin naturaleza; ` : ''}faltan ${Math.max(0, 10 - c.cx.enlazan)} conexiones entre códigos de materia`, 'Registrar conexiones con tema_desde y tema_hacia');
  // A08: el progreso sobrevive a un reinicio y KRATOS lo recupera después
  const datos = minT([...[...c.uni.values()].map((u) => t(u.lanzado_en)), ...[...c.proByReq.values()].map((p) => t(p.created_at)), ...[...c.exa.values()].flat().map((e) => t(e.created_at)), ...[...c.pru.values()].map((p) => t(p.probado_en))]);
  const kUlt = maxT(c.au.kratos.map((a) => t(a.ultimo))), rein8 = Number.isFinite(datos) ? reinicioTras(c, datos) : null, reinAntes = Number.isFinite(datos) ? reinicioTras(c, datos, kUlt) : null;
  out.A08 = reinAntes ? r('VERIFIED', `datos de Sol desde ${f(datos)} · reinicio ${f(reinAntes)} · recuperados después por KRATOS (${c.au.kratos.map((a) => a.action.replace('herramienta.', '')).join(', ')}, ${f(kUlt)})`, null, null)
    : rein8 || c.au.kratos.length ? r('PARTIAL', `${rein8 ? `reinicio ${f(rein8)} tras datos de ${f(datos)}` : 'sin reinicio posterior a los datos'} · ${c.au.kratos.length ? `KRATOS consultó ${f(kUlt)}` : 'KRATOS no ha consultado'}`, 'Falta que KRATOS recupere el progreso después de un reinicio', 'Que KRATOS consulte requisitos_sol tras el próximo reinicio')
      : r('NOT_STARTED', null, 'Sin progreso que haya pasado por un reinicio ni consultas de KRATOS', 'Avanzar el planificador y consultar desde KRATOS tras un reinicio');
  // A09: los 12 puentes registrados y enlazados con materias de la etapa 1
  const pu = de('B').filter((b) => (c.uni.get(b)?.relacionadas ?? []).some((x: string) => c.uni.get(x)?.tipo === 'materia'));
  out.A09 = conteo(pu.length, 12, `sol_unidades: ${pu.length}/12 puentes enlazados con materias (${de('B').filter((b) => pu.includes(b)).map((b) => `${b}→${(c.uni.get(b).relacionadas ?? []).join('+')}`).slice(0, 3).join('; ')}${pu.length > 3 ? '; …' : ''})`, 'Faltan puentes o sus enlaces con materias', 'Volver a sembrar la definición (seedSolDef)');
  out.A10 = agrega(out, de('B'), 'puentes con expediente completo');
  // A11: preguntas que combinan unidades de áreas distintas (un puente aporta las áreas de sus materias)
  const areasDe = (cod: string): string[] => { const u = c.uni.get(cod); return !u ? [] : u.tipo === 'puente' ? (u.relacionadas ?? []).map((x: string) => c.uni.get(x)?.area).filter(Boolean) : [u.area]; };
  // «SOL genera»: preguntas creadas por Sol, otro agente o el motor ACD (no por el propietario ni por KRATOS)
  const cruz = c.P.filter((q) => !['propietario', 'kratos'].includes(q.origen) && esAutonomo(q.created_by) && new Set((q.unidades ?? []).flatMap(areasDe)).size >= 2);
  out.A11 = conteo(cruz.length, 3, `acd_preguntas interdisciplinares: ${cruz.length} (${lista(cruz.map((q) => `${q.id} ${(q.unidades ?? []).join('+')}`), '#', 4)})`, `Faltan ${Math.max(0, 3 - cruz.length)} preguntas que combinen áreas distintas`, 'Formular preguntas ACD que crucen ciencia y tradición desde un puente');
  // A12: afirmaciones H junto a A–E, hipótesis con enunciado separado del mecanismo y un puente con conclusión
  const bConc = [...c.proById.values()].filter((p) => p.tipo === 'puente' && p.conclusion > 0 && archivos(p)), malSep = c.H.filter((h) => !h.separa);
  const evA12 = `sol_afirmaciones: ${c.af.h} de nivel H, ${c.af.ae} de A–E · ${c.H.length - malSep.length}/${c.H.length} hipótesis con enunciado distinto del mecanismo · ${bConc.length} puente(s) con conclusión${bConc.length ? ` (${lista(bConc.map((p) => p.id), 'P')})` : ''}`;
  out.A12 = c.af.h >= 5 && c.af.ae >= 1 && bConc.length >= 1 && !malSep.length ? r('VERIFIED', evA12, null, null) : c.af.h + c.af.ae + bConc.length + c.H.length > 0
    ? r('PARTIAL', evA12, [c.af.h < 5 && `faltan ${5 - c.af.h} afirmaciones H`, !c.af.ae && 'falta una afirmación A–E', !bConc.length && 'falta un puente con conclusión', malSep.length && `${malSep.length} hipótesis sin separar enunciado y mecanismo`].filter(Boolean).join('; '), 'Completar un puente distinguiendo tradición (H) de evidencia (A–E)')
    : r('NOT_STARTED', null, 'Sin afirmaciones, hipótesis ni puentes', 'Completar el primer puente');
  // A13: hipótesis o preguntas documentadas con procedencia y comprobación de originalidad
  const h13 = c.H.filter((h) => ((h.fuente_ids ?? []).length > 0 || h.arte >= 20) && h.novedad !== 'sin_revisar');
  const q13 = c.P.filter((q) => (q.fuente_ids ?? []).length > 0 && c.H.some((h) => h.pregunta_id === q.id && h.novedad !== 'sin_revisar'));
  out.A13 = conteo(h13.length + q13.length, 12, `${h13.length} hipótesis y ${q13.length} preguntas con procedencia y novedad revisada (${h13.length + q13.length}/12)`, `Faltan ${Math.max(0, 12 - h13.length - q13.length)} con procedencia y comprobación de originalidad`, 'Revisar el arte previo y la novedad de las hipótesis abiertas');
  // A14: crítica independiente de al menos 3 de las 5 hipótesis mejor priorizadas (o de sus modelos y experimentos)
  const top = c.H.filter((h) => h.prioridad !== null && h.prioridad !== undefined).sort((a, b) => Number(b.prioridad) - Number(a.prioridad) || a.id - b.id).slice(0, 5);
  const crit = top.filter((h) => c.C.some((cr) => hipDe(c, cr.objeto, cr.objeto_id) === h.id && independiente(c, cr)));
  out.A14 = conteo(crit.length, 3, `${crit.length} de las ${top.length} mejor priorizadas con crítica independiente (${lista(crit.map((h) => h.id), '#')})`, `Faltan ${Math.max(0, 3 - crit.length)} críticas independientes de candidatas fuertes`, 'Encargar a Saturno la crítica de las candidatas mejor priorizadas');
  // A15: KRATOS usó acd, grafo o requisitos después de que existiera un puente completo
  const b0 = minT([...c.proById.values()].filter((p) => p.tipo === 'puente' && archivos(p)).map((p) => t(p.created_at))), k15 = c.au.kratos.filter((a) => Number.isFinite(b0) && t(a.ultimo) > b0);
  out.A15 = k15.length ? r('VERIFIED', `puente completo desde ${f(b0)} · KRATOS después: ${k15.map((a) => `${a.action.replace('herramienta.', '')} ${f(a.ultimo)}`).join(', ')}`, null, null)
    : Number.isFinite(b0) || c.au.kratos.length ? r('PARTIAL', Number.isFinite(b0) ? `puente completo desde ${f(b0)}; KRATOS no lo ha consultado después` : `KRATOS consultó (${f(kUlt)}) pero aún no hay ningún puente completo`, 'Falta que KRATOS recupere la investigación interdisciplinar', 'Que el ciclo CEO consulte los puentes con requisitos_sol o grafo')
      : r('NOT_STARTED', null, 'Ni puentes completos ni consultas de KRATOS', 'Completar un puente y consultarlo desde KRATOS');
  out.A16 = espejo(out, 'G01');
  out.A17 = agrega(out, ['G02', 'G03'], 'Noyron y PicoGK');
  out.A18 = agrega(out, de('G').slice(3, 11), 'métodos G04–G11');
  out.A19 = agrega(out, ['D01', 'D02', 'D03', 'D04'], 'capacidades D01–D04');
  out.A20 = espejo(out, 'D05');
  // A21: al menos una hipótesis formalizada en un modelo ejecutable (código íntegro)
  const m21 = c.M.filter((m) => m.sha_ok && m.cod > 0);
  out.A21 = m21.length ? r('VERIFIED', `acd_modelos con código íntegro (sha256): ${lista(m21.map((m) => `${m.id}→H${m.hipotesis_id}`), '#')}`, null, null)
    : c.M.length ? r('PARTIAL', `acd_modelos: ${c.M.length}, ninguno con sha256 que coincida con su código`, 'Ningún modelo íntegro', 'Volver a registrar el modelo con su código') : r('NOT_STARTED', null, 'Ninguna hipótesis formalizada', 'Formalizar la hipótesis mejor priorizada');
  out.A22 = espejo(out, 'D03');
  // A23: crítica independiente de los RESULTADOS: de un experimento terminado o del modelo de un experimento terminado, hecha después
  // de que el experimento acabara (criticar un modelo antes de ejecutarlo no es evaluar resultados)
  const tras = (x: any, cr: any) => !!x && x.estado !== 'ejecutando' && finDe(x) <= t(cr.created_at);
  const c23 = c.C.filter((cr) => independiente(c, cr) && (cr.objeto === 'experimento' ? tras(c.Xm.get(cr.objeto_id), cr) : cr.objeto === 'modelo' && c.X.some((x) => x.modelo_id === cr.objeto_id && tras(x, cr))));
  out.A23 = c23.length ? r('VERIFIED', `críticas independientes de resultados: ${lista(c23.map((cr) => `${cr.id} ${cr.objeto} ${cr.objeto_id} por ${cr.critico}`), '#', 4)}`, null, null)
    : c.X.length ? r('PARTIAL', `${c.X.length} experimento(s) sin crítica independiente`, 'Falta la crítica de un resultado', 'Encargar a Saturno la crítica del último experimento') : r('NOT_STARTED', null, 'Sin experimentos que criticar', 'Ejecutar un experimento');
  // A24: revisión, rechazo o evolución de una hipótesis después de un experimento
  const d24 = decisiones(c, true), hijos = c.H.filter((h) => (h.padres ?? []).some((p: number) => experimentosDe(c, p).some((x) => salidaOk(c, x) && finDe(x) <= t(h.created_at))));
  out.A24 = d24.length + hijos.length ? r('VERIFIED', [d24.length && `decisiones tras experimento: ${d24.slice(0, 4).map((d) => `#${d.h.id} ${d.h.estado} tras ${d.tras}`).join(', ')}`, hijos.length && `hipótesis derivadas tras un experimento: ${lista(hijos.map((h) => h.id), '#')}`].filter(Boolean).join(' · '), null, null)
    : c.X.length ? r('PARTIAL', `${c.X.length} experimento(s) sin decisión posterior`, 'Falta decidir sobre una hipótesis con su resultado', 'Revisar la hipótesis del último experimento') : r('NOT_STARTED', null, 'Sin experimentos', 'Ejecutar un experimento');
  // A25: la memoria ACD sobrevive a un reinicio
  const ini = primeraFilaAcd(c), r25 = Number.isFinite(ini) ? reinicioTras(c, ini) : null;
  out.A25 = r25 ? r('VERIFIED', `primera fila ACD ${f(ini)} · reinicio ${f(r25)} · ${c.P.length + c.H.length + c.M.length + c.X.length + c.C.length} filas ACD conservadas`, null, null)
    : Number.isFinite(ini) ? r('PARTIAL', `memoria ACD desde ${f(ini)}; aún sin reinicio posterior`, 'Falta comprobarla tras un reinicio', 'Comprobar la memoria ACD tras el próximo reinicio') : r('NOT_STARTED', null, 'Sin memoria ACD', 'Registrar la primera pregunta ACD');
  out.A26 = espejo(out, 'D09');
  // A27: los 12 puntos de la campaña existen en el rastreador y tienen evidencia calculada
  const e = de('E'), conEv = e.filter((i) => out[i].evidencia);
  out.A27 = conEv.length === 12 ? r('VERIFIED', `E01–E12 rastreados con evidencia calculada (${e.filter((i) => out[i].estado === 'VERIFIED').length}/12 verificados)`, null, null)
    : conEv.length ? r('PARTIAL', `${conEv.length}/12 puntos de la campaña con evidencia (${lista(conEv)})`, `Sin evidencia todavía: ${lista(e.filter((i) => !out[i].evidencia), '', 12)}`, `${e.find((i) => !out[i].evidencia)}: ${out[e.find((i) => !out[i].evidencia)!].siguiente}`)
      : r('IMPLEMENTED_UNVERIFIED', 'sol_requisitos E01–E12 calculados en cada refresco; la campaña aún no tiene evidencia', 'Que la campaña C1 produzca evidencia punto por punto', 'Lanzar la campaña C1 (E01)');
}

export function calcular(c: Ctx): Out {
  const out: Out = {};
  reglaMaterias(c, out); reglaConectores(c, out); reglaPuentesGenerativas(c, out); reglaCapacidades(c, out); reglaCampana(c, out); reglaAceptacion(c, out);
  for (const id of IDS) {
    if (!out[id]) throw new Error(`Requisito sin regla: ${id}`);
    // guarda final: un VERIFIED sin evidencia concreta no se escribe nunca (si una regla fallara, el requisito baja, no sube)
    if (out[id].estado === 'VERIFIED' && !(out[id].evidencia && out[id].evidencia!.length > 10))
      out[id] = r('IMPLEMENTED_UNVERIFIED', out[id].evidencia, 'La regla dio VERIFIED sin evidencia concreta: no se acepta', out[id].siguiente ?? 'Revisar la regla de este requisito');
  }
  return out;
}

// ---------- Refresco ----------
// Recalcula TODOS los identificadores y escribe sol_requisitos. Solo toca las filas que cambian; cada cambio de estado queda en
// audit_log (sol.requisito_cambio). verificado_en solo existe mientras el estado es VERIFIED y conserva la primera fecha.
export async function refreshRequisitos(db: Db, o: OpcionesReq = {}): Promise<{ total: number; por_estado: Record<Estado, number>; cambios: { id: string; de: string | null; a: Estado }[] }> {
  if ((await db.query(`SELECT count(*)::int AS n FROM sol_requisitos WHERE id = ANY($1)`, [IDS])).rows[0].n < TOTAL_REQUISITOS) await seedSolDef(db);
  return withTx(db, async (tx) => {
    // dos refrescos a la vez no duplican la auditoría. Clave propia: la 7443 la usa acd.ts (altas y evolución de hipótesis) y la 7441 sol-def.ts
    await tx.query('SELECT pg_advisory_xact_lock(7446)');
    const c = await cargar(tx, o), out = calcular(c), actor = o.actor ?? 'kratos (requisitos)';
    const prev = new Map((await tx.query(`SELECT id, estado, evidencia, verificado_en, pendiente, siguiente FROM sol_requisitos WHERE id = ANY($1)`, [IDS])).rows.map((x) => [x.id, x]));
    const cambios: { id: string; de: string | null; a: Estado }[] = [];
    for (const id of IDS) {
      const a = out[id], p = prev.get(id);
      const ver = a.estado === 'VERIFIED' ? (p?.estado === 'VERIFIED' && p.verificado_en ? p.verificado_en : c.ahora) : null;
      const mismaFecha = (p?.verificado_en ? t(p.verificado_en) : null) === (ver ? t(ver) : null);
      if (p && p.estado === a.estado && p.evidencia === a.evidencia && p.pendiente === a.pendiente && p.siguiente === a.siguiente && mismaFecha) continue;
      await tx.query(`UPDATE sol_requisitos SET estado = $2, evidencia = $3, verificado_en = $4, pendiente = $5, siguiente = $6, updated_at = now() WHERE id = $1`, [id, a.estado, a.evidencia, ver, a.pendiente, a.siguiente]);
      if (p?.estado !== a.estado) {
        cambios.push({ id, de: p?.estado ?? null, a: a.estado });
        await audit(tx, actor, 'sol.requisito_cambio', { id, de: p?.estado ?? null, a: a.estado, evidencia: a.evidencia });
      }
    }
    const por_estado = Object.fromEntries(ESTADOS.map((e) => [e, IDS.filter((i) => out[i].estado === e).length])) as Record<Estado, number>;
    return { total: IDS.length, por_estado, cambios };
  });
}

// ---------- Lectura, resumen, exportación e informe ----------
async function filas(db: Q) {
  const m = new Map((await db.query(`SELECT id, etapa, grupo, descripcion, estado, evidencia, verificado_en, pendiente, siguiente, updated_at FROM sol_requisitos WHERE id = ANY($1)`, [IDS])).rows.map((x) => [x.id, x]));
  return REQUISITOS.map((d) => m.get(d.id) ?? { ...d, estado: 'NOT_STARTED', evidencia: null, verificado_en: null, pendiente: 'Sin sembrar en sol_requisitos', siguiente: null, updated_at: null });
}
const etapaActual = (fs_: any[]) => [1, 2, 3].find((e) => fs_.some((x) => x.etapa === e && x.estado !== 'VERIFIED')) ?? null;

export async function resumenRequisitos(db: Db) {
  const fl = await filas(db), cuenta = (xs: any[]) => Object.fromEntries(ESTADOS.map((e) => [e, xs.filter((x) => x.estado === e).length]));
  const grupos = [...new Set(REQUISITOS.map((x) => x.grupo))];
  return {
    total: fl.length, por_estado: cuenta(fl),
    por_grupo: Object.fromEntries(grupos.map((g) => { const xs = fl.filter((x) => x.grupo === g); return [g, { total: xs.length, verificados: xs.filter((x) => x.estado === 'VERIFIED').length, ...Object.fromEntries(Object.entries(cuenta(xs)).filter(([, n]) => n)) }]; })),
    en_progreso: fl.filter((x) => x.estado === 'IN_PROGRESS').map((x) => x.id), bloqueados: fl.filter((x) => x.estado === 'BLOCKED').map((x) => x.id), fallidos: fl.filter((x) => x.estado === 'FAILED').map((x) => x.id),
    etapas: Object.fromEntries([1, 2, 3].map((e) => { const xs = fl.filter((x) => x.etapa === e), v = xs.filter((x) => x.estado === 'VERIFIED').length; return [e, { nombre: ETAPAS[e], total: xs.length, verificados: v, pct: Math.round((v / xs.length) * 100) }]; })),
    etapa_actual: etapaActual(fl), actualizado: fl.reduce((m: any, x) => (x.updated_at && (!m || x.updated_at > m) ? x.updated_at : m), null),
    aviso: `La directiva habla de 139 identificadores, pero su enumeración suma ${TOTAL_REQUISITOS}: se rastrean todos. Ningún estado VERIFIED existe sin evidencia calculada por el código.`,
  };
}

const celda = (s: unknown) => (s === null || s === undefined || s === '' ? '—' : String(s).replace(/\|/g, '\\|').replace(/\s+/g, ' ').trim());
// Escribe docs/SOL-REQUISITOS.md (tabla legible) y docs/sol-requisitos.json (lista completa). Orden de la directiva y sin marcas de
// tiempo propias: dos exportaciones del mismo estado producen exactamente los mismos bytes.
export async function exportRequisitos(db: Db, dir = 'docs') {
  const fl = await filas(db), res = await resumenRequisitos(db), out = path.isAbsolute(dir) ? dir : path.join(ROOT, dir);
  const por = ESTADOS.map((e) => `${e} ${res.por_estado[e]}`).join(' · '), et = [1, 2, 3].map((e) => `etapa ${e}: ${res.etapas[e].verificados}/${res.etapas[e].total}`).join(' · ');
  const md = [`# SOL — Rastreador de requisitos (PROJECT SOL / ACD)`, '',
    'Generado por `src/core/requisitos.ts` desde la tabla `sol_requisitos`; no se edita a mano. Especificación: `docs/SOL-DIRECTIVA-ACD.md`.',
    `Los estados los calcula el código a partir de evidencia real; VERIFIED nunca existe sin evidencia. La directiva habla de 139 identificadores, pero su enumeración suma ${TOTAL_REQUISITOS} y se rastrean todos.`, '',
    `**Total:** ${fl.length} · ${por}`, '', `**Verificados por etapa:** ${et} · etapa actual: ${res.etapa_actual ?? 'todas verificadas'}`, ''];
  for (const g of [...new Set(REQUISITOS.map((x) => x.grupo))]) {
    const xs = fl.filter((x) => x.grupo === g);
    md.push(`## ${g} (${xs[0].id}–${xs.at(-1).id}) · ${xs.filter((x) => x.estado === 'VERIFIED').length}/${xs.length} verificados`, '', '| id | etapa | estado | evidencia | verificado | pendiente | siguiente |', '|---|---|---|---|---|---|---|');
    for (const x of xs) md.push(`| ${x.id} · ${celda(corta(String(x.descripcion).split(':')[0], 60))} | ${x.etapa} | ${x.estado} | ${celda(x.evidencia)} | ${x.verificado_en ? f(x.verificado_en) : '—'} | ${celda(x.pendiente)} | ${celda(x.siguiente)} |`);
    md.push('');
  }
  const json = { fuente: 'sol_requisitos (src/core/requisitos.ts)', especificacion: 'docs/SOL-DIRECTIVA-ACD.md', total: fl.length, por_estado: res.por_estado, etapas: res.etapas, etapa_actual: res.etapa_actual,
    requisitos: fl.map((x) => ({ id: x.id, etapa: x.etapa, grupo: x.grupo, descripcion: x.descripcion, estado: x.estado, evidencia: x.evidencia ?? null, verificado_en: x.verificado_en ? new Date(x.verificado_en).toISOString() : null, pendiente: x.pendiente ?? null, siguiente: x.siguiente ?? null })) };
  fs.mkdirSync(out, { recursive: true });
  const mdPath = path.join(out, 'SOL-REQUISITOS.md'), jsonPath = path.join(out, 'sol-requisitos.json');
  fs.writeFileSync(mdPath, `${md.join('\n').trimEnd()}\n`); fs.writeFileSync(jsonPath, `${JSON.stringify(json, null, 2)}\n`);
  return { md: mdPath, json: jsonPath, total: fl.length };
}

// Frase concreta para el informe a partir de un cambio de estado auditado
function accion(id: string, de: Estado | null, a: Estado): string {
  if (de && RANGO[a] < RANGO[de]) return `Baja de ${NOMBRE[de]} a ${NOMBRE[a]}: la evidencia ya no lo sostiene`;
  const p = id[0], mat = 'SHV'.includes(p);
  if (a === 'VERIFIED') return ({ R: 'Conector probado en vivo', B: 'Puente hermético-científico completo y enlazado con ACD', G: 'Investigación generativa entregada y legible', D: 'Capacidad ACD comprobada en ejecución', E: 'Punto de la campaña C1 cumplido', A: 'Criterio de aceptación cumplido' } as Record<string, string>)[p] ?? 'Materia aprobada en examen independiente';
  if (a === 'IMPLEMENTED_UNVERIFIED') return mat ? 'Expediente de la materia entregado; falta el examen independiente' : p === 'R' ? 'Conector implementado; falta una prueba en vivo vigente' : 'Implementado; falta verificarlo en ejecución';
  return ({ IN_PROGRESS: mat ? 'Estudio de la materia en curso' : 'Trabajo en curso', PARTIAL: 'Avance parcial', BLOCKED: 'Bloqueado', FAILED: 'Intento fallido registrado', NOT_STARTED: 'Sin iniciar' } as Record<string, string>)[a];
}

// Siguiente paso de los tres planificadores, que trabajan en paralelo (imitan su orden sin importarlos ni lanzar nada):
//  · exámenes (curriculo.ts): primero un examen abierto (Sol responde / Saturno califica); después la materia estudiada más antigua
//    sin examen calificado de este estudio (las que reutilizan módulos completados, S12/S13, van primero);
//  · estudio (curriculo.ts): un estudio cada vez; antes los módulos antiguos que son requisito de una materia, cada 5.º lanzamiento
//    un módulo antiguo no fusionado y, si no, la siguiente materia pendiente por orden;
//  · motor ACD (acd.ts, si existe): la unidad B/G en curso, el primer punto sin verificar de la campaña C1, la siguiente unidad
//    B/G pendiente (alternando) y, al final, la curiosidad autónoma.
// Respeta la parada de emergencia y las cuotas a cero. Devuelve una sola oración.
async function siguienteAutonoma(db: Db, c: Ctx, fl: any[]): Promise<string> {
  const st = await getState(db), h = await isHalted(db), cupo = (k: string) => Number(st[k] ?? 4), tit = (cod: string) => `${cod} (${c.uni.get(cod)?.titulo ?? cod})`;
  const us = [...c.uni.values()].sort((a, b) => a.orden - b.orden || a.codigo.localeCompare(b.codigo)), mats = us.filter((u) => u.tipo === 'materia');
  const pausa = (k: string, txt: string) => (cupo(k) > 0 ? '' : ` (${txt} en pausa: ${k} = 0)`);
  // exámenes
  const exAb = [...c.exa.values()].flat().filter((e) => ABIERTO.includes(e.estado) && c.uni.get(e.unidad)?.estado === 'estudiada').sort((a, b) => a.id - b.id)[0];
  const sinEx = mats.filter((u) => u.estado === 'estudiada' && !(c.exa.get(u.codigo) ?? []).some((e) => e.estado === 'calificado' && deEsteEstudio(u, e)))
    .sort((a, b) => (a.completado_en ? t(a.completado_en) : -Infinity) - (b.completado_en ? t(b.completado_en) : -Infinity) || a.orden - b.orden)[0];
  const examen = exAb ? (exAb.estado === 'respondido' ? `Saturno califica el examen #${exAb.id} de ${tit(exAb.unidad)}` : `Sol responde el examen #${exAb.id} de ${tit(exAb.unidad)}`)
    : sinEx ? `Saturno crea el examen de dominio de ${tit(sinEx.codigo)}${(sinEx.modulos_previos ?? []).length ? ' a partir de los módulos ya completados' : ''}${pausa('sol_examenes_dia', 'exámenes')}` : null;
  // estudio
  const mods = [...c.mod.values()], modTxt = (m: any) => `el módulo antiguo ${m.n} (${m.titulo})`;
  const modCurso = mods.find((m) => m.estado === 'en_curso'), matCurso = mats.find((u) => u.estado === 'en_curso');
  const libres = mods.filter((m) => m.estado === 'pendiente' && !m.fusionado_en), previos = new Set(us.flatMap((u) => u.modulos_previos ?? []));
  const modPrevio = libres.find((m) => previos.has(m.n)), sigMat = mats.find((u) => u.estado === 'pendiente');
  const turnoModulo = libres.length > 0 && (Number(st.sol_estudio_lanzamientos ?? 0) + 1) % CADA_MODULO === 0;
  const estudio = modCurso ? `Sol termina ${modTxt(modCurso)}${modCurso.tarea_id ? ` (tarea #${modCurso.tarea_id})` : ''}`
    : matCurso ? `Sol termina la materia ${tit(matCurso.codigo)}${matCurso.tarea_id ? ` (tarea #${matCurso.tarea_id})` : ''}`
      : modPrevio || (turnoModulo && libres[0]) ? `Sol estudia ${modTxt(modPrevio ?? libres[0])}${pausa('omega_modulos_dia', 'estudio')}`
        : sigMat ? `Sol empieza la materia ${tit(sigMat.codigo)}${pausa('omega_modulos_dia', 'estudio')}`
          : libres[0] ? `Sol estudia ${modTxt(libres[0])}${pausa('omega_modulos_dia', 'estudio')}` : null;
  // motor ACD
  let acd: string | null = null;
  if (c.existe('src/core/acd.ts')) {
    const clase = (u: any) => (u.tipo === 'puente' ? 'el puente' : 'el tema generativo');
    const bgCurso = us.find((u) => u.tipo !== 'materia' && u.estado === 'en_curso'), e = REQUISITOS.find((x) => x.id[0] === 'E' && fl.find((y) => y.id === x.id)?.estado !== 'VERIFIED');
    const ultimo = us.filter((u) => u.tipo !== 'materia' && u.lanzado_en).sort((a, b) => t(b.lanzado_en) - t(a.lanzado_en))[0]?.tipo;
    const bg = (ultimo === 'generativa' ? ['puente', 'generativa'] : ['generativa', 'puente']).map((tp) => us.find((u) => u.tipo === tp && u.estado === 'pendiente')).find(Boolean);
    acd = cupo('acd_tareas_dia') > 0 ? (bgCurso ? `Sol termina ${clase(bgCurso)} ${tit(bgCurso.codigo)}${bgCurso.tarea_id ? ` (tarea #${bgCurso.tarea_id})` : ''}`
      : e ? `el motor ACD avanza la campaña C1 en ${e.id} (${decap(e.descripcion.replace(/\.$/, ''))})`
        : bg ? `el motor ACD lanza ${clase(bg)} ${tit(bg.codigo)}` : 'la curiosidad autónoma busca la siguiente pregunta en las contradicciones de la biblioteca')
      : 'el motor ACD sigue en pausa (acd_tareas_dia = 0)';
  }
  const partes = [examen, estudio, acd].filter(Boolean) as string[];
  let s = partes.length ? `${cap(partes[0])}${partes.length > 1 ? `; en paralelo, ${partes.slice(1).join(' y ')}` : ''}` : 'No queda nada pendiente en los planificadores: revisar los requisitos sin verificar';
  if (h.halted) s = `Ninguna mientras KRATOS esté detenido (${h.reason}); al reanudar: ${s}`;
  return punto(s);
}

// Informe corto al propietario, en español, con el formato de la directiva. Lee el estado guardado (refrescar antes) y la evidencia viva
// de los experimentos. Nunca anuncia descubrimientos: como mucho lista hipótesis con apoyo provisional, como provisionales.
export async function informeSol(db: Db, o: OpcionesReq = {}): Promise<string> {
  const fl = await filas(db), c = await cargar(db, o), n = (e: Estado) => fl.filter((x) => x.estado === e).length, et = etapaActual(fl);
  // Los 5 cambios de estado más recientes, uno por requisito (el último de cada uno). Un refresco es una transacción y todos sus
  // cambios llevan la misma hora: dentro de él van primero los requisitos concretos (los A agregan a otros), los que quedan más
  // arriba y, a igualdad, el orden de la directiva.
  const vistos = new Set<string>(), cambios: any[] = [], esA = (x: any) => Number(String(x.details?.id ?? '').startsWith('A'));
  const recientes = (await db.query(`SELECT id, at, details FROM audit_log WHERE action = 'sol.requisito_cambio' AND at >= $1 ORDER BY id DESC LIMIT 300`, [o.auditDesde ?? new Date(0)])).rows
    .sort((a, b) => t(b.at) - t(a.at) || esA(a) - esA(b) || (RANGO[b.details?.a as Estado] ?? 0) - (RANGO[a.details?.a as Estado] ?? 0) || a.id - b.id);
  // Solo el último cambio de cada requisito y solo si coincide con su estado actual (un cambio ya superado no es trabajo vigente)
  const actual = new Map(fl.map((x) => [x.id, x.estado]));
  for (const x of recientes) {
    const d = x.details; if (!d?.id || vistos.has(d.id)) continue;
    vistos.add(d.id); if (actual.get(d.id) !== d.a) continue;
    cambios.push(d); if (cambios.length === 5) break;
  }
  const rangoP: Record<string, number> = { IN_PROGRESS: 0, BLOCKED: 1, FAILED: 2, IMPLEMENTED_UNVERIFIED: 3, PARTIAL: 4, NOT_STARTED: 5 };
  const clave = (x: any) => { const u = c.uni.get(x.id); return u?.tipo === 'materia' ? u.orden : 100 + IDS.indexOf(x.id); };
  const pend = fl.filter((x) => x.id[0] !== 'A' && x.estado !== 'VERIFIED' && x.siguiente).sort((a, b) => rangoP[a.estado] - rangoP[b.estado] || a.etapa - b.etapa || clave(a) - clave(b)).slice(0, 3);
  const ejecutados = c.X.filter((x) => x.estado !== 'ejecutando');
  // verificado = ok con su salida intacta y una crítica independiente del experimento (o de su modelo) hecha DESPUÉS de que terminara
  const verificados = c.X.filter((x) => salidaOk(c, x) && c.C.some((cr) => independiente(c, cr) && t(cr.created_at) >= finDe(x) && ((cr.objeto === 'experimento' && cr.objeto_id === x.id) || (cr.objeto === 'modelo' && cr.objeto_id === x.modelo_id))));
  // «hipótesis #N» y no «H<N>»: H01–H24 son identificadores de materias herméticas
  const prov = c.H.filter((h) => h.estado === 'apoyada_provisional').map((h) => `hipótesis #${h.id} «${corta(h.titulo, 60)}»${respaldada(c, h) ? '' : ' (sin respaldo verificable)'}`);
  return [
    'SOL — INFORME DE AVANCE',
    `Etapa: ${et ? `${et} — ${ETAPAS[et]}` : 'todas las etapas verificadas'}`,
    `Verificados: ${n('VERIFIED')}/${TOTAL_REQUISITOS}`,
    `En progreso: ${n('IN_PROGRESS')}`,
    `Bloqueados: ${n('BLOCKED')}`,
    'Trabajo realizado:',
    ...(cambios.length ? cambios.map((d, i) => `${i + 1}. [${d.id}] ${accion(d.id, d.de, d.a)} — ${punto(d.evidencia ?? 'sin evidencia')}`) : ['Ninguno todavía.']),
    'Pendiente inmediato:',
    ...(pend.length ? pend.map((x, i) => `${i + 1}. [${x.id}] ${punto(x.siguiente)}`) : ['Ninguno.']),
    `Experimentos: Ejecutados ${ejecutados.length} / Resultados verificados ${verificados.length}.`,
    `Descubrimientos: Ninguno confirmado${prov.length ? ` · con apoyo provisional, sin confirmar: ${prov.slice(0, 5).join(', ')}${prov.length > 5 ? ` y ${prov.length - 5} más` : ''}` : ''}`,
    `Siguiente acción autónoma: ${await siguienteAutonoma(db, c, fl)}`,
  ].join('\n');
}

// ---------- Herramienta para KRATOS y los agentes ----------
export const REQUISITOS_TOOL = {
  description: `Rastreador permanente de PROJECT SOL / ACD (docs/SOL-DIRECTIVA-ACD.md): los ${TOTAL_REQUISITOS} requisitos (S01–S20, H01–H24, V01–V12, R01–R16, B01–B12, G01–G12, D01–D12, E01–E12, A01–A27) con su estado calculado por el código a partir de evidencia real (NOT_STARTED, IN_PROGRESS, IMPLEMENTED_UNVERIFIED, VERIFIED, PARTIAL, BLOCKED, FAILED); nadie puede marcar nada como verificado a mano. resumen: cuentas por estado, grupo y etapa, y listas de en progreso, bloqueados y fallidos. detalle (id): un requisito con su evidencia, lo pendiente, la siguiente acción, su unidad, exámenes o pruebas y su historial de cambios. grupo (prefijo S|H|V|R|B|G|D|E|A): todos los requisitos de un grupo. informe: recalcula y devuelve el informe corto en español para el propietario. refrescar: recalcula todo desde la evidencia y regenera docs/SOL-REQUISITOS.md y docs/sol-requisitos.json.`,
  input_schema: { type: 'object', properties: { accion: { type: 'string', enum: ['resumen', 'detalle', 'grupo', 'informe', 'refrescar'] }, id: { type: 'string', description: 'identificador, p. ej. S02, R05, B07, D03, A19' }, prefijo: { type: 'string', enum: ['S', 'H', 'V', 'R', 'B', 'G', 'D', 'E', 'A'] } }, required: ['accion'], additionalProperties: false },
};

// «informe» y «refrescar» recalculan antes desde la evidencia (no hay forma de escribir un estado a mano). o: solo para pruebas
// (raíz de archivos y carpeta de exportación); en producción se llama con tres argumentos.
export async function herramientaRequisitos(db: Db, input: any, actor: string, o: OpcionesReq & { dir?: string } = {}) {
  try {
    const accionPedida = String(input?.accion ?? '');
    if (accionPedida === 'resumen') return await resumenRequisitos(db);
    if (accionPedida === 'informe') { await refreshRequisitos(db, { ...o, actor }); return { texto: await informeSol(db, o) }; }
    if (accionPedida === 'refrescar') { const r1 = await refreshRequisitos(db, { ...o, actor }), ex = await exportRequisitos(db, o.dir); return { ...r1, exportado: [ex.md, ex.json] }; }
    if (accionPedida === 'grupo') {
      const p = String(input?.prefijo ?? input?.grupo ?? '').trim().toUpperCase().slice(0, 1);
      if (!'SHVRBGDEA'.includes(p) || !p) return { error: 'prefijo no válido: usa S, H, V, R, B, G, D, E o A' };
      return { prefijo: p, requisitos: (await filas(db)).filter((x) => x.id[0] === p).map((x) => ({ id: x.id, estado: x.estado, descripcion: corta(x.descripcion, 120), evidencia: x.evidencia, verificado_en: x.verificado_en, pendiente: x.pendiente, siguiente: x.siguiente })) };
    }
    if (accionPedida === 'detalle') {
      const id = String(input?.id ?? '').trim().toUpperCase();
      const x = (await filas(db)).find((y) => y.id === id);
      if (!x) return { error: `No existe el requisito «${id}»` };
      const q = async (sql: string, p: unknown[]) => (await db.query(sql, p)).rows;
      const extra: Record<string, unknown> = {};
      if ('SHVBG'.includes(id[0])) {
        extra.unidad = (await q(`SELECT codigo, tipo, area, titulo, orden, estado, tarea_id, proyecto_id, intentos, relacionadas, modulos_previos, lanzado_en, completado_en FROM sol_unidades WHERE codigo = $1`, [id]))[0] ?? null;
        extra.examenes = await q(`SELECT id, estado, nota, aprobado, creado_por, respondido_por, calificado_por, created_at, calificado_en FROM sol_examenes WHERE unidad = $1 ORDER BY id DESC LIMIT 5`, [id]);   // nunca la rúbrica
        extra.proyectos = await q(`SELECT id, tipo, titulo, estado, version, carpeta, updated_at FROM sol_proyectos WHERE requisito = $1 OR id = (SELECT proyecto_id FROM sol_unidades WHERE codigo = $1) ORDER BY id DESC LIMIT 3`, [id]);
      }
      if (id[0] === 'R') extra.pruebas = await q(`SELECT id, ok, resultados, ms, detalle, probado_en FROM sol_conectores_pruebas WHERE codigo = $1 ORDER BY id DESC LIMIT 5`, [id]);
      extra.historial = await q(`SELECT at, actor, details->>'de' AS de, details->>'a' AS a, details->>'evidencia' AS evidencia FROM audit_log WHERE action = 'sol.requisito_cambio' AND details->>'id' = $1 ORDER BY id DESC LIMIT 8`, [id]);
      return { ...x, ...extra };
    }
    return { error: 'Acción no válida: usa resumen, detalle, grupo, informe o refrescar' };
  } catch (e: any) { return { error: String(e?.message ?? e).slice(0, 400) }; }
}
