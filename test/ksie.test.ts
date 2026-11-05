// KSIE 03–08: marco de 100 preguntas, selección adaptativa, evidencia, crítica, fijación, cartera mixta, finanzas, experimentos,
// memoria estratégica, permisos, un objetivo a la vez y cambio de recomendación por evidencia.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createPool, type Db } from '../src/db.ts';
import { migrate } from '../src/migrate.ts';
import { syncToolRegistry } from '../src/core/toolregistry.ts';
import { sincronizarRegistro } from '../src/core/ksie-herramientas.ts';
import * as K from '../src/core/ksie.ts';

let db: Db; const ids: Record<string, number> = {};
const limpiar = async () => {
  await db.query(`DELETE FROM ksie_recomendaciones`); await db.query(`DELETE FROM ksie_respuestas`); await db.query(`DELETE FROM ksie_modelos_financieros`);
  await db.query(`DELETE FROM experiments WHERE oportunidad_id IS NOT NULL`); await db.query(`DELETE FROM approvals WHERE scope->>'tipo' = 'experimento_ksie'`);
  await db.query(`DELETE FROM ksie_oportunidades`); await db.query(`DELETE FROM cog_decisiones WHERE categoria = 'ksie:recomendacion'`);
  await db.query(`DELETE FROM cog_predicciones WHERE contexto LIKE 'ksie:%'`); await db.query(`DELETE FROM cog_creencias WHERE contexto LIKE 'ksie:%'`);
  await db.query(`UPDATE cog_experiencias SET corregido_por = NULL WHERE procedencia = 'ksie'`); await db.query(`DELETE FROM cog_experiencias WHERE procedencia = 'ksie'`);
  for (const t of ['cog_mensajes', 'cog_conflictos', 'cog_transiciones']) await db.query(`DELETE FROM ${t}`); await db.query(`DELETE FROM cog_objetivos WHERE padre_id IS NOT NULL`); await db.query(`DELETE FROM cog_objetivos`);
};
before(async () => { process.env.KRATOS_SIN_LLAVERO = '1'; db = createPool(); await migrate(db, () => {}); await syncToolRegistry(db); await sincronizarRegistro(db); await K.sembrarPreguntas(db); await limpiar(); });
after(async () => { await limpiar(); delete process.env.KRATOS_SIN_LLAVERO; await db.end(); });

const ev = (o: any = {}) => ({ beneficio_neto_mensual: { min: -500, base: 2000, max: 6000 }, capital_usd: { min: 500, base: 1500, max: 3000 }, meses_primer_ingreso: { min: 1, base: 2, max: 4 },
  evidencia_demanda: 0.5, dificultad: 0.4, competencia: 0.5, defensibilidad: 0.4, distribucion: 0.5, riesgo_baja: 0.3, encaje: 0.6, ...o });

test('7 marco completo: 100 preguntas, 10 categorías × 10, 10 críticas, con todos los campos', async () => {
  const q = (await db.query(`SELECT categoria, count(*)::int AS n, count(*) FILTER (WHERE critica_nivel1)::int AS c FROM ksie_preguntas GROUP BY 1 ORDER BY 1`)).rows;
  assert.equal(q.length, 10); for (const c of q) assert.equal(c.n, 10);
  assert.equal(q.reduce((s, c) => s + c.c, 0), 10);
  const vacias = (await db.query(`SELECT count(*)::int AS n FROM ksie_preguntas WHERE texto = '' OR relevancia = '' OR evidencia_necesaria = '' OR cardinality(operaciones) = 0`)).rows[0].n;
  assert.equal(vacias, 0);
});

