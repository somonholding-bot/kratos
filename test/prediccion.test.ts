// C05: predicción registrada antes de observar e inmutable, error de predicción, revisión y cambio de una decisión futura por ese error.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createPool, type Db } from '../src/db.ts';
import { migrate } from '../src/migrate.ts';
import { decidir, ejecutarBanco, generador, historial, observar, predecir, creencia } from '../src/core/prediccion.ts';

let db: Db;
const limpiar = async () => { await db.query(`DELETE FROM cog_predicciones WHERE contexto LIKE 'prueba:%'`); await db.query(`DELETE FROM cog_creencias WHERE contexto LIKE 'prueba:%'`); };
before(async () => { db = createPool(); await migrate(db, () => {}); await limpiar(); });
after(async () => { await limpiar(); await db.end(); });

test('la predicción se registra antes de observar y no se puede editar ni re-observar', async () => {
  const p = await predecir(db, { contexto: 'prueba:inmutable', clave: 'a', prior: { media: 1, varianza: 1, ruido: 0.5 } }, 'prueba');
  assert.ok(p.rango[0] < 1 && p.rango[1] > 1 && p.incertidumbre > 1);
  await assert.rejects(db.query(`UPDATE cog_predicciones SET valor = 5 WHERE id = $1`, [p.id]), /no se modifica/);
  await assert.rejects(observar(db, p.id, 2, '', 'prueba'), /evidencia/);
  const o = await observar(db, p.id, 2, 'medición', 'prueba');
  assert.equal(o.error, 1); assert.equal(o.dentro_rango, true);
  await assert.rejects(observar(db, p.id, 3, 'otra', 'prueba'), /ya tiene observación/);
  await assert.rejects(db.query(`UPDATE cog_predicciones SET observado = 9 WHERE id = $1`, [p.id]), /ya está registrada/);
  const row = (await db.query(`SELECT registrada_at < observado_at AS antes FROM cog_predicciones WHERE id = $1`, [p.id])).rows[0];
  assert.equal(row.antes, true);
});

test('una decisión futura cambia por el error de predicción anterior', async () => {
  const ctx = 'prueba:cambio';
  await creencia(db, ctx, 'canal_A', { media: 0.8, varianza: 0.04, ruido: 0.1 });
  await creencia(db, ctx, 'canal_B', { media: 0.5, varianza: 0.04, ruido: 0.1 });
  const d1 = await decidir(db, ctx, ['canal_A', 'canal_B']);
  assert.equal(d1.elegida, 'canal_A');
  const p = await predecir(db, { contexto: ctx, clave: 'canal_A', decision: 'usar canal A' }, 'prueba');
  const o = await observar(db, p.id, 0.1, 'conversión medida 10 %', 'prueba');
  assert.equal(o.dentro_rango, false); assert.match(o.revision, /FUERA del rango/); assert.ok(Math.abs(o.sorpresa) > 2);
  const d2 = await decidir(db, ctx, ['canal_A', 'canal_B']);
  assert.equal(d2.elegida, 'canal_B'); // cambió por el error de predicción
  assert.ok(d2.puntuaciones.find((x) => x.opcion === 'canal_A')!.media < 0.5);
});

test('banco determinista (bandido con semilla): reproducible, encuentra el mejor brazo y el error baja', async () => {
  const cfg = { medias: { a: 0.2, b: 0.5, c: 0.9 }, ruido: 0.2, prior: { media: 0.5, varianza: 0.25 }, pasos: 40, semilla: 42, exploracion: 6 };
  const r1 = await ejecutarBanco(db, { ...cfg, contexto: 'prueba:banco1' }, 'prueba');
  const r2 = await ejecutarBanco(db, { ...cfg, contexto: 'prueba:banco2' }, 'prueba');
  assert.deepEqual(r1.traza.map((x) => x.eleccion), r2.traza.map((x) => x.eleccion)); // reproducible
  assert.equal(r1.ultima_eleccion, 'c'); assert.equal(r1.mejor_real, 'c');
  assert.ok(r1.historial.error_segunda_mitad! < r1.historial.error_primera_mitad!, JSON.stringify(r1.historial));
  assert.ok(r1.historial.cobertura_rango_95! >= 0.8);
  const h = await historial(db, 'prueba:banco1');
  assert.equal(h.predicciones, 40); assert.equal(h.pendientes_de_observar, 0);
  const g1 = generador(7), g2 = generador(7); assert.equal(g1.u(), g2.u());
});
