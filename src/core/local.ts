import fs from 'node:fs';
import path from 'node:path';
import { ROOT } from '../config.ts';
import type { Db } from '../db.ts';
import { getState } from './state.ts';
import { owner } from './agenda.ts';

// Cerebro local (Ollama, modelo de código abierto en este Mac): gratis, sin internet y con respuesta casi inmediata.
// Se usa para lo sencillo por voz (charla, preguntas generales, explicaciones). Todo lo que necesita datos
// del propietario o herramientas (mensajes, agenda, tareas, negocios, internet, agentes) sigue yendo a Claude.
// El modelo lo elige scripts/instalar-ia-local.sh según la memoria del Mac y lo deja en .jarvis/local-model.

const OLLAMA = process.env.KRATOS_OLLAMA ?? 'http://127.0.0.1:11434';
const MODEL_FILE = path.join(ROOT, '.jarvis', 'local-model');
export const ESCAPE = '[CLAUDE]';

export function localModel(): string | null {
  if (process.env.KRATOS_LOCAL_MODEL) return process.env.KRATOS_LOCAL_MODEL;   // pruebas o elección manual
  if (process.env.KRATOS_DISABLE_AI === '1') return null;
  try { return fs.readFileSync(MODEL_FILE, 'utf8').trim() || null; } catch { return null; }
}

let up = { ok: false, at: 0 };
export async function localAvailable(): Promise<boolean> {
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

// Lo que necesita datos del propietario, herramientas o internet va a Claude (normalizado: minúsculas, sin acentos)
const NEEDS_CLAUDE = /\b(mand\w*|envi\w*|escrib\w*|respond\w*|contest\w*|dile|mensajes?|correos?|email|mail|llam\w*|agenda\w*|alarma|recuerd\w*|recordatorio|avisame|tareas?|delega\w*|negocios?|ventas|ingresos|usuarios|reporte|informe|presupuesto|dinero|gasto|aprobacion\w*|apps?|aplicacion\w*|apple|google play|busca\w*|investiga\w*|internet|noticias?|precio|clima|hoy|ayer|manana|semana|nota|notas|guarda\w*|apunta\w*|anota\w*|plan|estrategia|agentes?|sol|luna|mercurio|venus|marte|jupiter|saturno|codigo|programa\w*|funcion|mejora|diagnostic\w*|falla|ajust\w*|cambia\w*|voz|calidad|preferencia|olvida|claude|contacto|numero|telefono|que hiciste|que hicieron|pendiente\w*|emergencia)\b/;

export async function routeLocal(db: Db, channel: 'texto' | 'voz', text: string): Promise<boolean> {
  if (channel !== 'voz') return false;
  const mode = (await getState(db)).cerebro_local ?? 'auto';
  if (mode === 'apagado') return false;
  const t = text.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/^\W*((hey|oye|ey)\W+)?kratos\b\W*/, '');
  if (NEEDS_CLAUDE.test(t) || t.length > 400) return false;
  return localAvailable();
}

const SYSTEM = (name: string, now: string) => `Eres Kratos, el asistente personal de ${name}. Hablas español natural, cercano y con humor seco, como JARVIS. Ahora: ${now}.
Responde por voz: 1 o 2 frases cortas, sin listas, sin formato y sin emojis. No empieces con el nombre del propietario.
No tienes acceso a sus mensajes, agenda, tareas, negocios, cuentas ni a internet, y no puedes hacer acciones. Si la petición necesita algo de eso, o datos de hoy, o no estás seguro de la respuesta, responde EXACTAMENTE «${ESCAPE}» y nada más. Nunca inventes datos.`;

export type LocalReply = { text: string; spoken: string; model: string; ms: number } | { escalate: true };

// Respuesta en streaming: las frases se entregan a onToken; si el modelo pide ayuda («[CLAUDE]»), no se dice nada
export async function localThink(db: Db, onToken: (delta: string) => void, signal?: AbortSignal): Promise<LocalReply> {
  const model = localModel()!;
  const started = Date.now();
  const o = await owner(db);
  const history = (await db.query(`SELECT role, content FROM messages ORDER BY id DESC LIMIT 8`)).rows.reverse();
  while (history.length && history[0].role !== 'usuario') history.shift();
  const now = new Date().toLocaleString('es', { dateStyle: 'full', timeStyle: 'short' });
  const messages = [{ role: 'system', content: SYSTEM(o.name, now) },
    ...history.map((m: any) => ({ role: m.role === 'usuario' ? 'user' : 'assistant', content: String(m.content).slice(0, 600) }))];
  const body = (think: boolean) => JSON.stringify({ model, messages, stream: true, keep_alive: '24h', options: { num_ctx: 4096, temperature: 0.6 }, ...(think ? {} : { think: false }) });
  let r = await fetch(`${OLLAMA}/api/chat`, { method: 'POST', body: body(false), signal: signal ?? AbortSignal.timeout(30_000) });
  if (r.status === 400) r = await fetch(`${OLLAMA}/api/chat`, { method: 'POST', body: body(true), signal: signal ?? AbortSignal.timeout(30_000) });   // modelos sin opción «think»
  if (!r.ok || !r.body) throw new Error(`Ollama respondió ${r.status}`);
  let text = '', held = '', released = false, buf = '';
  const dec = new TextDecoder();
  for await (const chunk of r.body as any) {
    buf += dec.decode(chunk, { stream: true });
    let nl;
    while ((nl = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, nl); buf = buf.slice(nl + 1);
      if (!line.trim()) continue;
      const j = JSON.parse(line);
      if (j.error) throw new Error(j.error);
      const delta: string = j.message?.content ?? '';
      if (!delta) continue;
      text += delta;
      // se retienen los primeros caracteres hasta saber que no es «[CLAUDE]»
      if (!released) {
        held += delta;
        if (held.trimStart().startsWith('[') && held.trim().length < ESCAPE.length + 2) continue;
        if (held.includes(ESCAPE)) return { escalate: true };
        released = true; onToken(held);
      } else onToken(delta);
    }
  }
  text = text.trim();
  if (!text || text.includes(ESCAPE)) return { escalate: true };
  if (!released) onToken(held);
  await db.query(`INSERT INTO ai_usage (model, input_tokens, output_tokens, cache_read_tokens, cache_write_tokens, cost_microusd, charged_cents, purpose) VALUES ($1,0,0,0,0,0,0,'conversación (voz, local)')`, [`local:${model}`]).catch(() => {});
  return { text, spoken: text.split('\n')[0].replace(/[*_#`>]/g, '').slice(0, 300), model, ms: Date.now() - started };
}

// Precarga el modelo en memoria al arrancar el servidor: la primera pregunta no espera a cargarlo
export async function warmLocal() {
  const model = localModel();
  if (!model || !(await localAvailable())) return;
  await fetch(`${OLLAMA}/api/generate`, { method: 'POST', body: JSON.stringify({ model, prompt: '', keep_alive: '24h' }), signal: AbortSignal.timeout(120_000) }).catch(() => {});
}