test('13 cartera mixta software y mundo físico; 8 selección adaptativa por riesgo e inversión', async () => {
  ids.app = (await K.crearOportunidad(db, { nombre: 'App de horóscopo con suscripción', tipo: 'software', descripcion: 'app móvil con suscripción mensual', origen: 'propietario_sugerencia', incertidumbre: 0.4, inversion_usd: 100, riesgo: 0.3, irreversibilidad: 0.1 }, 'agente:jupiter')).id;
  ids.taller = (await K.crearOportunidad(db, { nombre: 'Soportes de bicicleta impresos en 3D para tiendas locales', tipo: 'producto_fisico', descripcion: 'fabricación bajo pedido para tiendas de bicicletas', origen: 'kratos', incertidumbre: 0.6, inversion_usd: 800, riesgo: 0.4, irreversibilidad: 0.3 }, 'agente:jupiter')).id;
  ids.servicio = (await K.crearOportunidad(db, { nombre: 'Mantenimiento preventivo de climatización para comercios', tipo: 'servicio_local', descripcion: 'servicio recurrente a pequeños comercios', origen: 'kratos', incertidumbre: 0.5, inversion_usd: 3000, riesgo: 0.5, irreversibilidad: 0.5 }, 'agente:jupiter')).id;
  assert.equal((await K.preguntasPara(db, ids.app)).nivel, 1); assert.equal((await K.preguntasPara(db, ids.app)).total, 10);
  const t = await K.preguntasPara(db, ids.taller); assert.equal(t.nivel, 2); assert.equal(t.total, 50); assert.ok(t.sin_resolver.slice(10).some((q: any) => q.categoria === 'H'));
  const s = await K.preguntasPara(db, ids.servicio); assert.equal(s.nivel, 3); assert.equal(s.total, 100); assert.equal(s.requiere_critica_independiente, true);
  await K.evaluar(db, ids.app, ev({ beneficio_neto_mensual: { min: -200, base: 300, max: 3000 }, evidencia_demanda: 0.2, competencia: 0.9, defensibilidad: 0.1 }), 'ESTIMATE', 'agente:jupiter');
  await K.evaluar(db, ids.taller, ev(), 'ESTIMATE', 'agente:jupiter');
  await K.evaluar(db, ids.servicio, ev({ beneficio_neto_mensual: { min: 500, base: 4000, max: 9000 }, capital_usd: { min: 2000, base: 3000, max: 5000 }, evidencia_demanda: 0.6 }), 'ESTIMATE', 'agente:jupiter');
  const c = await K.comparar(db);
  assert.equal(c.ranking.length, 3); assert.ok(c.diversidad.digitales >= 1 && c.diversidad.no_digitales >= 2);
  assert.ok(c.ranking[0].tipo !== 'software');
  for (const r of c.ranking) assert.equal(r.beneficio_neto_mensual_rango.length, 3);
});

test('9–10 respuestas con evidencia y procedencia; afirmaciones sin respaldo detectadas y rebajadas', async () => {
  await assert.rejects(K.responder(db, { oportunidad_id: ids.taller, pregunta_id: 'Q011', respuesta: 'gastan bastante', evidencia: '', fuente: '', etiqueta: 'ESTIMATE', confianza: 0.5 }, 'agente:mercurio'), /SIN RESOLVER/);
  await assert.rejects(K.responder(db, { oportunidad_id: ids.taller, pregunta_id: 'Q011', respuesta: 'x', evidencia: 'y', fuente: 'charla', etiqueta: 'OBSERVED', confianza: 0.5 }, 'agente:mercurio'), /fuente comprobable/);
  const mala = await K.responder(db, { oportunidad_id: ids.taller, pregunta_id: 'Q020', respuesta: 'Todo el mundo lo compraría, éxito asegurado al 100 %', evidencia: 'intuición', fuente: 'opinión', etiqueta: 'ESTIMATE', confianza: 0.9 }, 'agente:mercurio');
  assert.equal(mala.rebajada, true); assert.equal(mala.etiqueta, 'HYPOTHESIS'); assert.ok(mala.alertas.length >= 2);
  const buena = await K.responder(db, { oportunidad_id: ids.taller, pregunta_id: 'Q011', respuesta: 'Las tiendas pagan 25–40 $ por soporte de importación', evidencia: 'precios de 3 distribuidores', fuente: 'https://ejemplo.org/catalogo', etiqueta: 'OBSERVED', confianza: 0.7 }, 'agente:mercurio');
  assert.equal(buena.etiqueta, 'OBSERVED'); assert.equal(buena.alertas.length, 0);
  await assert.rejects(K.responder(db, { oportunidad_id: ids.taller, pregunta_id: 'Q064', respuesta: 'r', evidencia: 'e', fuente: 'https://x.org', etiqueta: 'INDEPENDENTLY_VERIFIED', confianza: 0.8, verificado_por: 'agente:mercurio' }, 'agente:mercurio'), /verificador distinto/);
});

test('11 crítica independiente de una idea del propietario (hipótesis, no orden) y 12 fijación detectada', async () => {
  const c = await K.criticar(db, ids.app);
  assert.equal(c.es_orden_del_propietario, false); assert.match(c.veredicto, /DÉBIL/); assert.ok(c.alternativas.length >= 2); assert.match(c.nota!, /hipótesis/);
  for (const n of ['App de citas para viajeros', 'Plataforma SaaS de facturación', 'Canal de YouTube de recetas', 'App de meditación'])
    await K.crearOportunidad(db, { nombre: n, tipo: n.includes('YouTube') ? 'contenido' : 'software', descripcion: `${n} con suscripción`, origen: 'agente' }, 'agente:jupiter');
  const f = await K.detectarFijacion(db);
  assert.equal(f.fijacion, true); assert.ok(f.alertas.some((a: string) => /repetición no es evidencia|digitales/.test(a)));
});

