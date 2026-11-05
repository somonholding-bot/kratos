// C02: calibración contra resultados medidos, contradicciones, fallos repetidos, revisión independiente y escalado.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createPool, type Db } from '../src/db.ts';
import { migrate } from '../src/migrate.ts';
import { calibracion, contradicciones, registrarDecision, resolverDecision, revisarDecision, historialTareas } from '../src/core/metacognicion.ts';

let db: Db;
const CAT = 'prueba:sobreconfianza', CAT2 = 'prueba:repeticion';
before(async () => { db = createPool(); await migrate(db, () => {}); await db.query(`DELETE FROM cog_decisiones WHERE categoria LIKE 'prueba:%'`); });
after(async () => { await db.query(`DELETE FROM cog_decisiones WHERE categoria LIKE 'prueba:%'`); await db.end(); });

const base = (o: any = {}) => ({ categoria: CAT, objetivo: 'estimar demanda', estrategias: [{ nombre: 'encuesta' }, { nombre: 'intuición' }], elegida: 'encuesta',
  evidencia: [{ texto: 'datos de 3 tiendas', apoya: true }], supuestos: [], incertidumbre: 0.2, confianza_declarada: 0.95, resultado_esperado: 'acierto', ...o });

test('«95 % seguro» no se cree: la confianza se calibra con los resultados reales', async () => {
  for (let k = 0; k < 10; k++) {
    const d = await registrarDecision(db, base(), 'agente:a');
    const exito = k < 3;
    await resolverDecision(db, d.id, { exito, resultado_real: exito ? 'acertó' : 'falló', errores: exito ? undefined : 'muestra sesgada', estrategia_revisada: exito ? undefined : `ampliar muestra ${k}` }, 'agente:a');
  }
  const cal = await calibracion(db, CAT);
  assert.equal(cal.casos, 10); assert.equal(cal.acierto_real, 0.3); assert.ok(cal.error_calibracion! > 0.5); assert.match(cal.lectura, /Mal calibrada/);
  const n = await registrarDecision(db, base(), 'agente:a');
  assert.equal(n.confianza_calibrada, 0.3);
  assert.ok(n.alertas.some((a: any) => a.tipo === 'sobreconfianza'));
  assert.equal(n.estado, 'escalada');
});

test('sin historial lo dice; detecta contradicciones y elegida fuera de las candidatas', async () => {
  const d = await registrarDecision(db, base({ categoria: 'prueba:nueva', elegida: 'adivinar', evidencia: [{ texto: 'el mercado cae', apoya: false }], incertidumbre: 0.6 }), 'agente:a');
  const tipos = d.alertas.map((a: any) => a.texto).join(' | ');
  assert.match(tipos, /no está entre las candidatas/); assert.match(tipos, /evidencia en contra/); assert.match(tipos, /No hay evidencia a favor/); assert.match(tipos, /incompatible/);
  assert.ok(d.alertas.some((a: any) => a.tipo === 'sin_calibracion'));
  assert.equal(d.estado, 'escalada');
  assert.ok(contradicciones({ estrategias: ['a'], elegida: 'a', evidencia: [{ texto: 'x', apoya: true }], supuestos: [], resultado_esperado: 'y', incertidumbre: 0.1, confianza_declarada: 0.5 }).some((t) => /una estrategia/.test(t)));
});

test('una estrategia que ya falló se reconoce y, si se repite, se escala', async () => {
  for (let k = 0; k < 2; k++) {
    const d = await registrarDecision(db, base({ categoria: CAT2, elegida: 'Anuncios pagados', estrategias: [{ nombre: 'anuncios pagados' }, { nombre: 'boca a boca' }] }), 'agente:a');
    await resolverDecision(db, d.id, { exito: false, resultado_real: '0 ventas', errores: 'CAC mayor que el margen', estrategia_revisada: 'probar boca a boca' }, 'agente:a');
  }
  const r = await registrarDecision(db, base({ categoria: CAT2, elegida: 'anuncios  pagados', estrategias: [{ nombre: 'anuncios pagados' }, { nombre: 'boca a boca' }] }), 'agente:a');
  const al = r.alertas.find((a: any) => a.tipo === 'estrategia_ya_fallida');
  assert.ok(al && /2 vez/.test(al.texto) && /boca a boca/.test(al.texto));
  assert.equal(r.estado, 'escalada'); assert.match(r.escalado!.motivo, /repetida/);
});

test('revisión independiente: el autor no se revisa; lo crítico no se da por bueno sin revisión', async () => {
  const d = await registrarDecision(db, base({ categoria: 'prueba:critica', critica: true }), 'agente:a');
  assert.equal(d.requiere_revision_independiente, true);
  await assert.rejects(revisarDecision(db, d.id, 'agente:a', 'aprobada', 'ok'), /no independiente/);
  await assert.rejects(resolverDecision(db, d.id, { exito: true, resultado_real: 'hecho' }, 'agente:a'), /revisión independiente/);
  await revisarDecision(db, d.id, 'agente:saturno', 'aprobada', 'comprobé los datos de las 3 tiendas');
  const r = await resolverDecision(db, d.id, { exito: true, resultado_real: 'hecho y comprobado' }, 'agente:a');
  assert.equal(r.exito, true);
  await assert.rejects(resolverDecision(db, d.id, { exito: true, resultado_real: 'otra vez' }, 'agente:a'), /resuelta/);
  const f = await registrarDecision(db, base({ categoria: 'prueba:critica' }), 'agente:a');
  await assert.rejects(resolverDecision(db, f.id, { exito: false, resultado_real: 'mal' }, 'agente:a'), /estrategia revisada/);
});

test('historial medido de tareas por agente', async () => {
  const h = await historialTareas(db);
  assert.ok(Array.isArray(h));
  for (const r of h) assert.ok(r.fiabilidad > 0 && r.fiabilidad < 1);
});
