import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { Db } from '../db.ts';
import { audit } from './state.ts';
import { addAgenda } from './agenda.ts';

// Motor híbrido: el trabajo pesado de los agentes usa la suscripción de Claude del propietario
// (Claude Code en modo automático, `claude -p`), y la voz sigue por la API.
// - Solo lectura e internet: los agentes analizan e investigan, no tocan archivos ni ejecutan programas.
// - Vigila los límites de la suscripción: avisa al acercarse y, si se agota, deja las tareas en cola
//   hasta la hora de reinicio (no pasa a la API por su cuenta).

const CLAUDE = [path.join(os.homedir(), '.local', 'bin', 'claude'), '/opt/homebrew/bin/claude'].find((p) => fs.existsSync(p)) ?? null;
const WORKDIR = path.join(os.homedir(), 'KratosProyectos', '_agentes');   // carpeta vacía: el agente no ve ningún archivo tuyo

export type SubStatus = { status: 'allowed' | 'allowed_warning' | 'rejected' | 'desconocido' | 'sin_sesion'; resetsAt: string | null; type: string | null; at: string;
  usage?: { five_hour?: number; seven_day?: number; five_hour_resets?: string | null; seven_day_resets?: string | null } };

export async function subStatus(db: Db): Promise<SubStatus | null> {
  return (await db.query(`SELECT value FROM system_state WHERE key = 'sub_usage'`)).rows[0]?.value ?? null;
}

async function saveStatus(db: Db, s: SubStatus) {
  const prev = await subStatus(db);
  await db.query(`INSERT INTO system_state (key, value, updated_by) VALUES ('sub_usage', $1, 'suscripcion')
    ON CONFLICT (key) DO UPDATE SET value = $1, updated_at = now(), updated_by = 'suscripcion'`, [JSON.stringify(s)]);
  // Aviso por porcentaje: al pasar del 70 % (ventana de 5 h o semanal) una vez por ventana
  for (const [k, label] of [['five_hour', 'de 5 horas'], ['seven_day', 'semanal']] as const) {
    const now = s.usage?.[k], before = prev?.usage?.[k] ?? 0, resets = s.usage?.[`${k}_resets` as const] ?? null;
    if (now != null && now >= 0.7 && (before < 0.7 || prev?.usage?.[`${k}_resets` as const] !== resets)) {
      const when = resets ? new Date(resets).toLocaleString('es', { weekday: 'long', hour: 'numeric', minute: '2-digit' }) : '';
      await addAgenda(db, { at: new Date(), kind: 'aviso', text: `aviso de consumo: llevas el ${Math.round(now * 100)} % del límite ${label} de tu suscripción de Claude${when ? `; se reinicia el ${when}` : ''}. Si quieres, bajo el ritmo de los agentes.` }, 'suscripción');
    }
  }
  // Aviso hablado una sola vez por cambio de estado (cerca del límite o agotado)
  if (prev?.status === s.status && prev?.resetsAt === s.resetsAt) return;
  const r = s.resetsAt ? new Date(s.resetsAt) : null;
  const sameDay = r && r.toDateString() === new Date().toDateString();
  const when = r ? (sameDay ? r.toLocaleTimeString('es', { hour: 'numeric', minute: '2-digit' }) : r.toLocaleString('es', { weekday: 'long', day: 'numeric', hour: 'numeric', minute: '2-digit' })) : null;
  const kind = s.type === 'seven_day' ? 'semanal' : s.type === 'five_hour' ? 'de 5 horas' : '';
  const at = when;
  if (s.status === 'allowed_warning') {
    await addAgenda(db, { at: new Date(), kind: 'aviso', text: `aviso de consumo: tu suscripción de Claude se está acercando al límite ${kind}${at ? `; se reinicia el ${at}` : ''}. Si quieres, bajo el ritmo de los agentes.` }, 'suscripción');
  } else if (s.status === 'rejected') {
    await addAgenda(db, { at: new Date(), kind: 'aviso', text: `la suscripción de Claude llegó a su límite ${kind}${at ? `, hasta el ${at}` : ''}. Dejo las tareas de los agentes en cola; la conversación sigue funcionando.` }, 'suscripción');
  } else if (s.status === 'sin_sesion') {
    await addAgenda(db, { at: new Date(), kind: 'aviso', text: 'Claude Code no tiene la sesión iniciada en este Mac. Abre Terminal, escribe claude y luego barra login.' }, 'suscripción');
  }
  await audit(db, 'suscripción', 'suscripcion.estado', { status: s.status, resetsAt: s.resetsAt, type: s.type });
}

