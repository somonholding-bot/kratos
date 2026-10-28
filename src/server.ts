import http from 'node:http';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { ROOT, config } from './config.ts';
import { createPool, type Db } from './db.ts';
import { migrate } from './migrate.ts';
import { consumeLoginCode, safeEqual, sessionToken } from './auth.ts';
import { audit, emergencyStop, getState, heartbeat, resumeFromEmergency, setAutomationsPaused } from './core/state.ts';
import { cancelTask, createTask } from './core/tasks.ts';
import { decideApproval } from './core/approvals.ts';
import { handleMessage } from './core/chat.ts';
import { cleanTmp, transcribe, transcribeWake, voiceAvailable } from './voice.ts';
import { aiStatus } from './core/brain.ts';
import { ensureVault, VAULT } from './core/vault.ts';

const PUBLIC = path.join(ROOT, 'public');
// Three.js se sirve desde node_modules (versión fijada en package.json); solo build/ y examples/jsm/.
const THREE_DIR = path.join(ROOT, 'node_modules', 'three');
// Los import maps deben ir en línea: se permiten por su hash exacto, no con 'unsafe-inline'.
const IMPORTMAP_HASHES = (() => {
  const hashes = new Set<string>();
  const walk = (d: string) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    const p = path.join(d, e.name);
    if (e.isDirectory()) walk(p);
    else if (e.name.endsWith('.html')) for (const m of fs.readFileSync(p, 'utf8').matchAll(/<script type="importmap">([\s\S]*?)<\/script>/g)) {
      hashes.add(`'sha256-${crypto.createHash('sha256').update(m[1]).digest('base64')}'`);
    } } };
  walk(PUBLIC);
  return [...hashes].join(' ');
})();
const MIME: Record<string, string> = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.webp': 'image/webp', '.jpg': 'image/jpeg' };
const ALLOWED_HOSTS = new Set([`127.0.0.1:${config.port}`, `localhost:${config.port}`]);

type Route = (db: Db, body: any, params: string[]) => Promise<unknown>;

const q = async (db: Db, sql: string, args: unknown[] = []) => (await db.query(sql, args)).rows;

