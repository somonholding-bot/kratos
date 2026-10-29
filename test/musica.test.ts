// Música por voz y mensajes de texto recibidos (sin macOS: se prueban la interpretación y el registro).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createPool, type Db } from '../src/db.ts';
import { migrate } from '../src/migrate.ts';
import { musicControl, musicQuery } from '../src/core/music.ts';
import { handleMessage } from '../src/core/chat.ts';
import { attributedText } from '../src/core/imessage.ts';
import { inboxContext, recordIncoming } from '../src/core/inbox.ts';

let db: Db;
before(async () => { db = createPool(); await migrate(db, () => {}); await db.query(`DELETE FROM sms_inbox`); });
after(async () => { await db.end(); });

test('«pon música…» se entiende sin IA', () => {
  assert.equal(musicQuery('pon musica de lounge'), 'lounge music mix');
  assert.equal(musicQuery('ponme musica techno'), 'techno music mix');
  assert.equal(musicQuery('pon opera'), 'opera music mix');
  assert.equal(musicQuery('ponme una cancion de bad bunny'), 'bad bunny');
  assert.equal(musicQuery('pon musica'), 'lounge chill music mix');
  assert.equal(musicQuery('pon una alarma a las 7'), null);
  assert.equal(musicQuery('pon la voz piper'), null);
});

test('control de la música, sin confundirlo con la parada de emergencia', () => {
  assert.equal(musicControl('pausa la musica'), 'pausa');
  assert.equal(musicControl('quita la musica'), 'para');
  assert.equal(musicControl('siguiente cancion'), 'siguiente');
  assert.equal(musicControl('sube el volumen'), 'sube');
  assert.equal(musicControl('reanuda la musica'), 'sigue');
  assert.equal(musicControl('deten todo'), null);
});

test('la orden de música llega a la app como acción', async () => {
  const r = await handleMessage(db, 'Hey Kratos, pon música de lounge', 'voz');
  assert.equal(r.action, 'musica'); assert.equal(r.query, 'lounge music mix');
  const p = await handleMessage(db, 'Kratos, reanuda la música', 'voz');
  assert.equal(p.action, 'musica_control'); assert.equal(p.cmd, 'sigue');
  const stop = await handleMessage(db, 'Kratos, detén todas las acciones', 'voz');
  assert.equal(stop.action, 'emergency_stop');
  await db.query(`UPDATE system_state SET value = 'false' WHERE key = 'emergency_stop'`);
});

test('texto de iMessage guardado como attributedBody', () => {
  const body = Buffer.concat([Buffer.from('\x04\x0bstreamtyped\x81\xe8\x03\x84\x01@\x84\x84\x84\x12NSAttributedString\x00\x84\x84\x08NSObject\x00\x85\x92\x84\x84\x84\x08NSString\x01\x94\x84\x01+', 'latin1'), Buffer.from([12]), Buffer.from('Hola, ¿vienes?', 'utf8').subarray(0, 12)]);
  assert.equal(attributedText(body), Buffer.from('Hola, ¿vienes?', 'utf8').subarray(0, 12).toString('utf8'));
  assert.equal(attributedText(null), null);
});

test('un mensaje recibido se dice con el nombre del contacto y una sola vez', async () => {
  await db.query(`INSERT INTO contacts (name, phone) VALUES ('Juan Prueba', '+18294440077') ON CONFLICT (lower(name)) DO UPDATE SET phone = EXCLUDED.phone`);
  const a = await recordIncoming(db, { rowid: 900001, from: '+1 (829) 444-0077', text: '¿A qué hora llegas?' });
  assert.equal(a.spoken, 'Mensaje de texto de Juan Prueba: ¿A qué hora llegas?');
  assert.equal((await recordIncoming(db, { rowid: 900001, from: '+18294440077', text: '¿A qué hora llegas?' })).spoken, '');
  const b = await recordIncoming(db, { rowid: 900002, from: '+13055550000', text: 'Hola' });
  assert.match(b.spoken, /termina en 0 0 0 0: Hola$/);
  assert.match(await inboxContext(db), /Juan Prueba \(\+1 \(829\) 444-0077\): «¿A qué hora llegas\?»/);
});
