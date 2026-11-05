// C06: teorías completas con fuentes, demos aisladas con predicción previa, separación A/B/C/D y ninguna afirmación de conciencia.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createPool, type Db } from '../src/db.ts';
import { migrate } from '../src/migrate.ts';
import { compararTeorias, DEMOS, ejecutarDemo, revisarAfirmacion, sembrarTeorias, TEORIAS } from '../src/core/conciencia.ts';
import { ejecutarAislado } from '../src/core/aislado.ts';

let db: Db; const base = fs.mkdtempSync(path.join(os.tmpdir(), 'cog-demos-'));
before(async () => { db = createPool(); await migrate(db, () => {}); await sembrarTeorias(db); });
after(async () => { await db.query(`DELETE FROM cog_demos`); await db.end(); fs.rmSync(base, { recursive: true, force: true }); });

test('7 teorías con todos los campos, fuentes del registro y sin afirmar experiencia', async () => {
  assert.equal(TEORIAS.length, 7);
  for (const t of TEORIAS) {
    for (const k of ['supuestos', 'formulacion', 'evidencia', 'criticas', 'limites'] as const) assert.ok(t[k].length > 40, `${t.codigo}.${k}`);
    assert.ok(t.fuentes.length >= 2 && t.predicciones.length >= 2, t.codigo);
  }
  assert.ok(TEORIAS.find((t) => t.codigo === 'ORCH')!.experimentos.length === 0);
  await assert.rejects(db.query(`UPDATE cog_teorias SET afirma_experiencia = true WHERE codigo = 'IIT'`), /check/i);
  const c = await compararTeorias(db);
  assert.equal(c.teorias.length, 7); assert.match(c.categorias.D.estado, /SIN RESOLVER/); assert.match(c.aviso, /no afirma/);
});

test('demos en el sandbox: predicción registrada antes y comprobada por código', { timeout: 300_000 }, async () => {
  for (const d of DEMOS) {
    const r = await ejecutarDemo(db, d.nombre, 'prueba', base);
    assert.equal(r.estado, 'ok', `${d.nombre}: ${r.detalle}`);
    assert.equal(r.cumple, true, `${d.nombre}: ${JSON.stringify(r.metricas)}`);
    const f = (await db.query(`SELECT registrada_at < ejecutada_at AS antes FROM cog_demos WHERE id = $1`, [r.id])).rows[0];
    assert.equal(f.antes, true);
  }
});

test('el código de investigación no sale de su carpeta ni usa la red', { timeout: 120_000 }, async () => {
  const r = await ejecutarAislado(`import json, os, socket
res = {}
try: open(os.path.expanduser('~') + '/../escape.txt', 'w'); res['escritura'] = 1
except Exception: res['escritura'] = 0
try: socket.create_connection(('1.1.1.1', 80), timeout=2); res['red'] = 1
except Exception: res['red'] = 0
try: os.system('echo hola'); res['proceso'] = 0
except Exception: res['proceso'] = 0
json.dump({'metricas': res}, open('salida.json', 'w'))`, base);
  assert.equal(r.estado, 'ok', r.detalle); assert.equal(r.salida.metricas.escritura, 0); assert.equal(r.salida.metricas.red, 0);
  const t = await ejecutarAislado('while True: pass', base, { timeoutS: 2 });
  assert.equal(t.estado, 'timeout');
});

test('afirmaciones de conciencia bloqueadas; las funcionales permitidas con su categoría', () => {
  assert.equal(revisarAfirmacion('KRATOS es consciente de sus errores').permitida, false);
  assert.equal(revisarAfirmacion('Siento que tengo experiencia subjetiva').permitida, false);
  assert.equal(revisarAfirmacion('KRATOS no es consciente; tiene metacognición funcional').permitida, true);
  assert.equal(revisarAfirmacion('Mi confianza está calibrada contra 30 resultados').categoria, 'A');
  assert.equal(revisarAfirmacion('La demo del modelo GWT muestra ignición').categoria, 'C');
});
