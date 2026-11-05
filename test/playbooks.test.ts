// Fase D: playbooks reutilizables, verificables en código y versionados. Sin IA ni red (KRATOS_DISABLE_AI=1).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createPool, type Db } from '../src/db.ts';
import { config, ROOT } from '../src/config.ts';
import { migrate } from '../src/migrate.ts';
import { syncToolRegistry } from '../src/core/toolregistry.ts';
import { createTask } from '../src/core/tasks.ts';
import { saveReport } from '../src/core/registry.ts';
import { verifyTask, failedChecks } from '../src/core/verify.ts';
import { handlers } from '../src/core/handlers.ts';
import { tick } from '../src/worker.ts';
import { audit } from '../src/core/state.ts';
import { decideApproval } from '../src/core/approvals.ts';
import { TOOLS, isStrict, toolCount, specialistBrief, specialistSystem } from '../src/core/brain.ts';
import { evalNum, runCheck, validNumExpr } from '../src/core/playbookchecks.ts';
import { activateVersion, afterPlaybookTask, createPlaybook, findPlaybook, instantiatePlaybook, listPlaybooks, missingInputs, playbookContext, promotePlaybook, proposeVersion,
  recordPlaybookOutcome, rejectVersion, revertPlaybook, syncPlaybooksFromFiles, validatePlaybook, validateShape } from '../src/core/playbooks.ts';

assert.equal(config.db.database, 'jarvis_test');
let db: Db, biz: number;
before(async () => {
  db = createPool();
  await db.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
  await migrate(db, () => {});
  await syncToolRegistry(db);
  await db.query(`UPDATE tasks SET status = 'cancelada'`);
  biz = (await db.query(`INSERT INTO businesses (name) VALUES ('Aion') RETURNING id`)).rows[0].id;
  await db.query(`UPDATE system_state SET value = '"estricta"' WHERE key = 'autonomia'`);   // pruebas clásicas: todo por el panel
});
after(async () => { await db.query(`UPDATE system_state SET value = '"amplia"' WHERE key = 'autonomia'`); await db.end(); });

// ---------- helpers ----------
const SEEDS: Record<string, string> = { 'yt-investigacion-competencia': 'mercurio', 'yt-guion-ritual-lunar': 'venus', 'yt-calendario-30-dias': 'jupiter', 'yt-analisis-semanal': 'saturno' };
const seed = (id: string) => JSON.parse(fs.readFileSync(path.join(ROOT, 'playbooks', SEEDS[id], `${id}.json`), 'utf8'));
const task = async (id: number) => (await db.query(`SELECT * FROM tasks WHERE id = $1`, [id])).rows[0];
const soloEsta = (id: number) => db.query(`UPDATE tasks SET status = 'cancelada' WHERE status = 'pendiente' AND id <> $1`, [id]);
const stubAgente = (fn: (db: Db, t: any) => Promise<Record<string, unknown>>) => { const real = handlers.agente; (handlers as any).agente = fn; return () => { (handlers as any).agente = real; }; };
const conInforme = (text: string) => async (_db: Db, t: any) => ({ deliverable: text, report: saveReport(t, text) });
const EN = 'Breathe in slowly and let the light of the moon fill your body with calm… feel the ground under you and let go of the day. ';
const ES = 'Respira despacio y deja que la luz de la luna llene tu cuerpo de calma… siente el suelo bajo tus pies y suelta el día. ';
const TITULO = 'Full Moon in Taurus: 7-Minute Release Ritual Now'.padEnd(50, '!').slice(0, 50);
function informeGuion(duracion = 7, o: { guion?: string; imagenes?: number; sinBloque?: boolean } = {}) {
  const guion = o.guion ?? EN.repeat(Math.round(duracion * 128 / 24));
  const encargo = { titulo: TITULO, guion, imagenes: Array.from({ length: o.imagenes ?? 16 }, (_, i) => `moonlit scene number ${i + 1}, cinematic, no text`), musica: 'soft ambient pads, 60 bpm',
    miniatura_texto: 'Release Tonight', descripcion: 'A gentle full moon ritual. See tonight\'s Moon in Aion.', etiquetas: ['full moon', 'ritual', 'meditation', 'moon', 'release', 'sleep', 'calm', 'lunar'], formato: 'horizontal' };
  return `## Promise\nFor people who feel heavy at the full moon: ten minutes to let go, with the real Moon phase shown in Aion. ${'Tentative tone, no predictions. '.repeat(4)}\n\n## Beat map\n| min | beat | sound |\n|---|---|---|\n| 0:00 | promise | pads |\n| 1:30 | breathing | bell |\n| 5:00 | release | silence |\n\n## Script\n${guion}\n\n## Titles\n- ${TITULO}\n- Full Moon Release: 7 Minutes\n- Let Go Under the Full Moon\n${o.sinBloque ? '' : `\n\`\`\`json encargo\n${JSON.stringify(encargo, null, 1)}\n\`\`\`\n`}`;
}
function informeCompetencia(tema = 'planetary hours', n = 10, o: { sinHueco?: boolean } = {}) {
  const yt = Array.from({ length: n }, (_, i) => `https://www.youtube.com/watch?v=vid${tema.replace(/\W/g, '')}${i}`);
  const rows = yt.map((u, i) => `| ${tema} video ${i + 1} | Channel ${i + 1} | ${(n - i) * 10000} | 12:0${i % 10} | 2026-0${(i % 9) + 1}-01 | ${u} |`).join('\n');
  const relleno = `Datos observados sobre ${tema} en los vídeos de la tabla, con cifras y fechas. `.repeat(12);
  return `## Resumen\nTema: ${tema}. Patrón: títulos cortos. Hueco: nadie explica el orden caldeo. Ángulo: guía práctica. Riesgo: tema de nicho.\n${relleno}\n\n## Top videos\n| título | canal | vistas | duración | fecha | URL |\n|---|---|---|---|---|---|\n${rows}\n\n## Patrón ganador\n${relleno}\n\n${o.sinHueco ? '' : `## Hueco\n${relleno}\n\n`}## Ángulos para Aion\n- Planetary Hours Explained: Your Daily Power Hour (for beginners)\n- The Chaldean Order in 5 Minutes (curiosity)\n- Venus Hour Ritual for Love (desire)\n\n## Fuentes\n${yt.map((u) => `- ${u} (2026-10)`).join('\n')}\n- https://example.com/planetary-hours (2026-10)\n- https://moon.example.org/chaldean (2026-09)\n`;
}
const informeAnalisis = () => `## Cifras de la semana\nSuscriptores: 12. Vistas totales: 340. ${'Vídeo reciente: 40 vistas, 3 me gusta, 1 comentario. '.repeat(6)}\n\n## Comparación\n${'Subieron las vistas de 200 a 340 (+70 %). '.repeat(5)}\n\n## Qué funcionó\n${'El vídeo de luna llena superó la media ×2 (120 vistas frente a 50). '.repeat(4)}\n\n## Qué cambiar\n${'Los Shorts sin pregunta no retienen: 12 vistas de media. '.repeat(4)}\n\n## Lecciones\n- Luna llena ×2 vistas (120 frente a 50)\n- Shorts con pregunta: 30 vistas frente a 12\n- Publicar 2 días antes del evento lunar: 80 vistas frente a 20\n\n## Próxima semana\n- yt-investigacion-competencia {tema: "new moon ritual"}\n- yt-guion-ritual-lunar {tema: "New Moon in Scorpio", duracion_min: 7}\n`;

