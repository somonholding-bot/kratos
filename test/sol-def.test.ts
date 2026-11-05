// PROJECT SOL / ACD: la definición canónica (requisitos, unidades, fusión del currículo anterior) y su siembra idempotente.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createPool, type Db } from '../src/db.ts';
import { migrate } from '../src/migrate.ts';
import { FUSION_MODULOS, REQUISITOS, TOTAL_REQUISITOS, UNIDADES, seedSolDef } from '../src/core/sol-def.ts';

// Nunca contra la base de producción
if (!process.env.JARVIS_DB || process.env.JARVIS_DB === 'jarvis') throw new Error('Estas pruebas exigen JARVIS_DB con una base de pruebas (nunca «jarvis»)');

let db: Db;
const IDS = REQUISITOS.map((r) => r.id), CODIGOS = UNIDADES.map((u) => u.codigo);
const foto: Record<string, any[]> = {};
const snap = async (t: string, k: string) => (await db.query(`SELECT to_jsonb(x) AS j FROM ${t} x ORDER BY ${k}`)).rows.map((r) => r.j);
// Deja la tabla exactamente como estaba: borra las filas que no existían y repone las que existían con todos sus campos.
async function restore(t: string, k: string, rows: any[]) {
  await db.query(`DELETE FROM ${t} WHERE NOT (${k} = ANY($1))`, [rows.map((r) => r[k])]);
  for (const r of rows) {
    const cols = Object.keys(r).filter((c) => c !== k);
    await db.query(`INSERT INTO ${t} SELECT * FROM jsonb_populate_record(null::${t}, $1) ON CONFLICT (${k}) DO UPDATE SET ${cols.map((c) => `${c} = EXCLUDED.${c}`).join(', ')}`, [r]);
  }
}
// Módulos 1–36 presentes (los crea si faltan) y todos pendientes salvo los indicados
async function modulos(estados: Record<number, string>) {
  for (let n = 1; n <= 36; n++) await db.query(`INSERT INTO sol_modulos (n, bloque, titulo) VALUES ($1, 'Prueba', $2) ON CONFLICT (n) DO NOTHING`, [n, `Módulo ${n}`]);
  await db.query(`UPDATE sol_modulos SET estado = 'pendiente', fusionado_en = NULL, tarea_id = NULL`);
  for (const [n, e] of Object.entries(estados)) await db.query(`UPDATE sol_modulos SET estado = $2 WHERE n = $1`, [Number(n), e]);
}
const borrarDefinicion = async () => {
  await db.query(`DELETE FROM sol_unidades WHERE codigo = ANY($1)`, [CODIGOS]);
  await db.query(`DELETE FROM sol_requisitos WHERE id = ANY($1)`, [IDS]);
};
const unidad = async (c: string) => (await db.query(`SELECT * FROM sol_unidades WHERE codigo = $1`, [c])).rows[0];
const modulo = async (n: number) => (await db.query(`SELECT estado, fusionado_en FROM sol_modulos WHERE n = $1`, [n])).rows[0];

before(async () => {
  db = createPool(); await migrate(db, () => {});
  foto.sol_modulos = await snap('sol_modulos', 'n'); foto.sol_unidades = await snap('sol_unidades', 'codigo'); foto.sol_requisitos = await snap('sol_requisitos', 'id');
});
after(async () => {
  await restore('sol_unidades', 'codigo', foto.sol_unidades);
  await restore('sol_requisitos', 'id', foto.sol_requisitos);
  await restore('sol_modulos', 'n', foto.sol_modulos);
  await db.end();
});