const GET: Record<string, Route> = {
  '/api/overview': async (db) => {
    const [state, hb, counts, approvals, biz, cost] = await Promise.all([
      getState(db),
      q(db, `SELECT process, pid, at, info, extract(epoch FROM now() - at)::int AS age FROM heartbeats`),
      q(db, `SELECT status, count(*)::int AS n FROM tasks GROUP BY status`),
      q(db, `SELECT count(*)::int AS n, max(created_at) AS latest FROM approvals WHERE status = 'pendiente'`),
      q(db, `SELECT b.id, b.name, b.is_demo, b.goals, (SELECT count(*)::int FROM products p WHERE p.business_id = b.id) AS products,
               (SELECT count(*)::int FROM tasks t WHERE t.business_id = b.id AND t.status IN ('pendiente','en_ejecucion','esperando_ia','esperando_permiso')) AS open_tasks
             FROM businesses b ORDER BY b.is_demo, b.id`),
      q(db, `SELECT coalesce(sum(limit_cents),0)::bigint AS assigned, coalesce(sum(spent_cents),0)::bigint AS spent FROM budget_accounts`),
    ]);
    const running = await q(db, `SELECT id, title, owner_function FROM tasks WHERE status = 'en_ejecucion'`);
    return { state, heartbeats: hb, counts, pendingApprovals: approvals[0].n, latestApprovalAt: approvals[0].latest, businesses: biz, budget: cost[0], running, ai: await aiStatus(db), vault: VAULT, now: new Date() };
  },
  '/api/businesses': async (db) => ({
    businesses: await q(db, `SELECT * FROM businesses ORDER BY is_demo, id`),
    products: await q(db, `SELECT * FROM products ORDER BY id`),
    knowledge: await q(db, `SELECT * FROM knowledge_items ORDER BY created_at DESC LIMIT 100`),
  }),
  '/api/tasks': async (db) => q(db, `SELECT t.*, b.name AS business FROM tasks t JOIN businesses b ON b.id = t.business_id ORDER BY
      CASE t.status WHEN 'en_ejecucion' THEN 0 WHEN 'esperando_permiso' THEN 1 WHEN 'pendiente' THEN 2 WHEN 'esperando_ia' THEN 3 ELSE 4 END, t.priority, t.run_at DESC LIMIT 200`),
  '/api/functions': async (db) => q(db, `SELECT f.*, (SELECT count(*)::int FROM tasks t WHERE t.owner_function = f.id AND t.status IN ('pendiente','en_ejecucion','esperando_ia')) AS open_tasks FROM agent_functions f`),
  '/api/agents': async (db) => q(db, `SELECT f.id, f.name, f.symbol, f.color, f.purpose, f.deliverables, f.prohibited, f.charter,
      (SELECT json_build_object('id', t.id, 'title', t.title, 'status', t.status, 'since', t.updated_at) FROM tasks t
         WHERE t.owner_function = f.id AND t.status IN ('en_ejecucion','esperando_permiso','pendiente','esperando_ia')
         ORDER BY (t.status = 'en_ejecucion') DESC, t.priority, t.run_at LIMIT 1) AS current_task,
      (SELECT json_build_object('id', t.id, 'title', t.title, 'at', t.updated_at, 'result', t.result) FROM tasks t
         WHERE t.owner_function = f.id AND t.status = 'completada' ORDER BY t.updated_at DESC LIMIT 1) AS last_result
    FROM agent_functions f ORDER BY f.id`),
  '/api/schedule': async (db) => q(db, `SELECT id, title, type, run_at, recurrence_minutes, status, owner_function FROM tasks
      WHERE status IN ('pendiente','esperando_ia','esperando_permiso') ORDER BY run_at LIMIT 100`),
  '/api/content': async (db) => ({ pieces: await q(db, `SELECT * FROM content_pieces ORDER BY id DESC`), experiments: await q(db, `SELECT * FROM experiments ORDER BY id DESC`) }),
  '/api/budget': async (db) => ({ accounts: await q(db, `SELECT * FROM budget_accounts ORDER BY id`), movements: await q(db, `SELECT * FROM budget_movements ORDER BY id DESC LIMIT 100`) }),
  '/api/metrics': async (db) => q(db, `SELECT m.*, b.name AS business, p.name AS product FROM metrics m JOIN businesses b ON b.id = m.business_id LEFT JOIN products p ON p.id = m.product_id ORDER BY m.observed_at DESC`),
  '/api/connections': async (db) => q(db, `SELECT * FROM connections ORDER BY id`),
  '/api/approvals': async (db) => q(db, `SELECT * FROM approvals ORDER BY (status = 'pendiente') DESC, id DESC LIMIT 100`),
  '/api/audit': async (db) => q(db, `SELECT * FROM audit_log ORDER BY id DESC LIMIT 300`),
  '/api/voice/status': async (db) => ({
    ...voiceAvailable(),
    processing: 'Transcripción local con whisper.cpp (large-v3-turbo q5_0). Voz de respuesta: voces del sistema macOS en el navegador.',
    recordingsStored: false,
    recent: await q(db, `SELECT at, audio_ms, stt_ms, think_ms, tts_start_ms, outcome FROM voice_metrics ORDER BY id DESC LIMIT 20`),
    summary: (await q(db, `SELECT count(*)::int AS n,
        percentile_cont(0.5) WITHIN GROUP (ORDER BY stt_ms)::int AS stt_p50,
        percentile_cont(0.5) WITHIN GROUP (ORDER BY think_ms)::int AS think_p50,
        percentile_cont(0.5) WITHIN GROUP (ORDER BY tts_start_ms)::int AS tts_p50
      FROM voice_metrics WHERE outcome = 'ok' AND at > now() - interval '30 days'`))[0],
  }),
  '/api/ai/status': async (db) => ({ ...(await aiStatus(db)), vault: VAULT,
    recent: await q(db, `SELECT at, model, input_tokens, output_tokens, cache_read_tokens, cost_microusd, charged_cents, purpose FROM ai_usage ORDER BY id DESC LIMIT 20`) }),
  '/api/messages': async (db) => (await q(db, `SELECT * FROM messages ORDER BY id DESC LIMIT 60`)).reverse(),
};

