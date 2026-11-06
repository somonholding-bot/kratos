// Stripe (simulado: nunca toca la cuenta real) y presupuesto mensual de pruebas de 100 USD.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createPool, type Db } from '../src/db.ts';
import { migrate } from '../src/migrate.ts';
import { allocate } from '../src/core/budget.ts';
import { crearProducto, sincronizarVentas, estado, type Fetcher } from '../src/core/stripe.ts';
import { CUENTA_PRUEBAS, pedirAmpliacion, pedirAsignacionMensual, saldoPruebas } from '../src/core/presupuesto-pruebas.ts';
import { crearOportunidad, disenarExperimento, resultadoExperimento, beneficioReal, sembrarPreguntas } from '../src/core/ksie.ts';

let db: Db;
const llamadas: any[] = [];
const falso: Fetcher = async (url, init) => {
  llamadas.push({ url, body: String(init.body ?? '') });
  const u = String(url);
  const j = (o: any) => new Response(JSON.stringify(o), { status: 200 });
  if (u.includes('/products')) return j({ id: 'prod_1' });
  if (u.includes('/prices')) return j({ id: 'price_1' });
  if (u.includes('/payment_links')) return j({ id: 'plink_1', url: 'https://buy.stripe.com/test_1' });
  if (u.includes('/balance')) return j({ available: [{ currency: 'usd', amount: 5000 }] });
  if (u.includes('/charges')) return j({ has_more: false, data: [
    { id: 'ch_k1', amount: 2900, amount_refunded: 0, currency: 'usd', status: 'succeeded', created: Math.floor(Date.now() / 1000), metadata: { kratos: '1' }, balance_transaction: { fee: 114 } },
    { id: 'ch_otro', amount: 9900, amount_refunded: 0, currency: 'usd', status: 'succeeded', created: Math.floor(Date.now() / 1000), metadata: {}, balance_transaction: { fee: 300 } }] });
  return new Response('{}', { status: 404 });
};
const limpiar = async () => {
  await db.query(`DELETE FROM metrics WHERE source LIKE 'stripe%'`); await db.query(`DELETE FROM stripe_productos`);
  await db.query(`DELETE FROM experiments WHERE oportunidad_id IS NOT NULL`);
  await db.query(`DELETE FROM approvals WHERE account_label = $1 OR scope->>'tipo' = 'experimento_ksie'`, [CUENTA_PRUEBAS]); await db.query(`DELETE FROM ksie_oportunidades WHERE creado_por = 'prueba-ventas'`);
  const a = (await db.query(`SELECT id FROM budget_accounts WHERE label = $1`, [CUENTA_PRUEBAS])).rows[0];
  if (a) { await db.query(`DELETE FROM budget_movements WHERE account_id = $1`, [a.id]); await db.query(`DELETE FROM budget_accounts WHERE id = $1`, [a.id]); }
};
before(async () => { process.env.KRATOS_STRIPE_KEY = 'rk_test_falsa'; db = createPool(); await migrate(db, () => {}); await sembrarPreguntas(db); await limpiar(); });
after(async () => { await limpiar(); delete process.env.KRATOS_STRIPE_KEY; await db.end(); });

test('Stripe: crea producto con enlace de pago marcado kratos=1 y exige decir qué recibe el comprador', async () => {
  await assert.rejects(crearProducto(db, { nombre: 'Guía', descripcion: 'x', entrega: '', precio_usd: 19 }, 'agente:jupiter', falso), /qué recibe/);
  await assert.rejects(crearProducto(db, { nombre: 'Guía', descripcion: 'Resultados garantizados', entrega: 'PDF', precio_usd: 19 }, 'agente:jupiter', falso), /garantizar/);
  const r = await crearProducto(db, { nombre: 'Guía de 7 noches', descripcion: 'Programa de sueño lúcido', entrega: 'PDF y audios al instante', precio_usd: 29, preventa: false }, 'agente:jupiter', falso);
  assert.equal(r.enlace_de_pago, 'https://buy.stripe.com/test_1');
  assert.ok(llamadas.some((l) => l.url.includes('/payment_links') && /metadata%5Bkratos%5D=1/.test(l.body)));
  assert.equal((await estado(falso)).modo, 'pruebas');
});

test('Stripe: solo cuenta las ventas de KRATOS, con su comisión como coste; idempotente; alimenta el beneficio real', async () => {
  const a = await sincronizarVentas(db, falso), b = await sincronizarVentas(db, falso);
  assert.equal(a.nuevas, 1); assert.equal(b.nuevas, 0);
  const m = (await db.query(`SELECT metric, value FROM metrics WHERE source LIKE 'stripe%' ORDER BY metric`)).rows;
  assert.deepEqual(m.map((x) => [x.metric, Number(x.value)]), [['costes_usd', 1.14], ['ingresos_usd', 29]]);
  const r = await beneficioReal(db); assert.ok(r.ingresos_observados >= 29);
});

