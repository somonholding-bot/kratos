// Operación Omega: las garantías de las memorias de Sol y del contrato de entregables las aplica el código.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createPool, type Db } from '../src/db.ts';
import { migrate } from '../src/migrate.ts';
import { addClaim, addPrediction, addSource, COMPONENTES, deliverProject, missingComponents, projectStatus, resolvePrediction, searchLibrary } from '../src/core/omega.ts';

let db: Db;
const ok = async () => ({ status: 200, title: 'Página de prueba' }), caida = async () => ({ status: 0, title: null });
before(async () => { db = createPool(); await migrate(db, () => {}); });
after(async () => {
  await db.query(`DELETE FROM sol_predicciones WHERE created_by = 'prueba'`);
  await db.query(`DELETE FROM sol_afirmaciones WHERE created_by = 'prueba'`);
  await db.query(`DELETE FROM sol_fuentes WHERE created_by = 'prueba'`);
  for (const p of (await db.query(`SELECT id, carpeta FROM sol_proyectos WHERE titulo LIKE 'Prueba Omega%'`)).rows) if (p.carpeta) fs.rmSync(p.carpeta, { recursive: true, force: true });
  await db.query(`DELETE FROM sol_proyectos WHERE titulo LIKE 'Prueba Omega%'`);
  await db.end();
});

test('una fuente solo queda verificada si su URL se abrió; sin abrir, solo metadatos', async () => {
  const a: any = await addSource(db, { url: 'https://example.org/omega-a', acceso: 'texto_completo', temas: ['Hipnosis'] }, 'prueba', ok);
  assert.equal(a.verificada, true); assert.equal(a.acceso, 'texto_completo'); assert.equal(a.titulo, 'Página de prueba');
  const b: any = await addSource(db, { url: 'https://example.org/omega-b', titulo: 'Caída', acceso: 'texto_completo' }, 'prueba', caida);
  assert.equal(b.verificada, false); assert.equal(b.acceso, 'metadatos');
  await assert.rejects(addSource(db, { url: 'http://localhost/x', titulo: 'Local' }, 'prueba', ok), /locales/);
  const s = await searchLibrary(db, 'hipnosis');
  assert.ok(s.fuentes.some((f: any) => f.id === a.id));
});

test('toda afirmación va ligada a una fuente; A y B exigen fuente verificada', async () => {
  const a: any = await addSource(db, { url: 'https://example.org/omega-c' }, 'prueba', ok);
  const b: any = await addSource(db, { titulo: 'Libro sin abrir' }, 'prueba', ok);
  await assert.rejects(addClaim(db, { texto: 'La hipnosis reduce el dolor en ensayos clínicos', nivel: 'A', fuente_id: 999999 }, 'prueba'), /fuente registrada/);
  await assert.rejects(addClaim(db, { texto: 'La hipnosis reduce el dolor en ensayos clínicos', nivel: 'A', fuente_id: b.id }, 'prueba'), /fuente verificada/);
  await assert.rejects(addClaim(db, { texto: 'La hipnosis reduce el dolor en ensayos clínicos', nivel: 'Z', fuente_id: a.id }, 'prueba'), /no válido/);
  assert.equal((await addClaim(db, { texto: 'El Akasha de Bardon es un concepto de su tradición', nivel: 'H', fuente_id: b.id }, 'prueba')).nivel, 'H');
  assert.equal((await addClaim(db, { texto: 'La hipnosis reduce el dolor en ensayos clínicos', nivel: 'a', fuente_id: a.id }, 'prueba')).nivel, 'A');
});

test('un paquete incompleto queda blocked y dice qué falta; completo queda completed con archivos en disco', async () => {
  const r1: any = await deliverProject(db, { titulo: 'Prueba Omega vídeo', tipo: 'video', componentes: { guion: 'x'.repeat(60), titulo: 'Lucid dreaming in 60 seconds' } }, 'prueba');
  assert.equal(r1.estado, 'blocked'); assert.ok(r1.faltantes.some((f: string) => f.startsWith('fuentes')));
  const todo = Object.fromEntries(COMPONENTES.video.map((k) => [k, k === 'fuentes' ? 'https://a.org/1\nhttps://b.org/2\nhttps://c.org/3 fuentes reales' : k === 'variantes_titulo' ? 'Uno de los títulos\nOtro título distinto\nTercer título posible' : `contenido de ${k} `.repeat(4)]));
  assert.deepEqual(missingComponents('video', todo), []);
  const r2: any = await deliverProject(db, { proyecto_id: r1.proyecto_id, componentes: todo }, 'prueba');
  assert.equal(r2.estado, 'completed'); assert.equal(r2.version, 2);
  const st: any = await projectStatus(db, r1.proyecto_id);
  assert.equal(st.estado, 'completed'); assert.equal(st.archivos.length, COMPONENTES.video.length); assert.ok(fs.existsSync(st.indice));
  // si los archivos desaparecen, el estado real deja de ser completed
  fs.rmSync(`${st.carpeta}/v2`, { recursive: true, force: true });
  assert.equal(((await projectStatus(db, r1.proyecto_id)) as any).estado, 'failed');
});

