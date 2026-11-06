// Datos públicos reales para ACD: descarga solo de fuentes permitidas, copia al experimento con sha256 y «observado» solo con datos registrados.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import { createPool, type Db } from '../src/db.ts';
import { migrate } from '../src/migrate.ts';
import { descargar, resolver } from '../src/core/datos-publicos.ts';
import { herramientaAcd } from '../src/core/acd.ts';

let db: Db; const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'kratos-datos-'));
const w = () => Math.random().toString(36).slice(2, 10).replace(/\d/g, (d) => 'abcdefghij'[Number(d)]);
const frase = (n: number) => Array.from({ length: n }, w).join(' ');
const csv = () => { const L = ['10,1,10,"Samples per record"', '11,2,1420070400,"Start time"', '12,"gmtime",,1,37,103'];
  for (let s = 0; s < 600; s++) L.push(`13,${1420070400 + s},,${100 + ((s * 7) % 15) - 7},${100 + ((s * 11) % 15) - 7},`); return zlib.gzipSync(L.join('\n')); };
const falso = (async (url: string) => (String(url).includes('2015-01-0') ? new Response(csv(), { status: 200 }) : new Response('no', { status: 404 }))) as any;
const acd = (i: any) => herramientaAcd(db, i, 'agente:sol') as Promise<any>;
before(async () => { process.env.KRATOS_ACD_DATOS = path.join(tmp, 'datos'); process.env.KRATOS_ACD_EXPERIMENTOS = path.join(tmp, 'exp'); db = createPool(); await migrate(db, () => {}); await db.query(`DELETE FROM datos_publicos WHERE nombre LIKE 'gcp:2015-01-0%'`); });
after(async () => { await db.query(`DELETE FROM datos_publicos WHERE nombre LIKE 'gcp:2015-01-0%'`); await db.end(); fs.rmSync(tmp, { recursive: true, force: true }); delete process.env.KRATOS_ACD_DATOS; delete process.env.KRATOS_ACD_EXPERIMENTOS; });

test('solo fuentes permitidas, gzip válido, sha256 registrado e idempotente', async () => {
  await assert.rejects(descargar(db, 'otra', '2015-01-01', '2015-01-01', 'agente:sol', falso), /no permitida/);
  await assert.rejects(descargar(db, 'gcp', '2015-01-01', '2015-03-01', 'agente:sol', falso), /31 días/);
  const r = await descargar(db, 'gcp', '2015-01-01', '2015-01-02', 'agente:sol', falso);
  assert.deepEqual(r.resultados.map((x: any) => x.estado), ['descargado', 'descargado']);
  assert.equal((await descargar(db, 'gcp', '2015-01-01', '2015-01-01', 'agente:sol', falso)).resultados[0].estado, 'ya estaba');
  await assert.rejects(resolver(db, ['gcp:1999-01-01']), /no descargado/);
});

test('el experimento lee los datos reales en su carpeta (sin red) y solo así puede declararse «observado»', { timeout: 180_000 }, async () => {
  await db.query(`UPDATE system_state SET value = 'false' WHERE key IN ('emergency_stop','automations_paused')`);
  const p = await acd({ accion: 'registrar_pregunta', texto: `¿${frase(8)}?`, area: 'informacion', origen: 'kratos' });
  const h = await acd({ accion: 'imaginar', pregunta_id: p.pregunta_id, titulo: `Datos ${frase(3)}`, enunciado: frase(12), mecanismo: frase(10) });
  const base = { accion: 'registrar_modelo', hipotesis_id: h.hipotesis_id, tipo: 'estadistico', descripcion: 'Media de los ensayos del generador frente a la esperada por azar (100)', variables: 'sumas de 200 bits por segundo',
    predicciones: 'la desviación media respecto a 100 será compatible con el azar', falsacion: 'si la media se aparta más de 3 errores típicos', baseline: 'media teórica de 100 por azar puro' };
  const codigo = `import gzip, csv, json, os
vals = []
for f in sorted(os.listdir('datos')):
    for row in csv.reader(gzip.open(os.path.join('datos', f), 'rt')):
        if row and row[0] == '13': vals += [int(x) for x in row[3:] if x]
m = sum(vals) / len(vals)
json.dump({"datos": "observado", "descripcion": "GCP: media de ensayos", "metricas": {"desviacion": {"modelo": abs(m - 100), "baseline": 1.0, "mejor": "menor"}}}, open("salida.json", "w"))`;
  const m = await acd({ ...base, codigo, datasets: ['gcp:2015-01-01', 'gcp:2015-01-02'] });
  assert.ok(m.modelo_id, JSON.stringify(m));
  const e = await acd({ accion: 'ejecutar', modelo_id: m.modelo_id });
  assert.equal(e.estado, 'ok', JSON.stringify(e).slice(0, 400));
  const meta = JSON.parse(fs.readFileSync(path.join(e.carpeta, 'meta.json'), 'utf8'));
  assert.equal(meta.datasets.length, 2); assert.equal(meta.datos, 'observado');
  const sin = await acd({ ...base, codigo });   // mismo código sin datasets: dice «observado» pero no hay datos registrados
  const e2 = await acd({ accion: 'ejecutar', modelo_id: sin.modelo_id });
  assert.notEqual(e2.estado, 'ok');
});
