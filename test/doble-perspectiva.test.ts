// Protocolo de doble perspectiva: 6 preguntas, una por vez, investigación real de Sol, revisión de Saturno y enrutado a Claude.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createPool, type Db } from '../src/db.ts';
import { migrate } from '../src/migrate.ts';
import { syncPlaybooksFromFiles } from '../src/core/playbooks.ts';
import { syncToolRegistry } from '../src/core/toolregistry.ts';
import * as D from '../src/core/doble-perspectiva.ts';
import { routeLocal } from '../src/core/local.ts';

let db: Db;
const limpiar = async () => {
  const ts = (await db.query(`SELECT tarea_sol, tarea_saturno FROM dp_sesiones`)).rows.flatMap((r) => [r.tarea_sol, r.tarea_saturno]).filter(Boolean);
  await db.query(`DELETE FROM dp_sesiones`); await db.query(`UPDATE dp_preguntas SET estado = 'pendiente'`);
  if (ts.length) { await db.query(`DELETE FROM approvals WHERE task_id = ANY($1)`, [ts]).catch(() => {}); await db.query(`DELETE FROM tasks WHERE id = ANY($1)`, [ts]).catch(() => {}); }
};
before(async () => { db = createPool(); await migrate(db, () => {}); await syncToolRegistry(db); await syncPlaybooksFromFiles(db); await D.sembrarPreguntasDP(db); await limpiar(); });
after(async () => { await limpiar(); await db.end(); });

test('6 preguntas de estudio; una por vez; la investigación real va a Sol con el procedimiento de doble perspectiva', async () => {
  assert.equal((await D.listar(db)).preguntas.length, 6);
  const a = await D.iniciar(db, { numero: 1, respuesta_visible: 'Hermes… Einstein… Lo que podemos investigar…' }, 'kratos');
  assert.equal(a.iniciada, true); assert.ok(a.tarea_sol);
  const t = (await db.query(`SELECT owner_function, playbook_id, created_by, inputs FROM tasks WHERE id = $1`, [a.tarea_sol])).rows[0];
  assert.equal(t.owner_function, 'sol'); assert.equal(t.playbook_id, 'sol-doble-perspectiva'); assert.equal(t.created_by, 'kratos (IA)');   // orden del propietario: prioridad
  assert.equal((await D.iniciar(db, { numero: 1 }, 'kratos')).iniciada, false);   // no duplica
  const b = await D.iniciar(db, { numero: 2 }, 'kratos');
  assert.equal(b.iniciada, false); assert.match(b.motivo!, /Seguimos con la pregunta 1/);
  await D.profundizar(db, a.sesion!, '¿Y el vacío cuántico?', 'propietario');
  const v = await D.ver(db, a.sesion);
  assert.equal(v.profundizaciones.length, 1); assert.match(v.investigacion_de_sol, /Sol aún trabaja/);
  const c = await D.iniciar(db, { numero: 2, continuar: true }, 'kratos');
  assert.equal(c.iniciada, true);
  const l = await D.listar(db); assert.equal(l.en_dialogo, 2); assert.equal(l.preguntas[0].estado, 'estudiada');
});

test('cuando Sol termina, Saturno revisa las afirmaciones científicas; después la sesión queda lista', async () => {
  const s = (await db.query(`SELECT id, tarea_sol FROM dp_sesiones WHERE numero = 1`)).rows[0];
  await db.query(`UPDATE tasks SET status = 'completada', started_at = now() - interval '5 minutes', completed_at = now(), verified_at = now(), result = '{"deliverable":"Hermes Trismegisto — Perspectiva hermética…"}' WHERE id = $1`, [s.tarea_sol]);
  await D.avanzarDP(db);
  const r = (await db.query(`SELECT estado, tarea_saturno FROM dp_sesiones WHERE id = $1`, [s.id])).rows[0];
  assert.equal(r.estado, 'revision'); assert.ok(r.tarea_saturno);
  const k = (await db.query(`SELECT owner_function, playbook_id, inputs FROM tasks WHERE id = $1`, [r.tarea_saturno])).rows[0];
  assert.equal(k.owner_function, 'saturno'); assert.equal(k.playbook_id, 'acd-critica'); assert.match(JSON.stringify(k.inputs), /Einstein/);
  await db.query(`UPDATE tasks SET status = 'completada', completed_at = now(), result = '{"deliverable":"Objetos revisados…"}' WHERE id = $1`, [r.tarea_saturno]);
  await D.avanzarDP(db);
  assert.equal((await db.query(`SELECT estado FROM dp_sesiones WHERE id = $1`, [s.id])).rows[0].estado, 'lista');
  assert.match((await D.ver(db, s.id)).investigacion_de_sol, /Hermes/);
});

test('las preguntas sobre la naturaleza no las responde el cerebro rápido: van a Claude, que encarga la investigación', async () => {
  for (const q of ['¿Qué es realmente la materia antes de manifestarse?', '¿Qué diría Hermes sobre el tiempo?', 'háblame de Einstein y la conciencia'])
    assert.equal(await routeLocal(db, 'texto', q), false, q);
});