test('14–15 ingresos ≠ beneficio neto; escenarios realistas con caja y equilibrio', async () => {
  const m = K.modeloFinanciero({ precio: 30, coste_variable: 9, unidades_mes: { pesimista: 40, base: 120, optimista: 300 }, costes_fijos_mes: 600, cac: 12, capital_inicial: 1500, comisiones_pct: 0.03, impuestos_pct: 0.25, meses_inventario: 1 });
  const b = m.escenarios.base;
  assert.equal(b.ingresos, 3600); assert.ok(b.beneficio_neto < b.margen_bruto && b.margen_bruto < b.ingresos);
  assert.ok(m.escenarios.pesimista.beneficio_neto < 0); assert.ok(m.alertas.some((a: string) => /pesimista/.test(a)));
  assert.equal(b.caja_acumulada_12m.length, 12); assert.ok(b.caja_acumulada_12m[0] < 0); assert.ok(b.unidades_equilibrio! > 0);
  assert.match(m.lectura, /beneficio neto verificado/);
  const real = await K.beneficioReal(db); assert.equal(typeof real.beneficio_neto_observado, 'number'); assert.match(real.etiqueta, /OBSERVED/);
});

test('16 experimento con umbrales falsables; clics no son compras; 19 autorización antes de gastar', async () => {
  await assert.rejects(K.disenarExperimento(db, { oportunidad_id: ids.taller, tipo: 'preventa', hipotesis: 'h', metrica: 'preventas pagadas', linea_base: '0', presupuesto_usd: 0, resultado_previsto: 5, umbral_exito: 2, umbral_fracaso: 3, dias: 14 }, 'agente:jupiter'), /umbral_fracaso < umbral_exito/);
  const anuncio = await K.disenarExperimento(db, { oportunidad_id: ids.taller, tipo: 'anuncio_pequeno', hipotesis: 'un anuncio local trae pedidos', metrica: 'compras', linea_base: '0 compras', presupuesto_usd: 40, resultado_previsto: 3, umbral_exito: 3, umbral_fracaso: 0, dias: 7 }, 'agente:jupiter');
  assert.equal(anuncio.requiere_autorizacion, true); assert.equal(anuncio.aprobacion!.estado, 'pendiente');
  await assert.rejects(K.resultadoExperimento(db, anuncio.experimento_id, { valor: 5, tipo_evidencia: 'compra', evidencia: 'x', fuente: 'y' }, 'agente:jupiter'), /no está autorizado/);
  const pre = await K.disenarExperimento(db, { oportunidad_id: ids.taller, tipo: 'preventa', hipotesis: 'las tiendas pagan por adelantado 3 soportes', metrica: 'preventas pagadas', linea_base: '0', presupuesto_usd: 0, resultado_previsto: 3, umbral_exito: 3, umbral_fracaso: 0, dias: 14 }, 'agente:jupiter');
  const r1 = await K.resultadoExperimento(db, pre.experimento_id, { valor: 50, tipo_evidencia: 'clic', evidencia: '50 clics en la página', fuente: 'analítica' }, 'agente:jupiter');
  assert.equal(r1.cuenta_como_evidencia, false); assert.equal(r1.veredicto, 'no_concluyente'); assert.match(r1.interpretacion, /no es una compra/);
  assert.equal(K.permiso('gastar').requiere_autorizacion, true); assert.equal(K.permiso('comparar').permitido, true); assert.equal(K.permiso('borrar_base_de_datos').permitido, false);
});

