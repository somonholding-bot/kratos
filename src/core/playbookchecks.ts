import fs from 'node:fs';
import type { Db } from '../db.ts';
import type { Check } from './verify.ts';

// Comprobaciones declarativas de los playbooks (fase D). Cada playbook declara en «verificacion» una lista de
// comprobaciones ejecutables en código (sin IA) que verify.ts corre sobre el informe antes de dar la tarea por completada.
// Son de texto y de datos: secciones, tablas, URLs, bloques JSON, longitudes, ritmo, idioma, herramientas usadas, archivos.
// Las numéricas admiten expresiones con entradas del playbook: «{{duracion_min}}*2».

export type PlaybookCheck = { nombre: string; tipo: string; nivel?: 'bloqueante' | 'aviso' } & Record<string, any>;
export type CheckCtx = {
  texto: string;                         // el informe completo
  params: Record<string, unknown>;       // entradas normalizadas de la tarea
  extraido: Record<string, any>;         // bloques JSON extraídos (se rellena aquí; verify.ts lo guarda en result.extraido)
  task?: any;
  db?: Db;
};

// Los 17 tipos admitidos y las claves que aceptan (validateShape rechaza cualquier otra)
export const CHECK_TYPES: Record<string, string[]> = {
  proyecto_sol_completo: [],
  longitud_minima: ['caracteres', 'campo'],
  longitud_maxima: ['caracteres', 'campo'],
  secciones: ['titulos'],
  tabla_filas: ['minimo', 'seccion'],
  numero_de_items: ['minimo', 'seccion'],
  fuentes_citadas: ['minimo', 'dominio'],
  sin_frases: ['frases', 'campo'],
  entradas_reflejadas: ['entradas'],
  bloque_json: ['bloque', 'campos'],
  lista_minima: ['campo', 'minimo'],
  campo_longitud: ['campo', 'minimo', 'maximo'],
  palabras: ['campo', 'minimo', 'maximo'],
  ritmo: ['campo', 'duracion', 'ppm_min', 'ppm_max'],
  idioma: ['campo', 'idioma'],
  sin_promesas_medicas: ['campo'],
  herramienta_usada: ['herramienta'],
  archivo_existe: ['campo', 'ruta'],
};
export const NUMERIC_KEYS = new Set(['caracteres', 'minimo', 'maximo', 'duracion', 'ppm_min', 'ppm_max']);

