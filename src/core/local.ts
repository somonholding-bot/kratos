import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { ROOT } from '../config.ts';
import type { Db } from '../db.ts';
import { getState } from './state.ts';
import { owner } from './agenda.ts';

// Cerebro rápido y gratis para lo sencillo (charla, cultura general, explicaciones), en este orden:
//   1. Groq (modelos abiertos como Llama en chips especiales: respuesta casi inmediata; plan gratis con límites)
//   2. Ollama en este Mac (sin internet ni límites; respaldo si Groq se pasa del límite o no hay conexión)
// Todo lo que necesita datos del propietario o acciones (mensajes, agenda, tareas, negocios, internet, agentes)
// sigue yendo a Claude. Si el modelo no está seguro, responde «[CLAUDE]» y la pregunta pasa a Claude sin decir nada.
// La clave de Groq vive en el Llavero («kratos-groq», scripts/conectar-groq.sh); el modelo local, en .jarvis/local-model.

const OLLAMA = process.env.KRATOS_OLLAMA ?? 'http://127.0.0.1:11434';
const GROQ = process.env.KRATOS_GROQ_URL ?? 'https://api.groq.com/openai/v1';
const MODEL_FILE = path.join(ROOT, '.jarvis', 'local-model');
export const ESCAPE = '[CLAUDE]';

// ---------- Ollama (local) ----------
export function localModel(): string | null {
  if (process.env.KRATOS_LOCAL_MODEL) return process.env.KRATOS_LOCAL_MODEL;   // pruebas o elección manual
  if (process.env.KRATOS_DISABLE_AI === '1') return null;
  try { return fs.readFileSync(MODEL_FILE, 'utf8').trim() || null; } catch { return null; }
}

let up = { ok: false, at: 0 };
async function ollamaAvailable(): Promise<boolean> {
  const model = localModel();
  if (!model) return false;
  if (Date.now() - up.at < 30_000) return up.ok;
  try {
    const r = await fetch(`${OLLAMA}/api/tags`, { signal: AbortSignal.timeout(800) });
    const tags = r.ok ? ((await r.json()) as any).models ?? [] : [];
    up = { ok: tags.some((m: any) => m.name === model || m.model === model), at: Date.now() };
  } catch { up = { ok: false, at: Date.now() }; }
  return up.ok;
}

