import { execFileSync, spawn } from 'node:child_process';
import { lookup as dnsLookup } from 'node:dns/promises';
import fs from 'node:fs';
import { isIP } from 'node:net';
import path from 'node:path';
import { ROOT } from '../config.ts';
import type { Db } from '../db.ts';
import { addSource, xmlToText } from './omega.ts';
import { audit, getState } from './state.ts';

// PROJECT SOL · conectores de fuentes R01–R16 (docs/SOL-DIRECTIVA-ACD.md). Cada conector devuelve registros normalizados con procedencia.
// Garantías que aplica el código, no el agente:
//  · toda llamada de red pasa por un cliente inyectable (Get): las pruebas usan respuestas grabadas y nunca tocan la red;
//  · las bibliotecas en la sombra (Sci-Hub, LibGen, Z-Library, Anna's Archive…) se rechazan antes de cualquier petición;
//  · solo se lee texto de orígenes legales (Europe PMC abierto, arXiv, dominio público, archivos esotéricos en línea, PDF de acceso abierto);
//  · un resumen recuperado no es una lectura: «texto_completo» solo se marca al pasar del 90 % leído de forma contigua;
//  · un límite de peticiones (429), un bloqueo anti-bots o una caída se informan tal cual: nunca se fabrican resultados.

export type Respuesta = { status: number; text: string; headers?: Record<string, string> };
export type Get = (url: string, init?: { headers?: Record<string, string> }) => Promise<Respuesta>;
export type Estado = 'publicado' | 'preprint' | 'retractado' | 'corregido' | 'manuscrito' | 'libro' | 'documento' | 'desconocido';
export type Registro = {
  conector: string; titulo: string; autores?: string | null; anio?: number | null; fecha?: string | null; doi?: string | null; identificador?: string | null; url: string;
  estado_publicacion: Estado; texto_disponible: boolean | null; texto_url?: string | null; permisos?: string | null; resumen?: string | null; citas?: number | null;
  correcciones?: string | null;   // opcional: retractaciones/correcciones que ya trae el origen (Crossref, PubMed)
  nota?: string | null;           // opcional: aviso del conector sobre el registro (p. ej. «posible resultado negativo»); nunca es un resumen ni una lectura
};
export type Resultado = { registros: Registro[]; total?: number | null; aviso?: string; partes?: Record<string, number | string> };
type Buscador = (consulta: string, max: number, get: Get, ctx?: { db?: Db }) => Promise<Resultado>;

export const UA = 'KRATOS-SOL/1.0 (investigación; acceso legal)';
// Las cabeceras HTTP van en ASCII: Node envía la «ó» como un byte suelto (0xF3) y el cortafuegos de Cloudflare rechaza la petición por cabecera mal formada
// (comprobado el 5-nov-2026: embassyofthefreemind.com 403 con la tilde, 200 sin ella). Se envía la misma identidad, sin disfrazarse de navegador.
export const UA_HTTP = UA.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^\x20-\x7e]/g, '');
// Espera del único reintento tras un 429/503: corta por defecto; para la búsqueda de OpenAlex se respeta su Retry-After hasta 20 s. Las pruebas las ponen a 0.
export const AJUSTES = { espera429Ms: 2500, esperaOpenAlexMs: 20_000 };

// ---------- destinos de red: solo http(s) públicos ----------
// Un agente no puede hacer que KRATOS consulte la propia máquina ni redes privadas (servicios internos, metadatos de la nube…)
const ipPrivada = (ip: string) => {
  const s = ip.toLowerCase().replace(/^\[|\]$/g, '');
  const m4 = /^(?:::ffff:)?(\d+)\.(\d+)\.(\d+)\.(\d+)$/.exec(s);
  if (m4) { const [a, b] = [Number(m4[1]), Number(m4[2])]; return a === 0 || a === 10 || a === 127 || a >= 224 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127) || (a === 198 && (b === 18 || b === 19)); }
  return s.includes(':') && (s === '::' || s === '::1' || s.startsWith('::ffff:') || /^(fc|fd|fe[89ab])/.test(s));
};
// Motivo por el que una URL no es un destino público http(s); null si lo es
export function motivoNoPublica(raw: string): string | null {
  let u: URL; try { u = new URL(String(raw)); } catch { return 'URL no válida'; }
  if (!/^https?:$/.test(u.protocol)) return 'solo se admiten URLs http(s)';
  if (u.username || u.password) return 'URL con credenciales incrustadas: no se admite';
  const h = u.hostname.toLowerCase().replace(/\.+$/, '');
  if ((!h.includes('.') && !h.includes(':')) || /(^|\.)(localhost|local|internal|intranet|lan|home\.arpa)$/.test(h) || ipPrivada(h)) return `dirección local o privada (${h}): KRATOS no la consulta`;
  return null;
}
const sinCredenciales = (h: Record<string, string>) => Object.fromEntries(Object.entries(h).filter(([k]) => !/^(authorization|x-api-key|cookie)$/i.test(k)));
const MAX_BYTES = 80e6;
// Texto con su codificación real (cabecera o <meta charset>); sin declarar y con caracteres inválidos en UTF-8 → windows-1252 (páginas antiguas de los archivos esotéricos)
function decodificarCuerpo(buf: Buffer, ct: string): string {
  const declarado = /charset=["']?([\w-]+)/i.exec(ct)?.[1] ?? /<meta[^>]+charset=["']?([\w-]+)/i.exec(buf.subarray(0, 4096).toString('latin1'))?.[1];
  const dec = (cs: string) => { try { return new TextDecoder(cs).decode(buf); } catch { return null; } };
  const t = (declarado && dec(declarado.toLowerCase())) ?? dec('utf-8') ?? buf.toString('latin1');
  return !declarado && t.includes('�') ? dec('windows-1252') ?? t : t;
}
// Cliente real (inyectable para las pruebas): redirecciones seguidas a mano y comprobadas en CADA salto (biblioteca en la sombra o dirección privada → no se pide),
// sin reenviar credenciales a otro host; DNS comprobado; 30 s por petición; cuerpo máximo de 80 MB; binarios (PDF) en latin1 (un carácter por byte). Nunca lanza.
export function clienteHttp(f: typeof fetch = fetch, resolver: (host: string) => Promise<string[]> = async (h) => (await dnsLookup(h, { all: true })).map((a) => a.address)): Get {
  return async (url, init) => {
    let actual = String(url); const host0 = (() => { try { return new URL(actual).host; } catch { return ''; } })();
    try {
      for (let salto = 0; salto <= 8; salto++) {
        // aquí cuenta el host al que se conecta (la consulta de una búsqueda puede nombrar «sci-hub.se» sin que se contacte a Sci-Hub)
        const hb = (() => { try { return new URL(actual).hostname; } catch { return ''; } })();
        if (hostBloqueado(hb)) return { status: 451, text: dominioBloqueado(`https://${hb}/`) ?? 'biblioteca en la sombra', headers: { 'x-url-final': actual } };
        const np = motivoNoPublica(actual); if (np) return { status: 0, text: `Rechazado: ${np}`, headers: { 'x-url-final': actual } };
        const u = new URL(actual), h = u.hostname.replace(/^\[|\]$/g, '');
        if (!isIP(h)) { const ips = await resolver(h).catch(() => [] as string[]); if (!ips.length) return { status: 0, text: `${h} no resuelve (DNS)`, headers: { 'x-url-final': actual } }; if (ips.some(ipPrivada)) return { status: 0, text: `Rechazado: ${h} resuelve a una dirección privada`, headers: { 'x-url-final': actual } }; }
        const cab = { 'user-agent': UA_HTTP, ...(u.host === host0 ? (init?.headers ?? {}) : sinCredenciales(init?.headers ?? {})) };
        const r = await f(actual, { redirect: 'manual', signal: AbortSignal.timeout(30_000), headers: cab });
        const headers: Record<string, string> = {}; r.headers.forEach((v, k) => { headers[k] = v; });
        if ([301, 302, 303, 307, 308].includes(r.status) && headers.location) { await r.body?.cancel().catch(() => {}); actual = new URL(headers.location, actual).toString(); continue; }
        if (Number(headers['content-length']) > MAX_BYTES) { await r.body?.cancel().catch(() => {}); return { status: 0, text: 'archivo demasiado grande (> 80 MB)', headers: { ...headers, 'x-url-final': actual } }; }
        const partes: Buffer[] = []; let n = 0;
        if (r.body) for await (const c of r.body as any) { n += c.length; if (n > MAX_BYTES) return { status: 0, text: 'archivo demasiado grande (> 80 MB)', headers: { ...headers, 'x-url-final': actual } }; partes.push(Buffer.from(c)); }
        const buf = Buffer.concat(partes), ct = headers['content-type'] ?? '';
        const text = /pdf|octet-stream/i.test(ct) || buf.subarray(0, 5).toString('latin1') === '%PDF-' ? buf.toString('latin1') : decodificarCuerpo(buf, ct);
        return { status: r.status, text, headers: { ...headers, 'x-url-final': actual } };
      }
      return { status: 0, text: 'demasiadas redirecciones', headers: { 'x-url-final': actual } };
    } catch (e: any) { return { status: 0, text: String(e?.message ?? e).slice(0, 300), headers: { 'x-url-final': actual } }; }
  };
}
export const httpGet: Get = clienteHttp();

// Secretos en el llavero de macOS (token de NASA ADS, claves opcionales). Objeto mutable: las pruebas sustituyen «leer».
const cacheSecretos = new Map<string, string | null>();
export const SECRETOS = {
  leer(servicio: string): string | null {
    if (cacheSecretos.has(servicio)) return cacheSecretos.get(servicio)!;
    let v: string | null = null;
    if (process.platform === 'darwin') try { v = execFileSync('security', ['find-generic-password', '-s', servicio, '-w'], { encoding: 'utf8', timeout: 5000, stdio: ['ignore', 'pipe', 'ignore'] }).trim() || null; } catch { v = null; }
    cacheSecretos.set(servicio, v); return v;
  },
};

// ---------- utilidades ----------
const enc = encodeURIComponent;
const uno = (x: any) => (Array.isArray(x) ? x[0] : x);
const ENTIDADES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', ndash: '–', mdash: '—', hellip: '…', lsquo: '‘', rsquo: '’', ldquo: '“', rdquo: '”', laquo: '«', raquo: '»', copy: '©', shy: '',
  aacute: 'á', eacute: 'é', iacute: 'í', oacute: 'ó', uacute: 'ú', ntilde: 'ñ', Aacute: 'Á', Eacute: 'É', Iacute: 'Í', Oacute: 'Ó', Uacute: 'Ú', Ntilde: 'Ñ', uuml: 'ü', ouml: 'ö', auml: 'ä', ccedil: 'ç', szlig: 'ß', aelig: 'æ', oelig: 'œ' };
