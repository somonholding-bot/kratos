// Fase B: una tarea solo se completa tras una verificación objetiva; los artefactos y el progreso quedan en la tarea.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createPool, type Db } from '../src/db.ts';
import { config } from '../src/config.ts';
import { migrate } from '../src/migrate.ts';
import { checkpoint, claimNext, completeTask, createTask, markVerifying } from '../src/core/tasks.ts';
import { verifyTask, failedChecks } from '../src/core/verify.ts';
import { saveReport, searchReports, taskResult } from '../src/core/registry.ts';
import { handlers } from '../src/core/handlers.ts';
import { tick } from '../src/worker.ts';

assert.equal(config.db.database, 'jarvis_test');
let db: Db, biz: number;
before(async () => {
  db = createPool();
  await db.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
  await migrate(db, () => {});
  await db.query(`UPDATE tasks SET status = 'cancelada'`);
  biz = (await db.query(`INSERT INTO businesses (name) VALUES ('Verificación') RETURNING id`)).rows[0].id;
});
after(async () => { await db.end(); });

const mk = (extra: Record<string, unknown>) => createTask(db, { businessId: biz, ownerFunction: 'venus', type: 'agente', title: 'Informe', objective: 'Probar', expectedResult: 'informe', verification: 'existe', createdBy: 'test', ...extra });

test('agente: un informe corto o sin archivo no pasa la verificación', async () => {
  const { task } = await mk({ idempotencyKey: 'v-corto' });
  const v = await verifyTask(db, task, { deliverable: 'Muy corto.', report: null });
  assert.equal(v.ok, false);
  assert.match(failedChecks(v), /informe con contenido/);
  assert.match(failedChecks(v), /guardado y legible/);
});

test('agente: informe real guardado → verificado, con artefacto y recuperable por búsqueda, agente, fecha y tipo', async () => {
  const { task } = await mk({ idempotencyKey: 'v-ok', title: 'Mapa de competidores de meditación' });
  const text = 'Informe de competidores. '.repeat(20) + 'Fuentes: ejemplo.com (2026).';
  const report = saveReport(task, text);
  const v = await verifyTask(db, task, { deliverable: text, report });
  assert.equal(v.ok, true, failedChecks(v));
  assert.equal(v.artefactos[0].tipo, 'informe');
  await db.query(`UPDATE tasks SET status = 'cancelada' WHERE status = 'pendiente' AND id <> $1`, [task.id]);
  const claimed = await claimNext(db, 'w1', ['agente']);
  assert.equal(claimed.id, task.id);
  await markVerifying(db, claimed, 'w1');
  assert.equal((await db.query(`SELECT status FROM tasks WHERE id = $1`, [task.id])).rows[0].status, 'verificando');
  const done = await completeTask(db, claimed, 'w1', { deliverable: text, report }, v);
  assert.equal(done.completed, true);
  const r: any = await taskResult(db, task.id);
  assert.equal(r.status, 'completada');
  assert.equal(r.verificacion.ok, true);
  assert.equal(r.artefactos.length, 1);
  assert.ok(r.completed_at);
  const found = await searchReports(db, 'competidores', 'venus', { type: 'agente', from: new Date(Date.now() - 60_000).toISOString() });
  assert.equal(found.informes[0].id, task.id);
  assert.equal(found.informes[0].verificada, true);
  assert.equal((await searchReports(db, 'competidores', 'marte')).total, 0);
});

test('agente: afirmar acciones externas invalida el informe', async () => {
  const { task } = await mk({ idempotencyKey: 'v-fake' });
  const text = 'Análisis completo. '.repeat(15) + 'Ya envié el correo al cliente y publiqué el anuncio.';
  const report = saveReport(task, text);
  const v = await verifyTask(db, task, { deliverable: text, report });
  assert.equal(v.ok, false);
  assert.match(failedChecks(v), /acciones externas/);
});

test('worker: un resultado que no pasa la verificación no completa la tarea', async () => {
  (handlers as any).t_verif = async () => ({ deliverable: 'nada', report: null });
  const { task } = await createTask(db, { businessId: biz, ownerFunction: 'venus', type: 'agente', title: 'Falsa', objective: 'x', expectedResult: 'x', verification: 'x', createdBy: 'test', idempotencyKey: 'v-worker' });
  await db.query(`UPDATE tasks SET status = 'cancelada' WHERE status = 'pendiente' AND id <> $1`, [task.id]);   // que el tick tome esta
  const real = handlers.agente;
  (handlers as any).agente = (handlers as any).t_verif;
  try { assert.equal(await tick(db, 'w-v'), 'fallida'); } finally { (handlers as any).agente = real; }
  const row = (await db.query(`SELECT status, last_error, attempts FROM tasks WHERE id = $1`, [task.id])).rows[0];
  assert.equal(row.status, 'pendiente');   // reintento programado, no completada
  assert.match(row.last_error, /Verificación fallida/);
});

test('vídeo: se comprueban archivos y duración; los puntos de control quedan en la tarea', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kratos-video-'));
  const { task } = await createTask(db, { businessId: biz, ownerFunction: 'venus', type: 'produccion_video', title: 'Vídeo', objective: 'x', expectedResult: 'x', verification: 'x', createdBy: 'test', idempotencyKey: 'v-video', inputs: { subir: true } });
  await checkpoint(db, task.id, 'Voz…');
  await checkpoint(db, task.id, 'Montaje…', { imagenes: 3 });
  const cps = (await db.query(`SELECT checkpoints FROM tasks WHERE id = $1`, [task.id])).rows[0].checkpoints;
  assert.equal(cps.length, 2); assert.equal(cps[1].paso, 'Montaje…');
  const bad = await verifyTask(db, task, { video: path.join(dir, 'no.mp4'), miniatura: path.join(dir, 'no.jpg'), subtitulos: path.join(dir, 'no.srt'), duracion_s: 10 });
  assert.equal(bad.ok, false);
  assert.match(failedChecks(bad), /vídeo/); assert.match(failedChecks(bad), /YouTube/);
});
