// Fábrica de contenido de Aion. Uso:
//   node scripts/media/fabrica.ts estado                 cola frente a YouTube (visibilidad y fecha de salida reales)
//   node scripts/media/fabrica.ts ideas <ideas.json>     importa el bloque `ideas` del playbook yt-fabrica-ideas-semanal (sin repetir)
//   node scripts/media/fabrica.ts qa <id_cola> [video] [miniatura]   puerta de calidad determinista; marca QA o BLOQUEADO
import fs from 'node:fs';
import crypto from 'node:crypto';
import { execFileSync, spawnSync } from 'node:child_process';
import { createPool } from '../../src/db.ts';
import { listVideos } from '../../src/core/youtube.ts';

const db = createPool();
const [cmd, a, b, c] = process.argv.slice(2);
const huella = (t: string) => crypto.createHash('sha1').update(t.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()).digest('hex');
// Pesos documentados en docs/fabrica-aion.md (suman 100)
const PESOS: Record<string, number> = { curiosidad: 20, demanda: 15, relato: 15, originalidad: 10, credibilidad: 10, competencia: 10, relevancia: 8, shorts: 6, viabilidad: 4, coste: 2 };

if (cmd === 'estado') {
  const yt = (await listVideos(50)).videos;
  const cola = (await db.query(`SELECT id, tipo, titulo, estado, youtube_id, sale_el FROM content_queue ORDER BY id`)).rows;
  const porId = new Map(yt.map((v: any) => [v.id, v]));
  for (const q of cola) {
    const v: any = q.youtube_id ? porId.get(q.youtube_id) : null;
    const real = v ? (v.visibilidad === 'private' ? 'privado' : v.visibilidad) : (q.youtube_id ? 'NO EXISTE EN YOUTUBE' : '—');
    const coincide = !v ? !q.youtube_id : (q.estado === 'PUBLISHED' ? v.visibilidad === 'public' : q.estado === 'SCHEDULED' ? v.visibilidad === 'private' : true);
    console.log(`#${q.id} ${q.tipo} ${q.estado} | YouTube: ${real} | ${q.titulo.slice(0, 55)} ${coincide ? '' : '  ← DIFERENCIA'}`);
  }
  for (const v of yt) if (!cola.some((q) => q.youtube_id === v.id)) console.log(`FUERA DE LA COLA: ${v.id} ${v.visibilidad} ${v.titulo}`);
} else if (cmd === 'ideas') {
  const j = JSON.parse(fs.readFileSync(a, 'utf8')); let nuevas = 0, repetidas = 0;
  for (const i of j.lista) {
    const p = i.puntuacion ?? {}; const w = Object.keys(PESOS).reduce((s, k) => s + (Number(p[k]) || 0) * PESOS[k], 0) / 100;
    const r = await db.query(`INSERT INTO content_ideas (ciclo, titulo, pilar, fuente, evidencia, puntuacion, total, huella) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT (huella) DO NOTHING RETURNING id`,
      [j.ciclo, String(i.titulo).slice(0, 200), i.pilar ?? 'suenos', i.fuente ?? null, JSON.stringify(i.evidencia ?? []), JSON.stringify(p), Math.round(w * 100) / 100, huella(i.titulo)]);
    r.rowCount ? nuevas++ : repetidas++;
  }
  for (const e of j.elegidas ?? []) {
    const idea = (await db.query(`UPDATE content_ideas SET estado = 'elegida' WHERE huella = $1 RETURNING id`, [huella(e.titulo)])).rows[0];
    await db.query(`INSERT INTO content_queue (tipo, titulo, idea_id, estado) VALUES ($1,$2,$3,'IDEA')`, [e.tipo === 'short' ? 'short' : 'largo', String(e.titulo).slice(0, 200), idea?.id ?? null]);
  }
  console.log(JSON.stringify({ nuevas, repetidas_omitidas: repetidas, elegidas: (j.elegidas ?? []).length }));
} else if (cmd === 'qa') {
  const q = (await db.query(`SELECT * FROM content_queue WHERE id = $1`, [Number(a)])).rows[0]; if (!q) throw new Error('No existe ese elemento de la cola');
  const video = b ?? q.video_ruta, mini = c; const res: Record<string, { ok: boolean; detalle: string }> = {};
  const ok = (k: string, cond: boolean, detalle: string) => { res[k] = { ok: cond, detalle }; };
  try {
    const pr = JSON.parse(execFileSync('ffprobe', ['-v', 'error', '-print_format', 'json', '-show_streams', '-show_format', video], { encoding: 'utf8' }));
    const v = pr.streams.find((s: any) => s.codec_type === 'video'), au = pr.streams.find((s: any) => s.codec_type === 'audio'), dur = Number(pr.format.duration);
    ok('mp4 reproducible', !!v && !!au, `${v?.codec_name}/${au?.codec_name}`);
    ok('códecs h264+aac', v?.codec_name === 'h264' && au?.codec_name === 'aac', `${v?.codec_name}/${au?.codec_name}`);
    const ar = v.width / v.height;
    ok('relación de aspecto', q.tipo === 'largo' ? Math.abs(ar - 16 / 9) < 0.02 : Math.abs(ar - 9 / 16) < 0.02, `${v.width}x${v.height}`);
    ok('duración', q.tipo === 'largo' ? dur >= 480 && dur <= 720 : dur >= 20 && dur <= 60, `${dur.toFixed(1)} s (largo 8–12 min, Short 20–60 s)`);
    ok('sincronía audio/vídeo', Math.abs(Number(au.duration ?? dur) - Number(v.duration ?? dur)) < 0.5, `Δ ${Math.abs(Number(au.duration ?? dur) - Number(v.duration ?? dur)).toFixed(2)} s`);
  } catch (e: any) { ok('mp4 reproducible', false, String(e.stderr ?? e.message).slice(-200)); }
  if (video && res['mp4 reproducible']?.ok) {
    // un solo paso de ffmpeg: volumen (EBU R128) y cuadros negros; el análisis sale por stderr
    const sal = spawnSync('ffmpeg', ['-hide_banner', '-nostats', '-i', video, '-filter_complex', '[0:a]ebur128=peak=true[ao];[0:v]blackdetect=d=1.0:pix_th=0.05[vo]', '-map', '[ao]', '-map', '[vo]', '-f', 'null', '-'], { encoding: 'utf8', maxBuffer: 64e6 }).stderr;
    const resumen = sal.split('Summary:')[1] ?? '';
    const lufs = Number(/I:\s+(-?\d+(?:\.\d+)?)\s+LUFS/.exec(resumen)?.[1]), peak = Number(/Peak:\s+(-?\d+(?:\.\d+)?)\s+dBFS/.exec(resumen)?.[1]);
    ok('volumen (−14 LUFS ±2)', Number.isFinite(lufs) && Math.abs(lufs + 14) <= 2, `${lufs} LUFS`);
    ok('sin saturación (pico < −0,5 dB)', Number.isFinite(peak) && peak < -0.5, `${peak} dBFS`);
    const negros = (sal.match(/black_start/g) ?? []).length;
    ok('sin cuadros negros', negros === 0, `${negros} tramos negros de 1 s o más`);
  }
  ok('miniatura', q.tipo === 'short' || (!!mini && fs.existsSync(mini) && fs.statSync(mini).size < 2_000_000), mini ? `${mini}` : 'falta la miniatura (solo largos)');
  const falla = Object.entries(res).filter(([, r]) => !r.ok);
  await db.query(`UPDATE content_queue SET qa = $2, estado = $3, updated_at = now() WHERE id = $1`, [q.id, JSON.stringify(res), falla.length ? 'BLOQUEADO' : 'QA']);
  console.log(JSON.stringify({ id: q.id, resultado: falla.length ? 'BLOQUEADO' : 'pasa', fallos: falla.map(([k, r]) => `${k}: ${r.detalle}`), comprobaciones: res }, null, 1));
  process.exitCode = falla.length ? 1 : 0;
} else console.log('Uso: estado | ideas <json> | qa <id> [video] [miniatura]');
await db.end();