export const decodificar = (s: string) => String(s ?? '').replace(/&#x([0-9a-f]+);/gi, (_, h) => safeChr(parseInt(h, 16))).replace(/&#(\d+);/g, (_, d) => safeChr(Number(d))).replace(/&([a-z]+);/gi, (m, n) => ENTIDADES[n] ?? m);
const safeChr = (n: number) => { try { return String.fromCodePoint(n); } catch { return ' '; } };
const limpio = (s: unknown, n = 300) => decodificar(String(s ?? '').replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim().slice(0, n);
const espera = (ms: number) => new Promise((r) => setTimeout(r, ms));
const anioDe = (s: unknown) => { const m = /\b(1[0-9]{3}|20[0-9]{2})\b/.exec(String(s ?? '')); return m ? Number(m[1]) : null; };
const autoresTxt = (a: unknown[]) => { const l = (a ?? []).map((x) => limpio(x, 90)).filter(Boolean); return l.length ? (l.slice(0, 8).join('; ') + (l.length > 8 ? ' et al.' : '')).slice(0, 300) : null; };
const decodificarUri = (s: string) => { try { return decodeURIComponent(s); } catch { return s; } };
const sinAcentos = (s: string) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
const hostDe = (u: string) => { try { return new URL(u).hostname.toLowerCase().replace(/^www\./, ''); } catch { return ''; } };
const enHost = (u: string, dominios: string[]) => { const h = hostDe(u); return dominios.some((d) => h === d || h.endsWith('.' + d)); };
export const tituloHtml = (html: string) => { const m = /<title[^>]*>([\s\S]{1,400}?)<\/title>/i.exec(html ?? ''); return m ? limpio(m[1]) || null : null; };

export function limpiarDoi(s?: string | null): string | null {
  const d = decodificarUri(String(s ?? '').trim()).replace(/^https?:\/\/(dx\.)?doi\.org\//i, '').replace(/^doi:\s*/i, '').trim();
  return /^10\.\d{4,9}\/\S+$/.test(d) ? d : null;
}
// El DOI va codificado en las rutas de las API (los DOI SICI llevan «<>;#?»); la barra se conserva
const encDoi = (d: string) => d.split('/').map(enc).join('/');
const doiUrl = (d: string) => `https://doi.org/${encDoi(d)}`;
export const ESTADOS: Estado[] = ['publicado', 'preprint', 'retractado', 'corregido', 'manuscrito', 'libro', 'documento', 'desconocido'];
// Prefijos DOI de servidores de preprints: lo que llega con ellos no es un artículo revisado aunque el registro diga «publicado»
const DOI_PREPRINT = /^10\.(48550|31234|31219|31222|31235|26434|20944\/preprints|21203\/rs\.|2139\/ssrn|1101\/(\d{4}\.\d{2}\.\d{2}\.)?\d{6,}$)/i;

// Una sola petición con un reintento corto si el servicio limita (429) o está saturado (503)
async function pedir(get: Get, url: string, headers?: Record<string, string>, maxEspera = AJUSTES.espera429Ms) {
  const init = headers ? { headers } : undefined;
  let r = await get(url, init);
  if (r.status === 429 || r.status === 503) {
    let ra = Number(r.headers?.['retry-after']); if (!(ra > 0)) try { ra = Number(JSON.parse(r.text).retryAfter); } catch { ra = NaN; }
    await espera(Math.min(ra > 0 ? ra * 1000 : AJUSTES.espera429Ms, maxEspera));
    r = await get(url, init);
  }
  return r;
}
function json(r: Respuesta, quien: string): any {
  if (r.status === 429) throw new Error(`${quien}: límite de peticiones (429) incluso tras un reintento; no hay resultados (no se inventan)`);
  if (r.status !== 200) throw new Error(`${quien} respondió ${r.status}${r.status === 0 ? ` (sin conexión: ${limpio(r.text, 120)})` : ''}`);
  try { return JSON.parse(r.text); } catch { throw new Error(`${quien}: la respuesta no es JSON válido`); }
}

// HTML → texto legible (sin scripts, menús ni pies; las fórmulas de ar5iv conservan su texto alternativo)
export function htmlATexto(html: string): string {
  const s = String(html ?? '').replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<(script|style|noscript|head|nav|footer|form|svg|button|select)\b[\s\S]*?<\/\1\s*>/gi, ' ')
    .replace(/<math\b[^>]*?alttext="([^"]*)"[\s\S]*?<\/math>/gi, ' $1 ')
    .replace(/<br\s*\/?>/gi, '\n').replace(/<\/(p|div|h[1-6]|li|tr|section|article|blockquote|pre|table|dd|dt|figcaption|center)\s*>/gi, '\n').replace(/<(p|hr)\b[^>]*>/gi, '\n')
    .replace(/<[^>]+>/g, ' ');
  return decodificar(s).replace(/[ \t ]+/g, ' ').replace(/ *\n */g, '\n').replace(/\n{3,}/g, '\n\n').trim();
}

// Desafío anti-bots (Cloudflare u otro): se informa, nunca se elude
export const desafioAntibots = (r: Respuesta) => [403, 429, 503].includes(r.status) && /cloudflare|just a moment|cf-chl|attention required|captcha|challenge-platform/i.test(String(r.text ?? '').slice(0, 30_000));

// ---------- R15: guarda de acceso legal ----------
export const DOMINIOS_BLOQUEADOS = ['sci-hub.*', 'scihub.*', 'sci-net.*', 'libgen.*', 'gen.lib.rus.ec', 'library.lol', 'libstc.cc', 'standard-template-construct.org', 'z-library.*', 'z-lib.*', 'zlibrary.*', '1lib.*', 'b-ok.*', 'booksc.*', 'bookfi.*', 'booksee.*', 'singlelogin.*',
  'annas-archive.*', 'annas-blog.*', 'welib.*', 'pdfdrive.*', 'ebookee.*', 'oceanofpdf.*', 'dokumen.pub', 'vdoc.pub', 'epdf.pub', 'ebin.pub', 'pdfcoffee.com'];
const RX_BLOQUEO = DOMINIOS_BLOQUEADOS.map((p) => new RegExp(`(^|\\.)${p.replace(/\.\*$/, '').replace(/[.]/g, '\\.')}${p.endsWith('.*') ? '\\.[a-z0-9.-]+' : ''}$`, 'i'));
export const hostBloqueado = (h: string) => { const x = String(h ?? '').toLowerCase().replace(/^\[|\]$/g, '').replace(/\.+$/, '').replace(/^www\./, ''); return !!x && RX_BLOQUEO.some((r) => r.test(x)); };
const ALTERNATIVAS_LEGALES = 'Alternativas legales: accion=legal_por_doi (copias abiertas según OpenAlex/Unpaywall), PubMed Central/Europe PMC, arXiv, la copia abierta del editor, repositorios institucionales, la versión del autor (se puede pedir al autor), préstamo interbibliotecario o comprar el acceso.';
// Devuelve el motivo del rechazo si la URL apunta a una biblioteca en la sombra, o la lleva dentro (también sin esquema, con usuario@, con el punto final
// del FQDN o codificada varias veces: …?u=https%253A%252F%252Fsci-hub.se); null si no. Se comparan todos los nombres de dominio que aparecen en la cadena.
export function dominioBloqueado(url: string): string | null {
  const s = String(url ?? ''); const variantes = [s]; let d = s;
  for (let k = 0; k < 4; k++) { const n = decodificar(decodificarUri(d)); if (n === d) break; variantes.push(n); d = n; }
  const hosts = new Set<string>(); const h0 = hostDe(s); if (h0) hosts.add(h0);
  for (const v of variantes) for (const m of v.toLowerCase().matchAll(/[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)+/g)) hosts.add(m[0]);
  for (const h of hosts) if (hostBloqueado(h))
    return `Rechazado: ${h} es una biblioteca en la sombra (Sci-Hub, LibGen, Z-Library, Anna's Archive y similares) que distribuye obras con derechos sin autorización. KRATOS no la consulta, no la lee y no la registra. ${ALTERNATIVAS_LEGALES}`;
  return null;
}
export function exigirLegal(url: string) { const m = dominioBloqueado(url); if (m) throw new Error(m); }

export const NOTA_SCIHUB = {
  texto: 'Sci-Hub es un sitio web creado en 2011 por Alexandra Elbakyan (Kazajistán) que distribuye, sin autorización de los editores, copias de artículos científicos de pago. Es un hito histórico del debate sobre el acceso a la literatura científica. ' +
    'Bohannon (Science, 2016) analizó sus registros: unos 28 millones de descargas en seis meses (sept. 2015–feb. 2016) desde casi todos los países, también desde universidades con suscripción. ' +
    'Himmelstein et al. (eLife, 2018) estimaron que su colección contenía el 68,9 % de los 81,6 millones de artículos con DOI de Crossref y el 85,1 % de los publicados en revistas de pago. ' +
    'Elsevier y otros editores la han demandado; en 2017 un tribunal federal de Nueva York concedió a Elsevier 15 millones de dólares por daños (Nature, 2017). ' +
    'KRATOS la estudia como contexto histórico y social; no la usa para obtener textos: la ingesta automática solo usa vías legales basadas en el DOI.',
  referencias: [
    { titulo: "Who's downloading pirated papers? Everyone", autores: 'Bohannon, J.', revista: 'Science 352(6285):508-512', anio: 2016, doi: '10.1126/science.352.6285.508', url: 'https://doi.org/10.1126/science.352.6285.508' },
    { titulo: 'Sci-Hub provides access to nearly all scholarly literature', autores: 'Himmelstein, D. S.; Romero, A. R.; Levernier, J. G.; Munro, T. A.; McLaughlin, S. R.; Greshake Tzovaras, B.; Greene, C. S.', revista: 'eLife 7:e32822', anio: 2018, doi: '10.7554/eLife.32822', url: 'https://doi.org/10.7554/eLife.32822' },
    { titulo: 'US court grants Elsevier millions in damages from Sci-Hub', autores: 'Schiermeier, Q.', revista: 'Nature (noticia)', anio: 2017, doi: '10.1038/nature.2017.22196', url: 'https://doi.org/10.1038/nature.2017.22196' },
  ],
  verificado: 'Los tres DOI se comprobaron en api.crossref.org el 5-nov-2026 (título, revista y fecha coinciden).',
};

// ---------- catálogo ----------
export const CONECTORES: Record<string, { codigo: string; nombre: string; area: 'ciencia' | 'esoterismo' | 'acceso'; descripcion: string; requiere?: string }> = {
  R01: { codigo: 'R01', nombre: 'OpenAlex', area: 'ciencia', descripcion: 'Descubrimiento de literatura: obras, autores, citas, retractaciones y acceso abierto (api.openalex.org).', requiere: 'opcional: clave en el llavero (servicio kratos-openalex); sin ella la búsqueda anónima puede limitarse (429)' },
  R02: { codigo: 'R02', nombre: 'arXiv', area: 'ciencia', descripcion: 'Preprints de física, matemáticas, computación y otras (API Atom de export.arxiv.org); texto en arxiv.org/html o ar5iv.' },
  R03: { codigo: 'R03', nombre: 'Semantic Scholar', area: 'ciencia', descripcion: 'Trabajos relacionados, citas y PDF abiertos (api.semanticscholar.org).', requiere: 'opcional: clave en el llavero (servicio kratos-s2); sin clave el cupo anónimo compartido da 429 a menudo' },
  R04: { codigo: 'R04', nombre: 'Crossref', area: 'ciencia', descripcion: 'Metadatos DOI, verificación de publicación, retractaciones y correcciones (api.crossref.org).' },
  R05: { codigo: 'R05', nombre: 'PubMed y Europe PMC', area: 'ciencia', descripcion: 'Neurociencia, psicología, biología y medicina (E-utilities y Europe PMC); texto completo del subconjunto abierto de PMC.' },
  R06: { codigo: 'R06', nombre: 'INSPIRE-HEP', area: 'ciencia', descripcion: 'Física de partículas y altas energías (inspirehep.net).' },
  R07: { codigo: 'R07', nombre: 'OSTI', area: 'ciencia', descripcion: 'Energía, física e informes técnicos del DOE (osti.gov).' },
  R08: { codigo: 'R08', nombre: 'NASA NTRS y NASA ADS', area: 'ciencia', descripcion: 'Informes técnicos de la NASA (NTRS, público) y astrofísica (ADS).', requiere: 'ADS: token en el llavero (security add-generic-password -s kratos-ads -a kratos -w TOKEN); NTRS funciona sin él' },
  R09: { codigo: 'R09', nombre: 'Unpaywall y repositorios abiertos', area: 'acceso', descripcion: 'Copias legales de acceso abierto por DOI (datos de Unpaywall vía OpenAlex, PMC, arXiv, editor).', requiere: 'opcional: system_state.unpaywall_email para la llamada directa a api.unpaywall.org (nunca se usa el correo del propietario automáticamente)' },
  R10: { codigo: 'R10', nombre: 'Internet Archive y Project Gutenberg', area: 'esoterismo', descripcion: 'Obras históricas y de dominio público (archive.org, gutendex.com/gutenberg.org).' },
  R11: { codigo: 'R11', nombre: 'Hermetic Library y Esoteric Archives', area: 'esoterismo', descripcion: 'Literatura hermética y grimorios: búsqueda por palabras en los índices de hermetic.com y esotericarchives.com.' },
  R12: { codigo: 'R12', nombre: 'Internet Sacred Text Archive e IAPSOP', area: 'esoterismo', descripcion: 'Colecciones espirituales, ocultistas y filosóficas: índices de sacred-texts.com e iapsop.com.' },
  R13: { codigo: 'R13', nombre: 'Colecciones académicas de esoterismo', area: 'esoterismo', descripcion: 'Directorio académico (HHP Ámsterdam, ESSWE, Embassy of the Free Mind, Warburg, Wellcome) y catálogo de Wellcome Collection.' },
  R14: { codigo: 'R14', nombre: 'Materiales raros e iniciáticos', area: 'esoterismo', descripcion: 'Manuscritos digitalizados en línea (Wellcome) y textos con licencia o dominio público (Internet Archive).' },
  R15: { codigo: 'R15', nombre: 'Sci-Hub como contexto (solo vías legales)', area: 'acceso', descripcion: 'Contexto histórico de Sci-Hub y guarda que rechaza bibliotecas en la sombra; alternativas legales por DOI.' },
  R16: { codigo: 'R16', nombre: 'Preprints y resultados negativos', area: 'ciencia', descripcion: 'Preprints, retractaciones y posibles resultados negativos o replicaciones fallidas (filtros de OpenAlex, avisos de retractación de Crossref y títulos en Europe PMC).' },
};
const CODIGOS = Object.keys(CONECTORES);

// ---------- R01 OpenAlex ----------
const OA_CAMPOS = 'id,doi,title,display_name,publication_year,publication_date,type,is_retracted,cited_by_count,open_access,primary_location,best_oa_location,locations,authorships,ids,abstract_inverted_index';
const oaClave = () => { const k = SECRETOS.leer('kratos-openalex'); return k ? `&api_key=${enc(k)}` : ''; };
const resumenInvertido = (ii: Record<string, number[]> | null | undefined) => {
  if (!ii || typeof ii !== 'object') return null;
  const pal: string[] = []; for (const [w, pos] of Object.entries(ii)) for (const p of pos ?? []) if (p < 4000) pal[p] = w;
  const t = pal.filter(Boolean).join(' '); return t ? t.slice(0, 1200) : null;
};
export type Ubicacion = { url: string; tipo: 'pdf' | 'html' | 'xml'; pdf_url: string | null; landing_url: string | null; licencia: string | null; version: string | null; origen: string; repositorio: string | null; arxiv?: string | null; pmcid?: string | null };
export type RegistroOA = Registro & { pmcid: string | null; arxiv: string | null; ubicaciones_oa: Ubicacion[] };
const idArxivDeUrl = (u?: string | null) => { const m = /arxiv\.org\/(?:abs|pdf|html)\/(\d{4}\.\d{4,5}(?:v\d+)?|[a-z-]+(?:\.[a-z]{2})?\/\d{7}(?:v\d+)?)/i.exec(String(u ?? '')); return m ? m[1] : null; };
const pmcidDe = (s?: string | null) => { const m = /PMC\s*(\d+)/i.exec(String(s ?? '')) ?? /pmc\/articles\/(\d+)/i.exec(String(s ?? '')); return m ? `PMC${m[1]}` : null; };

export function parseOpenAlexWork(w: any, codigo = 'R01'): RegistroOA {
  const doi = limpiarDoi(w?.doi);
  const best = w?.best_oa_location?.is_oa ? w.best_oa_location : null;
  const tipo = String(w?.type ?? '');
  const estado: Estado = w?.is_retracted ? 'retractado' : ['preprint', 'posted-content'].includes(tipo) ? 'preprint' : ['book', 'book-chapter', 'monograph', 'edited-book', 'reference-book'].includes(tipo) ? 'libro'
    : ['report', 'dataset', 'dissertation', 'standard', 'other', 'grant', 'peer-review', 'supplementary-materials'].includes(tipo) ? 'documento' : tipo ? 'publicado' : 'desconocido';
  const ubic: Ubicacion[] = [];
  for (const l of [best, ...(w?.locations ?? [])]) {
    if (!l?.is_oa) continue;
    const u = l.pdf_url || l.landing_page_url; if (!u || ubic.some((x) => x.url === u)) continue;
    ubic.push({ url: u, tipo: l.pdf_url ? 'pdf' : 'html', pdf_url: l.pdf_url ?? null, landing_url: l.landing_page_url ?? null, licencia: l.license ?? null, version: l.version ?? null, origen: 'OpenAlex (datos de Unpaywall)', repositorio: l.source?.display_name ?? null,
      arxiv: idArxivDeUrl(l.landing_page_url) ?? idArxivDeUrl(l.pdf_url), pmcid: pmcidDe(l.landing_page_url ?? '') });
  }
  const oa = w?.open_access;
  const pmcid = pmcidDe(w?.ids?.pmcid) ?? ubic.find((u) => u.pmcid)?.pmcid ?? null;
  return {
    conector: codigo, titulo: limpio(w?.title ?? w?.display_name) || '(sin título)', autores: autoresTxt((w?.authorships ?? []).map((a: any) => a?.author?.display_name)),
    anio: Number(w?.publication_year) || null, fecha: w?.publication_date ?? null, doi, identificador: String(w?.id ?? '').replace(/^https:\/\/openalex\.org\//, '') || null,
    url: doi ? doiUrl(doi) : (w?.primary_location?.landing_page_url ?? w?.id), estado_publicacion: estado,
    texto_disponible: oa ? oa.is_oa === true : null, texto_url: best?.pdf_url ?? oa?.oa_url ?? null,
    permisos: best?.license ? `acceso abierto, licencia ${best.license}${best.version ? ` (${best.version})` : ''}` : oa?.is_oa ? `acceso abierto (${oa.oa_status ?? 'sin estado'}); licencia no indicada` : oa ? 'solo metadatos: no consta copia de acceso abierto' : null,
    resumen: resumenInvertido(w?.abstract_inverted_index), citas: Number.isFinite(Number(w?.cited_by_count)) ? Number(w.cited_by_count) : null,
    pmcid, arxiv: ubic.find((u) => u.arxiv)?.arxiv ?? null, ubicaciones_oa: ubic,
  };
}
const sinExtras = ({ pmcid, arxiv, ubicaciones_oa, ...r }: RegistroOA): Registro => r;
async function openalexBuscar(consulta: string, max: number, get: Get, filtro?: string, codigo = 'R01'): Promise<Resultado> {
  const r = await pedir(get, `https://api.openalex.org/works?search=${enc(consulta)}&per-page=${max}&select=${OA_CAMPOS}${filtro ? `&filter=${filtro}` : ''}${oaClave()}`, undefined, Math.max(AJUSTES.espera429Ms, AJUSTES.esperaOpenAlexMs));
  if (r.status === 429) throw new Error(`OpenAlex limitó la búsqueda anónima (429) incluso tras un reintento${SECRETOS.leer('kratos-openalex') ? '' : '; con una clave gratuita en el llavero (kratos-openalex) se evita'}; no hay resultados (no se inventan)`);
  const j = json(r, 'OpenAlex');
  return { registros: (j.results ?? []).map((w: any) => sinExtras(parseOpenAlexWork(w, codigo))), total: j.meta?.count ?? null };
}
export async function openalexPorDoi(doi: string, get: Get = httpGet): Promise<RegistroOA | null> {
  const d = limpiarDoi(doi); if (!d) throw new Error('DOI no válido');
  const r = await pedir(get, `https://api.openalex.org/works/doi:${encDoi(d)}?select=${OA_CAMPOS}${oaClave()}`);
  if (r.status === 404) return null;
  return parseOpenAlexWork(json(r, 'OpenAlex'), 'R01');
}

// ---------- R02 arXiv ----------
const etiqueta = (x: string, t: string) => { const m = new RegExp(`<${t}[^>]*>([\\s\\S]*?)<\\/${t}>`).exec(x); return m ? limpio(m[1], 4000) : null; };
export function parseArxiv(xml: string, codigo = 'R02'): Registro[] {
  const out: Registro[] = [];
  for (const e of String(xml ?? '').split(/<entry>/).slice(1).map((s) => s.split('</entry>')[0])) {
    const idUrl = etiqueta(e, 'id') ?? '';
    if (/api\/errors/.test(idUrl)) throw new Error(`arXiv devolvió un error: ${etiqueta(e, 'summary') ?? 'consulta no válida'}`);
    const conVersion = idUrl.replace(/^https?:\/\/arxiv\.org\/abs\//, ''); const id = conVersion.replace(/v\d+$/, '');
    if (!id) continue;
    const autores = [...e.matchAll(/<name>([\s\S]*?)<\/name>/g)].map((m) => m[1]);
    const doi = limpiarDoi(etiqueta(e, 'arxiv:doi')); const revista = etiqueta(e, 'arxiv:journal_ref'); const fecha = (etiqueta(e, 'published') ?? '').slice(0, 10) || null;
    out.push({ conector: codigo, titulo: limpio(etiqueta(e, 'title')) || id, autores: autoresTxt(autores), anio: anioDe(fecha), fecha, doi, identificador: `arXiv:${id}`, url: `https://arxiv.org/abs/${id}`,
      estado_publicacion: 'preprint', texto_disponible: true, texto_url: `https://arxiv.org/html/${id}`,
      permisos: `arXiv: preprint de lectura abierta (licencia según el envío)${revista ? `; publicado después en ${revista}` : doi ? `; versión publicada con DOI ${doi}` : ''}`,
      resumen: limpio(etiqueta(e, 'summary'), 1200) || null, citas: null });
  }
  return out;
}
const buscarArxiv: Buscador = async (q, max, get) => {
  const sq = sinAcentos(q).split(/\s+/).filter((w) => w.length > 1).slice(0, 8).map((w) => `all:${enc(w)}`).join('+AND+');
  const r = await pedir(get, `https://export.arxiv.org/api/query?search_query=${sq || 'all:' + enc(q)}&max_results=${max}`);
  if (r.status !== 200) throw new Error(`arXiv respondió ${r.status}`);
  const total = Number(/<opensearch:totalResults[^>]*>(\d+)</.exec(r.text)?.[1]);
  return { registros: parseArxiv(r.text), total: Number.isFinite(total) ? total : null };
};

// ---------- R03 Semantic Scholar ----------
export function parseS2(j: any, codigo = 'R03'): Registro[] {
  return (j?.data ?? []).map((p: any) => {
    const ex = p.externalIds ?? {}; const doi = limpiarDoi(ex.DOI); const tipos: string[] = p.publicationTypes ?? [];
    const pdf = p.openAccessPdf?.url || null;
    const estado: Estado = tipos.includes('Book') ? 'libro' : tipos.some((t) => ['JournalArticle', 'Conference', 'Review', 'Editorial', 'LettersAndComments', 'CaseReport', 'ClinicalTrial', 'MetaAnalysis', 'Study'].includes(t)) ? 'publicado' : ex.ArXiv && !doi ? 'preprint' : 'desconocido';
    return { conector: codigo, titulo: limpio(p.title) || '(sin título)', autores: autoresTxt((p.authors ?? []).map((a: any) => a.name)), anio: Number(p.year) || null, fecha: p.year ? String(p.year) : null, doi,
      identificador: ex.ArXiv ? `arXiv:${ex.ArXiv}` : `S2:${p.paperId}`, url: doi ? doiUrl(doi) : `https://www.semanticscholar.org/paper/${p.paperId}`, estado_publicacion: estado,
      texto_disponible: typeof p.isOpenAccess === 'boolean' ? p.isOpenAccess : null, texto_url: pdf,
      permisos: pdf ? `acceso abierto según Semantic Scholar${p.openAccessPdf?.license ? `, licencia ${p.openAccessPdf.license}` : ''}` : p.isOpenAccess ? 'acceso abierto según Semantic Scholar (sin PDF enlazado)' : 'solo metadatos',
      resumen: null, citas: Number.isFinite(Number(p.citationCount)) ? Number(p.citationCount) : null };
  });
}
const buscarS2: Buscador = async (q, max, get) => {
  const k = SECRETOS.leer('kratos-s2');
  const r = await pedir(get, `https://api.semanticscholar.org/graph/v1/paper/search?query=${enc(q)}&limit=${max}&fields=title,authors,year,externalIds,isOpenAccess,openAccessPdf,citationCount,publicationTypes`, k ? { 'x-api-key': k } : undefined);
  if (r.status === 429) throw new Error(`Semantic Scholar limitó la consulta (429) incluso tras un reintento: el cupo anónimo es compartido${k ? '' : '; con una clave en el llavero (kratos-s2) se evita'}. No hay resultados (no se inventan)`);
  const j = json(r, 'Semantic Scholar');
  return { registros: parseS2(j), total: j.total ?? null };
};

// ---------- R04 Crossref ----------
const fechaCr = (o: any) => { const p = o?.['date-parts']?.[0]; return Array.isArray(p) && p[0] ? p.map((n: number) => String(n).padStart(2, '0')).join('-') : null; };
const RETRACTA = /retract|withdraw|removal/i, CORRIGE = /correct|errat|corrigend|addend/i;
export type InfoCrossref = { registro: Registro; actualizaciones: { tipo: string; doi: string | null; fecha: string | null; fuente: string | null; sentido: 'recibida' | 'emitida' }[]; retractado: boolean; corregido: boolean; aviso_de: string | null; preprint_de: string[] };
export function parseCrossrefItem(it: any, codigo = 'R04'): InfoCrossref {
  const doi = limpiarDoi(it?.DOI); const tipo = String(it?.type ?? ''); const titulo = limpio(uno(it?.title)) || '(sin título)';
  const act: InfoCrossref['actualizaciones'] = [];
  for (const u of it?.['updated-by'] ?? []) act.push({ tipo: String(u.type ?? u.label ?? ''), doi: limpiarDoi(u.DOI), fecha: fechaCr(u.updated), fuente: u.source ?? null, sentido: 'recibida' });
  for (const u of it?.['update-to'] ?? []) act.push({ tipo: String(u.type ?? u.label ?? ''), doi: limpiarDoi(u.DOI), fecha: fechaCr(u.updated), fuente: u.source ?? null, sentido: 'emitida' });
  const rel = it?.relation ?? {};
  // «is-retracted-by»/«…-by»: esta obra la recibe; «is-retraction-of»/«…-of»: esta obra es el aviso sobre otra
  for (const k of Object.keys(rel)) if (RETRACTA.test(k) || CORRIGE.test(k)) for (const x of rel[k] ?? []) act.push({ tipo: k, doi: limpiarDoi(x.id), fecha: null, fuente: 'crossref relation', sentido: /-by$/.test(k) ? 'recibida' : 'emitida' });
  // retractado si lo recibe (updated-by), o si una actualización emitida apunta a sí mismo (aviso integrado), o si el editor lo titula RETRACTED
  const recibe = (rx: RegExp) => act.some((a) => rx.test(a.tipo) && (a.sentido === 'recibida' || (a.doi && doi && a.doi.toLowerCase() === doi.toLowerCase())));
  const retractado = recibe(RETRACTA) || /^\s*retracted\b/i.test(titulo); const corregido = !retractado && recibe(CORRIGE);
  const avisoDe = act.find((a) => a.sentido === 'emitida' && RETRACTA.test(a.tipo) && a.doi && a.doi.toLowerCase() !== doi?.toLowerCase())?.doi ?? null;
  const fecha = fechaCr(it?.issued) ?? fechaCr(it?.published);
  const lic = it?.license?.[0]?.URL ?? null;
  const estado: Estado = retractado ? 'retractado' : corregido ? 'corregido' : tipo === 'posted-content' || it?.subtype === 'preprint' ? 'preprint'
    : ['book', 'monograph', 'edited-book', 'book-chapter', 'reference-book', 'book-part', 'book-section'].includes(tipo) ? 'libro' : ['report', 'dataset', 'dissertation', 'standard', 'report-component'].includes(tipo) ? 'documento' : tipo ? 'publicado' : 'desconocido';
  const correcciones = [...new Set(act.filter((a) => a.sentido === 'recibida' || retractado).map((a) => `${a.tipo}${a.doi && a.doi !== doi ? ` (aviso ${a.doi})` : ''}${a.fecha ? ` ${a.fecha}` : ''}${a.fuente ? ` [${a.fuente}]` : ''}`))];
  const registro: Registro = { conector: codigo, titulo, autores: autoresTxt((it?.author ?? []).map((a: any) => [a.given, a.family].filter(Boolean).join(' ') || a.name)), anio: anioDe(fecha), fecha, doi,
    identificador: null, url: doi ? doiUrl(doi) : String(it?.URL ?? ''), estado_publicacion: estado, texto_disponible: lic && /creativecommons/i.test(lic) ? true : null,
    texto_url: (it?.link ?? []).find((l: any) => /pdf/i.test(l['content-type'] ?? '') && l['intended-application'] !== 'similarity-checking')?.URL ?? null,
    permisos: lic ? `licencia ${lic}` : 'solo metadatos (Crossref no indica licencia abierta)', resumen: it?.abstract ? limpio(it.abstract, 1200) : null,
    citas: Number.isFinite(Number(it?.['is-referenced-by-count'])) ? Number(it['is-referenced-by-count']) : null, correcciones: correcciones.length ? `Crossref: ${correcciones.join('; ')}` : null };
  return { registro, actualizaciones: act, retractado, corregido, aviso_de: avisoDe, preprint_de: (rel['is-preprint-of'] ?? []).map((x: any) => x.id).filter(Boolean) };
}
const buscarCrossref: Buscador = async (q, max, get) => {
  const j = json(await pedir(get, `https://api.crossref.org/works?query=${enc(q)}&rows=${max}`), 'Crossref');
  return { registros: (j.message?.items ?? []).map((it: any) => parseCrossrefItem(it).registro), total: j.message?.['total-results'] ?? null };
};
export async function crossrefPorDoi(doi: string, get: Get = httpGet): Promise<InfoCrossref | null> {
  const d = limpiarDoi(doi); if (!d) throw new Error('DOI no válido');
  const r = await pedir(get, `https://api.crossref.org/works/${encDoi(d)}`);
  if (r.status === 404) return null;
  return parseCrossrefItem(json(r, 'Crossref').message);
}

// ---------- R05 PubMed y Europe PMC ----------
export function parsePubmedResumen(j: any, codigo = 'R05'): Registro[] {
  const res = j?.result ?? {};
  return (res.uids ?? []).map((uid: string) => {
    const a = res[uid] ?? {}; const ids: any[] = a.articleids ?? [];
    const doi = limpiarDoi(ids.find((x) => x.idtype === 'doi')?.value); const pmcid = pmcidDe(ids.find((x) => x.idtype === 'pmc')?.value);
    const tipos: string[] = a.pubtype ?? [];
    const estado: Estado = tipos.includes('Retracted Publication') ? 'retractado' : tipos.includes('Preprint') ? 'preprint' : 'publicado';
    const fecha = String(a.sortpubdate ?? '').slice(0, 10).replace(/\//g, '-') || a.pubdate || null;
    return { conector: codigo, titulo: limpio(a.title).replace(/\.$/, '') || `PMID ${uid}`, autores: autoresTxt((a.authors ?? []).map((x: any) => x.name)), anio: anioDe(a.pubdate), fecha, doi,
      identificador: pmcid ?? `PMID:${uid}`, url: `https://pubmed.ncbi.nlm.nih.gov/${uid}/`, estado_publicacion: estado, texto_disponible: pmcid ? true : null,
      texto_url: pmcid ? `https://pmc.ncbi.nlm.nih.gov/articles/${pmcid}/` : null,
      permisos: pmcid ? 'PubMed Central: lectura libre; reutilización según la licencia del artículo' : 'solo metadatos y resumen en PubMed', resumen: null, citas: null,
      correcciones: estado === 'retractado' ? 'PubMed: tipo «Retracted Publication»' : null };
  });
}
export function parseEuropePmc(j: any, codigo = 'R05'): Registro[] {
  return (j?.resultList?.result ?? []).map((a: any) => {
    const doi = limpiarDoi(a.doi); const pmcid = pmcidDe(a.pmcid); const abierto = a.isOpenAccess === 'Y';
    const tipo = String(a.pubType ?? '').toLowerCase();
    const estado: Estado = /retracted publication/.test(tipo) ? 'retractado' : a.source === 'PPR' || /preprint/.test(tipo) ? 'preprint' : 'publicado';
    return { conector: codigo, titulo: limpio(a.title).replace(/\.$/, '') || '(sin título)', autores: limpio(a.authorString, 300) || null, anio: Number(a.pubYear) || null, fecha: a.firstPublicationDate ?? (a.pubYear ? String(a.pubYear) : null), doi,
      identificador: pmcid ?? (a.pmid ? `PMID:${a.pmid}` : `${a.source}:${a.id}`), url: pmcid ? `https://europepmc.org/article/PMC/${pmcid}` : a.pmid ? `https://europepmc.org/article/MED/${a.pmid}` : `https://europepmc.org/article/${a.source}/${a.id}`,
      estado_publicacion: estado, texto_disponible: abierto && !!pmcid, texto_url: abierto && pmcid ? `https://www.ebi.ac.uk/europepmc/webservices/rest/${pmcid}/fullTextXML` : null,
      permisos: abierto ? 'Europe PMC, subconjunto de acceso abierto (licencia según el artículo)' : 'solo metadatos y resumen (no está en el subconjunto abierto)', resumen: null,
      citas: Number.isFinite(Number(a.citedByCount)) ? Number(a.citedByCount) : null, correcciones: estado === 'retractado' ? 'Europe PMC: tipo «retracted publication»' : null };
  });
}
const buscarBiomed: Buscador = async (q, max, get) => {
  const regs: Registro[] = [], errores: string[] = [], partes: Record<string, number | string> = {};
  try {
    const s = json(await pedir(get, `https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esearch.fcgi?db=pubmed&term=${enc(q)}&retmax=${max}&retmode=json&tool=kratos-sol`), 'PubMed (esearch)');
    if (s.esearchresult?.ERROR) throw new Error(`PubMed: ${limpio(s.esearchresult.ERROR, 160)}`);
    const ids: string[] = s.esearchresult?.idlist ?? [];
    if (ids.length) regs.push(...parsePubmedResumen(json(await pedir(get, `https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esummary.fcgi?db=pubmed&id=${ids.join(',')}&retmode=json&tool=kratos-sol`), 'PubMed (esummary)')));
    partes.PubMed = ids.length;
  } catch (e: any) { errores.push(e.message); partes.PubMed = `error: ${e.message}`; }
  try {
    const j = json(await pedir(get, `https://www.ebi.ac.uk/europepmc/webservices/rest/search?query=${enc(q)}&format=json&pageSize=${max}&resultType=lite`), 'Europe PMC');
    const r = parseEuropePmc(j); regs.push(...r); partes['Europe PMC'] = r.length;
  } catch (e: any) { errores.push(e.message); partes['Europe PMC'] = `error: ${e.message}`; }
  if (errores.length === 2) throw new Error(errores.join(' · '));
  return { registros: fusionar(regs), aviso: errores.length ? `Parcial: ${errores[0]}` : undefined, partes };
};

// ---------- R06 INSPIRE-HEP ----------
export function parseInspire(j: any, codigo = 'R06'): Registro[] {
  return (j?.hits?.hits ?? []).map((h: any) => {
    const m = h.metadata ?? {}; const doi = limpiarDoi(m.dois?.[0]?.value); const ax = m.arxiv_eprints?.[0]?.value ?? null;
    const pub = (m.publication_info ?? []).find((p: any) => p.journal_title); const fecha = m.preprint_date ?? (pub?.year ? String(pub.year) : null);
    return { conector: codigo, titulo: limpio(m.titles?.[0]?.title) || `INSPIRE ${h.id}`, autores: autoresTxt((m.authors ?? []).map((a: any) => a.full_name)), anio: Number(pub?.year) || anioDe(fecha), fecha, doi,
      identificador: ax ? `arXiv:${ax}` : `INSPIRE:${h.id}`, url: `https://inspirehep.net/literature/${h.id}`, estado_publicacion: pub ? 'publicado' : ax ? 'preprint' : 'desconocido',
      texto_disponible: ax ? true : null, texto_url: ax ? `https://arxiv.org/html/${ax}` : null,
      permisos: ax ? `preprint abierto en arXiv (${ax})${pub ? `; publicado en ${pub.journal_title} ${pub.journal_volume ?? ''}`.trim() : ''}` : 'solo metadatos', resumen: null,
      citas: Number.isFinite(Number(m.citation_count)) ? Number(m.citation_count) : null };
  });
}
const buscarInspire: Buscador = async (q, max, get) => {
  const j = json(await pedir(get, `https://inspirehep.net/api/literature?q=${enc(q)}&size=${max}&fields=titles,authors.full_name,dois,arxiv_eprints,publication_info,citation_count,preprint_date`), 'INSPIRE-HEP');
  return { registros: parseInspire(j), total: j.hits?.total ?? null };
};

// ---------- R07 OSTI ----------
export function parseOsti(lista: any, codigo = 'R07'): Registro[] {
  return (Array.isArray(lista) ? lista : []).map((r: any) => {
    const doi = limpiarDoi(r.doi); const links: any[] = r.links ?? []; const ft = links.find((l) => l.rel === 'fulltext')?.href ?? null;
    const pt = String(r.product_type ?? '');
    const estado: Estado = /journal|conference/i.test(pt) ? 'publicado' : /book/i.test(pt) ? 'libro' : /report|thesis|dissertation|patent|dataset|software/i.test(pt) ? 'documento' : 'desconocido';
    return { conector: codigo, titulo: limpio(r.title) || `OSTI ${r.osti_id}`, autores: autoresTxt((r.authors ?? []).map((a: string) => String(a).replace(/\s*\[[^\]]*\]/g, '').replace(/\s*\(ORCID:[^)]*\)/g, ''))),
      anio: anioDe(r.publication_date), fecha: String(r.publication_date ?? '').slice(0, 10) || null, doi, identificador: `OSTI:${r.osti_id}`,
      url: links.find((l) => l.rel === 'citation')?.href ?? `https://www.osti.gov/biblio/${r.osti_id}`, estado_publicacion: estado, texto_disponible: ft ? true : null, texto_url: ft,
      permisos: ft ? 'OSTI (DOE): texto completo público enlazado; derechos según el editor o el DOE' : 'solo metadatos en OSTI', resumen: limpio(r.description, 1200) || null, citas: null };
  });
}
const buscarOsti: Buscador = async (q, max, get) => {
  const r = await pedir(get, `https://www.osti.gov/api/v1/records?q=${enc(q)}&rows=${max}`, { Accept: 'application/json' });
  const j = json(r, 'OSTI'); const total = Number(r.headers?.['x-total-count']);
  return { registros: parseOsti(j).slice(0, max), total: Number.isFinite(total) ? total : null };
};

// ---------- R08 NASA NTRS y ADS ----------
export function parseNtrs(j: any, codigo = 'R08'): Registro[] {
  return (j?.results ?? []).map((r: any) => {
    const dl = (r.downloads ?? []).find((d: any) => d.links?.pdf || d.links?.original);
    const st = String(r.stiType ?? ''); const fecha = String(r.publications?.[0]?.publicationDate ?? r.created ?? '').slice(0, 10) || null;
    const det = r.copyright?.determinationType ? String(r.copyright.determinationType) : null;
    return { conector: codigo, titulo: limpio(r.title) || `NTRS ${r.id}`, autores: autoresTxt((r.authorAffiliations ?? []).sort((a: any, b: any) => (a.sequence ?? 0) - (b.sequence ?? 0)).map((a: any) => a.meta?.author?.name)),
      anio: anioDe(fecha), fecha, doi: null, identificador: `NTRS:${r.id}`, url: `https://ntrs.nasa.gov/citations/${r.id}`,
      estado_publicacion: /JOURNAL_ARTICLE|CONFERENCE_PAPER/.test(st) ? 'publicado' : st ? 'documento' : 'desconocido', texto_disponible: r.downloadsAvailable === true,
      texto_url: dl ? `https://ntrs.nasa.gov${dl.links.pdf ?? dl.links.original}` : null,
      permisos: `NTRS (distribución ${String(r.distribution ?? 'desconocida').toLowerCase()})${det ? `; derechos: ${det}` : ''}${r.copyright?.approverComments ? `; ${limpio(r.copyright.approverComments, 160)}` : ''}`,
      resumen: limpio(r.abstract, 1200) || null, citas: null };
  });
}
export function parseAds(j: any, codigo = 'R08'): Registro[] {
  return (j?.response?.docs ?? []).map((d: any) => {
    const doi = limpiarDoi(uno(d.doi)); const prop: string[] = d.property ?? [];
    return { conector: codigo, titulo: limpio(uno(d.title)) || d.bibcode, autores: autoresTxt(d.author ?? []), anio: Number(d.year) || null, fecha: d.pubdate ?? (d.year ? String(d.year) : null), doi,
      identificador: `ADS:${d.bibcode}`, url: `https://ui.adsabs.harvard.edu/abs/${d.bibcode}/abstract`, estado_publicacion: prop.includes('REFEREED') ? 'publicado' : d.doctype === 'eprint' ? 'preprint' : 'desconocido',
      texto_disponible: prop.includes('OPENACCESS') ? true : prop.length ? false : null, texto_url: null, permisos: prop.includes('OPENACCESS') ? 'acceso abierto según ADS' : 'solo metadatos (ADS)',
      resumen: null, citas: Number.isFinite(Number(d.citation_count)) ? Number(d.citation_count) : null };
  });
}
const buscarNasa: Buscador = async (q, max, get) => {
  const partes: Record<string, number | string> = {}; const regs: Registro[] = []; let errNtrs: string | null = null;
  try { const j = json(await pedir(get, `https://ntrs.nasa.gov/api/citations/search?q=${enc(q)}&page.size=${max}`), 'NASA NTRS'); const r = parseNtrs(j).slice(0, max); regs.push(...r); partes.NTRS = r.length; }
  catch (e: any) { errNtrs = e.message; partes.NTRS = `error: ${e.message}`; }
  const token = SECRETOS.leer('kratos-ads');
  if (!token) partes.ADS = 'BLOQUEADO: falta el token de NASA ADS en el llavero (servicio kratos-ads); el propietario debe crearlo en ui.adsabs.harvard.edu y guardarlo';
  else try { const j = json(await pedir(get, `https://api.adsabs.harvard.edu/v1/search/query?q=${enc(q)}&rows=${max}&fl=title,author,year,doi,bibcode,pubdate,citation_count,doctype,property`, { Authorization: `Bearer ${token}` }), 'NASA ADS'); const r = parseAds(j); regs.push(...r); partes.ADS = r.length; }
  catch (e: any) { partes.ADS = `error: ${e.message}`; }
  if (errNtrs && typeof partes.ADS !== 'number') throw new Error(`${errNtrs} · ADS: ${partes.ADS}`);
  return { registros: fusionar(regs), aviso: `NTRS: ${partes.NTRS} · ADS: ${partes.ADS}`, partes };
};

// ---------- R10 Internet Archive y Project Gutenberg ----------
export function parseArchive(j: any, codigo = 'R10'): Registro[] {
  return (j?.response?.docs ?? []).map((d: any) => {
    const restringido = String(uno(d['access-restricted-item'])) === 'true'; const lic = uno(d.licenseurl) ?? null;
    const libre = /publicdomain|government-works/i.test(lic ?? '') || uno(d['possible-copyright-status']) === 'NOT_IN_COPYRIGHT';
    const creador = Array.isArray(d.creator) ? d.creator : d.creator ? [d.creator] : [];
    return { conector: codigo, titulo: limpio(uno(d.title)) || d.identifier, autores: autoresTxt(creador), anio: Number(uno(d.year)) || anioDe(uno(d.date)), fecha: uno(d.date) ? String(uno(d.date)).slice(0, 10) : d.year ? String(uno(d.year)) : null, doi: null,
      identificador: `ia:${d.identifier}`, url: `https://archive.org/details/${d.identifier}`, estado_publicacion: !d.mediatype || d.mediatype === 'texts' ? 'libro' : 'documento',
      texto_disponible: restringido ? false : lic || libre ? true : null, texto_url: restringido ? null : `https://archive.org/details/${d.identifier}`,
      permisos: restringido ? 'préstamo controlado de Internet Archive: NO es acceso abierto (solo metadatos)' : lic ? `licencia ${lic}` : libre ? 'sin derechos de autor según Internet Archive (dominio público)' : 'Internet Archive, sin licencia declarada: comprobar derechos antes de reutilizar',
      resumen: null, citas: null };
  });
}
export function parseGutendex(j: any, codigo = 'R10'): Registro[] {
  return (j?.results ?? []).map((b: any) => {
    const f = b.formats ?? {}; const txt = f['text/plain; charset=utf-8'] ?? f['text/plain; charset=us-ascii'] ?? f['text/plain'] ?? `https://www.gutenberg.org/ebooks/${b.id}.txt.utf-8`;
    return { conector: codigo, titulo: limpio(b.title) || `Gutenberg ${b.id}`, autores: autoresTxt((b.authors ?? []).map((a: any) => a.name)), anio: null, fecha: null, doi: null, identificador: `gutenberg:${b.id}`,
      url: `https://www.gutenberg.org/ebooks/${b.id}`, estado_publicacion: 'libro', texto_disponible: b.copyright === false ? true : null, texto_url: txt,
      permisos: b.copyright === false ? 'dominio público en EE. UU. (Project Gutenberg); comprobar la ley local' : 'Project Gutenberg con derechos: leer la licencia del libro',
      resumen: b.summaries?.[0] ? limpio(b.summaries[0], 800) : null, citas: null };
  });
}
const IA_CAMPOS = ['identifier', 'title', 'creator', 'year', 'date', 'licenseurl', 'mediatype', 'access-restricted-item', 'possible-copyright-status'].map((f) => `fl[]=${enc(f)}`).join('&');
const iaBuscar = async (q: string, max: number, get: Get, extra: string, codigo: string) => {
  const j = json(await pedir(get, `https://archive.org/advancedsearch.php?q=${enc(`(${q}) AND mediatype:texts AND NOT access-restricted-item:true${extra}`)}&${IA_CAMPOS}&rows=${max}&output=json`), 'Internet Archive');
  return { registros: parseArchive(j, codigo), total: j.response?.numFound ?? null };
};
const buscarArchivos: Buscador = async (q, max, get) => {
  const regs: Registro[] = [], partes: Record<string, number | string> = {}, err: string[] = [];
  try { const r = await iaBuscar(q, max, get, '', 'R10'); regs.push(...r.registros); partes['Internet Archive'] = r.registros.length; } catch (e: any) { err.push(e.message); partes['Internet Archive'] = `error: ${e.message}`; }
  try { const r = parseGutendex(json(await pedir(get, `https://gutendex.com/books/?search=${enc(q)}`), 'Gutendex')).slice(0, max); regs.push(...r); partes.Gutenberg = r.length; } catch (e: any) { err.push(e.message); partes.Gutenberg = `error: ${e.message}`; }
  if (err.length === 2) throw new Error(err.join(' · '));
  return { registros: regs, aviso: err.length ? `Parcial: ${err[0]}` : undefined, partes };
};

// ---------- R11 / R12 índices de archivos esotéricos (sin API: palabras clave sobre los enlaces de sus índices) ----------
export const INDICES: Record<string, { sitio: string; paginas: string[] }[]> = {
  R11: [
    { sitio: 'hermetic.com', paginas: ['https://hermetic.com/'] },
    { sitio: 'esotericarchives.com', paginas: ['https://www.esotericarchives.com/esoteric.htm', 'https://www.esotericarchives.com/sitemap.htm'] },
  ],
  R12: [
    { sitio: 'sacred-texts.com', paginas: ['eso', 'alc', 'tarot', 'egy', 'gno', 'hin', 'tao', 'neu', 'oto'].map((c) => `https://sacred-texts.com/${c}/index.htm`) },
    { sitio: 'iapsop.com', paginas: ['https://iapsop.com/', 'https://iapsop.com/archive/materials/index.html', 'https://iapsop.com/lessons/'] },
  ],
};
export const SITIOS_ESOTERICOS = ['hermetic.com', 'esotericarchives.com', 'sacred-texts.com', 'iapsop.com'];
const VACIAS = new Set(['the', 'and', 'of', 'in', 'on', 'for', 'to', 'a', 'an', 'el', 'la', 'los', 'las', 'de', 'del', 'y', 'en', 'un', 'una', 'por', 'con', 'que', 'les', 'des', 'et', 'du', 'und', 'der', 'die', 'das']);
export function enlaces(html: string, base: string): { url: string; texto: string }[] {
  const out: { url: string; texto: string }[] = [];
  const limpioHtml = String(html ?? '').replace(/<!--[\s\S]*?-->/g, ' ').replace(/<(script|style|noscript)\b[\s\S]*?<\/\1\s*>/gi, ' ');   // los enlaces dentro de scripts no son del índice
  for (const m of limpioHtml.matchAll(/<a\s[^>]*?href\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))[^>]*>([\s\S]*?)<\/a\s*>/gi)) {
    const href = (m[1] ?? m[2] ?? m[3] ?? '').trim(); if (!href || /^(#|mailto:|javascript:)/i.test(href)) continue;
    let u: URL; try { u = new URL(decodificar(href), base); } catch { continue; }
    if (!/^https?:$/.test(u.protocol)) continue; u.hash = '';
    out.push({ url: u.toString(), texto: limpio(m[4], 200) });
  }
  return out;
}
export function coincidencias(lista: { url: string; texto: string }[], consulta: string, sitio: string, max: number) {
  const palabras = [...new Set(sinAcentos(consulta).split(/[^a-z0-9]+/).filter((w) => w.length >= 3 && !VACIAS.has(w)))];
  if (!palabras.length) return [];
  const vistos = new Set<string>(); const puntuados: { url: string; texto: string; p: number }[] = [];
  for (const e of lista) {
    if (!enHost(e.url, [sitio]) || /\.(gif|jpe?g|png|css|js|ico|zip)$/i.test(new URL(e.url).pathname) || vistos.has(claveUrl(e.url))) continue;
    const pajar = sinAcentos(`${e.texto} ${decodificarUri(new URL(e.url).pathname).replace(/[/_.-]+/g, ' ')}`);
    const p = palabras.filter((w) => pajar.includes(w)).length; if (!p) continue;
    vistos.add(claveUrl(e.url)); puntuados.push({ ...e, p });
  }
  const todas = puntuados.filter((x) => x.p === palabras.length);
  return (todas.length ? todas : puntuados.filter((x) => x.p >= Math.ceil(palabras.length / 2))).sort((a, b) => b.p - a.p || b.texto.length - a.texto.length).slice(0, max);
}
const buscarIndices = (codigo: 'R11' | 'R12'): Buscador => async (q, max, get) => {
  const regs: Registro[] = [], partes: Record<string, number | string> = {};
  for (const { sitio, paginas } of INDICES[codigo]) {
    const lista: { url: string; texto: string; pagina: string }[] = []; let estado: string | null = null;
    for (const p of paginas) {
      const r = await get(p);
      if (desafioAntibots(r)) { estado = `BLOQUEADO: ${sitio} exige un desafío anti-bots (Cloudflare) a los clientes automáticos (estado ${r.status}); no se elude: consulta manual en el navegador`; break; }
      if (r.status !== 200) { estado = estado ?? `índice ${p} respondió ${r.status}`; continue; }
      for (const e of enlaces(r.text, r.headers?.['x-url-final'] || p)) lista.push({ ...e, pagina: p });
    }
    const hall = coincidencias(lista, q, sitio, max);
    // el texto del enlace NO es un resumen: va en «nota» (registrar no lo cuenta como resumen recuperado)
    for (const h of hall) regs.push({ conector: codigo, titulo: h.texto || decodificarUri(new URL(h.url).pathname), autores: null, anio: null, fecha: null, doi: null, identificador: null, url: h.url,
      estado_publicacion: 'documento', texto_disponible: true, texto_url: h.url, permisos: 'consulta en línea; derechos según cada texto', resumen: null,
      nota: `enlace del índice ${(lista.find((x) => x.url === h.url) ?? { pagina: sitio }).pagina} (solo el texto del enlace; sin resumen)`, citas: null });
    partes[sitio] = lista.length ? hall.length : (estado ?? 'sin enlaces');
    if (estado && lista.length) partes[sitio] = `${hall.length} (aviso: ${estado})`;
  }
  const fallos = Object.entries(partes).filter(([, v]) => typeof v === 'string' && !/^\d/.test(String(v)));
  if (fallos.length === INDICES[codigo].length) throw new Error(fallos.map(([s, v]) => `${s}: ${v}`).join(' · '));
  return { registros: regs.slice(0, max * 2), aviso: fallos.length ? `PARCIAL: ${fallos.map(([s, v]) => `${s}: ${v}`).join(' · ')}` : undefined, partes };
};

// ---------- R13 / R14 colecciones académicas y materiales raros ----------
export const DIRECTORIO_ACADEMICO = [
  { nombre: 'Universidad de Ámsterdam — Center for History of Hermetic Philosophy and Related Currents (HHP)', url: 'https://hermetica.uva.nl/', tipo: 'centro universitario' },
  { nombre: 'HHP — recursos en línea: archivos, bibliotecas y colecciones de esoterismo', url: 'https://hermetica.uva.nl/online-resources/archives-libraries-collections.html', tipo: 'directorio' },
  { nombre: 'ESSWE — European Society for the Study of Western Esotericism', url: 'https://www.esswe.org/', tipo: 'sociedad académica' },
  { nombre: 'Embassy of the Free Mind — Bibliotheca Philosophica Hermetica (Ritman Library)', url: 'https://www.embassyofthefreemind.com/', tipo: 'biblioteca' },
  { nombre: 'Embassy of the Free Mind — catálogo y colección digital en línea', url: 'https://www.embassyofthefreemind.com/digital-collection-search', tipo: 'catálogo' },
  { nombre: 'Warburg Institute (School of Advanced Study, Universidad de Londres)', url: 'https://warburg.sas.ac.uk/', tipo: 'instituto' },
  { nombre: 'Warburg Institute — biblioteca y colecciones', url: 'https://warburg.sas.ac.uk/library-collections', tipo: 'catálogo' },
  { nombre: 'Wellcome Collection — colecciones (alquimia, magia, manuscritos)', url: 'https://wellcomecollection.org/collections', tipo: 'biblioteca' },
  { nombre: 'Wellcome Collection — API pública del catálogo', url: 'https://api.wellcomecollection.org/catalogue/v2/works', tipo: 'API' },
];
export function parseWellcome(j: any, codigo = 'R13'): Registro[] {
  return (j?.results ?? []).map((w: any) => {
    const online = (w.availabilities ?? []).some((a: any) => a.id === 'online');
    const loc = (w.items ?? []).flatMap((it: any) => it.locations ?? []).find((l: any) => l.license || l.url);
    const lic = loc?.license; const label = String(w.workType?.label ?? '');
    const fecha = (w.production ?? []).flatMap((p: any) => p.dates ?? []).map((d: any) => d.label)[0] ?? null;
    const autores = (w.contributors ?? []).filter((c: any) => !(c.roles ?? []).some((r: any) => /data contributor/i.test(r.label))).map((c: any) => c.agent?.label);
    const disp = (w.availabilities ?? []).map((a: any) => a.label).join(', ') || 'sin dato';
    return { conector: codigo, titulo: limpio(w.title) || `Wellcome ${w.id}`, autores: autoresTxt(autores), anio: anioDe(fecha), fecha, doi: null, identificador: `wellcome:${w.id}`,
      url: `https://wellcomecollection.org/works/${w.id}`, estado_publicacion: /manuscript|archives/i.test(label) ? 'manuscrito' : /book/i.test(label) ? 'libro' : 'documento',
      texto_disponible: online, texto_url: online ? (loc?.url ?? `https://wellcomecollection.org/works/${w.id}`) : null,
      permisos: online ? `digitalizado en línea (imágenes IIIF; puede no tener transcripción)${lic ? `; ${lic.label}${lic.url ? ` ${lic.url}` : ''}` : '; licencia según el objeto'}` : `sin copia digital en línea (${disp}): consulta en la Wellcome Collection`,
      resumen: limpio(w.description, 700) || null, citas: null };
  });
}
const wellcome = async (q: string, max: number, get: Get, soloOnline: boolean, codigo: string) => {
  const j = json(await pedir(get, `https://api.wellcomecollection.org/catalogue/v2/works?query=${enc(q)}&pageSize=${max}${soloOnline ? '&availabilities=online' : ''}&include=contributors,production,items`), 'Wellcome Collection');
  return { registros: parseWellcome(j, codigo), total: j.totalResults ?? null };
};
const buscarAcademico: Buscador = async (q, max, get) => {
  const r = await wellcome(q, max, get, false, 'R13');
  return { ...r, aviso: `Directorio académico (sin API de búsqueda; consulta manual): ${DIRECTORIO_ACADEMICO.map((d) => d.url).join(' · ')}` };
};
const buscarRaros: Buscador = async (q, max, get) => {
  const regs: Registro[] = [], partes: Record<string, number | string> = {}, err: string[] = [];
  try { const r = await wellcome(q, max, get, true, 'R14'); regs.push(...r.registros); partes['Wellcome (en línea)'] = r.registros.length; } catch (e: any) { err.push(e.message); partes['Wellcome (en línea)'] = `error: ${e.message}`; }
  try { const r = await iaBuscar(q, max, get, ' AND (licenseurl:* OR possible-copyright-status:NOT_IN_COPYRIGHT)', 'R14'); regs.push(...r.registros); partes['Internet Archive (licencia o dominio público)'] = r.registros.length; }
  catch (e: any) { err.push(e.message); partes['Internet Archive (licencia o dominio público)'] = `error: ${e.message}`; }
  if (err.length === 2) throw new Error(err.join(' · '));
  return { registros: regs, aviso: err.length ? `Parcial: ${err[0]}` : undefined, partes };
};

// ---------- R09 / R15 acceso abierto legal por DOI ----------
export async function legalPorDoi(doi: string, get: Get = httpGet, db?: Db) {
  const d = limpiarDoi(doi); if (!d) throw new Error('DOI no válido (ejemplo: 10.1371/journal.pone.0201246)');
  const ubic: Ubicacion[] = [], errores: string[] = []; let titulo: string | null = null, pmcid: string | null = null, retractado: boolean | null = null, oa = false, estado: Estado | null = null;
  try {
    const w = await openalexPorDoi(d, get);
    if (w) { titulo = w.titulo; pmcid = w.pmcid; retractado = w.estado_publicacion === 'retractado'; estado = w.estado_publicacion; ubic.push(...w.ubicaciones_oa); oa = !!w.texto_disponible; }
    else errores.push('OpenAlex no conoce este DOI');
  } catch (e: any) { errores.push(e.message); }
  if (!pmcid && !ubic.length) try {   // segunda vía, solo si OpenAlex no dio nada: Europe PMC por DOI
    const j = json(await pedir(get, `https://www.ebi.ac.uk/europepmc/webservices/rest/search?query=${enc(`DOI:"${d}"`)}&format=json&pageSize=1&resultType=lite`), 'Europe PMC');
    const a = (j.resultList?.result ?? []).find((x: any) => limpiarDoi(x.doi)?.toLowerCase() === d.toLowerCase());   // solo si es de verdad ese DOI
    if (a?.isOpenAccess === 'Y' && a.pmcid) pmcid = pmcidDe(a.pmcid); titulo = titulo ?? (a?.title ? limpio(a.title) : null);
  } catch (e: any) { errores.push(e.message); }
  if (pmcid && !ubic.some((u) => u.pmcid === pmcid && u.tipo === 'xml'))
    ubic.unshift({ url: `https://www.ebi.ac.uk/europepmc/webservices/rest/${pmcid}/fullTextXML`, tipo: 'xml', pdf_url: null, landing_url: `https://europepmc.org/article/PMC/${pmcid}`, licencia: null, version: null, origen: 'PubMed Central / Europe PMC (texto si está en el subconjunto abierto)', repositorio: 'PubMed Central', pmcid });
  let unpaywall = 'no configurado: falta system_state.unpaywall_email (la API directa de Unpaywall exige un correo de contacto; nunca se usa el del propietario automáticamente). Se usaron los datos de Unpaywall que publica OpenAlex.';
  if (!db) unpaywall = 'no consultado directamente (sin acceso a la configuración); se usaron los datos de Unpaywall que publica OpenAlex';
  else {
    const email = (await getState(db)).unpaywall_email;
    if (typeof email === 'string' && /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) try {
      const j = json(await pedir(get, `https://api.unpaywall.org/v2/${encDoi(d)}?email=${enc(email)}`), 'Unpaywall');
      for (const l of [j.best_oa_location, ...(j.oa_locations ?? [])]) {
        const u = l?.url_for_pdf || l?.url_for_landing_page || l?.url; if (!u || ubic.some((x) => x.url === u)) continue;
        ubic.push({ url: u, tipo: l.url_for_pdf ? 'pdf' : 'html', pdf_url: l.url_for_pdf ?? null, landing_url: l.url_for_landing_page ?? null, licencia: l.license ?? null, version: l.version ?? null, origen: 'Unpaywall (API directa)', repositorio: l.host_type ?? null, arxiv: idArxivDeUrl(u) });
      }
      oa = oa || j.is_oa === true; unpaywall = 'consultado directamente';
    } catch (e: any) { unpaywall = `error: ${e.message}`; }
  }
  const ubicaciones = ubic.filter((u) => !dominioBloqueado(u.url) && !(u.pdf_url && dominioBloqueado(u.pdf_url)));
  return { doi: d, titulo, estado_publicacion: estado, acceso_abierto: ubicaciones.length > 0, es_oa_segun_fuentes: oa, retractado, pmcid, ubicaciones, unpaywall, errores,
    nota: ubicaciones.length ? 'Copias legales de acceso abierto (lee con accion=leer: pmcid → Europe PMC, arxiv → arXiv, PDF abierto → extracción de texto).' + (retractado ? ' ATENCIÓN: la obra consta como RETRACTADA.' : '')
      : `No consta ninguna copia legal de acceso abierto para este DOI${errores.length ? ` (consultas con error: ${errores.join(' · ')})` : ''}. ${ALTERNATIVAS_LEGALES}` };
}
const buscarAbierto: Buscador = async (q, max, get, ctx) => {
  const r = await openalexBuscar(q, max, get, 'is_oa:true', 'R09');
  let aviso = 'Copias abiertas según los datos de Unpaywall que publica OpenAlex.';
  if (ctx?.db) { const e = (await getState(ctx.db)).unpaywall_email; aviso += typeof e === 'string' && e.includes('@') ? ' La API directa de Unpaywall está configurada (se usa en legal_por_doi).' : ' API directa de Unpaywall no configurada (system_state.unpaywall_email).'; }
  return { ...r, aviso };
};
const buscarContexto: Buscador = async (q, max, get, ctx) => {
  const d = limpiarDoi(((/10\.\d{4,9}\/\S+/.exec(q) ?? [])[0] ?? '').replace(/[.,;:)\]»"']+$/, ''));
  if (d) {
    const l = await legalPorDoi(d, get, ctx?.db);
    return { registros: l.ubicaciones.slice(0, max).map((u) => ({ conector: 'R15', titulo: `${l.titulo ?? d} — copia legal (${u.repositorio ?? u.origen})`, autores: null, anio: null, fecha: null, doi: null, identificador: u.pmcid ?? (u.arxiv ? `arXiv:${u.arxiv}` : null),
      url: u.landing_url ?? u.url, estado_publicacion: 'desconocido' as Estado, texto_disponible: true, texto_url: u.pdf_url ?? u.url, permisos: u.licencia ? `acceso abierto, licencia ${u.licencia}` : 'acceso abierto (licencia no indicada)', resumen: null, citas: null })),
      aviso: l.nota };
  }
  return { registros: NOTA_SCIHUB.referencias.map((x) => ({ conector: 'R15', titulo: x.titulo, autores: x.autores, anio: x.anio, fecha: String(x.anio), doi: x.doi, identificador: null, url: x.url, estado_publicacion: 'publicado' as Estado, texto_disponible: null, texto_url: null,
    permisos: 'referencia sobre Sci-Hub (contexto histórico); acceso según el editor', resumen: null, citas: null })), aviso: NOTA_SCIHUB.texto };
};

// ---------- R16 preprints, retractaciones y resultados negativos ----------
export const TERMINOS_NEGATIVOS = ['failed replication', 'failure to replicate', 'failed to replicate', 'replication failure', 'did not replicate', 'non-replication', 'null result', 'null results', 'negative result', 'negative results', 'no evidence'];
const buscarNegativos: Buscador = async (q, max, get) => {
  const regs: Registro[] = [], partes: Record<string, number | string> = {}, err: string[] = [];
  const paso = async (nombre: string, f: () => Promise<Registro[]>) => { try { const r = await f(); regs.push(...r); partes[nombre] = r.length; } catch (e: any) { err.push(e.message); partes[nombre] = `error: ${e.message}`; } };
  await paso('OpenAlex preprints', async () => (await openalexBuscar(q, max, get, 'type:preprint', 'R16')).registros);
  await paso('OpenAlex retractados', async () => (await openalexBuscar(q, max, get, 'is_retracted:true', 'R16')).registros);
  await paso('Crossref retractaciones', async () => {
    const j = json(await pedir(get, `https://api.crossref.org/works?filter=update-type:retraction&query=${enc(q)}&rows=${max}`), 'Crossref');
    return (j.message?.items ?? []).map((it: any) => {
      const info = parseCrossrefItem(it, 'R16');
      if (!info.aviso_de) return info.registro;
      const a = info.actualizaciones.find((x) => x.doi === info.aviso_de);   // aviso de retractación de OTRA obra: el registro es la obra retractada
      // «Retraction: <título original>» → el título de la obra; si el aviso no lo trae, un título descriptivo (registrar lo contrastará con Crossref)
      const original = info.registro.titulo.replace(/^\s*(retraction(\s+notice)?(\s+(to|of|for))?|notice\s+of\s+retraction|statement\s+of\s+retraction|retracted(\s+article)?)\s*[:.–—-]\s*/i, '').trim();
      const titulo = original !== info.registro.titulo && original.length >= 10 ? original : `Obra retractada ${info.aviso_de} (aviso: ${info.registro.titulo})`;
      return { ...info.registro, doi: info.aviso_de, url: doiUrl(info.aviso_de), titulo: titulo.slice(0, 300), estado_publicacion: 'retractado' as Estado, autores: null, texto_disponible: null, texto_url: null,
        permisos: 'solo metadatos (aviso de retractación)', correcciones: `retractación${a?.fecha ? ` ${a.fecha}` : ''}: aviso ${info.registro.doi}${a?.fuente ? ` [${a.fuente}]` : ''}`, citas: null };
    });
  });
  // Replicaciones fallidas y resultados nulos: no hay un filtro fiable en ninguna API; se buscan por términos en el TÍTULO (Europe PMC) y se marcan como «posibles», nunca como confirmados
  await paso('Europe PMC replicaciones fallidas y resultados nulos', async () => {
    const qq = `(${q}) AND (${TERMINOS_NEGATIVOS.map((t) => `TITLE:"${t}"`).join(' OR ')})`;
    const j = json(await pedir(get, `https://www.ebi.ac.uk/europepmc/webservices/rest/search?query=${enc(qq)}&format=json&pageSize=${max}&resultType=lite`), 'Europe PMC');
    return parseEuropePmc(j, 'R16').map((r) => ({ ...r, nota: 'Posible replicación fallida o resultado negativo/nulo: el título contiene uno de esos términos (no confirmado; léelo antes de citarlo así)' }));
  });
  if (err.length === Object.keys(partes).length) throw new Error(err.join(' · '));
  return { registros: fusionar(regs), aviso: err.length ? `Parcial: ${err.join(' · ')}` : undefined, partes };
};

export const BUSCADORES: Record<string, Buscador> = {
  R01: (q, m, g) => openalexBuscar(q, m, g), R02: buscarArxiv, R03: buscarS2, R04: buscarCrossref, R05: buscarBiomed, R06: buscarInspire, R07: buscarOsti, R08: buscarNasa,
  R09: buscarAbierto, R10: buscarArchivos, R11: buscarIndices('R11'), R12: buscarIndices('R12'), R13: buscarAcademico, R14: buscarRaros, R15: buscarContexto, R16: buscarNegativos,
};

// ---------- fusión y deduplicación ----------
const RANGO: Record<string, number> = { desconocido: 0, preprint: 1, documento: 2, manuscrito: 2, libro: 2, publicado: 3, corregido: 4, retractado: 5 };
// Clave de URL para deduplicar: sin www, sin barra final y sin index.html (…/x/ y …/x/index.html son la misma página)
export const claveUrl = (u: string) => { try { const x = new URL(u); return `${x.hostname.replace(/^www\./, '')}${x.pathname.replace(/\/index\.(html?|php)$/i, '/').replace(/\/+$/, '')}${x.search}`.toLowerCase(); } catch { return String(u).toLowerCase(); } };
export function fusionar(lista: Registro[]): (Registro & { conectores: string[] })[] {
  const out: (Registro & { conectores: string[] })[] = []; const porDoi = new Map<string, number>(), porUrl = new Map<string, number>();
  for (let r of lista) {
    if (!r?.url || dominioBloqueado(r.url)) continue;
    if (r.texto_url && dominioBloqueado(r.texto_url)) r = { ...r, texto_url: null, texto_disponible: null };   // el enlace al texto era de una biblioteca en la sombra: no cuenta
    const kd = r.doi ? r.doi.toLowerCase() : null, ku = claveUrl(r.url);
    const i = (kd && porDoi.get(kd)) ?? porUrl.get(ku);
    if (i === undefined) { out.push({ ...r, conectores: [r.conector] }); const n = out.length - 1; if (kd) porDoi.set(kd, n); porUrl.set(ku, n); continue; }
    const a = out[i];
    if (!a.conectores.includes(r.conector)) a.conectores.push(r.conector);
    if ((RANGO[r.estado_publicacion] ?? 0) > (RANGO[a.estado_publicacion] ?? 0)) a.estado_publicacion = r.estado_publicacion;
    for (const k of ['doi', 'autores', 'anio', 'fecha', 'identificador', 'texto_url', 'permisos', 'resumen', 'nota'] as const) if ((a[k] === null || a[k] === undefined || a[k] === '') && r[k]) (a as any)[k] = r[k];
    if (r.citas != null) a.citas = Math.max(a.citas ?? 0, r.citas);
    a.texto_disponible = a.texto_disponible === true || r.texto_disponible === true ? true : a.texto_disponible === false || r.texto_disponible === false ? false : null;
    if (r.correcciones) a.correcciones = a.correcciones ? (a.correcciones.includes(r.correcciones) ? a.correcciones : `${a.correcciones}; ${r.correcciones}`) : r.correcciones;
    if (kd) porDoi.set(kd, i); porUrl.set(ku, i);
  }
  return out;
}

// ---------- interfaz unificada de búsqueda (A06) ----------
export async function investigar(db: Db, i: { fuente?: string; consulta: string; max?: number }, by: string, get: Get = httpGet) {
  const consulta = String(i?.consulta ?? '').trim().slice(0, 300); if (consulta.length < 2) throw new Error('Falta la consulta');
  const f = String(i?.fuente ?? 'todas').trim(); const fu = f.toUpperCase();
  const codigos = CODIGOS.includes(fu) ? [fu] : ['ciencia', 'esoterismo', 'acceso'].includes(f.toLowerCase()) ? CODIGOS.filter((c) => CONECTORES[c].area === f.toLowerCase()) : f.toLowerCase() === 'todas' ? CODIGOS : null;
  if (!codigos) throw new Error(`Fuente no válida: usa R01…R16, ciencia, esoterismo, acceso o todas`);
  const max = Math.min(25, Math.max(1, Number(i?.max) || 5));
  const por = await Promise.all(codigos.map(async (c) => {
    const t0 = Date.now();
    try { const r = await BUSCADORES[c](consulta, max, get, { db }); return { codigo: c, nombre: CONECTORES[c].nombre, ok: true, n: r.registros.length, total: r.total ?? null, ms: Date.now() - t0, aviso: r.aviso, partes: r.partes, registros: r.registros }; }
    catch (e: any) { return { codigo: c, nombre: CONECTORES[c].nombre, ok: false, n: 0, ms: Date.now() - t0, error: String(e?.message ?? e).slice(0, 400), registros: [] as Registro[] }; }
  }));
  const registros = fusionar(por.flatMap((p) => p.registros));
  await audit(db, by, 'sol.investigar', { consulta, fuentes: codigos, resultados: registros.length, errores: por.filter((p) => !p.ok).map((p) => p.codigo) });
  return { consulta, fuentes: codigos, resultados: registros.length, registros, por_conector: por.map(({ registros: _r, ...p }) => p),
    nota: 'Son metadatos y, como mucho, resúmenes: un resumen NO es una lectura completa. Registra lo útil con accion=registrar y lee el texto legal con accion=leer; consulta retractaciones con accion=retractacion.' };
}

// ---------- registro con procedencia (A05) ----------
export function exigirPublica(url: string) { const m = motivoNoPublica(url); if (m) throw new Error(`URL rechazada: ${m}`); }
// Palabras significativas de un título (para contrastar un título con el del DOI o con el texto leído)
const palabrasTitulo = (s: unknown) => [...new Set(sinAcentos(limpio(s, 400)).split(/[^a-z0-9]+/).filter((w) => w.length >= 3 && !VACIAS.has(w)))];
export function titulosCoinciden(a: string, b: string): boolean {
  const pa = palabrasTitulo(a), pb = new Set(palabrasTitulo(b)); if (!pa.length || !pb.size) return false;
  return pa.filter((w) => pb.has(w)).length >= Math.max(1, Math.ceil(0.6 * Math.min(pa.length, pb.size)));
}
async function comprobarUrl(url: string, doi: string | null, get: Get) {
  exigirPublica(url);
  const r = await get(url);
  if (r.headers?.['x-url-final']) exigirLegal(r.headers['x-url-final']);
  if (r.status >= 200 && r.status < 400) return { status: r.status, title: /html/i.test(r.headers?.['content-type'] ?? 'html') ? tituloHtml(r.text) : null, via: 'URL abierta' };
  if (doi && enHost(url, ['doi.org'])) {   // muchos editores rechazan a los clientes automáticos: se confirma el DOI en el propio resolvedor
    const h = await get(`https://doi.org/api/handles/${encDoi(doi)}`);
    try { if (h.status === 200 && JSON.parse(h.text).responseCode === 1) return { status: 200, title: null, via: `DOI confirmado en doi.org (la página del editor respondió ${r.status} a la apertura automática)` }; } catch { /* sigue */ }
  }
  return { status: r.status, title: null, via: `la URL respondió ${r.status}` };
}
const TIPO_FUENTE: Record<string, string> = { libro: 'libro', manuscrito: 'manuscrito', preprint: 'preprint', documento: 'documento' };
export async function registrarRegistro(db: Db, r: Registro, by: string, temas: string[] = [], get: Get = httpGet) {
  const titulo = limpio(r?.titulo, 300); if (!titulo) throw new Error('Falta el título del registro');
  if (!r?.url) throw new Error('Falta la URL del registro');
  exigirLegal(r.url); if (r.texto_url) exigirLegal(r.texto_url);
  exigirPublica(String(r.url));   // antes de cualquier petición: ni la máquina local ni redes privadas
  const conector = /^R(0[1-9]|1[0-6])$/.test(String(r.conector ?? '').toUpperCase()) ? String(r.conector).toUpperCase() : null;
  const doi = limpiarDoi(r.doi); let url: string;
  let estado: Estado = ESTADOS.includes(r.estado_publicacion) ? r.estado_publicacion : 'desconocido';
  try { url = new URL(String(r.url)).toString(); } catch { throw new Error('URL no válida'); }
  // un trabajo solo en arXiv o con DOI de un servidor de preprints no es un artículo revisado, diga lo que diga el registro
  if (['publicado', 'desconocido'].includes(estado) && ((doi && DOI_PREPRINT.test(doi)) || (!doi && (/^arxiv:/i.test(String(r.identificador ?? '')) || (enHost(url, ['arxiv.org']) && idArxivDeUrl(url)))))) estado = 'preprint';
  let textoUrl: string | null = null; try { textoUrl = r.texto_url && !motivoNoPublica(String(r.texto_url)) ? new URL(String(r.texto_url)).toString().slice(0, 1000) : null; } catch { textoUrl = null; }
  const previa = (await db.query(`SELECT id, url, doi, estado_publicacion FROM sol_fuentes WHERE ($1::text IS NOT NULL AND lower(doi) = lower($1)) OR url = $2 ORDER BY ($1::text IS NOT NULL AND lower(doi) = lower($1)) IS TRUE DESC, id LIMIT 1`, [doi, url])).rows[0];   // IS TRUE: sin él, un NULL (fila sin DOI) iría primero en DESC
  if (previa && !previa.url) await db.query(`UPDATE sol_fuentes SET url = $2, dominio = $3 WHERE id = $1 AND NOT EXISTS (SELECT 1 FROM sol_fuentes WHERE url = $2)`, [previa.id, url, new URL(url).hostname]);
  const urlFinal = previa?.url ?? url;
  const c = await comprobarUrl(urlFinal, doi ?? limpiarDoi(previa?.doi), get);
  // Fuente nueva con DOI: el título tiene que ser el de ese DOI (la página abierta o Crossref); un par título–DOI inventado no se registra
  let contraste = '';
  if (!previa && doi) {
    if (c.title && titulosCoinciden(titulo, c.title)) contraste = ' Título contrastado con la página abierta.';
    else {
      let ref: string | null = null; try { const t = (await crossrefPorDoi(doi, get))?.registro.titulo; ref = t && t !== '(sin título)' ? t : null; } catch { ref = null; }
      if (ref && !titulosCoinciden(titulo, ref)) throw new Error(`El título «${titulo.slice(0, 120)}» no coincide con el del DOI ${doi} según Crossref («${ref.slice(0, 200)}»): no se registra un par título–DOI que no casa. Corrige el título o el DOI`);
      contraste = ref ? ' Título contrastado con Crossref.' : ' Título NO contrastado (Crossref no conoce el DOI o no respondió).';
    }
  }
  const notas = `Registrada desde ${conector ? `${conector} (${CONECTORES[conector].nombre})` : 'registro manual'}. Verificación: ${c.via}.${contraste} ${r.nota ? `Aviso del registro: ${limpio(r.nota, 300)}. ` : ''}${r.resumen ? `Resumen recuperado (NO es lectura completa): ${limpio(r.resumen, 700)}` : 'Solo metadatos.'}`;
  const f: any = await addSource(db, { url: urlFinal, titulo, autores: r.autores ?? undefined, anio: r.anio ?? undefined, tipo: TIPO_FUENTE[estado] ?? 'articulo', temas, acceso: r.resumen ? 'resumen' : 'metadatos', notas }, by, async () => ({ status: c.status, title: c.title }));
  const estadoFinal = previa && (RANGO[previa.estado_publicacion] ?? 0) >= (RANGO[estado] ?? 0) ? previa.estado_publicacion : estado;   // nunca se rebaja un «retractado» o «corregido»
  let fila: any;
  try {
    fila = (await db.query(`UPDATE sol_fuentes SET doi = coalesce(doi, $2), identificador = coalesce(identificador, $3), conector = coalesce(conector, $4), estado_publicacion = $5,
        fecha_publicacion = coalesce(fecha_publicacion, $6), texto_disponible = CASE WHEN $7::boolean IS TRUE THEN true WHEN texto_disponible IS NULL THEN $7::boolean ELSE texto_disponible END,
        permisos = coalesce($8, permisos), correcciones = CASE WHEN $9::text IS NULL THEN correcciones WHEN correcciones IS NULL THEN $9 WHEN position($9 in correcciones) > 0 THEN correcciones ELSE correcciones || E'\n' || $9 END,
        texto_url = coalesce(texto_url, $10)
      WHERE id = $1 RETURNING id, url, doi, identificador, conector, estado_publicacion, fecha_publicacion, texto_disponible, texto_url, permisos, acceso, verificada`,
      [f.id, doi, r.identificador ? String(r.identificador).slice(0, 200) : null, conector, estadoFinal, r.fecha ? String(r.fecha).slice(0, 40) : r.anio ? String(r.anio) : null,
        typeof r.texto_disponible === 'boolean' ? r.texto_disponible : null, r.permisos ? String(r.permisos).slice(0, 400) : null, r.correcciones ? String(r.correcciones).slice(0, 800) : null, textoUrl])).rows[0];
  } catch (e: any) { if (e?.code === '23505') throw new Error(`Ya hay otra fuente con el DOI ${doi}: registra esa en vez de esta`); throw e; }
  await audit(db, by, 'sol.fuente_registrada', { fuente: f.id, conector, doi, verificada: f.verificada, estado: fila.estado_publicacion });
  return { fuente_id: f.id, nuevo: !previa, verificada: f.verificada, acceso: fila.acceso, estado_publicacion: fila.estado_publicacion, doi: fila.doi, conector: fila.conector, texto_disponible: fila.texto_disponible, texto_url: fila.texto_url, permisos: fila.permisos,
    nota: `${f.verificada ? 'Verificada' : 'NO verificada'}: ${c.via}.${fila.estado_publicacion === 'retractado' ? ' ATENCIÓN: consta como RETRACTADA.' : fila.estado_publicacion === 'corregido' ? ' Tiene correcciones publicadas.' : ''}`,
    aviso: 'Registrar no es leer: el grado de lectura solo sube con accion=leer.' };
}

// ---------- lectura legal con avance contiguo (A05) ----------
const TROZO = 30_000;
export const OA_HOSTS = ['arxiv.org', 'ar5iv.labs.arxiv.org', 'europepmc.org', 'ebi.ac.uk', 'ncbi.nlm.nih.gov', 'pmc.ncbi.nlm.nih.gov', 'ntrs.nasa.gov', 'osti.gov', 'plos.org', 'elifesciences.org', 'frontiersin.org', 'mdpi.com', 'mdpi-res.com',
  'peerj.com', 'biorxiv.org', 'medrxiv.org', 'zenodo.org', 'hal.science', 'archives-ouvertes.fr', 'biomedcentral.com', 'springeropen.com', 'scielo.org', 'scielo.br', 'doaj.org', 'openalex.org', 'semanticscholar.org', 'iapsop.com', 'gutenberg.org', 'archive.org'];
type Origen = { tipo: 'xml' | 'html' | 'texto' | 'pdf'; url: string; alternativas?: Cand[]; fuenteUrl: string; conector: string; identificador: string | null; doi: string | null; permisos: string; tipoFuente: string; estado: Estado; titulo?: string | null; doiResuelto?: boolean };   // doiResuelto: el DOI lo resolvió el código (no salió del texto de una URL)
// Contenido principal de una página: si tiene <article> con texto suficiente (arXiv HTML, ar5iv) se lee solo eso, sin cabeceras ni menús del sitio
export function textoPrincipalHtml(html: string): string {
  const arts = [...String(html ?? '').matchAll(/<article\b[^>]*>([\s\S]*?)<\/article\s*>/gi)].map((m) => m[1]).join('\n');
  const t = arts ? htmlATexto(arts) : '';
  return t.length >= 500 ? t : htmlATexto(html);
}
// Texto de Project Gutenberg sin la licencia del principio y del final (no es parte de la obra)
export function sinLicenciaGutenberg(t: string): string {
  const m = /\*\*\*\s*START OF (?:THE|THIS) PROJECT GUTENBERG[^\n]*\n([\s\S]*?)\n[^\n]*\*\*\*\s*END OF (?:THE|THIS) PROJECT GUTENBERG/i.exec(t);
  return m && m[1].trim().length >= 500 ? m[1].trim() : t;
}
export const PDF = { python: path.join(ROOT, '.jarvis', 'acd', 'venv', 'bin', 'python'), script: path.join(ROOT, 'scripts', 'sol', 'pdf_texto.py') };
// Extracción asíncrona: pypdf trabaja en otro proceso sin bloquear a KRATOS (las demás herramientas y agentes siguen); 180 s y 256 MB de salida como máximo
export function extraerPdf(bytes: Buffer): Promise<{ texto: string; paginas: number; titulo: string | null }> {
  return new Promise((resolve, reject) => {
    if (!fs.existsSync(PDF.python)) return reject(new Error('Falta el entorno .jarvis/acd/venv con pypdf (uv pip install --python .jarvis/acd/venv/bin/python pypdf)'));
    const p = spawn(PDF.python, ['-I', PDF.script], { stdio: ['pipe', 'pipe', 'ignore'] });
    const partes: Buffer[] = []; let n = 0, corte: string | null = null;
    const reloj = setTimeout(() => { corte = 'superó los 180 s'; p.kill('SIGKILL'); }, 180_000);
    p.stdout.on('data', (c: Buffer) => { n += c.length; if (n > 256 * 1024 * 1024) { corte = 'salida demasiado grande'; p.kill('SIGKILL'); } else partes.push(c); });
    p.on('error', (e) => { clearTimeout(reloj); reject(new Error(`El extractor de PDF falló: ${String(e?.message ?? e).slice(0, 200)}`)); });
    p.on('close', (codigo) => {
      clearTimeout(reloj);
      if (corte) return reject(new Error(`El extractor de PDF se detuvo: ${corte}`));
      let j: any; try { j = JSON.parse(Buffer.concat(partes).toString('utf8')); } catch { return reject(new Error(`El extractor de PDF falló (código ${codigo})`)); }
      if (!j.ok) return reject(new Error(`No se pudo extraer el texto del PDF: ${j.error}`));
      resolve({ texto: String(j.texto ?? '').replace(/\r/g, ''), paginas: Number(j.paginas) || 0, titulo: j.titulo ? limpio(j.titulo) : null });
    });
    p.stdin.on('error', () => { /* el proceso terminó antes de leerlo todo: lo informa «close» */ });
    p.stdin.end(bytes);
  });
}
type Cand = { url: string; tipo: Origen['tipo']; conector?: string; identificador?: string | null; permisos?: string };
const normArxiv = (s?: string | null) => { if (!s) return null; const t = String(s).trim().replace(/^arxiv:\s*/i, ''); const u = idArxivDeUrl(t); const id = u ?? t; return /^(\d{4}\.\d{4,5}|[a-z-]+(\.[a-z]{2})?\/\d{7})(v\d+)?$/i.test(id) ? id.replace(/v\d+$/, '') : null; };
const HOSTS_ARXIV = ['arxiv.org', 'ar5iv.org'];
const origenPmc = (id: string): Origen => ({ tipo: 'xml', url: `https://www.ebi.ac.uk/europepmc/webservices/rest/${id}/fullTextXML`, fuenteUrl: `https://europepmc.org/article/PMC/${id}`, conector: 'R05', identificador: id, doi: null,
  permisos: 'Europe PMC, subconjunto de acceso abierto (licencia según el artículo)', tipoFuente: 'articulo', estado: 'publicado' });
const origenArxiv = (id: string): Origen => ({ tipo: 'html', url: `https://arxiv.org/html/${id}`, alternativas: [{ url: `https://ar5iv.labs.arxiv.org/html/${id}`, tipo: 'html' }, { url: `https://arxiv.org/pdf/${id}`, tipo: 'pdf' }],
  fuenteUrl: `https://arxiv.org/abs/${id}`, conector: 'R02', identificador: `arXiv:${id}`, doi: null, permisos: 'arXiv: preprint de lectura abierta (licencia según el envío)', tipoFuente: 'preprint', estado: 'preprint' });
async function origenArchive(u: URL, get: Get): Promise<Origen> {
  const m = /^\/(details|download|stream)\/([^/]+)(?:\/(.+))?/.exec(u.pathname); if (!m) throw new Error('URL de archive.org no reconocida (usa archive.org/details/<identificador>)');
  const id = m[2];
  const j = json(await pedir(get, `https://archive.org/metadata/${enc(id)}`), 'Internet Archive (metadatos)');
  const md = j.metadata ?? {};
  const base = { fuenteUrl: `https://archive.org/details/${id}`, conector: 'R10', identificador: `ia:${id}`, doi: null, tipoFuente: 'libro', estado: 'libro' as Estado, titulo: md.title ? limpio(uno(md.title)) || null : null };
  if (String(uno(md['access-restricted-item'])) === 'true') throw new Error('Esta obra de Internet Archive es de préstamo controlado (no es acceso abierto): no se lee. Busca una edición de dominio público');
  const lic = uno(md.licenseurl); const permisos = lic ? `licencia ${lic}` : uno(md['possible-copyright-status']) === 'NOT_IN_COPYRIGHT' ? 'dominio público según Internet Archive' : 'Internet Archive, acceso público; derechos sin declarar';
  const nombres: string[] = (j.files ?? []).map((f: any) => String(f.name));
  const pedido = m[3] ? decodificarUri(m[3]) : null;
  const txt = (pedido && /\.txt$/i.test(pedido) ? pedido : null) ?? nombres.find((n) => /_djvu\.txt$/i.test(n)) ?? nombres.find((n) => /\.txt$/i.test(n));
  if (txt) return { ...base, tipo: 'texto', url: `https://archive.org/download/${enc(id)}/${txt.split('/').map(enc).join('/')}`, permisos };
  const pdf = (pedido && /\.pdf$/i.test(pedido) ? pedido : null) ?? nombres.find((n) => /\.pdf$/i.test(n));
  if (pdf) return { ...base, tipo: 'pdf', url: `https://archive.org/download/${enc(id)}/${pdf.split('/').map(enc).join('/')}`, permisos };
  throw new Error('Esta obra de Internet Archive no tiene texto ni PDF descargable');
}
function origenGutenberg(u: URL): Origen {
  const id = /\/(?:ebooks|files|cache\/epub)\/(\d+)/.exec(u.pathname)?.[1];
  const base = { conector: 'R10', doi: null, tipoFuente: 'libro', estado: 'libro' as Estado, permisos: 'dominio público en EE. UU. (Project Gutenberg); comprobar la ley local' };
  if (id) return { ...base, tipo: 'texto', url: `https://www.gutenberg.org/ebooks/${id}.txt.utf-8`, fuenteUrl: `https://www.gutenberg.org/ebooks/${id}`, identificador: `gutenberg:${id}` };
  if (/\.txt$/i.test(u.pathname)) return { ...base, tipo: 'texto', url: u.toString(), fuenteUrl: u.toString(), identificador: null };
  throw new Error('URL de Gutenberg no reconocida (usa gutenberg.org/ebooks/<número>)');
}
const pareceNoPdf = (u: URL) => !/\.pdf($|\?)/i.test(u.pathname + u.search) && !/type=printable|\/pdf\/|\/download|\/servlets\/purl\//i.test(u.pathname + u.search);
// ¿Hay lector legal directo para esta URL? (sin consultar la red)
const legibleDirecto = (raw?: string | null) => {
  if (!raw || dominioBloqueado(raw) || motivoNoPublica(raw)) return false;
  try { const u = new URL(raw); return (enHost(raw, HOSTS_ARXIV) && !!idArxivDeUrl(raw)) || (enHost(raw, ['europepmc.org', 'ncbi.nlm.nih.gov']) && !!pmcidDe(raw)) || enHost(raw, ['gutenberg.org', 'archive.org', ...SITIOS_ESOTERICOS]) || (enHost(raw, OA_HOSTS) && !pareceNoPdf(u)); } catch { return false; }
};
// Lector directo para una URL concreta, o null si no lo hay (entonces solo queda la vía del DOI)
async function origenPorUrl(raw: string, get: Get): Promise<Origen | null> {
  const u = new URL(String(raw));
  const pmcid = enHost(raw, ['europepmc.org', 'ncbi.nlm.nih.gov']) ? pmcidDe(raw) : null; if (pmcid) return origenPmc(pmcid);
  const ax = enHost(raw, HOSTS_ARXIV) ? normArxiv(idArxivDeUrl(raw)) : null; if (ax) return origenArxiv(ax);   // solo en arXiv: «otro.sitio/arxiv.org/abs/…» no es arXiv
  if (enHost(raw, ['gutenberg.org'])) return origenGutenberg(u);
  if (enHost(raw, ['archive.org'])) return await origenArchive(u, get);
  if (enHost(raw, SITIOS_ESOTERICOS)) return { tipo: /\.pdf$/i.test(u.pathname) ? 'pdf' : 'html', url: u.toString(), fuenteUrl: u.toString(), conector: enHost(raw, ['hermetic.com', 'esotericarchives.com']) ? 'R11' : 'R12', identificador: null, doi: null,
    permisos: 'consulta en línea; derechos según cada texto', tipoFuente: 'documento', estado: 'documento' };
  // el DOI solo si viene en la propia URL (p. ej. PLOS: ?id=10.1371/…): nunca se toma el de la fuente indicada, para que la comprobación de pertenencia sea real
  if (enHost(raw, OA_HOSTS) && !pareceNoPdf(u)) return { tipo: 'pdf', url: u.toString(), fuenteUrl: u.toString(), conector: 'R09', identificador: null, doi: limpiarDoi((/10\.\d{4,9}\/[^&?#\s]+/.exec(decodificarUri(raw)) ?? [])[0]), permisos: `PDF de acceso abierto (${hostDe(raw)})`, tipoFuente: 'articulo', estado: 'desconocido' };
  return null;
}
// Copia legal por DOI, en orden: PMC (XML) > arXiv (HTML, ar5iv, PDF) > PDF abiertos; si una falla (p. ej. no está en el subconjunto abierto) se prueba la siguiente.
// El estado de publicación es el que da OpenAlex (un preprint con DOI no se anota como «publicado»).
async function origenPorDoi(db: Db, doi: string, get: Get): Promise<Origen> {
  const l = await legalPorDoi(doi, get, db);
  const cands: Cand[] = [];
  const pmc = l.ubicaciones.find((u) => u.pmcid && u.tipo === 'xml')?.pmcid;
  if (pmc) { const o = origenPmc(pmc); cands.push({ url: o.url, tipo: 'xml', conector: 'R05', identificador: pmc, permisos: o.permisos }); }
  const ax = l.ubicaciones.find((u) => u.arxiv)?.arxiv;
  if (ax) { const o = origenArxiv(ax); for (const c of [{ url: o.url, tipo: o.tipo }, ...(o.alternativas ?? [])]) cands.push({ ...c, conector: 'R02', identificador: `arXiv:${ax}`, permisos: o.permisos }); }
  for (const u of l.ubicaciones) if (u.pdf_url && !cands.some((c) => c.url === u.pdf_url)) cands.push({ url: u.pdf_url, tipo: 'pdf', conector: 'R09', identificador: null, permisos: `acceso abierto${u.licencia ? `, licencia ${u.licencia}` : ''} (${u.repositorio ?? u.origen})` });
  if (!cands.length) {
    const html = l.ubicaciones[0];
    throw new Error(html ? `Hay copia abierta solo como página web (${html.url}); este lector solo admite XML de Europe PMC, arXiv, texto de dominio público, archivos esotéricos y PDF abiertos. Ábrela en el navegador.` : l.nota);
  }
  const [p, ...resto] = cands;
  return { tipo: p.tipo, url: p.url, alternativas: resto, fuenteUrl: doiUrl(doi), conector: p.conector ?? 'R09', identificador: p.identificador ?? null, doi, permisos: p.permisos ?? 'acceso abierto',
    tipoFuente: 'articulo', estado: l.retractado ? 'retractado' : l.estado_publicacion ?? 'desconocido', titulo: l.titulo, doiResuelto: true };
}
const sinLectorLegal = (url: string) => new Error(`No consta como acceso abierto legal (${hostDe(url)}): no se lee. Lectores admitidos: pmcid (Europe PMC), arxiv, gutenberg.org/archive.org, ${SITIOS_ESOTERICOS.join(', ')} y PDF abiertos de repositorios o del DOI. ${ALTERNATIVAS_LEGALES}`);
// Lo indicado explícitamente (pmcid, arxiv, url, doi) manda; con solo fuente_id se usa lo registrado: su URL si es legible, su identificador, su texto_url y su DOI.
// «via» dice de dónde salió el texto: url y doi lo atan a la fuente; identificador y texto_url (datos que pudo escribir un agente) exigen comprobar el contenido.
async function resolverOrigen(db: Db, x: { pmcid?: string; arxiv?: string; doi?: string; url?: string; fila?: any }, get: Get): Promise<{ o: Origen; via: 'explicito' | 'url' | 'identificador' | 'texto_url' | 'doi' }> {
  const fila = x.fila;
  if (x.pmcid) { const id = pmcidDe(x.pmcid); if (!id) throw new Error('pmcid no válido (ejemplo: PMC7379166)'); return { o: origenPmc(id), via: 'explicito' }; }
  if (x.arxiv) { const id = normArxiv(x.arxiv); if (!id) throw new Error('Identificador de arXiv no válido (ejemplo: 2310.00001)'); return { o: origenArxiv(id), via: 'explicito' }; }
  if (x.url) {
    const o = await origenPorUrl(x.url, get); if (o) return { o, via: 'explicito' };
    const d = limpiarDoi(x.doi) ?? (enHost(x.url, ['doi.org']) ? limpiarDoi(x.url) : null);
    if (d) return { o: await origenPorDoi(db, d, get), via: 'explicito' };
    throw sinLectorLegal(x.url);
  }
  if (x.doi) { const d = limpiarDoi(x.doi); if (!d) throw new Error('DOI no válido (ejemplo: 10.1371/journal.pone.0201246)'); return { o: await origenPorDoi(db, d, get), via: 'explicito' }; }
  if (!fila) throw new Error('Indica fuente_id, url, doi, arxiv o pmcid');
  if (legibleDirecto(fila.url)) { const o = await origenPorUrl(fila.url, get); if (o) return { o, via: 'url' }; }
  const pmcid = pmcidDe(fila.identificador); if (pmcid) return { o: origenPmc(pmcid), via: 'identificador' };
  const ax = normArxiv(fila.identificador); if (ax) return { o: origenArxiv(ax), via: 'identificador' };
  if (legibleDirecto(fila.texto_url)) { const o = await origenPorUrl(fila.texto_url, get); if (o) return { o, via: 'texto_url' }; }
  const d = limpiarDoi(fila.doi) ?? (fila.url && enHost(fila.url, ['doi.org']) ? limpiarDoi(fila.url) : null);
  if (d) return { o: await origenPorDoi(db, d, get), via: 'doi' };
  throw fila.url ? sinLectorLegal(fila.url) : new Error(`La fuente #${fila.id} no tiene URL, DOI ni identificador legibles`);
}
// ¿El texto obtenido es de verdad el de esta fuente? Su DOI aparece en él, o la mayoría de las palabras de su título están al principio
export function textoEsDeLaFuente(fila: { doi?: string | null; titulo?: string | null }, crudo: string, texto: string, tituloTexto?: string | null): boolean {
  const d = limpiarDoi(fila?.doi)?.toLowerCase();
  if (d && (String(crudo ?? '').slice(0, 3_000_000).toLowerCase().includes(d) || texto.toLowerCase().includes(d))) return true;
  const pal = palabrasTitulo(fila?.titulo); if (!pal.length) return false;
  const pajar = sinAcentos(`${tituloTexto ?? ''} ${texto.slice(0, 6000)}`);
  return pal.filter((w) => pajar.includes(w)).length >= Math.max(1, Math.ceil(0.6 * pal.length));
}
// Texto de una respuesta según su formato; lanza con el motivo si no es un texto completo válido (un resumen o una página de aviso no cuentan)
async function extraerTexto(r: Respuesta, c: Cand, final: string, conector: string): Promise<{ texto: string; titulo: string | null; tipo: Origen['tipo']; preprint?: boolean }> {
  const esPdf = r.text.startsWith('%PDF');
  if (c.tipo === 'pdf' || esPdf) {
    if (!esPdf) throw new Error('La respuesta no es un PDF (posible página de acceso o muro de pago): no se lee');
    const p = await extraerPdf(Buffer.from(r.text, 'latin1')); return { texto: p.texto, titulo: p.titulo, tipo: 'pdf' };
  }
  if (c.tipo === 'xml') {
    // un XML de PMC sin <body> solo trae metadatos y el resumen: un resumen NO es una lectura completa
    const cuerpo = /<body[\s>][\s\S]*<\/body>/i.exec(r.text)?.[0];
    if (!cuerpo || xmlToText(cuerpo).length < 500) throw new Error('El XML de Europe PMC no trae el cuerpo del artículo (solo metadatos y resumen): un resumen no es una lectura completa');
    return { texto: xmlToText(r.text), titulo: limpio(/<article-title[^>]*>([\s\S]*?)<\/article-title>/.exec(r.text)?.[1]) || null, tipo: 'xml', preprint: /<article\b[^>]*article-type="preprint"/i.test(r.text.slice(0, 5000)) };
  }
  if (c.tipo === 'html') {
    if (enHost(c.url, HOSTS_ARXIV)) {
      // ar5iv redirige a la página del resumen (arxiv.org/abs/…) cuando no tiene el artículo: esa página NO es el texto
      if (/arxiv\.org\/abs\//i.test(final)) throw new Error(`${hostDe(c.url)} no tiene el texto en HTML (redirigió a la página del resumen, que no es el texto)`);
      if (!/ltx_document|ltx_page_main/i.test(r.text)) throw new Error(`${hostDe(c.url)} no devolvió el documento HTML del artículo`);
    }
    return { texto: textoPrincipalHtml(r.text), titulo: tituloHtml(r.text), tipo: 'html' };
  }
  if (/^\s*<(!doctype\s+html|html[\s>])/i.test(r.text.slice(0, 600))) throw new Error('Se esperaba texto plano y llegó una página HTML (bloqueo o aviso del sitio): no se lee');
  let texto = r.text.replace(/\r/g, ''); const titulo = /^Title:\s*(.+)$/m.exec(texto)?.[1]?.trim() ?? null;
  if (conector === 'R10') texto = sinLicenciaGutenberg(texto);
  return { texto, titulo, tipo: 'texto' };
}

export async function leerFuente(db: Db, i: { fuente_id?: number; url?: string; doi?: string; arxiv?: string; pmcid?: string; desde?: number }, by: string, get: Get = httpGet) {
  const fila = i?.fuente_id ? (await db.query(`SELECT * FROM sol_fuentes WHERE id = $1`, [Number(i.fuente_id)])).rows[0] : null;
  if (i?.fuente_id && !fila) throw new Error(`No existe la fuente #${i.fuente_id}`);
  for (const u of [i?.url, fila?.url, fila?.texto_url]) if (u) exigirLegal(String(u));
  if (i?.url) exigirPublica(String(i.url));
  const { o, via } = await resolverOrigen(db, { pmcid: i?.pmcid, arxiv: i?.arxiv, doi: i?.doi, url: i?.url, fila }, get);
  exigirLegal(o.url);
  const igual = (a?: string | null, b?: string | null) => !!a && !!b && String(a).toLowerCase() === String(b).toLowerCase();
  // Con fuente_id y además url/pmcid/arxiv/doi, el texto tiene que ser de ESA fuente: si no, la lectura se anotaría en una fuente que no se leyó
  if (fila && (i?.url || i?.pmcid || i?.arxiv || i?.doi)) {
    const urls = [fila.url, fila.texto_url].filter(Boolean).map((u: string) => claveUrl(u));
    const ok = igual(o.identificador, fila.identificador) || igual(o.doi, fila.doi) || (i?.url && urls.includes(claveUrl(String(i.url)))) || urls.includes(claveUrl(o.fuenteUrl)) || urls.includes(claveUrl(o.url));
    if (!ok) throw new Error(`Lo indicado no corresponde a la fuente #${fila.id} (no coincide con su URL, su texto_url, su DOI ni su identificador): la lectura no se anota en ella. Usa solo fuente_id (el código busca la copia legal por su DOI o identificador) o lee sin fuente_id`);
  }
  // Atada de verdad a la fuente: por su URL o por su DOI. Por identificador o texto_url (los pudo escribir un agente) se comprueba después el contenido.
  const atada = !fila || via === 'url' || via === 'doi' || (!!i?.url && !!fila.url && claveUrl(String(i.url)) === claveUrl(fila.url))
    || (!!fila.url && [o.fuenteUrl, o.url].some((u) => claveUrl(u) === claveUrl(fila.url))) || (!!o.doiResuelto && igual(o.doi, fila.doi));   // un DOI escrito en la URL no ata: se comprueba el texto
  // Candidatos en orden (el principal y sus alternativas): el primero que dé un texto completo válido
  const fallos: string[] = []; let antibots: string | null = null, denegado: string | null = null, noPdf: string | null = null;
  let leidoDe: { r: Respuesta; c: Cand; x: Awaited<ReturnType<typeof extraerTexto>> } | null = null;
  for (const c of [{ url: o.url, tipo: o.tipo } as Cand, ...(o.alternativas ?? [])]) {
    exigirLegal(c.url); const np = motivoNoPublica(c.url); if (np) { fallos.push(`${c.url}: ${np}`); continue; }
    const r = await get(c.url); const final = r.headers?.['x-url-final'] || c.url;
    exigirLegal(final);   // una redirección hacia una biblioteca en la sombra tampoco se lee
    const h = hostDe(final);
    if (desafioAntibots(r)) { antibots ??= `${h} exige un desafío anti-bots (Cloudflare) a los clientes automáticos: no se elude. Consulta manual en el navegador`; fallos.push(`${h}: desafío anti-bots`); continue; }
    if ([401, 402, 403].includes(r.status)) { denegado ??= `Acceso denegado (${r.status}) en ${h}: exige suscripción o no permite la lectura automática. No se elude. ${ALTERNATIVAS_LEGALES}`; fallos.push(`${h}: ${r.status}`); continue; }
    if (r.status !== 200) { fallos.push(`estado ${r.status} en ${c.url}`); continue; }
    try {
      const x = await extraerTexto(r, c, final, c.conector ?? o.conector);
      if (x.texto.length < 500) throw new Error(`el texto obtenido de ${h} es demasiado corto (${x.texto.length} caracteres): no se cuenta como lectura`);
      leidoDe = { r, c, x }; break;
    } catch (e: any) { if (/no es un PDF/.test(e.message)) noPdf ??= e.message; fallos.push(String(e.message)); }
  }
  if (!leidoDe) {
    if (antibots) throw new Error(antibots);
    if (denegado) throw new Error(denegado);
    if (noPdf) throw new Error(noPdf);
    return { error: `No se pudo leer: ${fallos.join(' · ').slice(0, 600)}${o.conector === 'R05' ? ' (puede que no esté en el subconjunto abierto de Europe PMC)' : ''}` };
  }
  const { r, c, x } = leidoDe; const texto = x.texto, tipo = x.tipo, usada = c.url, crudo = tipo === 'pdf' ? '' : r.text;
  const conector = c.conector ?? o.conector, identificador = c.identificador !== undefined ? c.identificador : o.identificador, permisos = c.permisos ?? o.permisos;
  const estado: Estado = x.preprint && o.estado === 'publicado' ? 'preprint' : o.estado;
  const titulo = x.titulo || o.titulo || null;
  // un DOI sacado del texto de la URL solo se anota si el propio texto lo lleva
  const doi = o.doi && (o.doiResuelto || textoEsDeLaFuente({ doi: o.doi, titulo: null }, crudo, texto)) ? o.doi : null;
  if (fila && !atada && !textoEsDeLaFuente(fila, crudo, texto, titulo))
    throw new Error(`El texto obtenido (${usada}) no parece ser el de la fuente #${fila.id}: ni su DOI ni su título aparecen al principio. La lectura no se anota en ella (el identificador o el texto_url registrados pueden ser de otra obra). Lee sin fuente_id o corrige la fuente`);
  // Fila de la fuente: la indicada; o la que ya tenga esa URL o ese DOI (resuelto por el código); o la de ese identificador si el texto es de verdad el suyo; o una nueva (abierta de verdad: verificada)
  let f = fila;
  if (!f) {
    const filas = (await db.query(`SELECT * FROM sol_fuentes WHERE url = $2 OR ($1::text IS NOT NULL AND lower(doi) = lower($1)) OR ($3::text IS NOT NULL AND identificador = $3)
        ORDER BY (url = $2) IS TRUE DESC, ($1::text IS NOT NULL AND lower(doi) = lower($1)) IS TRUE DESC, id LIMIT 5`, [o.doi, o.fuenteUrl, identificador])).rows;
    f = filas.find((y) => y.url === o.fuenteUrl || (!!o.doiResuelto && igual(y.doi, o.doi))) ?? filas.find((y) => textoEsDeLaFuente(y, crudo, texto, titulo)) ?? null;
  }
  if (!f) f = (await db.query(`INSERT INTO sol_fuentes (tipo, titulo, url, dominio, acceso, verificada, http_status, verificada_en, longitud, created_by, doi, identificador, conector, estado_publicacion, texto_disponible, permisos, notas, texto_url)
      VALUES ($1,$2,$3,$4,'pagina',true,200,now(),$5,$6,$7,$8,$9,$10,true,$11,$12,$13)
      ON CONFLICT (url) DO UPDATE SET verificada = true, http_status = 200 RETURNING *`,
    [o.tipoFuente, (titulo || o.fuenteUrl).slice(0, 300), o.fuenteUrl, hostDe(o.fuenteUrl), texto.length, by, doi, identificador, conector, estado, permisos, `Texto leído de ${usada}`, usada])).rows[0];
  // Si el texto cambió de longitud (otra edición u otro origen), el avance anterior no vale para este texto. leido_hasta nunca pasa de la longitud.
  const n = texto.length;
  const cambio = !!f.longitud && Math.abs(Number(f.longitud) - n) > n * 0.02;
  const previo = cambio ? 0 : Math.min(n, Number(f.leido_hasta) || 0);
  const desde = Math.max(0, Math.min(Math.floor(Number(i?.desde) || 0), n)), trozo = texto.slice(desde, desde + TROZO), hasta = desde + trozo.length;
  const leido = Math.min(n, desde <= previo ? Math.max(previo, hasta) : previo);   // saltar hacia delante no cuenta como leído
  const completo = leido >= n * 0.9;
  const otroConDoi = doi ? (await db.query(`SELECT 1 FROM sol_fuentes WHERE lower(doi) = lower($1) AND id <> $2`, [doi, f.id])).rows.length > 0 : true;
  await db.query(`UPDATE sol_fuentes SET longitud = $2, leido_hasta = CASE WHEN $11 THEN $3 ELSE LEAST($2, GREATEST(leido_hasta, $3)) END,
      acceso = CASE WHEN $4 THEN 'texto_completo' WHEN acceso = 'texto_completo' THEN acceso ELSE 'resumen' END,
      texto_disponible = true, verificada = true, verificada_en = coalesce(verificada_en, now()), http_status = coalesce(http_status, 200),
      doi = coalesce(doi, $5), identificador = coalesce(identificador, $6), conector = coalesce(conector, $7), permisos = coalesce(permisos, $8),
      notas = CASE WHEN position($9 in coalesce(notas, '')) > 0 OR length(coalesce(notas, '')) > 4000 THEN notas ELSE concat_ws(E'\n', notas, $9) END, texto_url = coalesce(texto_url, $10) WHERE id = $1`,
    [f.id, n, leido, completo, otroConDoi ? null : doi, identificador, conector, permisos, `Texto leído de ${usada}`, usada, cambio]);
  const acceso = completo || f.acceso === 'texto_completo' ? 'texto_completo' : 'parcial';
  return { fuente_id: f.id, titulo: titulo ?? f.titulo, origen: usada, formato: tipo, conector, longitud: n, desde, hasta, leido_pct: Math.round((leido / n) * 100), acceso,
    ...(cambio ? { aviso: 'El texto tiene otra longitud que en la lectura anterior: el avance se recalcula desde el principio' } : {}),
    siguiente: hasta < n ? `para seguir leyendo: accion=leer con fuente_id=${f.id} y desde=${hasta}` : 'fin del texto', texto_no_confiable: trozo };
}

// ---------- R16 comprobación de retractaciones y correcciones ----------
export async function comprobarRetractacion(db: Db, i: { fuente_id?: number; doi?: string }, by = 'kratos', get: Get = httpGet) {
  const fila = i?.fuente_id ? (await db.query(`SELECT id, doi, estado_publicacion, correcciones FROM sol_fuentes WHERE id = $1`, [Number(i.fuente_id)])).rows[0] : null;
  if (i?.fuente_id && !fila) throw new Error(`No existe la fuente #${i.fuente_id}`);
  // El resultado se escribe en la fuente solo si se comprobó SU DOI: con fuente_id y otro doi se comprobaría una obra y se anotaría en otra
  const doiFila = limpiarDoi(fila?.doi), doiPedido = limpiarDoi(i?.doi);
  if (fila && doiFila && doiPedido && doiFila.toLowerCase() !== doiPedido.toLowerCase()) throw new Error(`La fuente #${fila.id} tiene el DOI ${doiFila}, no ${doiPedido}: indica solo fuente_id o solo doi`);
  if (fila && !doiFila) return { comprobado: false, fuente_id: fila.id, motivo: `La fuente #${fila.id} no tiene DOI registrado: sin DOI no se puede comprobar en OpenAlex ni en Crossref; no se ha cambiado nada (para comprobar un DOI suelto usa solo doi, sin fuente_id)` };
  const doi = doiFila ?? doiPedido;
  if (!doi) return { comprobado: false, fuente_id: null, motivo: 'Sin DOI no se puede comprobar en OpenAlex ni en Crossref; no se ha cambiado nada' };
  const f = fila ?? (await db.query(`SELECT id, doi, estado_publicacion, correcciones FROM sol_fuentes WHERE lower(doi) = lower($1)`, [doi])).rows[0] ?? null;
  const fuentes: Record<string, string> = {}; let retr = false, corr = false; const hallazgos: string[] = []; let estadoBase: Estado | null = null;
  try {
    const w = await openalexPorDoi(doi, get);
    if (w) { fuentes.OpenAlex = `is_retracted=${w.estado_publicacion === 'retractado'}`; if (w.estado_publicacion === 'retractado') { retr = true; hallazgos.push('OpenAlex: is_retracted=true'); } }
    else fuentes.OpenAlex = 'DOI desconocido';
  } catch (e: any) { fuentes.OpenAlex = `error: ${e.message}`; }
  try {
    const c = await crossrefPorDoi(doi, get);
    if (c) {
      fuentes.Crossref = c.retractado ? 'retractación' : c.corregido ? 'corrección' : 'sin avisos';
      if (c.retractado) retr = true; else if (c.corregido) corr = true;
      if (c.registro.correcciones) hallazgos.push(c.registro.correcciones);
      if (c.preprint_de.length) hallazgos.push(`Crossref: es preprint de ${c.preprint_de.join(', ')}`);
      estadoBase = c.registro.estado_publicacion;
    } else fuentes.Crossref = 'DOI desconocido';
  } catch (e: any) { fuentes.Crossref = `error: ${e.message}`; }
  const respondieron = Object.values(fuentes).filter((v) => !v.startsWith('error')).length;
  if (!respondieron) return { comprobado: false, doi, fuente_id: f?.id ?? null, fuentes, motivo: 'Ni OpenAlex ni Crossref respondieron: no se ha cambiado nada (tampoco la fecha de revisión)' };
  const nuevo: Estado | null = retr ? 'retractado' : corr ? 'corregido' : null;
  let actualizado = false, estado = f?.estado_publicacion ?? null, aviso: string | undefined;
  if (f) {
    const hoy = new Date().toISOString().slice(0, 10);
    const nota = hallazgos.length ? `${hoy}: ${hallazgos.join('; ')}` : null;
    estado = nuevo && (RANGO[nuevo] > (RANGO[f.estado_publicacion] ?? 0)) ? nuevo : f.estado_publicacion === 'desconocido' && estadoBase ? estadoBase : f.estado_publicacion;
    if (!nuevo && ['retractado', 'corregido'].includes(f.estado_publicacion)) aviso = `Constaba como ${f.estado_publicacion} y ahora las fuentes no lo indican: se mantiene; revísalo a mano`;
    const ya = nota && f.correcciones && hallazgos.every((h) => f.correcciones.includes(h));
    await db.query(`UPDATE sol_fuentes SET estado_publicacion = $2, correcciones = CASE WHEN $3::text IS NULL OR $4 THEN correcciones WHEN correcciones IS NULL THEN $3 ELSE correcciones || E'\n' || $3 END, revisada_en = now() WHERE id = $1`, [f.id, estado, nota, !!ya]);
    actualizado = true;
    await audit(db, by, 'sol.retractacion_comprobada', { fuente: f.id, doi, estado, fuentes });
  }
  const fallaron = Object.entries(fuentes).filter(([, v]) => v.startsWith('error')).map(([k]) => k);
  const parcial = fallaron.length ? ` (comprobación PARCIAL: ${fallaron.join(' y ')} no respondió${fallaron.includes('Crossref') ? '; las correcciones solo las publica Crossref' : ''})` : '';
  return { comprobado: true, doi, fuente_id: f?.id ?? null, retractado: retr, corregido: corr, estado_publicacion: estado, hallazgos, fuentes, actualizado,
    ...(aviso ? { aviso } : {}), nota: (f ? (retr ? 'RETRACTADA: no la uses como evidencia a favor; cítala solo como retractada' : corr ? 'Tiene correcciones: revisa la errata antes de citarla' : 'Sin retractaciones ni correcciones conocidas a fecha de hoy') : 'No hay fuente registrada con ese DOI: no se ha modificado nada') + parcial };
}

// ---------- pruebas en vivo (A04) ----------
export const DOI_ABIERTO = '10.1371/journal.pone.0201246';
const CONSULTAS_PRUEBA: Record<string, string> = { R01: 'quantum decoherence', R02: 'decoherence', R03: 'quantum decoherence', R04: 'quantum decoherence', R05: 'lucid dreaming', R06: 'baryogenesis', R07: 'fusion plasma', R08: 'ion propulsion',
  R10: 'alchemy', R11: 'agrippa', R12: 'spiritual', R13: 'alchemy', R14: 'alchemy', R16: 'memory' };
export async function probarConectores(db: Db, get: Get = httpGet) {
  const pruebas: { id: number; codigo: string; nombre: string; ok: boolean; resultados: number; ms: number; detalle: string }[] = [];
  for (const codigo of CODIGOS) {
    const t0 = Date.now(); let ok = false, n = 0, detalle = '';
    try {
      if (codigo === 'R09') {
        const w = await openalexPorDoi(DOI_ABIERTO, get); n = w?.ubicaciones_oa.length ?? 0; ok = n > 0;
        const e = (await getState(db)).unpaywall_email;
        detalle = `${n} ubicaciones abiertas para ${DOI_ABIERTO} vía OpenAlex${w?.ubicaciones_oa[0] ? ` (p. ej. ${w.ubicaciones_oa[0].url})` : ''} · Unpaywall directo: ${typeof e === 'string' && e.includes('@') ? 'configurado' : 'no configurado (system_state.unpaywall_email)'}`;
      } else if (codigo === 'R15') {
        const g = dominioBloqueado(`https://sci-hub.se/${DOI_ABIERTO}`); const l = await legalPorDoi(DOI_ABIERTO, get, db); n = l.ubicaciones.length; ok = !!g && n > 0;
        detalle = `guarda: ${g ? 'rechaza sci-hub.se' : 'NO rechazó sci-hub.se'} · legal_por_doi: ${n} copias legales${l.ubicaciones[0] ? ` (p. ej. ${l.ubicaciones[0].url})` : ''}${l.errores.length ? ` · errores: ${l.errores.join(' · ')}` : ''}`;
      } else {
        const q = CONSULTAS_PRUEBA[codigo]; const r = await BUSCADORES[codigo](q, 3, get, { db }); n = r.registros.length;
        ok = codigo === 'R08' ? typeof r.partes?.NTRS === 'number' && r.partes.NTRS > 0 : n > 0;
        detalle = `${n} resultados para «${q}»${r.registros[0] ? `; p. ej. «${r.registros[0].titulo.slice(0, 90)}»` : ''}${r.partes ? ` · ${Object.entries(r.partes).map(([k, v]) => `${k}: ${v}`).join(' · ')}` : ''}${r.aviso && !r.partes ? ` · ${r.aviso.slice(0, 200)}` : ''}`;
      }
      if (codigo === 'R13') {
        const est: string[] = []; let vivos = 0;
        for (const d of DIRECTORIO_ACADEMICO) { const r = await get(d.url); const vivo = r.status >= 200 && r.status < 400; if (vivo) vivos++; est.push(`${hostDe(d.url)}${new URL(d.url).pathname.length > 1 ? new URL(d.url).pathname : ''} ${r.status}${desafioAntibots(r) ? ' (anti-bots)' : ''}`); }
        detalle += ` · directorio: ${vivos}/${DIRECTORIO_ACADEMICO.length} responden (${est.join(', ')})`;
      }
    } catch (e: any) { detalle = String(e?.message ?? e); }
    const ms = Date.now() - t0;
    const fila = (await db.query(`INSERT INTO sol_conectores_pruebas (codigo, ok, resultados, ms, detalle) VALUES ($1,$2,$3,$4,$5) RETURNING id`, [codigo, ok, n, ms, detalle.slice(0, 2000)])).rows[0];
    pruebas.push({ id: fila.id, codigo, nombre: CONECTORES[codigo].nombre, ok, resultados: n, ms, detalle });
  }
  const oks = pruebas.filter((p) => p.ok).length;
  await audit(db, 'kratos', 'sol.conectores_probados', { ok: oks, total: pruebas.length, fallidos: pruebas.filter((p) => !p.ok).map((p) => p.codigo) });
  return { probados: pruebas.length, ok: oks, fallidos: pruebas.filter((p) => !p.ok).map((p) => p.codigo), pruebas };
}

export async function listarConectores(db: Db) {
  const ult = new Map((await db.query(`SELECT DISTINCT ON (codigo) codigo, ok, resultados, ms, detalle, probado_en FROM sol_conectores_pruebas ORDER BY codigo, id DESC`)).rows.map((r) => [r.codigo, r]));
  return { conectores: CODIGOS.map((c) => ({ ...CONECTORES[c], ultima_prueba: ult.get(c) ?? 'nunca probado en vivo' })),
    credenciales: { 'NASA ADS (kratos-ads)': SECRETOS.leer('kratos-ads') ? 'presente' : 'ausente', 'OpenAlex (kratos-openalex)': SECRETOS.leer('kratos-openalex') ? 'presente' : 'ausente', 'Semantic Scholar (kratos-s2)': SECRETOS.leer('kratos-s2') ? 'presente' : 'ausente' },
    contexto_R15: NOTA_SCIHUB.texto, bloqueados: DOMINIOS_BLOQUEADOS };
}

// ---------- herramienta para los agentes ----------
// Campos de un registro: sueltos o dentro de «registro». Todos los objetos con additionalProperties:false (compatible con herramientas estrictas de la API)
const CAMPOS_REGISTRO = {
  conector: { type: 'string' }, titulo: { type: 'string' }, autores: { type: 'string' }, anio: { type: 'integer' }, fecha: { type: 'string' }, doi: { type: 'string' }, identificador: { type: 'string' }, url: { type: 'string' },
  estado_publicacion: { type: 'string', enum: ESTADOS }, texto_disponible: { type: 'boolean' }, texto_url: { type: 'string' }, permisos: { type: 'string' }, resumen: { type: 'string' }, citas: { type: 'integer' }, correcciones: { type: 'string' }, nota: { type: 'string' },
};
export const INVESTIGAR_TOOL = {
  name: 'investigar_sol',   // el nombre con el que la registra src/core/brain.ts
  description: 'Interfaz unificada de investigación de Sol (PROJECT SOL, conectores R01–R16) para ciencia y esoterismo, con procedencia. ' +
    'buscar_externo (fuente: R01…R16, ciencia, esoterismo, acceso o todas; consulta; max): busca a la vez en OpenAlex, arXiv, Semantic Scholar, Crossref, PubMed/Europe PMC, INSPIRE-HEP, OSTI, NASA NTRS/ADS, acceso abierto (Unpaywall vía OpenAlex), Internet Archive/Gutenberg, Hermetic Library/Esoteric Archives, Sacred Texts/IAPSOP, colecciones académicas (Wellcome), materiales raros y retractaciones; los errores de cada conector se informan, no se inventan resultados. ' +
    'registrar (campos del registro devuelto + temas): guarda la fuente con DOI, identificador, conector, estado de publicación, permisos y disponibilidad de texto; el código abre la URL antes de marcarla verificada, no duplica (DOI o URL), rechaza un título que no es el de su DOI según Crossref y no deja pasar un preprint por publicado. ' +
    'leer (fuente_id, url, doi, arxiv o pmcid; desde): lee el texto LEGAL por trozos de 30.000 caracteres (Europe PMC abierto, arXiv, dominio público de gutenberg.org/archive.org, hermetic.com, esotericarchives.com, sacred-texts.com, iapsop.com y PDF de acceso abierto); el código anota el avance contiguo (saltar hacia delante no cuenta) y solo marca texto_completo al pasar del 90 %; la página del resumen de arXiv o un XML de PMC sin cuerpo no cuentan como texto; con solo fuente_id busca la copia legal por su URL, identificador, texto_url o DOI y, si no viene de su URL o su DOI, comprueba que el texto lleve su DOI o su título; con fuente_id y otra url, esa url tiene que ser de esa fuente. ' +
    'retractacion (fuente_id o doi): comprueba retractaciones y correcciones en OpenAlex y Crossref y actualiza la fuente. legal_por_doi (doi): copias legales de acceso abierto. conectores: estado y última prueba en vivo de cada conector. ' +
    'REGLAS: solo acceso legal y autorizado; Sci-Hub, LibGen, Z-Library, Anna\'s Archive y similares se rechazan siempre (Sci-Hub se estudia solo como contexto histórico); no se eluden muros de pago ni desafíos anti-bots. ' +
    'Un resumen recuperado NO es una lectura completa: cuenta como leído solo lo que leas con accion=leer. Un preprint no es un artículo revisado y una obra retractada no es evidencia a favor.',
  input_schema: {
    type: 'object', additionalProperties: false, required: ['accion'],
    properties: {
      accion: { type: 'string', enum: ['buscar_externo', 'registrar', 'leer', 'retractacion', 'legal_por_doi', 'conectores'] },
      fuente: { type: 'string', description: 'R01…R16, ciencia, esoterismo, acceso o todas (por defecto todas)' }, consulta: { type: 'string' }, max: { type: 'integer', description: 'resultados por conector (1-25, por defecto 5)' },
      registro: { type: 'object', additionalProperties: false, properties: CAMPOS_REGISTRO, description: 'un registro tal como lo devolvió buscar_externo (alternativa a pasar los campos sueltos)' },
      ...CAMPOS_REGISTRO,
      temas: { type: 'array', items: { type: 'string' }, description: 'temas o códigos de materia (p. ej. S04, H01)' },
      fuente_id: { type: 'integer' }, arxiv: { type: 'string' }, pmcid: { type: 'string' }, desde: { type: 'integer' },
    },
  },
};
export async function herramientaInvestigar(db: Db, input: any, actor: string, get: Get = httpGet) {
  const i = input ?? {};
  try {
    switch (i.accion) {
      case 'buscar_externo': return await investigar(db, { fuente: i.fuente, consulta: i.consulta, max: i.max }, actor, get);
      case 'registrar': {
        const r = { ...(i.registro && typeof i.registro === 'object' ? i.registro : {}), ...Object.fromEntries(Object.keys(CAMPOS_REGISTRO).filter((k) => i[k] !== undefined).map((k) => [k, i[k]])) };
        return await registrarRegistro(db, r as Registro, actor, Array.isArray(i.temas) ? i.temas : Array.isArray(i.registro?.temas) ? i.registro.temas : [], get);
      }
      case 'leer': return await leerFuente(db, { fuente_id: i.fuente_id, url: i.url, doi: i.doi, arxiv: i.arxiv, pmcid: i.pmcid, desde: i.desde }, actor, get);
      case 'retractacion': return await comprobarRetractacion(db, { fuente_id: i.fuente_id, doi: i.doi }, actor, get);
      case 'legal_por_doi': return await legalPorDoi(String(i.doi ?? ''), get, db);
      case 'conectores': return await listarConectores(db);
      default: return { error: 'Acción no válida: usa buscar_externo, registrar, leer, retractacion, legal_por_doi o conectores' };
    }
  } catch (e: any) { return { error: String(e?.message ?? e).slice(0, 700) }; }
}