// ---------- 1 ----------
test('validateShape nombra la ruta de cada error', () => {
  const pb = seed('yt-investigacion-competencia');
  assert.ok(validateShape({ ...pb, id: undefined }).errores.some((e) => e.startsWith('id:')));
  assert.ok(validateShape({ ...pb, id: 'Mayusculas' }).errores.some((e) => e.startsWith('id:')));
  assert.ok(validateShape({ ...pb, agentes: { responsable: 'kratos' } }).errores.some((e) => e.startsWith('agentes.responsable')));
  const pasos = structuredClone(pb.pasos); pasos[1].n = 3;
  assert.ok(validateShape({ ...pb, pasos }).errores.some((e) => e.startsWith('pasos[1].n')));
  const pasos2 = structuredClone(pb.pasos); pasos2[0].instruccion = 'Busca sobre {{tema_x}} en la web';
  assert.ok(validateShape({ ...pb, pasos: pasos2 }).errores.some((e) => e.includes('pasos[0].instruccion: marcador {{tema_x}}')));
  assert.ok(validateShape({ ...pb, verificacion: [{ nombre: 'idioma', tipo: 'idioma', idioma: 'en' }] }).errores.some((e) => e.startsWith('verificacion:') && e.includes('bloqueante')));
  assert.ok(validateShape({ ...pb, verificacion: [{ nombre: 'm', tipo: 'magia' }] }).errores.some((e) => e.includes('tipo desconocido')));
  assert.ok(validateShape({ ...pb, foo: 1 }).errores.some((e) => e === 'foo: clave desconocida'));
  for (const id of Object.keys(SEEDS)) assert.deepEqual(validateShape(seed(id)), { ok: true, errores: [] }, id);
});

// ---------- 2 ----------
test('validatePlaybook comprueba agente, skill y herramientas contra la base de datos', async () => {
  const comp = seed('yt-investigacion-competencia'), guion = seed('yt-guion-ritual-lunar');
  assert.match((await validatePlaybook(db, { ...comp, herramientas: [...comp.herramientas, 'enviar_correo'] })).errores.join(' '), /enviar_correo.*no existe/);
  assert.match((await validatePlaybook(db, { ...guion, herramientas: [...guion.herramientas, 'producir_video'] })).errores.join(' '), /producir_video.*no está permitida/);
  assert.match((await validatePlaybook(db, { ...guion, skill: 'inexistente' })).errores.join(' '), /skill/);
  assert.equal((await validatePlaybook(db, { ...comp, agentes: { responsable: 'pluton' } })).ok, false);
  for (const id of Object.keys(SEEDS)) { const v = await validatePlaybook(db, seed(id)); assert.equal(v.ok, true, `${id}: ${v.errores.join('; ')}`); }
});

