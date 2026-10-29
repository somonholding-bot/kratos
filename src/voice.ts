import { execFile } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { DATA_DIR, ROOT, config } from './config.ts';
import type { Db } from './db.ts';

// Transcripción 100 % local con whisper.cpp. El audio se escribe en un archivo temporal
// (permisos 600) solo durante la transcripción y se borra siempre al terminar.

const WHISPER = process.env.KRATOS_WHISPER ?? '/opt/homebrew/bin/whisper-cli';
const MODEL = path.join(DATA_DIR, 'models', 'ggml-large-v3-turbo-q5_0.bin');
const TMP = path.join(DATA_DIR, config.db.database === 'jarvis' ? 'tmp' : `tmp-${config.db.database}`);

export const VOICE_LIMITS = { minMs: 400, maxMs: 30_000, minRms: 0.004 };   // umbral bajo: voz suave o lejos del micrófono

// Frases que Whisper inventa sobre silencio o ruido (subtítulos de vídeos de entrenamiento).
const HALLUCINATIONS = [/^\s*[\[(].*[\])]\s*$/, /amara\.org/i, /subt[ií]tulos (realizados|por)/i, /gracias por ver/i, /suscr[ií]bete/i];

export type Transcription = { ok: boolean; text: string; outcome: string; audioMs: number; sttMs: number; metricId?: number; message?: string };

export function cleanTmp() {
  fs.rmSync(TMP, { recursive: true, force: true }); // restos de una caída: nunca se conservan grabaciones
}

export function voiceAvailable() {
  return { whisper: fs.existsSync(WHISPER), model: fs.existsSync(MODEL) };
}

// WAV PCM 16 bits mono 16 kHz: devuelve duración y energía (RMS normalizada).
export function analyzeWav(buf: Buffer): { audioMs: number; rms: number } {
  if (buf.length < 44 || buf.toString('ascii', 0, 4) !== 'RIFF' || buf.toString('ascii', 8, 12) !== 'WAVE') throw new Error('Audio no es WAV');
  let off = 12, fmt: { ch: number; rate: number; bits: number } | null = null, data: Buffer | null = null;
  while (off + 8 <= buf.length) {
    const id = buf.toString('ascii', off, off + 4), size = buf.readUInt32LE(off + 4);
    if (id === 'fmt ') fmt = { ch: buf.readUInt16LE(off + 10), rate: buf.readUInt32LE(off + 12), bits: buf.readUInt16LE(off + 22) };
    if (id === 'data') data = buf.subarray(off + 8, Math.min(buf.length, off + 8 + size));
    off += 8 + size + (size % 2);
  }
  if (!fmt || !data || fmt.bits !== 16 || fmt.ch !== 1 || fmt.rate !== 16000) throw new Error('Se espera WAV PCM 16 bits, mono, 16 kHz');
  const n = data.length / 2;
  let sum = 0;
  for (let i = 0; i < n; i++) { const s = data.readInt16LE(i * 2) / 32768; sum += s * s; }
  return { audioMs: Math.round((n / 16000) * 1000), rms: n ? Math.sqrt(sum / n) : 0 };
}

export function cleanTranscript(raw: string): string {
  const text = raw.replace(/\s+/g, ' ').trim();
  if (text.replace(/[^\p{L}\p{N}]/gu, '').length < 3) return ''; // «y», «eh»…: ruido, no una orden
  return HALLUCINATIONS.some((re) => re.test(text)) ? '' : text;
}

