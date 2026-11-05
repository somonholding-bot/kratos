// PROJECT SOL / ACD · etapa 1: currículo de las 56 materias, exámenes de dominio (A03) y grafo de investigación (A07).
// Las garantías las aplica el código: orden y cupo del estudio, roles del examen, la rúbrica nunca llega a Sol, solo un examen
// aprobado deja una materia «evaluada» y el grafo nunca mezcla evidencia, interpretación y especulación.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createPool, type Db } from '../src/db.ts';
import { migrate } from '../src/migrate.ts';
import { ROOT } from '../src/config.ts';
import { UNIDADES, seedSolDef } from '../src/core/sol-def.ts';
import { CURRICULO_CHECKS as REEXPORT, advanceCurriculum, advanceExams, estadoCurriculo, parametrosMateria, type Estudio } from '../src/core/curriculo.ts';
import { CURRICULO_CHECKS, EXAMEN_TOOL, herramientaExamen, rubricaFiltrada } from '../src/core/examen.ts';
import { GRAFO_TOOL, grafoInvestigacion, grafoMarkdown, herramientaGrafo } from '../src/core/grafo.ts';
import { COMPONENTES, addConnection, deliverProject } from '../src/core/omega.ts';
import { CHECK_TYPES } from '../src/core/playbookchecks.ts';
import { createPlaybook, missingInputs, playbookBrief, validateShape } from '../src/core/playbooks.ts';

// Nunca contra la base de producción
if (!process.env.JARVIS_DB || process.env.JARVIS_DB === 'jarvis') throw new Error('Estas pruebas exigen JARVIS_DB con una base de pruebas (nunca «jarvis»)');

const YO = 'prueba-materias', SOL = 'agente:sol', SAT = 'agente:saturno';
const CODIGOS = UNIDADES.map((u) => u.codigo);
const CLAVES = ['omega_modulos_dia', 'sol_examenes_dia', 'sol_estudio_lanzamientos', 'agents_engine'];
let db: Db, T0: Date, biz: number;
const PLANIFICADORES = ['curriculo (planificador)', 'examen (planificador)'];
const playbooksCreados: string[] = [];
const foto: Record<string, any[]> = {};
const estado0: Record<string, any> = {};

const snap = async (t: string, k: string) => (await db.query(`SELECT to_jsonb(x) AS j FROM ${t} x ORDER BY ${k}`)).rows.map((r) => r.j);
async function restore(t: string, k: string, rows: any[]) {
  await db.query(`DELETE FROM ${t} WHERE NOT (${k} = ANY($1))`, [rows.map((r) => r[k])]);
  for (const r of rows) {
    const cols = Object.keys(r).filter((c) => c !== k);
    await db.query(`INSERT INTO ${t} SELECT * FROM jsonb_populate_record(null::${t}, $1) ON CONFLICT (${k}) DO UPDATE SET ${cols.map((c) => `${c} = EXCLUDED.${c}`).join(', ')}`, [r]);
  }
}
const setState = (k: string, v: unknown) => db.query(`INSERT INTO system_state (key, value) VALUES ($1, $2::jsonb) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`, [k, JSON.stringify(v)]);
const getVal = async (k: string) => (await db.query(`SELECT value FROM system_state WHERE key = $1`, [k])).rows[0]?.value;
const unidad = async (c: string) => (await db.query(`SELECT * FROM sol_unidades WHERE codigo = $1`, [c])).rows[0];
const modulo = async (n: number) => (await db.query(`SELECT * FROM sol_modulos WHERE n = $1`, [n])).rows[0];
const tarea = async (owner = 'sol', status = 'pendiente') => (await db.query(`INSERT INTO tasks (business_id, owner_function, type, title, objective, expected_result, verification, status, created_by, started_at)
  VALUES ($1, $2, 'agente', 'Prueba materias', 'x', 'x', 'x', $3, $4, now() - interval '1 minute') RETURNING id`, [biz, owner, status, YO])).rows[0].id as number;
const terminar = (id: number, status = 'completada') => db.query(`UPDATE tasks SET status = $2 WHERE id = $1`, [id, status]);
const fila = async (id: number) => (await db.query(`SELECT * FROM tasks WHERE id = $1`, [id])).rows[0];
// Simula el final del estudio en curso sin pasar por el cierre (para probar solo el orden y el cupo)
const simularEstudio = async () => {
  await db.query(`UPDATE sol_unidades SET estado = 'estudiada', completado_en = now(), tarea_id = NULL WHERE estado = 'en_curso'`);
  await db.query(`UPDATE sol_modulos SET estado = 'completado', completado_en = now() WHERE estado = 'en_curso'`);
};
const limpiarExamenes = async () => {
  await db.query(`DELETE FROM sol_examen_tareas WHERE lanzado_en >= $1`, [T0]);
  await db.query(`DELETE FROM sol_examenes WHERE created_at >= $1`, [T0]);
};
// Estado de partida: módulos 1-4 completados (como en producción), el resto pendientes, y las 80 unidades recién sembradas
async function preparar(completos = [1, 2, 3, 4]) {
  await limpiarExamenes();
  await db.query(`DELETE FROM sol_unidades WHERE codigo = ANY($1)`, [CODIGOS]);
  for (let n = 1; n <= 36; n++) await db.query(`INSERT INTO sol_modulos (n, bloque, titulo) VALUES ($1, 'Prueba', $2) ON CONFLICT (n) DO NOTHING`, [n, `Módulo ${n}`]);
  await db.query(`UPDATE sol_modulos SET estado = 'pendiente', fusionado_en = NULL, tarea_id = NULL, proyecto_id = NULL, intentos = 0, lanzado_en = NULL, completado_en = NULL`);
  await db.query(`UPDATE sol_modulos SET estado = 'completado', intentos = 1, completado_en = now() - interval '2 days' WHERE n = ANY($1::int[])`, [completos]);
  await seedSolDef(db);
  await setState('sol_estudio_lanzamientos', 0); await setState('omega_modulos_dia', 50); await setState('sol_examenes_dia', 10);
}
const ex = (i: any, actor: string) => herramientaExamen(db, i, actor) as Promise<any>;
const preguntas = (tag: string, k = 6) => Array.from({ length: k }, (_, i) => ({ n: i + 1, pregunta: `${tag} · pregunta ${i + 1}: explica con tus palabras el concepto ${i + 1} de la materia y por qué importa` }));
const rubrica = (tag: string, k = 6) => Array.from({ length: k }, (_, i) => ({ n: i + 1, criterios: `Criterio reservado ${tag} ${i + 1}: la respuesta debe nombrar el mecanismo concreto número ${i + 1}, separar evidencia de interpretación y no inventar fuentes` }));
const respuestas = (k = 6) => Array.from({ length: k }, (_, i) => ({ n: i + 1, respuesta: `Respuesta ${i + 1}: el mecanismo funciona así, con este ejemplo y esta fuente; separo lo establecido de lo especulativo y digo lo que no sé.` }));
const notas = (vals: number[]) => vals.map((v, i) => ({ n: i + 1, nota: v, comentario: `Comentario ${i + 1}: ${v < 0.5 ? 'falta explicar el mecanismo y confunde evidencia con interpretación' : 'correcta y bien razonada'}` }));
const leer = (f: string) => JSON.parse(fs.readFileSync(path.join(ROOT, 'playbooks', `${f}.json`), 'utf8'));
const componentes = () => Object.fromEntries(COMPONENTES.materia.map((k) => [k, k === 'fuentes' ? [1, 2, 3, 4, 5, 6].map((n) => `https://example.org/fuente-${n}`).join('\n') + '\nprimarias y secundarias' : `contenido de ${k} `.repeat(5)]));