// ---------- 3 ----------
test('syncPlaybooksFromFiles importa, detecta cambios y aísla los archivos inválidos sin lanzar', async () => {
  const first = await syncPlaybooksFromFiles(db);
  assert.equal(first.importados.length, 12, JSON.stringify(first));
  const second = await syncPlaybooksFromFiles(db);
  assert.equal(second.sin_cambios.length, 12); assert.equal(second.importados.length, 0);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kratos-pb-'));
  fs.mkdirSync(path.join(dir, 'venus')); fs.mkdirSync(path.join(dir, 'mercurio'));
  fs.writeFileSync(path.join(dir, 'venus', 'malo.json'), JSON.stringify({ id: 'malo' }));
  fs.writeFileSync(path.join(dir, 'mercurio', 'pb-otro.json'), JSON.stringify({ ...seed('yt-guion-ritual-lunar'), id: 'pb-otro' }));
  const temp = { ...seed('yt-guion-ritual-lunar'), id: 'pb-temporal', nombre: 'Temporal v1' };
  fs.writeFileSync(path.join(dir, 'venus', 'pb-temporal.json'), JSON.stringify(temp));
  const r = await syncPlaybooksFromFiles(db, dir);
  assert.deepEqual(r.importados, ['pb-temporal']);
  assert.equal(r.invalidos.length, 2);
  assert.ok((await db.query(`SELECT count(*)::int AS n FROM audit_log WHERE action = 'playbook.invalido'`)).rows[0].n >= 2);
  fs.writeFileSync(path.join(dir, 'venus', 'pb-temporal.json'), JSON.stringify({ ...temp, nombre: 'Temporal v2' }));
  const r2 = await syncPlaybooksFromFiles(db, dir);
  assert.deepEqual(r2.actualizados, ['pb-temporal']);
  const vs = (await db.query(`SELECT version, estado FROM playbook_versions WHERE playbook_id = 'pb-temporal' ORDER BY version`)).rows;
  assert.deepEqual(vs, [{ version: 1, estado: 'sustituida' }, { version: 2, estado: 'activa' }]);
  assert.equal((await db.query(`SELECT version_activa FROM playbooks WHERE id = 'pb-temporal'`)).rows[0].version_activa, 2);
});

// ---------- 4 ----------
test('missingInputs: pregunta solo lo que falta, aplica defectos y rechaza valores no válidos', () => {
  const comp = seed('yt-investigacion-competencia'), guion = seed('yt-guion-ritual-lunar'), cal = seed('yt-calendario-30-dias');
  const m = missingInputs(comp, {});
  assert.deepEqual(m.faltan.map((f) => f.clave), ['tema']); assert.ok(m.faltan[0].pregunta.length > 5);
  assert.equal(m.normalizados.periodo_meses, 12);
  assert.ok(missingInputs(comp, { tema: 'x', periodo_meses: 99 }).invalidos.some((i) => i.clave === 'periodo_meses' && /36/.test(i.motivo)));
  assert.ok(missingInputs(guion, { tema: 'x', tipo: 'baile' }).invalidos.some((i) => i.clave === 'tipo'));
  assert.equal(missingInputs(guion, { tema: 'x', subir: 'true' }).normalizados.subir, true);
  assert.equal(missingInputs(cal, {}).normalizados.fecha_inicio, new Date(Date.now() - new Date().getTimezoneOffset() * 60_000).toISOString().slice(0, 10));
  assert.ok(missingInputs(cal, { fecha_inicio: '2026-13-40' }).invalidos.some((i) => i.clave === 'fecha_inicio'));
});

