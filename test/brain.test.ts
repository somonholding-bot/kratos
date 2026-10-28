// Inteligencia (sin llamar a la API real: KRATOS_DISABLE_AI=1 en las pruebas).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createPool, type Db } from '../src/db.ts';
import { migrate } from '../src/migrate.ts';
import { aiStatus, costMicroUsd, think } from '../src/core/brain.ts';
import { handleMessage } from '../src/core/chat.ts';

let db: Db;
before(async () => { db = createPool(); await migrate(db, () => {}); });
after(async () => { await db.end(); });

test('coste por llamada según la tarifa oficial', () => {
  // 10.000 de entrada + 500 de salida en Opus 5.5: 10.000×4 + 500×20 = 50.000 µUSD = 0,05 USD
  assert.equal(costMicroUsd('claude-opus-5-5', { input_tokens: 10_000, output_tokens: 500 }), 50_000);
  assert.equal(costMicroUsd('claude-haiku-5-5', { input_tokens: 10_000, output_tokens: 500, cache_read_input_tokens: 5_000 }), 1_000 + 250 + 50);
});

test('sin clave la IA no se usa y Kratos lo dice', async () => {
  const r = await think(db, 'texto');
  assert.deepEqual(r, { unavailable: 'sin_clave' });
  const reply = await handleMessage(db, 'Hey Kratos, ¿qué tengo pendiente?');
  assert.match(reply.text, /IA sin conectar/);
  assert.equal((await aiStatus(db)).active, false);
});

test('la propuesta de presupuesto para la IA existe pero no tiene efecto hasta aprobarla', async () => {
  const a = (await db.query(`SELECT status, max_amount_cents FROM approvals WHERE account_label = 'Operación: API de Claude'`)).rows[0];
  assert.equal(a.status, 'pendiente'); assert.equal(Number(a.max_amount_cents), 1000);
  const s = await aiStatus(db);
  assert.equal(s.availableCents, 0);
});

test('siete especialistas planetarios más el coordinador', async () => {
  const ids = (await db.query(`SELECT id FROM agent_functions ORDER BY id`)).rows.map((r) => r.id);
  assert.deepEqual(ids, ['jupiter', 'kratos', 'luna', 'marte', 'mercurio', 'saturno', 'sol', 'venus']);
});
