import { execFile } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { Db } from '../db.ts';
import { audit } from './state.ts';
import { requestApproval } from './approvals.ts';
import { createTask } from './tasks.ts';
import { addAgenda } from './agenda.ts';
import { slugify } from './plugins.ts';

// Encargos a Claude Code (diseño y programación):
// - KRATOS propone el encargo; solo corre si el propietario lo aprueba en el panel.
// - Trabaja en ~/KratosProyectos/<proyecto> (nunca en ~/Jarvis ni en otras carpetas), sin terminal (Bash) ni web,
//   con tope de gasto y de tiempo. Cada resultado queda en un commit de git dentro de esa carpeta.

export const PROJECTS = path.join(os.homedir(), 'KratosProyectos');
const CLAUDE = [path.join(os.homedir(), '.local', 'bin', 'claude'), '/opt/homebrew/bin/claude'].find((p) => fs.existsSync(p)) ?? 'claude';

export async function proposeCodeJob(db: Db, project: string, instructions: string, by: string) {
  const slug = slugify(project);
  if (!slug) return { error: 'Nombre de proyecto no válido' };
  const a = await requestApproval(db, {
    kind: 'otro', description: `Encargo a Claude Code en ~/KratosProyectos/${slug}: ${instructions.slice(0, 240)}`,
    scope: { tipo: 'claude_code', proyecto: slug }, validDays: 14, requestedBy: by,
  });
  const j = (await db.query(`INSERT INTO code_jobs (project, instructions, approval_id, created_by) VALUES ($1,$2,$3,$4) RETURNING id`,
    [slug, instructions.slice(0, 8000), a.id, by])).rows[0];
  await db.query(`UPDATE approvals SET scope = scope || jsonb_build_object('job_id', $2::int) WHERE id = $1`, [a.id, j.id]);
  await audit(db, by, 'claude_code.propuesto', { job: j.id, proyecto: slug });
  return { encargo: j.id, aprobacion: a.id, estado: 'pendiente: el propietario debe aprobarlo en el panel' };
}

export async function onCodeApproval(db: Db, approval: any, approved: boolean) {
  if (approval?.scope?.tipo !== 'claude_code') return;
  const id = Number(approval.scope.job_id);
  if (!approved) { await db.query(`UPDATE code_jobs SET status = 'rechazada' WHERE id = $1`, [id]); return; }
  const job = (await db.query(`SELECT project FROM code_jobs WHERE id = $1 AND status = 'propuesta'`, [id])).rows[0];
  if (!job) return;
  const biz = (await db.query(`SELECT id FROM businesses WHERE name = 'Kratos · Operaciones internas'`)).rows[0] ?? (await db.query(`SELECT id FROM businesses ORDER BY id LIMIT 1`)).rows[0];
  const { task } = await createTask(db, {
    businessId: biz.id, ownerFunction: 'marte', type: 'claude_code', title: `Claude Code · ${job.project}`, objective: `Encargo #${id}`,
    inputs: { job_id: id }, expectedResult: 'Cambios en la carpeta del proyecto y resumen', verification: 'Revisión del propietario',
    idempotencyKey: `claude_code:${id}`, createdBy: 'propietario (aprobación)',
  });
  await db.query(`UPDATE code_jobs SET status = 'aprobada', task_id = $2 WHERE id = $1`, [id, task.id]);
  await db.query(`UPDATE approvals SET status = 'ejecutada' WHERE id = $1`, [approval.id]);
}

function run(cmd: string, args: string[], cwd: string, timeout: number, input?: string): Promise<{ out: string; err: string; code: number }> {
  return new Promise((resolve) => {
    const user = os.userInfo().username;
    const env = { HOME: os.homedir(), USER: user, LOGNAME: user, TMPDIR: os.tmpdir(), PATH: `${path.dirname(CLAUDE)}:${path.dirname(process.execPath)}:/opt/homebrew/bin:/usr/bin:/bin`, LANG: 'es_ES.UTF-8' };   // sin claves del entorno de KRATOS
    const p = execFile(cmd, args, { cwd, timeout, maxBuffer: 20_000_000, env }, (e, out, err) => resolve({ out: String(out), err: String(err), code: e ? Number((e as any).code ?? 1) : 0 }));
    if (input !== undefined) p.stdin?.end(input);
  });
}