test('presupuesto de pruebas: se pide una vez al propietario y, aprobado, KRATOS gasta en experimentos sin preguntar y sin pasarse', async () => {
  const p = await pedirAsignacionMensual(db);
  assert.equal(p.pedida, true); assert.equal(p.estado, 'pendiente');   // dinero: siempre lo decide el propietario
  assert.equal((await pedirAsignacionMensual(db)).pedida, false);
  await allocate(db, CUENTA_PRUEBAS, 10000, new Date(Date.now() + 30 * 86_400_000).toISOString(), 'prueba:asignacion', 'propietario', null);
  const o = (await crearOportunidad(db, { nombre: 'Prueba presupuesto anuncios', tipo: 'producto_digital', descripcion: 'guía', origen: 'kratos' }, 'prueba-ventas')).id;
  const e = await disenarExperimento(db, { oportunidad_id: o, tipo: 'anuncio_pequeno', hipotesis: 'un anuncio de 30 USD trae 3 compras', metrica: 'compras', linea_base: '0', presupuesto_usd: 30, resultado_previsto: 3, umbral_exito: 3, umbral_fracaso: 0, dias: 7 }, 'agente:jupiter');
  assert.equal(e.presupuesto_pruebas.ok, true); assert.equal(e.requiere_autorizacion, true);   // anuncio = acción externa, pero el dinero ya está autorizado
  assert.equal((await saldoPruebas(db)).disponible_cents, 7000);
  const caro = await disenarExperimento(db, { oportunidad_id: o, tipo: 'anuncio_pequeno', hipotesis: 'un anuncio grande', metrica: 'compras', linea_base: '0', presupuesto_usd: 90, resultado_previsto: 5, umbral_exito: 5, umbral_fracaso: 0, dias: 7 }, 'agente:jupiter');
  assert.equal(caro.presupuesto_pruebas.ok, false); assert.equal(caro.aprobacion!.estado, 'pendiente');   // no cabe: lo decide el propietario
  await db.query(`UPDATE approvals SET status = 'aprobada' WHERE scope->>'experimento' = $1`, [String(e.experimento_id)]);
  await resultadoExperimento(db, e.experimento_id, { valor: 1, tipo_evidencia: 'compra', evidencia: '1 compra', fuente: 'stripe', gasto_real_usd: 25 }, 'agente:jupiter');
  const s = await saldoPruebas(db); assert.equal(s.gastado_cents, 2500); assert.equal(s.disponible_cents, 7500);
});

test('ampliación: se puede pedir más presupuesto, pero solo con justificación y resultados; la decide el propietario', async () => {
  await db.query(`UPDATE approvals SET status = 'rechazada' WHERE status = 'pendiente' AND account_label = $1`, [CUENTA_PRUEBAS]);
  await assert.rejects(pedirAmpliacion(db, { usd: 1000, justificacion: 'x'.repeat(130) }, 'agente:jupiter'), /entre 10 y 500/);
  await assert.rejects(pedirAmpliacion(db, { usd: 100, justificacion: 'quiero más' }, 'agente:jupiter'), /justificación/);
  await assert.rejects(pedirAmpliacion(db, { usd: 100, justificacion: 'El experimento de la guía trajo 3 compras con 30 USD de anuncios; con 100 USD más se puede repetir en otro público y medir si el coste por compra se mantiene por debajo del precio.' }, 'agente:jupiter'), /experimento con resultados|Todavía quedan/);
  const o = (await crearOportunidad(db, { nombre: 'Prueba ampliación', tipo: 'producto_digital', descripcion: 'guía', origen: 'kratos' }, 'prueba-ventas')).id;
  const e = (await disenarExperimento(db, { oportunidad_id: o, tipo: 'preventa', hipotesis: 'preventa', metrica: 'compras', linea_base: '0', presupuesto_usd: 0, resultado_previsto: 3, umbral_exito: 3, umbral_fracaso: 1, dias: 7 }, 'agente:jupiter')).experimento_id;
  await db.query(`UPDATE approvals SET status = 'aprobada' WHERE scope->>'experimento' = $1`, [String(e)]);
  await resultadoExperimento(db, e, { valor: 3, tipo_evidencia: 'compra', evidencia: '3 compras', fuente: 'stripe' }, 'agente:jupiter');
  const r = await pedirAmpliacion(db, { usd: 100, justificacion: 'El experimento de la guía trajo 3 compras con 30 USD de anuncios; con 100 USD más se puede repetir en otro público y medir si el coste por compra se mantiene por debajo del precio.', experimento_ids: [e] }, 'agente:jupiter');
  assert.equal(r.pedida, true); assert.equal(r.estado, 'pendiente');
});