// ---------- 5 ----------
test('instantiatePlaybook crea la tarea del agente con el procedimiento, es idempotente y respeta aprobaciones previas', async () => {
  const r = await instantiatePlaybook(db, { id: 'yt-investigacion-competencia', negocioId: biz, parametros: { tema: 'planetary hours' } });
  assert.equal(r.ok, true, JSON.stringify(r)); assert.equal(r.creada, true);
  const t = await task(r.tarea);
  assert.equal(t.type, 'agente'); assert.equal(t.owner_function, 'mercurio'); assert.equal(t.playbook_id, 'yt-investigacion-competencia'); assert.equal(t.playbook_version, 1);
  assert.equal(t.inputs.parametros.n_videos, 10); assert.equal(t.max_attempts, 3);
  assert.match(t.verification, /secciones obligatorias/); assert.match(t.verification, /al menos 10 URLs/);
  const again = await instantiatePlaybook(db, { id: 'yt-investigacion-competencia', negocioId: biz, parametros: { tema: 'planetary hours' } });
  assert.equal(again.creada, false); assert.equal(again.tarea, r.tarea);
  const n = (await db.query(`SELECT count(*)::int AS n FROM tasks`)).rows[0].n;
  const prev = await instantiatePlaybook(db, { id: 'yt-investigacion-competencia', negocioId: biz, parametros: { tema: 'planetary hours' }, soloValidar: true });
  assert.match(prev.vista_previa, /PROCEDIMIENTO/); assert.match(prev.vista_previa, / 2\. Top 10.*planetary hours/);
  assert.equal((await db.query(`SELECT count(*)::int AS n FROM tasks`)).rows[0].n, n);
  // aprobación previa
  const pbA = { ...seed('yt-investigacion-competencia'), id: 'pb-con-permiso', nombre: 'Con permiso previo', palabras_clave: ['permiso previo'], aprobaciones: [{ cuando: 'antes', tipo: 'otro', descripcion: 'Investigar «{{tema}}» gasta búsquedas' }] };
  await createPlaybook(db, pbA, { autor: 'test' });
  const a = await instantiatePlaybook(db, { id: 'pb-con-permiso', negocioId: biz, parametros: { tema: 'moon water' } });
  assert.equal((await task(a.tarea)).status, 'esperando_permiso');
  const ap = (await db.query(`SELECT id, scope FROM approvals WHERE task_id = $1`, [a.tarea])).rows[0];
  assert.equal(ap.scope.tipo, 'playbook_ejecucion');
  assert.equal((await decideApproval(db, ap.id, true, 'panel')).ok, true);
  assert.equal((await task(a.tarea)).status, 'pendiente');
  const b = await instantiatePlaybook(db, { id: 'pb-con-permiso', negocioId: biz, parametros: { tema: 'sun water' } });
  const ap2 = (await db.query(`SELECT id FROM approvals WHERE task_id = $1`, [b.tarea])).rows[0];
  await decideApproval(db, ap2.id, false, 'panel');
  assert.equal((await task(b.tarea)).status, 'cancelada');
});

// ---------- 6 ----------
test('specialistBrief incluye el PROCEDIMIENTO y specialistSystem fija la skill del playbook', async () => {
  const agent = (await db.query(`SELECT id, name, purpose, model, allowed_tools, prohibited, escalation, deliverables, charter FROM agent_functions WHERE id = 'mercurio'`)).rows[0];
  const business = (await db.query(`SELECT id, name, goals, is_demo FROM businesses WHERE id = $1`, [biz])).rows[0];
  const t = (await db.query(`SELECT * FROM tasks WHERE playbook_id = 'yt-investigacion-competencia' ORDER BY id LIMIT 1`)).rows[0];
  const brief = await specialistBrief(db, t, agent, business, null, []);
  assert.match(brief, /PROCEDIMIENTO/); assert.match(brief, / 2\. Top 10/); assert.ok(!brief.includes('playbook · ')); assert.match(brief, /secciones obligatorias/);
  const brief2 = await specialistBrief(db, { ...t, attempts: 2, last_error: 'Verificación fallida: playbook · secciones (faltan: Hueco)' }, agent, business, null, []);
  assert.match(brief2, /INTENTO 2/);
  const { task: plain } = await createTask(db, { businessId: biz, ownerFunction: 'mercurio', type: 'agente', title: 'Sin playbook', objective: 'x', expectedResult: 'x', verification: 'x', createdBy: 'test', idempotencyKey: 'pb-sin' });
  assert.ok(!(await specialistBrief(db, plain, agent, business, null, [])).includes('PROCEDIMIENTO'));
  const venus = (await db.query(`SELECT * FROM agent_functions WHERE id = 'venus'`)).rows[0];
  assert.match(specialistSystem(venus, { title: 'x', objective: 'y' }, seed('yt-guion-ritual-lunar')), /Método de la skill «cinematic-director»/);
});

// ---------- 7 ----------
test('verifyTask con playbook (texto): secciones, tabla, URLs, tema e ítems', async () => {
  const t = (await db.query(`SELECT * FROM tasks WHERE playbook_id = 'yt-investigacion-competencia' ORDER BY id LIMIT 1`)).rows[0];
  const corto = informeCompetencia('planetary hours', 10, { sinHueco: true });
  assert.ok(corto.length >= 3000);
  const v1 = await verifyTask(db, t, { deliverable: corto, report: saveReport(t, corto) });
  assert.equal(v1.ok, false); assert.match(failedChecks(v1), /playbook · secciones \(faltan: Hueco\)/);
  const bueno = informeCompetencia('planetary hours', 10);
  const v2 = await verifyTask(db, t, { deliverable: bueno, report: saveReport(t, bueno) });
  assert.equal(v2.ok, true, failedChecks(v2));
  const c = await runCheck({ nombre: 'x', tipo: 'tabla_filas', minimo: 1, seccion: 'X' }, { texto: '## A\n| a |\n', params: {}, extraido: {} });
  assert.equal(c.ok, false); assert.match(c.detalle!, /sección «X» no encontrada/);
});

