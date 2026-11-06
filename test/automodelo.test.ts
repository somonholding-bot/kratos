// C01: el automodelo distingue instalada / disponible / probada y corrige una autoevaluación incorrecta tras un fallo.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createPool, type Db } from '../src/db.ts';
import { migrate } from '../src/migrate.ts';
import { syncToolRegistry } from '../src/core/toolregistry.ts';
import { capacidad, construirAutomodelo, nivel, puedo, quienHace, registrarPrueba, sincronizarCapacidades } from '../src/core/automodelo.ts';

let db: Db;
before(async () => { db = createPool(); await migrate(db, () => {}); await syncToolRegistry(db); await sincronizarCapacidades(db);
  await db.query(`INSERT INTO cog_capacidades (capacidad, tipo, descripcion, instalada, disponible) VALUES ('herramienta:prueba_c01', 'herramienta', 'capacidad sintética de prueba', true, true) ON CONFLICT (capacidad) DO UPDATE SET pruebas_ok = 0, pruebas_fallo = 0, ultima_ok = NULL, ultimo_fallo = NULL, detalle_fallo = NULL, instalada = true, disponible = true`);
  await db.query(`DELETE FROM cog_capacidad_pruebas WHERE capacidad = 'herramienta:prueba_c01'`); });
after(async () => { await db.query(`DELETE FROM cog_capacidad_pruebas WHERE origen = 'prueba'`); await db.end(); });

test('una herramienta inexistente no existe; una registrada sin pruebas está disponible, no probada', async () => {
  const no = await capacidad(db, 'teletransporte');
  assert.equal(no.nivel, 'no_existe'); assert.equal(no.existe, false); assert.match(no.explicacion, /No tengo/);
  const nota = await capacidad(db, 'guardar_nota');
  assert.ok(['disponible', 'probada', 'degradada'].includes(nota.nivel));
  assert.equal(nota.instalada, true);
});

test('Q-LAB y CUDA se reconocen como ausentes; el motor ACD existe', async () => {
  assert.equal((await capacidad(db, 'q_lab')).nivel, 'no_existe');
  assert.equal((await capacidad(db, 'dependencia:cuda')).nivel, 'no_existe');
  assert.notEqual((await capacidad(db, 'acd')).nivel, 'no_existe');
});

test('autoevaluación incorrecta: un éxito antiguo no tapa un fallo posterior y la confianza baja', async () => {
  const cap = 'herramienta:prueba_c01';
  await registrarPrueba(db, cap, true, 'búsqueda devolvió 3 notas', 'prueba', new Date(Date.now() - 3600_000));
  const antes = await capacidad(db, cap);
  assert.equal(antes.nivel, 'probada');
  await registrarPrueba(db, cap, false, 'la bóveda no respondió', 'prueba');
  const despues = await capacidad(db, cap);
  assert.equal(despues.nivel, 'degradada'); assert.ok(despues.confianza < antes.confianza);
  const r = await puedo(db, ['prueba_c01']);
  assert.equal(r.puedo, false); assert.match(r.respuesta, /No puedo/);
  await registrarPrueba(db, cap, true, 'búsqueda repetida con éxito', 'prueba');
  assert.equal((await capacidad(db, cap)).nivel, 'probada');
  await assert.rejects(registrarPrueba(db, cap, true, '   ', 'prueba'), /evidencia/);
});

test('sabe qué agente hace una tarea y reconoce cuando ninguno encaja', async () => {
  const a = await quienHace(db, 'verificar calidad, riesgos y presupuesto de una entrega');
  assert.equal(a.agente, 'saturno');
  const b = await quienHace(db, 'xylofonar quarkiones');
  assert.equal(b.agente, null);
});

test('nivel(): sin dependencias no está disponible', () => {
  assert.equal(nivel({ instalada: true, disponible: false }), 'instalada');
  assert.equal(nivel(null), 'no_existe');
});

test('el automodelo completo se construye con datos reales y se guarda', async () => {
  const m: any = await construirAutomodelo(db);
  assert.equal(m.identidad.nombre, 'KRATOS');
  assert.ok(m.agentes.length >= 8 && m.herramientas.total > 20);
  assert.ok(m.limitaciones.some((l: string) => /q_lab/.test(l)));
  assert.ok((await db.query(`SELECT count(*)::int AS n FROM cog_automodelo`)).rows[0].n >= 1);
});
