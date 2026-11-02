// Produce un vídeo completo en el Mac, gratis y local: guion → voz → imágenes → música → subtítulos → montaje → miniatura.
// Uso: node scripts/media/producir.ts encargo.json
// encargo.json: { "titulo": "...", "guion": "texto que se narra", "imagenes": ["prompt en inglés", ...] (opcional),
//   "musica": "descripción en inglés" (opcional), "formato": "horizontal" | "vertical", "carpeta": "/ruta/salida" (opcional),
//   "idioma": "en" (por defecto; el canal es en inglés y YouTube traduce y dobla), "voz_referencia": "/ruta/10s.wav" (opcional) }
// Resultado en la carpeta: video.mp4, subtitulos.srt, miniatura.jpg, voz.wav, musica.wav, img-*.png y resultado.json.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const MEDIA = path.join(os.homedir(), '.local/share/kratos-media');
const HERE = path.dirname(new URL(import.meta.url).pathname);
const spec = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
if (!spec.titulo || !spec.guion) throw new Error('El encargo necesita «titulo» y «guion»');
const vertical = spec.formato === 'vertical';
const LANG = spec.idioma ?? 'en';
const [W, H] = vertical ? [1080, 1920] : [1920, 1080];
const slug = String(spec.titulo).toLowerCase().normalize('NFD').replace(/[^\w\s-]/g, '').trim().replace(/\s+/g, '-').slice(0, 50);
const dir = spec.carpeta ?? path.join(os.homedir(), 'Movies/Kratos', `${new Date().toISOString().slice(0, 10)}-${slug}`);
fs.mkdirSync(dir, { recursive: true });
const f = (n: string) => path.join(dir, n);
const log = (m: string) => console.log(`[${new Date().toLocaleTimeString('es')}] ${m}`);

function run(cmd: string, args: string[], cwd?: string, minutes = 60) {
  const r = spawnSync(cmd, args, { cwd, encoding: 'utf8', timeout: minutes * 60_000, maxBuffer: 64 * 1024 * 1024 });
  if (r.status !== 0) throw new Error(`${path.basename(cmd)} falló: ${(r.stderr || r.stdout || String(r.error)).slice(-800)}`);
  return r.stdout;
}
const seconds = (file: string) => Number(run('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', file]).trim());

// 1. Voz narradora
if (!fs.existsSync(f('voz.wav'))) {
  log('Voz…');
  fs.writeFileSync(f('guion.txt'), spec.guion);
  run(path.join(MEDIA, 'chatterbox/bin/python'), [path.join(HERE, 'voz.py'), f('guion.txt'), f('voz.wav'), LANG, ...(spec.voz_referencia ? [spec.voz_referencia] : [])], undefined, 90);
}
const LEAD = 2, TAIL = 4;   // segundos de música antes y después de la voz
const total = LEAD + seconds(f('voz.wav')) + TAIL;
log(`Duración: ${Math.round(total)} s`);

// 2. Imágenes (como máximo 1280×720 o 720×1280: más grande supera la memoria del Mac)
const STYLE = 'cinematic spiritual atmosphere, deep midnight blue and aged gold palette, soft volumetric light, serene, highly detailed, no text, no letters';
const prompts: string[] = spec.imagenes?.length ? spec.imagenes : [
  'crescent moon over calm ocean at night', 'lone figure meditating on a mountain at dawn', 'sacred geometry glowing softly in the stars',
  'candle light in a quiet temple', 'forest path with golden light rays', 'starry sky over a still lake'];
const nImg = Math.min(prompts.length, Math.max(3, Math.ceil(total / 20)));
const images: string[] = [];
for (let i = 0; i < nImg; i++) {
  const out = f(`img-${i + 1}.png`);
  if (!fs.existsSync(out)) {
    log(`Imagen ${i + 1}/${nImg}…`);
    run(path.join(MEDIA, 'mflux/bin/mflux-generate-z-image-turbo'), ['--prompt', `${prompts[i]}, ${STYLE}`, '--width', String(vertical ? 720 : 1280), '--height', String(vertical ? 1280 : 720),
      '--steps', '9', '--quantize', '4', '--seed', String(100 + i), '--output', out], undefined, 30);
  }
  images.push(out);
}

// 3. Música ambiental instrumental (ACE-Step hasta 600 s; si el vídeo es más largo, se repite)
if (!fs.existsSync(f('musica.wav'))) {
  log('Música…');
  run(path.join(MEDIA, 'acestep/.venv/bin/python'), [path.join(HERE, 'musica.py'), spec.musica ?? 'calm ambient meditation music, soft piano, warm pads, gentle drones, peaceful, slow, spiritual',
    String(Math.min(600, Math.ceil(total))), f('musica.wav')], path.join(MEDIA, 'acestep'), 60);
}

