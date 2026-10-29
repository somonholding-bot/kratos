// Cerebro rápido: Groq primero; si se pasa del límite, responde Ollama; el razonamiento interno no se dice.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';

let groqMode: 'ok' | 'limit' | 'think' = 'ok';
const sse = (res: http.ServerResponse, text: string) => {
  res.writeHead(200, { 'content-type': 'text/event-stream' });
  for (const part of text.match(/.{1,4}/gs) ?? []) res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: part } }] })}\n\n`);
  res.end('data: [DONE]\n\n');
};
const groq = http.createServer((req, res) => {
  if (req.headers.authorization !== 'Bearer gsk_prueba') { res.writeHead(401); return res.end(); }
  if (req.url === '/openai/v1/models') return res.end(JSON.stringify({ data: [{ id: 'llama-3.1-8b-instant' }, { id: 'llama-3.3-70b-versatile' }] }));
  let body = ''; req.on('data', (c) => (body += c)); req.on('end', () => {
    assert.equal(JSON.parse(body).model, 'llama-3.3-70b-versatile');   // el preferido de los publicados
    if (groqMode === 'limit') { res.writeHead(429, { 'retry-after': '30' }); return res.end('{}'); }
    sse(res, groqMode === 'think' ? '<think>pienso en voz baja</think>Respuesta limpia.' : 'Desde Groq, al instante.');
  });
});
const ollama = http.createServer((req, res) => {
  if (req.url === '/api/tags') return res.end(JSON.stringify({ models: [{ name: 'prueba:1b' }] }));
  req.resume(); req.on('end', () => res.end(JSON.stringify({ message: { content: 'Desde el Mac.' }, done: true }) + '\n'));
});
await new Promise<void>((r) => groq.listen(11498, '127.0.0.1', r));
await new Promise<void>((r) => ollama.listen(11497, '127.0.0.1', r));
process.env.KRATOS_GROQ_URL = 'http://127.0.0.1:11498/openai/v1';
process.env.KRATOS_GROQ_KEY = 'gsk_prueba';
process.env.KRATOS_OLLAMA = 'http://127.0.0.1:11497';
process.env.KRATOS_LOCAL_MODEL = 'prueba:1b';

const { createPool } = await import('../src/db.ts');
const { migrate } = await import('../src/migrate.ts');
const { localThink } = await import('../src/core/local.ts');
let db: any;
before(async () => { db = createPool(); await migrate(db, () => {}); });
after(async () => { await db.end(); groq.close(); ollama.close(); });

test('Groq responde primero, en streaming', async () => {
  let said = '';
  const r: any = await localThink(db, (d) => (said += d));
  assert.equal(r.text, 'Desde Groq, al instante.'); assert.equal(said, r.text);
  assert.equal(r.model, 'groq:llama-3.3-70b-versatile');
});

test('el razonamiento interno (<think>) no se dice', async () => {
  groqMode = 'think';
  let said = '';
  const r: any = await localThink(db, (d) => (said += d));
  assert.equal(said, 'Respuesta limpia.'); assert.equal(r.text, 'Respuesta limpia.');
});

test('con el límite gratis de Groq alcanzado, responde el modelo del Mac', async () => {
  groqMode = 'limit';
  const r: any = await localThink(db, () => {});
  assert.equal(r.text, 'Desde el Mac.'); assert.equal(r.model, 'local:prueba:1b');
  const again: any = await localThink(db, () => {});   // sigue en pausa: no vuelve a intentar Groq
  assert.equal(again.model, 'local:prueba:1b');
});