// ---------- 8 ----------
test('verifyTask con playbook (campos y bloque JSON): encargo, ritmo, idioma, promesas médicas, imágenes y expresiones', async () => {
  const r = await instantiatePlaybook(db, { id: 'yt-guion-ritual-lunar', negocioId: biz, parametros: { tema: 'Full Moon in Taurus Release Ritual' } });
  const t = await task(r.tarea);
  const run = async (text: string) => { const result: any = { deliverable: text, report: saveReport(t, text) }; const v = await verifyTask(db, t, result); return { v, result }; };
  const ok = await run(informeGuion(7));
  assert.equal(ok.v.ok, true, failedChecks(ok.v)); assert.equal(ok.result.extraido.encargo.titulo, TITULO);
  assert.match(failedChecks((await run(informeGuion(7, { sinBloque: true }))).v), /bloque encargo/);
  assert.match(failedChecks((await run(informeGuion(7, { guion: EN.repeat(12) }))).v), /ritmo del guion.*ppm/);
  const es = await run(informeGuion(7, { guion: ES.repeat(38) }));
  const idioma = es.v.comprobaciones.find((c) => c.nombre === 'playbook · idioma')!;
  assert.equal(idioma.ok, false); assert.equal(idioma.nivel, 'aviso'); assert.equal(es.v.ok, true, failedChecks(es.v));
  assert.match(failedChecks((await run(informeGuion(7, { guion: EN.repeat(37) + 'This is a guaranteed cure for anxiety. ' }))).v), /sin promesas médicas/);
  assert.match(failedChecks((await run(informeGuion(7, { imagenes: 5 }))).v), /imágenes suficientes \(5 elementos \(mínimo 14\)\)/);
  assert.equal(evalNum('{{d}}*2+1', { d: 7 }), 15);
  assert.ok(validNumExpr('{{tema}}*2', new Set()));
  assert.equal(validNumExpr('{{d}}*2', new Set(['d'])), null);
});

// ---------- 9 ----------
test('herramienta_usada se comprueba en audit_log; con motor API queda como aviso', async () => {
  const r = await instantiatePlaybook(db, { id: 'yt-analisis-semanal', negocioId: biz, parametros: { dias: 14 } });
  const t = await task(r.tarea);
  const text = informeAnalisis();
  const uso = (v: any) => v.comprobaciones.find((c: any) => c.nombre === 'playbook · usó estado_youtube');
  assert.equal(uso(await verifyTask(db, t, { deliverable: text, report: saveReport(t, text) })).ok, false);
  await audit(db, 'agente:saturno', 'herramienta.estado_youtube', {});
  const v2 = await verifyTask(db, t, { deliverable: text, report: saveReport(t, text) });
  assert.equal(uso(v2).ok, true); assert.equal(v2.ok, true, failedChecks(v2));
  const prev = (await db.query(`SELECT value FROM system_state WHERE key = 'agents_engine'`)).rows[0];
  await db.query(`INSERT INTO system_state (key, value) VALUES ('agents_engine', '"api"') ON CONFLICT (key) DO UPDATE SET value = '"api"'`);
  try {
    const c = uso(await verifyTask(db, t, { deliverable: text, report: saveReport(t, text) }));
    assert.equal(c.ok, true); assert.equal(c.nivel, 'aviso');
  } finally {
    if (prev) await db.query(`UPDATE system_state SET value = $1 WHERE key = 'agents_engine'`, [JSON.stringify(prev.value)]);
    else await db.query(`DELETE FROM system_state WHERE key = 'agents_engine'`);
  }
});

