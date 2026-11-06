import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import type { Db } from '../db.ts';
import { DATA_DIR } from '../config.ts';
import { audit } from './state.ts';

// Datos públicos reales para los experimentos de ACD. Solo fuentes permitidas (lista cerrada en código), descarga hecha por KRATOS
// (no por el script del experimento, que sigue sin red), archivos con sha256 y registro. Primer conjunto: Global Consciousness Project.
export const DIR_DATOS = () => process.env.KRATOS_ACD_DATOS ?? path.join(DATA_DIR, 'acd', 'datos');
const MAX_DIAS = 31, MAX_TOTAL = 3 * 1024 ** 3;
export const FUENTES: Record<string, { descripcion: string; url: (fecha: string) => string; formato: string; desde: string }> = {
  gcp: {
    descripcion: 'Global Consciousness Project (global-mind.org): red mundial de generadores aleatorios físicos («eggs»), 1 ensayo por segundo por generador.',
    url: (f) => `https://global-mind.org/data/eggsummary/${f.slice(0, 4)}/basketdata-${f}.csv.gz`, desde: '1999-08-05',
    formato: 'CSV comprimido (gzip). Filas tipo 10/11: cabecera (11,2 = inicio en tiempo Unix). Fila 12: identificadores de los generadores. Filas 13: segundo (tiempo Unix) y, por generador, la suma de un ensayo de 200 bits (esperado 100, desviación √50 ≈ 7,07); vacío = sin dato. Léelo con gzip y csv de Python en la carpeta datos/ del experimento.',
  },
};

const fechas = (desde: string, hasta: string) => {
  const out: string[] = []; const d = new Date(`${desde}T00:00:00Z`), h = new Date(`${hasta}T00:00:00Z`);
  if (Number.isNaN(+d) || Number.isNaN(+h) || h < d) throw new Error('Fechas inválidas (AAAA-MM-DD, desde ≤ hasta)');
  for (; d <= h; d.setUTCDate(d.getUTCDate() + 1)) out.push(d.toISOString().slice(0, 10));
  if (out.length > MAX_DIAS) throw new Error(`Como mucho ${MAX_DIAS} días por descarga`);
  return out;
};
function usado(dir: string) { try { return fs.readdirSync(dir).reduce((s, f) => s + fs.statSync(path.join(dir, f)).size, 0); } catch { return 0; } }

export async function descargar(db: Db, fuente: string, desde: string, hasta: string, actor: string, fetcher: typeof fetch = fetch) {
  const F = FUENTES[fuente]; if (!F) throw new Error(`Fuente no permitida: ${fuente}. Permitidas: ${Object.keys(FUENTES).join(', ')}`);
  if (desde < F.desde) throw new Error(`${fuente} empieza el ${F.desde}`);
  const dir = path.join(DIR_DATOS(), fuente); fs.mkdirSync(dir, { recursive: true });
  const res: any[] = [];
  for (const f of fechas(desde, hasta)) {
    const nombre = `${fuente}:${f}`;
    const ya = (await db.query(`SELECT nombre FROM datos_publicos WHERE nombre = $1`, [nombre])).rows[0];
    if (ya) { res.push({ nombre, estado: 'ya estaba' }); continue; }
    if (usado(dir) > MAX_TOTAL) { res.push({ nombre, estado: 'límite de disco de datos alcanzado' }); break; }
    const url = F.url(f);
    try {
      const r = await fetcher(url, { signal: AbortSignal.timeout(120_000), headers: { 'user-agent': 'KRATOS-ACD (investigacion; datos publicos)' } });
      if (!r.ok) { res.push({ nombre, estado: `HTTP ${r.status}` }); continue; }
      const buf = Buffer.from(await r.arrayBuffer());
      if (buf.length < 100 || buf[0] !== 0x1f || buf[1] !== 0x8b) { res.push({ nombre, estado: 'no es un archivo gzip válido' }); continue; }
      const ruta = path.join(dir, `${f}.csv.gz`);
      fs.writeFileSync(ruta, buf);
      const sha = crypto.createHash('sha256').update(buf).digest('hex');
      await db.query(`INSERT INTO datos_publicos (nombre, fuente, url, ruta, sha256, bytes, descripcion, descargado_por) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`, [nombre, fuente, url, ruta, sha, buf.length, F.descripcion, actor]);
      res.push({ nombre, estado: 'descargado', bytes: buf.length });
    } catch (e: any) { res.push({ nombre, estado: `error: ${String(e?.message ?? e).slice(0, 120)}` }); }
  }
  await audit(db, actor, 'datos.descarga', { fuente, desde, hasta, ok: res.filter((x) => x.estado === 'descargado').length });
  return { fuente, resultados: res, uso: `en experimentos: acd accion=registrar_modelo con datasets=[${res.slice(0, 2).map((x) => `"${x.nombre}"`).join(', ')}…]; los archivos aparecen en la carpeta datos/ del experimento`, formato: F.formato };
}

// Archivos que un modelo puede usar: deben estar descargados y con su sha256 intacto
export async function resolver(db: Db, nombres: string[]) {
  const out: { nombre: string; ruta: string; sha256: string; archivo: string }[] = [];
  for (const n of [...new Set(nombres.map(String))].slice(0, 400)) {
    const d = (await db.query(`SELECT * FROM datos_publicos WHERE nombre = $1`, [n])).rows[0];
    if (!d) throw new Error(`Dataset «${n}» no descargado: usa datos_publicos accion=descargar primero`);
    out.push({ nombre: n, ruta: d.ruta, sha256: d.sha256, archivo: `${n.replace(':', '-')}.csv.gz` });
  }
  return out;
}

export const DATOS_TOOL = {
  description: 'Datos públicos REALES para los experimentos de ACD (el script del experimento sigue sin red: los datos los descarga KRATOS y se copian a la carpeta datos/ del experimento). catalogo: fuentes permitidas y formato. '
    + 'descargar (fuente gcp, desde AAAA-MM-DD, hasta AAAA-MM-DD; ≤31 días por vez): Global Consciousness Project, generadores aleatorios físicos de todo el mundo. lista (fuente): lo ya descargado. Luego: acd accion=registrar_modelo con datasets=["gcp:2015-01-01", …] y en salida.json datos="observado".',
  input_schema: { type: 'object', properties: { accion: { type: 'string', enum: ['catalogo', 'descargar', 'lista'] }, fuente: { type: 'string' }, desde: { type: 'string' }, hasta: { type: 'string' } }, required: ['accion'] },
};
export async function herramientaDatos(db: Db, i: any, actor: string) {
  if (i.accion === 'catalogo') return Object.fromEntries(Object.entries(FUENTES).map(([k, v]) => [k, { descripcion: v.descripcion, formato: v.formato, desde: v.desde }]));
  if (i.accion === 'descargar') return await descargar(db, String(i.fuente ?? 'gcp'), String(i.desde ?? ''), String(i.hasta ?? i.desde ?? ''), actor);
  if (i.accion === 'lista') return (await db.query(`SELECT nombre, bytes, descargado_at FROM datos_publicos WHERE ($1 = '' OR fuente = $1) ORDER BY nombre`, [String(i.fuente ?? '')])).rows;
  return { error: 'Acción no válida' };
}
