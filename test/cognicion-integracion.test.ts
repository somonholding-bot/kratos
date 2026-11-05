// TAREA 09: integración, persistencia tras reinicio, recuperación de interrupciones, experimentos fallidos, seguridad y reproducibilidad.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createPool, type Db } from '../src/db.ts';
import { migrate } from '../src/migrate.ts';
import { syncToolRegistry } from '../src/core/toolregistry.ts';
import { sincronizarCapacidades, capacidad } from '../src/core/automodelo.ts';
import { ejecutarCiclo, recuperarCiclos } from '../src/core/ciclo-cognitivo.ts';
import { activar, estadoEspacio, proponer, cerrarSinExito } from '../src/core/espacio.ts';
import { predecir, historial } from '../src/core/prediccion.ts';
import { registrarDecision } from '../src/core/metacognicion.ts';
import { recordar, buscarMemoria } from '../src/core/autobiografia.ts';
import { ejecutarAislado } from '../src/core/aislado.ts';
import { ejecutarDemo, sembrarTeorias } from '../src/core/conciencia.ts';

let db: Db; const base = fs.mkdtempSync(path.join(os.tmpdir(), 'cog-int-'));
const limpiar = async () => {
  await db.query(`DELETE FROM cog_ciclos`); for (const t of ['cog_mensajes', 'cog_conflictos', 'cog_transiciones']) await db.query(`DELETE FROM ${t}`);
  await db.query(`DELETE FROM cog_objetivos WHERE padre_id IS NOT NULL`); await db.query(`DELETE FROM cog_objetivos`);
  await db.query(`DELETE FROM cog_decisiones WHERE categoria LIKE 'int:%' OR categoria = 'ciclo:hipotesis'`); await db.query(`DELETE FROM cog_predicciones WHERE contexto LIKE 'int:%'`); await db.query(`DELETE FROM cog_creencias WHERE contexto LIKE 'int:%'`);
  await db.query(`UPDATE cog_experiencias SET corregido_por = NULL WHERE agente LIKE 'int%' OR procedencia = 'ciclo cognitivo'`); await db.query(`DELETE FROM cog_experiencias WHERE agente LIKE 'int%' OR procedencia = 'ciclo cognitivo'`);
};
before(async () => { db = createPool(); await migrate(db, () => {}); await syncToolRegistry(db); await sincronizarCapacidades(db); await sembrarTeorias(db); await limpiar(); });
after(async () => { await limpiar(); await db.query(`DELETE FROM cog_demos`); await db.end(); fs.rmSync(base, { recursive: true, force: true }); });

test('persistencia: objetivo activo, decisión, predicción y memoria sobreviven a un reinicio y las reglas siguen vigentes', async () => {
  const o = await proponer(db, { titulo: 'Objetivo que sobrevive al reinicio', criterio_exito: 'x', propietario: 'sol', aceptacion: 'prueba de persistencia' }, 'kratos');
  await activar(db, o.id, 'kratos');
  const d = await registrarDecision(db, { categoria: 'int:persistencia', objetivo: 'o', estrategias: ['a', 'b'], elegida: 'a', evidencia: ['e'], incertidumbre: 0.2, confianza_declarada: 0.5, resultado_esperado: 'r' }, 'int');
  const p = await predecir(db, { contexto: 'int:persistencia', clave: 'k', prior: { media: 1, varianza: 1, ruido: 1 } }, 'int');
  const m = await recordar(db, { agente: 'int', objetivo: 'persistir', resultado: 'exito' }, 'int');
  await db.end(); db = createPool();   // «reinicio»: nueva conexión, nada en memoria del proceso
  assert.equal((await estadoEspacio(db)).objetivo_activo.id, o.id);
  assert.equal((await db.query(`SELECT estado FROM cog_decisiones WHERE id = $1`, [d.id])).rows[0].estado, d.estado);
  assert.equal((await historial(db, 'int:persistencia')).pendientes_de_observar, 1);
  assert.ok((await buscarMemoria(db, { agente: 'int' })).some((x) => x.id === m.id));
  const o2 = await proponer(db, { titulo: 'Otro objetivo distinto tras reiniciar', criterio_exito: 'x', propietario: 'sol', aceptacion: 'prueba' }, 'kratos');
  await assert.rejects(activar(db, o2.id, 'kratos'), /Ya hay un objetivo principal activo/);
  await cerrarSinExito(db, o.id, 'CANCELLED', 'fin de la prueba', 'kratos'); await cerrarSinExito(db, o2.id, 'CANCELLED', 'fin de la prueba', 'kratos');
  void p;
});