const POST: Record<string, Route> = {
  '/api/agents/task': async (db, b) => {
    const state = await getState(db);
    if (state.emergency_stop) throw new HttpError(409, 'KRATOS está detenido por la parada de emergencia');
    const agentId = String(b.agentId ?? '').toLowerCase();
    const agent = (await db.query(`SELECT id, name, deliverables FROM agent_functions WHERE id = $1 AND id <> 'kratos'`, [agentId])).rows[0];
    if (!agent) throw new HttpError(400, 'Especialista no válido');
    const businessId = Number(b.businessId);
    const business = (await db.query(`SELECT id FROM businesses WHERE id = $1`, [businessId])).rows[0];
    if (!business) throw new HttpError(400, 'Negocio no válido');
    const productId = b.productId == null || b.productId === '' ? null : Number(b.productId);
    if (productId && !(await db.query(`SELECT 1 FROM products WHERE id = $1 AND business_id = $2`, [productId, businessId])).rows[0]) throw new HttpError(400, 'Producto no válido para este negocio');
    const objective = String(b.objective ?? '').trim().slice(0, 2000);
    if (objective.length < 5) throw new HttpError(400, 'Describe el objetivo con un poco más de detalle');
    const title = String(b.title ?? objective).trim().slice(0, 140);
    const requestId = String(b.requestId ?? '');
    if (!/^[0-9a-f-]{20,64}$/i.test(requestId)) throw new HttpError(400, 'Identificador de solicitud no válido');
    const ai = await aiStatus(db);
    const { task } = await createTask(db, {
      businessId, productId, ownerFunction: agentId, type: 'agente', title, objective,
      priority: Math.min(5, Math.max(1, Number(b.priority) || 3)),
      inputs: { origin: 'universo', requestedAt: new Date().toISOString() },
      expectedResult: (agent.deliverables ?? []).join(', ') || `Entregable de ${agent.name}`,
      verification: String(b.verification ?? 'Revisión del propietario en KRATOS').trim().slice(0, 500),
      status: ai.active ? 'pendiente' : 'esperando_ia',
      idempotencyKey: `universo:${requestId}`,
      createdBy: 'propietario (universo)',
    });
    return { task: { id: task.id, title: task.title, status: task.status, ownerFunction: task.owner_function }, aiActive: ai.active };
  },
  '/api/chat': async (db, b) => {
    if (typeof b.text !== 'string' || !b.text.trim()) throw new HttpError(400, 'Texto vacío');
    return handleMessage(db, b.text, b.channel === 'voz' ? 'voz' : 'texto');
  },
  '/api/voice/latency': async (db, b) => {
    const n = (v: unknown) => (Number.isFinite(Number(v)) && Number(v) >= 0 && Number(v) < 600_000 ? Math.round(Number(v)) : null);
    await db.query(`UPDATE voice_metrics SET think_ms = $2, tts_start_ms = $3 WHERE id = $1`, [Number(b.metricId), n(b.thinkMs), n(b.ttsStartMs)]);
    return { ok: true };
  },
  '/api/voice/heartbeat': async (db, b) => {
    await heartbeat(db, 'escucha', { listening: b.listening === true, muted: b.muted === true });
    return { ok: true };
  },
  '/api/emergency-stop': async (db) => emergencyStop(db, 'propietario (panel)'),
  '/api/resume': async (db) => { await resumeFromEmergency(db, 'propietario (panel)'); return { ok: true }; },
  '/api/automations': async (db, b) => { await setAutomationsPaused(db, !!b.paused, 'propietario (panel)'); return { ok: true }; },
  '/api/tasks/:id/cancel': async (db, _b, [id]) => ({ ok: await cancelTask(db, Number(id), 'propietario (panel)') }),
  '/api/approvals/:id': async (db, b, [id]) => decideApproval(db, Number(id), b.approve === true, 'panel'),
  '/api/businesses': async (db, b) => {
    const name = String(b.name ?? '').trim().slice(0, 120);
    const product = String(b.productName ?? '').trim().slice(0, 120);
    if (!name || !product) throw new HttpError(400, 'Faltan nombre del negocio o del producto');
    const biz = (await db.query(`INSERT INTO businesses (name) VALUES ($1) RETURNING id`, [name])).rows[0];
    const platforms = String(b.platforms ?? '').split(',').map((s) => s.trim()).filter(Boolean);
    const markets = String(b.markets ?? '').split(',').map((s) => s.trim()).filter(Boolean);
    const p = (await db.query(`INSERT INTO products (business_id, name, platforms, audience, markets, revenue_model) VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`,
      [biz.id, product, platforms, b.audience || null, markets, b.revenueModel || null])).rows[0];
    for (const metric of ['instalaciones', 'activacion', 'retencion_d7', 'retencion_d30', 'compras', 'ingresos_netos']) {
      await db.query(`INSERT INTO metrics (business_id, product_id, metric, value, source, observed_at) VALUES ($1,$2,$3,NULL,'Sin conexión: desconocido',now())`, [biz.id, p.id, metric]);
    }
    await audit(db, 'propietario (panel)', 'negocio.creado', { name, product }, biz.id);
    return { businessId: biz.id, productId: p.id };
  },
};