export async function transcribe(db: Db, wav: Buffer, signal?: AbortSignal): Promise<Transcription> {
  const started = Date.now();
  let audioMs = 0;
  const finish = async (t: Omit<Transcription, 'audioMs' | 'sttMs'>): Promise<Transcription> => {
    const out: Transcription = { ...t, audioMs, sttMs: Date.now() - started };
    const r = await db.query('INSERT INTO voice_metrics (audio_ms, stt_ms, outcome) VALUES ($1,$2,$3) RETURNING id', [audioMs, out.sttMs, out.outcome]).catch(() => null);
    out.metricId = r ? Number(r.rows[0].id) : undefined;
    return out;
  };
  const a = analyzeWav(wav);
  audioMs = a.audioMs;
  if (a.audioMs < VOICE_LIMITS.minMs) return finish({ ok: false, text: '', outcome: 'muy_corto', message: 'Mantén pulsado mientras hablas.' });
  if (a.audioMs > VOICE_LIMITS.maxMs + 1000) return finish({ ok: false, text: '', outcome: 'muy_largo', message: 'Máximo 30 segundos por mensaje.' });
  if (a.rms < VOICE_LIMITS.minRms) return finish({ ok: false, text: '', outcome: 'silencio', message: 'No te escuché. Revisa el micrófono elegido.' });

  try {
    const text = cleanTranscript(await whisper(wav, signal));
    if (!text) return finish({ ok: false, text: '', outcome: 'ruido', message: 'Solo oí ruido. Prueba de nuevo más cerca del micrófono.' });
    return finish({ ok: true, text, outcome: 'ok' });
  } catch (err: any) {
    if (err?.name === 'AbortError') return finish({ ok: false, text: '', outcome: 'cancelado', message: 'Cancelado.' });
    console.error('[voz] whisper:', err?.message);
    return finish({ ok: false, text: '', outcome: 'error', message: 'La transcripción falló. Revisa el registro.' });
  }
}

// ---------- Palabra de activación «Kratos» ----------
// La app de escritorio escucha de forma continua y envía aquí cada frase detectada.
// Solo se analizan los primeros 2,5 s; si no empieza por «Kratos», se descarta sin guardar nada.

const WAKE = 'kratos';

function levenshtein(a: string, b: string): number {
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++)
    d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  return d[a.length][b.length];
}

// Whisper escribe a veces «Gratos», «Cratos», «Critos»… Se aceptan variantes cercanas,
// solo entre las tres primeras palabras («Oye Kratos, …»).
export function isWakeToken(word: string): boolean {
  const w = word.toLowerCase().normalize('NFD').replace(/[^a-z]/g, '');
  if (w.length < 5 || w.length > 7) return false;
  const dist = levenshtein(w, WAKE);
  return dist <= 1 || (dist <= 2 && /^[kc]/.test(w));
}

const HEY = /^(hey|hei|ey|eh|ei|hay|oye|oi|ok|okay|hola|buenas|a)$/;
const plain = (w: string) => w.toLowerCase().normalize('NFD').replace(/[^a-z]/g, '');

// Frases de activación: «Kratos, Kratos» (dos menciones seguidas) o «Hey Kratos».
// Una sola mención no despierta por sí misma: la app la recuerda unos segundos por si
// llega la segunda en el siguiente fragmento (ventana configurable).
export function detectWake(text: string): { wake: boolean; mentions: number; hey: boolean; command: string } {
  const words = text.trim().split(/\s+/).filter(Boolean);
  // «Kratos» puede llegar en cualquier punto del fragmento (antes solo se miraban las 5 primeras palabras)
  const all = words.map((w, i) => (isWakeToken(w) ? i : -1)).filter((i) => i >= 0);
  const strong = all.findIndex((i, k) => (i > 0 && HEY.test(plain(words[i - 1]))) || (all[k + 1] !== undefined && all[k + 1] - i <= 2));
  const idx = strong >= 0 ? all.slice(strong) : all;
  if (!idx.length) return { wake: false, mentions: 0, hey: false, command: '' };
  const hey = idx[0] > 0 && HEY.test(plain(words[idx[0] - 1]));
  const mentions = idx.length >= 2 && idx[1] - idx[0] <= 2 ? 2 : 1;
  const last = mentions === 2 ? idx[1] : idx[0];
  const command = words.slice(last + 1).join(' ').replace(/^[\s,.;:-]+/, '').trim();
  // «Kratos, …» al empezar la frase y con una orden detrás también despierta
  const leading = (idx[0] === 0 || /[.?!]$/.test(words[idx[0] - 1] ?? '')) && command.replace(/[.\s]+$/, '').split(/\s+/).length >= 2;
  return { wake: hey || mentions >= 2 || leading, mentions, hey, command: command.replace(/[.\s]+$/, '').length >= 2 ? command : '' };
}

