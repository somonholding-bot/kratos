import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import type { Db } from '../db.ts';
import { DATA_DIR, ROOT } from '../config.ts';
import { audit, isHalted } from './state.ts';
import { setThumbnail, uploadCaptions, uploadVideo, videoThumbnails } from './youtube.ts';

// Fábrica autónoma de Aion (herramienta fabrica_aion): produce un episodio de la cola con el motor de Orin
// (scripts/media/episodio: voz Liam en ElevenLabs, animación Pillow + ffmpeg, música ACE-Step, subtítulos), lo pasa por la
// puerta de calidad (scripts/media/fabrica.ts qa) y lo sube como PRIVADO. Publicar o programar sigue exigiendo al propietario
// (publicar_video_youtube). Aquí no hay borrado ni cambios de presupuesto o permisos.

export const MEDIA = path.join(os.homedir(), '.local/share/kratos-media');
export const EPISODIO_DIR = path.join(ROOT, 'scripts/media/episodio');
export const VOZ = 'Liam';                      // voz elegida por el propietario (2-nov-2026)
export const CREDITOS_EPISODIO = 6000;          // un episodio ≈ 5.500 créditos; más es un guion demasiado largo
export const CREDITOS_MES = 40000;              // plan Starter de ElevenLabs
export const carpeta = (id: number) => path.join(os.homedir(), 'Movies/Kratos', `cola-${id}`);
const LOCK = path.join(DATA_DIR, 'fabrica-produciendo.json');
// Nada de apps ni herramientas en lo que ve el público; el canal es en inglés
const APPS = /\b(kratos|claude|anthropic|elevenlabs|eleven labs|chatgpt|openai|gpt|ace-?step|kokoro|midjourney|pillow|ffmpeg|ai[- ]generated)\b/i;
const SPANISH = /[ñ¿¡áéíóú]/i;

// Python con numpy y Pillow (los entornos de scripts/media/instalar.sh)
export function mediaPython(): string | null {
  return ['mflux/bin/python', 'chatterbox/bin/python', 'acestep/.venv/bin/python'].map((p) => path.join(MEDIA, p)).find((p) => fs.existsSync(p)) ?? null;
}

// El guion es un módulo epN.py del motor (lista BEATS); nada fuera de esa carpeta
export function episodeModule(guionRuta: string | null): string {
  const m = /^(?:scripts\/media\/episodio\/)?(ep\d+)\.py$/.exec(String(guionRuta ?? '').trim());
  if (!m) throw new Error('El guion del elemento debe ser scripts/media/episodio/epN.py (storyboard por beats)');
  if (!fs.existsSync(path.join(EPISODIO_DIR, `${m[1]}.py`))) throw new Error(`No existe scripts/media/episodio/${m[1]}.py`);
  return m[1];
}

// Caracteres narrados (= créditos de ElevenLabs), título y música del storyboard
export function episodeInfo(ep: string): { creditos: number; beats: number; titulo: string | null; musica: string | null } {
  const py = mediaPython(); if (!py) throw new Error('Faltan los entornos de vídeo: ejecuta bash scripts/media/instalar.sh');
  const code = `import importlib,json,os,sys; sys.path.insert(0, ${JSON.stringify(EPISODIO_DIR)}); m = importlib.import_module(os.environ['EPISODIO']); B = m.BEATS
print(json.dumps({'creditos': sum(len(b['text']) for b in B), 'beats': len(B), 'titulo': getattr(m, 'TITLE', None), 'musica': getattr(m, 'MUSICA', None)}))`;
  const r = spawnSync(py, ['-c', code], { env: { ...process.env, EPISODIO: ep, PYTHONDONTWRITEBYTECODE: '1' }, encoding: 'utf8', timeout: 60_000 });
  if (r.status !== 0) throw new Error(`No pude leer ${ep}.py: ${(r.stderr || String(r.error)).slice(-300)}`);
  return JSON.parse(r.stdout.trim().split('\n').pop()!);
}

export async function creditsThisMonth(db: Db): Promise<number> {
  return Number((await db.query(`SELECT coalesce(sum(input_tokens), 0)::int AS c FROM ai_usage WHERE model LIKE 'elevenlabs%' AND at >= date_trunc('month', now())`)).rows[0].c);
}

// Comprueba los topes antes de gastar créditos (también lo repite el script justo antes de llamar a ElevenLabs)
export async function checkCredits(db: Db, creditos: number) {
  if (creditos > CREDITOS_EPISODIO) throw new Error(`El guion costaría ${creditos} créditos de voz; el tope por episodio es ${CREDITOS_EPISODIO}. Acórtalo.`);
  const usados = await creditsThisMonth(db);
  if (usados + creditos > CREDITOS_MES) throw new Error(`Sin créditos de voz este mes: usados ${usados} de ${CREDITOS_MES}; este episodio necesita ${creditos}.`);
  return { usados_mes: usados, quedan_tras_este: CREDITOS_MES - usados - creditos };
}