before(async () => {
  db = createPool(); await migrate(db, () => {});
  T0 = (await db.query(`SELECT now() AS t`)).rows[0].t;
  biz = (await db.query(`SELECT id FROM businesses ORDER BY id LIMIT 1`)).rows[0].id;
  foto.sol_modulos = await snap('sol_modulos', 'n'); foto.sol_unidades = await snap('sol_unidades', 'codigo');
  for (const k of CLAVES) estado0[k] = await getVal(k);
});
after(async () => {
  await limpiarExamenes();
  const quien = [SOL, SAT, YO];
  await db.query(`DELETE FROM acd_preguntas WHERE created_at >= $1 AND created_by = ANY($2)`, [T0, quien]);
  await db.query(`DELETE FROM sol_conexiones WHERE created_at >= $1 AND created_by = ANY($2)`, [T0, quien]);
  await db.query(`DELETE FROM sol_afirmaciones WHERE created_at >= $1 AND created_by = ANY($2)`, [T0, quien]);
  await db.query(`DELETE FROM sol_fuentes WHERE created_at >= $1 AND created_by = ANY($2)`, [T0, quien]);
  for (const p of (await db.query(`SELECT carpeta FROM sol_proyectos WHERE created_at >= $1 AND titulo LIKE 'Materia %'`, [T0])).rows) if (p.carpeta) fs.rmSync(p.carpeta, { recursive: true, force: true });
  await db.query(`DELETE FROM sol_proyectos WHERE created_at >= $1 AND titulo LIKE 'Materia %'`, [T0]);
  await db.query(`DELETE FROM tasks WHERE created_by = ANY($1) AND created_at >= $2`, [[YO, ...PLANIFICADORES], T0]);
  if (playbooksCreados.length) {
    await db.query(`DELETE FROM playbook_versions WHERE playbook_id = ANY($1)`, [playbooksCreados]);
    await db.query(`DELETE FROM playbooks WHERE id = ANY($1)`, [playbooksCreados]);
  }
  await restore('sol_unidades', 'codigo', foto.sol_unidades);
  await restore('sol_modulos', 'n', foto.sol_modulos);
  for (const k of CLAVES) if (estado0[k] === undefined) await db.query(`DELETE FROM system_state WHERE key = $1`, [k]); else await setState(k, estado0[k]);
  await db.end();
});

test('playbooks: forma válida con las comprobaciones del currículo registradas; las entradas caben y el brief conserva los 8 pasos', () => {
  assert.equal(REEXPORT, CURRICULO_CHECKS);
  for (const k of ['materia_preguntas_acd', 'materia_conexiones', 'materia_fuentes', 'materia_expediente', 'examen_creado', 'examen_respondido', 'examen_calificado'])
    assert.ok(CURRICULO_CHECKS[k] && Array.isArray(CURRICULO_CHECKS[k].claves) && typeof CURRICULO_CHECKS[k].comprobar === 'function', k);
  assert.deepEqual(EXAMEN_TOOL.input_schema.properties.accion.enum, ['crear', 'ver', 'responder', 'calificar', 'estado']);
  assert.deepEqual(GRAFO_TOOL.input_schema.properties.accion.enum, ['grafo', 'unidad']);
  const nuevas = Object.keys(CURRICULO_CHECKS).filter((k) => !CHECK_TYPES[k]);
  for (const k of nuevas) CHECK_TYPES[k] = CURRICULO_CHECKS[k].claves;   // lo que hará el integrador en playbookchecks.ts
  try {
    for (const f of ['sol/sol-materia', 'sol/sol-examen-responder', 'saturno/sol-examen-crear', 'saturno/sol-examen-calificar']) {
      const pb = leer(f), v = validateShape(pb);
      assert.ok(v.ok, `${f}: ${v.errores.join('; ')}`);
      assert.equal(pb.agentes.responsable, f.split('/')[0]); assert.equal(`${pb.id}`, f.split('/')[1]);
      assert.ok(pb.verificacion.some((c: any) => CURRICULO_CHECKS[c.tipo]), `${f} usa una comprobación del currículo`);
      for (const c of pb.verificacion) if (CURRICULO_CHECKS[c.tipo]) assert.ok(CURRICULO_CHECKS[c.tipo].describir(c).length > 20);
    }
  } finally { for (const k of nuevas) delete CHECK_TYPES[k]; }
  const pb = leer('sol/sol-materia');
  assert.deepEqual(pb.herramientas.filter((h: string) => ['biblioteca_sol', 'investigar_sol', 'proyecto_sol', 'acd'].includes(h)).sort(), ['acd', 'biblioteca_sol', 'investigar_sol', 'proyecto_sol']);
  for (const u of UNIDADES.filter((u) => u.tipo === 'materia')) assert.ok(u.alcance.length <= pb.entradas.alcance.max_caracteres && u.titulo.length <= pb.entradas.titulo.max_caracteres, u.codigo);
  // El brief tiene 3.000 caracteres y recorta los pasos en proporción: los datos que exigen las comprobaciones (unidades del
  // registro ACD, componentes del expediente) no pueden perderse. Un reintento añade el motivo del fallo (hasta ~500 caracteres).
  const reintento = { attempts: 2, last_error: `Verificación fallida: ${'e'.repeat(400)}` };
  const brief = (p: any, params: Record<string, unknown>, extra: Record<string, unknown> = {}) => {
    const m = missingInputs(p, params);
    assert.deepEqual([m.faltan, m.invalidos], [[], []]);
    const b = playbookBrief(p, { inputs: { parametros: m.normalizados }, playbook_version: 1, attempts: 1, ...extra });
    return { b, pasos: b.split('\n').filter((l) => /^ \d+\. /.test(l)) };
  };
  const materia = (c: string, corr: string, extra = {}) => { const u = UNIDADES.find((x) => x.codigo === c)!; return brief(pb, parametrosMateria({ tipo: 'materia', codigo: c, titulo: u.titulo, alcance: u.alcance, correcciones: corr, intento: 1 }), extra); };
  const enteros = (r: { b: string; pasos: string[] }, que: string) => { assert.ok(r.b.length <= 3000 && r.pasos.length >= 4, que); assert.ok(r.pasos.every((l) => !l.endsWith('…')), `${que}: ningún paso se recorta`); };
  for (const u of UNIDADES.filter((x) => x.tipo === 'materia')) enteros(materia(u.codigo, '', reintento), `primer estudio de ${u.codigo}, también en su reintento`);
  enteros(materia('S12', 'x'.repeat(300)), 'reestudio de S12 (la más larga) con las correcciones más largas que genera el código');
  const r12 = materia('S12', 'x'.repeat(300), reintento);   // el peor caso: reestudio + reintento; se recorta lo menos importante (el final)
  assert.equal(r12.pasos.length, 8); assert.match(r12.b, /unidades=\["S12"\]/);
  const crear = leer('saturno/sol-examen-crear'), u12 = UNIDADES.find((x) => x.codigo === 'S12')!;
  for (const extra of [{}, reintento]) enteros(brief(crear, { unidad: 'S12', titulo: u12.titulo, alcance: u12.alcance, expediente: 'módulos anteriores completados que esta materia reutiliza: 1. Neurociencia (P12); 3. Atención (P13); 4. Memoria (P14)' }, extra), 'crear el examen de S12');
});

