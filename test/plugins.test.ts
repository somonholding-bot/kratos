// Funciones nuevas: solo con aprobación del propietario y ejecutadas en aislamiento.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createPool, type Db } from '../src/db.ts';
import { config } from '../src/config.ts';
import { migrate } from '../src/migrate.ts';
import { activePlugins, checkCode, proposePlugin, runPlugin } from '../src/core/plugins.ts';
import { decideApproval } from '../src/core/approvals.ts';

assert.equal(config.db.database, 'jarvis_test');
let db: Db;
before(async () => { db = createPool(); await migrate(db, () => {}); await db.query(`DELETE FROM plugins`); });
after(async () => { await db.end(); });

test('código peligroso se rechaza antes de proponerlo', () => {
  assert.match(checkCode(`async function main() { return require('fs') }`)!, /no permitido/);
  assert.match(checkCode(`async function main() { return fetch('http://127.0.0.1:7420/api') }`)!, /no permitido/);
  assert.match(checkCode(`function x() {}`)!, /async function main/);
});

test('una función propuesta no corre hasta aprobarla; aprobada, corre aislada', async () => {
  const r: any = await proposePlugin(db, { name: 'Doble', description: 'Multiplica por dos', whenToUse: 'pruebas',
    code: `async function main(input) { return { doble: input.n * 2 } }` }, 'test');
  assert.ok(r.aprobacion);
  assert.deepEqual(await runPlugin(db, 'doble', { n: 2 }), { error: 'Función no activa' });
  assert.equal((await activePlugins(db)).length, 0);
  await decideApproval(db, r.aprobacion, true, 'panel');
  assert.deepEqual(await runPlugin(db, 'doble', { n: 21 }), { doble: 42 });
});

test('el aislamiento bloquea archivos y programas aunque el código intente evadirlo', async () => {
  const r: any = await proposePlugin(db, { name: 'Curiosa', description: 'x', whenToUse: 'x',
    code: `async function main() { const fs = await globalThis.process.getBuiltinModule('fs'); return fs.readFileSync('/etc/hosts', 'utf8') }` }, 'test');
  await decideApproval(db, r.aprobacion, true, 'panel');
  const out: any = await runPlugin(db, 'curiosa', {});
  assert.ok(out.error, 'debe fallar por permisos');
});

test('nunca más de 20 herramientas estrictas (límite de la API de Claude)', async () => {
  const { toolCount } = await import('../src/core/brain.ts');
  assert.ok(toolCount().strict <= 20, JSON.stringify(toolCount()));
});

test('Claude Code: el encargo solo se programa tras la aprobación del propietario', async () => {
  const { proposeCodeJob } = await import('../src/core/claudecode.ts');
  const r: any = await proposeCodeJob(db, 'Landing prueba', 'Haz una landing simple', 'test');
  assert.equal((await db.query(`SELECT count(*)::int AS n FROM tasks WHERE type = 'claude_code'`)).rows[0].n, 0);
  await decideApproval(db, r.aprobacion, true, 'panel');
  const t = (await db.query(`SELECT status, inputs FROM tasks WHERE type = 'claude_code'`)).rows[0];
  assert.equal(t.inputs.job_id, r.encargo);
  await db.query(`UPDATE tasks SET status = 'cancelada' WHERE type = 'claude_code'`);
});
