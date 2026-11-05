// C04: un objetivo activo, subtareas en secuencia, propiedad y traspasos, conflictos, presupuesto y cierre solo con artefacto independiente.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createPool, type Db } from '../src/db.ts';
import { migrate } from '../src/migrate.ts';
import { activar, aVerificacion, cerrarSinExito, completar, conflicto, consumir, estadoEspacio, explicar, leer, proponer, rehacer, resolverConflicto, traspasar } from '../src/core/espacio.ts';

let db: Db;
const limpiar = async () => { for (const t of ['cog_mensajes', 'cog_conflictos', 'cog_transiciones']) await db.query(`DELETE FROM ${t}`); await db.query(`DELETE FROM cog_objetivos WHERE padre_id IS NOT NULL`); await db.query(`DELETE FROM cog_objetivos`); };
before(async () => { db = createPool(); await migrate(db, () => {}); await limpiar(); });
after(async () => { await limpiar(); await db.end(); });

const obj = (o: any = {}) => ({ titulo: 'Validar demanda de guías de inmigración', criterio_exito: '20 entrevistas y 3 preventas', propietario: 'mercurio', aceptacion: 'mayor valor esperado de la cartera', ...o });

test('un solo objetivo principal activo y propuestas redundantes evitadas', async () => {
  const a = await proponer(db, obj(), 'kratos');
  const dup = await proponer(db, obj({ titulo: 'validar la demanda de guías de inmigración' }), 'kratos');
  assert.equal(dup.redundante, true); assert.equal(dup.id, a.id);
  const b = await proponer(db, obj({ titulo: 'Estudiar talleres de reparación locales', propietario: 'jupiter' }), 'kratos');
  await activar(db, a.id, 'kratos');
  await assert.rejects(activar(db, b.id, 'kratos'), /Ya hay un objetivo principal activo/);
  await assert.rejects(db.query(`UPDATE cog_objetivos SET estado = 'ACTIVE' WHERE id = $1`, [b.id]), /cog_un_objetivo_activo/); // la base lo impide aunque se salte el código
  assert.equal((await estadoEspacio(db)).objetivo_activo.id, a.id);
  await assert.rejects(proponer(db, { titulo: 'x', propietario: 'y', criterio_exito: 'z' }, 'kratos'), /aceptacion/);
});

test('subtareas en secuencia, traspaso con procedencia e información priorizada', async () => {
  const p = (await estadoEspacio(db)).objetivo_activo;
  const s1 = await proponer(db, obj({ padre_id: p.id, titulo: 'Guion de entrevistas', propietario: 'luna' }), 'kratos');
  const s2 = await proponer(db, obj({ padre_id: p.id, titulo: 'Hacer 20 entrevistas', propietario: 'mercurio' }), 'kratos');
  await assert.rejects(activar(db, s2.id, 'kratos'), /secuencia/);
  await activar(db, s1.id, 'kratos');
  await assert.rejects(traspasar(db, s1.id, 'venus', 'x', 'mercurio'), /Solo el propietario/);
  await traspasar(db, s1.id, 'venus', 'falta revisar el tono; borrador en informes/guion.md', 'luna');
  const m = await leer(db, 'venus');
  assert.ok(m[0].tipo === 'traspaso' && m[0].procedencia === 'luna' && /borrador/.test(m[0].contenido));
  assert.equal((await leer(db, 'venus')).length, 0); // ya leído
  await assert.rejects(aVerificacion(db, s1.id, 'luna', 'hecho'), /Solo el propietario/);
  await aVerificacion(db, s1.id, 'venus', 'guion de 12 preguntas');
  await assert.rejects(completar(db, s1.id, { tipo: 'informe', ref: 'r', verificador: 'venus', resultado: 'ok' }, 'venus'), /distinto del propietario/);
  await assert.rejects(completar(db, s1.id, { tipo: '', ref: '', verificador: 'saturno', resultado: 'ok' } as any, 'saturno'), /artefacto/);
  await assert.rejects(completar(db, s1.id, { tipo: 'checklist', ref: 'c', verificador: 'saturno', resultado: 'fallo' }, 'saturno'), /no fue ok/);
  await rehacer(db, s1.id, 'faltan preguntas de precio', 'saturno');
  await aVerificacion(db, s1.id, 'venus', 'guion con preguntas de precio');
  await completar(db, s1.id, { tipo: 'checklist', ref: 'tarea 999', verificador: 'saturno', resultado: 'ok' }, 'saturno');
  await activar(db, s2.id, 'kratos');
});

test('conflictos bloquean el cierre; una parte no se lo resuelve sola', async () => {
  const p = (await estadoEspacio(db)).objetivo_activo;
  const s2 = (await estadoEspacio(db)).subtareas.find((s: any) => s.estado === 'ACTIVE');
  const c = await conflicto(db, s2.id, ['mercurio', 'jupiter'], 'ambos quieren entrevistar a los mismos clientes', 'mercurio');
  await aVerificacion(db, s2.id, 'mercurio', '20 entrevistas');
  await assert.rejects(completar(db, s2.id, { tipo: 'transcripciones', ref: 'x', verificador: 'saturno', resultado: 'ok' }, 'saturno'), /conflictos abiertos/);
  await assert.rejects(resolverConflicto(db, c.id, 'yo gano', 'mercurio'), /no lo resuelve sola/);
  await resolverConflicto(db, c.id, 'mercurio hace particulares, jupiter talleres', 'kratos');
  await completar(db, s2.id, { tipo: 'transcripciones', ref: 'informes/entrevistas', verificador: 'saturno', resultado: 'ok' }, 'saturno');
  await aVerificacion(db, p.id, 'mercurio', 'demanda validada: 3 preventas');
  await completar(db, p.id, { tipo: 'pagos', ref: 'stripe 3 cobros', verificador: 'saturno', resultado: 'ok' }, 'saturno');
  const e = await explicar(db, p.id);
  assert.equal(e.estado, 'COMPLETED'); assert.match(e.por_que_se_acepto, /valor esperado/); assert.equal(e.cierre!.artefacto.verificador, 'saturno');
  assert.ok(e.historial.length >= 4);
});

test('presupuesto agotado bloquea; cerrar un padre cancela sus subtareas; transiciones ilegales rechazadas', async () => {
  const a = await proponer(db, obj({ titulo: 'Prototipo de soporte para bicicletas', propietario: 'jupiter', presupuesto: { usd: 50 } }), 'kratos');
  await activar(db, a.id, 'kratos');
  const s = await proponer(db, obj({ padre_id: a.id, titulo: 'pedir presupuestos a talleres', propietario: 'jupiter' }), 'kratos');
  assert.equal((await consumir(db, a.id, { usd: 30 }, 'jupiter')).bloqueado, false);
  const r = await consumir(db, a.id, { usd: 25 }, 'jupiter');
  assert.equal(r.bloqueado, true);
  const e = await explicar(db, a.id);
  assert.equal(e.estado, 'BLOCKED'); assert.match(e.sin_resolver!, /Presupuesto agotado/);
  await cerrarSinExito(db, a.id, 'CANCELLED', 'sin presupuesto aprobado', 'kratos');
  assert.equal((await explicar(db, s.id)).estado, 'CANCELLED');
  await assert.rejects(activar(db, a.id, 'kratos'), /no permitida/);
  await assert.rejects(cerrarSinExito(db, a.id, 'FAILED', '', 'kratos'), /no permitida|motivo/);
});