export function productionRunning(): { id: number; pid: number } | null {
  try {
    const l = JSON.parse(fs.readFileSync(LOCK, 'utf8'));
    process.kill(l.pid, 0);
    return l;
  } catch { return null; }
}
export const writeLock = (id: number) => { fs.mkdirSync(DATA_DIR, { recursive: true }); fs.writeFileSync(LOCK, JSON.stringify({ id, pid: process.pid, desde: new Date().toISOString() })); };
export const clearLock = () => { try { fs.unlinkSync(LOCK); } catch { /* ya no estaba */ } };

async function queueItem(db: Db, id: number) {
  const q = (await db.query(`SELECT * FROM content_queue WHERE id = $1`, [id])).rows[0];
  if (!q) throw new Error(`No existe el elemento #${id} de la cola`);
  return q;
}

// (1) Lanza la producción en segundo plano (horas: la animación va fotograma a fotograma)
export async function startProduction(db: Db, id: number, actor: string) {
  const h = await isHalted(db); if (h.halted) throw new Error(`No se produce nada: ${h.reason}`);
  const q = await queueItem(db, id);
  if (q.tipo !== 'largo') throw new Error('Los Shorts salen de un episodio terminado (hacer_short.py); aquí solo se producen episodios largos');
  if (!['IDEA', 'RESEARCH', 'SCRIPT', 'REVIEW', 'BLOQUEADO'].includes(q.estado)) throw new Error(`El elemento #${id} está en ${q.estado}: no se vuelve a producir`);
  const ep = episodeModule(q.guion_ruta);
  const otro = productionRunning(); if (otro) throw new Error(`Ya se está produciendo el elemento #${otro.id}; espera a que termine`);
  const info = episodeInfo(ep);
  const cacheada = fs.existsSync(path.join(carpeta(id), 'voz.wav'));
  const creditos = cacheada ? { usados_mes: await creditsThisMonth(db), nota: 'voz ya generada: no gasta créditos' } : await checkCredits(db, info.creditos);
  await db.query(`UPDATE content_queue SET estado = 'PRODUCTION', notas = $2, updated_at = now() WHERE id = $1`, [id, `Producción lanzada ${new Date().toISOString()} (${ep})`]);
  const logs = path.join(DATA_DIR, 'logs'); fs.mkdirSync(logs, { recursive: true });
  const out = fs.openSync(path.join(logs, `fabrica-${id}.log`), 'a');
  const child = spawn(process.execPath, [path.join(ROOT, 'scripts/media/fabrica.ts'), 'producir', String(id)], { cwd: ROOT, detached: true, stdio: ['ignore', out, out], env: process.env });
  child.unref();
  await audit(db, actor, 'fabrica.produccion_lanzada', { id, episodio: ep, creditos_voz: cacheada ? 0 : info.creditos, pid: child.pid });
  return { id, episodio: ep, beats: info.beats, creditos_voz: cacheada ? 0 : info.creditos, ...creditos, carpeta: carpeta(id), registro: `.jarvis/logs/fabrica-${id}.log`,
    estado: 'PRODUCTION: en segundo plano (voz, música, subtítulos y animación); al terminar ejecuta la acción qa' };
}

// (2) Puerta de calidad determinista: marca QA o BLOQUEADO; sin pasarla no se sube
export async function runQa(db: Db, id: number, miniatura?: string) {
  const q = await queueItem(db, id);
  if (!q.video_ruta) throw new Error(`El elemento #${id} aún no tiene vídeo producido (estado ${q.estado})`);
  if (productionRunning()?.id === id) throw new Error(`El elemento #${id} se está produciendo todavía`);
  const mini = miniatura ? path.resolve(miniatura) : q.miniatura_ruta ?? undefined;
  if (mini && mini !== q.miniatura_ruta) await db.query(`UPDATE content_queue SET miniatura_ruta = $2 WHERE id = $1`, [id, mini]);
  const r = spawnSync(process.execPath, [path.join(ROOT, 'scripts/media/fabrica.ts'), 'qa', String(id), q.video_ruta, ...(mini ? [mini] : [])], { cwd: ROOT, encoding: 'utf8', timeout: 20 * 60_000, maxBuffer: 16e6 });
  const out = r.stdout.slice(r.stdout.indexOf('{'));
  try { return JSON.parse(out); } catch { throw new Error(`La puerta de calidad falló: ${(r.stderr || r.stdout || String(r.error)).slice(-400)}`); }
}

