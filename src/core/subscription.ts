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

export type SubStatus = { status: 'allowed' | 'allowed_warning' | 'rejected' | 'desconocido' | 'sin_sesion'; resetsAt: string | null; type: string | null; at: string };

export async function subStatus(db: Db): Promise<SubStatus | null> {
  return (await db.query(`SELECT value FROM system_state WHERE key = 'sub_usage'`)).rows[0]?.value ?? null;
}

async function saveStatus(db: Db, s: SubStatus) {
  const prev = await subStatus(db);
  await db.query(`INSERT INTO system_state (key, value, updated_by) VALUES ('sub_usage', $1, 'suscripcion')
    ON CONFLICT (key) DO UPDATE SET value = $1, updated_at = now(), updated_by = 'suscripcion'`, [JSON.stringify(s)]);
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
  if (s?.status === 'rejected' && s.resetsAt && new Date(s.resetsAt) > new Date()) return { ok: false, until: new Date(s.resetsAt), reason: 'límite de la suscripción' };
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
      limit = { status: ['allowed', 'allowed_warning', 'rejected'].includes(r.status) ? r.status : 'desconocido', resetsAt: toIso(r.resetsAt ?? r.resets_at), type: r.rateLimitType ?? r.rate_limit_type ?? null, at: new Date().toISOString() };
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
  const env = { HOME: os.homedir(), USER: user, LOGNAME: user, TMPDIR: os.tmpdir(), LANG: 'es_ES.UTF-8',
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