// ---------- Groq (nube, gratis con límites) ----------
let groqKeyCache: { key: string | null; at: number } = { key: null, at: 0 };
function groqKey(): string | null {
  if (process.env.KRATOS_GROQ_KEY) return process.env.KRATOS_GROQ_KEY;   // pruebas
  if (process.env.KRATOS_DISABLE_AI === '1') return null;
  if (groqKeyCache.key || Date.now() - groqKeyCache.at < 30_000) return groqKeyCache.key;
  try { groqKeyCache = { key: execFileSync('/usr/bin/security', ['find-generic-password', '-s', 'kratos-groq', '-a', 'api', '-w'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim() || null, at: Date.now() }; }
  catch { groqKeyCache = { key: null, at: Date.now() }; }
  return groqKeyCache.key;
}
let groqPausedUntil = 0;   // tras un límite (429) o un fallo, se descansa y responde Ollama

// Modelos de Groq de preferencia (rápidos, buen español, sin razonamiento largo); se elige el primero publicado
const GROQ_PREFERRED = [/llama-4-maverick/, /llama-3\.3-70b-versatile/, /llama-4-scout/, /gpt-oss-120b/, /qwen3/, /llama-3\.1-8b-instant/];
let groqModelCache: { model: string | null; at: number } = { model: null, at: 0 };
async function groqModel(key: string): Promise<string | null> {
  if (process.env.KRATOS_GROQ_MODEL) return process.env.KRATOS_GROQ_MODEL;
  if (groqModelCache.model && Date.now() - groqModelCache.at < 3_600_000) return groqModelCache.model;
  const r = await fetch(`${GROQ}/models`, { headers: { authorization: `Bearer ${key}` }, signal: AbortSignal.timeout(3000) });
  if (!r.ok) throw new Error(`Groq respondió ${r.status}`);
  const ids: string[] = (((await r.json()) as any).data ?? []).map((m: any) => String(m.id));
  const model = GROQ_PREFERRED.map((re) => ids.find((id) => re.test(id))).find(Boolean) ?? null;
  groqModelCache = { model, at: Date.now() };
  return model;
}

export async function localAvailable(): Promise<boolean> {
  return (!!groqKey() && Date.now() > groqPausedUntil) || ollamaAvailable();
}

// ---------- Reparto ----------
// Lo que necesita datos del propietario, herramientas o internet va a Claude (normalizado: minúsculas, sin acentos)
const NEEDS_CLAUDE = /\b(mand\w*|envi\w*|escrib\w*|respond\w*|contest\w*|dile|mensajes?|correos?|email|mail|llam\w*|agenda\w*|alarma|recuerd\w*|recordatorio|avisame|tareas?|delega\w*|negocios?|ventas|ingresos|usuarios|reporte|informe|presupuesto|dinero|gasto|aprobacion\w*|apps?|aplicacion\w*|apple|google play|busca\w*|investiga\w*|internet|noticias?|precio|clima|hoy|ayer|manana|semana|nota|notas|guarda\w*|apunta\w*|anota\w*|plan|estrategia|agentes?|sol|luna|mercurio|venus|marte|jupiter|saturno|codigo|programa\w*|funcion|mejora|diagnostic\w*|falla|ajust\w*|cambia\w*|voz|calidad|preferencia|olvida|claude|contacto|numero|telefono|que hiciste|que hicieron|pendiente\w*|emergencia)\b/;

export async function routeLocal(db: Db, channel: 'texto' | 'voz', text: string): Promise<boolean> {
  const mode = (await getState(db)).cerebro_local ?? 'auto';
  if (mode === 'apagado') return false;
  const t = text.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/^\W*((hey|oye|ey)\W+)?kratos\b\W*/, '');
  if (NEEDS_CLAUDE.test(t) || t.length > (channel === 'voz' ? 400 : 600)) return false;
  return localAvailable();
}

const SYSTEM = (name: string, now: string, channel: string) => `Eres Kratos, el asistente personal de ${name}. Hablas español natural, cercano y con humor seco, como JARVIS. Ahora: ${now}.
${channel === 'voz' ? 'Responde por voz: 1 o 2 frases cortas, sin listas, sin formato y sin emojis.' : 'Responde breve y claro; la primera línea es una frase corta.'} No empieces con el nombre del propietario.
No tienes acceso a sus mensajes, agenda, tareas, negocios, cuentas ni a internet, y no puedes hacer acciones. Si la petición necesita algo de eso, o datos de hoy, o no estás seguro de la respuesta, responde EXACTAMENTE «${ESCAPE}» y nada más. Nunca inventes datos.`;

export type LocalReply = { text: string; spoken: string; model: string; ms: number } | { escalate: true };

// Respuesta en streaming: los trozos van a onToken; se retienen los primeros caracteres hasta saber que no es «[CLAUDE]»
// y se quita el razonamiento interno (<think>…</think>) de los modelos que lo muestran.
export async function localThink(db: Db, onToken: (delta: string) => void, channel: 'texto' | 'voz' = 'voz'): Promise<LocalReply> {
  const started = Date.now();
  const o = await owner(db);
  const history = (await db.query(`SELECT role, content FROM messages ORDER BY id DESC LIMIT 8`)).rows.reverse();
  while (history.length && history[0].role !== 'usuario') history.shift();
  const now = new Date().toLocaleString('es', { dateStyle: 'full', timeStyle: 'short' });
  const messages = [{ role: 'system', content: SYSTEM(o.name, now, channel) },
    ...history.map((m: any) => ({ role: m.role === 'usuario' ? 'user' : 'assistant', content: String(m.content).slice(0, 600) }))];

  let raw = '', text = '', held = '', released = false, sent = false;
  const feed = (delta: string): 'escalate' | void => {
    raw += delta;
    // el razonamiento interno va al principio: se espera a que cierre y no se dice
    const start = raw.trimStart();
    if ('<think>'.startsWith(start) || (start.startsWith('<think>') && !start.includes('</think>'))) return;
    const visible = start.replace(/^<think>[\s\S]*?<\/think>/, '').trimStart();
    const fresh = visible.slice(text.length); text = visible;
    if (!fresh) return;
    if (!released) {
      held += fresh;
      if (held.startsWith('[') && held.trim().length < ESCAPE.length + 2) return;
      if (held.includes(ESCAPE)) return 'escalate';
      released = true; sent = true; onToken(held);
    } else onToken(fresh);
  };
  const finish = async (model: string): Promise<LocalReply> => {
    text = text.trim();
    if (!text || text.includes(ESCAPE)) return { escalate: true };
    if (!released) onToken(held);
    await db.query(`INSERT INTO ai_usage (model, input_tokens, output_tokens, cache_read_tokens, cache_write_tokens, cost_microusd, charged_cents, purpose) VALUES ($1,0,0,0,0,0,0,$2)`,
      [model, `conversación (${channel}, gratis)`]).catch(() => {});
    return { text, spoken: text.split('\n')[0].replace(/[*_#`>]/g, '').slice(0, 300), model, ms: Date.now() - started };
  };

  // 1) Groq
  const key = groqKey();
  if (key && Date.now() > groqPausedUntil) {
    try {
      const model = await groqModel(key);
      if (!model) throw new Error('Groq sin modelos de la lista');
      const r = await fetch(`${GROQ}/chat/completions`, {
        method: 'POST', headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' }, signal: AbortSignal.timeout(20_000),
        body: JSON.stringify({ model, messages, stream: true, temperature: 0.6, max_tokens: channel === 'voz' ? 300 : 900, ...(/gpt-oss/.test(model) ? { reasoning_effort: 'low' } : {}) }),
      });
      if (r.status === 429) { groqPausedUntil = Date.now() + Math.min(600, Number(r.headers.get('retry-after')) || 60) * 1000; throw new Error('Groq: límite gratis alcanzado'); }
      if (!r.ok || !r.body) throw new Error(`Groq respondió ${r.status}`);
      for await (const line of lines(r.body)) {
        if (!line.startsWith('data:')) continue;
        const data = line.slice(5).trim();
        if (data === '[DONE]') break;
        const delta: string = JSON.parse(data).choices?.[0]?.delta?.content ?? '';
        if (delta && feed(delta) === 'escalate') return { escalate: true };
      }
      return await finish(`groq:${model}`);
    } catch (e) {
      if (sent) return await finish('groq (cortado)');   // ya dijo algo: no se repite con otro modelo
      if (Date.now() > groqPausedUntil) groqPausedUntil = Date.now() + 30_000;
      raw = ''; text = ''; held = ''; released = false;
      if (!(await ollamaAvailable())) throw e;
    }
  }

  // 2) Ollama en este Mac
  const model = localModel();
  if (!model) throw new Error('Sin IA rápida disponible');
  const body = (think: boolean) => JSON.stringify({ model, messages, stream: true, keep_alive: '24h', options: { num_ctx: 4096, temperature: 0.6 }, ...(think ? {} : { think: false }) });
  let r = await fetch(`${OLLAMA}/api/chat`, { method: 'POST', body: body(false), signal: AbortSignal.timeout(30_000) });
  if (r.status === 400) r = await fetch(`${OLLAMA}/api/chat`, { method: 'POST', body: body(true), signal: AbortSignal.timeout(30_000) });   // modelos sin opción «think»
  if (!r.ok || !r.body) throw new Error(`Ollama respondió ${r.status}`);
  for await (const line of lines(r.body)) {
    if (!line.trim()) continue;
    const j = JSON.parse(line);
    if (j.error) throw new Error(j.error);
    const delta: string = j.message?.content ?? '';
    if (delta && feed(delta) === 'escalate') return { escalate: true };
  }
  return await finish(`local:${model}`);
}

async function* lines(body: any) {
  const dec = new TextDecoder();
  let buf = '';
  for await (const chunk of body) {
    buf += dec.decode(chunk, { stream: true });
    let nl;
    while ((nl = buf.indexOf('\n')) >= 0) { yield buf.slice(0, nl).replace(/\r$/, ''); buf = buf.slice(nl + 1); }
  }
  if (buf.trim()) yield buf;
}

// Qué cerebro rápido hay ahora (para el diagnóstico y el panel)
export async function fastStatus() {
  const key = groqKey();
  let groq: string | null = null;
  if (key) groq = await groqModel(key).catch(() => null);
  return { groq: key ? (Date.now() < groqPausedUntil ? 'en pausa (límite)' : groq ?? 'sin modelo') : 'sin clave', local: (await ollamaAvailable()) ? localModel() : 'no disponible' };
}

// Precarga el modelo local en memoria al arrancar el servidor: la primera pregunta no espera a cargarlo
export async function warmLocal() {
  const model = localModel();
  if (!model || !(await ollamaAvailable())) return;
  await fetch(`${OLLAMA}/api/generate`, { method: 'POST', body: JSON.stringify({ model, prompt: '', keep_alive: '24h' }), signal: AbortSignal.timeout(120_000) }).catch(() => {});
}
