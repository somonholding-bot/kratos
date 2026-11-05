// KSIE 01–02: descubrimiento exacto, no disponibles, solapadas, la barata insuficiente, la fiable que falla, sin herramientas y aprendizaje.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createPool, type Db } from '../src/db.ts';
import { migrate } from '../src/migrate.ts';
import { syncToolRegistry } from '../src/core/toolregistry.ts';
import { registrarPrueba } from '../src/core/automodelo.ts';
import { aprendizaje, enrutar, registrarResultado, sincronizarRegistro } from '../src/core/ksie-herramientas.ts';

let db: Db;
const limpiar = async () => { await db.query(`UPDATE ksie_selecciones SET replanificada_de = NULL`); await db.query(`DELETE FROM ksie_selecciones`); await db.query(`DELETE FROM cog_capacidad_pruebas WHERE origen IN ('prueba-ksie','ksie')`);
  await db.query(`UPDATE cog_capacidades SET pruebas_ok = 0, pruebas_fallo = 0, ultima_ok = NULL, ultimo_fallo = NULL, detalle_fallo = NULL WHERE capacidad LIKE 'herramienta:%'`); };
before(async () => { process.env.KRATOS_SIN_LLAVERO = '1'; db = createPool(); await migrate(db, () => {}); await syncToolRegistry(db); await limpiar(); await sincronizarRegistro(db); });
after(async () => { await limpiar(); delete process.env.KRATOS_SIN_LLAVERO; await db.end(); });

test('1–2 descubrimiento exacto y no disponibles identificadas con su motivo', async () => {
  const reg = (await db.query(`SELECT name FROM tool_registry`)).rows.map((r) => r.name).sort();
  const ks = (await db.query(`SELECT nombre FROM ksie_herramientas WHERE nombre NOT LIKE 'sistema:%' AND estado_motivo NOT LIKE 'ya no existe%'`)).rows.map((r) => r.nombre).sort();
  assert.deepEqual(ks, reg);
  const yt = (await db.query(`SELECT estado, estado_motivo FROM ksie_herramientas WHERE nombre = 'estado_youtube'`)).rows[0];
  assert.equal(yt.estado, 'UNAVAILABLE'); assert.match(yt.estado_motivo, /credencial kratos-google/);
  const r = await enrutar(db, { descripcion: 'leer vistas del canal', operaciones: ['leer_metricas_youtube'] }, 'prueba');
  assert.deepEqual(r.elegidas, []); assert.match(r.huecos[0].recomendacion, /Reparar o autorizar/); assert.match(r.huecos[0].accion_permitida, /no se instala/);
  const ol = (await db.query(`SELECT estado FROM ksie_herramientas WHERE nombre = 'sistema:ollama'`)).rows[0];
  if (ol) { assert.equal(ol.estado, 'DISCOVERED'); const o = await enrutar(db, { descripcion: 'texto con modelo local', operaciones: ['modelo_local_texto'] }, 'prueba'); assert.deepEqual(o.elegidas, []); }
});

test('3 herramientas solapadas: elige la de mejor fiabilidad medida', async () => {
  for (let k = 0; k < 3; k++) await registrarPrueba(db, 'herramienta:WebSearch', true, 'resultados útiles', 'prueba-ksie');
  await registrarPrueba(db, 'herramienta:WebFetch', false, 'página no cargó', 'prueba-ksie');
  await sincronizarRegistro(db);
  const r = await enrutar(db, { descripcion: 'competidores de guías de inmigración', operaciones: ['investigar_competencia'] }, 'prueba');
  assert.deepEqual(r.elegidas, ['WebSearch']);
  const wf = r.candidatas!.find((c: any) => c.herramienta === 'WebFetch');
  assert.ok(wf.estado === 'DEGRADED' && wf.puntos < r.candidatas!.find((c: any) => c.herramienta === 'WebSearch').puntos);
});