class HttpError extends Error {
  status: number;
  constructor(status: number, message: string) { super(message); this.status = status; }
}

function match(table: Record<string, Route>, url: string): [Route, string[]] | null {
  for (const [pattern, fn] of Object.entries(table)) {
    const re = new RegExp('^' + pattern.replace(/:[a-z]+/g, '(\\d+)') + '$');
    const m = url.match(re);
    if (m) return [fn, m.slice(1)];
  }
  return null;
}

function send(res: http.ServerResponse, status: number, body: unknown, headers: Record<string, string> = {}) {
  const data = typeof body === 'string' ? body : JSON.stringify(body);
  res.writeHead(status, {
    'content-type': typeof body === 'string' ? 'text/html; charset=utf-8' : 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
    'content-security-policy': `default-src 'self'; script-src 'self' ${IMPORTMAP_HASHES}; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; media-src 'self' blob:; connect-src 'self'`,
    ...headers,
  });
  res.end(data);
}

function readBody(req: http.IncomingMessage): Promise<any> {
  return new Promise((resolve, reject) => {
    let size = 0; const chunks: Buffer[] = [];
    req.on('data', (c) => { size += c.length; if (size > 100_000) { reject(new HttpError(413, 'Demasiado grande')); req.destroy(); } else chunks.push(c); });
    req.on('end', () => { try { resolve(chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {}); } catch { reject(new HttpError(400, 'JSON inválido')); } });
  });
}

