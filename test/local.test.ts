// IA local (Ollama simulado): lo sencillo por voz se responde en local; lo que necesita datos o acciones va a Claude.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';

const replies: string[] = [];
const ollama = http.createServer((req, res) => {
  if (req.url === '/api/tags') return res.end(JSON.stringify({ models: [{ name: 'prueba:1b' }] }));
  let body = ''; req.on('data', (c) => (body += c)); req.on('end', () => {
    const text = replies.shift() ?? 'Hola.';
    res.writeHead(200, { 'content-type': 'application/x-ndjson' });
    for (const part of text.match(/.{1,5}/gs) ?? []) res.write(JSON.stringify({ message: { content: part }, done: false }) + '\n');
    res.end(JSON.stringify({ message: { content: '' }, done: true }) + '\n');
  });
});
await new Promise<void>((r) => ollama.listen(11499, '127.0.0.1', r));
process.env.KRATOS_OLLAMA = 'http://127.0.0.1:11499';
process.env.KRATOS_LOCAL_MODEL = 'prueba:1b';

const { createPool } = await import('../src/db.ts');
const { migrate } = await import('../src/migrate.ts');
const { handleMessage } = await import('../src/core/chat.ts');
const { routeLocal } = await import('../src/core/local.ts');
let db: any;
before(async () => { db = createPool(); await migrate(db, () => {}); });
after(async () => { await db.end(); ollama.close(); });

test('reparto: charla y cultura general en local; datos y acciones con Claude', async () => {
  assert.equal(await routeLocal(db, 'voz', 'Kratos, cuéntame un chiste'), true);
  assert.equal(await routeLocal(db, 'voz', '¿por qué el cielo es azul?'), true);
  assert.equal(await routeLocal(db, 'voz', 'mándale un mensaje a Juan'), false);
  assert.equal(await routeLocal(db, 'voz', '¿cómo van mis negocios?'), false);
  assert.equal(await routeLocal(db, 'voz', 'Kratos, ponme a Romeo Santos'), false);   // música: la pone Claude, Groq no puede
  assert.equal(await routeLocal(db, 'voz', 'quiero oír una canción de Juan Luis Guerra'), false);
  assert.equal(await routeLocal(db, 'voz', 'busca el precio del bitcoin'), false);
  assert.equal(await routeLocal(db, 'texto', 'cuéntame un chiste'), true);
  // preguntas sobre el propio KRATOS y charla con palabras comunes: cerebro rápido
  assert.equal(await routeLocal(db, 'voz', '¿estás usando la IA nueva?'), true);
  assert.equal(await routeLocal(db, 'voz', '¿qué voz tienes?'), true);
  assert.equal(await routeLocal(db, 'voz', 'dime un número del uno al diez'), true);
  // lo que actúa o usa datos: Claude
  assert.equal(await routeLocal(db, 'voz', '¿qué tengo pendiente?'), false);
  assert.equal(await routeLocal(db, 'voz', 'crea una tarea para Marte'), false);
  assert.equal(await routeLocal(db, 'voz', '¿qué noticias hay hoy?'), false);   // también por escrito
});

test('la respuesta local llega frase a frase', async () => {
  replies.push('¿Por qué los pájaros no usan Facebook? Porque ya tienen Twitter.\nDetalle para la pantalla.');
  const said: string[] = [];
  const r = await handleMessage(db, 'Hey Kratos, cuéntame un chiste', 'voz', (s) => said.push(s));
  assert.deepEqual(said, ['¿Por qué los pájaros no usan Facebook?', 'Porque ya tienen Twitter.']);
  assert.match(r.text, /Twitter/);
});

test('si el modelo local no sabe, no dice nada y pasa a Claude', async () => {
  replies.push('[CLAUDE]');
  const said: string[] = [];
  const r = await handleMessage(db, 'Kratos, explícame la teoría de cuerdas', 'voz', (s) => said.push(s));
  assert.ok(!said.some((s) => s.includes('CLAUDE')));
  assert.match(r.text, /IA sin conectar/);   // en pruebas Claude no tiene clave: respuesta de demostración
});

test('se puede apagar el cerebro local', async () => {
  await db.query(`INSERT INTO system_state (key, value, updated_by) VALUES ('cerebro_local', '"apagado"', 'test') ON CONFLICT (key) DO UPDATE SET value = '"apagado"'`);
  assert.equal(await routeLocal(db, 'voz', 'cuéntame un chiste'), false);
  await db.query(`UPDATE system_state SET value = '"auto"' WHERE key = 'cerebro_local'`);
});