// ¿Se puede usar ahora? Si está agotada y aún no llegó la hora de reinicio, no.
export async function subscriptionAvailable(db: Db): Promise<{ ok: boolean; until?: Date; reason?: string }> {
  if (process.env.KRATOS_DISABLE_AI === '1') return { ok: false, reason: 'desactivada en pruebas' };
  if (!CLAUDE) return { ok: false, reason: 'Claude Code no está instalado' };
  const s = await subStatus(db);
  // Un «agotado» de hace más de una hora se vuelve a comprobar: el plan pudo reiniciarse antes de lo previsto (o cambiar de plan)
  const fresh = s?.at && Date.now() - new Date(s.at).getTime() < 3_600_000;
  if (s?.status === 'rejected' && fresh && s.resetsAt && new Date(s.resetsAt) > new Date()) return { ok: false, until: new Date(s.resetsAt), reason: 'límite de la suscripción' };
  return { ok: true };
}

// Trabajo autónomo (ciclo del CEO y agentes): usa el plan hasta el tope elegido por el propietario (90 % por defecto)
// de la ventana de 5 horas o de la semanal, y entonces espera al reinicio. La conversación con el propietario no tiene este tope.
export async function autonomyWindow(db: Db): Promise<{ ok: boolean; until?: Date; reason?: string }> {
  const av = await subscriptionAvailable(db);
  if (!av.ok) return av;
  const cap = Number((await db.query(`SELECT value FROM system_state WHERE key = 'autonomy_usage_cap'`)).rows[0]?.value ?? 0.9);
  const u = (await subStatus(db))?.usage;
  for (const k of ['seven_day', 'five_hour'] as const) {
    const resets = u?.[`${k}_resets` as const];
    if ((u?.[k] ?? 0) >= cap && resets && new Date(resets) > new Date())
      return { ok: false, until: new Date(resets), reason: `uso del plan al ${Math.round((u?.[k] ?? 0) * 100)} % (${k === 'five_hour' ? 'ventana de 5 h' : 'semanal'}): espera al reinicio` };
  }
  return { ok: true };
}

const toIso = (v: unknown): string | null => {
  if (v == null) return null;
  const n = Number(v);
  const d = Number.isFinite(n) ? new Date(n < 1e12 ? n * 1000 : n) : new Date(String(v));
  return Number.isNaN(+d) ? null : d.toISOString();
};

// Interpreta las líneas NDJSON de `--output-format stream-json`
export function parseStream(out: string): { text: string; costUsd: number | null; limit: SubStatus | null; notLoggedIn: boolean; isError: boolean } {
  let text = '', costUsd: number | null = null, limit: SubStatus | null = null, isError = false;
  for (const line of out.split('\n')) {
    const i = line.indexOf('{');
    if (i < 0) continue;
    let e: any; try { e = JSON.parse(line.slice(i)); } catch { continue; }
    if (e.type === 'rate_limit_event') {
      const r = e.rate_limit_info ?? e;
      const w = r.unifiedWindows ?? {};
      limit = { usage: { five_hour: w.five_hour?.utilization, seven_day: w.seven_day?.utilization, five_hour_resets: toIso(w.five_hour?.resetsAt), seven_day_resets: toIso(w.seven_day?.resetsAt) },
        status: ['allowed', 'allowed_warning', 'rejected'].includes(r.status) ? r.status : 'desconocido', resetsAt: toIso(r.resetsAt ?? r.resets_at), type: r.rateLimitType ?? r.rate_limit_type ?? null, at: new Date().toISOString() };
    } else if (e.type === 'result') {
      text = String(e.result ?? text); costUsd = Number.isFinite(Number(e.total_cost_usd)) ? Number(e.total_cost_usd) : null; isError = !!e.is_error;
    }
  }
  return { text, costUsd, limit, notLoggedIn: /Not logged in|Please run \/login/i.test(out), isError };
}

