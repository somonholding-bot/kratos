// TAREA 08/09: ciclo operativo integrado (C01→C04→SOL→ACD→cálculo aislado→C02→C05→C03→cierre), Q-LAB ausente, fallo verificado y bloqueo.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createPool, type Db } from '../src/db.ts';
import { migrate } from '../src/migrate.ts';
import { syncToolRegistry } from '../src/core/toolregistry.ts';
import { sincronizarCapacidades } from '../src/core/automodelo.ts';
import { ejecutarCiclo, type EntradaCiclo } from '../src/core/ciclo-cognitivo.ts';
import { estadoEspacio, proponer, activar, cerrarSinExito } from '../src/core/espacio.ts';

let db: Db; const base = fs.mkdtempSync(path.join(os.tmpdir(), 'cog-ciclo-'));
const limpiar = async () => {
  await db.query(`DELETE FROM cog_ciclos`); for (const t of ['cog_mensajes', 'cog_conflictos', 'cog_transiciones']) await db.query(`DELETE FROM ${t}`);
  await db.query(`DELETE FROM cog_objetivos WHERE padre_id IS NOT NULL`); await db.query(`DELETE FROM cog_objetivos`);
  await db.query(`DELETE FROM cog_decisiones WHERE categoria = 'ciclo:hipotesis'`); await db.query(`DELETE FROM cog_experiencias WHERE procedencia = 'ciclo cognitivo'`); await db.query(`DELETE FROM cog_predicciones WHERE contexto LIKE 'prueba-ciclo%'`); await db.query(`DELETE FROM cog_creencias WHERE contexto LIKE 'prueba-ciclo%'`);
};
before(async () => {
  db = createPool(); await migrate(db, () => {}); await syncToolRegistry(db); await sincronizarCapacidades(db); await limpiar();
  await db.query(`INSERT INTO sol_fuentes (titulo, created_by, temas, verificada) VALUES ('Newton cooling law and exponential decay', 'prueba', '{enfriamiento}', true)`);
});
after(async () => { await limpiar(); await db.query(`DELETE FROM sol_fuentes WHERE created_by = 'prueba'`); await db.end(); fs.rmSync(base, { recursive: true, force: true }); });

const CODIGO = (k: number) => `import json, numpy as np
rng = np.random.default_rng(3); t = np.linspace(0, 10, 60); T = 20 + 60*np.exp(-${k}*t) + rng.normal(0, 0.5, t.size)
y = np.log(np.clip(T - 20, 1e-6, None)); A = np.vstack([t, np.ones_like(t)]).T; c, *_ = np.linalg.lstsq(A, y, rcond=None)
pred = 20 + np.exp(c[1] + c[0]*t); r2 = 1 - ((T-pred)**2).sum()/((T-T.mean())**2).sum()
json.dump({'metricas': {'r2': round(float(r2), 4), 'k_estimado': round(float(-c[0]), 4)}}, open('salida.json', 'w'))`;
const entrada = (o: Partial<EntradaCiclo> = {}): EntradaCiclo => ({
  titulo: 'Comprobar si el enfriamiento observado sigue la ley de Newton', criterio_exito: 'ajuste exponencial con R² > 0,95', aceptacion: 'prueba integrada del ciclo cognitivo',
  capacidades: ['acd', 'dependencia:python_acd', 'dependencia:sandbox_exec'], consulta_evidencia: 'cooling exponential enfriamiento',
  pregunta: '¿El enfriamiento de un cuerpo en aire quieto sigue un decaimiento exponencial hacia la temperatura ambiente?',
  hipotesis: { titulo: 'Enfriamiento exponencial de Newton en aire quieto', enunciado: 'La diferencia de temperatura con el ambiente decae de forma exponencial con una constante k única durante todo el registro.', mecanismo: 'Transferencia de calor por convección proporcional a la diferencia de temperatura (ley de enfriamiento de Newton).' },
  calculo: { codigo: CODIGO(0.3), metrica: 'r2' }, prediccion: { contexto: 'prueba-ciclo', clave: 'r2', prior: { media: 0.97, varianza: 0.001, ruido: 0.01 } }, umbral: { op: '>', valor: 0.95 }, ...o });

