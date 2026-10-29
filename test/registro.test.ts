// Registro central: informes guardados y recuperables, agentes y herramientas.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createPool, type Db } from '../src/db.ts';
import { migrate } from '../src/migrate.ts';
import { createTask } from '../src/core/tasks.ts';
import { agentsRegistry, saveReport, searchReports, systemInventory, taskResult } from '../src/core/registry.ts';

let db: Db;
before(async () => { db = createPool(); await migrate(db, () => {}); });
after(async () => { await db.end(); });

test('un informe se guarda, se lee de vuelta y se recupera por el número de tarea', async () => {
  const biz = (await db.query(`SELECT id FROM businesses ORDER BY id LIMIT 1`)).rows[0];
  const { task } = await createTask(db, { businessId: biz.id, ownerFunction: 'venus', type: 'agente', title: 'Análisis de mercado de prueba', objective: 'Probar el registro',
    expectedResult: 'Informe', verification: 'Legible', createdBy: 'test', idempotencyKey: `reg-${Date.now()}` });
  const body = 'Informe de Venus: tres hallazgos sobre el mercado de apps de fitness para hombres adultos.';
  const rel = saveReport(task, body);
  await db.query(`UPDATE tasks SET status = 'completada', result = $2 WHERE id = $1`, [task.id, JSON.stringify({ deliverable: body, report: rel })]);
  const r: any = await taskResult(db, task.id);
  assert.equal(r.informe, body); assert.equal(r.archivo, rel);
  const s = await searchReports(db, 'fitness', 'venus');
  assert.ok(s.informes.some((x: any) => x.id === task.id));
});

test('sin informe no se puede guardar ni dar por bueno', () => {
  assert.throws(() => saveReport({ id: 1, title: 'x', owner_function: 'venus' }, '   '), /informe utilizable/);
});

test('registro de agentes e inventario responden con datos reales', async () => {
  const venus = (await agentsRegistry(db, 'venus'))[0];
  assert.equal(venus.id, 'venus'); assert.ok(venus.purpose); assert.ok(Array.isArray(venus.skills));
  const inv = await systemInventory(db);
  assert.ok(inv.herramientas.find((h) => h.nombre.startsWith('PostgreSQL'))?.estado === 'OPERATIVA');
});