test('siembra: las 80 unidades existen; S12 y S13 empiezan estudiadas porque reutilizan los módulos 1-4 completados; los absorbidos quedan fusionados', async () => {
  await preparar();
  const c = (await db.query(`SELECT count(*)::int AS n, count(*) FILTER (WHERE tipo = 'materia')::int AS m FROM sol_unidades WHERE codigo = ANY($1)`, [CODIGOS])).rows[0];
  assert.deepEqual([c.n, c.m], [80, 56]);
  assert.deepEqual([(await unidad('S12')).estado, (await unidad('S13')).estado, (await unidad('S02')).estado], ['estudiada', 'estudiada', 'pendiente']);
  assert.deepEqual([(await modulo(5)).estado, (await modulo(5)).fusionado_en], ['fusionado', 'S13']);
  assert.deepEqual([(await modulo(19)).estado, (await modulo(19)).fusionado_en, (await modulo(25)).estado], ['pendiente', null, 'pendiente']);
  assert.equal((await modulo(1)).estado, 'completado');   // los completados se conservan
});

test('estudio: siguiente materia por orden, cada 5.º lanzamiento un módulo antiguo no fusionado, y los fusionados nunca', async () => {
  await preparar();
  const lanzados: string[] = [], vistas: Estudio[] = [];
  const launch = async (_d: Db, e: Estudio) => { lanzados.push(e.tipo === 'modulo' ? `M${e.n}` : e.codigo); vistas.push(e); return { tarea: await tarea() }; };
  for (let i = 0; i < 10; i++) { const r: any = await advanceCurriculum(db, YO, launch); assert.ok(r.lanzado, JSON.stringify(r)); await simularEstudio(); }
  assert.deepEqual(lanzados, ['S02', 'S01', 'S03', 'V01', 'M19', 'V02', 'S04', 'S16', 'V05', 'M25']);
  const fusionados = (await db.query(`SELECT n FROM sol_modulos WHERE estado = 'fusionado' ORDER BY n`)).rows.map((r) => r.n);
  assert.deepEqual(fusionados, [5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 20, 21, 22, 23, 24]);
  assert.ok(!lanzados.some((l) => fusionados.includes(Number(l.slice(1))) && l.startsWith('M')));
  const s02 = vistas[0] as any;
  assert.deepEqual([s02.titulo, s02.correcciones, s02.intento], ['Lógica y epistemología', '', 1]);
  assert.match(s02.alcance, /falsabilidad/);
  assert.equal(Number(await getVal('sol_estudio_lanzamientos')), 10);
  assert.equal(Number(await getVal('omega_modulos_dia')), 50);   // la cuota existente no se toca
});

test('estudio: uno cada vez y un único cupo diario (omega_modulos_dia) compartido por módulos y materias', async () => {
  await preparar();
  await setState('omega_modulos_dia', 3); await setState('sol_estudio_lanzamientos', 3);
  const launch = async () => ({ tarea: await tarea() });
  assert.equal((await advanceCurriculum(db, YO, launch)).lanzado, 'S02');                        // 4.º lanzamiento: materia
  assert.match(String((await advanceCurriculum(db, YO, launch)).motivo), /en curso \(S02\)/);    // uno cada vez
  await simularEstudio();
  assert.equal((await advanceCurriculum(db, YO, launch)).lanzado, 19);                           // 5.º: módulo antiguo
  assert.match(String((await advanceCurriculum(db, YO, launch)).motivo), /en curso \(módulo 19\)/);
  await simularEstudio();
  assert.equal((await advanceCurriculum(db, YO, launch)).lanzado, 'S01');
  await simularEstudio();
  assert.match(String((await advanceCurriculum(db, YO, launch)).motivo), /cupo diario alcanzado \(3\/3\)/);   // 2 materias + 1 módulo
  assert.equal(Number(await getVal('omega_modulos_dia')), 3);
  await setState('omega_modulos_dia', 0);
  assert.match(String((await advanceCurriculum(db, YO, launch)).motivo), /pausa/);
  const e: any = await estadoCurriculo(db);
  assert.deepEqual([e.cupo_estudio.hoy, e.cupo_estudio.tope], [3, 0]);
});

test('estudio: estudiada solo con tarea completada Y expediente de materia; marca requisito; sin expediente reintenta y a los 2 intentos, fallida', async () => {
  await preparar();
  const tareas: number[] = [];
  const launch = async () => { const t = await tarea(); tareas.push(t); return { tarea: t }; };
  assert.equal((await advanceCurriculum(db, YO, launch)).lanzado, 'S02');
  const p: any = await deliverProject(db, { titulo: 'Materia S02: Lógica y epistemología', tipo: 'materia', tarea_id: tareas[0], componentes: componentes() }, SOL);
  assert.equal(p.estado, 'completed');
  await terminar(tareas[0]);
  assert.equal((await advanceCurriculum(db, YO, launch)).lanzado, 'S01');                        // cierra S02 y lanza la siguiente
  const s02 = await unidad('S02');
  assert.deepEqual([s02.estado, s02.proyecto_id, !!s02.completado_en], ['estudiada', p.proyecto_id, true]);
  assert.equal((await db.query(`SELECT requisito FROM sol_proyectos WHERE id = $1`, [p.proyecto_id])).rows[0].requisito, 'S02');
  // S01: la tarea dice «completada» pero no hay expediente → no cuenta; se reintenta
  await terminar(tareas[1]);
  assert.equal((await advanceCurriculum(db, YO, launch)).lanzado, 'S01');
  assert.deepEqual([(await unidad('S01')).estado, (await unidad('S01')).intentos], ['en_curso', 2]);
  await terminar(tareas[2], 'fallida');
  assert.equal((await advanceCurriculum(db, YO, launch)).lanzado, 'S03');
  assert.equal((await unidad('S01')).estado, 'fallida');
  // el currículo anterior sigue cerrándose como siempre
  const m = await tarea(); await db.query(`UPDATE sol_modulos SET estado = 'en_curso', tarea_id = $1, intentos = 1 WHERE n = 19`, [m]);
  await db.query(`UPDATE sol_unidades SET estado = 'pendiente', tarea_id = NULL WHERE codigo = 'S03'`); await terminar(m);
  await advanceCurriculum(db, YO, launch);
  assert.equal((await modulo(19)).estado, 'completado');
});

