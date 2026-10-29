// Agenda, alarmas habladas, saludo del propietario y firma de App Store Connect.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { createPool, type Db } from '../src/db.ts';
import { config } from '../src/config.ts';
import { migrate } from '../src/migrate.ts';
import { claimDue, greeting, parseAgenda, upcoming } from '../src/core/agenda.ts';
import { handleMessage } from '../src/core/chat.ts';
import { appleJwt } from '../src/core/apple.ts';

assert.equal(config.db.database, 'jarvis_test');
let db: Db;
before(async () => { db = createPool(); await migrate(db, () => {}); await db.query(`DELETE FROM agenda`); });
after(async () => { await db.end(); });

test('interpreta alarmas y recordatorios en español', () => {
  const now = new Date(2026, 9, 28, 22, 0);
  const a = parseAgenda('Hey Kratos, despiértame a las 8 de la mañana', now)!;
  assert.equal(a.kind, 'alarma'); assert.equal(a.at.getDate(), 29); assert.equal(a.at.getHours(), 8);
  const r = parseAgenda('recuérdame a las 3 y media de la tarde llamar a Ana', now)!;
  assert.equal(r.at.getHours(), 15); assert.equal(r.at.getMinutes(), 30); assert.equal(r.text, 'llamar a Ana');
  assert.equal(parseAgenda('alarma todos los días a las 7:30', now)!.repeat, 'diaria');
  assert.equal(parseAgenda('¿qué tal?', now), null);
});

test('saluda al propietario por su nombre', async () => {
  assert.match(await greeting(db), /[Ss]eñor Idalmi/);
});

test('una alarma por voz se programa y se entrega una sola vez, hablada', async () => {
  const r = await handleMessage(db, 'Kratos, despiértame en 1 minuto', 'voz');
  assert.equal(r.action, 'agenda_creada');
  assert.match(r.spoken, /señor Idalmi/);
  assert.equal((await upcoming(db)).length, 1);
  await db.query(`UPDATE agenda SET at = now() - interval '1 second'`);
  const due = await claimDue(db);
  assert.equal(due.length, 1);
  assert.match(due[0].spoken, /Buen[oa]s .*señor Idalmi\. Son las/);
  assert.equal((await claimDue(db)).length, 0, 'no se repite');
});

test('las alarmas diarias se reprograman al día siguiente', async () => {
  await db.query(`DELETE FROM agenda`);
  await handleMessage(db, 'pon una alarma todos los días a las 7', 'voz');
  await db.query(`UPDATE agenda SET at = now() - interval '1 second'`);
  await claimDue(db);
  const next = await upcoming(db, 48);
  assert.equal(next.length, 1); assert.equal(next[0].repeat, 'diaria');
  assert.ok(+new Date(next[0].at) > Date.now());
  const c = await handleMessage(db, 'cancela la alarma', 'voz');
  assert.match(c.text, /Cancelado/);
});

test('el token de App Store Connect es ES256 válido y de corta duración', () => {
  const { privateKey, publicKey } = crypto.generateKeyPairSync('ec', { namedCurve: 'P-256' });
  const pem = privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
  const jwt = appleJwt({ issuer: '00000000-0000-0000-0000-000000000000', keyId: 'ABC123DEFG', pem }, 1_000);
  const [h, b, s] = jwt.split('.');
  assert.deepEqual(JSON.parse(Buffer.from(h, 'base64url').toString()), { alg: 'ES256', kid: 'ABC123DEFG', typ: 'JWT' });
  const body = JSON.parse(Buffer.from(b, 'base64url').toString());
  assert.equal(body.aud, 'appstoreconnect-v1'); assert.ok(body.exp - body.iat <= 20 * 60);
  assert.ok(crypto.verify('sha256', Buffer.from(`${h}.${b}`), { key: publicKey, dsaEncoding: 'ieee-p1363' }, Buffer.from(s, 'base64url')));
});

test('llamadas: guarda el contacto y marca solo por orden del propietario', async () => {
  const { handleMessage: h } = await import('../src/core/chat.ts');
  const s = await h(db, 'Kratos, guarda el número de Ana: +1 809 555 1234', 'voz');
  assert.match(s.text, /Ana · \+18095551234/);
  const c = await h(db, 'Kratos, llama a Ana', 'voz');
  assert.equal(c.action, 'llamada'); assert.match(c.spoken, /Llamando a Ana/);
  const n = await h(db, 'llama a Pedro', 'voz');
  assert.match(n.text, /No tengo el número/);
});

test('«dame un reporte» devuelve dinero invertido y ganado sin inventar cifras', async () => {
  const { handleMessage: h } = await import('../src/core/chat.ts');
  const r = await h(db, 'Kratos, dame un reporte', 'voz');
  assert.equal(r.action, 'reporte');
  assert.match(r.text, /Invertido: .* USD/); assert.match(r.text, /Ingresos: sin ventas registradas/);
  assert.match(r.spoken, /Su reporte, señor Idalmi/);
});

test('mensajes de texto: borrador para un contacto guardado', async () => {
  const { handleMessage: h } = await import('../src/core/chat.ts');
  const r = await h(db, 'Kratos, mándale un mensaje a Ana diciendo que llego en diez minutos', 'voz');
  assert.equal(r.action, 'mensaje'); assert.match(r.text, /llego en diez minutos/);
});