test('REQUISITOS: todos los identificadores de la directiva, únicos, en orden, con su etapa y grupo', () => {
  const grupos: [string, number, string][] = [['S', 20, 'Materias científicas'], ['H', 24, 'Materias herméticas'], ['V', 12, 'Materia y vibración'], ['R', 16, 'Conectores'],
    ['B', 12, 'Puentes'], ['G', 12, 'Ingeniería generativa'], ['D', 12, 'Capacidades ACD'], ['E', 12, 'Primera campaña'], ['A', 27, 'Aceptación']];
  const esperado = grupos.flatMap(([p, n]) => Array.from({ length: n }, (_, i) => p + String(i + 1).padStart(2, '0')));
  assert.deepEqual(IDS, esperado);
  // La directiva dice «139», pero su enumeración suma 147: se rastrean todos, sin perder ninguno
  assert.equal(new Set(IDS).size, 147); assert.equal(TOTAL_REQUISITOS, 147);
  for (const [p, n, g] of grupos) assert.equal(REQUISITOS.filter((r) => r.grupo === g).length, n, g), assert.ok(REQUISITOS.filter((r) => r.id[0] === p).every((r) => r.grupo === g));
  for (const r of REQUISITOS) {
    const p = r.id[0], n = Number(r.id.slice(1));
    const e = 'SHVR'.includes(p) ? 1 : p === 'B' ? 2 : 'GDE'.includes(p) ? 3 : n <= 8 ? 1 : n <= 15 ? 2 : 3;
    assert.equal(r.etapa, e, r.id);
    assert.ok(r.descripcion.length > 20 && !/\n/.test(r.descripcion) && /[.)]$/.test(r.descripcion), r.id);
  }
  assert.deepEqual(['A08', 'A09', 'A15', 'A16'].map((id) => REQUISITOS.find((r) => r.id === id)!.etapa), [1, 2, 2, 3]);
  // Fidelidad: título + temario completo de la directiva
  const d = (id: string) => REQUISITOS.find((r) => r.id === id)!.descripcion;
  assert.match(d('S12'), /^Neurociencia: neuronas.*sueño lúcido, conciencia\. Reutilizar los módulos ya completados/);
  assert.match(d('H03'), /mentalismo, correspondencia, vibración, polaridad, ritmo, causa y efecto, género/);
  assert.match(d('R15'), /No eludir muros de pago/);
  assert.match(d('B07'), /no suponer que los procesos físicos tienen categorías de género humanas/);
  assert.match(d('G12'), /No afirmar reproducir algoritmos propietarios/);
  assert.match(d('D12'), /nunca afirmar que una simulación prueba una ley física nueva/);
  assert.match(d('A27'), /E01–E12/);
});

test('UNIDADES: 56 materias, 12 puentes y 12 generativas con orden único, enlaces válidos y módulos reutilizados', () => {
  assert.equal(UNIDADES.length, 80);
  const de = (t: string) => UNIDADES.filter((u) => u.tipo === t);
  assert.deepEqual([de('materia').length, de('puente').length, de('generativa').length], [56, 12, 12]);
  for (const t of ['materia', 'puente', 'generativa']) {
    const o = de(t).map((u) => u.orden).sort((a, b) => a - b);
    assert.deepEqual(o, Array.from({ length: o.length }, (_, i) => i + 1), t);
  }
  const area: Record<string, [string, string]> = { S: ['materia', 'ciencia'], H: ['materia', 'esoterismo'], V: ['materia', 'vibracion'], B: ['puente', 'puente'], G: ['generativa', 'generativa'] };
  for (const u of UNIDADES) {
    assert.deepEqual([u.tipo, u.area], area[u.codigo[0]], u.codigo);
    assert.ok(u.alcance.length > 20 && u.titulo.length > 2, u.codigo);
    for (const r of u.relacionadas) assert.ok(CODIGOS.includes(r) && r !== u.codigo, `${u.codigo} → ${r}`);
    if (u.tipo === 'materia') assert.ok(u.relacionadas.length >= 2 && u.relacionadas.length <= 5, u.codigo);
    // el requisito de la unidad es su título + temario
    assert.ok(REQUISITOS.find((r) => r.id === u.codigo)!.descripcion.startsWith(`${u.titulo}: `), u.codigo);
  }
  assert.deepEqual(CODIGOS, IDS.filter((i) => 'SHVBG'.includes(i[0])));
  const orden = 'S02 S01 S03 V01 V02 S04 S16 V05 V06 V07 H01 H03 H04 S09 S15 V10 S18 H10 H24 V12 S12 S13 S14 S05 S06 S07 S08 V03 V04 V08 V09 V11 S10 S11 S17 S19 S20 H02 H05 H06 H07 H08 H09 H11 H12 H13 H14 H15 H16 H17 H18 H19 H20 H21 H22 H23'.split(' ');
  assert.deepEqual([...de('materia')].sort((a, b) => a.orden - b.orden).map((u) => u.codigo), orden);
  const u = (c: string) => UNIDADES.find((x) => x.codigo === c)!;
  const puentes: Record<string, string[]> = { B01: ['H03', 'S18', 'S12', 'V12'], B02: ['H02', 'V11', 'S16'], B03: ['H03', 'V01', 'V02', 'V03', 'S07'], B04: ['H03', 'V07', 'S04'],
    B05: ['H03', 'V05', 'S16', 'S08'], B06: ['H03', 'S02', 'S03'], B07: ['H03', 'S19'], B08: ['H04', 'H06', 'S06', 'S03'], B09: ['H10', 'S18', 'S12'], B10: ['H24', 'S12', 'S15'],
    B11: ['V12', 'S04'], B12: ['S09', 'S12', 'S18'] };
  for (const [c, rel] of Object.entries(puentes)) assert.deepEqual(u(c).relacionadas, rel, c), assert.equal(u(c).orden, Number(c.slice(1)));
  for (const g of de('generativa')) assert.equal(g.relacionadas[0], 'S17'), assert.equal(g.orden, Number(g.codigo.slice(1)));
  for (const [c, rel] of Object.entries({ G07: ['S17', 'S01', 'S15'], G08: ['S17', 'S02'], G09: ['S17', 'S03', 'S15'], G06: ['S17', 'S14', 'S15'], G11: ['S17', 'S02', 'S20'] }))
    for (const r of rel) assert.ok(u(c).relacionadas.includes(r), `${c} → ${r}`);
  assert.deepEqual(u('S12').modulos_previos, [1, 3, 4]); assert.deepEqual(u('S13').modulos_previos, [2]);
  assert.ok(UNIDADES.filter((x) => !['S12', 'S13'].includes(x.codigo)).every((x) => x.modulos_previos.length === 0));
});

