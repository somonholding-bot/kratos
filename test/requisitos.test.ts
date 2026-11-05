// PROJECT SOL / ACD: el rastreador de requisitos solo da por verificado lo que tiene evidencia real y baja si la evidencia desaparece.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createPool, type Db } from '../src/db.ts';
import { migrate } from '../src/migrate.ts';
import { audit } from '../src/core/state.ts';
import { REQUISITOS, TOTAL_REQUISITOS, seedSolDef } from '../src/core/sol-def.ts';
import { ESTADOS, REQUISITOS_TOOL, conectoresUsados, examenAprobado, exportRequisitos, herramientaRequisitos, informeSol, refreshRequisitos } from '../src/core/requisitos.ts';

// Nunca contra la base de producción
if (!process.env.JARVIS_DB || process.env.JARVIS_DB === 'jarvis') throw new Error('Estas pruebas exigen JARVIS_DB con una base de pruebas (nunca «jarvis»)');

const M = '[req-test]';   // marca de las filas que crea esta prueba (y solo esas se borran)
const IDS = REQUISITOS.map((r) => r.id);
let db: Db, raiz: string, vacia: string, biz: number, parada: any, desde: Date;   // desde: audit_log es de solo inserción; cada prueba ignora las filas anteriores
const foto: Record<string, any[]> = {};
const snap = async (t: string, k: string) => (await db.query(`SELECT to_jsonb(x) AS j FROM ${t} x ORDER BY ${k}`)).rows.map((r) => r.j);
async function restore(t: string, k: string, rows: any[]) {
  await db.query(`DELETE FROM ${t} WHERE NOT (${k} = ANY($1))`, [rows.map((r) => r[k])]);
  for (const r of rows) {
    const cols = Object.keys(r).filter((c) => c !== k);
    await db.query(`INSERT INTO ${t} SELECT * FROM jsonb_populate_record(null::${t}, $1) ON CONFLICT (${k}) DO UPDATE SET ${cols.map((c) => `${c} = EXCLUDED.${c}`).join(', ')}`, [r]);
  }
}
async function limpiar() {
  const hs = `SELECT id FROM acd_hipotesis WHERE titulo LIKE '${M}%'`;
  await db.query(`DELETE FROM acd_criticas WHERE objeciones LIKE $1`, [`${M}%`]);
  if ((await db.query(`SELECT to_regclass('public.acd_historial') IS NOT NULL AS ok`)).rows[0].ok) await db.query(`DELETE FROM acd_historial WHERE hipotesis_id IN (${hs})`);
  await db.query(`DELETE FROM acd_experimentos WHERE modelo_id IN (SELECT id FROM acd_modelos WHERE hipotesis_id IN (${hs}))`);
  await db.query(`DELETE FROM acd_modelos WHERE hipotesis_id IN (${hs})`);
  await db.query(`DELETE FROM acd_hipotesis WHERE titulo LIKE $1`, [`${M}%`]);
  await db.query(`DELETE FROM acd_preguntas WHERE texto LIKE $1`, [`${M}%`]);
  await db.query(`DELETE FROM sol_examenes WHERE preguntas @> $1::jsonb`, [JSON.stringify([{ marca: 'req-test' }])]);
  await db.query(`DELETE FROM sol_proyectos WHERE titulo LIKE $1`, [`${M}%`]);
  await db.query(`DELETE FROM sol_afirmaciones WHERE texto LIKE $1`, [`${M}%`]);
  await db.query(`DELETE FROM sol_fuentes WHERE titulo LIKE $1`, [`${M}%`]);
  await db.query(`DELETE FROM sol_conexiones WHERE explicacion LIKE $1`, [`${M}%`]);
  await db.query(`DELETE FROM sol_conectores_pruebas WHERE detalle LIKE $1`, [`${M}%`]);
  await db.query(`DELETE FROM tasks WHERE title LIKE $1`, [`${M}%`]);
  await db.query(`UPDATE sol_unidades SET estado = 'pendiente', tarea_id = NULL, proyecto_id = NULL, intentos = 0, lanzado_en = NULL, completado_en = NULL`);
  if (raiz) { fs.rmSync(raiz, { recursive: true, force: true }); fs.mkdirSync(raiz, { recursive: true }); }
  desde = (await db.query(`SELECT now() AS n`)).rows[0].n;
}

const refrescar = (o: Record<string, unknown> = {}) => refreshRequisitos(db, { raiz, actor: 'prueba-req', auditDesde: desde, ...o });
const fila = async (id: string) => (await db.query(`SELECT * FROM sol_requisitos WHERE id = $1`, [id])).rows[0];
const est = async (...ids: string[]) => Object.fromEntries(await Promise.all(ids.map(async (i) => [i, (await fila(i)).estado])));
// Invariantes de honestidad: VERIFIED siempre con evidencia y fecha; la fecha solo mientras está verificado; sin iniciar, sin evidencia
async function invariantes() {
  const rows = (await db.query(`SELECT id, estado, evidencia, verificado_en FROM sol_requisitos WHERE id = ANY($1)`, [IDS])).rows;
  assert.equal(rows.length, TOTAL_REQUISITOS);
  for (const x of rows) {
    assert.ok((ESTADOS as readonly string[]).includes(x.estado), x.id);
    if (x.estado === 'VERIFIED') assert.ok(x.evidencia && x.evidencia.length > 10 && x.verificado_en, `${x.id} VERIFIED sin evidencia`);
    else assert.equal(x.verificado_en, null, `${x.id} con verificado_en sin estar VERIFIED`);
    if (x.estado === 'NOT_STARTED') assert.equal(x.evidencia, null, `${x.id} NOT_STARTED con evidencia`);
  }
}
const unidad = (c: string, set: Record<string, unknown>) =>
  db.query(`UPDATE sol_unidades SET ${Object.keys(set).map((k, i) => `${k} = $${i + 2}`).join(', ')} WHERE codigo = $1`, [c, ...Object.values(set)]);
const comp = (keys: string[]) => Object.fromEntries(keys.map((k) => [k, `contenido de prueba de ${k} `.repeat(3)]));
// Expediente con sus archivos en disco, como los escribe deliverProject (carpeta/v1/NN-componente.md)
async function proyecto(req: string, tipo: string, c: Record<string, string>, estado = 'completed') {
  const carpeta = path.join(raiz, 'vault', `P-${req}-${crypto.randomUUID().slice(0, 8)}`);
  fs.mkdirSync(path.join(carpeta, 'v1'), { recursive: true });
  Object.keys(c).forEach((k, n) => fs.writeFileSync(path.join(carpeta, 'v1', `${String(n + 1).padStart(2, '0')}-${k}.md`), `# ${k}\n\n${c[k]}\n`));
  return (await db.query(`INSERT INTO sol_proyectos (titulo, tipo, estado, version, carpeta, componentes, requisito) VALUES ($1,$2,$3,1,$4,$5,$6) RETURNING id, carpeta`,
    [`${M} ${req}`, tipo, estado, carpeta, JSON.stringify(c), req])).rows[0];
}
async function examen(u: string, e: { estado?: string; aprobado?: boolean; nota?: number; calificado_por?: string; respondido_por?: string } = {}) {
  return (await db.query(`INSERT INTO sol_examenes (unidad, estado, preguntas, rubrica, nota, aprobado, creado_por, respondido_por, calificado_por, calificado_en)
      VALUES ($1, $2::text, $3, '[]', $4, $5, 'agente:saturno', $6, $7, CASE WHEN $2::text = 'calificado' THEN now() END) RETURNING id`,
    [u, e.estado ?? 'calificado', JSON.stringify([{ n: 1, pregunta: '¿Qué distingue la abducción de la inducción?', marca: 'req-test' }]), e.nota ?? 0.8, e.aprobado ?? true, e.respondido_por ?? 'agente:sol', e.calificado_por ?? 'agente:saturno'])).rows[0].id;
}
const tarea = async (status: string, creado = 'prueba-req', attempts = 1) => (await db.query(`INSERT INTO tasks (business_id, owner_function, type, title, objective, expected_result, verification, status, created_by, attempts)
    VALUES ($1,'sol','agente',$2,'x','x','x',$3,$4,$5) RETURNING id`, [biz, `${M} tarea`, status, creado, attempts])).rows[0].id;
