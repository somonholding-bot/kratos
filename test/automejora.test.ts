// Auto-mejora: solo con aprobación, lectura de código acotada y piezas protegidas.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createPool, type Db } from '../src/db.ts';
import { migrate } from '../src/migrate.ts';
import { decideApproval } from '../src/core/approvals.ts';
import { PROTECTED, diagnose, proposeImprovement, readCode } from '../src/core/selfimprove.ts';
import { describeJob, diagnoseSelf, failureReason } from '../src/core/selfdiag.ts';

let db: Db;
before(async () => { db = createPool(); await migrate(db, () => {}); });
after(async () => { await db.end(); });

test('una mejora propuesta no se ejecuta hasta que el propietario la aprueba', async () => {
  const r: any = await proposeImprovement(db, { titulo: 'Prueba', problema: 'Latencia alta', cambio: 'Ninguno real' }, 'test');
  const count = async () => (await db.query(`SELECT count(*)::int AS n FROM tasks WHERE type = 'auto_mejora' AND inputs->>'job_id' = $1`, [String(r.mejora)])).rows[0].n;
  assert.equal(await count(), 0);
  await decideApproval(db, r.aprobacion, true, 'panel');
  assert.equal(await count(), 1);
  await db.query(`UPDATE tasks SET status = 'cancelada' WHERE type = 'auto_mejora'`);
});

test('las piezas que protegen al propietario están fuera de su alcance', () => {
  for (const f of ['src/core/approvals.ts', 'src/core/budget.ts', 'src/auth.ts', 'src/core/selfimprove.ts']) assert.ok(PROTECTED.includes(f), f);
  assert.throws(() => readCode('../.ssh/id_rsa'), /no permitida/);
  assert.throws(() => readCode('.jarvis/session-token'), /no permitida/);
  assert.match(readCode('src/core/brain.ts', 1, 3).texto, /^1: /);
});

test('el diagnóstico devuelve datos reales', async () => {
  const d: any = await diagnose(db);
  assert.ok('voz_ultimas_24h' in d && 'fallas_recientes' in d);
  assert.ok(Array.isArray((await diagnoseSelf(db)).mejoras));
});

test('el diagnóstico separa reversiones de fallos y muestra el motivo', () => {
  const base = { id: 1, mejora: 'x', finished_at: null };
  const rev: any = describeJob({ ...base, status: 'fallida', result: JSON.stringify({ commit: 'abc', revertida: true }) });
  assert.equal(rev.status, 'revertida');
  const tests: any = describeJob({ ...base, status: 'fallida', result: JSON.stringify({ error: 'Las pruebas fallaron; cambio deshecho. ✖ algo' }) });
  assert.equal(tests.status, 'fallida');
  assert.equal(tests.motivo, 'pruebas no pasaron');
  assert.match(tests.error, /✖ algo/);
  assert.equal(failureReason('No se pudo aplicar sobre la rama principal'), 'no se pudo aplicar');
  assert.equal(failureReason('Claude Code no está instalado'), 'error general');
  assert.equal((describeJob({ ...base, status: 'completada', result: '{}' }) as any).motivo, undefined);
});
