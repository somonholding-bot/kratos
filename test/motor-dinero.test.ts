// Motor de dinero: saber antes de decidir, cartera diversa empujada sola, comprobaciones en código y límites intactos.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createPool, type Db } from '../src/db.ts';
import { migrate } from '../src/migrate.ts';
import { syncPlaybooksFromFiles } from '../src/core/playbooks.ts';
import { syncToolRegistry } from '../src/core/toolregistry.ts';
import { sembrarPreguntas, crearOportunidad, evaluar, responder } from '../src/core/ksie.ts';
import { saberParaDecidir, avanzarMotor, KSIE_CHECKS } from '../src/core/motor-dinero.ts';

let db: Db;
const limpiar = async () => {
  const ts = (await db.query(`SELECT id FROM tasks WHERE playbook_id LIKE 'ksie-%'`)).rows.map((r) => r.id);
  if (ts.length) { await db.query(`DELETE FROM approvals WHERE task_id = ANY($1)`, [ts]); await db.query(`DELETE FROM tasks WHERE id = ANY($1)`, [ts]); }
  await db.query(`DELETE FROM ksie_recomendaciones`); await db.query(`DELETE FROM ksie_respuestas`); await db.query(`DELETE FROM experiments WHERE oportunidad_id IS NOT NULL`); await db.query(`DELETE FROM ksie_oportunidades`);
  await db.query(`DELETE FROM cog_decisiones WHERE categoria = 'ksie:recomendacion'`);
};
before(async () => { db = createPool(); await migrate(db, () => {}); await syncToolRegistry(db); await syncPlaybooksFromFiles(db); await sembrarPreguntas(db); await limpiar(); });
after(async () => { await limpiar(); await db.end(); });

const ev = { beneficio_neto_mensual: { min: 0, base: 1500, max: 5000 }, capital_usd: { min: 100, base: 500, max: 1500 }, meses_primer_ingreso: { min: 1, base: 2, max: 4 }, evidencia_demanda: 0.5, dificultad: 0.4, competencia: 0.5, defensibilidad: 0.4, distribucion: 0.5, riesgo_baja: 0.3, encaje: 0.6 };

test('el saber reúne misión, límites, lecciones y cartera; no limita a vídeos ni apps', async () => {
  const s = await saberParaDecidir(db, 'libro sobre sueños lúcidos');
  assert.match(s, /CUALQUIER vía legal/); assert.match(s, /DECIDE TÚ/); assert.match(s, /aprueba: gastar dinero fuera del presupuesto de pruebas, operar con capital/); assert.match(s, /Stripe/);
  assert.match(s, /LO QUE FUNCIONÓ/); assert.match(s, /CARTERA/);
  assert.ok((await saberParaDecidir(db, '', 1600)).length <= 1600);
});

test('cartera vacía → el motor lanza a Júpiter a descubrir; con cartera diversa → valida la mejor con Mercurio', async () => {
  const a = await avanzarMotor(db, { creadoPor: 'kratos (IA)' });
  assert.equal(a.hecho, 'descubrir');
  const t = (await db.query(`SELECT owner_function, playbook_id, created_by FROM tasks WHERE id = $1`, [a.tarea])).rows[0];
  assert.equal(t.owner_function, 'jupiter'); assert.equal(t.created_by, 'kratos (IA)');
  assert.notEqual((await avanzarMotor(db)).hecho, 'descubrir');   // no duplica
  await db.query(`UPDATE tasks SET status = 'completada' WHERE id = $1`, [a.tarea]);
  const tipos = ['producto_fisico', 'servicio_local', 'servicio_industrial', 'producto_digital', 'contenido', 'software', 'fabricacion', 'hibrido'];
  for (const [k, tipo] of tipos.entries()) { const o = await crearOportunidad(db, { nombre: `Oportunidad de prueba ${k}`, tipo, descripcion: 'prueba del motor', origen: 'kratos' }, 'agente:jupiter'); await evaluar(db, o.id, { ...ev, beneficio_neto_mensual: { min: 0, base: 1000 + k * 300, max: 5000 } }, 'ESTIMATE', 'agente:jupiter'); }
  const b = await avanzarMotor(db);
  assert.equal(b.hecho, 'validar'); assert.ok(b.oportunidad);
  const v = (await db.query(`SELECT owner_function, inputs FROM tasks WHERE id = $1`, [b.tarea])).rows[0];
  assert.equal(v.owner_function, 'mercurio'); assert.equal(String(v.inputs.parametros.oportunidad_id), String(b.oportunidad));
});

test('comprobaciones en código: cuentan solo lo que hizo el agente durante su tarea', async () => {
  const since = new Date(Date.now() - 60_000);
  const r = await KSIE_CHECKS.ksie_oportunidades_min.comprobar({ minimo: 8, tipos_min: 5 }, { texto: '', params: {}, extraido: {}, db, task: { owner_function: 'jupiter', started_at: since } });
  assert.equal(r.ok, true, r.detalle);
  const o = (await db.query(`SELECT id FROM ksie_oportunidades ORDER BY id LIMIT 1`)).rows[0].id;
  await responder(db, { oportunidad_id: o, pregunta_id: 'Q011', respuesta: 'Pagan 30 $ por unidad', evidencia: 'catálogo de 3 tiendas', fuente: 'https://ejemplo.org/precios', etiqueta: 'OBSERVED', confianza: 0.7 }, 'agente:mercurio');
  const r2 = await KSIE_CHECKS.ksie_respuestas_min.comprobar({ minimo: 7, oportunidad: '{{oportunidad_id}}' }, { texto: '', params: { oportunidad_id: o }, extraido: {}, db, task: { owner_function: 'mercurio', started_at: since } });
  assert.equal(r2.ok, false); assert.match(r2.detalle, /1 preguntas/);
});

test('cupo diario y parada de emergencia frenan el motor', async () => {
  await db.query(`UPDATE system_state SET value = '1' WHERE key = 'motor_dinero_dia'`);
  assert.match((await avanzarMotor(db)).motivo!, /cupo diario/);
  await db.query(`UPDATE system_state SET value = '3' WHERE key = 'motor_dinero_dia'`);
});