// Servicio persistente de whisper.cpp (com.jarvis.whisper) con Silero VAD: más rápido y sin «palabras» inventadas con ruido.
// Si no está disponible, se usa whisper-cli como antes.
const WHISPER_SERVER = process.env.KRATOS_WHISPER_SERVER ?? 'http://127.0.0.1:7432/inference';
async function whisperServer(wav: Buffer, signal?: AbortSignal): Promise<string | null> {
  try {
    const form = new FormData();
    form.append('file', new Blob([new Uint8Array(wav)], { type: 'audio/wav' }), 'audio.wav');
    form.append('response_format', 'json');
    form.append('temperature', '0.0');
    const r = await fetch(WHISPER_SERVER, { method: 'POST', body: form, signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(20_000)]) : AbortSignal.timeout(20_000) });
    if (!r.ok) return null;
    const j = await r.json() as { text?: string };
    return typeof j.text === 'string' ? j.text.replace(/\s+/g, ' ').trim() : null;
  } catch (e: any) {
    if (signal?.aborted) throw e;
    return null;
  }
}

async function whisper(wav: Buffer, signal?: AbortSignal): Promise<string> {
  if (process.env.KRATOS_WHISPER_SERVER !== 'off') {
    const fast = await whisperServer(wav, signal);
    if (fast !== null) return fast;
  }
  fs.mkdirSync(TMP, { recursive: true, mode: 0o700 });
  const file = path.join(TMP, `${crypto.randomUUID()}.wav`);
  fs.writeFileSync(file, wav, { mode: 0o600 });
  try {
    const raw = await new Promise<string>((resolve, reject) => {
      execFile(WHISPER, ['-m', MODEL, '-f', file, '-l', 'es', '-nt', '-np', '-t', '4'], { timeout: 30_000, signal }, (err, stdout) =>
        err ? reject(err) : resolve(stdout));
    });
    return raw.replace(/\s+/g, ' ').trim();
  } finally {
    fs.rmSync(file, { force: true });
  }
}

export type WakeResult = { wake: boolean; mentions: number; command: string; text: string; audioMs: number; sttMs: number; metricId?: number; reason?: string };

export async function transcribeWake(db: Db, wav: Buffer, signal?: AbortSignal): Promise<WakeResult> {
  const started = Date.now();
  const a = analyzeWav(wav);
  const miss = (reason: string): WakeResult => {
    // se registran los intentos fallidos con voz (no el silencio) para afinar la sensibilidad
    if (reason !== 'silencio' && reason !== 'muy_corto') db.query(`INSERT INTO voice_metrics (audio_ms, stt_ms, outcome) VALUES ($1,$2,$3)`, [a.audioMs, Date.now() - started, 'ruido']).catch(() => {});
    return { wake: false, mentions: 0, command: '', text: '', audioMs: a.audioMs, sttMs: Date.now() - started, reason };
  };
  if (a.audioMs < VOICE_LIMITS.minMs) return miss('muy_corto');
  if (a.audioMs > 15_000) return miss('muy_largo');
  if (a.rms < VOICE_LIMITS.minRms) return miss('silencio');

  const text = cleanTranscript(await whisper(wav, signal));
  const { wake, mentions, command } = detectWake(text);
  if (!mentions) return miss('sin_palabra');
  if (!wake) return { wake, mentions, command, text: '', audioMs: a.audioMs, sttMs: Date.now() - started, reason: 'una_mencion' };
  const sttMs = Date.now() - started;
  const r = await db.query(`INSERT INTO voice_metrics (audio_ms, stt_ms, outcome) VALUES ($1,$2,'ok') RETURNING id`, [a.audioMs, sttMs]).catch(() => null);
  return { wake, mentions, command, text, audioMs: a.audioMs, sttMs, metricId: r ? Number(r.rows[0].id) : undefined };
}