test('4 la más barata da un resultado insuficiente → replanifica con otra', async () => {
  await registrarPrueba(db, 'herramienta:investigar_sol', true, 'devolvió artículos', 'prueba-ksie');
  for (let k = 0; k < 2; k++) await registrarPrueba(db, 'herramienta:WebSearch', true, 'ok', 'prueba-ksie');
  await sincronizarRegistro(db);
  const r = await enrutar(db, { descripcion: 'estudios sobre disposición a pagar por guías legales', operaciones: ['buscar_literatura'] }, 'prueba');
  const inv = r.candidatas!.find((c: any) => c.herramienta === 'investigar_sol'), ws = r.candidatas!.find((c: any) => c.herramienta === 'WebSearch');
  assert.equal(inv.coste, 'gratis_externo'); assert.equal(ws.coste, 'suscripcion');
  const primera = r.elegidas[0];
  const x = await registrarResultado(db, r.seleccion_id, primera, 'insuficiente', '0 resultados relevantes', 'prueba');
  assert.ok(x.replanificacion); assert.notEqual(x.replanificacion.elegidas[0], primera);
  assert.equal((await db.query(`SELECT replanificada_de FROM ksie_selecciones WHERE id = $1`, [x.replanificacion.seleccion_id])).rows[0].replanificada_de, r.seleccion_id);
  await registrarResultado(db, x.replanificacion.seleccion_id, x.replanificacion.elegidas[0], 'exito', 'encontró 4 estudios', 'prueba');
});

test('5 una herramienta fiable falla → se degrada en el automodelo y se replanifica sin ella', async () => {
  for (let k = 0; k < 4; k++) await registrarPrueba(db, 'herramienta:consultar_bd', true, 'consulta ok', 'prueba-ksie');
  await sincronizarRegistro(db);
  const r = await enrutar(db, { descripcion: 'tareas abiertas por agente', operaciones: ['consultar_datos_internos'] }, 'prueba');
  assert.deepEqual(r.elegidas, ['consultar_bd']);
  const x = await registrarResultado(db, r.seleccion_id, 'consultar_bd', 'fallo', 'la base no respondió (timeout)', 'prueba');
  assert.equal((await db.query(`SELECT estado FROM ksie_herramientas WHERE nombre = 'consultar_bd'`)).rows[0].estado, 'DEGRADED');
  assert.ok(x.replanificacion.elegidas.length === 1 && x.replanificacion.elegidas[0] !== 'consultar_bd');
  await assert.rejects(registrarResultado(db, r.seleccion_id, 'consultar_bd', 'exito', 'x', 'prueba'), /ya tiene resultado/);
});

test('6 tarea que no necesita herramientas externas: ninguna llamada', async () => {
  const r = await enrutar(db, { descripcion: 'comparar dos opciones ya investigadas', operaciones: ['razonar', 'comparar_opciones'] }, 'prueba');
  assert.equal(r.sin_herramientas, true); assert.deepEqual(r.elegidas, []);
});

test('privacidad y presupuesto: «local» y «gratis» excluyen lo externo o de pago', async () => {
  const r = await enrutar(db, { descripcion: 'buscar en la web', operaciones: ['buscar_web'], presupuesto: 'gratis' }, 'prueba');
  assert.deepEqual(r.elegidas, []); assert.ok(r.candidatas!.find((c: any) => c.herramienta === 'WebSearch').descartada.some((d: string) => /presupuesto/.test(d)));
  const l = await enrutar(db, { descripcion: 'datos internos', operaciones: ['consultar_datos_internos'], privacidad: 'local' }, 'prueba');
  assert.ok(l.elegidas.length >= 1);
});

test('aprendizaje persistente: sobrevive a un reinicio y mide por operación', async () => {
  await db.end(); db = createPool();
  const a = await aprendizaje(db);
  assert.ok(a.selecciones_resueltas >= 3, JSON.stringify(a)); assert.ok(a.sin_herramientas >= 1);
  assert.ok(a.por_operacion.some((o: any) => o.operacion === 'buscar_literatura' && o.exito >= 1 && o.fallo >= 1));
});