export const norm = (s: string) => String(s ?? '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
const words = (s: string) => String(s ?? '').split(/\s+/).filter((w) => /\p{L}|\p{N}/u.test(w)).length;
export const hoy = () => { const d = new Date(); return new Date(d.getTime() - d.getTimezoneOffset() * 60_000).toISOString().slice(0, 10); };

// Sustituye {{entrada}} y {{hoy}}; los marcadores sin valor se dejan tal cual (validateShape los detecta antes)
export function substitute(text: string, params: Record<string, unknown>): string {
  return String(text ?? '').replace(/\{\{\s*([a-z0-9_]+)\s*\}\}/gi, (m, k) => {
    if (k === 'hoy') return hoy();
    const v = params[k];
    return v === undefined || v === null ? m : String(v);
  });
}
export const markers = (text: string) => [...String(text ?? '').matchAll(/\{\{\s*([a-z0-9_]+)\s*\}\}/gi)].map((m) => m[1]);

// Expresiones numéricas: números, {{entradas numéricas}}, + - * / y paréntesis
export function validNumExpr(expr: unknown, numericInputs: Set<string>): string | null {
  if (typeof expr === 'number') return Number.isFinite(expr) ? null : 'número no finito';
  if (typeof expr !== 'string') return 'debe ser un número o una expresión';
  for (const m of markers(expr)) if (!numericInputs.has(m)) return `marcador {{${m}}} no es una entrada numérica`;
  const rest = expr.replace(/\{\{\s*[a-z0-9_]+\s*\}\}/gi, '1');
  if (!/^[\d+\-*/(). ]+$/.test(rest)) return `expresión no válida «${expr}»`;
  try { parseExpr(rest); } catch (e: any) { return `expresión no válida «${expr}»: ${e.message}`; }
  return null;
}
export function evalNum(expr: unknown, params: Record<string, unknown>): number {
  if (typeof expr === 'number') return expr;
  const s = substitute(String(expr), params);
  if (!/^[\d+\-*/(). ]+$/.test(s)) throw new Error(`expresión no válida «${expr}»`);
  return parseExpr(s);
}
// Evaluador mínimo (sin eval): suma/resta, producto/división, paréntesis, unario
function parseExpr(src: string): number {
  let i = 0;
  const peek = () => src[i];
  const skip = () => { while (src[i] === ' ') i++; };
  const num = (): number => {
    skip();
    if (peek() === '(') { i++; const v = sum(); skip(); if (src[i++] !== ')') throw new Error('falta )'); return v; }
    if (peek() === '-') { i++; return -num(); }
    const m = src.slice(i).match(/^\d+(\.\d+)?/); if (!m) throw new Error(`se esperaba un número en «${src.slice(i, i + 8)}»`);
    i += m[0].length; return Number(m[0]);
  };
  const prod = (): number => { let v = num(); for (;;) { skip(); if (peek() === '*') { i++; v *= num(); } else if (peek() === '/') { i++; const d = num(); if (d === 0) throw new Error('división por cero'); v /= d; } else return v; } };
  const sum = (): number => { let v = prod(); for (;;) { skip(); if (peek() === '+') { i++; v += prod(); } else if (peek() === '-') { i++; v -= prod(); } else return v; } };
  const v = sum(); skip();
  if (i < src.length) throw new Error(`sobra «${src.slice(i)}»`);
  return v;
}

// ---------- utilidades de texto ----------
const HEADING = /^#{1,4}\s*(.+?)\s*#*\s*$/;
// Devuelve el cuerpo de una sección por su título (hasta el siguiente encabezado de igual o mayor nivel); null si no existe
export function section(text: string, title: string): string | null {
  const lines = String(text ?? '').split('\n');
  const want = norm(title).replace(/[«»"*_]/g, '').trim();
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(HEADING);
    if (!m) continue;
    const got = norm(m[1]).replace(/[«»"*_]/g, '').trim();
    if (got !== want && !got.startsWith(want + ':') && !got.startsWith(want + ' ')) continue;
    const level = lines[i].match(/^#+/)![0].length;
    const out: string[] = [];
    for (let j = i + 1; j < lines.length; j++) {
      const h = lines[j].match(/^(#{1,4})\s/);
      if (h && h[1].length <= level) break;
      out.push(lines[j]);
    }
    return out.join('\n');
  }
  return null;
}
// Filas de datos de una tabla Markdown: líneas «|…» menos la cabecera y la línea separadora
export const tableRows = (body: string) => {
  const lines = body.split('\n').filter((l) => /^\s*\|/.test(l));
  const sep = lines.filter((l) => /^\s*\|?\s*:?-{2,}/.test(l)).length;
  return Math.max(0, lines.length - sep - (sep ? 1 : 0));
};
export const listItems = (body: string) => body.split('\n').filter((l) => /^\s*([-*+]|\d+[.)])\s+\S/.test(l)).length;
export const urls = (text: string) => [...new Set([...String(text ?? '').matchAll(/https?:\/\/[^\s)\]>«»"'`]+/g)].map((m) => m[0].replace(/[.,;:]+$/, '')))];

// Bloque ```json <nombre> … ``` (si no está etiquetado y solo hay uno, vale ese)
export function jsonBlock(text: string, name: string): any {
  const t = String(text ?? '');
  let m = t.match(new RegExp('```json[ \\t]+' + name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '[ \\t]*\\r?\\n([\\s\\S]*?)```', 'i'));
  if (!m) { const all = [...t.matchAll(/```json[ \t]*\r?\n([\s\S]*?)```/g)]; if (all.length === 1) m = all[0] as any; }
  if (!m) return undefined;
  try { return JSON.parse(m[1]); } catch { return null; }   // null = existe pero no es JSON válido
}
const path = (obj: any, p: string) => String(p).split('.').reduce((o, k) => (o == null ? undefined : o[k]), obj);
function field(ctx: CheckCtx, campo: string | undefined): { ok: true; value: any } | { ok: false; detalle: string } {
  if (!campo || campo === 'informe') return { ok: true, value: ctx.texto };
  const v = path(ctx.extraido, campo);
  return v === undefined ? { ok: false, detalle: `campo «${campo}» no encontrado (¿falta el bloque JSON?)` } : { ok: true, value: v };
}

// Idioma por palabras vacías (heurística: aviso por defecto)
const STOP: Record<string, string[]> = {
  en: ['the', 'and', 'you', 'your', 'with', 'this', 'that', 'for', 'are', 'from', 'into', 'let', 'feel', 'breathe', 'now', 'of', 'to', 'in', 'is', 'it', 'as', 'be', 'we'],
  es: ['el', 'la', 'los', 'las', 'de', 'del', 'que', 'y', 'en', 'con', 'para', 'por', 'una', 'un', 'tu', 'es', 'se', 'al', 'lo', 'como', 'respira', 'siente', 'ahora'],
};
export function detectLanguage(text: string): 'en' | 'es' | 'otro' {
  const ws = norm(text).split(/[^a-z]+/).filter(Boolean);
  if (ws.length < 20) return 'otro';
  const count = (l: string) => ws.filter((w) => STOP[l].includes(w)).length;
  const en = count('en'), es = count('es');
  if (en === 0 && es === 0) return 'otro';
  return en >= es * 1.5 ? 'en' : es >= en * 1.5 ? 'es' : 'otro';
}
const MEDICAL = /\b(guaranteed (cure|healing|to heal|results?)|cures?\b|will heal|heals? (your|all|any)|cure for|eliminates? (anxiety|depression|disease|illness|cancer)|replaces? (your )?(medication|doctor|therapy)|stop taking (your )?medication|medical advice|curar[aá]|cura (el|la|tu)|garantiza(mos)? (la )?(cura|sanaci[oó]n)|sustituye (a )?(tu |el )?(m[eé]dico|medicaci[oó]n))\b/iu;

// ---------- ejecución ----------
export async function runCheck(c: PlaybookCheck, ctx: CheckCtx): Promise<Check> {
  const nombre = `playbook · ${c.nombre}`;
  const nivel: 'bloqueante' | 'aviso' = c.nivel ?? (c.tipo === 'idioma' ? 'aviso' : 'bloqueante');
  const n = (k: string, def?: number) => (c[k] === undefined ? def! : evalNum(c[k], ctx.params));
  const out = (ok: boolean, detalle?: string): Check => ({ nombre, ok, detalle, nivel });
  try {
    switch (c.tipo) {
      case 'longitud_minima': case 'longitud_maxima': {
        const f = field(ctx, c.campo); if (!f.ok) return out(false, f.detalle);
        const len = String(f.value).trim().length, lim = n('caracteres');
        return c.tipo === 'longitud_minima' ? out(len >= lim, `${len} caracteres (mínimo ${lim})`) : out(len <= lim, `${len} caracteres (máximo ${lim})`);
      }
      case 'secciones': {
        const faltan = (c.titulos as string[]).filter((t) => section(ctx.texto, t) === null);
        return out(!faltan.length, faltan.length ? `faltan: ${faltan.join(', ')}` : `${c.titulos.length} secciones`);
      }
      case 'tabla_filas': case 'numero_de_items': {
        const body = c.seccion ? section(ctx.texto, c.seccion) : ctx.texto;
        if (body === null) return out(false, `sección «${c.seccion}» no encontrada`);
        const got = c.tipo === 'tabla_filas' ? tableRows(body) : listItems(body), min = n('minimo');
        return out(got >= min, `${got} ${c.tipo === 'tabla_filas' ? 'filas' : 'ítems'} (mínimo ${min})${c.seccion ? ` en «${c.seccion}»` : ''}`);
      }
      case 'fuentes_citadas': {
        const all = urls(ctx.texto), got = c.dominio ? all.filter((u) => { try { return new URL(u).hostname.endsWith(String(c.dominio)); } catch { return false; } }) : all, min = n('minimo');
        return out(got.length >= min, `${got.length} URL${c.dominio ? ` de ${c.dominio}` : ''} (mínimo ${min})`);
      }
      case 'sin_frases': {
        const f = field(ctx, c.campo); if (!f.ok) return out(false, f.detalle);
        const t = norm(typeof f.value === 'string' ? f.value : JSON.stringify(f.value));
        const hit = (c.frases as string[]).find((p) => t.includes(norm(p)));
        return out(!hit, hit ? `contiene «${hit}»` : undefined);
      }
      case 'entradas_reflejadas': {
        const t = norm(ctx.texto);
        const faltan = (c.entradas as string[]).filter((k) => { const v = ctx.params[k]; return v !== undefined && v !== '' && !t.includes(norm(String(v))); });
        return out(!faltan.length, faltan.length ? `no menciona: ${faltan.map((k) => `${k}=«${ctx.params[k]}»`).join(', ')}` : undefined);
      }
      case 'bloque_json': {
        const b = jsonBlock(ctx.texto, c.bloque);
        if (b === undefined) return out(false, `falta el bloque \`\`\`json ${c.bloque}`);
        if (b === null || typeof b !== 'object') return out(false, `el bloque ${c.bloque} no es JSON válido`);
        ctx.extraido[c.bloque] = b;
        const faltan = ((c.campos ?? []) as string[]).filter((k) => b[k] === undefined || b[k] === null || b[k] === '' || (Array.isArray(b[k]) && !b[k].length));
        return out(!faltan.length, faltan.length ? `faltan campos: ${faltan.join(', ')}` : `campos ${Object.keys(b).length}`);
      }
      case 'lista_minima': {
        const f = field(ctx, c.campo); if (!f.ok) return out(false, f.detalle);
        const arr = Array.isArray(f.value) ? f.value : typeof f.value === 'string' ? f.value.split('|').map((x) => x.trim()).filter(Boolean) : [];
        const min = n('minimo');
        return out(arr.length >= min, `${arr.length} elementos (mínimo ${min})`);
      }
      case 'campo_longitud': {
        const f = field(ctx, c.campo); if (!f.ok) return out(false, f.detalle);
        const len = String(f.value).trim().length, min = n('minimo', 0), max = n('maximo', Infinity);
        return out(len >= min && len <= max, `${len} caracteres (${c.minimo !== undefined ? `mínimo ${min}` : ''}${c.minimo !== undefined && c.maximo !== undefined ? ', ' : ''}${c.maximo !== undefined ? `máximo ${max}` : ''})`);
      }
      case 'palabras': {
        const f = field(ctx, c.campo); if (!f.ok) return out(false, f.detalle);
        const w = words(String(f.value)), min = n('minimo', 0), max = n('maximo', Infinity);
        return out(w >= min && w <= max, `${w} palabras (${c.minimo !== undefined ? `mínimo ${min}` : ''}${c.minimo !== undefined && c.maximo !== undefined ? ', ' : ''}${c.maximo !== undefined ? `máximo ${max}` : ''})`);
      }
      case 'ritmo': {
        const f = field(ctx, c.campo); if (!f.ok) return out(false, f.detalle);
        const dur = n('duracion'); if (!(dur > 0)) return out(false, 'duración no válida');
        const ppm = Math.round(words(String(f.value)) / dur), min = n('ppm_min', 0), max = n('ppm_max', Infinity);
        return out(ppm >= min && ppm <= max, `${ppm} ppm (esperado ${min}–${Number.isFinite(max) ? max : '∞'} para ${dur} min)`);
      }
      case 'idioma': {
        const f = field(ctx, c.campo); if (!f.ok) return out(false, f.detalle);
        const got = detectLanguage(String(f.value));
        return out(got === c.idioma, `detectado ${got} (esperado ${c.idioma})`);
      }
      case 'sin_promesas_medicas': {
        const f = field(ctx, c.campo); if (!f.ok) return out(false, f.detalle);
        const m = String(typeof f.value === 'string' ? f.value : JSON.stringify(f.value)).match(MEDICAL);
        return out(!m, m ? `promete «${m[0]}»: nada de curas ni sustituir al médico` : undefined);
      }
      case 'herramienta_usada': {
        if (!ctx.db || !ctx.task) return out(false, 'sin base de datos para comprobarlo');
        const st = (await ctx.db.query(`SELECT value FROM system_state WHERE key = 'agents_engine'`)).rows[0]?.value;
        if (st === 'api') return { nombre, ok: true, nivel: 'aviso', detalle: 'motor API: el uso de herramientas no se puede comprobar' };
        const since = ctx.task.started_at ?? ctx.task.created_at ?? new Date(0);
        const r = (await ctx.db.query(`SELECT count(*)::int AS n FROM audit_log WHERE actor = $1 AND action = $2 AND at >= $3`, [`agente:${ctx.task.owner_function}`, `herramienta.${c.herramienta}`, since])).rows[0].n;
        return out(r > 0, r > 0 ? `${r} llamada(s)` : `el agente no llamó a ${c.herramienta} durante la tarea`);
      }
      case 'proyecto_sol_completo': {   // Omega: el paquete de Sol existe, está completed y sus archivos están en disco
        if (!ctx.db || !ctx.task) return out(false, 'sin base de datos para comprobarlo');
        const since = ctx.task.started_at ?? ctx.task.created_at ?? new Date(0);
        const p = (await ctx.db.query(`SELECT id, estado, carpeta, version, faltantes FROM sol_proyectos WHERE tarea_id = $1 OR updated_at >= $2 ORDER BY (tarea_id = $1) DESC NULLS LAST, id DESC LIMIT 1`, [ctx.task.id, since])).rows[0];
        if (!p) return out(false, 'Sol no entregó ningún paquete con proyecto_sol accion=entregar');
        const dir = p.carpeta ? `${p.carpeta}/v${p.version}` : '';
        const n = dir && fs.existsSync(dir) ? fs.readdirSync(dir).filter((f) => f.endsWith('.md')).length : 0;
        if (p.estado === 'completed' && n > 0) { await ctx.db.query(`UPDATE sol_proyectos SET tarea_id = coalesce(tarea_id, $2) WHERE id = $1`, [p.id, ctx.task.id]); return out(true, `proyecto P${p.id}, ${n} archivos en ${p.carpeta}`); }
        return out(false, `proyecto P${p.id} en estado ${p.estado}${p.faltantes?.length ? `; falta: ${p.faltantes.join('; ')}` : ''}${n ? '' : '; sin archivos en disco'}`);
      }
      case 'archivo_existe': {
        let ruta = c.ruta ? substitute(String(c.ruta), ctx.params) : undefined;
        if (!ruta) { const f = field(ctx, c.campo); if (!f.ok) return out(false, f.detalle); ruta = String(f.value); }
        const ok = !!ruta && fs.existsSync(ruta);
        return out(ok, ok ? ruta : `no existe: ${ruta}`);
      }
      default:
        return out(false, `tipo de comprobación desconocido «${c.tipo}»`);
    }
  } catch (e: any) { return out(false, `error al comprobar: ${String(e?.message ?? e).slice(0, 160)}`); }
}

export async function runChecks(checks: PlaybookCheck[], ctx: CheckCtx): Promise<Check[]> {
  const out: Check[] = [];
  // los bloques JSON primero: los demás campos dependen de lo extraído
  const ordered = [...checks.filter((c) => c.tipo === 'bloque_json'), ...checks.filter((c) => c.tipo !== 'bloque_json')];
  for (const c of ordered) out.push(await runCheck(c, ctx));
  return out;
}

// Descripción legible de las comprobaciones (va en task.verification y en el brief del especialista)
export function describeChecks(checks: PlaybookCheck[], params: Record<string, unknown>): string {
  const n = (v: unknown) => { try { return String(evalNum(v, params)); } catch { return String(v); } };
  return checks.map((c) => {
    const aviso = c.nivel === 'aviso' || (c.tipo === 'idioma' && !c.nivel) ? ' (aviso)' : '';
    switch (c.tipo) {
      case 'longitud_minima': return `al menos ${n(c.caracteres)} caracteres${c.campo ? ` en ${c.campo}` : ''}`;
      case 'longitud_maxima': return `como mucho ${n(c.caracteres)} caracteres${c.campo ? ` en ${c.campo}` : ''}`;
      case 'proyecto_sol_completo': return 'paquete entregado con proyecto_sol (accion=entregar) en estado completed, con todos sus archivos';
      case 'secciones': return `secciones obligatorias (encabezados ##): ${c.titulos.join(', ')}`;
      case 'tabla_filas': return `tabla Markdown con al menos ${n(c.minimo)} filas${c.seccion ? ` en «${c.seccion}»` : ''}`;
      case 'numero_de_items': return `al menos ${n(c.minimo)} ítems de lista${c.seccion ? ` en «${c.seccion}»` : ''}`;
      case 'fuentes_citadas': return `al menos ${n(c.minimo)} URLs${c.dominio ? ` de ${c.dominio}` : ' (fuentes)'}`;
      case 'sin_frases': return `sin las frases: ${c.frases.map((f: string) => `«${f}»`).join(', ')}`;
      case 'entradas_reflejadas': return `menciona literalmente: ${c.entradas.map((k: string) => `${k}=«${params[k] ?? ''}»`).join(', ')}`;
      case 'bloque_json': return `bloque \`\`\`json ${c.bloque} con los campos ${(c.campos ?? []).join(', ')}`;
      case 'lista_minima': return `${c.campo} con al menos ${n(c.minimo)} elementos`;
      case 'campo_longitud': return `${c.campo} de ${c.minimo !== undefined ? n(c.minimo) : 0} a ${c.maximo !== undefined ? n(c.maximo) : '∞'} caracteres`;
      case 'palabras': return `${c.campo ?? 'informe'} con ${c.minimo !== undefined ? `al menos ${n(c.minimo)}` : ''}${c.minimo !== undefined && c.maximo !== undefined ? ' y ' : ''}${c.maximo !== undefined ? `como mucho ${n(c.maximo)}` : ''} palabras`;
      case 'ritmo': return `${c.campo} a ${n(c.ppm_min)}–${n(c.ppm_max)} palabras por minuto para ${n(c.duracion)} min`;
      case 'idioma': return `${c.campo ?? 'informe'} en ${c.idioma === 'en' ? 'inglés' : 'español'}${aviso}`;
      case 'sin_promesas_medicas': return `${c.campo ?? 'informe'} sin promesas médicas (curar, sustituir al médico)`;
      case 'herramienta_usada': return `usar de verdad la herramienta ${c.herramienta}`;
      case 'archivo_existe': return `el archivo ${c.ruta ?? c.campo} debe existir`;
      default: return `${c.tipo}`;
    }
  }).map((s, i) => `${i + 1}) ${s}`).join('; ');
}