test('examen: el código impone los roles; Sol nunca ve la rúbrica; quien respondió no califica; la nota la calcula el código', async () => {
  await preparar();
  const P = preguntas('Roles'), R = rubrica('Roles');
  // La auditoría de herramientas guarda la entrada tal cual después de ejecutar: la rúbrica se sustituye en la propia entrada, vaya bien o mal
  const rechazada: any = { accion: 'crear', unidad: 'S12', preguntas: P, rubrica: R };
  assert.match((await ex(rechazada, SOL)).error, /Saturno/);
  assert.match(String(rechazada.rubrica), /rúbrica privada: 6 criterios/); assert.ok(!JSON.stringify(rechazada).includes('Criterio reservado'));
  assert.match((await ex({ accion: 'crear', unidad: 'S12', preguntas: P, rubrica: R }, 'kratos (IA)')).error, /Saturno/);
  assert.match((await ex({ accion: 'crear', unidad: 'S02', preguntas: P, rubrica: R }, SAT)).error, /estudiada/);
  assert.match((await ex({ accion: 'crear', unidad: 'S12', preguntas: P.slice(0, 5), rubrica: R.slice(0, 5) }, SAT)).error, /entre 6 y 10/);
  assert.match((await ex({ accion: 'crear', unidad: 'S12', preguntas: P, rubrica: R.slice(1) }, SAT)).error, /rubrica/);
  const entrada: any = { accion: 'crear', unidad: 'S12', preguntas: P, rubrica: R };
  const c = await ex(entrada, SAT);
  assert.ok(c.examen_id, JSON.stringify(c));
  assert.ok(!JSON.stringify(entrada).includes('Criterio reservado'), 'la entrada que se audita ya no lleva la rúbrica');
  assert.equal(R[0].criterios.startsWith('Criterio reservado'), true);                             // el array del llamante no se toca
  assert.match((await ex({ accion: 'crear', unidad: 'S12', preguntas: preguntas('Otra'), rubrica: rubrica('Otra') }, SAT)).error, /abierto/);
  // Sol: solo las preguntas; KRATOS: preguntas y estado, sin rúbrica; Saturno: todo
  const vs = await ex({ accion: 'ver', unidad: 'S12' }, SOL);
  assert.equal(vs.examenes.length, 1); assert.equal(vs.examenes[0].preguntas.length, 6);
  assert.deepEqual(Object.keys(vs.examenes[0]).sort(), ['examen_id', 'preguntas', 'titulo', 'unidad']);
  for (const actor of [SOL, 'kratos (IA)', 'kratos (ciclo CEO)', 'agente:venus'])
    for (const accion of ['ver', 'estado']) assert.ok(!JSON.stringify(await ex({ accion, unidad: 'S12' }, actor)).includes('Criterio reservado'), `${actor} ${accion}`);
  const vk = await ex({ accion: 'ver', examen_id: c.examen_id }, 'kratos (ciclo CEO)');
  assert.equal(vk.examenes[0].estado, 'creado'); assert.equal(vk.examenes[0].rubrica, undefined);
  assert.ok(JSON.stringify(await ex({ accion: 'ver', examen_id: c.examen_id }, SAT)).includes('Criterio reservado'));
  // responder: solo Sol, todo respondido, ≥ 80 caracteres
  assert.match((await ex({ accion: 'responder', examen_id: c.examen_id, respuestas: respuestas() }, SAT)).error, /Solo Sol/);
  assert.match((await ex({ accion: 'responder', examen_id: c.examen_id, respuestas: respuestas().map((r, i) => i ? r : { ...r, respuesta: 'corta' }) }, SOL)).error, /80/);
  assert.match((await ex({ accion: 'responder', examen_id: c.examen_id, respuestas: respuestas().slice(1) }, SOL)).error, /todas/);
  assert.equal((await ex({ accion: 'responder', unidad: 'S12', respuestas: respuestas() }, SOL)).estado, 'respondido');
  assert.equal((await ex({ accion: 'ver', unidad: 'S12' }, SOL)).examenes.length, 0);       // ya no hay nada por responder
  // calificar: solo Saturno y nunca quien respondió
  assert.match((await ex({ accion: 'calificar', examen_id: c.examen_id, notas: notas([1, 1, 1, 1, 1, 1]) }, SOL)).error, /Saturno/);
  await db.query(`UPDATE sol_examenes SET respondido_por = $2 WHERE id = $1`, [c.examen_id, SAT]);
  assert.match((await ex({ accion: 'calificar', examen_id: c.examen_id, notas: notas([1, 1, 1, 1, 1, 1]) }, SAT)).error, /respondió/);
  await db.query(`UPDATE sol_examenes SET respondido_por = $2 WHERE id = $1`, [c.examen_id, SOL]);
  assert.match((await ex({ accion: 'calificar', examen_id: c.examen_id, notas: notas([1.5, 1, 1, 1, 1, 1]) }, SAT)).error, /entre 0 y 1/);
  for (const raro of [true, null, '', [1]])   // Number(true) = 1 y Number(null) = 0: no son notas
    assert.match((await ex({ accion: 'calificar', examen_id: c.examen_id, notas: notas([1, 1, 1, 1, 1, 1]).map((x, k) => k ? x : { ...x, nota: raro }) }, SAT)).error, /entre 0 y 1/, String(raro));
  assert.match((await ex({ accion: 'calificar', examen_id: c.examen_id, notas: notas([1, 1, 1, 1, 1, 1]).map((x) => ({ ...x, comentario: 'bien' })) }, SAT)).error, /comentario/);
  const g = await ex({ accion: 'calificar', examen_id: c.examen_id, notas: notas([0.9, 0.8, 0.7, 0.9, 0.8, 0.7]) }, SAT);
  assert.deepEqual([g.nota, g.aprobado, g.materia], [0.8, true, 'evaluada']);
  assert.equal((await unidad('S12')).estado, 'evaluada');
  assert.match((await ex({ accion: 'responder', examen_id: c.examen_id, respuestas: respuestas() }, SOL)).error, /calificado/);
  assert.match((await ex({ accion: 'inventada' }, SAT)).error, /no válida/);
});

