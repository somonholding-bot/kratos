import fs from 'node:fs';
import path from 'node:path';
import type { Db } from '../db.ts';
import { audit } from './state.ts';
import { VAULT } from './vault.ts';

// Operación Omega: memorias persistentes de Sol (biblioteca con trazabilidad, afirmaciones con nivel de evidencia, conexiones,
// predicciones) y contrato de entregables KRATOS–Sol. Las garantías las aplica el código, no el agente:
//  · una fuente solo queda «verificada» si su URL se abrió de verdad;
//  · un proyecto solo queda «completed» si están todos los componentes obligatorios y sus archivos se leen de vuelta;
//  · una predicción sin rango, confianza y base no se registra.

// ---------- Biblioteca ----------
const ACCESOS = ['texto_completo', 'resumen', 'pagina', 'metadatos'];
export const NIVELES: Record<string, string> = { A: 'evidencia robusta', B: 'evidencia moderada', C: 'evidencia preliminar', D: 'hipótesis sin confirmar', E: 'refutada o contradicha', H: 'tradición histórica, filosófica o simbólica' };
const TIPOS_CONEXION = ['historica', 'conceptual', 'experimental', 'causal', 'correlacional', 'metaforica', 'hipotetica', 'contradictoria'];

function publicUrl(raw: string): URL {
  const u = new URL(raw);
  if (u.protocol !== 'https:' && u.protocol !== 'http:') throw new Error('Solo se admiten URLs http(s)');
  if (/^(localhost|127\.|10\.|192\.168\.|169\.254\.|\[?::1)|\.local$/i.test(u.hostname)) throw new Error('No se admiten direcciones locales');
  return u;
}

// Abre la URL (sin descargar el cuerpo entero) y devuelve estado y título de la página; nunca lanza por un fallo de red.
export async function checkUrl(raw: string): Promise<{ status: number; title: string | null }> {
  try {
    const r = await fetch(publicUrl(raw), { redirect: 'follow', signal: AbortSignal.timeout(15_000), headers: { 'user-agent': 'Mozilla/5.0 (KRATOS biblioteca; verificación de fuentes)', accept: 'text/html,application/pdf,*/*' } });
    let title: string | null = null;
    if (r.ok && (r.headers.get('content-type') ?? '').includes('html')) {
      const html = (await r.text()).slice(0, 60_000);
      const m = /<title[^>]*>([^<]{1,300})<\/title>/i.exec(html); title = m ? m[1].replace(/\s+/g, ' ').trim() : null;
    } else await r.body?.cancel().catch(() => {});
    return { status: r.status, title };
  } catch { return { status: 0, title: null }; }
}

export async function addSource(db: Db, i: { url?: string; titulo?: string; autores?: string; anio?: number; tipo?: string; temas?: string[]; acceso?: string; condiciones_uso?: string; notas?: string }, by: string,
  check: (u: string) => Promise<{ status: number; title: string | null }> = checkUrl) {
  const url = i.url ? publicUrl(String(i.url)).toString() : null;
  let status: number | null = null, title: string | null = null;
  if (url) { const c = await check(url); status = c.status; title = c.title; }
  const verificada = !!url && status !== null && status >= 200 && status < 400;
  const titulo = String(i.titulo || title || '').trim().slice(0, 300);
  if (!titulo) throw new Error('Falta el título de la fuente (y la página no dio uno)');
  // Sin URL abierta, lo máximo que se puede afirmar es que se conocen sus metadatos
  const acceso = !verificada ? 'metadatos' : ACCESOS.includes(String(i.acceso)) ? String(i.acceso) : 'pagina';
  const r = (await db.query(`INSERT INTO sol_fuentes (tipo, titulo, autores, anio, url, dominio, acceso, condiciones_uso, temas, verificada, http_status, verificada_en, notas, created_by)
      VALUES ($1,$2,$3,$4,$5,$6,$7,coalesce($8,'cita y resumen propio; no reproducir'),$9,$10,$11,CASE WHEN $10 THEN now() END,$12,$13)
      ON CONFLICT (url) DO UPDATE SET verificada = EXCLUDED.verificada OR sol_fuentes.verificada, http_status = EXCLUDED.http_status,
        verificada_en = CASE WHEN EXCLUDED.verificada THEN now() ELSE sol_fuentes.verificada_en END, temas = (SELECT array(SELECT DISTINCT unnest(sol_fuentes.temas || EXCLUDED.temas)))
      RETURNING id, titulo, url, acceso, verificada, http_status`,
    [String(i.tipo || 'articulo').slice(0, 40), titulo, i.autores ? String(i.autores).slice(0, 300) : null, Number(i.anio) || null, url, url ? new URL(url).hostname : null, acceso,
      i.condiciones_uso ? String(i.condiciones_uso).slice(0, 300) : null, (i.temas ?? []).map((t) => String(t).toLowerCase().slice(0, 60)).slice(0, 12), verificada, status, i.notas ? String(i.notas).slice(0, 1000) : null, by])).rows[0];
  return { ...r, nota: verificada ? 'URL abierta y registrada' : url ? `la URL no se pudo abrir (estado ${status}): queda como NO verificada` : 'sin URL: solo metadatos, NO verificada' };
}

export async function addClaim(db: Db, i: { texto: string; nivel: string; fuente_id: number; tema?: string; tipo_evidencia?: string; limitaciones?: string; replicaciones?: string; criticas?: string; confianza?: number }, by: string) {
  const nivel = String(i.nivel ?? '').toUpperCase();
  if (!NIVELES[nivel]) throw new Error(`Nivel de evidencia no válido. Usa: ${Object.entries(NIVELES).map(([k, v]) => `${k} (${v})`).join(', ')}`);
  const f = (await db.query(`SELECT id, verificada FROM sol_fuentes WHERE id = $1`, [Number(i.fuente_id)])).rows[0];
  if (!f) throw new Error('La afirmación necesita una fuente registrada (fuente_id): registra primero la fuente');
  if ((nivel === 'A' || nivel === 'B') && !f.verificada) throw new Error('Los niveles A y B exigen una fuente verificada (URL abierta)');
  if (String(i.texto ?? '').trim().length < 20) throw new Error('La afirmación es demasiado corta');
  const c = i.confianza === undefined ? null : Math.min(1, Math.max(0, Number(i.confianza)));
  return (await db.query(`INSERT INTO sol_afirmaciones (texto, tema, nivel, fuente_id, tipo_evidencia, limitaciones, replicaciones, criticas, confianza, created_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING id, nivel`,
    [String(i.texto).slice(0, 1200), i.tema ?? null, nivel, f.id, i.tipo_evidencia ?? null, i.limitaciones ?? null, i.replicaciones ?? null, i.criticas ?? null, c, by])).rows[0];
}

export async function addConnection(db: Db, i: { desde: string; hacia: string; tipo: string; explicacion: string; fuente_ids?: number[] }, by: string) {
  const tipo = String(i.tipo ?? '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
  if (!TIPOS_CONEXION.includes(tipo)) throw new Error(`Tipo de conexión no válido. Usa: ${TIPOS_CONEXION.join(', ')}`);
  if (!i.desde || !i.hacia || String(i.explicacion ?? '').length < 20) throw new Error('Faltan desde, hacia o una explicación de la conexión');
  return (await db.query(`INSERT INTO sol_conexiones (desde, hacia, tipo, explicacion, fuente_ids, created_by) VALUES ($1,$2,$3,$4,$5,$6) RETURNING id, tipo`,
    [String(i.desde).slice(0, 120), String(i.hacia).slice(0, 120), tipo, String(i.explicacion).slice(0, 1200), (i.fuente_ids ?? []).map(Number).filter(Boolean), by])).rows[0];
}

// Recuperación selectiva: nunca devuelve la biblioteca entera
export async function searchLibrary(db: Db, consulta: string) {
  const q = String(consulta ?? '').trim();
  const like = `%${q.toLowerCase().split(/\s+/).filter(Boolean).slice(0, 4).join('%')}%`;
  const fuentes = (await db.query(`SELECT id, tipo, titulo, autores, anio, url, acceso, verificada, temas FROM sol_fuentes
      WHERE $1 = '' OR lower(titulo || ' ' || coalesce(autores,'') || ' ' || coalesce(notas,'') || ' ' || array_to_string(temas,' ')) LIKE $2 ORDER BY verificada DESC, id DESC LIMIT 12`, [q, like])).rows;
  const afirmaciones = (await db.query(`SELECT a.id, a.nivel, a.texto, a.tema, a.limitaciones, a.confianza, f.titulo AS fuente, f.url, f.verificada AS fuente_verificada FROM sol_afirmaciones a JOIN sol_fuentes f ON f.id = a.fuente_id
      WHERE $1 = '' OR lower(a.texto || ' ' || coalesce(a.tema,'')) LIKE $2 ORDER BY a.id DESC LIMIT 12`, [q, like])).rows;
  const conexiones = (await db.query(`SELECT id, desde, hacia, tipo, explicacion FROM sol_conexiones WHERE $1 = '' OR lower(desde || ' ' || hacia || ' ' || explicacion) LIKE $2 ORDER BY id DESC LIMIT 8`, [q, like])).rows;
  return { niveles: NIVELES, fuentes, afirmaciones, conexiones };
}

export async function libraryStats(db: Db) {
  const f = (await db.query(`SELECT count(*)::int AS total, count(*) FILTER (WHERE verificada)::int AS verificadas, count(*) FILTER (WHERE acceso = 'texto_completo')::int AS texto_completo FROM sol_fuentes`)).rows[0];
  const porTema = (await db.query(`SELECT t AS tema, count(*)::int AS n FROM sol_fuentes, unnest(temas) t GROUP BY t ORDER BY n DESC LIMIT 15`)).rows;
  const a = (await db.query(`SELECT nivel, count(*)::int AS n FROM sol_afirmaciones GROUP BY nivel ORDER BY nivel`)).rows;
  const c = (await db.query(`SELECT count(*)::int AS n FROM sol_conexiones`)).rows[0].n;
  const p = (await db.query(`SELECT count(*)::int AS total, count(*) FILTER (WHERE resuelta_en IS NOT NULL)::int AS resueltas, count(*) FILTER (WHERE acierto)::int AS aciertos FROM sol_predicciones`)).rows[0];
  const m = (await db.query(`SELECT count(*)::int AS total, count(*) FILTER (WHERE estado = 'completado')::int AS completados, (SELECT n || '. ' || titulo FROM sol_modulos WHERE estado = 'en_curso' ORDER BY n LIMIT 1) AS en_curso FROM sol_modulos`)).rows[0];
  return { fuentes: f, por_tema: porTema, afirmaciones_por_nivel: a, conexiones: c, predicciones: p, curriculo: m,
    aviso: 'Solo cuentan como conocidas las fuentes verificadas; «texto_completo» indica las leídas enteras (las demás, página, resumen o metadatos).' };
}

// ---------- Proyectos y entregables (contrato KRATOS–Sol) ----------
export const COMPONENTES: Record<string, string[]> = {
  video: ['investigacion', 'fuentes', 'publico', 'objetivo', 'concepto', 'titulo', 'variantes_titulo', 'miniatura', 'guion', 'escaleta', 'direccion_audiovisual', 'voz', 'edicion', 'subtitulos', 'descripcion', 'metadatos', 'riesgos', 'metricas'],
  libro: ['investigacion', 'fuentes', 'publico', 'tesis', 'arquitectura', 'indice', 'capitulos', 'riesgos', 'metricas'],
  campana: ['investigacion', 'fuentes', 'publico', 'objetivo', 'concepto', 'mensajes', 'riesgos', 'metricas'],
  investigacion: ['pregunta', 'hallazgos', 'evidencia', 'fuentes', 'limitaciones', 'conexiones'],
  modulo: ['objetivos', 'conceptos', 'bibliografia', 'fuentes_primarias', 'estudios', 'evidencia', 'conexiones', 'aplicaciones', 'evaluacion', 'limitaciones'],
};
const slug = (s: string) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 50) || 'proyecto';
const urls = (s: string) => (String(s).match(/https?:\/\/[^\s)>\]"']+/g) ?? []).length;

export function missingComponents(tipo: string, c: Record<string, unknown>): string[] {
  const out: string[] = [];
  for (const k of COMPONENTES[tipo] ?? []) {
    const v = String(c?.[k] ?? '').trim(), min = ['titulo', 'objetivo', 'publico', 'pregunta', 'tesis'].includes(k) ? 10 : 40;
    if (v.length < min) out.push(`${k} (falta o tiene menos de ${min} caracteres)`);
    else if (k === 'fuentes' && urls(v) < 3) out.push('fuentes (hacen falta al menos 3 URLs reales)');
    else if (k === 'bibliografia' && urls(v) < 8) out.push('bibliografia (hacen falta al menos 8 URLs de fuentes abiertas)');
    else if (k === 'evaluacion' && (v.match(/\?/g) ?? []).length < 5) out.push('evaluacion (al menos 5 preguntas de examen con su respuesta)');
    else if (k === 'variantes_titulo' && v.split('\n').filter((l) => l.trim()).length < 3) out.push('variantes_titulo (al menos 3, una por línea)');
  }
  return out;
}

// Sol entrega (o reentrega) un paquete: se escribe en la bóveda, se lee de vuelta y solo entonces queda «completed».
export async function deliverProject(db: Db, i: { proyecto_id?: number; tarea_id?: number; titulo?: string; tipo?: string; audiencia?: string; plataforma?: string; componentes: Record<string, unknown> }, by: string) {
  let p = i.proyecto_id ? (await db.query(`SELECT * FROM sol_proyectos WHERE id = $1`, [Number(i.proyecto_id)])).rows[0] : null;
  if (i.proyecto_id && !p) throw new Error(`No existe el proyecto #${i.proyecto_id}`);
  const tipo = p?.tipo ?? String(i.tipo ?? '');
  if (!COMPONENTES[tipo]) throw new Error(`Tipo de proyecto no válido. Usa: ${Object.keys(COMPONENTES).join(', ')}`);
  const titulo = String(p?.titulo ?? i.titulo ?? '').trim().slice(0, 160);
  if (titulo.length < 5) throw new Error('Falta el título del proyecto');
  if (!p) p = (await db.query(`INSERT INTO sol_proyectos (tarea_id, titulo, tipo, audiencia, plataforma, estado) VALUES ($1,$2,$3,$4,$5,'writing') RETURNING *`,
    [Number(i.tarea_id) || null, titulo, tipo, i.audiencia ?? null, i.plataforma ?? null])).rows[0];
  const comp: Record<string, string> = { ...(p.componentes ?? {}) };
  for (const [k, v] of Object.entries(i.componentes ?? {})) if (v !== undefined && v !== null) comp[slug(k).replace(/-/g, '_')] = typeof v === 'string' ? v : JSON.stringify(v, null, 1);
  const faltantes = missingComponents(tipo, comp);
  const version = p.version + 1, rel = path.join('Proyectos', `P${p.id}-${slug(titulo)}`), dir = path.join(VAULT, rel, `v${version}`);
  fs.mkdirSync(dir, { recursive: true });
  const orden = [...COMPONENTES[tipo], ...Object.keys(comp).filter((k) => !COMPONENTES[tipo].includes(k))].filter((k) => comp[k] !== undefined);
  const archivos: string[] = [];
  orden.forEach((k, n) => { const f = path.join(dir, `${String(n + 1).padStart(2, '0')}-${k}.md`); fs.writeFileSync(f, `# ${titulo} · ${k}\n\n${comp[k].trim()}\n`); archivos.push(f); });
  fs.writeFileSync(path.join(VAULT, rel, 'INDICE.md'), `# Proyecto P${p.id}: ${titulo}\n\n- Tipo: ${tipo}\n- Versión vigente: v${version} (${new Date().toISOString()})\n- Estado: ${faltantes.length ? 'blocked' : 'completed'}\n${faltantes.length ? `- Falta: ${faltantes.join('; ')}\n` : ''}\n${orden.map((k, n) => `${n + 1}. [${k}](v${version}/${String(n + 1).padStart(2, '0')}-${k}.md)`).join('\n')}\n`);
  const legibles = archivos.every((f) => fs.existsSync(f) && fs.statSync(f).size > 20);
  const estado = !legibles ? 'failed' : faltantes.length ? 'blocked' : 'completed';
  await db.query(`UPDATE sol_proyectos SET componentes = $2, faltantes = $3, estado = $4, version = $5, carpeta = $6, tarea_id = coalesce(tarea_id, $7), updated_at = now() WHERE id = $1`,
    [p.id, JSON.stringify(comp), faltantes, estado, version, path.join(VAULT, rel), Number(i.tarea_id) || null]);
  await audit(db, by, 'omega.paquete_entregado', { proyecto: p.id, version, estado, faltantes: faltantes.length });
  return { proyecto_id: p.id, estado, version, carpeta: path.join(VAULT, rel), archivos: archivos.length, faltantes,
    siguiente: faltantes.length ? 'Completa lo que falta y vuelve a llamar a entregar con proyecto_id y solo los componentes nuevos' : 'Paquete completo: KRATOS puede recuperarlo con proyecto_sol accion=estado' };
}

// Estado REAL de un proyecto: lo que dice la base de datos contrastado con los archivos en disco
export async function projectStatus(db: Db, id?: number, tareaId?: number) {
  const p = (await db.query(`SELECT * FROM sol_proyectos WHERE ($1::int IS NOT NULL AND id = $1) OR ($1::int IS NULL AND $2::int IS NOT NULL AND tarea_id = $2) ORDER BY id DESC LIMIT 1`, [id ?? null, tareaId ?? null])).rows[0];
  if (!p) return { error: 'No existe ese proyecto' };
  const dir = p.carpeta ? path.join(p.carpeta, `v${p.version}`) : null;
  const archivos = dir && fs.existsSync(dir) ? fs.readdirSync(dir).filter((f) => f.endsWith('.md')).sort().map((f) => path.join(dir, f)) : [];
  const esperados = Object.keys(p.componentes ?? {}).length;
  const real = p.estado === 'completed' && archivos.length < esperados ? 'failed' : p.estado;
  if (real !== p.estado) await db.query(`UPDATE sol_proyectos SET estado = $2, updated_at = now() WHERE id = $1`, [p.id, real]);
  const predicciones = (await db.query(`SELECT id, hipotesis, metrica, rango_min, rango_max, confianza, resultado, acierto FROM sol_predicciones WHERE proyecto_id = $1 ORDER BY id`, [p.id])).rows;
  return { proyecto_id: p.id, titulo: p.titulo, tipo: p.tipo, estado: real, version: p.version, tarea_id: p.tarea_id, carpeta: p.carpeta, indice: p.carpeta ? path.join(p.carpeta, 'INDICE.md') : null,
    archivos, faltantes: p.faltantes, componentes: Object.keys(p.componentes ?? {}), predicciones, actualizado: p.updated_at,
    ...(real === 'failed' && p.estado === 'completed' ? { aviso: 'Constaba como completado pero faltan archivos en disco: lo he marcado como fallido' } : {}) };
}

export async function projectComponent(db: Db, id: number, componente: string) {
  const p = (await db.query(`SELECT componentes FROM sol_proyectos WHERE id = $1`, [id])).rows[0];
  const v = p?.componentes?.[componente];
  return v === undefined ? { error: `El proyecto #${id} no tiene el componente «${componente}»` } : { proyecto_id: id, componente, texto: String(v).slice(0, 12000) };
}

export async function listProjects(db: Db) {
  return (await db.query(`SELECT id, titulo, tipo, estado, version, tarea_id, array_length(faltantes, 1) AS faltan, updated_at FROM sol_proyectos ORDER BY id DESC LIMIT 20`)).rows;
}

// ---------- Predicciones (memoria experimental) ----------
export async function addPrediction(db: Db, i: { proyecto_id?: number; hipotesis: string; metrica: string; rango_min: number; rango_max: number; confianza: number; base: string }, by: string) {
  const lo = Number(i.rango_min), hi = Number(i.rango_max), c = Number(i.confianza);
  if (!Number.isFinite(lo) || !Number.isFinite(hi) || hi < lo) throw new Error('Una predicción necesita un rango (rango_min ≤ rango_max), no un número suelto');
  if (!(c > 0 && c < 1)) throw new Error('La confianza va entre 0 y 1 sin llegar a ninguno de los dos (p. ej. 0.7): no hay certezas');
  if (String(i.base ?? '').trim().length < 15) throw new Error('Di en qué se apoya la predicción (datos del canal, casos comparables o intuición)');
  if (String(i.hipotesis ?? '').trim().length < 15 || !i.metrica) throw new Error('Faltan la hipótesis o la métrica');
  return (await db.query(`INSERT INTO sol_predicciones (proyecto_id, hipotesis, metrica, rango_min, rango_max, confianza, base, created_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id`,
    [Number(i.proyecto_id) || null, String(i.hipotesis).slice(0, 600), String(i.metrica).slice(0, 120), lo, hi, c, String(i.base).slice(0, 600), by])).rows[0];
}

export async function resolvePrediction(db: Db, id: number, resultado: number, leccion: string | undefined, by: string) {
  const p = (await db.query(`SELECT * FROM sol_predicciones WHERE id = $1`, [id])).rows[0];
  if (!p) throw new Error(`No existe la predicción #${id}`);
  const r = Number(resultado); if (!Number.isFinite(r)) throw new Error('El resultado debe ser un número real medido');
  const acierto = r >= Number(p.rango_min) && r <= Number(p.rango_max);
  await db.query(`UPDATE sol_predicciones SET resultado = $2, acierto = $3, leccion = $4, resuelta_en = now() WHERE id = $1`, [id, r, acierto, leccion ? String(leccion).slice(0, 800) : null]);
  const cal = (await db.query(`SELECT count(*)::int AS n, count(*) FILTER (WHERE acierto)::int AS ok, round(avg(confianza), 2) AS confianza_media FROM sol_predicciones WHERE resuelta_en IS NOT NULL`)).rows[0];
  await audit(db, by, 'omega.prediccion_resuelta', { id, acierto });
  return { id, acierto, resultado: r, rango: [Number(p.rango_min), Number(p.rango_max)],
    calibracion: { resueltas: cal.n, aciertos: cal.ok, confianza_media: Number(cal.confianza_media), nota: cal.n < 10 ? 'Menos de 10 predicciones resueltas: la calibración aún no dice nada fiable' : 'Compara aciertos/resueltas con la confianza media' } };
}

// ---------- Lectura real de textos de acceso abierto ----------
// Las webs científicas bloquean la lectura automática de páginas; sus API abiertas no. KRATOS lee desde aquí artículos de acceso abierto
// (Europe PMC) y obras de dominio público (Project Gutenberg, Internet Archive) y el código anota cuánto se leyó de cada fuente.
type Fetcher = (url: string) => Promise<{ status: number; text: string }>;
const httpText: Fetcher = async (url) => {
  try { const r = await fetch(url, { redirect: 'follow', signal: AbortSignal.timeout(40_000), headers: { 'user-agent': 'KRATOS biblioteca (lectura de acceso abierto)' } }); return { status: r.status, text: r.ok ? await r.text() : '' }; }
  catch { return { status: 0, text: '' }; }
};
export const xmlToText = (xml: string) => xml.replace(/<(ref-list|table-wrap|fig|supplementary-material|front-stub|permissions|contrib-group|aff|history|pub-date|article-id|journal-meta)[\s\S]*?<\/\1>/g, ' ')
  .replace(/<\/(p|title|sec|abstract|li|tr)>/g, '\n').replace(/<[^>]+>/g, ' ').replace(/&#x?[0-9a-f]+;|&[a-z]+;/gi, ' ').replace(/[ \t]+/g, ' ').replace(/\n\s*\n+/g, '\n').trim();

export async function searchPapers(consulta: string, soloAbierto = true, get: Fetcher = httpText) {
  const q = `${String(consulta).slice(0, 200)}${soloAbierto ? ' OPEN_ACCESS:y' : ''}`;
  const r = await get(`https://www.ebi.ac.uk/europepmc/webservices/rest/search?query=${encodeURIComponent(q)}&format=json&pageSize=12&resultType=lite`);
  if (r.status !== 200) return { error: `Europe PMC respondió ${r.status}` };
  const j = JSON.parse(r.text);
  return { total: j.hitCount, articulos: (j.resultList?.result ?? []).map((a: any) => ({ titulo: a.title, autores: a.authorString, anio: Number(a.pubYear) || null, revista: a.journalTitle, pmid: a.pmid ?? null, pmcid: a.pmcid ?? null,
    acceso_abierto: a.isOpenAccess === 'Y', citas: a.citedByCount ?? 0, tipo: a.pubType ?? null })), nota: 'Con pmcid y acceso_abierto puedes leer el texto entero con accion=leer_texto' };
}

const TROZO = 30_000;
// Devuelve un trozo del texto y anota el avance. Solo cuenta lo leído de forma contigua desde el principio.
export async function readOpenText(db: Db, i: { pmcid?: string; url?: string; desde?: number }, by: string, get: Fetcher = httpText) {
  let fuenteUrl: string, origen: string, tipo = 'articulo';
  if (i.pmcid) {
    const id = String(i.pmcid).toUpperCase().replace(/[^A-Z0-9]/g, ''); if (!/^PMC\d+$/.test(id)) throw new Error('pmcid no válido (ejemplo: PMC7379166)');
    origen = `https://www.ebi.ac.uk/europepmc/webservices/rest/${id}/fullTextXML`; fuenteUrl = `https://europepmc.org/article/PMC/${id}`;
  } else {
    const u = publicUrl(String(i.url ?? ''));
    if (!/(^|\.)gutenberg\.org$|(^|\.)archive\.org$/.test(u.hostname)) throw new Error('leer_texto solo admite un pmcid de acceso abierto o una URL de texto de gutenberg.org o archive.org (dominio público)');
    origen = fuenteUrl = u.toString(); tipo = 'libro';
  }
  const r = await get(origen);
  if (r.status !== 200 || r.text.length < 500) return { error: `No se pudo leer (estado ${r.status}); puede que no sea de acceso abierto` };
  const texto = /<\w+[\s>]/.test(r.text.slice(0, 2000)) ? xmlToText(r.text) : r.text.replace(/\r/g, '');
  const titulo = (/<article-title[^>]*>([\s\S]*?)<\/article-title>/.exec(r.text)?.[1] ?? /^Title:\s*(.+)$/m.exec(r.text)?.[1] ?? fuenteUrl).replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim().slice(0, 300);
  const desde = Math.max(0, Math.min(Number(i.desde) || 0, texto.length)), trozo = texto.slice(desde, desde + TROZO), hasta = desde + trozo.length;
  const f = (await db.query(`INSERT INTO sol_fuentes (tipo, titulo, url, dominio, acceso, verificada, http_status, verificada_en, longitud, created_by)
      VALUES ($1,$2,$3,$4,'pagina',true,200,now(),$5,$6)
      ON CONFLICT (url) DO UPDATE SET longitud = EXCLUDED.longitud, verificada = true, http_status = 200, verificada_en = coalesce(sol_fuentes.verificada_en, now()) RETURNING id, leido_hasta`,
    [tipo, titulo, fuenteUrl, new URL(fuenteUrl).hostname, texto.length, by])).rows[0];
  const leido = desde <= f.leido_hasta ? Math.max(f.leido_hasta, hasta) : f.leido_hasta;   // un salto hacia delante no cuenta como leído
  const completo = leido >= texto.length * 0.9;
  await db.query(`UPDATE sol_fuentes SET leido_hasta = $2, acceso = CASE WHEN $3 THEN 'texto_completo' WHEN acceso = 'texto_completo' THEN acceso ELSE 'resumen' END WHERE id = $1`, [f.id, leido, completo]);
  return { fuente_id: f.id, titulo, longitud: texto.length, desde, hasta, leido_pct: Math.round((leido / texto.length) * 100), acceso: completo ? 'texto_completo' : 'parcial',
    siguiente: hasta < texto.length ? `para seguir leyendo: accion=leer_texto con desde=${hasta}` : 'fin del texto', texto_no_confiable: trozo };
}