// ---------- 10 ----------
test('worker: la política del playbook decide (reintentar, revisar, fallar) y el playbook aprende de cada resultado', async () => {
  const r = await instantiatePlaybook(db, { id: 'yt-investigacion-competencia', negocioId: biz, parametros: { tema: 'moon phases' } });
  const id = r.tarea;
  const pb = async () => (await db.query(`SELECT exitos, fallos_seguidos, coste_medido FROM playbooks WHERE id = 'yt-investigacion-competencia'`)).rows[0];
  let restore = stubAgente(conInforme('Informe corto sobre moon phases. '.repeat(10)));
  try {
    await soloEsta(id);
    assert.equal(await tick(db, 'w-pb'), 'fallida');
    let t = await task(id);
    assert.equal(t.status, 'pendiente'); assert.match(t.last_error, /playbook ·/); assert.equal((await pb()).fallos_seguidos, 1);
    await db.query(`UPDATE tasks SET run_at = now() WHERE id = $1`, [id]);
    assert.equal(await tick(db, 'w-pb'), 'fallida');
    assert.equal((await pb()).fallos_seguidos, 2);
    assert.ok((await db.query(`SELECT 1 FROM knowledge_items WHERE content ILIKE '%degradado%' AND business_id = $1`, [biz])).rows.length);
    assert.ok((await db.query(`SELECT 1 FROM audit_log WHERE action = 'playbook.degradado'`)).rows.length);
    restore(); restore = stubAgente(conInforme(informeCompetencia('moon phases', 10)));
    await db.query(`UPDATE tasks SET run_at = now() WHERE id = $1`, [id]);
    assert.equal(await tick(db, 'w-pb'), 'ejecutada');
    t = await task(id);
    assert.equal(t.status, 'completada');
    const p = await pb();
    assert.equal(p.exitos, 1); assert.equal(p.fallos_seguidos, 0); assert.equal(p.coste_medido.muestras, 3);
    // revisar
    restore(); restore = stubAgente(conInforme('Calendario corto. '.repeat(20)));
    const cal = await instantiatePlaybook(db, { id: 'yt-calendario-30-dias', negocioId: biz, parametros: {} });
    await soloEsta(cal.tarea);
    assert.equal(await tick(db, 'w-pb'), 'fallida');
    assert.equal((await task(cal.tarea)).status, 'requiere_revision');
    // fallar al primer intento aunque haya reintentos declarados
    const pbF = { ...seed('yt-investigacion-competencia'), id: 'pb-fallar', nombre: 'Falla sin reintentar', palabras_clave: ['fallar'], recuperacion: { si_falla_verificacion: 'fallar', si_falta_herramienta: 'fallar' }, reintentos: { max: 3 } };
    await createPlaybook(db, pbF, { autor: 'test' });
    const f = await instantiatePlaybook(db, { id: 'pb-fallar', negocioId: biz, parametros: { tema: 'x' } });
    await soloEsta(f.tarea);
    assert.equal(await tick(db, 'w-pb'), 'fallida');
    const ft = await task(f.tarea);
    assert.equal(ft.status, 'fallida'); assert.equal(ft.attempts, 1);
  } finally { restore(); }
});

// ---------- 11 ----------
test('encadenado: un guion verificado crea la tarea producir_video una sola vez y respeta «subir»', async () => {
  const r = await instantiatePlaybook(db, { id: 'yt-guion-ritual-lunar', negocioId: biz, parametros: { tema: 'Full Moon in Taurus Release Ritual' } });
  const restore = stubAgente(conInforme(informeGuion(7)));
  try {
    await soloEsta(r.tarea);
    assert.equal(await tick(db, 'w-pb'), 'ejecutada');
    const video = (await db.query(`SELECT * FROM tasks WHERE type = 'produccion_video' AND idempotency_key = $1`, [`playbook:yt-guion-ritual-lunar:tarea:${r.tarea}:siguiente`])).rows[0];
    assert.ok(video, 'tarea de vídeo encadenada');
    assert.equal(video.owner_function, 'venus'); assert.equal(video.inputs.titulo, TITULO); assert.equal(video.inputs.subir, true); assert.equal(video.inputs.imagenes.length, 16);
    assert.equal(video.playbook_id, 'yt-guion-ritual-lunar'); assert.equal(video.playbook_version, 1);
    const t = await task(r.tarea);
    const again = await afterPlaybookTask(db, t, t.result);
    assert.equal(again.creada, false);
    assert.equal((await db.query(`SELECT count(*)::int AS n FROM tasks WHERE type = 'produccion_video' AND inputs->>'origen_tarea' = $1`, [String(r.tarea)])).rows[0].n, 1);
    const r2 = await instantiatePlaybook(db, { id: 'yt-guion-ritual-lunar', negocioId: biz, parametros: { tema: 'Full Moon in Taurus Release Ritual', subir: false } });
    await soloEsta(r2.tarea);
    assert.equal(await tick(db, 'w-pb'), 'ejecutada');
    const v2 = (await db.query(`SELECT inputs FROM tasks WHERE type = 'produccion_video' AND inputs->>'origen_tarea' = $1`, [String(r2.tarea)])).rows[0];
    assert.equal(v2.inputs.subir, false);
  } finally { restore(); await db.query(`UPDATE tasks SET status = 'cancelada' WHERE type = 'produccion_video' AND status = 'pendiente'`); }
});

// ---------- 12 ----------
test('recurrencia: la siguiente ejecución conserva playbook_id y playbook_version', async () => {
  const r = await instantiatePlaybook(db, { id: 'yt-analisis-semanal', negocioId: biz, parametros: {} });
  assert.equal((await task(r.tarea)).recurrence_minutes, 10080);
  const restore = stubAgente(async (d: Db, t: any) => { await audit(d, 'agente:saturno', 'herramienta.estado_youtube', {}); const text = informeAnalisis(); return { deliverable: text, report: saveReport(t, text) }; });
  try {
    await soloEsta(r.tarea);
    assert.equal(await tick(db, 'w-pb'), 'ejecutada');
    assert.equal((await task(r.tarea)).status, 'completada');
    const next = (await db.query(`SELECT playbook_id, playbook_version, run_at FROM tasks WHERE idempotency_key LIKE 'agente:%' ORDER BY id DESC LIMIT 1`)).rows[0];
    assert.equal(next.playbook_id, 'yt-analisis-semanal'); assert.equal(next.playbook_version, 1);
    assert.ok(new Date(next.run_at).getTime() > Date.now() + 6 * 86_400_000);
    assert.equal((await task(r.tarea)).result.siguiente_paso.includes('registrar_leccion'), true);
  } finally { restore(); }
});

