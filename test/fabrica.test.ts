// Fábrica autónoma de Aion (fabrica_aion): topes de créditos, puerta de calidad y texto público, aplicados en código.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createPool, type Db } from '../src/db.ts';
import { migrate } from '../src/migrate.ts';
import { checkCredits, CREDITOS_MES, MAX_CAIDAS, reconcileProduction, episodeModule, publicTextProblem, startProduction, uploadPrivate } from '../src/core/fabrica.ts';
import { CEO_TOOLS, TOOLS } from '../src/core/brain.ts';

let db: Db;
const ids: number[] = [];
const item = async (tipo: string, estado: string, extra: Record<string, unknown> = {}) => {
  const r = await db.query(`INSERT INTO content_queue (tipo, titulo, estado, guion_ruta, qa) VALUES ($1,'Prueba fábrica',$2,$3,$4) RETURNING id`,
    [tipo, estado, extra.guion ?? 'scripts/media/episodio/ep2.py', JSON.stringify(extra.qa ?? {})]);
  ids.push(r.rows[0].id); return r.rows[0].id as number;
};
before(async () => { db = createPool(); await migrate(db, () => {}); });
after(async () => {
  await db.query(`DELETE FROM content_queue WHERE id = ANY($1)`, [ids]);
  await db.query(`DELETE FROM ai_usage WHERE purpose = 'prueba fábrica'`);
  await db.end();
});

test('el guion solo puede ser un storyboard epN.py del motor', () => {
  assert.equal(episodeModule('scripts/media/episodio/ep2.py'), 'ep2');
  assert.throws(() => episodeModule('../../etc/passwd'));
  assert.throws(() => episodeModule('scripts/media/episodio/ep999.py'), /No existe/);
  assert.throws(() => episodeModule(null));
});

test('topes de créditos de voz por episodio y por mes', async () => {
  await assert.rejects(checkCredits(db, 7000), /tope por episodio/);
  await db.query(`INSERT INTO ai_usage (model, input_tokens, cost_microusd, charged_cents, purpose) VALUES ('elevenlabs:eleven_v4', $1, 0, 0, 'prueba fábrica')`, [CREDITOS_MES]);
  await assert.rejects(checkCredits(db, 5500), /Sin créditos de voz/);
  await db.query(`DELETE FROM ai_usage WHERE purpose = 'prueba fábrica'`);
});

test('no se produce un Short ni algo ya producido o publicado', async () => {
  await assert.rejects(startProduction(db, await item('short', 'IDEA'), 'prueba'), /Shorts/);
  await assert.rejects(startProduction(db, await item('largo', 'PUBLISHED'), 'prueba'), /no se vuelve a producir/);
});

test('sin pasar la puerta de calidad no se sube nada', async () => {
  await assert.rejects(uploadPrivate(db, await item('largo', 'PRODUCTION'), {}, 'prueba'), /puerta de calidad/);
  await assert.rejects(uploadPrivate(db, await item('largo', 'BLOQUEADO', { qa: { duración: { ok: false, detalle: '3 s' } } }), {}, 'prueba'), /duración/);
});

test('lo público va en inglés y sin mencionar apps', () => {
  assert.equal(publicTextProblem('The scientist who dreamed a Nobel Prize', 'A true story.', 'dreams, jung'), null);
  assert.match(publicTextProblem('Made with ElevenLabs and Claude')!, /apps/);
  assert.match(publicTextProblem('El científico que soñó')!, /inglés/);
});

test('fabrica_aion existe para el CEO y no ofrece borrar ni publicar', () => {
  const t = TOOLS.find((x) => x.name === 'fabrica_aion')!;
  assert.ok(t && CEO_TOOLS.includes('fabrica_aion'));
  const acciones = (t.input_schema as any).properties.accion.enum as string[];
  assert.ok(!acciones.some((a) => /borrar|publicar|programar/.test(a)), acciones.join(','));
});

test('vigilante: un render caído se marca y se relanza solo cuando la línea está libre; no toca lo ya producido', async () => {
  const caido = await item('largo', 'PRODUCTION'), listo = await item('largo', 'PRODUCTION');
  await db.query(`UPDATE content_queue SET updated_at = now() - interval '10 minutes' WHERE id = ANY($1)`, [[caido, listo]]);
  await db.query(`UPDATE content_queue SET video_ruta = '/tmp/x.mp4' WHERE id = $1`, [listo]);
  const lanzados: number[] = [];
  const r = await reconcileProduction(db, 'prueba', { vivo: null, launch: async (_d, id) => { lanzados.push(id); return { id }; } });
  assert.ok(r.caidos.includes(caido) && !r.caidos.includes(listo));
  assert.equal((await db.query(`SELECT estado FROM content_queue WHERE id = $1`, [listo])).rows[0].estado, 'PRODUCTION');
  assert.ok(lanzados.includes(caido));
  // con otro render vivo no se relanza nada
  await db.query(`UPDATE content_queue SET estado = 'PRODUCTION', updated_at = now() - interval '10 minutes' WHERE id = $1`, [caido]);
  const antes = lanzados.length;
  await reconcileProduction(db, 'prueba', { vivo: { id: 999999 }, launch: async (_d, id) => { lanzados.push(id); return { id }; } });
  assert.equal(lanzados.length, antes);
});

test('vigilante: tras demasiadas caídas abandona el render y avisa', async () => {
  const id = await item('largo', 'BLOQUEADO');
  await db.query(`UPDATE content_queue SET notas = 'Render caído: prueba' WHERE id = $1`, [id]);
  for (let i = 0; i < MAX_CAIDAS; i++) await db.query(`INSERT INTO audit_log (actor, action, details) VALUES ('prueba', 'fabrica.render_caido', $1)`, [JSON.stringify({ id })]);
  const lanzados: number[] = [];
  await reconcileProduction(db, 'prueba', { vivo: null, launch: async (_d, i) => { lanzados.push(i); return { id: i }; } });
  assert.ok(!lanzados.includes(id));
  assert.match((await db.query(`SELECT notas FROM content_queue WHERE id = $1`, [id])).rows[0].notas, /abandonado/);
  await db.query(`DELETE FROM agenda WHERE created_by = 'prueba'`);
});
