// Meta Ads (simulado: nunca toca Meta): el dinero sale del presupuesto de pruebas aprobado, con topes, destino de KRATOS y texto honesto.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createPool, type Db } from '../src/db.ts';
import { migrate } from '../src/migrate.ts';
import { allocate } from '../src/core/budget.ts';
import { CUENTA_PRUEBAS, saldoPruebas } from '../src/core/presupuesto-pruebas.ts';
import { crearOportunidad, disenarExperimento, sembrarPreguntas } from '../src/core/ksie.ts';
import { lanzarCampana, resultados, detener, type Fetcher } from '../src/core/meta-ads.ts';

let db: Db; const llamadas: string[] = []; let falla = false;
const falso: Fetcher = async (url, init) => { const u = String(url); llamadas.push(`${init.method} ${u.replace(/^.*v21\.0/, '')}`); if (falla && u.includes('/ads')) return new Response(JSON.stringify({ error: { message: 'rechazado' } }), { status: 400 });
  const j = (o: any) => new Response(JSON.stringify(o)); if (u.includes('/insights')) return j({ data: [{ spend: '12.50', impressions: '4000', clicks: '90', ctr: '2.25' }] });
  if (u.includes('/campaigns')) return j({ id: 'c1' }); if (u.includes('/adsets')) return j({ id: 's1' }); if (u.includes('/adcreatives')) return j({ id: 'cr1' }); if (u.includes('/ads')) return j({ id: 'a1' }); return j({ success: true }); };
const limpiar = async () => {
  await db.query(`DELETE FROM meta_campanas`); await db.query(`DELETE FROM experiments WHERE oportunidad_id IS NOT NULL`); await db.query(`DELETE FROM approvals WHERE account_label = $1 OR scope->>'tipo' = 'experimento_ksie'`, [CUENTA_PRUEBAS]);
  await db.query(`DELETE FROM ksie_oportunidades WHERE creado_por = 'prueba-meta'`); await db.query(`DELETE FROM paginas_web WHERE slug = 'prueba-meta'`);
  const a = (await db.query(`SELECT id FROM budget_accounts WHERE label = $1`, [CUENTA_PRUEBAS])).rows[0]; if (a) { await db.query(`DELETE FROM budget_movements WHERE account_id = $1`, [a.id]); await db.query(`DELETE FROM budget_accounts WHERE id = $1`, [a.id]); }
  await db.query(`DELETE FROM system_state WHERE key IN ('meta_ad_account','meta_page_id')`);
};
const base = (e: number, o: any = {}) => ({ experimento_id: e, nombre: 'Guía de sueño', destino: 'https://kratos.example/prueba-meta/', titulo: 'Recuerda tus sueños', texto: 'Un programa de 7 noches para recordar y anotar tus sueños.', presupuesto_diario_usd: 10, dias: 3, ...o });
before(async () => { process.env.KRATOS_META_TOKEN = 'falso'; db = createPool(); await migrate(db, () => {}); await sembrarPreguntas(db); await limpiar();
  await db.query(`INSERT INTO system_state (key, value) VALUES ('meta_ad_account', '"123"'), ('meta_page_id', '"456"') ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`);
  await db.query(`INSERT INTO paginas_web (slug, url, titulo, cta_url, creado_por) VALUES ('prueba-meta', 'https://kratos.example/prueba-meta/', 't', 'https://buy.stripe.com/x', 'prueba')`); });
after(async () => { await limpiar(); delete process.env.KRATOS_META_TOKEN; await db.end(); });

test('lanza solo con presupuesto aprobado, dentro de topes, hacia una página de KRATOS y con texto honesto', async () => {
  const o = (await crearOportunidad(db, { nombre: 'Prueba Meta', tipo: 'producto_digital', descripcion: 'guía', origen: 'kratos' }, 'prueba-meta')).id;
  const e = (await disenarExperimento(db, { oportunidad_id: o, tipo: 'anuncio_pequeno', hipotesis: 'un anuncio trae visitas', metrica: 'compras', linea_base: '0', presupuesto_usd: 0, resultado_previsto: 2, umbral_exito: 2, umbral_fracaso: 0, dias: 3 }, 'agente:jupiter')).experimento_id;
  await assert.rejects(lanzarCampana(db, base(e), 'agente:jupiter', falso), /no hay presupuesto de pruebas aprobado/);
  await allocate(db, CUENTA_PRUEBAS, 10000, new Date(Date.now() + 30 * 86_400_000).toISOString(), 'prueba:meta', 'propietario', null);
  await assert.rejects(lanzarCampana(db, base(e, { presupuesto_diario_usd: 20 }), 'agente:jupiter', falso), /entre 1 y 15/);
  await assert.rejects(lanzarCampana(db, base(e, { presupuesto_diario_usd: 15, dias: 4 }), 'agente:jupiter', falso), /Tope por campaña/);
  await assert.rejects(lanzarCampana(db, base(e, { texto: 'Resultados garantizados al 100 % en una noche' }), 'agente:jupiter', falso), /garantizar/);
  await assert.rejects(lanzarCampana(db, base(e, { destino: 'https://otra-web.com/' }), 'agente:jupiter', falso), /creado por KRATOS/);
  assert.equal((await saldoPruebas(db)).disponible_cents, 10000);   // nada se reservó por los rechazos
  const r = await lanzarCampana(db, base(e), 'agente:jupiter', falso);
  assert.equal(r.lanzada, true); assert.equal(r.gasto_maximo_usd, 30); assert.equal((await saldoPruebas(db)).disponible_cents, 7000);
  assert.ok(llamadas.some((l) => l.includes('/campaigns')) && llamadas.filter((l) => l.includes('ACTIVE') || l.startsWith('POST /c1')).length >= 1);
  await assert.rejects(lanzarCampana(db, base(e), 'agente:jupiter', falso), /ya tiene una campaña/);
  const res = await resultados(db, e, falso); assert.equal(res.clics, 90); assert.match(res.nota, /no son compras/);
  const d = await detener(db, e, 'agente:jupiter', falso); assert.equal(d.gasto_real_usd, 12.5);
  const s = await saldoPruebas(db); assert.equal(s.gastado_cents, 1250); assert.equal(s.disponible_cents, 8750);   // devuelve lo no gastado
});

test('si Meta rechaza el anuncio, la reserva se devuelve', async () => {
  const o = (await crearOportunidad(db, { nombre: 'Prueba Meta 2', tipo: 'producto_digital', descripcion: 'otra guía', origen: 'kratos' }, 'prueba-meta')).id;
  const e = (await disenarExperimento(db, { oportunidad_id: o, tipo: 'anuncio_pequeno', hipotesis: 'otro anuncio', metrica: 'compras', linea_base: '0', presupuesto_usd: 0, resultado_previsto: 2, umbral_exito: 2, umbral_fracaso: 0, dias: 3 }, 'agente:jupiter')).experimento_id;
  const antes = (await saldoPruebas(db)).disponible_cents; falla = true;
  await assert.rejects(lanzarCampana(db, base(e), 'agente:jupiter', falso), /rechazado/); falla = false;
  assert.equal((await saldoPruebas(db)).disponible_cents, antes);
});
