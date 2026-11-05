// C03: persistencia tras reinicio, sin duplicados, procedencia y certeza, corrección sin borrar, sin secretos, y uso en decisiones.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createPool, type Db } from '../src/db.ts';
import { migrate } from '../src/migrate.ts';
import { registrarDecision } from '../src/core/metacognicion.ts';
import { buscarMemoria, corregir, elegirConMemoria, erroresDocumentados, importarHistoria, limpiarSecretos, recordar } from '../src/core/autobiografia.ts';

let db: Db;
before(async () => { db = createPool(); await migrate(db, () => {}); await db.query(`UPDATE cog_experiencias SET corregido_por = NULL WHERE agente LIKE 'prueba%'`); await db.query(`DELETE FROM cog_experiencias WHERE agente LIKE 'prueba%'`); });
after(async () => { await db.query(`UPDATE cog_experiencias SET corregido_por = NULL WHERE agente LIKE 'prueba%'`); await db.query(`DELETE FROM cog_experiencias WHERE agente LIKE 'prueba%'`); await db.end(); });

test('sin secretos: claves, tokens y correos se redactan antes de guardar', async () => {
  const r = await recordar(db, { agente: 'prueba', objetivo: 'probar api con sk-abcdefghijklmnopqrstuvwx y token: 12345', resultado: 'exito', evidencia: 'avisé a alguien@ejemplo.com, ghp_abcdefghijklmnopqrstuvwxyz0123' }, 'prueba');
  const row = (await db.query(`SELECT objetivo, evidencia FROM cog_experiencias WHERE id = $1`, [r.id])).rows[0];
  assert.doesNotMatch(row.objetivo + row.evidencia, /sk-abc|12345|alguien@|ghp_abc/);
  assert.match(row.objetivo, /\[CLAVE\]/);
  assert.deepEqual(limpiarSecretos({ a: ['password=hunter2'] }), { a: ['password: [REDACTADO]'] });
});

test('sin duplicados y certeza honesta: «verificado» sin respaldo queda como inferido', async () => {
  const e = { agente: 'prueba', objetivo: 'medir conversión de la página', resultado: 'parcial', detalle_resultado: '2 % con 50 visitas', certeza: 'verificado' };
  const a = await recordar(db, e, 'prueba'), b = await recordar(db, e, 'prueba');
  assert.equal(a.duplicado, false); assert.equal(b.duplicado, true); assert.equal(a.id, b.id);
  assert.equal(a.certeza, 'inferido'); assert.match(a.pidio_verificado!, /inferido/);
  assert.equal((await db.query(`SELECT repeticiones FROM cog_experiencias WHERE id = $1`, [a.id])).rows[0].repeticiones, 2);
  const p = await recordar(db, { ...e, detalle_resultado: 'dato del propietario', procedencia: 'propietario' }, 'propietario');
  assert.equal(p.certeza, 'verificado');
});

test('corregir un registro falso no lo borra: queda corregido y enlazado; retractar también lo conserva', async () => {
  const a = await recordar(db, { agente: 'prueba', objetivo: 'vender 10 unidades', resultado: 'exito', detalle_resultado: 'vendidas 10' }, 'prueba');
  const c = await corregir(db, a.id, { resultado: 'fallo', detalle_resultado: 'eran reservas, no ventas', leccion: 'una reserva no es una compra' }, 'el pago nunca llegó', 'agente:saturno');
  const o = (await db.query(`SELECT estado, corregido_por FROM cog_experiencias WHERE id = $1`, [a.id])).rows[0];
  assert.equal(o.estado, 'corregido'); assert.equal(o.corregido_por, c.id_nuevo);
  await assert.rejects(corregir(db, a.id, { resultado: 'exito' }, 'otra', 'x'), /ya fue corregido/);
  assert.ok(!(await buscarMemoria(db, { agente: 'prueba', texto: 'vender unidades' })).some((x) => x.id === a.id));
  assert.ok((await buscarMemoria(db, { agente: 'prueba', texto: 'vender unidades', incluir_corregidos: true })).some((x) => x.id === a.id));
  const r = await corregir(db, c.id_nuevo, { retractar: true }, 'registro de prueba', 'agente:saturno');
  assert.equal(r.estado, 'retractado');
  assert.equal((await db.query(`SELECT count(*)::int AS n FROM cog_experiencias WHERE id IN ($1, $2)`, [a.id, c.id_nuevo])).rows[0].n, 2);
});

test('sobrevive a un reinicio (nueva conexión) y se recupera por error, lección y texto', async () => {
  const a = await recordar(db, { agente: 'prueba-reinicio', objetivo: 'publicar anuncio de cartera NFC', resultado: 'fallo', detalle_resultado: 'verificación fallida: afirmó haber publicado sin hacerlo', leccion: 'un especialista solo entrega análisis; nunca afirmar acciones externas' }, 'prueba');
  await db.end(); db = createPool();
  const porError = await buscarMemoria(db, { clasificacion_error: 'verificacion', agente: 'prueba-reinicio' });
  assert.ok(porError.some((x) => x.id === a.id));
  const porTexto = await buscarMemoria(db, { texto: 'afirmar acciones externas' });
  assert.ok(porTexto.some((x) => x.id === a.id));
});

test('reconoce y evita un error documentado al decidir', async () => {
  await recordar(db, { agente: 'prueba', objetivo: 'conseguir primeras ventas de la guía', resultado: 'fallo', detalle_resultado: 'anuncios pagados: CAC 40 $ con margen de 9 $', leccion: 'anuncios pagados no son rentables con este margen' }, 'prueba');
  const adv = await erroresDocumentados(db, 'conseguir primeras ventas de la guía', 'anuncios pagados');
  assert.ok(adv.length >= 1 && /CAC/.test(adv[0].detalle));
  const sin = await elegirConMemoria(db, 'conseguir ventas', ['entrevistas a clientes', 'anuncios pagados']);
  const con = await elegirConMemoria(db, 'conseguir ventas', ['anuncios pagados', 'entrevistas a clientes']);
  assert.equal(sin.elegida, 'entrevistas a clientes'); assert.equal(con.elegida, 'entrevistas a clientes');
  assert.match(con.motivo, /anuncios pagados/);
  // La metacognición (C02) consulta la memoria: la misma estrategia queda señalada y, si el error es verificado, escalada
  await recordar(db, { agente: 'prueba', objetivo: 'conseguir primeras ventas de la guía', resultado: 'fallo', detalle_resultado: 'anuncios pagados otra vez sin ventas', leccion: 'confirmado por el propietario', procedencia: 'propietario' }, 'propietario');
  const d = await registrarDecision(db, { categoria: 'prueba:memoria', objetivo: 'conseguir primeras ventas de la guía', estrategias: [{ nombre: 'anuncios pagados' }, { nombre: 'entrevistas a clientes' }], elegida: 'anuncios pagados',
    evidencia: [{ texto: 'otros lo hacen', apoya: true }], incertidumbre: 0.3, confianza_declarada: 0.6, resultado_esperado: 'ventas' }, 'agente:a');
  assert.ok(d.alertas.some((a: any) => a.tipo === 'error_documentado'));
  assert.equal(d.estado, 'escalada'); assert.match(d.escalado!.motivo, /memoria/);
  await db.query(`DELETE FROM cog_decisiones WHERE categoria = 'prueba:memoria'`);
});

test('importa la historia real de tareas y lecciones de forma idempotente', async () => {
  const a = await importarHistoria(db, 50), b = await importarHistoria(db, 50);
  assert.ok(a.total >= b.total - b.nuevas);
  assert.equal(b.nuevas, 0);
});
