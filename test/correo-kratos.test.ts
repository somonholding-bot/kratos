// Correo de KRATOS: envío con reglas anti-spam y bajas, lectura idempotente y códigos de verificación (sin tocar Gmail de verdad).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createPool, type Db } from '../src/db.ts';
import { migrate } from '../src/migrate.ts';
import { enviar, sincronizar, codigo, bandeja } from '../src/core/correo-kratos.ts';

let db: Db; const enviados: any[] = [];
const env = async (m: any) => { enviados.push(m); return { messageId: `<m${enviados.length}@x>` }; };
const llegados = [{ uid: 9001, from: 'Proveedor@Tienda.com', subject: 'Tu código', date: new Date(), text: 'Tu código de verificación es 482913' },
  { uid: 9002, from: 'cliente@ejemplo.com', subject: 'Re: propuesta', date: new Date(), text: 'Por favor, darme de baja de esta lista' }];
const lector = async (desde: number) => llegados.filter((m) => m.uid > desde);
const limpiar = async () => { await db.query(`DELETE FROM correo_kratos`); await db.query(`DELETE FROM correo_bajas`); };
before(async () => { process.env.KRATOS_CORREO_CLAVE = 'falsa'; db = createPool(); await migrate(db, () => {}); await limpiar(); });
after(async () => { await limpiar(); delete process.env.KRATOS_CORREO_CLAVE; await db.end(); });

test('lee la bandeja sin duplicar, registra bajas y encuentra códigos de verificación', async () => {
  assert.equal((await sincronizar(db, lector)).nuevos, 2); assert.equal((await sincronizar(db, lector)).nuevos, 0);
  assert.ok((await db.query(`SELECT 1 FROM correo_bajas WHERE email = 'cliente@ejemplo.com'`)).rows[0]);
  assert.equal((await codigo(db, 'tienda', 15, lector)).codigo, '482913');
  assert.match((await bandeja(db)).aviso, /NO confiable/);
});

test('envía con reglas: válido, sin escribir a quien pidió la baja, pie de baja en contacto comercial y sin insistir', async () => {
  await assert.rejects(enviar(db, { para: 'no-es-correo', asunto: 'Hola', cuerpo: 'un mensaje de prueba' }, 'agente:jupiter', env), /no válida/);
  await assert.rejects(enviar(db, { para: 'cliente@ejemplo.com', asunto: 'Hola', cuerpo: 'otra vez nosotros' }, 'agente:jupiter', env), /no recibir/);
  await enviar(db, { para: 'tienda@nueva.com', asunto: 'Colaboración', cuerpo: 'Queremos proponerte vender nuestras guías.', tipo: 'contacto_comercial' }, 'agente:jupiter', env);
  assert.match(enviados.at(-1).text, /responde «baja»/);
  await assert.rejects(enviar(db, { para: 'tienda@nueva.com', asunto: 'Seguimos', cuerpo: 'Insistimos con la propuesta.', tipo: 'contacto_comercial' }, 'agente:jupiter', env), /no se insiste/);
});