test('ciclo completo: 10 etapas con responsable y criterio, Q-LAB ausente informado, COMPLETED con artefacto independiente', { timeout: 120_000 }, async () => {
  const r = await ejecutarCiclo(db, entrada(), { base });
  assert.equal(r.estado, 'completado', JSON.stringify(r.etapas.filter((e: any) => !e.cumple)));
  assert.deepEqual(r.etapas.map((e: any) => e.n).sort((a: number, b: number) => a - b), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  for (const e of r.etapas) assert.ok(e.responsable && e.criterio && 'entrada' in e && 'salida' in e);
  assert.match(r.etapas.find((e: any) => e.n === 6).dependencia_ausente, /Q-LAB no existe/);
  assert.equal(r.etapas.find((e: any) => e.n === 4).cumple, true);
  const pre = (await db.query(`SELECT registrada_at < observado_at AS antes FROM cog_predicciones WHERE contexto = 'prueba-ciclo' ORDER BY id DESC LIMIT 1`)).rows[0];
  assert.equal(pre.antes, true);
  const ob = (await db.query(`SELECT o.estado, o.artefacto_verificacion->>'verificador' AS v, o.propietario FROM cog_ciclos c JOIN cog_objetivos o ON o.id = c.objetivo_id WHERE c.id = $1`, [r.ciclo_id])).rows[0];
  assert.equal(ob.estado, 'COMPLETED'); assert.notEqual(ob.v, ob.propietario);
  assert.equal((await estadoEspacio(db)).objetivo_activo, null);
});

test('fallo verificado: la hipótesis no supera el umbral y el objetivo queda FAILED con evidencia y lección', { timeout: 120_000 }, async () => {
  const r = await ejecutarCiclo(db, entrada({ titulo: 'Comprobar ajuste lineal del enfriamiento', calculo: { codigo: CODIGO(0.3), metrica: 'r2' }, umbral: { op: '>', valor: 0.9999 },
    hipotesis: { titulo: 'Ajuste perfecto del enfriamiento sin ruido', enunciado: 'El registro de temperatura se ajusta sin error a una única exponencial, sin ruido de medida apreciable.', mecanismo: 'Medida ideal sin ruido del sensor ni corrientes de aire en la sala de ensayo.' } }), { base });
  assert.equal(r.estado, 'fallido', r.resultado);
  assert.match(r.etapas.find((e: any) => e.n === 10).etapa, /fallo verificado/);
  const m = (await db.query(`SELECT resultado, leccion FROM cog_experiencias WHERE enlaces @> $1::jsonb`, [JSON.stringify([{ tipo: 'ciclo', ref: r.ciclo_id }])])).rows[0];
  assert.equal(m.resultado, 'fallo'); assert.match(m.leccion, /no reutilizar sin evidencia nueva/);
});

test('bloqueos: capacidad ausente (Q-LAB) y un segundo objetivo mientras hay otro activo', { timeout: 60_000 }, async () => {
  const r = await ejecutarCiclo(db, entrada({ titulo: 'Optimizar con Q-LAB una cadena de suministro', capacidades: ['q_lab'] }), { base });
  assert.equal(r.estado, 'bloqueado'); assert.match(r.resultado, /q_lab/);
  const otro = await proponer(db, { titulo: 'Objetivo manual que ocupa el espacio', criterio_exito: 'x', propietario: 'kratos', aceptacion: 'prueba' }, 'kratos');
  await activar(db, otro.id, 'kratos');
  const r2 = await ejecutarCiclo(db, entrada({ titulo: 'Segundo objetivo simultáneo de prueba' }), { base });
  assert.equal(r2.estado, 'bloqueado'); assert.match(r2.resultado, /Ya hay un objetivo principal activo/);
  await cerrarSinExito(db, otro.id, 'CANCELLED', 'fin de la prueba', 'kratos');
});
