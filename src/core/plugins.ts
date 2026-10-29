import { execFile } from 'node:child_process';
import type { Db } from '../db.ts';
import { audit } from './state.ts';
import { autoApprove, requestApproval } from './approvals.ts';

// Funciones nuevas («autoprogramación» con permiso):
// - KRATOS propone una función (código pequeño en JavaScript) y una solicitud de aprobación.
// - No se ejecuta nada hasta que el propietario lee el código y lo aprueba en el panel.
// - Se ejecuta aislada: proceso aparte con el modelo de permisos de Node (sin archivos, sin programas, sin variables
//   de entorno ni claves), solo internet público, 20 s y 128 MB como máximo. El código central nunca se modifica.

export const slugify = (s: string) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '').slice(0, 40);

// Patrones que una función nunca puede usar (además del aislamiento del proceso)
const FORBIDDEN = [/\brequire\s*\(/, /\bimport\s*\(/, /^\s*import\s/m, /\bprocess\s*\.\s*(binding|dlopen|env|kill|exit|chdir)/, /child_process/, /\bnode:/, /\beval\s*\(/, /\bFunction\s*\(/,
  /\b(127\.0\.0\.1|localhost|0\.0\.0\.0|\[::1\]|169\.254\.|10\.\d+\.|192\.168\.)/, /:(5432|7420)\b/, /\bWebAssembly\b/];

export function checkCode(code: string): string | null {
  if (code.length > 12_000) return 'El código es demasiado largo (máximo 12.000 caracteres)';
  if (!/async\s+function\s+main\s*\(/.test(code)) return 'Debe definir «async function main(input)»';
  const bad = FORBIDDEN.find((r) => r.test(code));
  return bad ? `Uso no permitido: ${bad.source}` : null;
}

export async function proposePlugin(db: Db, p: { name: string; description: string; whenToUse: string; inputSchema?: Record<string, unknown>; code: string }, by: string) {
  const err = checkCode(p.code);
  if (err) return { error: err };
  const slug = slugify(p.name);
  if (!slug) return { error: 'Nombre no válido' };
  const prev = (await db.query(`SELECT max(version) AS v FROM plugins WHERE slug = $1`, [slug])).rows[0];
  const schema = p.inputSchema && typeof p.inputSchema === 'object' ? { type: 'object', properties: {}, required: [], additionalProperties: false, ...p.inputSchema } : undefined;
  const a = await requestApproval(db, {
    kind: 'otro', description: `Nueva función de KRATOS: «${p.name}» — ${p.description.slice(0, 200)}. Revisa el código antes de aprobar.`,
    scope: { tipo: 'nueva_funcion', slug }, validDays: 30, requestedBy: by,
  });
  const r = (await db.query(`INSERT INTO plugins (name, slug, description, when_to_use, input_schema, code, version, approval_id, created_by)
      VALUES ($1,$2,$3,$4,coalesce($5::jsonb, '{"type":"object","properties":{},"required":[],"additionalProperties":false}'::jsonb),$6,$7,$8,$9) RETURNING id, slug, version`,
    [p.name.slice(0, 80), slug, p.description.slice(0, 500), p.whenToUse.slice(0, 500), schema ? JSON.stringify(schema) : null, p.code, (prev?.v ?? 0) + 1, a.id, by])).rows[0];
  await db.query(`UPDATE approvals SET scope = scope || jsonb_build_object('plugin_id', $2::int) WHERE id = $1`, [a.id, r.id]);
  await audit(db, by, 'funcion.propuesta', { plugin: r.id, slug, approval: a.id });
  if (await autoApprove(db, a.id)) return { propuesta: r.id, slug, estado: `activa ya (autonomía amplia): úsala como fn_${slug} en el próximo mensaje` };
  return { propuesta: r.id, aprobacion: a.id, estado: 'pendiente: el propietario debe revisar el código y aprobarlo en el panel' };
}

// Al aprobar en el panel: se activa (y la versión anterior queda sustituida)
export async function onApprovalDecided(db: Db, approval: any, approved: boolean) {
  if (approval?.scope?.tipo !== 'nueva_funcion') return;
  const id = Number(approval.scope.plugin_id);
  if (!approved) { await db.query(`UPDATE plugins SET status = 'rechazada' WHERE id = $1 AND status = 'propuesta'`, [id]); return; }
  const p = (await db.query(`SELECT slug FROM plugins WHERE id = $1 AND status = 'propuesta'`, [id])).rows[0];
  if (!p) return;
  await db.query(`UPDATE plugins SET status = 'sustituida' WHERE slug = $1 AND status = 'activa'`, [p.slug]);
  await db.query(`UPDATE plugins SET status = 'activa', activated_at = now() WHERE id = $1`, [id]);
  await db.query(`UPDATE approvals SET status = 'ejecutada' WHERE id = $1`, [approval.id]);
  await audit(db, 'propietario', 'funcion.activada', { plugin: id, slug: p.slug });
}

export async function activePlugins(db: Db) {
  return (await db.query(`SELECT id, name, slug, description, when_to_use, input_schema, code FROM plugins WHERE status = 'activa' ORDER BY slug`)).rows;
}

const WRAPPER = `
const __block = (u) => { const h = new URL(u).hostname; if (/^(localhost|127\\.|0\\.0\\.0\\.0|10\\.|192\\.168\\.|169\\.254\\.|\\[?::1)/.test(h)) throw new Error('Red local no permitida'); };
const __fetch = globalThis.fetch; globalThis.fetch = (u, o) => { __block(typeof u === 'string' ? u : u.url); return __fetch(u, { ...o, signal: AbortSignal.timeout(15000) }); };
let __in = ''; for await (const c of process.stdin) __in += c;
try { const out = await main(JSON.parse(__in || '{}')); process.stdout.write(JSON.stringify({ ok: true, result: out ?? null }).slice(0, 50000)); }
catch (e) { process.stdout.write(JSON.stringify({ ok: false, error: String(e?.message ?? e).slice(0, 300) })); }
`;

export async function runPlugin(db: Db, slug: string, input: unknown): Promise<unknown> {
  const p = (await db.query(`SELECT id, code FROM plugins WHERE slug = $1 AND status = 'activa'`, [slug])).rows[0];
  if (!p) return { error: 'Función no activa' };
  const out = await new Promise<string>((resolve) => {
    const child = execFile(process.execPath, ['--permission', '--disallow-code-generation-from-strings', '--max-old-space-size=128', '--input-type=module', '-e', `${p.code}\n${WRAPPER}`],
      { timeout: 20_000, maxBuffer: 200_000, env: { TZ: process.env.TZ ?? '' } }, (err, stdout) => resolve(stdout || JSON.stringify({ ok: false, error: err ? (err.killed ? 'Tiempo agotado' : err.message.slice(0, 200)) : 'sin salida' })));
    child.stdin?.end(JSON.stringify(input ?? {}));
  });
  let r: any; try { r = JSON.parse(out); } catch { r = { ok: false, error: 'Salida no válida' }; }
  await db.query(`UPDATE plugins SET runs = runs + 1, last_error = $2 WHERE id = $1`, [p.id, r.ok ? null : r.error]);
  return r.ok ? r.result : { error: r.error };
}