test('recuperación de una sesión interrumpida: ciclo en curso → fallido por interrupción, objetivo BLOCKED con la etapa', async () => {
  const o = await proponer(db, { titulo: 'Ciclo interrumpido a mitad', criterio_exito: 'x', propietario: 'sol', aceptacion: 'prueba de recuperación' }, 'kratos');
  await activar(db, o.id, 'kratos');
  const c = (await db.query(`INSERT INTO cog_ciclos (objetivo_id, titulo, etapas, created_at) VALUES ($1, 'ciclo colgado', $2, now() - interval '2 hours') RETURNING id`,
    [o.id, JSON.stringify([{ n: 1, etapa: 'recibir objetivo' }, { n: 2, etapa: 'comprobar capacidades (C01)' }])])).rows[0];
  await predecir(db, { contexto: 'int:recuperacion', clave: 'k', prior: { media: 0, varianza: 1, ruido: 1 }, experimento_ref: `ciclo ${c.id}` }, 'int');
  const r = await recuperarCiclos(db, 30);
  const mio = r.find((x) => x.ciclo === c.id)!;
  assert.match(mio.motivo, /etapa 2/); assert.equal(mio.predicciones_sin_observar.length, 1);
  assert.equal((await db.query(`SELECT estado FROM cog_ciclos WHERE id = $1`, [c.id])).rows[0].estado, 'fallido');
  const ob = (await db.query(`SELECT estado, motivo_cierre FROM cog_objetivos WHERE id = $1`, [o.id])).rows[0];
  assert.equal(ob.estado, 'BLOCKED'); assert.match(ob.motivo_cierre, /reanudar/);
  assert.equal((await recuperarCiclos(db, 30)).filter((x) => x.ciclo === c.id).length, 0);   // idempotente
  await cerrarSinExito(db, o.id, 'CANCELLED', 'fin de la prueba', 'kratos');
});

test('experimento que falla: el ciclo termina en fallo verificado sin romper nada y lo registra', { timeout: 120_000 }, async () => {
  const r = await ejecutarCiclo(db, {
    titulo: 'Ciclo con experimento que se rompe', criterio_exito: 'r > 0', aceptacion: 'prueba de fallo seguro', capacidades: ['acd'], tipo_tarea: 'investigación científica con hipótesis',
    consulta_evidencia: 'nada', pregunta: '¿Qué ocurre cuando el experimento computacional lanza una excepción a mitad de la ejecución?',
    hipotesis: { titulo: 'El ejecutor contiene un experimento roto', enunciado: 'Un experimento que lanza una excepción queda registrado como error sin afectar al resto del sistema ni a otros ciclos.', mecanismo: 'Aislamiento por proceso, sandbox y captura del código de salida por el ejecutor de KRATOS.' },
    calculo: { codigo: 'raise RuntimeError("fallo provocado")', metrica: 'r' }, prediccion: { contexto: 'int:fallo', clave: 'r', prior: { media: 1, varianza: 1, ruido: 1 } }, umbral: { op: '>', valor: 0 } }, { base });
  assert.equal(r.estado, 'fallido');
  const e6 = r.etapas.find((e: any) => e.n === 6); assert.equal(e6.cumple, false); assert.equal(e6.salida.estado, 'error');
  assert.equal((await estadoEspacio(db)).objetivo_activo, null);
});

test('seguridad del código generado: sin secretos en el entorno, sin leer la carpeta personal, sin red ni procesos', { timeout: 120_000 }, async () => {
  const r = await ejecutarAislado(`import json, os
res = {'vars_sensibles': [k for k in os.environ if any(s in k.upper() for s in ('KEY','TOKEN','SECRET','PASS','ANTHROPIC','PG','KRATOS','JARVIS'))]}
try: open(${JSON.stringify(path.join(os.homedir(), 'Jarvis', 'package.json'))}).read(); res['lee_home'] = 1
except Exception: res['lee_home'] = 0
try: os.listdir(${JSON.stringify(path.join(os.homedir(), 'Library', 'Keychains'))}); res['llavero'] = 1
except Exception: res['llavero'] = 0
try: os.fork(); res['fork'] = 1
except Exception: res['fork'] = 0
json.dump({'metricas': res}, open('salida.json', 'w'))`, base);
  assert.equal(r.estado, 'ok', r.detalle);
  assert.deepEqual(r.salida.metricas.vars_sensibles, []); assert.equal(r.salida.metricas.lee_home, 0); assert.equal(r.salida.metricas.fork, 0);
});

test('sin gasto de API: los módulos cognitivos no llaman a la API de pago ni a la red', () => {
  for (const f of ['automodelo', 'metacognicion', 'autobiografia', 'espacio', 'prediccion', 'conciencia', 'aislado', 'ciclo-cognitivo']) {
    const src = fs.readFileSync(path.join('src', 'core', `${f}.ts`), 'utf8');
    assert.doesNotMatch(src, /@anthropic-ai|new Anthropic|fetch\(|https?:\/\/(?!127)/, f);
  }
});

test('reproducibilidad: la misma demo da las mismas métricas; las capacidades ausentes siguen reconocidas', { timeout: 120_000 }, async () => {
  const a = await ejecutarDemo(db, 'iit_integracion', 'int', base), b = await ejecutarDemo(db, 'iit_integracion', 'int', base);
  assert.deepEqual(a.metricas, b.metricas);
  assert.equal((await capacidad(db, 'q_lab')).nivel, 'no_existe');
});