const sha = (s: string) => crypto.createHash('sha256').update(s).digest('hex');
const espera = (ms = 5) => new Promise((r) => setTimeout(r, ms));
const escribir = (rel: string, s: string) => { fs.mkdirSync(path.dirname(path.join(raiz, rel)), { recursive: true }); fs.writeFileSync(path.join(raiz, rel), s); };

before(async () => {
  db = createPool(); await migrate(db, () => {});
  foto.sol_modulos = await snap('sol_modulos', 'n'); foto.sol_unidades = await snap('sol_unidades', 'codigo'); foto.sol_requisitos = await snap('sol_requisitos', 'id');
  parada = (await db.query(`SELECT value FROM system_state WHERE key = 'emergency_stop'`)).rows[0]?.value ?? false;
  raiz = fs.mkdtempSync(path.join(os.tmpdir(), 'kratos-req-raiz-')); vacia = fs.mkdtempSync(path.join(os.tmpdir(), 'kratos-req-vacia-'));
  biz = (await db.query(`SELECT id FROM businesses ORDER BY id LIMIT 1`)).rows[0].id;
  await limpiar(); await seedSolDef(db); await limpiar();
});
after(async () => {
  await limpiar();
  await db.query(`UPDATE system_state SET value = $1 WHERE key = 'emergency_stop'`, [JSON.stringify(parada)]);
  await restore('sol_unidades', 'codigo', foto.sol_unidades); await restore('sol_requisitos', 'id', foto.sol_requisitos); await restore('sol_modulos', 'n', foto.sol_modulos);
  fs.rmSync(raiz, { recursive: true, force: true }); fs.rmSync(vacia, { recursive: true, force: true });
  await db.end();
});

test('siembra: los 147 identificadores de la directiva; en limpio nada queda verificado sin evidencia', async () => {
  // La directiva dice «139», pero su enumeración (S, H, V, R, B, G, D, E, A) suma 147: se rastrean todos
  assert.equal(TOTAL_REQUISITOS, 147);
  assert.equal((await db.query(`SELECT count(*)::int AS n FROM sol_requisitos WHERE id = ANY($1)`, [IDS])).rows[0].n, 147);
  const r = await refreshRequisitos(db, { raiz: vacia, actor: 'prueba-req', auditDesde: desde });
  assert.equal(r.total, 147); assert.equal(Object.values(r.por_estado).reduce((a, b) => a + b, 0), 147);
  await invariantes();
  // Solo lo que la propia definición sembrada demuestra: las 56 materias y los 12 puentes enlazados existen como registros
  assert.deepEqual((await db.query(`SELECT id FROM sol_requisitos WHERE estado = 'VERIFIED' ORDER BY id`)).rows.map((x) => x.id), ['A01', 'A09']);
  assert.match((await fila('A01')).evidencia, /56\/56 materias distintas/);
  for (const id of ['S01', 'S12', 'H01', 'V01', 'R01', 'B01', 'G01', 'D01', 'D12', 'E01', 'A03', 'A04', 'A19']) assert.equal((await fila(id)).estado, 'NOT_STARTED', id);
  assert.equal((await fila('A27')).estado, 'IMPLEMENTED_UNVERIFIED');   // el rastreo existe, la campaña aún no tiene evidencia
  assert.match((await fila('S02')).siguiente, /turno 1 de 56/);
});