// Ejecuta un encargo de análisis con la suscripción. Devuelve el texto final.
export async function runWithSubscription(db: Db, opts: { system: string; prompt: string; model?: string; timeoutMs?: number }): Promise<{ text: string; costUsd: number | null }> {
  if (!CLAUDE) throw new Error('Claude Code no está instalado');
  fs.mkdirSync(WORKDIR, { recursive: true });
  const user = os.userInfo().username;
  const env = { HOME: os.homedir(), USER: user, LOGNAME: user, TMPDIR: os.tmpdir(), LANG: 'es_ES.UTF-8', ENABLE_TOOL_SEARCH: 'false',
    PATH: `${path.dirname(CLAUDE)}:${path.dirname(process.execPath)}:/opt/homebrew/bin:/usr/bin:/bin` };   // sin la clave de la API: así cobra a la suscripción
  const args = ['-p', '--output-format', 'stream-json', '--verbose', '--model', opts.model ?? 'opus',
    '--append-system-prompt', opts.system,
    '--allowedTools', 'WebSearch', 'WebFetch', '--disallowedTools', 'Bash', 'Edit', 'Write', 'NotebookEdit',
    '--strict-mcp-config', '--no-session-persistence'];
  const out = await new Promise<string>((resolve) => {
    const p = spawn(CLAUDE, args, { cwd: WORKDIR, env, stdio: ['pipe', 'pipe', 'pipe'] });
    let buf = '';
    const timer = setTimeout(() => p.kill('SIGTERM'), opts.timeoutMs ?? 15 * 60_000);
    p.stdout.on('data', (d) => { buf += d; });
    p.stderr.on('data', (d) => { buf += d; });
    p.on('close', () => { clearTimeout(timer); resolve(buf); });
    p.stdin.end(opts.prompt);
  });
  const r = parseStream(out);
  if (r.notLoggedIn) {
    await saveStatus(db, { status: 'sin_sesion', resetsAt: null, type: null, at: new Date().toISOString() });
    throw new Error('Claude Code no tiene la sesión iniciada: abre Terminal, escribe «claude» y luego «/login»');
  }
  if (r.limit) await saveStatus(db, r.limit);
  if (r.limit?.status === 'rejected') throw Object.assign(new Error('Límite de la suscripción alcanzado'), { retryAt: r.limit.resetsAt });
  if (!r.text || r.isError) throw new Error(`Claude Code no completó el encargo${r.text ? `: ${r.text.slice(0, 200)}` : ''}`);
  return { text: r.text, costUsd: r.costUsd };
}

