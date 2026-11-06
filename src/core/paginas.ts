import { execFile } from 'node:child_process';
import dns from 'node:dns/promises';
import type { Db } from '../db.ts';
import { audit } from './state.ts';

// Páginas web de KRATOS (orden del propietario, 5-nov-2026): KRATOS publica solo sus páginas de venta y de prueba en GitHub Pages
// (repositorio público somonholding-bot/kratos-paginas, gratis), con el enlace de pago de Stripe como botón. Se publica por la API de
// GitHub (sin commits locales). Reglas de contenido: nada engañoso ni promesas imposibles; una preventa se anuncia como preventa.
// Un dominio propio se conecta después con el archivo CNAME y un registro DNS en el registrador del propietario.

export const REPO = process.env.KRATOS_REPO_PAGINAS ?? 'somonholding-bot/kratos-paginas';
type Gh = (args: string[], input?: string) => Promise<string>;
export const gh: Gh = (args, input) => new Promise((resolve, reject) => {
  const p = execFile('gh', args, { timeout: 60_000, maxBuffer: 10_000_000, env: { ...process.env, GH_PROMPT_DISABLED: '1' } }, (e, out, err) => (e ? reject(new Error(String(err || e.message).slice(0, 400))) : resolve(String(out))));
  if (input !== undefined) { p.stdin?.write(input); p.stdin?.end(); }
});

const esc = (s: any) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
const PROHIBIDO = /garantiz|cura\b|curar|milagro|hazte rico|dinero f[aá]cil|100 ?%|sin riesgo|resultados asegurados/i;
export function plantilla(p: { titulo: string; subtitulo: string; puntos: string[]; cta_texto: string; cta_url: string; precio?: string; preventa?: boolean; aviso?: string; idioma?: string }) {
  return `<!doctype html><html lang="${esc(p.idioma ?? 'es')}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(p.titulo)}</title><meta name="description" content="${esc(p.subtitulo)}">
<style>:root{--f:#0b1020;--t:#e8eefc;--a:#7c9cff;--m:#9aa6c6}*{box-sizing:border-box}body{margin:0;font:18px/1.6 system-ui,-apple-system,Segoe UI,sans-serif;background:var(--f);color:var(--t)}
main{max-width:720px;margin:0 auto;padding:56px 20px}h1{font-size:clamp(30px,6vw,46px);line-height:1.15;margin:0 0 14px}p.sub{color:var(--m);font-size:20px;margin:0 0 28px}
ul{padding-left:20px;margin:0 0 32px}li{margin:10px 0}.cta{display:inline-block;background:var(--a);color:#0b1020;font-weight:700;padding:16px 28px;border-radius:12px;text-decoration:none;font-size:19px}
.precio{margin:0 0 14px;font-size:22px;font-weight:700}.pre{display:inline-block;margin-bottom:16px;padding:4px 10px;border-radius:8px;background:#3a2f0b;color:#ffd77a;font-size:14px;font-weight:700}
footer{margin-top:48px;color:var(--m);font-size:14px}</style></head><body><main>
${p.preventa ? `<span class="pre">${p.idioma === 'en' ? 'PRE-ORDER' : 'PREVENTA'}</span>` : ''}<h1>${esc(p.titulo)}</h1><p class="sub">${esc(p.subtitulo)}</p>
<ul>${p.puntos.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>${p.precio ? `<p class="precio">${esc(p.precio)}</p>` : ''}
<a class="cta" href="${esc(p.cta_url)}" rel="noopener">${esc(p.cta_texto)}</a>
<footer>${esc(p.aviso ?? '')}</footer></main></body></html>`;
}

async function asegurarRepo(g: Gh) {
  try { await g(['api', `repos/${REPO}`, '--jq', '.name']); return { creado: false }; } catch { /* no existe */ }
  const [owner, name] = REPO.split('/');
  await g(['api', '-X', 'POST', 'user/repos', '-f', `name=${name}`, '-f', 'description=Páginas de prueba y de venta publicadas por KRATOS', '-F', 'private=false', '-F', 'auto_init=true']);
  await g(['api', '-X', 'POST', `repos/${owner}/${name}/pages`, '-f', 'source[branch]=main', '-f', 'source[path]=/']).catch(() => '');   // GitHub Pages desde main
  return { creado: true };
}