function readRaw(req: http.IncomingMessage, limit: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    let size = 0; const chunks: Buffer[] = [];
    req.on('data', (c) => { size += c.length; if (size > limit) { reject(new HttpError(413, 'Audio demasiado largo')); req.destroy(); } else chunks.push(c); });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

function cookie(req: http.IncomingMessage, name: string) {
  return (req.headers.cookie ?? '').split(';').map((s) => s.trim().split('=')).find(([k]) => k === name)?.[1] ?? '';
}

export function createServer(db: Db) {
  const token = sessionToken();
  return http.createServer(async (req, res) => {
    try {
      // Protección frente a DNS rebinding: solo hosts locales exactos.
      if (!ALLOWED_HOSTS.has(req.headers.host ?? '')) return send(res, 421, { error: 'Host no permitido' });
      const url = new URL(req.url ?? '/', `http://${req.headers.host}`);

      if (url.pathname === '/api/health') {
        const hb = await q(db, `SELECT process, extract(epoch FROM now() - at)::int AS age FROM heartbeats`);
        return send(res, 200, { ok: true, heartbeats: hb });
      }
      if (url.pathname === '/login') {
        if (consumeLoginCode(url.searchParams.get('c') ?? '')) {
          return send(res, 302, '', { location: '/', 'set-cookie': `jarvis=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=2592000` });
        }
        return send(res, 401, page('Código no válido o caducado. Ejecuta <code>npm run open</code> en la carpeta de Kratos (~/Jarvis).'));
      }
      if (!safeEqual(cookie(req, 'jarvis'), token)) {
        if (url.pathname.startsWith('/api/')) return send(res, 401, { error: 'Sesión requerida' });
        return send(res, 401, page('Kratos está activo. Para entrar ejecuta <code>npm run open</code> en la carpeta de Kratos (~/Jarvis).'));
      }

      if (req.method === 'GET' && url.pathname.startsWith('/api/')) {
        const m = match(GET, url.pathname);
        if (!m) return send(res, 404, { error: 'No existe' });
        return send(res, 200, await m[0](db, {}, m[1]));
      }
      if (req.method === 'POST' && url.pathname.startsWith('/api/')) {
        // CSRF: exige JSON y, si hay Origin, que sea local.
        const origin = req.headers.origin;
        if (origin && !ALLOWED_HOSTS.has(origin.replace(/^https?:\/\//, ''))) return send(res, 403, { error: 'Origen no permitido' });
        if (url.pathname === '/api/voice/transcribe') {
          if (req.headers['content-type'] !== 'audio/wav') return send(res, 415, { error: 'Se requiere audio/wav' });
          const wav = await readRaw(req, 1_200_000); // ~37 s a 16 kHz mono
          const abort = new AbortController();
          res.on('close', () => { if (!res.writableEnded) abort.abort(); }); // el panel canceló
          try {
            if (url.searchParams.get('mode') === 'wake') return send(res, 200, await transcribeWake(db, wav, abort.signal));
            return send(res, 200, await transcribe(db, wav, abort.signal));
          }
          catch (e: any) { throw new HttpError(400, e.message); }
        }
        if (!(req.headers['content-type'] ?? '').includes('application/json')) return send(res, 415, { error: 'Se requiere JSON' });
        const m = match(POST, url.pathname);
        if (!m) return send(res, 404, { error: 'No existe' });
        return send(res, 200, await m[0](db, await readBody(req), m[1]));
      }
      if (req.method === 'GET') {
        const rel = url.pathname === '/' ? 'index.html' : url.pathname.endsWith('/') ? url.pathname.slice(1) + 'index.html' : url.pathname.slice(1);
        const vendor = rel.startsWith('vendor/three/');
        const base = vendor ? THREE_DIR : PUBLIC;
        const file = vendor ? path.join(THREE_DIR, path.normalize(rel.slice('vendor/three/'.length))) : path.join(PUBLIC, path.normalize(rel));
        if (vendor && !(file.startsWith(path.join(THREE_DIR, 'build')) || file.startsWith(path.join(THREE_DIR, 'examples', 'jsm')))) return send(res, 404, { error: 'No existe' });
        if (!file.startsWith(base) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) return send(res, 404, { error: 'No existe' });
        res.writeHead(200, { 'content-type': MIME[path.extname(file)] ?? 'application/octet-stream', 'cache-control': 'no-store',
          'content-security-policy': `default-src 'self'; script-src 'self' ${IMPORTMAP_HASHES}; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; media-src 'self' blob:; connect-src 'self'`, 'x-content-type-options': 'nosniff' });
        return fs.createReadStream(file).pipe(res);
      }
      send(res, 405, { error: 'Método no permitido' });
    } catch (err: any) {
      const status = err instanceof HttpError ? err.status : 500;
      if (status === 500) console.error('[server]', err);
      send(res, status, { error: status === 500 ? 'Error interno (ver registro)' : err.message });
    }
  });
}

const page = (msg: string) => `<!doctype html><meta charset="utf-8"><title>Kratos</title><body style="background:#05080d;color:#cfe8ff;font:16px system-ui;padding:40px">${msg}</body>`;

if (import.meta.main) {
  const db = createPool();
  await migrate(db);
  cleanTmp();
  ensureVault();
  const server = createServer(db);
  server.listen(config.port, config.host, () => console.log(`[server] panel en http://${config.host}:${config.port}`));
  await audit(db, 'server', 'proceso.iniciado', {});
  const beat = setInterval(() => heartbeat(db, 'server').catch((e) => console.error('[server] latido:', e.message)), 15_000);
  heartbeat(db, 'server').catch(() => {});
  const stop = () => { clearInterval(beat); server.close(); db.end().finally(() => process.exit(0)); };
  process.on('SIGTERM', stop);
  process.on('SIGINT', stop);
}
