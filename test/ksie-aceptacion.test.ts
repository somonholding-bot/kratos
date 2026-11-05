// KSIE pruebas de aceptación transversales: 4 sin llamadas innecesarias, 20 funcionalidad previa, 21 cómputo controlado, 22 recuperación.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createPool, type Db } from '../src/db.ts';
import { migrate } from '../src/migrate.ts';
import { syncToolRegistry } from '../src/core/toolregistry.ts';
import { enrutar, sincronizarRegistro } from '../src/core/ksie-herramientas.ts';
import * as K from '../src/core/ksie.ts';
import { TOOLS, CEO_TOOLS, toolCount } from '../src/core/brain.ts';

let db: Db;
before(async () => { process.env.KRATOS_SIN_LLAVERO = '1'; db = createPool(); await migrate(db, () => {}); await syncToolRegistry(db); await sincronizarRegistro(db); await K.sembrarPreguntas(db); });
after(async () => { await db.query(`DELETE FROM ksie_respuestas WHERE actor = 'acept'`); await db.query(`DELETE FROM ksie_oportunidades WHERE creado_por = 'acept'`); await db.query(`DELETE FROM ksie_selecciones WHERE actor = 'acept'`); delete process.env.KRATOS_SIN_LLAVERO; await db.end(); });

test('4 y 21: conjunto mínimo de herramientas y profundidad limitada (sin llamadas ni preguntas de más)', async () => {
  const r = await enrutar(db, { descripcion: 'precios de competidores', operaciones: ['investigar_competencia', 'buscar_precios'] }, 'acept');
  assert.ok(r.elegidas.length <= 2);   // WebSearch cubre ambas: no se añade WebFetch
  const o = await K.crearOportunidad(db, { nombre: 'Prueba aceptación barata', tipo: 'servicio_local', descripcion: 'servicio barato y reversible', incertidumbre: 0.3, inversion_usd: 50, riesgo: 0.1, irreversibilidad: 0.1 }, 'acept');
  assert.equal((await K.preguntasPara(db, o.id)).total, 10);
  for (const f of ['ksie', 'ksie-herramientas']) assert.doesNotMatch(fs.readFileSync(`src/core/${f}.ts`, 'utf8'), /@anthropic-ai|new Anthropic|fetch\(/, f);   // sin gasto de API
});

test('22 recuperación tras interrupción: las respuestas parciales persisten y se reanuda en la siguiente pendiente', async () => {
  const o = (await K.crearOportunidad(db, { nombre: 'Prueba aceptación reanudar', tipo: 'agricultura', descripcion: 'microverdes para restaurantes', incertidumbre: 0.3, inversion_usd: 50, riesgo: 0.1, irreversibilidad: 0.1 }, 'acept')).id;
  await K.responder(db, { oportunidad_id: o, pregunta_id: 'Q001', respuesta: 'Los restaurantes no encuentran microverdes frescos', evidencia: '4 entrevistas', fuente: 'tarea #1', etiqueta: 'OBSERVED', confianza: 0.6 }, 'acept');
  await db.end(); db = createPool();
  const p = await K.preguntasPara(db, o);
  assert.equal(p.respondidas, 1); assert.equal(p.sin_resolver[0].id, 'Q002');
});

test('20 la funcionalidad previa se conserva: herramientas registradas, ≤ 20 estrictas y KSIE en el CEO', () => {
  const c = toolCount(); assert.ok(c.strict <= 20, JSON.stringify(c));
  assert.ok(TOOLS.some((t) => t.name === 'estrategia_ksie') && CEO_TOOLS.includes('estrategia_ksie'));
  for (const n of ['acd', 'investigar_sol', 'fabrica_aion', 'crear_tarea', 'automodelo']) assert.ok(TOOLS.some((t) => t.name === n), n);
});