test('FUSION_MODULOS: los pendientes absorbidos van a una materia y su alcance no se pierde; 19 y 25–36 no se fusionan', () => {
  assert.deepEqual(Object.keys(FUSION_MODULOS).map(Number), [5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 20, 21, 22, 23, 24]);
  for (const n of [1, 2, 3, 4, 19, 25, 30, 36]) assert.equal(FUSION_MODULOS[n], undefined, String(n));
  const materias = UNIDADES.filter((u) => u.tipo === 'materia').map((u) => u.codigo);
  for (const c of Object.values(FUSION_MODULOS)) assert.ok(materias.includes(c), c);
  const u = (c: string) => UNIDADES.find((x) => x.codigo === c)!;
  assert.match(u('S13').alcance, /Incluye además \(módulos anteriores fusionados\): Emoción, Jung, Freud y psicología profunda\.$/);
  assert.match(u('H22').alcance, /Incluye además \(módulos anteriores fusionados\): Hipnosis, Sugestión\.$/);
  assert.match(u('S12').alcance, /Incluye además \(módulos anteriores fusionados\): Sueño, Neurotecnología\.$/);
  assert.match(u('H19').alcance, /Meditación, Estados alterados de conciencia\.$/);
  for (const c of new Set(Object.values(FUSION_MODULOS))) assert.match(u(c).alcance, /Incluye además \(módulos anteriores fusionados\): [^.]+\.$/, c);
  for (const x of UNIDADES.filter((x) => !Object.values(FUSION_MODULOS).includes(x.codigo))) assert.doesNotMatch(x.alcance, /fusionados/, x.codigo);
});

test('la siembra funciona aunque falten las filas de sol_modulos (bases de prueba)', async () => {
  await db.query(`DELETE FROM sol_modulos`); await borrarDefinicion();
  const r = await seedSolDef(db);
  assert.deepEqual(r, { requisitos: 147, unidades: 80, fusionados: 0 });
  assert.equal((await unidad('S12')).estado, 'pendiente');   // sin módulos previos registrados no hay dominio que examinar
  assert.equal((await db.query(`SELECT count(*)::int AS n FROM sol_unidades WHERE codigo = ANY($1) AND estado <> 'pendiente'`, [CODIGOS])).rows[0].n, 0);
  assert.equal((await db.query(`SELECT count(*)::int AS n FROM sol_requisitos WHERE id = ANY($1) AND estado = 'NOT_STARTED' AND evidencia IS NULL`, [IDS])).rows[0].n, 147);
});

test('una materia empieza «estudiada» solo si TODOS sus módulos previos están completados; la fusión solo toca pendientes', async () => {
  // Falta el módulo 4 → S12 pendiente
  await modulos({ 1: 'completado', 3: 'completado' }); await borrarDefinicion();
  await seedSolDef(db);
  assert.equal((await unidad('S12')).estado, 'pendiente');
  // 1, 3 y 4 completados (y 2 para S13) → estudiadas; el resto, pendiente
  await modulos({ 1: 'completado', 2: 'completado', 3: 'completado', 4: 'completado', 5: 'en_curso', 6: 'completado', 9: 'fallido', 13: 'en_curso' }); await borrarDefinicion();
  const r = await seedSolDef(db);
  assert.equal((await unidad('S12')).estado, 'estudiada'); assert.equal((await unidad('S13')).estado, 'estudiada');
  for (const c of ['S01', 'S02', 'H01', 'V01', 'B01', 'G01']) assert.equal((await unidad(c)).estado, 'pendiente', c);
  // Pendientes absorbidos → fusionado; en curso, completados y fallidos no se tocan; 19 y 25–36 siguen pendientes
  assert.deepEqual(await modulo(7), { estado: 'fusionado', fusionado_en: 'H22' });
  assert.deepEqual(await modulo(14), { estado: 'fusionado', fusionado_en: 'S13' });
  assert.deepEqual(await modulo(12), { estado: 'fusionado', fusionado_en: 'S01' });
  assert.deepEqual(await modulo(5), { estado: 'en_curso', fusionado_en: null });
  assert.deepEqual(await modulo(13), { estado: 'en_curso', fusionado_en: null });
  assert.deepEqual(await modulo(6), { estado: 'completado', fusionado_en: null });
  assert.deepEqual(await modulo(9), { estado: 'fallido', fusionado_en: null });
  for (const n of [1, 2, 3, 4]) assert.deepEqual(await modulo(n), { estado: 'completado', fusionado_en: null });
  for (const n of [19, 25, 31, 36]) assert.deepEqual(await modulo(n), { estado: 'pendiente', fusionado_en: null });
  assert.equal(r.fusionados, 19 - 4);   // 5, 6, 9 y 13 no estaban pendientes
});