test('exámenes planificados: S12 estudiada va directa al examen; crear → responder → calificar con su propio cupo; aprobado → evaluada', async () => {
  await preparar();
  await setState('omega_modulos_dia', 0); await setState('sol_examenes_dia', 1);
  const fases: string[] = [];
  const launch = async (_d: Db, t: any) => { fases.push(`${t.fase}:${t.unidad}`); return { tarea: await tarea(t.fase === 'responder' ? 'sol' : 'saturno') }; };
  const r1: any = await advanceExams(db, YO, launch);
  assert.deepEqual([r1.lanzado, r1.unidad], ['crear', 'S12']);
  assert.match(String((await advanceExams(db, YO, launch)).motivo), /en curso/);              // una tarea de examen cada vez
  const c = await ex({ accion: 'crear', unidad: 'S12', preguntas: preguntas('Plan'), rubrica: rubrica('Plan') }, SAT);
  await terminar(r1.tarea);
  const r2: any = await advanceExams(db, YO, launch);
  assert.deepEqual([r2.lanzado, r2.unidad, r2.examen_id], ['responder', 'S12', c.examen_id]);   // continuar no consume cupo
  await ex({ accion: 'responder', examen_id: c.examen_id, respuestas: respuestas() }, SOL); await terminar(r2.tarea);
  const r3: any = await advanceExams(db, YO, launch);
  assert.deepEqual([r3.lanzado, r3.examen_id], ['calificar', c.examen_id]);
  await ex({ accion: 'calificar', examen_id: c.examen_id, notas: notas([0.9, 0.9, 0.8, 0.8, 0.7, 0.9]) }, SAT); await terminar(r3.tarea);
  assert.match(String((await advanceExams(db, YO, launch)).motivo), /cupo diario de exámenes alcanzado \(1\/1\)/);
  assert.equal((await unidad('S12')).estado, 'evaluada');
  assert.deepEqual((await db.query(`SELECT fase, estado FROM sol_examen_tareas WHERE unidad = 'S12' ORDER BY id`)).rows.map((r) => `${r.fase}:${r.estado}`), ['crear:hecha', 'responder:hecha', 'calificar:hecha']);
  await setState('sol_examenes_dia', 5);
  const r5: any = await advanceExams(db, YO, launch);
  assert.deepEqual([r5.lanzado, r5.unidad], ['crear', 'S13']);
  // una tarea «completada» que no creó el examen no cuenta: queda fallida y se relanza
  await terminar(r5.tarea);
  const r6: any = await advanceExams(db, YO, launch);
  assert.deepEqual([r6.lanzado, r6.unidad], ['crear', 'S13']);
  assert.match((await db.query(`SELECT detalle FROM sol_examen_tareas WHERE unidad = 'S13' AND estado = 'fallida'`)).rows[0].detalle, /no avanzó/);
  assert.deepEqual(fases, ['crear:S12', 'responder:S12', 'calificar:S12', 'crear:S13', 'crear:S13']);
  // independiente del estudio: el currículo sigue en pausa mientras los exámenes avanzan
  assert.match(String((await advanceCurriculum(db, YO, async () => ({ tarea: await tarea() }))).motivo), /pausa/);
  await setState('sol_examenes_dia', 0);
  await terminar(r6.tarea, 'cancelada');
  assert.match(String((await advanceExams(db, YO, launch)).motivo), /pausa/);
});

test('suspenso: la materia vuelve a estudio con los comentarios del examinador en sus parámetros; tras 2 estudios, fallida', async () => {
  await preparar();
  await db.query(`UPDATE sol_unidades SET estado = 'estudiada', intentos = 1, completado_en = now() - interval '1 minute' WHERE codigo = 'S02'`);
  const e1 = await ex({ accion: 'crear', unidad: 'S02', preguntas: preguntas('Primero'), rubrica: rubrica('Primero') }, SAT);
  await ex({ accion: 'responder', examen_id: e1.examen_id, respuestas: respuestas() }, SOL);
  const g1 = await ex({ accion: 'calificar', examen_id: e1.examen_id, notas: notas([0.2, 0.9, 0.9, 0.9, 0.9, 0.9]) }, SAT);
  assert.ok(g1.nota >= 0.7); assert.equal(g1.aprobado, false);          // media suficiente, pero una respuesta < 0,3
  assert.equal(g1.materia, 'pendiente');
  assert.deepEqual([(await unidad('S02')).estado, (await unidad('S02')).intentos], ['pendiente', 1]);
  let visto: any;
  const r: any = await advanceCurriculum(db, YO, async (_d, e) => { visto = e; return { tarea: await tarea() }; });
  assert.equal(r.lanzado, 'S02');
  assert.match(visto.correcciones, new RegExp(`^Examen #${e1.examen_id} suspendido`));
  assert.match(visto.correcciones, /P1 \(0\.2\).*falta explicar el mecanismo/);
  assert.ok(visto.correcciones.indexOf('P1 (') < visto.correcciones.indexOf('P2 ('));   // lo peor primero
  assert.equal(visto.intento, 2);
  assert.ok(!visto.correcciones.includes('Criterio reservado'));                       // los comentarios, nunca la rúbrica
  assert.equal(parametrosMateria(visto).correcciones, visto.correcciones);
  await simularEstudio();
  assert.match((await ex({ accion: 'crear', unidad: 'S02', preguntas: preguntas('Primero'), rubrica: rubrica('Primero') }, SAT)).error, /nuevas/);
  const e2 = await ex({ accion: 'crear', unidad: 'S02', preguntas: preguntas('Segundo'), rubrica: rubrica('Segundo') }, SAT);
  await ex({ accion: 'responder', examen_id: e2.examen_id, respuestas: respuestas() }, SOL);
  const g2 = await ex({ accion: 'calificar', examen_id: e2.examen_id, notas: notas([0.4, 0.4, 0.4, 0.4, 0.4, 0.4]) }, SAT);
  assert.deepEqual([g2.aprobado, g2.materia], [false, 'fallida']);
  assert.equal((await unidad('S02')).estado, 'fallida');
  assert.equal((await advanceCurriculum(db, YO, async () => ({ tarea: await tarea() }))).lanzado, 'S01');
});

