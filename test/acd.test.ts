// Motor ACD de Sol (src/core/acd.ts): las reglas de descubrimiento honesto las impone el código.
// BD aislada: JARVIS_DB=jarvis_t_acd KRATOS_DISABLE_AI=1 KRATOS_VAULT=.jarvis/vault-test node --test --test-concurrency=1 test/acd.test.ts
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { ROOT } from '../src/config.ts';
// nunca las carpetas de producción (.jarvis/acd puede ser un enlace a la instalación real): una carpeta propia de este checkout
process.env.KRATOS_ACD_EXPERIMENTOS = path.join(ROOT, '.jarvis', 'experimentos-acd-test');
import { createPool, type Db } from '../src/db.ts';
import { migrate } from '../src/migrate.ts';
import { ACD_CHECKS, ACD_FAMILIA, ACD_TOOL, CURIOSO, PESOS, PLANIFICADOR, advanceAcd, campanaEstado, comparar, ejecutarModelo, herramientaAcd, linaje, planificarAcd, prioridad, resumenAcd, similitud, type PlanAcd } from '../src/core/acd.ts';

const PY = path.join(ROOT, '.jarvis', 'acd', 'venv', 'bin', 'python');
const conPython = fs.existsSync(PY) && fs.existsSync('/usr/bin/sandbox-exec');
const SOL = 'agente:sol', SAT = 'agente:saturno';
let db: Db;
const tablas = ['acd_historial', 'acd_criticas', 'acd_experimentos', 'acd_modelos', 'acd_hipotesis', 'acd_preguntas', 'sol_proyectos', 'sol_fuentes', 'tasks'];
const maxIds: Record<string, number> = {};
const unidadesCreadas: string[] = [];
let estadoPrevio: Record<string, any> = {};
let fuentesOk: number[] = [];
const ajenos: string[] = [];   // archivos de prueba FUERA de las carpetas de experimento (deben quedar intactos)
const ajeno = (contenido: string) => {
  const base = process.env.KRATOS_ACD_EXPERIMENTOS!;
  fs.mkdirSync(base, { recursive: true });
  const f = path.join(fs.realpathSync(base), `ajeno-${w()}.txt`);
  fs.writeFileSync(f, contenido); ajenos.push(f); return f;
};

// palabras aleatorias: cada pregunta e hipótesis de prueba es distinta de verdad (el código rechaza las casi duplicadas)
const w = () => Math.random().toString(36).slice(2, 10).replace(/\d/g, (d) => 'abcdefghij'[Number(d)]);
const frase = (n: number) => Array.from({ length: n }, w).join(' ');
const acd = async (i: any, actor = SOL) => herramientaAcd(db, i, actor) as Promise<any>;
async function pregunta(campana?: string, actor = SOL) {
  const r = await acd({ accion: 'registrar_pregunta', texto: `¿${frase(8)}?`, area: 'informacion', origen: campana ? 'campana' : 'kratos', campana }, actor);
  assert.ok(r.pregunta_id, JSON.stringify(r)); return r.pregunta_id as number;
}
async function hipotesis(campana?: string, actor = SOL) {
  const r = await acd({ accion: 'imaginar', pregunta_id: await pregunta(campana, actor), titulo: `Prueba ${frase(3)}`, enunciado: frase(12), mecanismo: frase(10), campana }, actor);
  assert.ok(r.hipotesis_id, JSON.stringify(r)); return r.hipotesis_id as number;
}
const modelo = async (h: number, codigo: string, actor = SOL) => {
  const r = await acd({ accion: 'registrar_modelo', hipotesis_id: h, tipo: 'estadistico', descripcion: 'Modelo de prueba: ajuste por mínimos cuadrados frente a un predictor constante', variables: 'x, y (sintéticas)',
    predicciones: 'el error cuadrático medio del ajuste será menor que el de la media', falsacion: 'si el error del ajuste no baja del de la media, se contradice', baseline: 'predictor constante (la media)', codigo }, actor);
  assert.ok(r.modelo_id, JSON.stringify(r)); return r.modelo_id as number;
};
const salida = (metricas: string) => `json.dump({"datos": "sintetico", "descripcion": "datos sintéticos de prueba", "metricas": ${metricas}}, open("salida.json", "w"))`;
const BUENO = `import json\nimport numpy as np\nrng = np.random.default_rng(7)\nx = np.linspace(0, 10, 200)\ny = 2.0 * x + 1.0 + rng.normal(0, 0.5, x.size)\na, b = np.polyfit(x, y, 1)\n`
  + `mse_m = float(np.mean((a * x + b - y) ** 2))\nmse_b = float(np.mean((y.mean() - y) ** 2))\nprint("pendiente", a)\n${salida('{"mse": {"modelo": mse_m, "baseline": mse_b, "mejor": "menor"}}')}\n`;
const MALO = `import json\nimport numpy as np\nrng = np.random.default_rng(3)\nx = np.linspace(0, 10, 200)\ny = 2.0 * x + 1.0 + rng.normal(0, 0.5, x.size)\npred = np.zeros_like(y)\n`
  + `mse_m = float(np.mean((pred - y) ** 2))\nmse_b = float(np.mean((y.mean() - y) ** 2))\nr2_m = 1 - mse_m / mse_b\n${salida('{"mse": {"modelo": mse_m, "baseline": mse_b, "mejor": "menor"}, "r2": {"modelo": r2_m, "baseline": 0.1, "mejor": "mayor"}}')}\n`;
const sha = (s: string | Buffer) => crypto.createHash('sha256').update(s).digest('hex');

before(async () => {
  db = createPool(); await migrate(db, () => {});
  for (const t of tablas) maxIds[t] = Number((await db.query(`SELECT coalesce(max(id), 0) AS m FROM ${t}`)).rows[0].m);
  estadoPrevio = Object.fromEntries((await db.query(`SELECT key, value FROM system_state WHERE key IN ('acd_tareas_dia','emergency_stop','automations_paused')`)).rows.map((r: any) => [r.key, r.value]));
  await db.query(`UPDATE system_state SET value = 'false' WHERE key IN ('emergency_stop','automations_paused')`);
  for (const n of [1, 2, 3]) fuentesOk.push((await db.query(`INSERT INTO sol_fuentes (tipo, titulo, url, dominio, acceso, verificada, http_status, verificada_en, created_by) VALUES ('articulo', $1, $2, 'example.org', 'pagina', $3, 200, now(), 'prueba acd') RETURNING id`,
    [`Fuente ACD ${n}`, `https://example.org/acd-prueba-${Date.now()}-${n}`, n < 3])).rows[0].id);   // 2 verificadas y 1 no
});
after(async () => {
  const exps = (await db.query(`SELECT carpeta FROM acd_experimentos WHERE id > $1`, [maxIds.acd_experimentos])).rows;
  for (const e of exps) if (e.carpeta && e.carpeta.includes('experimentos-acd-test')) fs.rmSync(e.carpeta, { recursive: true, force: true });
  for (const f of ajenos) fs.rmSync(f, { force: true });
  try { fs.rmdirSync(process.env.KRATOS_ACD_EXPERIMENTOS!); } catch {}   // solo si quedó vacía
  for (const p of (await db.query(`SELECT carpeta FROM sol_proyectos WHERE id > $1`, [maxIds.sol_proyectos])).rows) if (p.carpeta) fs.rmSync(p.carpeta, { recursive: true, force: true });
  await db.query(`UPDATE sol_unidades SET tarea_id = NULL, proyecto_id = NULL WHERE codigo = ANY($1::text[])`, [unidadesCreadas]);
  await db.query(`DELETE FROM sol_unidades WHERE codigo = ANY($1::text[])`, [unidadesCreadas]);
  for (const t of tablas) await db.query(`DELETE FROM ${t} WHERE id > $1`, [maxIds[t]]);
  for (const [k, v] of Object.entries(estadoPrevio)) await db.query(`UPDATE system_state SET value = $2 WHERE key = $1`, [k, JSON.stringify(v)]);
  await db.end();
});

test('D08: la prioridad sale de una fórmula fija; el arte previo pone techo a la novedad', () => {
  assert.equal(Math.round(Object.values(PESOS).reduce((a, b) => a + b, 0) * 1000) / 1000, 1);
  const max = { importancia: 1, novedad_puntos: 1, coherencia: 1, testabilidad: 1, coste: 0, evidencia: 1 };
  assert.equal(prioridad({ ...max, novedad: 'posiblemente_nueva' }), 1);
  assert.equal(prioridad({ ...max, novedad: 'conocida' }), 0.84);          // 1 − 0,20·(1 − 0,2)
  assert.equal(prioridad({ ...max, novedad: 'variante' }), 0.92);
  assert.equal(prioridad({ ...max }), 0.9);                                  // sin revisar: techo 0,5
  assert.equal(prioridad({ importancia: 0.5, novedad_puntos: 0.9, coherencia: 0.5, testabilidad: 0.5, coste: 0.5, evidencia: 0.5, novedad: 'conocida' }), 0.44);
  assert.equal(prioridad({ ...max, coste: 1, novedad: 'posiblemente_nueva' }), 0.9);
  assert.throws(() => prioridad({ ...max, coherencia: 1.5 }), /entre 0 y 1/);
  assert.throws(() => prioridad({ ...max, evidencia: undefined }), /evidencia/);
  assert.match(ACD_TOOL.description, /salida\.json/);
});