export function publicTextProblem(...texts: (string | undefined)[]): string | null {
  const t = texts.filter(Boolean).join('\n');
  const app = APPS.exec(t); if (app) return `No menciones apps ni herramientas en lo público («${app[0]}»)`;
  if (SPANISH.test(t)) return 'El título, la descripción y las etiquetas van en inglés';
  return null;
}

// (3) Sube como PRIVADO (con subtítulos y miniatura si los hay); solo lo que pasó la puerta de calidad
export async function uploadPrivate(db: Db, id: number, meta: { titulo?: string; descripcion?: string; etiquetas?: string[] }, actor: string) {
  const q = await queueItem(db, id);
  const fallos = Object.entries(q.qa ?? {}).filter(([, r]: any) => !r?.ok);
  if (q.estado !== 'QA' || !Object.keys(q.qa ?? {}).length || fallos.length) throw new Error(`El elemento #${id} no ha pasado la puerta de calidad (estado ${q.estado}${fallos.length ? `; falla: ${fallos.map(([k]) => k).join(', ')}` : ''})`);
  if (q.youtube_id) throw new Error(`Ya está subido: https://youtu.be/${q.youtube_id}`);
  const titulo = String(meta.titulo || q.titulo).slice(0, 100);
  const problema = publicTextProblem(titulo, meta.descripcion, meta.etiquetas?.join(', ')); if (problema) throw new Error(problema);
  const up = await uploadVideo(q.video_ruta, { titulo, descripcion: meta.descripcion ?? '', etiquetas: meta.etiquetas ?? [], categoria: '27', idioma: 'en' });
  await db.query(`UPDATE content_queue SET youtube_id = $2, titulo = $3, updated_at = now() WHERE id = $1`, [id, up.id, titulo]);
  const srt = path.join(path.dirname(q.video_ruta), 'subtitulos.srt');
  const subtitulos = fs.existsSync(srt) ? await uploadCaptions(up.id, srt, 'en').then(() => true, (e) => e.message) : 'sin archivo de subtítulos';
  const miniatura = q.miniatura_ruta ? await setQueueThumbnail(db, { id }, q.miniatura_ruta, actor).then(() => true, (e) => e.message) : 'sin miniatura (usa la acción miniatura)';
  await audit(db, actor, 'youtube.subido_privado', { id: up.id, cola: id, titulo: titulo.slice(0, 100) });
  return { ...up, cola: id, subtitulos, miniatura, siguiente: 'publicar_video_youtube pide la aprobación del propietario para hacerlo público' };
}

// (4) Miniatura propia con thumbnails.set; se registra cuando YouTube la acepta
export async function setQueueThumbnail(db: Db, target: { id?: number; video_id?: string }, file: string, actor: string) {
  const q = target.id ? await queueItem(db, target.id) : (await db.query(`SELECT * FROM content_queue WHERE youtube_id = $1`, [target.video_id])).rows[0];
  const videoId = q?.youtube_id ?? target.video_id;
  if (!videoId) throw new Error('Ese elemento aún no está subido a YouTube');
  const f = path.resolve(file);
  if (!/\.(jpe?g|png)$/i.test(f) || !fs.existsSync(f)) throw new Error(`No existe la imagen ${f} (JPG o PNG)`);
  if (fs.statSync(f).size >= 2_000_000) throw new Error('YouTube no acepta miniaturas de 2 MB o más');
  await setThumbnail(videoId, f);
  if (q) await db.query(`UPDATE content_queue SET miniatura_ruta = $2, miniatura_at = now(), updated_at = now() WHERE id = $1`, [q.id, f]);
  await audit(db, actor, 'youtube.miniatura', { video: videoId, cola: q?.id ?? null });
  return { video: videoId, miniatura: 'puesta', archivo: f };
}

export async function thumbnailStatus(db: Db) {
  const rows = (await db.query(`SELECT id, tipo, titulo, estado, youtube_id, miniatura_ruta, miniatura_at FROM content_queue WHERE youtube_id IS NOT NULL ORDER BY id`)).rows;
  const yt: Record<string, any> = await videoThumbnails(rows.map((r) => r.youtube_id)).catch((e) => ({ error: e.message }));
  return rows.map((r) => ({ cola: r.id, tipo: r.tipo, titulo: r.titulo, estado: r.estado, video: r.youtube_id,
    miniatura_propia: r.miniatura_at ? `sí (puesta ${new Date(r.miniatura_at).toISOString().slice(0, 16)})` : r.tipo === 'short' ? 'no aplica (Shorts)' : 'sin registro: ponla con la acción miniatura',
    en_youtube: yt.error ? `no se pudo leer: ${yt.error}` : yt[r.youtube_id] ?? 'NO EXISTE EN YOUTUBE' }));
}