test('una predicción exige rango, confianza y base; al resolverla se sabe si acertó', async () => {
  await assert.rejects(addPrediction(db, { hipotesis: 'El Short superará la media del canal', metrica: 'vistas a 7 días', rango_min: 500, rango_max: 100, confianza: 0.6, base: 'media de los 2 Shorts vivos' }, 'prueba'), /rango/);
  await assert.rejects(addPrediction(db, { hipotesis: 'El Short superará la media del canal', metrica: 'vistas a 7 días', rango_min: 100, rango_max: 500, confianza: 1, base: 'media de los 2 Shorts vivos' }, 'prueba'), /certezas/);
  const p = await addPrediction(db, { hipotesis: 'El Short superará la media del canal', metrica: 'vistas a 7 días', rango_min: 100, rango_max: 500, confianza: 0.6, base: 'media de los 2 Shorts vivos' }, 'prueba');
  const r: any = await resolvePrediction(db, p.id, 620, 'Quedó por encima del rango', 'prueba');
  assert.equal(r.acierto, false); assert.match(r.calibracion.nota, /Menos de 10/);
});

test('currículo: un módulo cada vez, con tope diario, y solo se completa si su tarea terminó bien', async () => {
  const { advanceCurriculum } = await import('../src/core/curriculo.ts');
  await db.query(`UPDATE sol_modulos SET estado = 'pendiente', tarea_id = NULL, proyecto_id = NULL, intentos = 0, lanzado_en = NULL, completado_en = NULL`);
  await db.query(`INSERT INTO system_state (key, value) VALUES ('omega_modulos_dia', '2') ON CONFLICT (key) DO UPDATE SET value = '2'`);
  const biz = (await db.query(`SELECT id FROM businesses ORDER BY id LIMIT 1`)).rows[0].id;
  const tarea = async (status: string) => (await db.query(`INSERT INTO tasks (business_id, owner_function, type, title, objective, expected_result, verification, status, created_by) VALUES ($1,'sol','agente','Prueba módulo','x','x','x',$2,'prueba') RETURNING id`, [biz, status])).rows[0].id;
  const lanzados: number[] = []; let siguiente = await tarea('pendiente');
  const launch = async (_d: Db, m: { n: number }) => { lanzados.push(m.n); return { tarea: siguiente }; };
  assert.equal((await advanceCurriculum(db, 'prueba', launch)).lanzado, 1);
  assert.match(String((await advanceCurriculum(db, 'prueba', launch)).motivo), /en curso/);          // uno cada vez
  await db.query(`UPDATE tasks SET status = 'completada' WHERE id = $1`, [siguiente]); siguiente = await tarea('pendiente');
  assert.equal((await advanceCurriculum(db, 'prueba', launch)).lanzado, 2);                          // cierra el 1 y lanza el 2
  assert.equal((await db.query(`SELECT estado FROM sol_modulos WHERE n = 1`)).rows[0].estado, 'completado');
  await db.query(`UPDATE tasks SET status = 'fallida' WHERE id = $1`, [siguiente]);
  assert.match(String((await advanceCurriculum(db, 'prueba', launch)).motivo), /cupo diario/);       // el 2 vuelve a pendiente, pero hoy ya no hay cupo
  assert.equal((await db.query(`SELECT estado FROM sol_modulos WHERE n = 2`)).rows[0].estado, 'pendiente');
  await db.query(`UPDATE system_state SET value = '0' WHERE key = 'omega_modulos_dia'`);
  assert.match(String((await advanceCurriculum(db, 'prueba', launch)).motivo), /pausa/);
  assert.deepEqual(lanzados, [1, 2]);
  await db.query(`DELETE FROM tasks WHERE created_by = 'prueba' AND title = 'Prueba módulo'`);
  await db.query(`UPDATE sol_modulos SET estado = 'pendiente', tarea_id = NULL, intentos = 0, lanzado_en = NULL, completado_en = NULL`);
  await db.query(`UPDATE system_state SET value = '4' WHERE key = 'omega_modulos_dia'`);
});

test('lectura real: solo cuenta lo leído de seguido y texto_completo se marca al pasar del 90 %', async () => {
  const { readOpenText, xmlToText } = await import('../src/core/omega.ts');
  assert.equal(xmlToText('<article><p>Hola <b>mundo</b></p><ref-list><ref>cita</ref></ref-list></article>'), 'Hola mundo');
  const cuerpo = `<article><front><article-title>Prueba de lectura Omega</article-title></front><body><p>${'palabra '.repeat(9000)}</p></body></article>`;   // ~72.000 caracteres
  const get = async () => ({ status: 200, text: cuerpo });
  const a: any = await readOpenText(db, { pmcid: 'PMC999000111' }, 'prueba', get);
  assert.equal(a.acceso, 'parcial'); assert.ok(a.leido_pct < 50);
  const salto: any = await readOpenText(db, { pmcid: 'PMC999000111', desde: 60000 }, 'prueba', get);
  assert.equal(salto.leido_pct, a.leido_pct);                                    // saltarse el medio no cuenta
  const b: any = await readOpenText(db, { pmcid: 'PMC999000111', desde: a.hasta }, 'prueba', get);
  const c: any = await readOpenText(db, { pmcid: 'PMC999000111', desde: b.hasta }, 'prueba', get);
  assert.equal(c.acceso, 'texto_completo');
  assert.equal((await db.query(`SELECT acceso FROM sol_fuentes WHERE id = $1`, [a.fuente_id])).rows[0].acceso, 'texto_completo');
  await assert.rejects(readOpenText(db, { url: 'https://example.com/libro.txt' }, 'prueba', get), /dominio público/);
});