test('D01/E03: preguntas e hipótesis; casi duplicadas rechazadas; «posiblemente_nueva» exige 2 fuentes verificadas', async () => {
  assert.match((await acd({ accion: 'registrar_pregunta', texto: '¿Por qué la flecha del tiempo coincide con el aumento de entropía?', origen: 'curiosidad' })).error, /motivo/);
  assert.match((await acd({ accion: 'registrar_pregunta', texto: '¿Qué conecta el puente con la física?', origen: 'puente' })).error, /unidades/);
  assert.match((await acd({ accion: 'registrar_pregunta', texto: '¿Qué fuente sostiene esta idea concreta?', origen: 'kratos', fuente_ids: [99999999] })).error, /no existen/);
  const q = (await acd({ accion: 'registrar_pregunta', texto: '¿Puede la sincronización de osciladores acoplados explicar la coherencia de fase en redes neuronales?', area: 'conciencia', campana: 'C1', unidades: ['v05'] })).pregunta_id;
  assert.ok(q);
  assert.match((await acd({ accion: 'registrar_pregunta', texto: '¿Puede la sincronización de osciladores acoplados explicar la coherencia de fase en las redes neuronales?', origen: 'kratos' })).error, /casi igual/);
  const base = { accion: 'imaginar', pregunta_id: q, titulo: 'Enganche de fase por acoplamiento débil en redes corticales', enunciado: 'Un acoplamiento débil y retardado entre poblaciones corticales basta para producir enganche de fase estable a frecuencias gamma sin un marcapasos central.', mecanismo: 'Osciladores de Kuramoto con retardo de conducción: por encima de un acoplamiento crítico aparece sincronía parcial estable.' };
  const h = await acd(base);
  assert.equal(h.estado, 'propuesta'); assert.equal(h.campana, 'C1'); assert.match(h.nota, /no es un descubrimiento/);
  const dup = await acd({ ...base, titulo: 'Enganche de fase por acoplamiento débil en las redes corticales', enunciado: base.enunciado.replace('basta', 'es suficiente') });
  assert.match(dup.error, /Casi igual a la hipótesis #\d+/);
  assert.ok(similitud(base, { titulo: 'Fonones y autoensamblaje', enunciado: 'Los modos de red cristalina favorecen el autoensamblaje molecular por resonancia mecánica.' }).enunciado < 0.2);
  const otra = await acd({ ...base, titulo: 'Ruido metabólico como reloj de sincronía', enunciado: 'Las fluctuaciones del metabolismo energético de las neuronas actúan como señal común que alinea su fase sin acoplamiento sináptico directo.', mecanismo: 'Sincronización inducida por ruido común: osciladores no acoplados reciben la misma perturbación estocástica.' });
  assert.ok(otra.hipotesis_id, JSON.stringify(otra));
  // arte previo (E03)
  assert.match((await acd({ accion: 'arte_previo', hipotesis_id: h.hipotesis_id, arte_previo: 'x'.repeat(90), novedad: 'posiblemente_nueva', fuente_ids: [fuentesOk[0], fuentesOk[2]] })).error, /2 fuentes verificadas/);
  assert.match((await acd({ accion: 'arte_previo', hipotesis_id: h.hipotesis_id, arte_previo: 'x'.repeat(90), novedad: 'conocida' })).error, /cita al menos una fuente/);
  const ap = await acd({ accion: 'arte_previo', hipotesis_id: h.hipotesis_id, arte_previo: 'Kuramoto (1975) y los modelos de redes con retardo ya estudian la sincronía; aquí cambia la ausencia de marcapasos y el régimen débil.', novedad: 'posiblemente_nueva', fuente_ids: fuentesOk.slice(0, 2) });
  assert.equal(ap.novedad, 'posiblemente_nueva'); assert.equal(ap.fuentes_verificadas_citadas, 2);
  // puntuación (D08) y ranking
  const v = { importancia: 0.8, novedad_puntos: 0.7, coherencia: 0.6, testabilidad: 0.9, coste: 0.3, evidencia: 0.4 };
  const p1 = await acd({ accion: 'puntuar', hipotesis_id: h.hipotesis_id, ...v });
  assert.equal(p1.prioridad, prioridad({ ...v, novedad: 'posiblemente_nueva' })); assert.match(p1.formula, /0,25·importancia/);
  const p2 = await acd({ accion: 'puntuar', hipotesis_id: otra.hipotesis_id, ...v, importancia: 0.2 });
  assert.match(p2.aviso, /arte previo/);
  const rk = await acd({ accion: 'ranking', campana: 'C1' });
  const pos = (id: number) => rk.ranking.findIndex((r: any) => r.id === id);
  assert.ok(pos(h.hipotesis_id) >= 0 && pos(h.hipotesis_id) < pos(otra.hipotesis_id));
  // selección (E04): sin arte previo no se selecciona nada
  assert.match((await acd({ accion: 'seleccionar', hipotesis_ids: [h.hipotesis_id, otra.hipotesis_id], criterios: 'mayor prioridad y testabilidad con un experimento barato' })).error, /no tiene arte previo/);
  const sel = await acd({ accion: 'seleccionar', hipotesis_ids: [h.hipotesis_id], criterios: 'mayor prioridad, testable con una simulación barata y novedad respaldada' });
  assert.deepEqual(sel.seleccionadas, [h.hipotesis_id]);
  const row = (await db.query(`SELECT estado, seleccionada_en, criterios_seleccion FROM acd_hipotesis WHERE id = $1`, [h.hipotesis_id])).rows[0];
  assert.equal(row.estado, 'seleccionada'); assert.ok(row.seleccionada_en); assert.match(row.criterios_seleccion, /testable/);
});

test('D04: el linaje guarda ancestros y descendientes; los padres pasan a «revisada» salvo si ya estaban rechazados', async () => {
  const a = await hipotesis(), b = await hipotesis(), f = await hipotesis();
  assert.match((await acd({ accion: 'evolucionar', padres: [a], operacion: 'combinar', titulo: `Hija ${frase(3)}`, enunciado: frase(12), mecanismo: frase(10), motivo: frase(6) })).error, /al menos 2 padres/);
  assert.match((await acd({ accion: 'evolucionar', padres: [a, b], operacion: 'refinar', titulo: `Hija ${frase(3)}`, enunciado: frase(12), mecanismo: frase(10), motivo: frase(6) })).error, /un solo padre/);
  const c = await acd({ accion: 'evolucionar', padres: [a, b], operacion: 'combinar', titulo: `Combinada ${frase(3)}`, enunciado: frase(12), mecanismo: frase(10), motivo: `combina mecanismos ${frase(4)}` });
  assert.deepEqual(c.padres, [a, b]); assert.deepEqual(c.padres_revisados, [a, b]); assert.match(c.nota, /no se apoya en resultados/);
  const d = await acd({ accion: 'evolucionar', padres: [c.hipotesis_id], operacion: 'refinar', titulo: `Refinada ${frase(3)}`, enunciado: frase(12), mecanismo: frase(10), motivo: `refina supuestos ${frase(4)}` });
  const e = await acd({ accion: 'evolucionar', padres: [a], operacion: 'modificar', titulo: `Modificada ${frase(3)}`, enunciado: frase(12), mecanismo: frase(10), motivo: `cambia el supuesto ${frase(4)}` });
  const enunA = (await db.query(`SELECT enunciado, titulo FROM acd_hipotesis WHERE id = $1`, [a])).rows[0];
  assert.match((await acd({ accion: 'evolucionar', padres: [a], operacion: 'refinar', titulo: enunA.titulo, enunciado: enunA.enunciado, mecanismo: frase(10), motivo: frase(6) })).error, /Casi igual/);   // copiar al padre no es evolucionar
  const L: any = await linaje(db, d.hipotesis_id);
  assert.equal(L.total_ancestros, 3);
  assert.equal(L.ancestros.id, d.hipotesis_id); assert.equal(L.ancestros.padres[0].id, c.hipotesis_id);
  assert.deepEqual(L.ancestros.padres[0].padres.map((x: any) => x.id), [a, b]);
  const LA: any = await linaje(db, a);
  assert.equal(LA.total_descendientes, 3);
  assert.deepEqual(LA.descendientes.hijos.map((x: any) => x.id).sort(), [c.hipotesis_id, e.hipotesis_id].sort());
  assert.equal(LA.descendientes.hijos.find((x: any) => x.id === c.hipotesis_id).hijos[0].id, d.hipotesis_id);
  assert.ok(LA.historial.some((x: any) => x.hipotesis_id === a && x.a === 'revisada'));
  const estados = Object.fromEntries((await db.query(`SELECT id, estado FROM acd_hipotesis WHERE id = ANY($1::int[])`, [[a, b, c.hipotesis_id, d.hipotesis_id]])).rows.map((r: any) => [r.id, r.estado]));
  assert.deepEqual([estados[a], estados[b], estados[c.hipotesis_id], estados[d.hipotesis_id]], ['revisada', 'revisada', 'revisada', 'propuesta']);
  await acd({ accion: 'decidir', hipotesis_id: f, estado: 'rechazada', motivo: 'el arte previo muestra que es una idea conocida renombrada' });
  const g = await acd({ accion: 'evolucionar', padres: [f], operacion: 'modificar', titulo: `Rescate ${frase(3)}`, enunciado: frase(12), mecanismo: frase(10), motivo: `nuevo mecanismo ${frase(4)}` });
  assert.deepEqual(g.padres_revisados, []);
  assert.equal((await db.query(`SELECT estado FROM acd_hipotesis WHERE id = $1`, [f])).rows[0].estado, 'rechazada');
});

test('D06: el crítico debe ser independiente (nunca Sol ni quien generó el objeto o su hipótesis/modelo)', async () => {
  const h = await hipotesis();
  const obj = (o: string, id: number, actor: string, v = 'revisar') => acd({ accion: 'criticar', objeto: o, objeto_id: id, veredicto: v, objeciones: `Los supuestos no están justificados y el baseline es demasiado débil. ${frase(8)}` }, actor);
  assert.match((await obj('hipotesis', h, SOL)).error, /Sol es la generadora/);
  assert.match((await obj('hipotesis', h, 'sol')).error, /Sol es la generadora/);
  const hs = await hipotesis(undefined, SAT);
  assert.match((await obj('hipotesis', hs, SAT)).error, /Independencia/);
  const m = await modelo(h, BUENO, 'kratos (IA)');                     // el modelo lo formalizó KRATOS sobre una hipótesis de Sol
  assert.match((await obj('modelo', m, 'kratos (IA)')).error, /Independencia/);
  assert.match((await obj('modelo', m, 'kratos (ciclo CEO)')).error, /Independencia/);   // los dos ciclos de KRATOS son el mismo agente
  assert.match((await obj('modelo', m, 'kratos')).error, /Independencia/);
  assert.match((await obj('hipotesis', h, 'kratos (IA)')).error, /Independencia/);       // quien formalizó su modelo no critica la hipótesis
  assert.match((await obj('hipotesis', h, 'Agente:SOL')).error, /Sol es la generadora/);
  assert.match((await obj('modelo', 999999, SAT)).error, /No existe/);
  const ok = await obj('hipotesis', h, SAT);
  assert.ok(ok.critica_id); assert.equal(ok.veredicto, 'revisar');
  assert.ok((await obj('modelo', m, SAT, 'rechazar')).critica_id);
  assert.match((await acd({ accion: 'criticar', objeto: 'hipotesis', objeto_id: h, veredicto: 'aceptar', objeciones: 'corta' }, SAT)).error, /objeciones/);
});

test('D03: experimento REAL en sandbox: un modelo que gana al baseline (a_favor) y otro peor (en_contra); salidas y sha256 en disco', { skip: !conPython && 'falta el Python de experimentos' }, async () => {
  const h1 = await hipotesis(), h2 = await hipotesis();
  const m1 = await modelo(h1, BUENO), m2 = await modelo(h2, MALO);
  assert.equal((await db.query(`SELECT estado FROM acd_hipotesis WHERE id = $1`, [h1])).rows[0].estado, 'formalizada');
  const a: any = await ejecutarModelo(db, m1, SOL);
  assert.equal(a.estado, 'ok', JSON.stringify(a)); assert.equal(a.veredicto, 'a_favor'); assert.equal(a.datos, 'sintetico'); assert.equal(a.exit_code, 0);
  assert.equal(a.comparacion.metricas[0].resultado, 'mejor'); assert.match(a.aviso, /no una confirmación/); assert.match(a.stdout_no_confiable, /pendiente [12]\.\d/);
  for (const f of ['modelo.py', 'salida.json', 'stdout.txt', 'stderr.txt', 'meta.json']) assert.ok(fs.existsSync(path.join(a.carpeta, f)), f);
  const code = (await db.query(`SELECT codigo, sha256 FROM acd_modelos WHERE id = $1`, [m1])).rows[0];
  assert.equal(fs.readFileSync(path.join(a.carpeta, 'modelo.py'), 'utf8'), code.codigo);
  assert.equal(sha(fs.readFileSync(path.join(a.carpeta, 'modelo.py'))), code.sha256);
  const row = (await db.query(`SELECT * FROM acd_experimentos WHERE id = $1`, [a.experimento_id])).rows[0];
  assert.equal(row.estado, 'ok'); assert.equal(row.sha256_salida, sha(fs.readFileSync(path.join(a.carpeta, 'salida.json')))); assert.equal(row.sha256_codigo, code.sha256); assert.equal(row.datos, 'sintetico');
  const meta = JSON.parse(fs.readFileSync(path.join(a.carpeta, 'meta.json'), 'utf8'));
  assert.equal(meta.veredicto, 'a_favor'); assert.equal(meta.sha256_salida, row.sha256_salida); assert.ok(meta.comando.includes('/usr/bin/sandbox-exec')); assert.ok(meta.comando.includes('-I'));
  assert.ok(a.carpeta.startsWith(fs.realpathSync(process.env.KRATOS_ACD_EXPERIMENTOS!)), 'solo en la carpeta de pruebas');
  assert.equal((await db.query(`SELECT estado FROM acd_hipotesis WHERE id = $1`, [h1])).rows[0].estado, 'probada');
  const b: any = await ejecutarModelo(db, m2, SOL);
  assert.equal(b.estado, 'ok', JSON.stringify(b)); assert.equal(b.veredicto, 'en_contra');
  assert.deepEqual(b.comparacion.metricas.map((x: any) => x.resultado), ['peor', 'peor']);
  // el veredicto lo calcula el código, no el script
  assert.equal(comparar({ m: { modelo: 1, baseline: 1.02, mejor: 'menor' } }).veredicto, 'no_concluyente');
  assert.equal(comparar({ m: { modelo: 1, baseline: 2, mejor: 'menor' }, n: { modelo: 0.5, baseline: 0.9, mejor: 'mayor' } }).veredicto, 'no_concluyente');
});

test('sandbox: abrir un socket o escribir fuera de su carpeta falla sin efectos (y no lee la carpeta personal)', { skip: !conPython && 'falta el Python de experimentos' }, async () => {
  const h = await hipotesis();
  const fuera = path.join(ROOT, '.jarvis', 'acd', `fuera-${w()}.txt`), fueraTmp = `/tmp/acd-fuera-${w()}.txt`;
  const red: any = await ejecutarModelo(db, await modelo(h, `import socket, json\ns = socket.create_connection(("1.1.1.1", 80), timeout=5)\njson.dump({"conectado": True}, open("salida.json", "w"))\n`), SOL);
  assert.equal(red.estado, 'error', JSON.stringify(red)); assert.match(red.stderr_no_confiable, /PermissionError|Operation not permitted/);
  assert.ok(!fs.existsSync(path.join(red.carpeta, 'salida.json')));
  const dns: any = await ejecutarModelo(db, await modelo(h, `import socket\nsocket.getaddrinfo("example.com", 443)\nopen("salida.json", "w").write("{}")\n`), SOL);
  assert.equal(dns.estado, 'error');
  const esc: any = await ejecutarModelo(db, await modelo(h, `open(${JSON.stringify(fuera)}, "w").write("x")\nopen("salida.json", "w").write("{}")\n`), SOL);
  assert.equal(esc.estado, 'error'); assert.match(esc.stderr_no_confiable, /PermissionError/); assert.ok(!fs.existsSync(fuera));
  const tmp: any = await ejecutarModelo(db, await modelo(h, `open(${JSON.stringify(fueraTmp)}, "w").write("x")\nopen("salida.json", "w").write("{}")\n`), SOL);
  assert.equal(tmp.estado, 'error'); assert.ok(!fs.existsSync(fueraTmp));
  const leer: any = await ejecutarModelo(db, await modelo(h, `print(open(${JSON.stringify(path.join(ROOT, 'package.json'))}).read())\nopen("salida.json", "w").write("{}")\n`), SOL);
  assert.equal(leer.estado, 'error'); assert.match(leer.stderr_no_confiable, /PermissionError/); assert.doesNotMatch(leer.stdout_no_confiable, /"name"/);
  assert.equal((await db.query(`SELECT estado FROM acd_hipotesis WHERE id = $1`, [h])).rows[0].estado, 'formalizada');   // nada de «probada»
  // sin procesos hijos: ni subprocess ni fork (no quedan huérfanos ni se lanzan programas del sistema)
  const valida = `json.dump({"datos": "ninguno", "descripcion": "prueba", "metricas": {"m": {"modelo": 1, "baseline": 1, "mejor": "menor"}}}, open("salida.json", "w"))`;
  const hijo: any = await ejecutarModelo(db, await modelo(h, `import subprocess, json\nsubprocess.run(["/bin/echo", "hola"])\n${valida}\n`), SOL);
  assert.equal(hijo.estado, 'error', JSON.stringify(hijo)); assert.match(hijo.stderr_no_confiable, /PermissionError|Operation not permitted/);
  const fork: any = await ejecutarModelo(db, await modelo(h, `import os, json\npid = os.fork()\nif pid == 0:\n    os._exit(0)\n${valida}\n`), SOL);
  assert.equal(fork.estado, 'error', JSON.stringify(fork));
  // un enlace duro a un archivo de fuera no sirve para escribir fuera
  const duro = ajeno('original');
  const ld: any = await ejecutarModelo(db, await modelo(h, `import os\nos.link(${JSON.stringify(duro)}, "enlace")\nopen("enlace", "w").write("cambiado")\nopen("salida.json", "w").write("{}")\n`), SOL);
  assert.equal(ld.estado, 'error'); assert.equal(fs.readFileSync(duro, 'utf8'), 'original');
  // enlaces simbólicos en lugar de sus archivos: KRATOS (fuera del sandbox) ni escribe meta.json a través de ellos ni lee su destino
  const victima = ajeno('NO TOCAR'), marca = `MARCA-${w()}`, secreto = ajeno(marca);
  const sim: any = await ejecutarModelo(db, await modelo(h, `import os\nos.symlink(${JSON.stringify(victima)}, "meta.json")\nos.symlink(${JSON.stringify(secreto)}, "salida.json")\nos.unlink("stdout.txt")\nos.symlink(${JSON.stringify(secreto)}, "stdout.txt")\n`), SOL);
  assert.equal(sim.estado, 'error', JSON.stringify(sim)); assert.match(sim.detalle, /stdout\.txt/);
  assert.equal(fs.readFileSync(victima, 'utf8'), 'NO TOCAR');
  assert.ok(!JSON.stringify(sim).includes(marca), 'KRATOS leyó el destino del enlace');
  assert.ok(fs.lstatSync(path.join(sim.carpeta, 'meta.json')).isFile());
  assert.equal(JSON.parse(fs.readFileSync(path.join(sim.carpeta, 'meta.json'), 'utf8')).experimento_id, sim.experimento_id);
  const sal: any = await ejecutarModelo(db, await modelo(h, `import os\nos.symlink(${JSON.stringify(secreto)}, "salida.json")\n`), SOL);
  assert.equal(sal.estado, 'contrato_invalido', JSON.stringify(sal)); assert.match(sal.detalle, /no es un archivo normal/); assert.ok(!JSON.stringify(sal).includes(marca));
  // un FIFO como salida.json no deja colgado a KRATOS
  const t0 = Date.now();
  const fifo: any = await ejecutarModelo(db, await modelo(h, `# deja un FIFO en lugar de su salida\nimport os\nos.mkfifo("salida.json")\n`), SOL);
  assert.ok(Date.now() - t0 < 15_000, 'KRATOS se quedó esperando al FIFO');
  if (fs.existsSync(path.join(fifo.carpeta, 'salida.json'))) { assert.equal(fifo.estado, 'contrato_invalido'); assert.match(fifo.detalle, /no es un archivo normal/); }
  else assert.equal(fifo.estado, 'error');
  // memoria vigilada por el código (macOS no limita la memoria con ulimit)
  const mem: any = await ejecutarModelo(db, await modelo(h, `import numpy as np, time\na = np.ones(60_000_000)\ntime.sleep(20)\nopen("salida.json", "w").write("{}")\n`), SOL, { memoriaMb: 128, timeoutS: 60 });
  assert.equal(mem.estado, 'error', JSON.stringify(mem)); assert.match(mem.detalle, /memoria/); assert.ok(mem.duracion_ms < 15_000);
  assert.equal((await db.query(`SELECT estado FROM acd_hipotesis WHERE id = $1`, [h])).rows[0].estado, 'formalizada');   // nada de esto la «probó»
});

test('contrato inválido, NaN, sin salida, tiempo agotado y un solo experimento a la vez', { skip: !conPython && 'falta el Python de experimentos' }, async () => {
  const h = await hipotesis();
  assert.match((await acd({ accion: 'registrar_modelo', hipotesis_id: h, tipo: 'estadistico', descripcion: 'x'.repeat(50), variables: 'x, y', predicciones: 'p'.repeat(40), falsacion: 'f'.repeat(40), baseline: 'b'.repeat(30), codigo: 'print("hola mundo sin escribir la salida exigida")' })).error, /salida\.json/);
  const sinMetricas: any = await ejecutarModelo(db, await modelo(h, `import json\njson.dump({"datos": "sintetico", "descripcion": "sin métricas", "metricas": {}}, open("salida.json", "w"))\n`), SOL);
  assert.equal(sinMetricas.estado, 'contrato_invalido'); assert.equal(sinMetricas.veredicto, 'invalido'); assert.match(sinMetricas.detalle, /al menos una métrica/);
  const malDatos: any = await ejecutarModelo(db, await modelo(h, `import json\njson.dump({"datos": "inventado", "descripcion": "datos sin etiqueta", "metricas": {"e": {"modelo": 1, "baseline": "2", "mejor": "menor"}}}, open("salida.json", "w"))\n`), SOL);
  assert.equal(malDatos.estado, 'contrato_invalido'); assert.match(malDatos.detalle, /datos/); assert.match(malDatos.detalle, /baseline/);
  const nan: any = await ejecutarModelo(db, await modelo(h, `import json\njson.dump({"datos": "sintetico", "descripcion": "nan", "metricas": {"e": {"modelo": float("nan"), "baseline": 1.0, "mejor": "menor"}}}, open("salida.json", "w"))\n`), SOL);
  assert.equal(nan.estado, 'contrato_invalido'); assert.match(nan.detalle, /JSON válido/);
  const nada: any = await ejecutarModelo(db, await modelo(h, `# este script no escribe salida.json a propósito\nprint("nada")\n`), SOL);
  assert.equal(nada.estado, 'contrato_invalido'); assert.match(nada.detalle, /no escribió salida\.json/);
  const t0 = Date.now();
  const lento: any = await ejecutarModelo(db, await modelo(h, `import time\ntime.sleep(30)\nopen("salida.json", "w").write("{}")\n`), SOL, { timeoutS: 2 });
  assert.equal(lento.estado, 'timeout'); assert.ok(Date.now() - t0 < 10_000);
  assert.ok(fs.existsSync(path.join(lento.carpeta, 'meta.json')));
  // límite de CPU del núcleo (red de seguridad si KRATOS muriera a mitad): un bucle que no acaba lo mata el sistema
  const t1 = Date.now();
  const cpu: any = await ejecutarModelo(db, await modelo(h, `x = 0\nwhile True:\n    x += 1\nopen("salida.json", "w").write("{}")\n`), SOL, { timeoutS: 30, cpuS: 1 });
  assert.equal(cpu.estado, 'error', JSON.stringify(cpu)); assert.match(cpu.detalle, /límite de CPU/); assert.ok(Date.now() - t1 < 15_000);
  assert.equal(JSON.parse(fs.readFileSync(path.join(cpu.carpeta, 'meta.json'), 'utf8')).limite_cpu_s, 1);
  assert.equal((await db.query(`SELECT estado FROM acd_hipotesis WHERE id = $1`, [h])).rows[0].estado, 'formalizada');
  // uno cada vez (índice único parcial de la migración 043)
  const m = await modelo(h, BUENO);
  const bloqueo = (await db.query(`INSERT INTO acd_experimentos (modelo_id, estado, created_by) VALUES ($1, 'ejecutando', 'prueba acd') RETURNING id`, [m])).rows[0].id;
  await assert.rejects(ejecutarModelo(db, m, SOL), /Ya hay un experimento/);
  await db.query(`UPDATE acd_experimentos SET inicio = now() - interval '2 hours' WHERE id = $1`, [bloqueo]);   // interrumpido por un reinicio
  const tras: any = await ejecutarModelo(db, m, SOL);
  assert.equal(tras.estado, 'ok');
  assert.equal((await db.query(`SELECT estado FROM acd_experimentos WHERE id = $1`, [bloqueo])).rows[0].estado, 'error');
  // D10 tras un reinicio: si el proceso de KRATOS que lo lanzó ya no existe, se recupera enseguida; si sigue vivo, se respeta
  const { spawnSync } = await import('node:child_process');
  const muerto = spawnSync('/usr/bin/true').pid;   // proceso ya terminado
  const ajenoVivo = (await db.query(`INSERT INTO acd_experimentos (modelo_id, estado, created_by, detalle) VALUES ($1, 'ejecutando', 'prueba acd', $2) RETURNING id`, [m, `en ejecución: pid ${muerto}, kratos ${process.pid}`])).rows[0].id;
  await assert.rejects(ejecutarModelo(db, m, SOL), /Ya hay un experimento/);
  await db.query(`UPDATE acd_experimentos SET estado = 'error' WHERE id = $1`, [ajenoVivo]);
  const huerfano = (await db.query(`INSERT INTO acd_experimentos (modelo_id, estado, created_by, detalle) VALUES ($1, 'ejecutando', 'prueba acd', $2) RETURNING id`, [m, `en ejecución: pid ${muerto}, kratos ${muerto}`])).rows[0].id;
  const tras2: any = await ejecutarModelo(db, m, SOL);
  assert.equal(tras2.estado, 'ok');
  assert.match((await db.query(`SELECT estado, detalle FROM acd_experimentos WHERE id = $1`, [huerfano])).rows[0].detalle, /interrumpido/);
});

test('D12: decidir tiene condiciones en código y no existe ningún estado «confirmado»', { skip: !conPython && 'falta el Python de experimentos' }, async () => {
  const h = await hipotesis();
  for (const e of ['confirmada', 'descubrimiento', 'verificada', 'probada']) assert.match((await acd({ accion: 'decidir', hipotesis_id: h, estado: e, motivo: 'el experimento salió muy bien y lo damos por hecho' })).error, /No existe ningún estado/);
  assert.match((await acd({ accion: 'decidir', hipotesis_id: h, estado: 'apoyada_provisional', motivo: 'parece prometedora sin haber hecho experimentos' })).error, /experimento ejecutado de verdad/);
  assert.match((await acd({ accion: 'decidir', hipotesis_id: h, estado: 'refutada', motivo: 'no me convence aunque no hay ningún experimento' })).error, /en_contra/);
  const ex: any = await ejecutarModelo(db, await modelo(h, BUENO), SOL);
  assert.equal(ex.veredicto, 'a_favor');
  assert.match((await acd({ accion: 'decidir', hipotesis_id: h, estado: 'apoyada_provisional', motivo: 'el experimento salió a favor del modelo frente a la media' })).error, /crítica «aceptar»/);
  await acd({ accion: 'criticar', objeto: 'experimento', objeto_id: ex.experimento_id, veredicto: 'revisar', objeciones: `El baseline (la media) es débil; falta comparar con un modelo alternativo razonable. ${frase(5)}` }, SAT);
  assert.match((await acd({ accion: 'decidir', hipotesis_id: h, estado: 'apoyada_provisional', motivo: 'el experimento salió a favor del modelo frente a la media' })).error, /crítica «aceptar»/);
  assert.match((await acd({ accion: 'decidir', hipotesis_id: h, estado: 'refutada', motivo: 'el experimento salió a favor: no hay nada en contra' })).error, /en_contra/);
  const ac = await acd({ accion: 'criticar', objeto: 'experimento', objeto_id: ex.experimento_id, veredicto: 'aceptar', objeciones: `Resultado coherente con el modelo; datos sintéticos, así que solo muestra coherencia interna. ${frase(5)}` }, SAT);
  const d = await acd({ accion: 'decidir', hipotesis_id: h, estado: 'apoyada_provisional', motivo: 'experimento a favor y crítica independiente que lo acepta' });
  assert.equal(d.estado, 'apoyada_provisional', JSON.stringify(d)); assert.equal(d.evidencia.experimento, ex.experimento_id); assert.equal(d.evidencia.critica, ac.critica_id);
  assert.match(d.aviso, /NO es un descubrimiento confirmado/);
  // «ver» da al crítico el registro completo: código, salida, comparación, integridad, críticas e historial
  const ve: any = await acd({ accion: 'ver', objeto: 'experimento', objeto_id: ex.experimento_id }, SAT);
  assert.equal(ve.experimento.archivos_intactos, true); assert.equal(ve.experimento.veredicto, 'a_favor'); assert.equal(ve.criticas.length, 2); assert.equal(ve.experimento.archivos.length, 5);
  const vm: any = await acd({ accion: 'ver', objeto: 'modelo', objeto_id: ex.modelo_id }, SAT);
  assert.equal(vm.modelo.codigo, BUENO); assert.equal(vm.modelo.sha256_coincide, true); assert.equal(vm.experimentos[0].integridad, 'archivos intactos');
  const vh: any = await acd({ accion: 'ver', objeto: 'hipotesis', objeto_id: h }, SAT);
  assert.equal(vh.hipotesis.estado, 'apoyada_provisional'); assert.equal(vh.criticas.length, 2); assert.deepEqual(vh.historial.map((x: any) => x.a), ['propuesta', 'formalizada', 'probada', 'apoyada_provisional']);
  const pid = (await db.query(`SELECT pregunta_id FROM acd_hipotesis WHERE id = $1`, [h])).rows[0].pregunta_id;
  assert.equal(((await acd({ accion: 'ver', objeto: 'pregunta', objeto_id: pid })) as any).hipotesis[0].id, h);
  assert.match((await acd({ accion: 'ver', objeto: 'experimento', objeto_id: 99999999 })).error, /No existe/);
  assert.match((await acd({ accion: 'criticar', objeto: 'pregunta', objeto_id: pid, veredicto: 'aceptar', objeciones: 'x'.repeat(90) }, SAT)).error, /objeto: hipotesis, modelo o experimento/);
  // una crítica «aceptar» anterior al experimento no evalúa sus resultados
  const h2 = await hipotesis();
  await acd({ accion: 'criticar', objeto: 'hipotesis', objeto_id: h2, veredicto: 'aceptar', objeciones: `La idea es coherente a priori, pero aún no hay ningún resultado que evaluar. ${frase(5)}` }, SAT);
  await ejecutarModelo(db, await modelo(h2, BUENO), SOL);
  assert.match((await acd({ accion: 'decidir', hipotesis_id: h2, estado: 'apoyada_provisional', motivo: 'experimento a favor y una crítica que la aceptaba antes' })).error, /después del experimento/);
  // con los archivos alterados, el experimento ya no cuenta
  const h3 = await hipotesis();
  const ex3: any = await ejecutarModelo(db, await modelo(h3, MALO), SOL);
  fs.writeFileSync(path.join(ex3.carpeta, 'salida.json'), '{"alterado": true}');
  assert.match((await acd({ accion: 'decidir', hipotesis_id: h3, estado: 'refutada', motivo: 'el experimento salió en contra del modelo' })).error, /en_contra/);
  // un resultado a favor antiguo no vale si después salió otro en contra (nada de quedarse con el que conviene)
  const acepta = (id: number, actor = SAT) => acd({ accion: 'criticar', objeto: 'experimento', objeto_id: id, veredicto: 'aceptar', objeciones: `El modelo gana al baseline en datos sintéticos; solo coherencia interna. ${frase(5)}` }, actor);
  const h4 = await hipotesis();
  const e4: any = await ejecutarModelo(db, await modelo(h4, BUENO), SOL);
  assert.ok((await acepta(e4.experimento_id)).critica_id);
  const e4b: any = await ejecutarModelo(db, await modelo(h4, MALO), SOL);
  assert.equal(e4b.veredicto, 'en_contra');
  assert.match((await acd({ accion: 'decidir', hipotesis_id: h4, estado: 'apoyada_provisional', motivo: 'el primer experimento salió a favor y fue aceptado' })).error, /posterior #\d+ salió en_contra/);
  assert.equal((await acd({ accion: 'decidir', hipotesis_id: h4, estado: 'refutada', motivo: 'la versión 2 del modelo salió en contra frente al baseline' })).estado, 'refutada');
  // una aceptación que otro crítico independiente rechaza después tampoco basta
  const h5 = await hipotesis();
  const e5: any = await ejecutarModelo(db, await modelo(h5, BUENO), SOL);
  assert.ok((await acepta(e5.experimento_id)).critica_id);
  assert.ok((await acd({ accion: 'criticar', objeto: 'hipotesis', objeto_id: h5, veredicto: 'rechazar', objeciones: `El baseline es un hombre de paja: cualquier ajuste le gana; la comparación no dice nada. ${frase(5)}` }, 'agente:urano')).critica_id);
  assert.match((await acd({ accion: 'decidir', hipotesis_id: h5, estado: 'apoyada_provisional', motivo: 'experimento a favor y una crítica que lo aceptó' })).error, /lo rechazó después/);
  const d5 = await acepta(e5.experimento_id, 'agente:urano');   // el mismo crítico revisa y acepta: ahora la última palabra es «aceptar»
  assert.equal((await acd({ accion: 'decidir', hipotesis_id: h5, estado: 'apoyada_provisional', motivo: 'experimento a favor; Urano retiró su rechazo tras revisarlo' })).evidencia.critica, d5.critica_id);
  const estados = (await db.query(`SELECT DISTINCT estado FROM acd_hipotesis`)).rows.map((r: any) => r.estado);
  assert.ok(!estados.some((e: string) => /confirm|descubr/.test(e)));
});

test('D04: el linaje de combinaciones repetidas no crece de forma exponencial', async () => {
  const xs = [await hipotesis(), await hipotesis()];
  for (let n = 0; n < 14; n++) {
    const r = await acd({ accion: 'evolucionar', padres: [xs.at(-1), xs.at(-2)], operacion: 'combinar', titulo: `Combinada ${frase(3)}`, enunciado: frase(12), mecanismo: frase(10), motivo: `combina mecanismos ${frase(4)}` });
    assert.ok(r.hipotesis_id, JSON.stringify(r)); xs.push(r.hipotesis_id);
  }
  const L: any = await linaje(db, xs.at(-1)!);
  assert.equal(L.total_ancestros, 15);
  const s = JSON.stringify(L.ancestros);
  assert.equal((s.match(/"padres":/g) ?? []).length, 16, 'cada hipótesis se despliega una sola vez');
  assert.ok(s.length < 20_000, `árbol de ${s.length} caracteres`);
  assert.equal(((await linaje(db, xs[0])) as any).total_descendientes, 14);
});

test('campaña: E01–E12 se calculan con datos; ACD_CHECKS cuentan solo lo hecho durante la tarea; sobrevive a un reinicio', { skip: !conPython && 'falta el Python de experimentos' }, async () => {
  const K = 'C90';
  const t0 = new Date(Date.now() - 1000);
  const tarea = { id: 0, owner_function: 'sol', started_at: t0 }, ctx = (task: any, params: Record<string, unknown> = { campana: K }) => ({ texto: '', params, extraido: {}, db, task });
  let c: any = await campanaEstado(db, K);
  assert.equal(c.etapa_siguiente, 'ideas'); assert.ok(c.puntos.every((p: any) => p.estado === 'NOT_STARTED'));
  for (let n = 0; n < 10; n++) await pregunta(K);
  const hs: number[] = [];
  for (let n = 0; n < 20; n++) hs.push(await hipotesis(K));
  c = await campanaEstado(db, K);
  assert.equal(c.puntos[0].estado, 'VERIFIED'); assert.equal(c.puntos[1].estado, 'VERIFIED'); assert.equal(c.puntos[2].estado, 'NOT_STARTED');
  assert.equal((await ACD_CHECKS.acd_preguntas_min.comprobar({ minimo: 30, campana: '{{campana}}' }, ctx(tarea))).ok, true);    // 10 + una por hipótesis
  assert.equal((await ACD_CHECKS.acd_preguntas_min.comprobar({ minimo: 31, campana: '{{campana}}' }, ctx(tarea))).ok, false);
  assert.equal((await ACD_CHECKS.acd_preguntas_min.comprobar({ minimo: 1, campana: '{{campana}}' }, ctx({ ...tarea, started_at: new Date(Date.now() + 60_000) }))).ok, false);   // fuera de la tarea
  assert.equal((await ACD_CHECKS.acd_preguntas_min.comprobar({ minimo: 1, campana: '{{campana}}' }, ctx({ ...tarea, owner_function: 'saturno' }))).ok, false);   // otro agente
  assert.equal((await ACD_CHECKS.acd_hipotesis_min.comprobar({ minimo: 20, campana: '{{campana}}', con_arte_previo: true }, ctx(tarea))).ok, false);
  for (const h of hs) {
    await acd({ accion: 'arte_previo', hipotesis_id: h, arte_previo: `Variante de trabajos previos sobre ${frase(6)}; difiere en el supuesto central.`, novedad: 'variante', fuente_ids: [fuentesOk[0]] });
    await acd({ accion: 'puntuar', hipotesis_id: h, importancia: Math.random(), novedad_puntos: 0.5, coherencia: 0.5, testabilidad: 0.7, coste: 0.2, evidencia: 0.3 });
  }
  const chk = await ACD_CHECKS.acd_hipotesis_min.comprobar({ minimo: 20, campana: '{{campana}}', con_arte_previo: true, con_puntos: true }, ctx(tarea));
  assert.equal(chk.ok, true, chk.detalle);
  const top = (await acd({ accion: 'ranking', campana: K, n: 5 })).ranking.map((r: any) => r.id);
  assert.ok((await acd({ accion: 'seleccionar', hipotesis_ids: top, criterios: 'las cinco de mayor prioridad según la fórmula, todas testables con simulación' })).seleccionadas);
  assert.equal((await ACD_CHECKS.acd_seleccionadas_min.comprobar({ minimo: 5, campana: '{{campana}}' }, ctx(tarea))).ok, true);
  c = await campanaEstado(db, K);
  assert.deepEqual(c.puntos.slice(0, 4).map((p: any) => p.estado), ['VERIFIED', 'VERIFIED', 'VERIFIED', 'VERIFIED']); assert.equal(c.etapa_siguiente, 'modelos');
  // E05–E08: una seleccionada se formaliza y se ejecuta; las otras cuatro se archivan como inviables (antes de los resultados)
  for (const h of top.slice(1)) await acd({ accion: 'decidir', hipotesis_id: h, estado: 'archivada', motivo: 'no se puede formalizar con honestidad con los datos disponibles' });
  const m = await modelo(top[0], BUENO);
  assert.equal((await ACD_CHECKS.acd_modelos_min.comprobar({ minimo: 1, campana: '{{campana}}' }, ctx(tarea))).ok, true);
  assert.equal((await ACD_CHECKS.acd_experimentos_ok_min.comprobar({ minimo: 1, campana: '{{campana}}' }, ctx(tarea))).ok, false);
  const ex: any = await ejecutarModelo(db, m, SOL);
  assert.equal(ex.estado, 'ok');
  assert.equal((await ACD_CHECKS.acd_experimentos_ok_min.comprobar({ minimo: 1, campana: '{{campana}}' }, ctx(tarea))).ok, true);
  c = await campanaEstado(db, K);
  assert.deepEqual(c.puntos.slice(4, 8).map((p: any) => p.estado), ['VERIFIED', 'VERIFIED', 'VERIFIED', 'VERIFIED'], JSON.stringify(c.puntos.slice(4, 8)));
  assert.equal(c.etapa_siguiente, 'critica'); assert.equal(c.puntos[9].estado, 'IN_PROGRESS');   // los archivos anteriores a los resultados no cuentan para E10
  // E09: crítica independiente posterior al experimento
  const critico = { id: 0, owner_function: 'saturno', started_at: new Date() };
  await acd({ accion: 'criticar', objeto: 'experimento', objeto_id: ex.experimento_id, veredicto: 'aceptar', objeciones: `El ajuste gana a la media en datos sintéticos; solo prueba coherencia interna. ${frase(5)}` }, SAT);
  assert.equal((await ACD_CHECKS.acd_criticas_min.comprobar({ minimo: 1, campana: '{{campana}}' }, ctx(critico))).ok, true);
  assert.equal((await ACD_CHECKS.acd_criticas_min.comprobar({ minimo: 1, campana: '{{campana}}' }, ctx(critico, { campana: 'C1' }))).ok, false);
  c = await campanaEstado(db, K);
  assert.equal(c.puntos[8].estado, 'VERIFIED'); assert.equal(c.etapa_siguiente, 'evolucion');
  // E10–E12
  const evo = await acd({ accion: 'evolucionar', padres: [top[0]], operacion: 'refinar', titulo: `Refinada ${frase(3)}`, enunciado: frase(12), mecanismo: frase(10), motivo: `responde a la objeción de Saturno ${frase(3)}` });
  assert.equal(evo.retroalimentacion.experimentos_ok, 1); assert.equal(evo.retroalimentacion.criticas, 1);
  assert.equal((await ACD_CHECKS.acd_decisiones_min.comprobar({ minimo: 1, campana: '{{campana}}' }, ctx({ ...tarea, started_at: new Date(Date.now() - 2000) }))).ok, true);
  await acd({ accion: 'registrar_pregunta', texto: `¿${frase(8)}?`, campana: 'C91', origen: 'curiosidad', motivo: `el experimento #${ex.experimento_id} solo usó datos sintéticos` });
  c = await campanaEstado(db, K);
  assert.equal(c.verificados, 12, JSON.stringify(c.puntos.filter((p: any) => p.estado !== 'VERIFIED')));
  assert.equal(c.completa, true); assert.equal(c.etapa_siguiente, null);
  const porHerramienta: any = await acd({ accion: 'campana', codigo: K });
  assert.equal(porHerramienta.codigo, K); assert.equal(porHerramienta.verificados, 12);
  // A25: otro proceso (otra conexión) recupera exactamente lo mismo
  const db2 = createPool();
  try { assert.equal((await campanaEstado(db2, K)).verificados, 12); assert.equal(((await linaje(db2, evo.hipotesis_id)) as any).ancestros.padres[0].id, top[0]); } finally { await db2.end(); }
  // E11: si se pierde una salida conservada, la campaña lo dice
  fs.rmSync(path.join(ex.carpeta, 'salida.json'));
  c = await campanaEstado(db, K);
  assert.equal(c.puntos[10].estado, 'FAILED'); assert.notEqual(c.puntos[6].estado, 'VERIFIED');
  // acd_unidad
  await acd({ accion: 'registrar_pregunta', texto: `¿${frase(8)}?`, origen: 'puente', unidades: ['B07'] });
  assert.equal((await ACD_CHECKS.acd_unidad.comprobar({ unidad: '{{unidad}}' }, ctx(tarea, { unidad: 'B07' }))).ok, true);
  assert.equal((await ACD_CHECKS.acd_unidad.comprobar({ unidad: '{{unidad}}' }, ctx(tarea, { unidad: 'B08' }))).ok, false);
  assert.equal((await ACD_CHECKS.acd_unidad.comprobar({}, { texto: '', params: {}, extraido: {} })).ok, false);
});

test('los siete playbooks son válidos con las comprobaciones ACD registradas', async () => {
  const { CHECK_TYPES } = await import('../src/core/playbookchecks.ts');
  const { validateShape } = await import('../src/core/playbooks.ts');
  const { skillsFor } = await import('../src/core/skills.ts');
  const { COMPONENTES } = await import('../src/core/omega.ts');
  const antes = { ...CHECK_TYPES };
  try {
    for (const [k, v] of Object.entries(ACD_CHECKS)) CHECK_TYPES[k] = v.claves;   // lo que hará el integrador
    for (const id of ACD_FAMILIA) {
      const agente = id === 'acd-critica' ? 'saturno' : 'sol';
      const pb = JSON.parse(fs.readFileSync(path.join(ROOT, 'playbooks', agente, `${id}.json`), 'utf8'));
      const v = validateShape(pb);
      assert.ok(v.ok, `${id}: ${v.errores.join('; ')}`);
      assert.equal(pb.agentes.responsable, agente); assert.ok(pb.herramientas.includes('acd'), id);
      assert.ok(skillsFor(agente).some((s) => s.name === pb.skill), `${id}: skill ${pb.skill}`);
      for (const c of pb.verificacion) if (ACD_CHECKS[c.tipo]) assert.ok(ACD_CHECKS[c.tipo].describir(c, { campana: 'C1', unidad: 'B01' }).length > 10);
      // honestidad en las instrucciones: nada de descubrimientos y datos simulados u observados etiquetados
      const todo = JSON.stringify(pb).toLowerCase();
      assert.match(todo, /descubrimiento/, `${id}: prohíbe presentar especulación como descubrimiento`); assert.match(todo, /simulad/, id); assert.match(todo, /observad/, id);
      assert.ok(pb.verificacion.some((c: any) => c.tipo === 'sin_frases'), `${id}: sin_frases`);
      for (const c of pb.verificacion.filter((c: any) => c.tipo === 'sin_frases')) for (const f of c.frases) assert.doesNotMatch(f, /^(he|hemos|no) /, `${id}: «${f}» castigaría una negación honesta («no ${f}»)`);
      if (agente === 'sol') {
        const entrega = pb.pasos.at(-1);
        assert.equal(entrega.herramienta, 'proyecto_sol', `${id}: termina con la entrega`); assert.match(entrega.instruccion, /accion=entregar/);
        assert.match(entrega.instruccion, id === 'sol-puente' ? /tipo=puente/ : /tipo=acd/, `${id}: entrega`);
        for (const k of COMPONENTES[id === 'sol-puente' ? 'puente' : 'acd']) assert.ok(entrega.instruccion.includes(k), `${id}: falta el componente ${k}`);
      }
    }
    const puente = JSON.parse(fs.readFileSync(path.join(ROOT, 'playbooks', 'sol', 'sol-puente.json'), 'utf8'));
    for (let n = 1; n <= 9; n++) assert.ok(puente.pasos.some((p: any) => p.titulo.startsWith(`Paso ${n} ·`)), `sol-puente: paso ${n} del método`);
  } finally { for (const k of Object.keys(CHECK_TYPES)) if (!(k in antes)) delete CHECK_TYPES[k]; }
});

test('D10: el planificador sigue el orden, respeta el cupo, la parada y una sola tarea abierta (lanzador simulado)', async () => {
  const biz = (await db.query(`SELECT id FROM businesses ORDER BY id LIMIT 1`)).rows[0].id;
  assert.equal((await db.query(`SELECT count(*)::int AS n FROM tasks WHERE playbook_id = ANY($1::text[]) AND (status IN ('pendiente','en_ejecucion','verificando','esperando_ia','esperando_permiso') OR created_by = ANY($2::text[]))`,
    [ACD_FAMILIA, [PLANIFICADOR, CURIOSO]])).rows[0].n, 0, 'restos de una ejecución anterior en la BD de pruebas');
  for (const [codigo, tipo, orden] of [['G01', 'generativa', 1], ['G02', 'generativa', 2], ['B01', 'puente', 1]] as const) {
    const r = await db.query(`INSERT INTO sol_unidades (codigo, tipo, area, titulo, alcance, orden, relacionadas) VALUES ($1,$2,$2,$3,'alcance de prueba',$4,'{S17}') ON CONFLICT (codigo) DO NOTHING RETURNING codigo`, [codigo, tipo, `Unidad de prueba ${codigo}`, orden]);
    if (r.rowCount) unidadesCreadas.push(codigo);
  }
  assert.equal(unidadesCreadas.length, 3, 'la BD de pruebas no debía tener estas unidades');
  await db.query(`UPDATE system_state SET value = '20' WHERE key = 'acd_tareas_dia'`);
  const planes: PlanAcd[] = [];
  const lanzar = async (_d: Db, p: PlanAcd) => {
    planes.push(p);
    const t = (await db.query(`INSERT INTO tasks (business_id, owner_function, type, title, objective, expected_result, verification, status, created_by, playbook_id, playbook_version, inputs)
      VALUES ($1,$2,'agente',$3,'x','x','x','pendiente',$4,$5,1,$6) RETURNING id`, [biz, p.playbook === 'acd-critica' ? 'saturno' : 'sol', `Prueba ACD ${p.playbook}`, p.creadoPor, p.playbook, JSON.stringify({ playbook: p.playbook, parametros: p.parametros })])).rows[0];
    return { tarea: t.id as number };
  };
  const fin = async (id: number, status: string, ok = status === 'completada', empezada = true) =>
    db.query(`UPDATE tasks SET status = $2, verification_result = $3, started_at = CASE WHEN $4 THEN coalesce(started_at, now()) ELSE started_at END WHERE id = $1`, [id, status, JSON.stringify({ ok }), empezada]);
  const paso = async () => (await advanceAcd(db, 'prueba acd', lanzar)) as any;
  // (1) campaña C1 primero, con su propio creador (A20); una sola tarea abierta
  let r = await paso();
  assert.equal(r.lanzado?.playbook, 'acd-campana-ideas', JSON.stringify(r)); assert.equal(r.lanzado.creadoPor, PLANIFICADOR); assert.equal(r.lanzado.parametros.campana, 'C1');
  assert.match((await paso()).motivo, /ya hay una tarea ACD abierta/);
  // una tarea que nunca llegó a ejecutarse (p. ej. le faltaba una herramienta) no gasta intento
  await fin(r.lanzado.tarea, 'requiere_revision', false, false);
  r = await paso();
  assert.equal(r.lanzado?.playbook, 'acd-campana-ideas'); assert.doesNotMatch(r.lanzado.motivo, /reintento/);
  // un paso fallido se reintenta como mucho 2 veces y luego la campaña queda bloqueada
  for (let n = 0; n < 2; n++) { await fin(r.lanzado.tarea, 'fallida'); r = await paso(); assert.equal(r.lanzado?.playbook, 'acd-campana-ideas'); assert.match(r.lanzado.motivo, /reintento/); }
  await fin(r.lanzado.tarea, 'fallida');
  // (2) tema generativo
  r = await paso();
  assert.equal(r.lanzado?.paso, 'generativa', JSON.stringify(r)); assert.equal(r.lanzado.unidad, 'G01'); assert.ok(r.bloqueos.some((b: string) => /detenida en la etapa ideas/.test(b)));
  let u = (await db.query(`SELECT estado, intentos, tarea_id FROM sol_unidades WHERE codigo = 'G01'`)).rows[0];
  assert.deepEqual([u.estado, u.intentos, u.tarea_id], ['en_curso', 1, r.lanzado.tarea]);
  // G01 termina verificada con su expediente: estudiada, proyecto ligado y requisito G01; (3) toca un puente (alterna)
  const proy = (await db.query(`INSERT INTO sol_proyectos (tarea_id, titulo, tipo, estado) VALUES ($1, 'Prueba ACD G01', 'acd', 'completed') RETURNING id`, [r.lanzado.tarea])).rows[0].id;
  await fin(r.lanzado.tarea, 'completada');
  r = await paso();
  u = (await db.query(`SELECT estado, proyecto_id, completado_en FROM sol_unidades WHERE codigo = 'G01'`)).rows[0];
  assert.equal(u.estado, 'estudiada'); assert.equal(u.proyecto_id, proy); assert.ok(u.completado_en);
  assert.equal((await db.query(`SELECT requisito FROM sol_proyectos WHERE id = $1`, [proy])).rows[0].requisito, 'G01');
  assert.equal(r.lanzado?.unidad, 'B01', JSON.stringify(r)); assert.equal(r.lanzado.playbook, 'sol-puente'); assert.ok(r.cerradas.some((x: any) => x.unidad === 'G01' && x.estado === 'estudiada'));
  // B01 falla: vuelve a pendiente y ahora toca G02 (alterna); una tarea «completada» sin verificación no cuenta
  await fin(r.lanzado.tarea, 'fallida');
  r = await paso();
  assert.equal(r.lanzado?.unidad, 'G02'); assert.equal((await db.query(`SELECT estado FROM sol_unidades WHERE codigo = 'B01'`)).rows[0].estado, 'pendiente');
  await fin(r.lanzado.tarea, 'completada', false);
  r = await paso();
  assert.equal(r.lanzado?.unidad, 'B01'); assert.equal((await db.query(`SELECT estado FROM sol_unidades WHERE codigo = 'G02'`)).rows[0].estado, 'pendiente');
  await fin(r.lanzado.tarea, 'cancelada');
  r = await paso();
  assert.equal((await db.query(`SELECT estado FROM sol_unidades WHERE codigo = 'B01'`)).rows[0].estado, 'fallida');   // 2 lanzamientos sin éxito
  assert.equal(r.lanzado?.unidad, 'G02');
  await fin(r.lanzado.tarea, 'fallida');
  // (4) crítica de lo formalizado o probado sin crítica independiente (hay de las pruebas anteriores)
  r = await paso();
  assert.equal(r.lanzado?.paso, 'critica', JSON.stringify(r)); assert.equal(r.lanzado.parametros.campana, ''); assert.match(r.lanzado.parametros.alcance, /#\d+/);
  assert.equal((await db.query(`SELECT estado FROM sol_unidades WHERE codigo = 'G02'`)).rows[0].estado, 'fallida');
  await fin(r.lanzado.tarea, 'completada');
  r = await paso(); assert.equal(r.lanzado?.paso, 'critica'); await fin(r.lanzado.tarea, 'completada');
  // (5) curiosidad autónoma (D05/A20), creada como «acd (curiosidad)» con las señales de la biblioteca
  r = await paso();
  assert.equal(r.lanzado?.paso, 'curiosidad', JSON.stringify(r)); assert.equal(r.lanzado.creadoPor, CURIOSO); assert.equal(typeof r.lanzado.parametros.foco, 'string');
  if (conPython) assert.match(r.lanzado.parametros.foco, /experimentos ACD en contra: #\d+/);
  await fin(r.lanzado.tarea, 'completada');
  r = await paso();
  assert.equal(r.lanzado, null); assert.match(r.motivo, /nada pendiente/);
  assert.deepEqual(planes.map((p) => p.playbook), ['acd-campana-ideas', 'acd-campana-ideas', 'acd-campana-ideas', 'acd-campana-ideas', 'sol-generativa', 'sol-puente', 'sol-generativa', 'sol-puente', 'sol-generativa', 'acd-critica', 'acd-critica', 'acd-curiosidad']);
  assert.ok(planes.every((p) => [PLANIFICADOR, CURIOSO].includes(p.creadoPor)));
  // cupo diario, pausa y parada
  const hoy = (await db.query(`SELECT count(*)::int AS n FROM tasks WHERE playbook_id = ANY($1::text[]) AND created_by = ANY($2::text[]) AND created_at > now() - interval '24 hours'`, [ACD_FAMILIA, [PLANIFICADOR, CURIOSO]])).rows[0].n;
  assert.equal(hoy, 12);
  await db.query(`UPDATE sol_unidades SET estado = 'pendiente', intentos = 0 WHERE codigo = 'G02'`);
  await db.query(`UPDATE system_state SET value = $1 WHERE key = 'acd_tareas_dia'`, [JSON.stringify(hoy)]);
  assert.match((await paso()).motivo, /cupo diario alcanzado \(12\/12\)/);
  await db.query(`UPDATE system_state SET value = '0' WHERE key = 'acd_tareas_dia'`);
  assert.match((await paso()).motivo, /pausa/);
  await db.query(`UPDATE system_state SET value = '20' WHERE key = 'acd_tareas_dia'`);
  await db.query(`UPDATE system_state SET value = 'true' WHERE key = 'emergency_stop'`);
  try { assert.match((await paso()).motivo, /detenido/); } finally { await db.query(`UPDATE system_state SET value = 'false' WHERE key = 'emergency_stop'`); }
  const plan = await planificarAcd(db);
  assert.equal(plan.plan?.unidad, 'G02');                       // tras la parada, sigue donde estaba
  assert.equal(planes.length, 12);
  // un error al lanzar no se repite en cada vuelta del trabajador
  const roto = async () => { throw new Error('No existe el playbook sol-generativa'); };
  assert.match((await advanceAcd(db, 'prueba acd', roto) as any).motivo, /No existe el playbook/);
  assert.match((await advanceAcd(db, 'prueba acd', roto) as any).motivo, /esperando tras un error/);
  assert.equal((await db.query(`SELECT estado, intentos FROM sol_unidades WHERE codigo = 'G02'`)).rows[0].estado, 'pendiente');
  // KRATOS lo entiende (D09/A26)
  const s: any = await resumenAcd(db);
  assert.match(s.descubrimientos, /ninguno confirmado/); assert.ok(s.experimentos.resultados_verificados >= 1); assert.ok(s.experimentos.ejecutados >= s.experimentos.ok);
  assert.match(s.siguiente_paso, /sol-generativa/); assert.equal(s.campana.codigo, 'C1'); assert.equal(s.campana.puntos.length, 12);
  assert.ok(s.limitaciones.some((l: string) => /sometida a prueba/.test(l)));
  assert.match((await acd({ accion: 'nada' })).error, /Acción no válida/);
  assert.equal((await acd({ accion: 'estado' })).descubrimientos, s.descubrimientos);
  // el expediente que encontró proyecto_sol_completo («proyecto P<id>») se liga a la unidad aunque no lleve su tarea_id
  const tG = (await db.query(`INSERT INTO tasks (business_id, owner_function, type, title, objective, expected_result, verification, status, created_by, playbook_id, playbook_version, inputs, started_at)
    VALUES ($1,'sol','agente','Prueba ACD G02 verificada','x','x','x','completada','prueba acd','sol-generativa',1,'{}', now()) RETURNING id`, [biz])).rows[0].id;
  const pG = (await db.query(`INSERT INTO sol_proyectos (titulo, tipo, estado) VALUES ('Prueba ACD G02', 'acd', 'completed') RETURNING id`)).rows[0].id;
  await db.query(`UPDATE tasks SET verification_result = $2 WHERE id = $1`, [tG, JSON.stringify({ ok: true, comprobaciones: [{ nombre: 'playbook · expediente', ok: true, detalle: `proyecto P${pG}, 6 archivos en /tmp/x` }] })]);
  await db.query(`UPDATE sol_unidades SET estado = 'en_curso', tarea_id = $1 WHERE codigo = 'G02'`, [tG]);
  const cierre: any = await advanceAcd(db, 'prueba acd', roto);
  assert.ok(cierre.cerradas.some((x: any) => x.unidad === 'G02' && x.estado === 'estudiada'), JSON.stringify(cierre));
  assert.equal((await db.query(`SELECT proyecto_id FROM sol_unidades WHERE codigo = 'G02'`)).rows[0].proyecto_id, pG);
  assert.equal((await db.query(`SELECT requisito FROM sol_proyectos WHERE id = $1`, [pG])).rows[0].requisito, 'G02');
});