test('materias S/H/V: planificador, expediente y examen independiente; baja si desaparece la evidencia y conserva la primera fecha', async () => {
  await limpiar();
  for (const n of [1, 2, 3, 4]) await db.query(`UPDATE sol_modulos SET estado = 'completado' WHERE n = $1`, [n]);
  const t1 = await tarea('en_ejecucion');
  await unidad('S02', { estado: 'en_curso', tarea_id: t1, intentos: 1, lanzado_en: new Date() });
  await unidad('S03', { estado: 'fallida', intentos: 2 });
  await unidad('S04', { estado: 'estudiada' });            // sin expediente
  await unidad('S05', { estado: 'evaluada' });             // dice evaluada, pero no hay examen
  await unidad('S12', { estado: 'estudiada' });            // módulos previos 1, 3 y 4 completados
  await unidad('H01', { estado: 'pendiente', intentos: 1 });
  const p = await proyecto('S01', 'materia', comp(['temario', 'objetivos', 'fuentes']));
  await unidad('S01', { estado: 'estudiada', proyecto_id: p.id });
  const auto = await examen('S01', { calificado_por: 'agente:sol' });   // autocalificado: no vale
  await refrescar(); await invariantes();
  assert.deepEqual(await est('S01', 'S02', 'S03', 'S04', 'S05', 'S12', 'H01', 'S06'),
    { S01: 'IMPLEMENTED_UNVERIFIED', S02: 'IN_PROGRESS', S03: 'FAILED', S04: 'PARTIAL', S05: 'PARTIAL', S12: 'IMPLEMENTED_UNVERIFIED', H01: 'IN_PROGRESS', S06: 'NOT_STARTED' });
  assert.match((await fila('S01')).evidencia, new RegExp(`expediente P${p.id} v1 .*examen #${auto} calificado sin examinador independiente \\(no cuenta\\)`));
  assert.match((await fila('S12')).evidencia, /módulos previos 1, 3, 4 completados/);
  assert.match((await fila('S02')).evidencia, new RegExp(`tarea #${t1}`));
  // examen aprobado por Saturno → VERIFIED con examen, nota y expediente; queda auditado
  const ex = await examen('S01', { nota: 0.85 });
  await unidad('S01', { estado: 'evaluada' });
  const a1 = new Date('2026-11-05T10:00:00Z');
  const r1 = await refrescar({ ahora: a1 }); await invariantes();
  assert.ok(r1.cambios.some((c) => c.id === 'S01' && c.de === 'IMPLEMENTED_UNVERIFIED' && c.a === 'VERIFIED'));
  let s01 = await fila('S01');
  assert.equal(s01.estado, 'VERIFIED'); assert.equal(s01.pendiente, null); assert.equal(s01.verificado_en.toISOString(), a1.toISOString());
  assert.match(s01.evidencia, new RegExp(`^examen #${ex} aprobado \\(nota 0\\.85, calificado por agente:saturno el \\d{4}-\\d{2}-\\d{2}\\) · expediente P${p.id}`));
  const au = (await db.query(`SELECT actor, details FROM audit_log WHERE action = 'sol.requisito_cambio' AND details->>'id' = 'S01' ORDER BY id DESC LIMIT 1`)).rows[0];
  assert.deepEqual([au.actor, au.details.de, au.details.a], ['prueba-req', 'IMPLEMENTED_UNVERIFIED', 'VERIFIED']);
  // un refresco posterior conserva la primera fecha de verificación
  await refrescar({ ahora: new Date('2026-11-06T10:00:00Z') });
  assert.equal((await fila('S01')).verificado_en.toISOString(), a1.toISOString());
  // si desaparecen los archivos del expediente, baja (y pierde la fecha)
  fs.rmSync(path.join(p.carpeta, 'v1'), { recursive: true });
  await refrescar(); await invariantes();
  s01 = await fila('S01'); assert.equal(s01.estado, 'PARTIAL'); assert.equal(s01.verificado_en, null);
  // vuelven los archivos pero se retira el examen aprobado → implementado sin verificar
  fs.mkdirSync(path.join(p.carpeta, 'v1')); for (const k of ['temario', 'objetivos', 'fuentes']) fs.writeFileSync(path.join(p.carpeta, 'v1', `${k}.md`), `# ${k}\n\ncontenido`);
  await db.query(`DELETE FROM sol_examenes WHERE id = $1`, [ex]);
  await refrescar(); await invariantes();
  assert.equal((await fila('S01')).estado, 'IMPLEMENTED_UNVERIFIED');
  // un examen suspendido no verifica y pide volver a estudiar
  const susp = await examen('S01', { aprobado: false, nota: 0.4 });
  await refrescar();
  assert.match((await fila('S01')).evidencia, new RegExp(`examen #${susp} suspendido \\(nota 0\\.40\\)`)); assert.match((await fila('S01')).siguiente, /Volver a estudiar/);
  // al volver a aprobar, la fecha de verificación es la nueva (la anterior se perdió al bajar)
  await examen('S01', { nota: 0.9 });
  const a3 = new Date('2026-11-07T10:00:00Z');
  await refrescar({ ahora: a3 });
  assert.equal((await fila('S01')).verificado_en.toISOString(), a3.toISOString());
  assert.equal((await fila('A03')).estado, 'PARTIAL'); assert.match((await fila('A03')).evidencia, /1\/56 verificados \(S01\)/);
  // un examen anulado (rúbrica filtrada) deja de contar aunque estuviera aprobado
  await db.query(`UPDATE sol_examenes SET estado = 'anulado' WHERE unidad = 'S01' AND aprobado AND estado = 'calificado' AND calificado_por = 'agente:saturno'`);
  await refrescar(); await invariantes();
  assert.equal((await fila('S01')).estado, 'IMPLEMENTED_UNVERIFIED'); assert.match((await fila('S01')).evidencia, /examen\(es\) anulado\(s\) \(no cuentan\)/);
  // un aprobado de un estudio anterior (calificado antes de que la materia se diera otra vez por estudiada) tampoco cuenta
  const viejo = await examen('S01', { nota: 0.95 });
  await unidad('S01', { completado_en: new Date(Date.now() + 3600_000) });
  await refrescar(); await invariantes();
  assert.equal((await fila('S01')).estado, 'IMPLEMENTED_UNVERIFIED'); assert.match((await fila('S01')).evidencia, new RegExp(`examen #${viejo} de un estudio anterior \\(no cuenta\\)`));
  assert.match((await fila('S01')).siguiente, /Saturno crea y califica el examen/);
  // independencia del examen: nadie respondió, nota por debajo del aprobado, Sol con otra grafía o quien respondió no cuentan
  const base = { estado: 'calificado', aprobado: true, nota: '0.85', creado_por: 'agente:saturno', respondido_por: 'agente:sol', calificado_por: 'agente:saturno' };
  assert.equal(examenAprobado(base), true);
  for (const mal of [{ respondido_por: null }, { nota: '0.5' }, { calificado_por: 'Agente:Sol ' }, { calificado_por: 'kratos (IA)' }, { respondido_por: 'agente:saturno' }, { creado_por: ' agente:SOL' }, { estado: 'anulado' }])
    assert.equal(examenAprobado({ ...base, ...mal }), false, JSON.stringify(mal));
});

test('conectores R: prueba en vivo reciente, caducada, sin resultados, bloqueada o fallida', async () => {
  await limpiar();
  escribir('src/core/conectores.ts', 'export const CONECTORES = { R01: 1, R02: 2, R03: 3, R04: 4, R05: 5, R07: 7 };\n');
  const prueba = async (codigo: string, ok: boolean, resultados: number, detalle: string, horas: number) => (await db.query(`INSERT INTO sol_conectores_pruebas (codigo, ok, resultados, ms, detalle, probado_en)
      VALUES ($1,$2,$3,120,$4, now() - make_interval(hours => $5)) RETURNING id`, [codigo, ok, resultados, `${M} ${detalle}`, horas])).rows[0].id;
  const p1 = await prueba('R01', true, 12, 'ok', 1);
  await prueba('R02', true, 5, 'ok', 24 * 10);
  await prueba('R03', false, 0, 'HTTP 403: falta la API key', 1);
  await prueba('R04', false, 0, 'respuesta sin el campo esperado', 1);
  await prueba('R07', true, 0, 'sin resultados', 1);
  await prueba('R06', true, 4, 'ok', -48);   // fechada dentro de 2 días: una prueba del futuro no es vigente
  await prueba('R08', false, 0, 'sin resultados para el keyword dado', 1);   // «keyword» no es una clave: fallo, no bloqueo
  await refrescar(); await invariantes();
  assert.deepEqual(await est('R01', 'R02', 'R03', 'R04', 'R05', 'R06', 'R07', 'R08', 'R09'),
    { R01: 'VERIFIED', R02: 'IMPLEMENTED_UNVERIFIED', R03: 'BLOCKED', R04: 'FAILED', R05: 'IMPLEMENTED_UNVERIFIED', R06: 'IMPLEMENTED_UNVERIFIED', R07: 'IMPLEMENTED_UNVERIFIED', R08: 'FAILED', R09: 'NOT_STARTED' });
  assert.match((await fila('R01')).evidencia, new RegExp(`^sol_conectores_pruebas #${p1} ok · 12 resultados · 120 ms · \\d{4}-\\d{2}-\\d{2}$`));
  assert.match((await fila('R06')).evidencia, /fecha de prueba en el futuro \(no cuenta\)/);
  assert.match((await fila('R02')).evidencia, /caducada/); assert.match((await fila('R03')).pendiente, /API key/);
  assert.equal((await fila('A04')).estado, 'PARTIAL'); assert.match((await fila('A04')).evidencia, /^conectores probados en vivo: 1\/16 verificados \(R01\)/);
  // una prueba más reciente que falla le quita la verificación
  await prueba('R01', false, 0, 'tiempo de espera agotado', 0);
  await refrescar(); await invariantes();
  const r01 = await fila('R01'); assert.equal(r01.estado, 'FAILED'); assert.equal(r01.verificado_en, null);
  // sin el archivo de conectores, un conector sin prueba no cuenta como implementado
  fs.rmSync(path.join(raiz, 'src/core/conectores.ts'));
  await refrescar();
  assert.equal((await fila('R05')).estado, 'NOT_STARTED');
});