export async function runCodeJob(db: Db, task: any) {
  const id = Number(task.inputs?.job_id);
  const job = (await db.query(`SELECT * FROM code_jobs WHERE id = $1 AND status IN ('aprobada','en_ejecucion')`, [id])).rows[0];
  if (!job) throw new Error('Encargo no aprobado o inexistente');
  const dir = path.join(PROJECTS, job.project);
  fs.mkdirSync(dir, { recursive: true });
  if (!fs.existsSync(path.join(dir, '.git'))) await run('/usr/bin/git', ['init', '-q'], dir, 20_000);
  await db.query(`UPDATE code_jobs SET status = 'en_ejecucion' WHERE id = $1`, [id]);
  // el trabajo puede durar minutos: se renueva el bloqueo de la tarea para que no se dé por interrumpida
  const keep = setInterval(() => db.query(`UPDATE tasks SET locked_until = now() + interval '5 minutes' WHERE id = $1 AND status = 'en_ejecucion'`, [task.id]).catch(() => {}), 60_000);
  try {
    const prompt = `Eres el programador y diseñador de KRATOS. Trabaja SOLO dentro de esta carpeta (${dir}). Encargo del propietario:\n\n${job.instructions}\n\nAl terminar, resume en español qué hiciste, qué archivos creaste o cambiaste y cómo probarlo.`;
    const r = await run(CLAUDE, ['-p', '--output-format', 'json', '--permission-mode', 'acceptEdits', '--allowedTools', 'Read', 'Edit', 'Write', 'Glob', 'Grep',
      '--disallowedTools', 'Bash', 'WebFetch', 'WebSearch', '--max-budget-usd', '3', '--no-session-persistence'], dir, 25 * 60_000, prompt);
    let summary = r.out.trim(), cost: number | null = null;
    try { const j = JSON.parse(r.out); summary = String(j.result ?? summary); cost = Number(j.total_cost_usd ?? j.cost_usd ?? NaN); if (Number.isNaN(cost)) cost = null; } catch {}
    if (/Not logged in|Please run \/login/i.test(summary + r.err)) throw new Error('Claude Code no tiene la sesión iniciada: abre Terminal, escribe «claude» y luego «/login»');
    if (r.code !== 0 && !summary) throw new Error(`Claude Code falló: ${r.err.slice(0, 300)}`);
    await run('/usr/bin/git', ['add', '-A'], dir, 20_000);
    await run('/usr/bin/git', ['-c', 'user.name=KRATOS', '-c', 'user.email=kratos@localhost', '-c', 'commit.gpgsign=false', 'commit', '-q', '-m', `Encargo #${id}: ${job.instructions.slice(0, 60)}`], dir, 20_000);
    await db.query(`UPDATE code_jobs SET status = 'completada', result = $2, cost_usd = $3, finished_at = now() WHERE id = $1`, [id, summary.slice(0, 20_000), cost]);
    await addAgenda(db, { at: new Date(), kind: 'aviso', text: `Claude Code terminó el encargo del proyecto ${job.project.replaceAll('_', ' ')}. Tiene el resumen en el panel.` }, 'claude code');
    return { proyecto: dir, resumen: summary.slice(0, 4000), costeUsd: cost };
  } catch (e: any) {
    await db.query(`UPDATE code_jobs SET status = 'fallida', result = $2, finished_at = now() WHERE id = $1`, [id, String(e.message).slice(0, 2000)]);
    throw e;
  } finally { clearInterval(keep); }
}