// 4. Subtítulos con el transcriptor local (whisper-server) a partir de la voz
if (!fs.existsSync(f('subtitulos.srt'))) {
  log('Subtítulos…');
  run('ffmpeg', ['-loglevel', 'error', '-y', '-i', f('voz.wav'), '-ar', '16000', '-ac', '1', f('voz16.wav')]);
  const srt = run('curl', ['-sf', 'http://127.0.0.1:7432/inference', '-F', `file=@${f('voz16.wav')}`, '-F', `language=${LANG}`, '-F', 'response_format=srt']);
  // Bloques cortos (≤ 42 caracteres) repartiendo el tiempo de cada segmento según su texto, y desplazados lo que tarda en entrar la voz
  const ms = (t: string) => { const [h, m, rest] = t.split(':'); const [s, x] = rest.split(','); return ((+h * 60 + +m) * 60 + +s) * 1000 + +x; };
  const fmt = (v: number) => { const p = (n: number, l = 2) => String(Math.floor(n)).padStart(l, '0');
    return `${p(v / 3_600_000)}:${p((v / 60_000) % 60)}:${p((v / 1000) % 60)},${p(v % 1000, 3)}`; };
  const cues: string[] = [];
  for (const m of srt.matchAll(/(\d\d:\d\d:\d\d,\d\d\d) --> (\d\d:\d\d:\d\d,\d\d\d)\s*\n([\s\S]*?)(?=\n\s*\n|$)/g)) {
    const [a, b, text] = [ms(m[1]) + LEAD * 1000, ms(m[2]) + LEAD * 1000, m[3].replace(/\s+/g, ' ').trim()];
    const chunks: string[] = [];
    for (const w of text.split(' ')) {
      const cur = chunks[chunks.length - 1];
      if (cur && cur.length + w.length < 42 && !/[.!?…]$/.test(cur)) chunks[chunks.length - 1] = `${cur} ${w}`; else chunks.push(w);
    }
    const len = chunks.reduce((n, c) => n + c.length, 0);
    let t = a;
    for (const c of chunks) { const d = ((b - a) * c.length) / len; cues.push(`${cues.length + 1}\n${fmt(t)} --> ${fmt(t + d)}\n${c}\n`); t += d; }
  }
  fs.writeFileSync(f('subtitulos.srt'), cues.join('\n'));
  fs.rmSync(f('voz16.wav'), { force: true });
}

// 5. Montaje: cada imagen con un zoom lento (Ken Burns) y fundidos; voz + música con la música bajando bajo la voz
log('Montaje…');
const FPS = 30, FADE = 1.5;
const per = (total + FADE * (images.length - 1)) / images.length;
const args = ['-loglevel', 'error', '-y'];
images.forEach((img) => args.push('-loop', '1', '-t', per.toFixed(2), '-i', img));
args.push('-i', f('voz.wav'), '-stream_loop', '-1', '-i', f('musica.wav'), '-i', f('subtitulos.srt'));
const frames = Math.ceil(per * FPS);
const vf = images.map((_, i) => {
  const zin = i % 2 === 0;   // alterna acercar y alejar
  const z = zin ? `min(1+0.10*on/${frames},1.10)` : `max(1.10-0.10*on/${frames},1)`;
  return `[${i}:v]scale=${W * 3}:${H * 3}:force_original_aspect_ratio=increase,crop=${W * 3}:${H * 3},zoompan=z='${z}':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=${frames}:s=${W}x${H}:fps=${FPS},setsar=1,format=yuv420p[v${i}]`;
});
let last = 'v0';
for (let i = 1; i < images.length; i++) {
  const off = (per - FADE) * i;
  vf.push(`[${last}][v${i}]xfade=transition=fade:duration=${FADE}:offset=${off.toFixed(2)}[x${i}]`);
  last = `x${i}`;
}
vf.push(`[${last}]fade=t=in:st=0:d=1,fade=t=out:st=${(total - 1.5).toFixed(2)}:d=1.5[vout]`);
const v = images.length, a = images.length + 1;
vf.push(`[${v}:a]adelay=${LEAD * 1000}|${LEAD * 1000},apad,asplit=2[voz][sc]`,
  `[${a}:a]volume=0.35,afade=t=in:d=2,afade=t=out:st=${(total - 3).toFixed(2)}:d=3[mus]`,
  `[mus][sc]sidechaincompress=threshold=0.03:ratio=8:attack=20:release=600[musd]`,
  `[voz][musd]amix=inputs=2:duration=first:normalize=0,loudnorm=I=-16:TP=-1.5:LRA=11[aout]`);
args.push('-filter_complex', vf.join(';'), '-map', '[vout]', '-map', '[aout]', '-map', `${images.length + 2}:s`,
  '-t', total.toFixed(2), '-c:v', 'libx264', '-preset', 'medium', '-crf', '20', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '192k',
  '-c:s', 'mov_text', '-metadata:s:s:0', `language=${LANG === 'es' ? 'spa' : 'eng'}`, '-movflags', '+faststart', f('video.mp4'));
run('ffmpeg', args, undefined, 90);

// 6. Miniatura: la primera imagen con el título grande y legible en móvil
log('Miniatura…');
run(path.join(MEDIA, 'mflux/bin/python'), [path.join(HERE, 'miniatura.py'), images[0], spec.miniatura_texto ?? spec.titulo, f('miniatura.jpg'), vertical ? 'vertical' : 'horizontal']);

const result = { video: f('video.mp4'), subtitulos: f('subtitulos.srt'), miniatura: f('miniatura.jpg'), duracion_s: Math.round(total), imagenes: images.length, carpeta: dir };
fs.writeFileSync(f('resultado.json'), JSON.stringify(result, null, 2));
log('Listo');
console.log(JSON.stringify(result));
