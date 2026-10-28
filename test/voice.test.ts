// Pruebas de la Etapa C (voz). Usan audio sintetizado con las voces en español de macOS.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createPool, type Db } from '../src/db.ts';
import { DATA_DIR, config } from '../src/config.ts';
import { migrate } from '../src/migrate.ts';
import { analyzeWav, cleanTranscript, transcribe } from '../src/voice.ts';
import { handleMessage } from '../src/core/chat.ts';
import { getState, resumeFromEmergency } from '../src/core/state.ts';
import { createServer } from '../src/server.ts';
import { sessionToken } from '../src/auth.ts';

assert.equal(config.db.database, 'jarvis_test');
let db: Db;
const work = fs.mkdtempSync(path.join(os.tmpdir(), 'kratos-voz-'));

function speech(text: string, voice = 'Paulina'): Buffer {
  const f = path.join(work, `${Math.random().toString(36).slice(2)}.wav`);
  execFileSync('say', ['-v', voice, '--data-format=LEI16@16000', '-o', f, text]);
  return fs.readFileSync(f);
}
function pcmWav(samples: Float32Array): Buffer {
  const b = Buffer.alloc(44 + samples.length * 2);
  b.write('RIFF', 0); b.writeUInt32LE(36 + samples.length * 2, 4); b.write('WAVE', 8); b.write('fmt ', 12);
  b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22); b.writeUInt32LE(16000, 24);
  b.writeUInt32LE(32000, 28); b.writeUInt16LE(2, 32); b.writeUInt16LE(16, 34); b.write('data', 36); b.writeUInt32LE(samples.length * 2, 40);
  samples.forEach((s, i) => b.writeInt16LE(Math.round(Math.max(-1, Math.min(1, s)) * 32767), 44 + i * 2));
  return b;
}
const norm = (s: string) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9 ]/g, '');

before(async () => { db = createPool(); await migrate(db, () => {}); });
after(async () => { await db.end(); fs.rmSync(work, { recursive: true, force: true }); });

const PHRASES = [
  ['Kratos, ¿cómo van mis negocios?', ['como van mis negocios']],
  ['Muéstrame qué hiciste hoy y cuánto costó.', ['que hiciste', 'costo']],
  ['Crea una tarea: revisar la ficha de la aplicación en la tienda.', ['crea una tarea', 'ficha']],
  ['Detén todas las acciones.', ['deten todas las acciones']],
] as const;

for (const [phrase, expected] of PHRASES) {
  test(`transcribe en español: «${phrase}»`, async () => {
    const r = await transcribe(db, speech(phrase));
    assert.equal(r.ok, true, r.message);
    for (const e of expected) assert.ok(norm(r.text).includes(e), `«${r.text}» no contiene «${e}»`);
    assert.ok(r.sttMs < 5000, `latencia ${r.sttMs} ms`);
    console.log(`  · ${r.audioMs} ms de audio → ${r.sttMs} ms de transcripción: «${r.text}»`);
  });
}

test('acento de España (voz Mónica) también se entiende', async () => {
  const r = await transcribe(db, speech('Tenemos una nueva aplicación, prepara su lanzamiento.', 'Mónica'));
  assert.ok(norm(r.text).includes('nueva aplicacion'), r.text);
});

test('silencio: no se transcribe ni se llama a whisper', async () => {
  const r = await transcribe(db, pcmWav(new Float32Array(16000 * 2)));
  assert.equal(r.outcome, 'silencio');
});

test('pulsación demasiado corta se descarta', async () => {
  const r = await transcribe(db, pcmWav(new Float32Array(16000 * 0.2).fill(0.2)));
  assert.equal(r.outcome, 'muy_corto');
});

test('ruido sin voz no produce una orden', async () => {
  let seed = 7; const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647) * 2 - 1;
  const r = await transcribe(db, pcmWav(Float32Array.from({ length: 16000 * 3 }, () => rnd() * 0.15)));
  assert.equal(r.ok, false, `transcribió «${r.text}»`);
});

test('alucinaciones típicas de Whisper se filtran', () => {
  for (const s of ['[Música]', '(aplausos)', 'Subtítulos realizados por la comunidad de Amara.org', '¡Gracias por ver el video!']) assert.equal(cleanTranscript(s), '');
  assert.equal(cleanTranscript('  detén   todo '), 'detén todo');
  assert.equal(cleanTranscript(' y.'), '');
});

test('formato inválido se rechaza', () => {
  assert.throws(() => analyzeWav(Buffer.from('no es audio')));
});

test('no quedan grabaciones en disco tras transcribir', async () => {
  await transcribe(db, speech('Prueba de privacidad.'));
  const tmp = path.join(DATA_DIR, 'tmp-jarvis_test');
  assert.equal(fs.existsSync(tmp) ? fs.readdirSync(tmp).length : 0, 0);
});

