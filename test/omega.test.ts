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