export async function publicarPagina(db: Db, i: { slug: string; titulo: string; subtitulo: string; puntos: string[]; cta_texto: string; cta_url: string; precio?: string; preventa?: boolean; aviso?: string; idioma?: string; oportunidad_id?: number }, actor: string, g: Gh = gh) {
  const slug = String(i.slug ?? '').toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60);
  if (!slug) throw new Error('Falta el slug (nombre corto de la página: letras, números y guiones)');
  for (const k of ['titulo', 'subtitulo', 'cta_texto', 'cta_url'] as const) if (!String(i[k] ?? '').trim()) throw new Error(`Falta ${k}`);
  if (!/^https:\/\//.test(i.cta_url)) throw new Error('El botón debe llevar a un enlace https (por ejemplo, el enlace de pago de Stripe)');
  const todo = `${i.titulo} ${i.subtitulo} ${(i.puntos ?? []).join(' ')}`;
  if (PROHIBIDO.test(todo)) throw new Error(`La página promete algo que no se puede garantizar («${PROHIBIDO.exec(todo)![0]}»)`);
  if (!Array.isArray(i.puntos) || i.puntos.length < 2) throw new Error('Pon al menos 2 puntos concretos de lo que recibe la persona');
  await asegurarRepo(g);
  const html = plantilla({ ...i, puntos: i.puntos.slice(0, 8) });
  const ruta = `${slug}/index.html`;
  let sha: string | null = null;
  try { sha = (await g(['api', `repos/${REPO}/contents/${ruta}`, '--jq', '.sha'])).trim() || null; } catch { sha = null; }
  const body = JSON.stringify({ message: `KRATOS: página ${slug}`, content: Buffer.from(html).toString('base64'), ...(sha ? { sha } : {}) });
  await g(['api', '-X', 'PUT', `repos/${REPO}/contents/${ruta}`, '--input', '-'], body);
  const [owner, name] = REPO.split('/');
  let base = `https://${owner}.github.io/${name}`;
  try { const cname = (await g(['api', `repos/${REPO}/pages`, '--jq', '.cname // ""'])).trim(); if (cname) base = `https://${cname}`; } catch { /* sin dominio propio */ }
  const url = `${base}/${slug}/`;
  await db.query(`INSERT INTO paginas_web (slug, url, titulo, cta_url, oportunidad_id, creado_por) VALUES ($1,$2,$3,$4,$5,$6)
     ON CONFLICT (slug) DO UPDATE SET url = EXCLUDED.url, titulo = EXCLUDED.titulo, cta_url = EXCLUDED.cta_url, actualizado = now()`, [slug, url, i.titulo, i.cta_url, i.oportunidad_id ?? null, actor]);
  await audit(db, actor, 'paginas.publicada', { slug, url });
  // Primera página publicada con el dominio aún sin conectar: se avisa al propietario (una sola vez) para apuntar el DNS
  const dom = (await db.query(`SELECT value FROM system_state WHERE key = 'dominio_paginas'`)).rows[0]?.value;
  const con = (await db.query(`SELECT value FROM system_state WHERE key = 'dominio_paginas_conectado'`)).rows[0]?.value;
  if (dom && con !== dom && !(await db.query(`SELECT 1 FROM agenda WHERE kind = 'aviso' AND text LIKE 'KRATOS ya publicó su primera página%'`)).rows[0])
    await db.query(`INSERT INTO agenda (at, kind, text, created_by) VALUES (now(), 'aviso', $1, 'kratos (páginas web)')`, [`KRATOS ya publicó su primera página (${url}). Ya se puede apuntar ${dom} en Namecheap para que se vea con tu dominio.`]);
  return { url, nota: sha ? 'actualizada' : 'publicada (GitHub tarda 1–2 minutos en mostrarla la primera vez)' };
}