test('puentes B y generativas G: expediente legible del tipo correcto y, en B, una pregunta ACD enlazada', async () => {
  await limpiar();
  const pb = await proyecto('B01', 'puente', comp(['proposicion_original', 'conclusion']));
  await unidad('B01', { estado: 'estudiada', proyecto_id: pb.id });
  await unidad('B02', { estado: 'en_curso', intentos: 1 });
  await unidad('B03', { estado: 'fallida', intentos: 2 });
  const pi = await proyecto('B04', 'investigacion', comp(['pregunta']));
  await unidad('B04', { estado: 'estudiada', proyecto_id: pi.id });   // tipo de expediente equivocado
  const pg = await proyecto('G01', 'acd', comp(['objetivo', 'metodo']));
  await unidad('G01', { estado: 'estudiada', proyecto_id: pg.id });
  const pg2 = await proyecto('G02', 'acd', comp(['objetivo']), 'blocked');
  await unidad('G02', { estado: 'estudiada', proyecto_id: pg2.id });
  await refrescar(); await invariantes();
  assert.deepEqual(await est('B01', 'B02', 'B03', 'B04', 'B05', 'G01', 'G02', 'G03'),
    { B01: 'PARTIAL', B02: 'IN_PROGRESS', B03: 'FAILED', B04: 'PARTIAL', B05: 'NOT_STARTED', G01: 'VERIFIED', G02: 'PARTIAL', G03: 'NOT_STARTED' });
  assert.match((await fila('B01')).pendiente, /ninguna pregunta ACD enlazada/i);
  const q = (await db.query(`INSERT INTO acd_preguntas (texto, area, origen, unidades, created_by) VALUES ($1,'conciencia','puente',$2,'agente:sol') RETURNING id`, [`${M} ¿hay una interacción mente-materia medible?`, ['B01', 'S12']])).rows[0].id;
  await refrescar(); await invariantes();
  assert.equal((await fila('B01')).estado, 'VERIFIED'); assert.match((await fila('B01')).evidencia, new RegExp(`expediente P${pb.id} puente completed .*#${q}`));
  assert.deepEqual(await est('A09', 'A10', 'A16', 'A17'), { A09: 'VERIFIED', A10: 'PARTIAL', A16: 'VERIFIED', A17: 'PARTIAL' });
  assert.match((await fila('A10')).evidencia, /1\/12 verificados \(B01\)/); assert.match((await fila('A16')).evidencia, /^según G01: expediente P/);
  // si el expediente se borra del disco, el puente deja de estar verificado
  fs.rmSync(pb.carpeta, { recursive: true });
  await refrescar(); await invariantes();
  assert.equal((await fila('B01')).estado, 'PARTIAL');
});