// Conversación y CEO con la suscripción: Claude Code con las herramientas de KRATOS (servidor MCP) y respuesta por partes.
// onText recibe el texto a medida que se escribe (para que la voz empiece antes de terminar).
export async function runAgentWithSubscription(db: Db, opts: { system: string; prompt: string; model: string; toolset: 'voz' | 'texto' | 'ceo'; lastUser?: string;
  web?: boolean; timeoutMs?: number; onText?: (delta: string) => void }): Promise<{ text: string; effects: Record<string, unknown>; tools: string[] }> {
  if (!CLAUDE) throw new Error('Claude Code no está instalado');
  fs.mkdirSync(WORKDIR, { recursive: true });
  const id = Math.random().toString(36).slice(2);
  const effectsFile = path.join(os.tmpdir(), `kratos-efectos-${id}.json`), mcpFile = path.join(os.tmpdir(), `kratos-mcp-${id}.json`);
  const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..', '..');
  fs.writeFileSync(mcpFile, JSON.stringify({ mcpServers: { kratos: { command: process.execPath, args: [path.join(root, 'src', 'mcp-kratos.ts')],
    env: { KRATOS_TOOLSET: opts.toolset, KRATOS_LAST_USER: (opts.lastUser ?? '').slice(0, 2000), KRATOS_EFFECTS_FILE: effectsFile, JARVIS_DB: process.env.JARVIS_DB ?? 'jarvis' } } } }), { mode: 0o600 });
  const user = os.userInfo().username;
  const env = { HOME: os.homedir(), USER: user, LOGNAME: user, TMPDIR: os.tmpdir(), LANG: 'es_ES.UTF-8', ENABLE_TOOL_SEARCH: 'false',
    PATH: `${path.dirname(CLAUDE)}:${path.dirname(process.execPath)}:/opt/homebrew/bin:/usr/bin:/bin` };   // sin clave de API: cobra a la suscripción
  const args = ['-p', '--output-format', 'stream-json', '--verbose', '--include-partial-messages', '--model', opts.model,
    '--mcp-config', mcpFile, '--strict-mcp-config', '--allowedTools', 'mcp__kratos', ...(opts.web ? ['WebSearch', 'WebFetch'] : []),
    '--disallowedTools', 'Bash', 'Edit', 'Write', 'Read', 'Glob', 'Grep', 'Task', 'NotebookEdit', ...(opts.web ? [] : ['WebSearch', 'WebFetch']),
    '--append-system-prompt', opts.system, '--no-session-persistence'];
  let out = '', pending = '';
  const tools: string[] = [];
  await new Promise<void>((resolve) => {
    const p = spawn(CLAUDE, args, { cwd: WORKDIR, env, stdio: ['pipe', 'pipe', 'pipe'] });
    const timer = setTimeout(() => p.kill('SIGTERM'), opts.timeoutMs ?? 120_000);
    p.stdout.on('data', (d) => {
      out += d; pending += d;
      let nl: number;
      while ((nl = pending.indexOf('\n')) >= 0) {
        const line = pending.slice(0, nl); pending = pending.slice(nl + 1);
        let e: any; try { e = JSON.parse(line); } catch { continue; }
        if (e.type === 'stream_event' && e.event?.type === 'content_block_delta' && e.event.delta?.type === 'text_delta') opts.onText?.(e.event.delta.text);
        if (e.type === 'assistant') for (const c of e.message?.content ?? []) if (c.type === 'tool_use') tools.push(c.name);
      }
    });
    p.stderr.on('data', (d) => { out += d; });
    p.on('close', () => { clearTimeout(timer); resolve(); });
    p.stdin.end(opts.prompt);
  });
  let effects: Record<string, unknown> = {};
  try { effects = JSON.parse(fs.readFileSync(effectsFile, 'utf8')); } catch {}
  for (const f of [effectsFile, mcpFile]) fs.rmSync(f, { force: true });
  const r = parseStream(out);
  if (r.notLoggedIn) { await saveStatus(db, { status: 'sin_sesion', resetsAt: null, type: null, at: new Date().toISOString() }); throw new Error('Claude Code no tiene la sesión iniciada'); }
  if (r.limit) await saveStatus(db, r.limit);
  if (r.limit?.status === 'rejected') throw Object.assign(new Error('Límite de la suscripción alcanzado'), { retryAt: r.limit.resetsAt });
  if (!r.text || r.isError) throw new Error(`Claude Code no respondió${r.text ? `: ${r.text.slice(0, 160)}` : ''}`);
  return { text: r.text, effects, tools };
}