// Dominio propio: escribe el CNAME y lo configura en GitHub Pages; el DNS (registro CNAME → <owner>.github.io) lo pone el propietario una vez
export async function conectarDominio(db: Db, dominio: string, actor: string, g: Gh = gh) {
  const d = String(dominio ?? '').trim().toLowerCase();
  if (!/^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(d)) throw new Error('Dominio inválido');
  // Solo se conecta cuando el DNS ya apunta a GitHub: si no, las páginas dejarían de verse hasta que alguien lo arreglara
  const owner = REPO.split('/')[0].toLowerCase();
  const raiz = d.split('.').length === 2;
  const GH_IPS = ['185.199.108.153', '185.199.109.153', '185.199.110.153', '185.199.111.153'];
  // Dominio raíz: registros A a GitHub Pages; subdominio: CNAME a <owner>.github.io
  const apunta = raiz ? await dns.resolve4(d).then((ips) => ips.length > 0 && ips.every((ip) => GH_IPS.includes(ip))).catch(() => false)
    : await dns.resolveCname(d).then((r) => r.some((x) => x.toLowerCase().replace(/\.$/, '') === `${owner}.github.io`)).catch(() => false);
  const instruccion = raiz
    ? `En Namecheap → Domain List → ${d} → Advanced DNS: borra el registro A de «@» actual y crea 4 registros A con Host «@» y valores ${GH_IPS.join(', ')}; cambia «www» a CNAME «${owner}.github.io.». No borres los registros de correo (MX / Mail Settings).`
    : `En Namecheap → Domain List → ${d.split('.').slice(-2).join('.')} → Advanced DNS → Add New Record: tipo CNAME, Host «${d.split('.').slice(0, -2).join('.')}», Value «${owner}.github.io.», TTL automático.`;
  if (!apunta) return { dominio: d, conectado: false, falta: instruccion };
  await asegurarRepo(g);
  await g(['api', '-X', 'PUT', `repos/${REPO}/pages`, '-f', `cname=${d}`]);
  await audit(db, actor, 'paginas.dominio', { dominio: d });
  return { dominio: d, conectado: true, nota: 'GitHub tarda unos minutos en emitir el certificado https' };
}

export const PAGINAS_TOOL = {
  description: 'Páginas web de KRATOS en GitHub Pages (gratis): publicar (slug, titulo, subtitulo, puntos[] = qué recibe la persona, cta_texto, cta_url = enlace de pago de Stripe u otro https, precio, preventa, aviso, idioma es|en, oportunidad_id): crea o actualiza una página de venta o de prueba y devuelve su URL. '
    + 'dominio (dominio): conecta un dominio propio cuando su DNS ya apunta a GitHub. lista: las páginas publicadas. Nada engañoso ni promesas imposibles; si el producto aún no existe, preventa=true.',
  input_schema: { type: 'object', properties: { accion: { type: 'string', enum: ['publicar', 'lista', 'dominio'] }, dominio: { type: 'string' }, slug: { type: 'string' }, titulo: { type: 'string' }, subtitulo: { type: 'string' }, puntos: { type: 'array', items: { type: 'string' } },
    cta_texto: { type: 'string' }, cta_url: { type: 'string' }, precio: { type: 'string' }, preventa: { type: 'boolean' }, aviso: { type: 'string' }, idioma: { type: 'string' }, oportunidad_id: { type: 'number' } }, required: ['accion'] },
};
export async function herramientaPaginas(db: Db, i: any, actor: string) {
  if (i.accion === 'publicar') return await publicarPagina(db, i, actor);
  if (i.accion === 'dominio') return await conectarDominio(db, String(i.dominio ?? ''), actor);
  if (i.accion === 'lista') return (await db.query(`SELECT slug, url, titulo, oportunidad_id, creado_en, actualizado FROM paginas_web ORDER BY id DESC LIMIT 50`)).rows;
  return { error: 'Acción no válida' };
}

// El worker intenta conectar el dominio elegido por el propietario (system_state dominio_paginas) en cuanto el DNS ya apunta
export async function conectarDominioPendiente(db: Db) {
  const d = (await db.query(`SELECT value FROM system_state WHERE key = 'dominio_paginas'`)).rows[0]?.value;
  const hecho = (await db.query(`SELECT value FROM system_state WHERE key = 'dominio_paginas_conectado'`)).rows[0]?.value;
  if (!d || hecho === d) return null;
  const r = await conectarDominio(db, String(d), 'kratos (páginas web)');
  if (r.conectado) await db.query(`INSERT INTO system_state (key, value) VALUES ('dominio_paginas_conectado', $1) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`, [JSON.stringify(d)]);
  return r;
}