test('capacidades D y campaña C1: un ciclo ACD real lo verifica; sin salidas, sin código o con un estado «confirmado», baja', async () => {
  await limpiar();
  escribir('src/core/acd.ts', "// motor de prueba: el estado más fuerte es 'apoyada_provisional'; nunca un descubrimiento confirmado\nexport const X = 1;\n");
  await refrescar(); await invariantes();
  assert.deepEqual(await est('D01', 'D02', 'D03', 'D12', 'E01', 'E07'), { D01: 'IMPLEMENTED_UNVERIFIED', D02: 'IMPLEMENTED_UNVERIFIED', D03: 'IMPLEMENTED_UNVERIFIED', D12: 'IMPLEMENTED_UNVERIFIED', E01: 'NOT_STARTED', E07: 'NOT_STARTED' });
  // E01: 10 preguntas C1 en tres áreas, cada una cruzando ciencia y tradición
  const areas = ['materia', 'informacion', 'conciencia'], qs: number[] = [], hs: number[] = [];
  for (let i = 0; i < 10; i++) qs.push((await db.query(`INSERT INTO acd_preguntas (texto, area, origen, unidades, fuente_ids, campana, created_by) VALUES ($1,$2,'campana','{S04,H03}','{1}','C1','agente:sol') RETURNING id`,
    [`${M} pregunta abierta ${i}`, areas[i % 3]])).rows[0].id);
  // E02–E04: 20 hipótesis distintas, comparadas con la literatura, priorizadas; 5 seleccionadas con criterios escritos
  // (seleccionada_en y criterios_seleccion son columnas de la 043, como las rellena seleccionar() del motor ACD)
  for (let i = 0; i < 20; i++) hs.push((await db.query(`INSERT INTO acd_hipotesis (pregunta_id, titulo, enunciado, mecanismo, supuestos, arte_previo, fuente_ids, novedad, prioridad, estado, campana, created_by, seleccionada_en, criterios_seleccion)
      VALUES ($1,$2,$3,$4,'supuestos de prueba','Arte previo: comparada con la literatura sobre osciladores acoplados','{1}','variante',$5,$6,'C1','agente:sol', CASE WHEN $7 THEN now() - interval '5 hours' END, CASE WHEN $7 THEN 'mayor prioridad y comprobable con una simulación barata' END) RETURNING id`,
    [qs[i % 10], `${M} hipótesis ${i}`, `Enunciado de la hipótesis ${i}`, `Mecanismo propuesto ${i}`, 0.9 - i * 0.01, i < 5 ? 'seleccionada' : 'propuesta', i < 5])).rows[0].id);
  // una hipótesis «revisada» al evolucionar sin haber sido seleccionada no cuenta como selección
  await db.query(`UPDATE acd_hipotesis SET estado = 'revisada' WHERE id = $1`, [hs[19]]);
  // E05–E06: modelo íntegro (sha256 de su código) con predicción falsable y baseline
  const codigo = 'import json\nprint(json.dumps({"r": 0.7}))\n';
  const mo = (await db.query(`INSERT INTO acd_modelos (hipotesis_id, tipo, descripcion, variables, predicciones, falsacion, baseline, codigo, sha256, created_by)
      VALUES ($1,'simulacion','modelo de prueba','r, N','Predice r > 0.6 con N = 100','Si r < 0.4 la hipótesis queda refutada','modelo nulo con r = 0.5',$2,$3,'agente:sol') RETURNING id`, [hs[0], codigo, sha(codigo)])).rows[0].id;
  // E07–E08, E11: experimento real hace 3 h, con carpeta, salida.json, huellas y la comparación con el baseline que calcula el código
  const carpeta = path.join(raiz, 'experimentos', `E${mo}`), salida = '{"r":0.7}';
  fs.mkdirSync(carpeta, { recursive: true }); fs.writeFileSync(path.join(carpeta, 'salida.json'), salida);
  const comparacion = { margen: 0.05, metricas: [{ metrica: 'r', modelo: 0.7, baseline: 0.5, mejor: 'mayor', ventaja_relativa: 0.2857, resultado: 'mejor' }], veredicto: 'a_favor' };
  const xp = (await db.query(`INSERT INTO acd_experimentos (modelo_id, estado, datos, carpeta, inicio, fin, duracion_ms, exit_code, sha256_codigo, sha256_salida, resultado, comparacion, veredicto, created_by)
      VALUES ($1,'ok','sintetico',$2, now() - interval '3 hours', now() - interval '3 hours' + interval '2 seconds', 2000, 0, $3, $4, $5, $6, 'a_favor', 'acd (motor)') RETURNING id`,
    [mo, carpeta, sha(codigo), sha(salida), salida, JSON.stringify(comparacion)])).rows[0].id;
  // E09: Saturno acepta el experimento y critica dos hipótesis (hace 2 h); Sol se critica a sí misma, también con otra grafía (no cuentan)
  const critica = async (objeto: string, id: number, critico: string, veredicto = 'revisar') => (await db.query(`INSERT INTO acd_criticas (objeto, objeto_id, critico, veredicto, objeciones, created_at)
      VALUES ($1,$2,$3,$4,$5, now() - interval '2 hours') RETURNING id`, [objeto, id, critico, veredicto, `${M} objeciones de prueba`])).rows[0].id;
  await critica('experimento', xp, 'agente:saturno', 'aceptar'); await critica('hipotesis', hs[1], 'agente:saturno'); await critica('hipotesis', hs[2], 'agente:saturno');
  await critica('hipotesis', hs[3], 'agente:sol'); await critica('hipotesis', hs[4], ' Agente:Sol');
  // E10: decisiones hace 1 h, después del experimento o de la crítica. El apoyo provisional de H0 tiene su respaldo real
  // (experimento ok a favor con salida intacta + crítica «aceptar» independiente posterior), como exige decidir() en acd.ts
  await db.query(`UPDATE acd_hipotesis SET estado = 'apoyada_provisional', motivo_estado = 'El experimento supera al baseline y la crítica lo acepta; falta replicar', updated_at = now() - interval '1 hour' WHERE id = $1`, [hs[0]]);
  await db.query(`UPDATE acd_hipotesis SET estado = 'rechazada', motivo_estado = 'La crítica encontró un supuesto incompatible con la conservación de la energía', updated_at = now() - interval '1 hour' WHERE id = $1`, [hs[2]]);
  // formalizada sin pasar por la selección (sin seleccionada_en): no cuenta como seleccionada con criterios (E04)
  await db.query(`UPDATE acd_hipotesis SET estado = 'formalizada' WHERE id = $1`, [hs[5]]);
  // el historial manda sobre updated_at: esta decisión se tomó ANTES de la crítica (hace 3 h), aunque la fila se tocara después
  await db.query(`UPDATE acd_hipotesis SET estado = 'rechazada', motivo_estado = 'Rechazada antes de recibir ninguna crítica', updated_at = now() WHERE id = $1`, [hs[1]]);
  await db.query(`INSERT INTO acd_historial (hipotesis_id, de, a, motivo, actor, created_at) VALUES ($1, 'seleccionada', 'rechazada', 'prueba', 'agente:sol', now() - interval '3 hours')`, [hs[1]]);
  // D04: una hija de H0 tras el experimento; E12 y D05: siguiente pregunta (ahora) y tarea de curiosidad completada
  await db.query(`INSERT INTO acd_hipotesis (pregunta_id, padres, operacion, titulo, enunciado, mecanismo, novedad, prioridad, campana, created_by) VALUES ($1,$2,'modificar',$3,'Enunciado revisado','Mecanismo revisado','sin_revisar',0.5,'C1','agente:sol')`, [qs[0], [hs[0]], `${M} hija de H0`]);
  await db.query(`INSERT INTO acd_preguntas (texto, area, origen, unidades, campana, motivo, created_by) VALUES ($1,'energia','curiosidad','{V01,S09}','C2','La revisión de H0 deja sin explicar la saturación','acd (curiosidad)')`, [`${M} siguiente pregunta`]);
  await tarea('completada', 'acd (curiosidad)');
  // D09 y D10: KRATOS consulta, el planificador lanza, una tarea se reintenta y el proceso se reinicia
  await audit(db, 'kratos (IA)', 'herramienta.requisitos_sol', { input: { accion: 'resumen' }, prueba: M });
  await audit(db, 'acd', 'acd.tarea_lanzada', { tarea: 0, prueba: M });
  await audit(db, 'worker-prueba', 'tarea.reintento', { id: 0, prueba: M });
  await espera(); await audit(db, 'worker-prueba', 'proceso.iniciado', { prueba: M });
  await refrescar(); await invariantes();
  for (const id of IDS.filter((i) => 'DE'.includes(i[0]))) { const x = await fila(id); assert.equal(x.estado, 'VERIFIED', `${id}: ${x.evidencia} | ${x.pendiente}`); }
  for (const id of ['A11', 'A13', 'A14', 'A19', 'A20', 'A21', 'A22', 'A23', 'A24', 'A25', 'A26', 'A27']) { const x = await fila(id); assert.equal(x.estado, 'VERIFIED', `${id}: ${x.evidencia} | ${x.pendiente}`); }
  assert.match((await fila('D06')).evidencia, /2 descartadas \(mismo autor/);   // Sol y « Agente:Sol» criticándose a sí misma
  assert.match((await fila('D12')).evidencia, /0 hipótesis por encima de apoyada_provisional · 1 apoyada\(s\) provisional\(es\), todas con experimento y crítica/);
  assert.match((await fila('E10')).evidencia, new RegExp(`#${hs[0]} apoyada_provisional tras experimento #${xp}`));
  assert.match((await fila('E10')).evidencia, /· 2 sin experimento ni crítica previa o sin motivo \(no cuentan\)/);   // hs[1] decidida antes de su crítica; hs[19] sin motivo
  const e04 = (await fila('E04')).evidencia;
  assert.match(e04, /^5\/5 hipótesis C1 seleccionadas con criterios explícitos \(5 con criterios escritos/); assert.ok(!e04.includes(`#${hs[5]}`), e04);
  assert.match((await fila('A14')).evidencia, /^3 de las 5 mejor priorizadas/);   // la de « Agente:Sol» no es independiente
  assert.match((await fila('E11')).evidencia, /^1\/1 experimentos C1 ok con carpeta, sha256 y salida\.json intacta/);
  let inf = await informeSol(db, { raiz, auditDesde: desde });
  assert.match(inf, /^Experimentos: Ejecutados 1 \/ Resultados verificados 1\.$/m);
  assert.match(inf, new RegExp(`^Descubrimientos: Ninguno confirmado · con apoyo provisional, sin confirmar: hipótesis #${hs[0]} «\\[req-test\\] hipótesis 0»$`, 'm'));
  // un experimento en ejecución no le quita a E11 la verificación (aún no tiene salidas que conservar)
  const enCurso = (await db.query(`INSERT INTO acd_experimentos (modelo_id, estado, sha256_codigo, created_by) VALUES ($1, 'ejecutando', $2, 'acd (motor)') RETURNING id`, [mo, sha(codigo)])).rows[0].id;
  await refrescar(); await invariantes();
  assert.deepEqual(await est('E07', 'E11', 'D12'), { E07: 'VERIFIED', E11: 'VERIFIED', D12: 'VERIFIED' });
  await db.query(`DELETE FROM acd_experimentos WHERE id = $1`, [enCurso]);
  // un apoyo provisional sin experimento ni crítica que lo respalde es un informe no veraz (D12 FAILED) y el informe lo avisa
  await db.query(`UPDATE acd_hipotesis SET estado = 'apoyada_provisional', motivo_estado = 'Sin experimento: solo parece prometedora' WHERE id = $1`, [hs[3]]);
  await refrescar(); await invariantes();
  assert.equal((await fila('D12')).estado, 'FAILED'); assert.match((await fila('D12')).evidencia, new RegExp(`sin respaldo verificable .*#${hs[3]}`));
  assert.match(await informeSol(db, { raiz, auditDesde: desde }), new RegExp(`hipótesis #${hs[3]} «\\[req-test\\] hipótesis 3» \\(sin respaldo verificable\\)`));
  await db.query(`UPDATE acd_hipotesis SET estado = 'propuesta', motivo_estado = NULL WHERE id = $1`, [hs[3]]);
  // una salida alterada (no coincide con su sha256) deja de contar, y el apoyo provisional que se basaba en ella pierde su respaldo
  fs.writeFileSync(path.join(carpeta, 'salida.json'), '{"r":0.99}');
  await refrescar(); await invariantes();
  assert.deepEqual(await est('D03', 'E07', 'E11', 'D12'), { D03: 'PARTIAL', E07: 'IN_PROGRESS', E11: 'IN_PROGRESS', D12: 'FAILED' });
  fs.writeFileSync(path.join(carpeta, 'salida.json'), salida);
  await refrescar();
  assert.deepEqual(await est('D03', 'D12'), { D03: 'VERIFIED', D12: 'VERIFIED' });
  // sin las salidas en disco, el experimento deja de contar
  fs.rmSync(carpeta, { recursive: true });
  await refrescar(); await invariantes();
  assert.deepEqual(await est('D03', 'D07', 'E07', 'E08', 'E11', 'A22'), { D03: 'PARTIAL', D07: 'PARTIAL', E07: 'IN_PROGRESS', E08: 'IN_PROGRESS', E11: 'IN_PROGRESS', A22: 'PARTIAL' });
  inf = await informeSol(db, { raiz, auditDesde: desde });
  assert.match(inf, /^Experimentos: Ejecutados 1 \/ Resultados verificados 0\.$/m);
  // sin el código del motor, los datos solos no son software que funciona
  await refreshRequisitos(db, { raiz: vacia, actor: 'prueba-req', auditDesde: desde }); await invariantes();
  assert.deepEqual(await est('D01', 'D02', 'D12', 'A19'), { D01: 'PARTIAL', D02: 'PARTIAL', D12: 'NOT_STARTED', A19: 'PARTIAL' });
  assert.match((await fila('D01')).evidencia, /falta el código src\/core\/acd\.ts/);
  // un estado «confirmado» en el motor es un fallo de informe veraz
  escribir('src/core/acd.ts', "export const ESTADO_FINAL = 'confirmada';\n");
  await refrescar(); await invariantes();
  assert.equal((await fila('D12')).estado, 'FAILED');
});

test('aceptación: módulos conservados, procedencia y lectura, interfaz unificada, grafo, reinicio y recuperación por KRATOS', async () => {
  await limpiar();
  // A02: los módulos 1–4 siguen completados, se reutilizan y los absorbidos no se estudian dos veces
  for (const n of [1, 2, 3, 4]) await db.query(`UPDATE sol_modulos SET estado = 'completado' WHERE n = $1`, [n]);
  await seedSolDef(db); await refrescar(); await invariantes();
  assert.equal((await fila('A02')).estado, 'VERIFIED'); assert.match((await fila('A02')).evidencia, /reutilizados en S12←1,3,4; S13←2 · 19 fusionados, 0 duplicados/);
  await db.query(`UPDATE sol_modulos SET estado = 'pendiente', fusionado_en = NULL WHERE n = 7`);
  await refrescar();
  assert.equal((await fila('A02')).estado, 'PARTIAL'); assert.match((await fila('A02')).pendiente, /se estudiarían dos veces/);
  await db.query(`UPDATE sol_modulos SET estado = 'fusionado', fusionado_en = 'H22' WHERE n = 7`);
  await audit(db, 'curriculo', 'omega.modulo_completado', { modulo: 2, proyecto: null, prueba: M });
  await db.query(`UPDATE sol_modulos SET estado = 'pendiente' WHERE n = 2`);
  await refrescar();
  assert.equal((await fila('A02')).estado, 'FAILED');   // constaba completado en la auditoría y se perdió
  await db.query(`UPDATE sol_modulos SET estado = 'completado' WHERE n = 2`);
  // A05: 20 fuentes de conectores con procedencia completa y 3 lecturas reales de texto completo (avance contiguo registrado)
  const fuente = async (i: string, x: { conector?: string | null; longitud?: number | null; leido?: number; acceso?: string; permisos?: string | null } = {}) => (await db.query(`INSERT INTO sol_fuentes
      (tipo, titulo, url, dominio, acceso, verificada, created_by, doi, identificador, conector, estado_publicacion, fecha_publicacion, texto_disponible, permisos, longitud, leido_hasta)
      VALUES ('articulo',$1,$2,'example.org',$3,true,'prueba-req',$4,$5,$6,'publicado','2020',true,$9,$7,$8) RETURNING id`,
    [`${M} fuente ${i}`, `https://example.org/req-test/${i}`, x.acceso ?? 'metadatos', `10.0000/req-test-${i}`, `id-${i}`, x.conector === undefined ? 'R01' : x.conector, x.longitud ?? null, x.leido ?? 0,
      x.permisos === undefined ? 'CC-BY' : x.permisos])).rows[0].id;
  for (let i = 0; i < 19; i++) await fuente(`c${i}`);
  await fuente('sin-permisos', { permisos: null });   // sin permisos de acceso registrados: procedencia incompleta
  const l0 = await fuente('l0', { conector: null, longitud: 1000, leido: 1000, acceso: 'texto_completo' });
  await fuente('l1', { conector: null, longitud: 1000, leido: 420 });   // lectura parcial real: cuenta como grado de lectura registrado
  const mal = await fuente('mal', { conector: null, longitud: 100, leido: 500 });   // más leído que la longitud: inexacto, no cuenta
  const declarada = await fuente('declarada', { conector: null, acceso: 'texto_completo' });   // dice texto completo sin lectura registrada: no cuenta
  await refrescar();
  let a05 = await fila('A05');
  assert.equal(a05.estado, 'PARTIAL');
  assert.match(a05.evidencia, new RegExp(`19/20 de conectores con procedencia completa \\(R01\\) · 2 con lectura real registrada \\(#${l0} 100%, #\\d+ 42%\\), 1 leídas enteras · 1 declaradas texto_completo sin lectura registrada \\(no cuentan\\) · 1 con leido_hasta mayor que su longitud \\(no cuentan\\)`));
  assert.match(a05.pendiente, /Faltan 1 fuentes de conectores con procedencia completa y 1 lecturas/);
  await fuente('c19'); await fuente('l2', { conector: null, longitud: 5000, leido: 50 });
  await refrescar(); await invariantes();
  // con las cifras alcanzadas, los dos registros inexactos siguen impidiendo decir que la lectura se registra «con exactitud»
  a05 = await fila('A05'); assert.equal(a05.estado, 'PARTIAL'); assert.match(a05.pendiente, /^Corregir 2 registro\(s\) de lectura inexactos/);
  await db.query(`UPDATE sol_fuentes SET leido_hasta = 100 WHERE id = $1`, [mal]);
  await db.query(`UPDATE sol_fuentes SET acceso = 'metadatos' WHERE id = $1`, [declarada]);
  await refrescar(); await invariantes();
  assert.equal((await fila('A05')).estado, 'VERIFIED');
  // A06: el texto de la consulta nunca cuenta como conector; una familia pedida no dice qué respondió; los que fallaron no cuentan;
  // en el registro del código solo se atribuye lo recuperado cuando se consultó un único conector con resultados
  assert.deepEqual(conectoresUsados({ input: { fuente: 'arxiv', consulta: 'hermetic philosophy and sacred texts' } }), ['R02']);
  assert.deepEqual(conectoresUsados({ input: { fuente: 'esoterismo', consulta: 'Corpus Hermeticum' } }), []);
  assert.deepEqual(conectoresUsados({ input: { conectores: ['R05', 'sacred-texts'] } }).sort(), ['R05', 'R12']);
  assert.deepEqual(conectoresUsados({ consulta: 'Corpus Hermeticum', fuentes: ['R01', 'R11', 'R12'], resultados: 9, errores: ['R12'] }), []);
  assert.deepEqual(conectoresUsados({ consulta: 'Corpus Hermeticum', fuentes: ['R11'], resultados: 4, errores: [] }), ['R11']);
  assert.deepEqual(conectoresUsados({ consulta: 'Corpus Hermeticum', fuentes: ['R11'], resultados: 0, errores: [] }), []);
  assert.deepEqual(conectoresUsados({ consulta: 'Corpus Hermeticum', fuentes: ['R12'], resultados: 3, errores: ['R12'] }), []);
  // la ciencia ya está cubierta por las fuentes de R01 registradas arriba; el registro del código aporta el lado esotérico
  await audit(db, 'agente:sol', 'herramienta.investigar_fuentes', { input: { accion: 'buscar', fuente: 'esoterismo', consulta: 'Corpus Hermeticum' } });
  await audit(db, 'agente:sol', 'sol.investigar', { consulta: 'Corpus Hermeticum', fuentes: ['R10', 'R11', 'R12'], resultados: 9, errores: [], prueba: M });   // familia: no atribuible
  escribir('src/core/conectores.ts', 'export const CONECTORES = {};\n');
  await refrescar();
  assert.equal((await fila('A06')).estado, 'PARTIAL'); assert.match((await fila('A06')).evidencia, /pedido ciencia no, esoterismo sí.* esoterismo ninguno/);
  await audit(db, 'agente:sol', 'sol.investigar', { consulta: 'Corpus Hermeticum', fuentes: ['R11'], resultados: 4, errores: [], prueba: M });
  await refrescar();
  assert.equal((await fila('A06')).estado, 'VERIFIED'); assert.match((await fila('A06')).evidencia, /recuperado de ciencia R01 · esoterismo R11( |$)/);
  await refreshRequisitos(db, { raiz: vacia, actor: 'prueba-req', auditDesde: desde });
  assert.equal((await fila('A06')).estado, 'PARTIAL');   // sin el código de la interfaz no se verifica
  // A07: el grafo distingue la naturaleza de cada conexión y enlaza materias
  for (let i = 1; i <= 10; i++) await db.query(`INSERT INTO sol_conexiones (desde, hacia, tipo, explicacion, created_by, naturaleza, tema_desde, tema_hacia) VALUES ('a','b','conceptual',$1,'prueba-req','interpretacion',$2,$3)`,
    [`${M} conexión ${i}`, `S${String(i).padStart(2, '0')}`, `H${String(i).padStart(2, '0')}`]);
  // una conexión con un puente no es una conexión entre materias (A07 es de la etapa 1)
  await db.query(`INSERT INTO sol_conexiones (desde, hacia, tipo, explicacion, created_by, naturaleza, tema_desde, tema_hacia) VALUES ('a','b','conceptual',$1,'prueba-req','interpretacion','S11','B01')`, [`${M} conexión con un puente`]);
  await refrescar();
  assert.equal((await fila('A07')).estado, 'VERIFIED'); assert.match((await fila('A07')).evidencia, /· 10 enlazan materias$/);
  await db.query(`INSERT INTO sol_conexiones (desde, hacia, tipo, explicacion, created_by) VALUES ('a','b','hipotetica',$1,'prueba-req')`, [`${M} conexión sin naturaleza`]);
  await refrescar();
  assert.equal((await fila('A07')).estado, 'PARTIAL'); assert.match((await fila('A07')).pendiente, /1 conexión\(es\) sin naturaleza/);
  // A12: tradición (H) junto a evidencia (A–E) y un puente con conclusión
  const f0 = await fuente('afirmaciones', { conector: null });
  for (let i = 0; i < 5; i++) await db.query(`INSERT INTO sol_afirmaciones (texto, nivel, fuente_id, created_by) VALUES ($1,'H',$2,'prueba-req')`, [`${M} afirmación de tradición ${i}`, f0]);
  await db.query(`INSERT INTO sol_afirmaciones (texto, nivel, fuente_id, created_by) VALUES ($1,'B',$2,'prueba-req')`, [`${M} afirmación con evidencia moderada`, f0]);
  const pb = await proyecto('B01', 'puente', comp(['proposicion_original', 'conclusion']));
  await unidad('B01', { estado: 'estudiada', proyecto_id: pb.id, lanzado_en: new Date(Date.now() - 3600_000) });
  await refrescar();
  assert.equal((await fila('A12')).estado, 'VERIFIED');
  // A08 y A15: datos de Sol, reinicio y, después, KRATOS los recupera
  // (pausas cortas: las fechas llegan a JavaScript con precisión de milisegundos y el orden debe ser inequívoco)
  await espera(); await audit(db, 'server', 'proceso.iniciado', { prueba: M });
  await espera(); await audit(db, 'kratos (ciclo CEO)', 'herramienta.requisitos_sol', { input: { accion: 'informe' }, prueba: M });
  await refrescar(); await invariantes();
  assert.deepEqual(await est('A08', 'A15'), { A08: 'VERIFIED', A15: 'VERIFIED' });
  assert.match((await fila('A08')).evidencia, /reinicio .* recuperados después por KRATOS/);
});

test('informe: formato exacto de la directiva, en español; la parada de emergencia se respeta', async () => {
  await limpiar();
  for (const n of [1, 2, 3, 4]) await db.query(`UPDATE sol_modulos SET estado = 'completado' WHERE n = $1`, [n]);
  await db.query(`UPDATE sol_modulos SET estado = 'pendiente' WHERE estado = 'en_curso'`);
  // el contador de lanzamientos decide si toca un módulo antiguo (cada 5.º): se fija para que la siguiente sea una materia
  const lanz = (await db.query(`SELECT value FROM system_state WHERE key = 'sol_estudio_lanzamientos'`)).rows[0]?.value ?? 0;
  await db.query(`INSERT INTO system_state (key, value) VALUES ('sol_estudio_lanzamientos', '0') ON CONFLICT (key) DO UPDATE SET value = '0'`);
  try {
  await refrescar();
  const lineas = (await informeSol(db, { raiz, auditDesde: desde })).split('\n');
  assert.equal(lineas[0], 'SOL — INFORME DE AVANCE');
  assert.equal(lineas[1], 'Etapa: 1 — Conocimiento universal e infraestructura de investigación');
  assert.match(lineas[2], /^Verificados: \d+\/147$/);
  assert.match(lineas[3], /^En progreso: \d+$/);
  assert.match(lineas[4], /^Bloqueados: \d+$/);
  assert.equal(lineas[5], 'Trabajo realizado:');
  let i = 6; const hechos: string[] = [], pend: string[] = [];
  while (/^\d+\. /.test(lineas[i])) hechos.push(lineas[i++]);
  assert.ok(hechos.length >= 1 && hechos.length <= 5, String(hechos.length));
  hechos.forEach((l, n) => assert.match(l, new RegExp(`^${n + 1}\\. \\[[SHVRBGDEA]\\d{2}\\] [^—]+ — .+\\.$`), l));
  assert.equal(new Set(hechos.map((l) => l.match(/\[(\w+)\]/)![1])).size, hechos.length);   // un cambio por requisito
  assert.equal(lineas[i++], 'Pendiente inmediato:');
  while (/^\d+\. /.test(lineas[i])) pend.push(lineas[i++]);
  assert.ok(pend.length >= 1 && pend.length <= 3, String(pend.length));
  pend.forEach((l, n) => assert.match(l, new RegExp(`^${n + 1}\\. \\[[SHVRBGDE]\\d{2}\\] .+\\.$`), l));
  assert.match(lineas[i++], /^Experimentos: Ejecutados 0 \/ Resultados verificados 0\.$/);
  assert.equal(lineas[i++], 'Descubrimientos: Ninguno confirmado');
  assert.equal(lineas[i++], 'Siguiente acción autónoma: Sol empieza la materia S02 (Lógica y epistemología).');
  assert.equal(lineas.length, i);
  // con una materia en curso y el motor ACD presente, la siguiente acción lo dice en una sola oración
  const t1 = await tarea('en_ejecucion');
  await unidad('S02', { estado: 'en_curso', tarea_id: t1, intentos: 1 });
  escribir('src/core/acd.ts', 'export const X = 1;\n');
  await refrescar();
  assert.match(await informeSol(db, { raiz, auditDesde: desde }), new RegExp(`^Siguiente acción autónoma: Sol termina la materia S02 \\(Lógica y epistemología\\) \\(tarea #${t1}\\); en paralelo, el motor ACD avanza la campaña C1 en E01 \\(identificar 10 preguntas sin resolver .+\\)\\.$`, 'm'));
  await db.query(`UPDATE system_state SET value = 'true' WHERE key = 'emergency_stop'`);
  try { assert.match(await informeSol(db, { raiz, auditDesde: desde }), /^Siguiente acción autónoma: Ninguna mientras KRATOS esté detenido \(parada de emergencia activa\); al reanudar: Sol termina/m); }
  finally { await db.query(`UPDATE system_state SET value = $1 WHERE key = 'emergency_stop'`, [JSON.stringify(parada)]); }
  // una materia estudiada sin examen: el planificador de exámenes trabaja en paralelo y va primero en la oración
  await unidad('S12', { estado: 'estudiada' });
  await refrescar();
  assert.match(await informeSol(db, { raiz, auditDesde: desde }), /^Siguiente acción autónoma: Saturno crea el examen de dominio de S12 \(Neurociencia\) a partir de los módulos ya completados; en paralelo, Sol termina la materia S02 .+ y el motor ACD avanza la campaña C1 en E01 .+\.$/m);
  const ex = await examen('S12', { estado: 'creado', aprobado: false });
  assert.match(await informeSol(db, { raiz, auditDesde: desde }), new RegExp(`^Siguiente acción autónoma: Sol responde el examen #${ex} de S12 \\(Neurociencia\\);`, 'm'));
  // con la campaña sin el motor y sin cupo de estudio, la frase lo dice
  fs.rmSync(path.join(raiz, 'src/core/acd.ts'));
  await db.query(`UPDATE sol_examenes SET estado = 'anulado' WHERE id = $1`, [ex]);
  await unidad('S02', { estado: 'pendiente', tarea_id: null });
  const cupo = (await db.query(`SELECT value FROM system_state WHERE key = 'omega_modulos_dia'`)).rows[0]?.value ?? 4;
  await db.query(`INSERT INTO system_state (key, value) VALUES ('omega_modulos_dia', '0') ON CONFLICT (key) DO UPDATE SET value = '0'`);
  try { assert.match(await informeSol(db, { raiz, auditDesde: desde }), /^Siguiente acción autónoma: Saturno crea el examen de dominio de S12 \(Neurociencia\) a partir de los módulos ya completados; en paralelo, Sol empieza la materia S02 \(Lógica y epistemología\) \(estudio en pausa: omega_modulos_dia = 0\)\.$/m); }
  finally { await db.query(`UPDATE system_state SET value = $1 WHERE key = 'omega_modulos_dia'`, [JSON.stringify(cupo)]); }
  } finally { await db.query(`UPDATE system_state SET value = $1 WHERE key = 'sol_estudio_lanzamientos'`, [JSON.stringify(lanz)]); }
});

test('exportación: Markdown y JSON deterministas, completos y en el orden de la directiva', async () => {
  await refrescar();
  const d1 = fs.mkdtempSync(path.join(os.tmpdir(), 'kratos-req-exp-')), d2 = fs.mkdtempSync(path.join(os.tmpdir(), 'kratos-req-exp-'));
  try {
    const a = await exportRequisitos(db, d1), b = await exportRequisitos(db, d2), leer = (p: string) => fs.readFileSync(p, 'utf8');
    assert.equal(leer(a.md), leer(b.md)); assert.equal(leer(a.json), leer(b.json));
    assert.deepEqual((await refrescar()).cambios, []);   // sin evidencia nueva no cambia nada
    await exportRequisitos(db, d1);
    assert.equal(leer(a.md), leer(b.md)); assert.equal(leer(a.json), leer(b.json));
    const j = JSON.parse(leer(a.json));
    assert.equal(j.total, 147); assert.deepEqual(j.requisitos.map((x: any) => x.id), IDS);
    assert.deepEqual([j.etapas['1'].total, j.etapas['2'].total, j.etapas['3'].total], [80, 19, 48]);
    for (const x of j.requisitos) if (x.estado === 'VERIFIED') assert.ok(x.evidencia && x.verificado_en, x.id); else assert.equal(x.verificado_en, null, x.id);
    const md = leer(a.md);
    assert.match(md, /^# SOL — Rastreador de requisitos/); assert.equal((md.match(/^## /gm) ?? []).length, 9);
    for (const id of IDS) assert.equal((md.match(new RegExp(`^\\| ${id} · `, 'gm')) ?? []).length, 1, id);
  } finally { fs.rmSync(d1, { recursive: true, force: true }); fs.rmSync(d2, { recursive: true, force: true }); }
});

test('herramienta requisitos_sol: resumen, detalle, grupo, informe y refrescar; nada se marca a mano', async () => {
  assert.deepEqual((REQUISITOS_TOOL.input_schema.properties.accion as any).enum, ['resumen', 'detalle', 'grupo', 'informe', 'refrescar']);
  assert.match(REQUISITOS_TOOL.description, /147 requisitos/);
  const res: any = await herramientaRequisitos(db, { accion: 'resumen' }, 'kratos (IA)');
  assert.equal(res.total, 147); assert.equal(Object.values(res.por_estado as Record<string, number>).reduce((a, b) => a + b, 0), 147);
  assert.deepEqual([res.etapas[1].total, res.etapas[2].total, res.etapas[3].total], [80, 19, 48]); assert.equal(res.etapa_actual, 1);
  assert.ok(Array.isArray(res.en_progreso) && Array.isArray(res.bloqueados) && Array.isArray(res.fallidos));
  await examen('S01', { estado: 'creado', aprobado: false });
  const det: any = await herramientaRequisitos(db, { accion: 'detalle', id: 's01' }, 'kratos (IA)');
  assert.equal(det.id, 'S01'); assert.equal(det.unidad.codigo, 'S01'); assert.ok(Array.isArray(det.historial));
  assert.ok(det.examenes.length >= 1 && det.examenes.every((e: any) => !('rubrica' in e)));   // la rúbrica nunca sale
  const g: any = await herramientaRequisitos(db, { accion: 'grupo', prefijo: 'R' }, 'kratos (IA)');
  assert.equal(g.requisitos.length, 16); assert.ok(g.requisitos.every((x: any) => x.id.startsWith('R')));
  assert.match(((await herramientaRequisitos(db, { accion: 'grupo', prefijo: 'X' }, 'kratos (IA)')) as any).error, /prefijo/);
  assert.match(((await herramientaRequisitos(db, { accion: 'detalle', id: 'Z99' }, 'kratos (IA)')) as any).error, /No existe/);
  const inf: any = await herramientaRequisitos(db, { accion: 'informe' }, 'kratos (IA)', { raiz, auditDesde: desde });
  assert.match(inf.texto, /^SOL — INFORME DE AVANCE\nEtapa: /);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kratos-req-tool-'));
  try {
    const rf: any = await herramientaRequisitos(db, { accion: 'refrescar' }, 'kratos (IA)', { raiz, dir, auditDesde: desde });
    assert.equal(rf.total, 147); assert.ok(fs.existsSync(path.join(dir, 'SOL-REQUISITOS.md')) && fs.existsSync(path.join(dir, 'sol-requisitos.json')));
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  assert.match(((await herramientaRequisitos(db, { accion: 'marcar_verificado', id: 'S01' }, 'agente:sol')) as any).error, /no válida/);
});