test('verificaciones del currículo: comprueban con datos reales lo hecho durante la tarea; la rúbrica copiada en el informe anula el examen', async () => {
  await preparar();
  const ids = [await tarea('sol'), await tarea('saturno')];
  await db.query(`UPDATE tasks SET started_at = clock_timestamp() WHERE id = ANY($1)`, [ids]);   // «durante la tarea» empieza ahora
  const ts = await fila(ids[0]), tq = await fila(ids[1]);
  const ctx = (task: any, params: Record<string, unknown>, texto = '') => ({ texto, params, extraido: {}, db, task });
  const chk = (k: string, c: any, x: any) => CURRICULO_CHECKS[k].comprobar(c, x);
  assert.equal((await chk('materia_preguntas_acd', { minimo: 3 }, ctx(ts, { codigo: 'S02' }))).ok, false);
  for (let i = 1; i <= 3; i++) await db.query(`INSERT INTO acd_preguntas (texto, origen, unidades, created_by) VALUES ($1, 'materia', '{S02}', $2)`, [`¿Pregunta abierta ${i} de lógica?`, SOL]);
  const acd = await chk('materia_preguntas_acd', { minimo: 3 }, ctx(ts, { codigo: 'S02' }));
  assert.ok(acd.ok, acd.detalle); assert.match(acd.detalle, /3 preguntas ACD de S02.*3 con origen materia/);
  await addConnection(db, { desde: 'falsabilidad', hacia: 'filosofía de la ciencia', tipo: 'conceptual', explicacion: 'La falsabilidad es un criterio central de la filosofía de la ciencia', tema_desde: 'S02', tema_hacia: 'S18' }, SOL);
  await addConnection(db, { desde: 'lógica', hacia: 'matemáticas', tipo: 'historica', explicacion: 'La lógica formal moderna nace de los fundamentos de la matemática', tema_desde: 'S01', tema_hacia: 'S02' }, SOL);
  await addConnection(db, { desde: 'lógica', hacia: 'algo sin código', tipo: 'hipotetica', explicacion: 'Conexión sin código en el otro lado: no cuenta', tema_desde: 'S02' }, SOL);
  const con = await chk('materia_conexiones', { minimo: 2 }, ctx(ts, { codigo: 'S02' }));
  assert.ok(con.ok, con.detalle); assert.match(con.detalle, /2 conexiones de S02 con 2 materias.*1 evidencia, 1 interpretación, 0 especulación/);
  const f = (await db.query(`INSERT INTO sol_fuentes (titulo, url, created_by, verificada) VALUES ('Fuente de prueba materias', $1, $2, true) RETURNING id`, [`https://example.org/materias-${Date.now()}`, SOL])).rows[0].id;
  assert.equal((await chk('materia_fuentes', { minimo: 1, leidas: 1 }, ctx(ts, { codigo: 'S02' }))).ok, false);   // registrada pero sin lectura real
  await db.query(`UPDATE sol_fuentes SET leido_hasta = 30000, longitud = 90000 WHERE id = $1`, [f]);
  // Una lectura anotada antes (otra tarea) no basta: tiene que haber llamadas reales a los lectores durante esta tarea
  const sinLeerAhora = await chk('materia_fuentes', { minimo: 1, leidas: 1 }, ctx(ts, { codigo: 'S02' }));
  assert.equal(sinLeerAhora.ok, false); assert.match(sinLeerAhora.detalle, /1 con lectura real anotada.*0 llamadas a los lectores/);
  await db.query(`INSERT INTO audit_log (actor, action, details) VALUES ($1, 'herramienta.biblioteca_sol', $2)`, [SOL, JSON.stringify({ input: { accion: 'leer_texto', pmcid: 'PMC1', prueba: YO } })]);
  const leida = await chk('materia_fuentes', { minimo: 1, leidas: 1 }, ctx(ts, { codigo: 'S02' }));
  assert.ok(leida.ok, leida.detalle); assert.match(leida.detalle, /1 llamadas a los lectores/);
  assert.equal((await chk('materia_expediente', {}, ctx(ts, { codigo: 'S02' }))).ok, false);
  assert.match((await chk('materia_expediente', {}, ctx(ts, { codigo: '' }))).detalle, /código de materia válido/);   // sin código no casa con cualquier título
  const p: any = await deliverProject(db, { titulo: 'Materia S02: Lógica y epistemología', tipo: 'materia', componentes: componentes() }, SOL);
  const exp = await chk('materia_expediente', {}, ctx(ts, { codigo: 'S02' }));
  assert.ok(exp.ok, exp.detalle);
  assert.equal((await db.query(`SELECT tarea_id FROM sol_proyectos WHERE id = $1`, [p.proyecto_id])).rows[0].tarea_id, ts.id);
  // examen: creado (sin fuga), fuga → anulado, respondido y calificado
  assert.equal((await chk('examen_creado', {}, ctx(tq, { unidad: 'S12' }))).ok, false);
  const R = rubrica('Fuga');
  const e = await ex({ accion: 'crear', unidad: 'S12', preguntas: preguntas('Fuga'), rubrica: R }, SAT);
  assert.ok((await chk('examen_creado', {}, ctx(tq, { unidad: 'S12' }, `## Diseño del examen\n${preguntas('Fuga').map((x) => x.pregunta).join('\n')}`))).ok);   // las preguntas son públicas
  const fuga = await chk('examen_creado', {}, ctx(tq, { unidad: 'S12' }, `## Diseño del examen\nPista: ${R[1].criterios}`));
  assert.equal(fuga.ok, false); assert.match(fuga.detalle, /anulado/);
  assert.equal((await db.query(`SELECT estado FROM sol_examenes WHERE id = $1`, [e.examen_id])).rows[0].estado, 'anulado');
  assert.equal((await ex({ accion: 'ver', unidad: 'S12' }, SOL)).examenes.length, 0);          // un examen anulado no se responde
  const e2 = await ex({ accion: 'crear', unidad: 'S12', preguntas: preguntas('Limpio'), rubrica: rubrica('Limpio') }, SAT);
  assert.ok(e2.examen_id, JSON.stringify(e2));
  assert.equal((await chk('examen_respondido', {}, ctx(ts, { unidad: 'S12', examen: e2.examen_id }))).ok, false);
  await ex({ accion: 'responder', examen_id: e2.examen_id, respuestas: respuestas() }, SOL);
  assert.ok((await chk('examen_respondido', {}, ctx(ts, { unidad: 'S12', examen: e2.examen_id }))).ok);
  assert.equal((await chk('examen_calificado', {}, ctx(tq, { unidad: 'S12', examen: e2.examen_id }))).ok, false);
  await ex({ accion: 'calificar', examen_id: e2.examen_id, notas: notas([0.1, 0.2, 0.3, 0.2, 0.1, 0.2]) }, SAT);
  const cal = await chk('examen_calificado', {}, ctx(tq, { unidad: 'S12', examen: e2.examen_id }));
  assert.ok(cal.ok); assert.match(cal.detalle, /suspenso/);                                  // calificar con honestidad también es cumplir
  assert.equal(rubricaFiltrada({ preguntas: [], rubrica: [{ criterios: 'corto' }] }, 'corto'), null);
});