test('24 la recomendación cambia cuando cambia la evidencia y explica por qué; 18 no reabre sin evidencia nueva', async () => {
  const r1 = await K.recomendar(db, ids.taller, 'agente:jupiter');
  assert.equal(r1.decision, 'INVESTIGATE');
  for (const [q, txt] of [['Q001', 'Las tiendas no tienen soportes adaptados a sus vitrinas'], ['Q002', 'Tiendas de bicicletas independientes de la zona'], ['Q010', '7 de 10 tiendas visitadas lo pidieron'], ['Q020', '3 tiendas dejaron depósito'], ['Q030', 'No hay fabricante local; los importados tardan 6 semanas'],
    ['Q061', 'Impresora y material: 1.500 $'], ['Q064', 'Base 2.000 $/mes de beneficio neto'], ['Q083', 'Preventa a 10 tiendas'], ['Q093', 'Si menos de 3 tiendas pagan por adelantado, se descarta']] as const)
    await K.responder(db, { oportunidad_id: ids.taller, pregunta_id: q, respuesta: txt, evidencia: 'visitas y registros de la tarea', fuente: 'tarea #900', etiqueta: 'OBSERVED', confianza: 0.7 }, 'agente:mercurio');
  const r2 = await K.recomendar(db, ids.taller, 'agente:jupiter');
  assert.equal(r2.decision, 'EXPERIMENT'); assert.match(r2.explicacion_cambio!, /Antes INVESTIGATE/); assert.match(r2.explicacion_cambio!, /respuesta\(s\) nueva/);
  const pre = await K.disenarExperimento(db, { oportunidad_id: ids.taller, tipo: 'preventa', hipotesis: 'al menos 3 tiendas pagan por adelantado', metrica: 'preventas pagadas', linea_base: '0', presupuesto_usd: 0, resultado_previsto: 3, umbral_exito: 3, umbral_fracaso: 1, dias: 14 }, 'agente:jupiter');
  const r = await K.resultadoExperimento(db, pre.experimento_id, { valor: 0, tipo_evidencia: 'preventa_pagada', evidencia: '0 de 10 tiendas pagaron', fuente: 'registro de cobros' }, 'agente:jupiter');
  assert.equal(r.veredicto, 'fracaso');
  const r3 = await K.recomendar(db, ids.taller, 'agente:jupiter');
  assert.equal(r3.decision, 'DISCARD'); assert.match(r3.explicacion_cambio!, /experimentos/);
  const no = await K.reabrir(db, ids.taller, 'agente:jupiter');
  assert.equal(no.reabierta, false); assert.match(no.motivo, /No hay evidencia nueva/);
  await assert.rejects(K.recomendar(db, ids.taller, 'agente:jupiter'), /descartada/);
  const mem = (await db.query(`SELECT leccion FROM cog_experiencias WHERE procedencia = 'ksie' AND leccion LIKE 'No reabrir%'`)).rows;
  assert.ok(mem.length >= 1);
  await db.query(`UPDATE ksie_oportunidades SET abandonada_at = now() - interval '1 minute' WHERE id = $1`, [ids.taller]);
  await K.responder(db, { oportunidad_id: ids.taller, pregunta_id: 'Q020', respuesta: 'Una cadena regional pidió 40 unidades con pago del 50 %', evidencia: 'pedido firmado', fuente: 'https://ejemplo.org/pedido', etiqueta: 'OBSERVED', confianza: 0.8 }, 'agente:mercurio');
  assert.equal((await K.reabrir(db, ids.taller, 'agente:jupiter')).reabierta, true);
});

test('23 una sola ejecución activa; 17/22 la memoria estratégica sobrevive a un reinicio', async () => {
  const a = (await K.crearOportunidad(db, { nombre: 'Orden del propietario A', tipo: 'servicio_local', descripcion: 'orden explícita', origen: 'propietario_orden' }, 'propietario')).id;
  const b = (await K.crearOportunidad(db, { nombre: 'Orden del propietario B', tipo: 'producto_digital', descripcion: 'otra orden explícita', origen: 'propietario_orden' }, 'propietario')).id;
  await K.ejecutar(db, a, 'kratos');
  await assert.rejects(K.ejecutar(db, b, 'kratos'), /un solo objetivo de ejecución|Ya hay un objetivo principal activo/);
  await assert.rejects(K.ejecutar(db, ids.app, 'kratos'), /no tiene una recomendación EXECUTE/);
  await db.end(); db = createPool();
  const m = await K.memoriaEstrategica(db, ids.taller);
  assert.ok(m.recomendaciones.length >= 3 && m.experimentos.length >= 2 && m.respuestas.length >= 10);
  const p = await K.preguntasPara(db, ids.servicio);
  assert.equal(p.total - p.respondidas, p.sin_resolver.length);   // se reanuda donde quedó
});

test('14 conducta final: «encuentra una forma realista de generar 10.000 $/mes» no crea apps ni compra; compara y propone el experimento más barato', async () => {
  const f = await K.encontrarForma(db, 'encuentra una forma realista de generar 10.000 $/mes', 'kratos');
  assert.match(f.meta, /BENEFICIO NETO/); assert.ok(f.no_hago.includes('no creo una app') && f.no_hago.includes('no compro nada'));
  assert.ok(f.alternativas.evaluadas.length >= 2); assert.ok(f.herramientas_de_investigacion.plan.length >= 1);
  assert.ok(f.experimento_mas_barato.length > 10); assert.ok(f.autorizacion_necesaria.length >= 2);
});