// Voz natural local (Piper, voz masculina es_MX «claude», calidad alta). Sin coste ni datos fuera del Mac.
const PIPER = path.join(ROOT, '.jarvis', 'tts', 'venv', 'bin', 'piper');
const PIPER_VOICE = path.join(ROOT, '.jarvis', 'tts', 'es_MX-claude-high.onnx');
export const naturalVoiceAvailable = () => fs.existsSync(PIPER) && fs.existsSync(PIPER_VOICE);

// Servicio de voz persistente (com.jarvis.tts): 0,1 s por frase en vez de ~2 s cargando el modelo cada vez.
export async function synthesize(text: string, signal?: AbortSignal, voice = 'piper'): Promise<Buffer> {
  try {
    const r = await fetch('http://127.0.0.1:7431/tts', { method: 'POST', body: JSON.stringify({ text: text.replace(/[*_#`]/g, '').slice(0, 2000), voice }),
      signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(20_000)]) : AbortSignal.timeout(20_000) });
    if (r.ok) return smoothEnds(Buffer.from(await r.arrayBuffer()));
  } catch (e: any) { if (signal?.aborted) throw e; }
  return synthesizeCli(text, signal);
}

async function synthesizeCli(text: string, signal?: AbortSignal): Promise<Buffer> {
  if (!naturalVoiceAvailable()) throw new Error('Voz natural no instalada');
  const clean = text.replace(/[*_#`]/g, '').replace(/\s+/g, ' ').trim().slice(0, 2000);
  fs.mkdirSync(TMP, { recursive: true, mode: 0o700 });
  const file = path.join(TMP, `${crypto.randomUUID()}-tts.wav`);
  try {
    await new Promise<void>((resolve, reject) => {
      const p = execFile(PIPER, ['-m', PIPER_VOICE, '-f', file, '--length-scale', '0.93', '--sentence-silence', '0.15'], { timeout: 60_000, signal }, (err) => (err ? reject(err) : resolve()));
      p.stdin?.end(clean);
    });
    return smoothEnds(fs.readFileSync(file));
  } finally {
    fs.rmSync(file, { force: true });
  }
}

// Piper a veces deja un chasquido o un soplido al terminar: se recorta la cola casi muda y se funden principio y final.
export function smoothEnds(wav: Buffer): Buffer {
  let off = 12;
  while (off + 8 <= wav.length && wav.toString('ascii', off, off + 4) !== 'data') off += 8 + wav.readUInt32LE(off + 4);
  if (off + 8 > wav.length || wav.readUInt16LE(34) !== 16) return wav;
  const rate = wav.readUInt32LE(24), start = off + 8;
  let n = Math.floor(Math.min(wav.readUInt32LE(off + 4), wav.length - start) / 2);
  const at = (i: number) => wav.readInt16LE(start + i * 2);
  // última muestra con voz (> ~1 % de escala) y un margen de 60 ms
  let last = n - 1; while (last > 0 && Math.abs(at(last)) < 330) last--;
  n = Math.min(n, last + Math.round(rate * 0.06));
  const fadeIn = Math.round(rate * 0.012), fadeOut = Math.round(rate * 0.12), tail = Math.round(rate * 0.12);
  const out = Buffer.alloc(start + (n + tail) * 2);
  wav.copy(out, 0, 0, start);
  for (let i = 0; i < n; i++) {
    const g = Math.min(1, i / fadeIn, (n - 1 - i) / fadeOut);
    out.writeInt16LE(Math.round(at(i) * Math.max(0, g)), start + i * 2);
  }
  out.writeUInt32LE((n + tail) * 2, off + 4);
  out.writeUInt32LE(out.length - 8, 4);
  return out;
}