test('independencia del examinador: del expediente de Sol solo temario y objetivos; leer más anula el examen de ese intento; el reintento empieza limpio', async () => {
  await preparar();
  const t = await tarea('saturno');
  await db.query(`UPDATE tasks SET started_at = clock_timestamp() WHERE id = $1`, [t]);
  const tq = await fila(t), ctx = { texto: '', params: { unidad: 'S13' }, extraido: {}, db, task: tq };
  const chk = () => CURRICULO_CHECKS.examen_creado.comprobar({}, ctx);
  const llamada = (input: Record<string, unknown>) => db.query(`INSERT INTO audit_log (actor, action, details) VALUES ($1, 'herramienta.proyecto_sol', $2)`, [SAT, JSON.stringify({ input: { ...input, prueba: YO } })]);
  await llamada({ accion: 'leer', proyecto_id: 1, componente: 'temario' }); await llamada({ accion: 'leer', proyecto_id: 1, componente: 'Objetivos' }); await llamada({ accion: 'estado', proyecto_id: 1 });
  const e1 = await ex({ accion: 'crear', unidad: 'S13', preguntas: preguntas('Indep'), rubrica: rubrica('Indep') }, SAT);
  const bien = await chk();
  assert.ok(bien.ok, bien.detalle); assert.match(bien.detalle, /solo se consultó el temario/);
  await llamada({ accion: 'leer', proyecto_id: 1, componente: 'conceptos' });                   // las conclusiones de Sol: no
  const mal = await chk();
  assert.equal(mal.ok, false); assert.match(mal.detalle, new RegExp(`leer conceptos.*#${e1.examen_id} anulado`));
  assert.equal((await db.query(`SELECT estado FROM sol_examenes WHERE id = $1`, [e1.examen_id])).rows[0].estado, 'anulado');
  assert.equal((await ex({ accion: 'ver', unidad: 'S13' }, SOL)).examenes.length, 0);                // un examen no independiente no se responde
  // Reintento (sesión nueva del agente): la ventana empieza en él; el examen nuevo es independiente
  await db.query(`INSERT INTO audit_log (actor, action, details) VALUES ('worker', 'tarea.reintento', $1)`, [JSON.stringify({ id: t, prueba: YO })]);
  const e2 = await ex({ accion: 'crear', unidad: 'S13', preguntas: preguntas('Indep2'), rubrica: rubrica('Indep2') }, SAT);
  assert.ok(e2.examen_id, JSON.stringify(e2));
  const otra = await chk();
  assert.ok(otra.ok, otra.detalle); assert.match(otra.detalle, new RegExp(`examen #${e2.examen_id}`));
  assert.equal((await db.query(`SELECT estado FROM sol_examenes WHERE id = $1`, [e2.examen_id])).rows[0].estado, 'creado');
  await setState('agents_engine', 'api');
  assert.match((await chk()).detalle, /no se puede comprobar/);
  await setState('agents_engine', 'suscripcion');
});

test('nota: decide la media exacta (0,69965 no se redondea a un 0,7 aprobado) y seis 0,7 sí aprueban', async () => {
  await preparar();
  const examinar = async (u: string, vals: number[]) => {
    const e = await ex({ accion: 'crear', unidad: u, preguntas: preguntas(`Nota ${u}`), rubrica: rubrica(`Nota ${u}`) }, SAT);
    await ex({ accion: 'responder', examen_id: e.examen_id, respuestas: respuestas() }, SOL);
    return ex({ accion: 'calificar', examen_id: e.examen_id, notas: notas(vals) }, SAT);
  };
  const casi = await examinar('S12', [0.7, 0.7, 0.7, 0.7, 0.7, 0.6979]);
  assert.deepEqual([casi.aprobado, casi.materia], [false, 'pendiente']); assert.ok(casi.nota < 0.7, String(casi.nota));
  const justo = await examinar('S13', [0.7, 0.7, 0.7, 0.7, 0.7, 0.7]);
  assert.deepEqual([justo.aprobado, justo.nota, justo.materia], [true, 0.7, 'evaluada']);
});

test('un solo planificador a la vez: si otro proceso tiene el cerrojo, no se lanza nada', async () => {
  await preparar();
  const otro = await db.connect();
  try {
    for (const [k, f] of [[7450, () => advanceCurriculum(db, YO, async () => ({ tarea: await tarea() }))], [7451, () => advanceExams(db, YO, async () => ({ tarea: await tarea('saturno') }))]] as const) {
      await otro.query('SELECT pg_advisory_lock($1)', [k]);
      const r: any = await f();
      assert.equal(r.lanzado, null); assert.match(String(r.motivo), /otro proceso/);
      await otro.query('SELECT pg_advisory_unlock($1)', [k]);
    }
  } finally { otro.release(); }
  assert.equal((await db.query(`SELECT count(*)::int AS n FROM sol_unidades WHERE estado = 'en_curso'`)).rows[0].n, 0);
  assert.equal((await advanceCurriculum(db, YO, async () => ({ tarea: await tarea() }))).lanzado, 'S02');   // sin cerrojo ajeno, sí
});