test('cancelar una transcripción en curso', async () => {
  const ac = new AbortController();
  const p = transcribe(db, speech('Esta solicitud se va a cancelar enseguida, antes de terminar.'), ac.signal);
  setTimeout(() => ac.abort(), 50);
  const r = await p;
  assert.equal(r.outcome, 'cancelado');
});

test('voz y texto comparten contexto; la voz no autoriza aprobaciones', async () => {
  const r = await handleMessage(db, 'Kratos, apruebo el pago de 200 dólares', 'voz');
  assert.match(r.text, /No acepto aprobaciones/);
  const msgs = (await db.query(`SELECT channel FROM messages ORDER BY id DESC LIMIT 2`)).rows.map((m) => m.channel);
  assert.deepEqual(msgs, ['voz', 'voz']);
  const stop = await handleMessage(db, 'Kratos, detén todas las acciones', 'voz');
  assert.equal(stop.action, 'emergency_stop');
  assert.equal((await getState(db)).emergency_stop, true);
  await resumeFromEmergency(db, 'test');
});

test('endpoint de voz: exige sesión y audio/wav', async () => {
  const server = createServer(db);
  await new Promise<void>((r) => server.listen(config.port, config.host, () => r()));
  const url = `http://${config.host}:${config.port}/api/voice/transcribe`;
  const cookie = `jarvis=${sessionToken()}`;
  try {
    assert.equal((await fetch(url, { method: 'POST', headers: { 'content-type': 'audio/wav' }, body: speech('hola') })).status, 401);
    assert.equal((await fetch(url, { method: 'POST', headers: { cookie, 'content-type': 'application/json' }, body: '{}' })).status, 415);
    const ok = await fetch(url, { method: 'POST', headers: { cookie, 'content-type': 'audio/wav' }, body: speech('¿Cómo van mis negocios?') });
    const data = await ok.json();
    assert.equal(data.ok, true);
    assert.ok(typeof data.metricId === 'number');
  } finally { server.close(); }
});

test('frases de activación: «Kratos, Kratos» y «Hey Kratos»; una sola mención no basta', async () => {
  const { detectWake } = await import('../src/voice.ts');
  assert.deepEqual(detectWake('Kratos, Kratos, ¿cómo van mis negocios?'), { wake: true, mentions: 2, hey: false, command: '¿cómo van mis negocios?' });
  assert.equal(detectWake('Hey Kratos, detén todas las acciones.').command, 'detén todas las acciones.');
  for (const v of ['KRATOS KRATOS', 'kratos... kratos', 'Hey, Kratos.', 'Ey Cratos', 'Oye Gratos, organiza mi día']) assert.equal(detectWake(v).wake, true, v);
  for (const v of ['Kratos, ¿cómo van?', 'Gratos.']) { const d = detectWake(v); assert.equal(d.wake, false, v); assert.equal(d.mentions, 1, v); }
  for (const v of ['Es gratis el envío', 'Hey, ¿cómo estás?', 'Ese juego de dioses griegos', 'Cristo vive', 'le dije a mi primo que Kratos es bueno']) assert.equal(detectWake(v).wake, false, v);
});

test('activación con audio: ambas frases despiertan; conversación normal no', async () => {
  const { transcribeWake } = await import('../src/voice.ts');
  const results: string[] = [];
  for (const [phrase, voice] of [['Kratos, Kratos, ¿cómo van mis negocios?', 'Paulina'], ['Hey Kratos, ¿qué tengo pendiente hoy?', 'Paulina'], ['Kratos, Kratos.', 'Mónica'], ['Hey Kratos.', 'Eddy']] as const) {
    const r = await transcribeWake(db, speech(phrase, voice));
    results.push(`${voice} «${phrase}» → wake=${r.wake} menciones=${r.mentions} «${r.command}» ${r.sttMs} ms`);
    assert.equal(r.wake, true, `no despertó con «${phrase}» (${voice}): ${JSON.stringify(r)}`);
  }
  const single = await transcribeWake(db, speech('Kratos, ¿cómo van mis negocios?'));
  assert.equal(single.wake, false); assert.equal(single.mentions, 1);
  for (const phrase of ['Mañana voy al supermercado con mi hermana.', 'Ese juego de dioses griegos es muy bueno.', 'Hey, ¿me pasas la sal por favor?']) {
    const miss = await transcribeWake(db, speech(phrase));
    assert.equal(miss.wake, false, `se activó con «${phrase}»`);
  }
  console.log(results.map((r) => '  · ' + r).join('\n'));
});