test('la siembra es idempotente: una segunda pasada no cambia ninguna fila', async () => {
  await seedSolDef(db);
  const antes = [await snap('sol_requisitos', 'id'), await snap('sol_unidades', 'codigo'), await snap('sol_modulos', 'n')];
  const r1 = await seedSolDef(db), r2 = await seedSolDef(db);
  assert.deepEqual(r1, r2);
  assert.deepEqual([await snap('sol_requisitos', 'id'), await snap('sol_unidades', 'codigo'), await snap('sol_modulos', 'n')], antes);
  assert.equal((await db.query(`SELECT count(*)::int AS n FROM sol_requisitos WHERE id = ANY($1)`, [IDS])).rows[0].n, 147);
  assert.equal((await db.query(`SELECT count(*)::int AS n FROM sol_unidades WHERE codigo = ANY($1)`, [CODIGOS])).rows[0].n, 80);
});

test('la siembra nunca sobrescribe el estado ni la evidencia de un requisito, ni el estado o la tarea de una unidad', async () => {
  await seedSolDef(db);
  await db.query(`UPDATE sol_requisitos SET estado = 'IN_PROGRESS', evidencia = 'prueba: tarea 1', verificado_en = '2026-11-01T10:00:00Z', pendiente = 'algo', siguiente = 'otra cosa',
    descripcion = 'texto viejo', grupo = 'grupo viejo' WHERE id = 'S01'`);
  await db.query(`UPDATE sol_requisitos SET estado = 'VERIFIED', evidencia = 'prueba: examen 7', verificado_en = now() WHERE id = 'A01'`);
  await db.query(`UPDATE sol_unidades SET estado = 'en_curso', tarea_id = 987654, proyecto_id = 4321, intentos = 2, lanzado_en = '2026-11-02T09:00:00Z',
    titulo = 'Título viejo', alcance = 'viejo', orden = 999, relacionadas = '{}', area = 'otra' WHERE codigo = 'S02'`);
  await db.query(`UPDATE sol_unidades SET estado = 'evaluada', completado_en = '2026-11-03T09:00:00Z' WHERE codigo = 'G01'`);
  // S12 pendiente con sus módulos previos completados: no se «asciende» a estudiada (eso solo ocurre al crearla)
  await db.query(`UPDATE sol_unidades SET estado = 'pendiente' WHERE codigo = 'S12'`);
  await seedSolDef(db);
  const s01 = (await db.query(`SELECT * FROM sol_requisitos WHERE id = 'S01'`)).rows[0];
  assert.equal(s01.estado, 'IN_PROGRESS'); assert.equal(s01.evidencia, 'prueba: tarea 1'); assert.equal(s01.verificado_en.toISOString(), '2026-11-01T10:00:00.000Z');
  assert.equal(s01.pendiente, 'algo'); assert.equal(s01.siguiente, 'otra cosa');
  assert.equal(s01.descripcion, REQUISITOS[0].descripcion); assert.equal(s01.grupo, 'Materias científicas');   // la definición sí se repone
  assert.equal((await db.query(`SELECT estado FROM sol_requisitos WHERE id = 'A01'`)).rows[0].estado, 'VERIFIED');
  const s02 = await unidad('S02'), def = UNIDADES.find((u) => u.codigo === 'S02')!;
  assert.deepEqual([s02.estado, s02.tarea_id, s02.proyecto_id, s02.intentos, s02.lanzado_en.toISOString()], ['en_curso', 987654, 4321, 2, '2026-11-02T09:00:00.000Z']);
  assert.deepEqual([s02.titulo, s02.alcance, s02.orden, s02.relacionadas, s02.area], [def.titulo, def.alcance, def.orden, def.relacionadas, def.area]);
  assert.equal((await unidad('G01')).estado, 'evaluada');
  assert.equal((await unidad('S12')).estado, 'pendiente');
});