test('grafo: separa estructura, evidencia, interpretación y especulación; la ficha de una unidad reúne expediente, exámenes (sin rúbrica), conexiones y preguntas ACD', async () => {
  await preparar();
  const a = await addConnection(db, { desde: 'medición cuántica', hacia: 'observación', tipo: 'experimental', explicacion: 'Los experimentos de borrado cuántico muestran el papel del registro de información', tema_desde: 'S04', tema_hacia: 'V12' }, YO);
  const b = await addConnection(db, { desde: 'superposición', hacia: 'principio de vibración', tipo: 'conceptual', explicacion: 'Lectura conceptual del principio de vibración a la luz de la superposición', tema_desde: 'S04', tema_hacia: 'H03' }, YO);
  const c = await addConnection(db, { desde: 'observador', hacia: 'teoría sintérgica', tipo: 'hipotetica', explicacion: 'Hipótesis de Grinberg sobre la lattice y el observador, sin prueba experimental', tema_desde: 'V12', tema_hacia: 'H24' }, YO);
  const d = await addConnection(db, { desde: 'decoherencia', hacia: 'un concepto suelto', tipo: 'causal', explicacion: 'Conexión con un solo código: queda fuera del grafo entre unidades', tema_desde: 'S04' }, YO);
  const interna = await addConnection(db, { desde: 'medición', hacia: 'decoherencia', tipo: 'causal', explicacion: 'Dos conceptos de la misma materia: no conecta S04 con otra', tema_desde: 'S04', tema_hacia: 'S04' }, YO);
  // Una columna «evidencia» en una conexión hipotética no la convierte en evidencia: gana la naturaleza menos firme
  const rara = (await db.query(`INSERT INTO sol_conexiones (desde, hacia, tipo, explicacion, created_by, naturaleza, tema_desde, tema_hacia) VALUES ('resonancia', 'vibración', 'hipotetica', 'Hipótesis guardada con una naturaleza que no le corresponde', $1, 'evidencia', 'V02', 'H03') RETURNING id`, [YO])).rows[0];
  const g = await grafoInvestigacion(db);
  assert.equal(g.nodos.length, 80);
  assert.ok(g.aristas.every((x) => ['estructura', 'evidencia', 'interpretacion', 'especulacion'].includes(x.naturaleza)));
  const por = (id: number) => g.aristas.find((x) => x.id === id) as any;
  assert.deepEqual([por(a.id).naturaleza, por(a.id).respaldo, !!por(a.id).aviso], ['evidencia', 'sin_fuente', true]);
  assert.deepEqual([por(b.id).naturaleza, por(c.id).naturaleza], ['interpretacion', 'especulacion']);
  assert.equal(por(d.id), undefined);
  assert.equal(por(interna.id), undefined); assert.ok((g.resumen as any).conexiones_internas_fuera_del_grafo >= 1);
  assert.deepEqual([por(rara.id).naturaleza, /menos firme/.test(por(rara.id).naturaleza_discrepante)], ['especulacion', true]);
  const est = g.aristas.filter((x) => x.naturaleza === 'estructura');
  assert.ok(est.length > 100 && est.every((x) => /no es evidencia/.test(x.explicacion) && !x.fuente_ids.length));
  assert.ok(g.resumen.aristas.evidencia >= 1 && g.resumen.aristas.interpretacion >= 1 && g.resumen.aristas.especulacion >= 1);
  assert.ok((g.resumen as any).conexiones_sin_codigo_fuera_del_grafo >= 1);
  const sub = await grafoInvestigacion(db, { unidad: 's04' });
  assert.ok(sub.aristas.length && sub.aristas.every((x) => x.desde === 'S04' || x.hacia === 'S04'));
  assert.ok(['V12', 'H03', 'S03'].every((k) => sub.nodos.some((n: any) => n.codigo === k)));
  const md = await grafoMarkdown(db);
  for (const h of ['## Evidencia', '## Interpretación', '## Especulación', '## Estructura del currículo', 'no es evidencia', 'S04 Física cuántica → V12']) assert.ok(md.includes(h), h);
  // ficha de la unidad
  const q = (await db.query(`INSERT INTO acd_preguntas (texto, origen, unidades, created_by) VALUES ('¿Qué registra realmente una medición cuántica?', 'materia', '{S04}', $1) RETURNING id`, [YO])).rows[0].id;
  const f: any = await herramientaGrafo(db, { accion: 'unidad', unidad: 'S04' }, SOL);
  assert.equal(f.unidad.codigo, 'S04'); assert.match(f.dominio, /no demostrado/);
  assert.ok(f.conexiones.length >= 3 && f.conexiones.some((x: any) => x.id === a.id && x.naturaleza === 'evidencia' && x.otra === 'V12'));
  assert.ok(f.preguntas_acd.some((x: any) => x.id === q));
  assert.ok(f.estructura.relacionadas.includes('V03') && f.estructura.citada_por.includes('S03'));
  await ex({ accion: 'crear', unidad: 'S12', preguntas: preguntas('Ficha'), rubrica: rubrica('Ficha') }, SAT);
  const f12: any = await herramientaGrafo(db, { accion: 'unidad', unidad: 'S12' }, SOL);
  assert.ok(!JSON.stringify(f12).includes('Criterio reservado'));
  assert.deepEqual(f12.modulos_previos.map((m: any) => m.n), [1, 3, 4]);
  assert.match(f12.examen_estado, /creado/);
  const t: any = await herramientaGrafo(db, { accion: 'grafo' }, 'kratos (IA)');
  assert.ok(t.resumen && t.informe.includes('# Grafo de investigación de Sol'));
  assert.match((await herramientaGrafo(db, { accion: 'unidad', unidad: 'X99' }, SOL) as any).error, /código/);
  assert.match((await herramientaGrafo(db, { accion: 'otra' }, SOL) as any).error, /no válida/);
});

// Va la última a propósito: un error de lanzamiento deja ese tipo de estudio 10 min en espera (estado del proceso).
test('lanzamiento real: las tareas nacen de los playbooks con su creadoPor y sus parámetros; una tarea en revisión no quema intentos', async () => {
  await preparar();
  const nuevas = Object.keys(CURRICULO_CHECKS).filter((k) => !CHECK_TYPES[k]);
  for (const k of nuevas) CHECK_TYPES[k] = CURRICULO_CHECKS[k].claves;   // lo que hará el integrador en playbookchecks.ts
  try {
    for (const f of ['sol/sol-materia', 'sol/sol-examen-responder', 'saturno/sol-examen-crear', 'saturno/sol-examen-calificar']) {
      const pb = leer(f);
      if ((await db.query(`SELECT 1 FROM playbooks WHERE id = $1`, [pb.id])).rows.length) continue;
      await createPlaybook(db, pb, { autor: YO, origen: 'archivo' }); playbooksCreados.push(pb.id);
    }
    // Estudio: tarea de Sol con el playbook sol-materia, por detrás del trabajo de la empresa
    const r: any = await advanceCurriculum(db, YO);
    assert.equal(r.lanzado, 'S02', JSON.stringify(r));
    const t = await fila(r.tarea);
    assert.deepEqual([t.created_by, t.owner_function, t.playbook_id, t.priority, t.status], ['curriculo (planificador)', 'sol', 'sol-materia', 3, 'pendiente']);
    assert.deepEqual([t.inputs.parametros.codigo, t.inputs.parametros.titulo, t.inputs.parametros.correcciones], ['S02', 'Lógica y epistemología', '']);
    assert.match(t.inputs.parametros.alcance, /falsabilidad/);
    assert.match(t.verification, /preguntas (para )?ACD/i);
    // Examen: S12 (reutiliza los módulos completados) va directa a la fase crear con Saturno
    const e: any = await advanceExams(db, YO);
    assert.deepEqual([e.lanzado, e.unidad], ['crear', 'S12'], JSON.stringify(e));
    const te = await fila(e.tarea);
    assert.deepEqual([te.created_by, te.owner_function, te.playbook_id], ['examen (planificador)', 'saturno', 'sol-examen-crear']);
    assert.match(te.inputs.parametros.expediente, /módulos anteriores completados/);
    // La tarea de estudio pasa a revisión: la materia vuelve a pendiente, y relanzarla hoy devolvería esa misma tarea → se para sin gastar intento
    await terminar(r.tarea, 'requiere_revision');
    const r2: any = await advanceCurriculum(db, YO);
    assert.equal(r2.lanzado, null); assert.match(String(r2.motivo), new RegExp(`tarea #${r.tarea} .*requiere_revision.*no se gasta otro intento`));
    assert.deepEqual([(await unidad('S02')).estado, (await unidad('S02')).intentos], ['pendiente', 1]);
    assert.equal((await db.query(`SELECT count(*)::int AS n FROM tasks WHERE playbook_id = 'sol-materia' AND created_at >= $1`, [T0])).rows[0].n, 1);
  } finally { for (const k of nuevas) delete CHECK_TYPES[k]; }
});