// ---------- 13 ----------
test('versiones: prueba activa directo; producción exige borrador probado; idéntico y cambio de agente se rechazan', async () => {
  const id = 'yt-investigacion-competencia';
  await db.query(`UPDATE playbooks SET exitos = 0, fallos_seguidos = 0 WHERE id = $1`, [id]);
  const base = seed(id);
  const v2 = await proposeVersion(db, id, { ...base, nombre: 'Competencia v2' }, { causa: 'mejora', motivo: 'más claro', autor: 'test' });
  assert.equal(v2.version, 2); assert.equal(v2.estado, 'activa');
  const estados = async () => Object.fromEntries((await db.query(`SELECT version, estado FROM playbook_versions WHERE playbook_id = $1`, [id])).rows.map((r) => [r.version, r.estado]));
  assert.equal((await estados())[1], 'sustituida');
  assert.equal((await db.query(`SELECT version_activa FROM playbooks WHERE id = $1`, [id])).rows[0].version_activa, 2);
  await assert.rejects(promotePlaybook(db, id), /ejecución/);
  await db.query(`UPDATE playbooks SET exitos = 1 WHERE id = $1`, [id]);
  assert.equal((await promotePlaybook(db, id)).estado, 'produccion');
  const v3 = await proposeVersion(db, id, { ...base, nombre: 'Competencia v3' }, { causa: 'mejora', motivo: 'borrador', autor: 'test' });
  assert.equal(v3.version, 3); assert.equal(v3.estado, 'borrador');
  assert.equal((await db.query(`SELECT version_activa FROM playbooks WHERE id = $1`, [id])).rows[0].version_activa, 2);
  await assert.rejects(activateVersion(db, id, 3), /ninguna ejecución verificada/);
  const r = await instantiatePlaybook(db, { id, negocioId: biz, parametros: { tema: 'moon water' }, version: 3 });
  assert.equal(r.ok, true, JSON.stringify(r));
  const t = await task(r.tarea);
  assert.equal(t.playbook_version, 3);
  await db.query(`UPDATE tasks SET status = 'completada', verification_result = '{"ok": true}', started_at = now() - interval '3 minutes', completed_at = now() WHERE id = $1`, [t.id]);
  await recordPlaybookOutcome(db, await task(t.id), true);
  assert.equal((await activateVersion(db, id, 3)).estado, 'activa');
  assert.equal((await estados())[2], 'sustituida');
  const v3c = (await db.query(`SELECT contenido FROM playbook_versions WHERE playbook_id = $1 AND version = 3`, [id])).rows[0].contenido;
  await assert.rejects(proposeVersion(db, id, v3c, { causa: 'mejora', autor: 'test' }), /contenido idéntico a la versión 3/);
  await assert.rejects(proposeVersion(db, id, { ...base, nombre: 'Otro agente', agentes: { responsable: 'venus' } }, { causa: 'mejora', autor: 'test' }), /agente/);
});

// ---------- 14 ----------
test('regla de un solo fallo, reversión con historial y verificación con la versión exacta de cada tarea', async () => {
  const id = 'yt-investigacion-competencia';
  const base = seed(id);
  await db.query(`UPDATE playbooks SET fallos_seguidos = 1 WHERE id = $1`, [id]);
  await assert.rejects(proposeVersion(db, id, { ...base, nombre: 'Tras un fallo' }, { causa: 'fallo', motivo: 'falló una vez', autor: 'test' }), /un solo fallo/i);
  const v4 = await proposeVersion(db, id, { ...base, nombre: 'Tras un fallo' }, { causa: 'fallo', motivo: 'propietario: lo pido yo', autor: 'test' });
  assert.equal(v4.estado, 'borrador');
  await db.query(`UPDATE playbooks SET fallos_seguidos = 2 WHERE id = $1`, [id]);
  const extra = { nombre: 'imposible', tipo: 'longitud_minima', caracteres: 999999 };
  const v5 = await proposeVersion(db, id, { ...base, nombre: 'Tras dos fallos', verificacion: [...base.verificacion, extra] }, { causa: 'fallo', motivo: 'dos seguidos', autor: 'test' });
  assert.equal(v5.estado, 'borrador');
  const rev = await revertPlaybook(db, id, 1, 'test');
  const row = (await db.query(`SELECT * FROM playbook_versions WHERE playbook_id = $1 AND version = $2`, [id, rev.version])).rows[0];
  const v1 = (await db.query(`SELECT hash FROM playbook_versions WHERE playbook_id = $1 AND version = 1`, [id])).rows[0];
  assert.equal(row.estado, 'activa'); assert.equal(row.origen, 'reversion'); assert.equal(row.revierte_a, 1); assert.equal(row.hash, v1.hash);
  assert.equal((await db.query(`SELECT version_activa, fallos_seguidos FROM playbooks WHERE id = $1`, [id])).rows[0].version_activa, rev.version);
  assert.ok((await db.query(`SELECT 1 FROM audit_log WHERE action = 'playbook.revertido'`)).rows.length);
  await rejectVersion(db, id, v4.version, 'test');
  await assert.rejects(revertPlaybook(db, id, v4.version, 'test'), /rechazada/);
  // la tarea creada con v3 se verifica con v3 aunque la v5 añada una comprobación imposible
  const t3 = (await db.query(`SELECT * FROM tasks WHERE playbook_id = $1 AND playbook_version = 3 ORDER BY id LIMIT 1`, [id])).rows[0];
  const text = informeCompetencia('moon water', 10);
  const ok = await verifyTask(db, t3, { deliverable: text, report: saveReport(t3, text) });
  assert.equal(ok.ok, true, failedChecks(ok));
  const r5 = await instantiatePlaybook(db, { id, negocioId: biz, parametros: { tema: 'moon water' }, version: v5.version });
  const t5 = await task(r5.tarea);
  const bad = await verifyTask(db, t5, { deliverable: text, report: saveReport(t5, text) });
  assert.equal(bad.ok, false); assert.match(failedChecks(bad), /playbook · imposible/);
});

