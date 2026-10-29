import { execFile, spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { Db } from '../db.ts';
import { ROOT } from '../config.ts';
import { audit } from './state.ts';
import { requestApproval } from './approvals.ts';
import { createTask } from './tasks.ts';
import { addAgenda } from './agenda.ts';

// Auto-mejora de KRATOS (autonomía nivel 8), siempre con aprobación del propietario:
// 1. KRATOS diagnostica (bitácora, tiempos, su código) y PROPONE una mejora → Aprobaciones.
// 2. Al aprobarla: respaldo (etiqueta git), rama aparte, Claude Code programa el cambio, se pasan las pruebas.
// 3. Si todo pasa, se aplica y se reinicia; si algo falla, se deshace solo. Cualquier mejora se puede revertir (también con aprobación).
// Nunca puede: borrar archivos ni tocar las piezas que protegen al propietario (aprobaciones, presupuesto, accesos, este módulo).

export const PROTECTED = ['src/core/approvals.ts', 'src/core/budget.ts', 'src/auth.ts', 'src/core/state.ts', 'src/core/selfimprove.ts', '.gitignore', 'package-lock.json'];
const PROTECTED_DIRS = ['.git/', '.jarvis/', 'node_modules/'];
const isProtected = (f: string) => PROTECTED.includes(f) || PROTECTED_DIRS.some((d) => f.startsWith(d)) || (f.startsWith('db/') && fs.existsSync(path.join(ROOT, f)) && !f.endsWith('.new'));
const CLAUDE = [path.join(os.homedir(), '.local', 'bin', 'claude'), '/opt/homebrew/bin/claude'].find((p) => fs.existsSync(p)) ?? null;
const PROJECT = '__kratos__';

const sh = (cmd: string, args: string[], timeout = 120_000, input?: string) => new Promise<{ out: string; code: number }>((resolve) => {
  const user = os.userInfo().username;
  const env = { HOME: os.homedir(), USER: user, LOGNAME: user, TMPDIR: os.tmpdir(), LANG: 'es_ES.UTF-8',
    PATH: `${CLAUDE ? path.dirname(CLAUDE) + ':' : ''}${path.dirname(process.execPath)}:/opt/homebrew/bin:/usr/bin:/bin` };
  const p = execFile(cmd, args, { cwd: ROOT, timeout, maxBuffer: 30_000_000, env }, (e, out, err) => resolve({ out: `${out}${err}`, code: e ? Number((e as any).code ?? 1) : 0 }));
  if (input !== undefined) p.stdin?.end(input);
});
const git = (...a: string[]) => sh('/usr/bin/git', a);

// ---------- Diagnóstico y lectura del propio código (solo lectura) ----------

export async function diagnose(db: Db) {
  const q = async (sql: string) => (await db.query(sql)).rows;
  return {
    fallas_recientes: await q(`SELECT at, source, message FROM fault_log ORDER BY id DESC LIMIT 15`),
    voz_ultimas_24h: (await q(`SELECT count(*)::int AS turnos, percentile_cont(0.5) WITHIN GROUP (ORDER BY stt_ms)::int AS transcripcion_ms_p50,
        percentile_cont(0.5) WITHIN GROUP (ORDER BY think_ms)::int AS respuesta_ms_p50, max(think_ms) AS respuesta_ms_max,
        count(*) FILTER (WHERE outcome <> 'ok')::int AS fragmentos_descartados FROM voice_metrics WHERE at > now() - interval '24 hours'`))[0],
    rendimiento_ultima_hora: (await q(`SELECT round(avg(cpu_busy),1) AS cpu_media, max(cpu_busy) AS cpu_max, round(avg(ram_used_pct)) AS ram_media,
        round(avg(kratos_ram_mb)) AS kratos_ram_mb FROM perf_log WHERE at > now() - interval '1 hour'`))[0],
    tareas_fallidas_7d: await q(`SELECT id, owner_function, title, left(last_error, 200) AS error FROM tasks WHERE status = 'fallida' AND updated_at > now() - interval '7 days' ORDER BY id DESC LIMIT 10`),
    ia_ultimas_24h: (await q(`SELECT count(*)::int AS llamadas, round(sum(cost_microusd)/1e6, 3) AS coste_usd, round(avg(input_tokens)) AS tokens_entrada_medios FROM ai_usage WHERE at > now() - interval '24 hours'`))[0],
    mejoras: await q(`SELECT id, status, left(instructions, 120) AS mejora, finished_at FROM code_jobs WHERE project = '${PROJECT}' ORDER BY id DESC LIMIT 5`),
  };
}

const safeRel = (rel: string) => {
  const full = path.resolve(ROOT, rel);
  if (!full.startsWith(ROOT + path.sep) || PROTECTED_DIRS.some((d) => full.startsWith(path.join(ROOT, d)))) throw new Error('Ruta no permitida');
  return full;
};
export function readCode(rel: string, from = 1, lines = 200) {
  const text = fs.readFileSync(safeRel(rel), 'utf8').split('\n');
  return { archivo: rel, total_lineas: text.length, desde: from, texto: text.slice(Math.max(0, from - 1), from - 1 + Math.min(400, lines)).map((l, i) => `${from + i}: ${l}`).join('\n') };
}
export async function searchCode(text: string) {
  const r = await git('grep', '-n', '-I', '--max-count=5', '-e', text, '--', 'src', 'public', 'native', 'scripts', 'db', 'test');
  return { coincidencias: r.out.split('\n').filter(Boolean).slice(0, 40).map((l) => l.slice(0, 220)) };
}

// ---------- Propuesta, aprobación y ejecución ----------

export async function proposeImprovement(db: Db, p: { titulo: string; problema: string; cambio: string }, by: string) {
  const instructions = `${p.titulo}\n\nProblema detectado: ${p.problema}\n\nCambio propuesto: ${p.cambio}`.slice(0, 8000);
  const a = await requestApproval(db, { kind: 'otro', description: `Auto-mejora de KRATOS: «${p.titulo.slice(0, 120)}». ${p.problema.slice(0, 200)}. Se hará respaldo, se probará y se deshará sola si falla.`,
    scope: { tipo: 'auto_mejora' }, validDays: 14, requestedBy: by });
  const j = (await db.query(`INSERT INTO code_jobs (project, instructions, approval_id, created_by) VALUES ($1,$2,$3,$4) RETURNING id`, [PROJECT, instructions, a.id, by])).rows[0];
  await db.query(`UPDATE approvals SET scope = scope || jsonb_build_object('job_id', $2::int) WHERE id = $1`, [a.id, j.id]);
  await audit(db, by, 'auto_mejora.propuesta', { mejora: j.id, aprobacion: a.id });
  return { mejora: j.id, aprobacion: a.id, estado: 'pendiente: el propietario debe aprobarla en el panel' };
}

export async function proposeRevert(db: Db, id: number, by: string) {
  const j = (await db.query(`SELECT id, status, result FROM code_jobs WHERE id = $1 AND project = $2`, [id, PROJECT])).rows[0];
  if (!j || j.status !== 'completada') return { error: 'Solo se pueden revertir mejoras aplicadas' };
  const a = await requestApproval(db, { kind: 'otro', description: `Revertir la auto-mejora #${id} de KRATOS (volver al estado anterior a ese cambio).`, scope: { tipo: 'revertir_mejora', job_id: id }, validDays: 14, requestedBy: by });
  return { aprobacion: a.id, estado: 'pendiente: el propietario debe aprobarla en el panel' };
}

export async function onSelfApproval(db: Db, approval: any, approved: boolean) {
  const tipo = approval?.scope?.tipo;
  if (tipo !== 'auto_mejora' && tipo !== 'revertir_mejora') return;
  const id = Number(approval.scope.job_id);
  if (!approved) { if (tipo === 'auto_mejora') await db.query(`UPDATE code_jobs SET status = 'rechazada' WHERE id = $1 AND status = 'propuesta'`, [id]); return; }
  const biz = (await db.query(`SELECT id FROM businesses ORDER BY is_demo, id LIMIT 1`)).rows[0];
  const { task } = await createTask(db, {
    businessId: biz.id, ownerFunction: 'saturno', type: tipo, title: `${tipo === 'auto_mejora' ? 'Auto-mejora' : 'Revertir mejora'} #${id}`, objective: `Mejora #${id}`,
    inputs: { job_id: id }, expectedResult: 'Cambio aplicado y probado, o deshecho', verification: 'Pruebas automáticas', idempotencyKey: `${tipo}:${id}:${approval.id}`, createdBy: 'propietario (aprobación)',
  });
  if (tipo === 'auto_mejora') await db.query(`UPDATE code_jobs SET status = 'aprobada', task_id = $2 WHERE id = $1`, [id, task.id]);
  await db.query(`UPDATE approvals SET status = 'ejecutada' WHERE id = $1`, [approval.id]);
}

// Reinicia los servicios un poco después (el propio trabajador se reinicia, por eso va aparte)
function restartSoon(native: boolean) {
  const uid = process.getuid?.() ?? 501;
  const cmds = [native ? `bash "${ROOT}/scripts/install-app.sh" >/dev/null 2>&1` : '', `launchctl kickstart -k gui/${uid}/com.jarvis.server`, `launchctl kickstart -k gui/${uid}/com.jarvis.worker`].filter(Boolean).join('; ');
  spawn('/bin/bash', ['-c', `sleep 4; ${cmds}`], { detached: true, stdio: 'ignore' }).unref();
}

async function abort(branch: string, why: string): Promise<never> {
  await git('checkout', '--', '.');
  await git('clean', '-fd', '--', 'src', 'public', 'native', 'scripts', 'db', 'test', 'docs', 'skills');
  await git('checkout', 'main');
  await git('branch', '-D', branch);
  throw new Error(why);
}

export async function runSelfImprovement(db: Db, task: any) {
  const id = Number(task.inputs?.job_id);
  const job = (await db.query(`SELECT * FROM code_jobs WHERE id = $1 AND project = $2 AND status IN ('aprobada','en_ejecucion')`, [id, PROJECT])).rows[0];
  if (!job) throw new Error('Mejora no aprobada o inexistente');
  if (!CLAUDE) throw new Error('Claude Code no está instalado');
  const dirty = (await git('status', '--porcelain')).out.trim();
  if (dirty) throw new Error('Hay cambios sin guardar en el código de KRATOS; no se toca nada hasta que estén guardados');
  if ((await git('branch', '--show-current')).out.trim() !== 'main') throw new Error('El código no está en la rama principal');
  await db.query(`UPDATE code_jobs SET status = 'en_ejecucion' WHERE id = $1`, [id]);
  const keep = setInterval(() => db.query(`UPDATE tasks SET locked_until = now() + interval '5 minutes' WHERE id = $1 AND status = 'en_ejecucion'`, [task.id]).catch(() => {}), 60_000);
  const tag = `respaldo/mejora-${id}`, branch = `mejora/${id}`;
  try {
    await git('tag', '-f', tag);
    await git('checkout', '-b', branch);
    const prompt = `Eres KRATOS mejorándote a ti mismo, con permiso del propietario. Repositorio: ${ROOT}.\n\n${job.instructions}\n\n` +
      `Reglas obligatorias:\n- No borres archivos.\n- No modifiques: ${PROTECTED.join(', ')}, ni migraciones ya existentes en db/ (puedes crear una nueva).\n` +
      `- Para ver datos reales usa: bash scripts/consulta-bd.sh "SELECT …" (solo lectura). Para ampliar la base de datos crea una migración nueva en db/ (NNN_nombre.sql); se aplica sola al reiniciar.\n- Cambios pequeños y del estilo del código existente.\n- Al terminar ejecuta «npm test» y corrige hasta que pase.\n- No hagas commit ni push: eso lo hace el sistema.\n` +
      `Termina con un resumen en español: qué cambiaste, en qué archivos y por qué.`;
    // Terminal con lista de prohibidos: puede ejecutar y probar, pero no borrar, instalar, publicar, usar sudo ni tocar servicios
    const r = await sh(CLAUDE, ['-p', '--output-format', 'json', '--model', 'opus', '--permission-mode', 'acceptEdits',
      '--allowedTools', 'Read', 'Edit', 'Write', 'Glob', 'Grep', 'WebSearch', 'Bash',
      '--disallowedTools', 'Bash(rm:*)', 'Bash(sudo:*)', 'Bash(git push:*)', 'Bash(git commit:*)', 'Bash(git reset:*)', 'Bash(git checkout:*)', 'Bash(git clean:*)', 'Bash(git branch:*)',
      'Bash(npm install:*)', 'Bash(npm i:*)', 'Bash(brew:*)', 'Bash(pip:*)', 'Bash(curl:*)', 'Bash(wget:*)', 'Bash(launchctl:*)', 'Bash(security:*)', 'Bash(psql:*)', 'Bash(dropdb:*)', 'Bash(chmod:*)', 'Bash(mv:*)',
      '--strict-mcp-config', '--no-session-persistence'], 30 * 60_000, prompt);
    let summary = r.out.trim();
    try { const j = JSON.parse(r.out.slice(r.out.indexOf('{'))); summary = String(j.result ?? summary); } catch {}
    if (/Not logged in|Please run \/login/i.test(summary)) await abort(branch, 'Claude Code no tiene la sesión iniciada');
    const changes = (await git('status', '--porcelain')).out.split('\n').filter(Boolean).map((l) => ({ st: l.slice(0, 2), f: l.slice(3).trim() }));
    if (!changes.length) await abort(branch, `No se hizo ningún cambio. ${summary.slice(0, 300)}`);
    const deleted = changes.filter((c) => c.st.includes('D')).map((c) => c.f);
    if (deleted.length) await abort(branch, `Intentó borrar archivos (${deleted.join(', ')}): cambio deshecho`);
    const touched = changes.map((c) => c.f).filter((f) => isProtected(f) && !(f.startsWith('db/') && changes.find((c) => c.f === f)?.st.includes('?')));
    if (touched.length) await abort(branch, `Intentó modificar partes protegidas (${touched.join(', ')}): cambio deshecho`);
    const test = await sh('/usr/bin/env', ['npm', 'test'], 10 * 60_000);
    if (!/ℹ fail 0/.test(test.out)) await abort(branch, `Las pruebas fallaron; cambio deshecho. ${test.out.split('\n').filter((l) => /✖|fail/.test(l)).slice(0, 5).join(' | ')}`);
    await git('add', '-A');
    await git('-c', 'user.name=KRATOS', '-c', 'user.email=kratos@localhost', '-c', 'commit.gpgsign=false', 'commit', '-q', '-m', `Auto-mejora #${id}: ${job.instructions.split('\n')[0].slice(0, 70)}\n\nAprobada por el propietario. Respaldo: ${tag}`);
    const sha = (await git('rev-parse', 'HEAD')).out.trim();
    await git('checkout', 'main');
    const merged = await git('merge', '--ff-only', branch);
    if (merged.code !== 0) await abort(branch, 'No se pudo aplicar sobre la rama principal');
    await git('branch', '-d', branch);
    const files = changes.map((c) => c.f);
    await db.query(`UPDATE code_jobs SET status = 'completada', result = $2, finished_at = now() WHERE id = $1`, [id, JSON.stringify({ resumen: summary.slice(0, 8000), commit: sha, respaldo: tag, archivos: files })]);
    await audit(db, 'kratos (auto-mejora)', 'auto_mejora.aplicada', { mejora: id, commit: sha, archivos: files });
    await addAgenda(db, { at: new Date(), kind: 'aviso', text: `apliqué la mejora número ${id} y pasó todas las pruebas. Si algo va peor, pídeme revertirla.` }, 'auto-mejora');
    restartSoon(files.some((f) => f.startsWith('native/')));
    return { mejora: id, commit: sha, respaldo: tag, archivos: files, resumen: summary.slice(0, 3000) };
  } catch (e: any) {
    await db.query(`UPDATE code_jobs SET status = 'fallida', result = $2, finished_at = now() WHERE id = $1`, [id, JSON.stringify({ error: String(e.message).slice(0, 2000) })]);
    await addAgenda(db, { at: new Date(), kind: 'aviso', text: `no pude aplicar la mejora número ${id}: ${String(e.message).slice(0, 160)}. El código quedó como estaba.` }, 'auto-mejora');
    throw e;
  } finally { clearInterval(keep); }
}

export async function runRevert(db: Db, task: any) {
  const id = Number(task.inputs?.job_id);
  const job = (await db.query(`SELECT result FROM code_jobs WHERE id = $1 AND project = $2 AND status = 'completada'`, [id, PROJECT])).rows[0];
  let info: any = {}; try { info = JSON.parse(job?.result ?? '{}'); } catch {}
  const sha = info.commit;
  if (!sha) throw new Error('No encuentro el cambio de esa mejora');
  if ((await git('status', '--porcelain')).out.trim()) throw new Error('Hay cambios sin guardar; no se revierte nada');
  const r = await git('-c', 'user.name=KRATOS', '-c', 'user.email=kratos@localhost', '-c', 'commit.gpgsign=false', 'revert', '--no-edit', sha);
  if (r.code !== 0) { await git('revert', '--abort'); throw new Error(`No se pudo revertir automáticamente: ${r.out.slice(0, 200)}`); }
  await db.query(`UPDATE code_jobs SET status = 'revertida', result = $2 WHERE id = $1`, [id, JSON.stringify({ ...info, revertida: true })]);
  await audit(db, 'kratos (auto-mejora)', 'auto_mejora.revertida', { mejora: id, commit: sha });
  restartSoon(true);
  return { revertida: id };
}