// ---------- 15 ----------
test('herramientas: registro, ≤ 20 estrictas, entrevista, no duplicar, selección y regla del CEO', async () => {
  const reg = async (n: string) => (await db.query(`SELECT toolsets, agents FROM tool_registry WHERE name = $1`, [n])).rows[0];
  const ver = await reg('ver_playbooks');
  assert.ok(ver.toolsets.includes('texto') && ver.toolsets.includes('voz') && ver.toolsets.includes('ceo')); assert.deepEqual(ver.agents, ['jupiter']);
  assert.ok((await reg('ejecutar_playbook')).toolsets.includes('ceo') && !(await reg('ejecutar_playbook')).toolsets.includes('voz'));
  assert.ok(!(await reg('editar_playbook')).toolsets.includes('voz'));
  assert.ok(toolCount().strict <= 20, JSON.stringify(toolCount()));
  const ejecutar = TOOLS.find((t) => t.name === 'ejecutar_playbook')!, editar = TOOLS.find((t) => t.name === 'editar_playbook')!;
  assert.equal(isStrict('ejecutar_playbook', ejecutar.input_schema), false);
  const ctx = { lastUser: '' };
  const n = (await db.query(`SELECT count(*)::int AS n FROM tasks`)).rows[0].n;
  const r: any = await ejecutar.run(db, { id: 'yt-investigacion-competencia', negocio_id: biz, parametros: {} }, ctx);
  assert.equal(r.faltan[0].clave, 'tema');
  assert.equal((await db.query(`SELECT count(*)::int AS n FROM tasks`)).rows[0].n, n);
  const r2: any = await ejecutar.run(db, { id: 'yt-investigacion-competencia', negocio_id: biz, parametros: '{"tema":"venus hour"}', solo_validar: true }, ctx);
  assert.equal(r2.ok, true, JSON.stringify(r2)); assert.match(r2.vista_previa, /venus hour/);
  const np = (await db.query(`SELECT count(*)::int AS n FROM playbooks`)).rows[0].n;
  const e1: any = await editar.run(db, { accion: 'crear', playbook: { id: 'x' } }, ctx);
  assert.equal(e1.ok, false); assert.ok(e1.errores.length > 0);
  const e2: any = await editar.run(db, { accion: 'crear', playbook: { ...seed('yt-investigacion-competencia'), id: 'yt-competencia-copia', nombre: 'Investigación de competencia (copia)' } }, ctx);
  assert.equal(e2.ok, false); assert.equal(e2.parecido, 'yt-investigacion-competencia');
  assert.equal((await db.query(`SELECT count(*)::int AS n FROM playbooks`)).rows[0].n, np);
  const list = await listPlaybooks(db);
  assert.equal(findPlaybook(list, 'investiga la competencia en YouTube sobre horas planetarias')?.id, 'yt-investigacion-competencia');
  assert.equal(findPlaybook(list, 'pon música lounge'), null);
  const c = await playbookContext(db, 'escribe el guion de una meditación para dormir');
  assert.match(c, /yt-guion-ritual-lunar/); assert.ok(c.length <= 200, String(c.length));
  const { task: open } = await createTask(db, { businessId: biz, ownerFunction: 'mercurio', type: 'agente', title: 'Abierta', objective: 'x', expectedResult: 'x', verification: 'x', createdBy: 'test', idempotencyKey: 'pb-abierta' });
  process.env.KRATOS_TOOLSET = 'ceo';
  try {
    const r3: any = await ejecutar.run(db, { id: 'yt-investigacion-competencia', negocio_id: biz, parametros: { tema: 'saturn hour' } }, ctx);
    assert.match(r3.error, /abierta/);
  } finally { delete process.env.KRATOS_TOOLSET; await db.query(`UPDATE tasks SET status = 'cancelada' WHERE id = $1`, [open.id]); }
});
