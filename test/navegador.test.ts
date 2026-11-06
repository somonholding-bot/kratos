// Navegador de KRATOS: formularios con marcadores, contraseñas únicas por sitio, y sus límites (captcha, pagos, tarjetas, redes privadas).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createPool, type Db } from '../src/db.ts';
import { migrate } from '../src/migrate.ts';
import { cerrar, herramientaNavegador as nav, urlSegura, valorProhibido, leerSecreto } from '../src/core/navegador.ts';

let db: Db, srv: http.Server, base = ''; const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'kratos-nav-'));
const paginas: Record<string, string> = {
  '/registro': '<h1>Crear cuenta gratis</h1><form><label for=e>Correo</label><input id=e name=email type=email><label for=p>Contraseña</label><input id=p name=password type=password><label for=t>Tarjeta</label><input id=t name=cardnumber><button type=button onclick="document.title=\'hecho:\'+e.value">Crear cuenta</button><button type=button>Buy now</button></form>',
  '/captcha': '<h1>Entrar</h1><div class="g-recaptcha" data-sitekey="x"></div><input name=email>',
};
before(async () => {
  process.env.KRATOS_NAV_PERFIL = path.join(tmp, 'perfil'); process.env.KRATOS_NAV_SIN_LLAVERO = '1'; process.env.KRATOS_NAV_PERMITIR_LOCAL = '1';
  srv = http.createServer((q, r) => { r.setHeader('content-type', 'text/html; charset=utf-8'); r.end(paginas[q.url!.split('?')[0]] ?? '<p>x</p>'); }); await new Promise<void>((ok) => srv.listen(0, '127.0.0.1', ok));
  base = `http://127.0.0.1:${(srv.address() as any).port}`; db = createPool(); await migrate(db, () => {});
});
after(async () => { await cerrar(); srv.close(); await db.end(); fs.rmSync(tmp, { recursive: true, force: true }); delete process.env.KRATOS_NAV_PERMITIR_LOCAL; });

test('seguridad de URL y de datos: solo https público; nada de tarjetas ni correos del propietario', async () => {
  delete process.env.KRATOS_NAV_PERMITIR_LOCAL;
  await assert.rejects(urlSegura('http://ejemplo.com'), /https/); await assert.rejects(urlSegura('https://127.0.0.1/x'), /público/); await assert.rejects(urlSegura('https://192.168.1.1'), /público/); await assert.rejects(urlSegura('https://169.254.169.254/'), /público/);
  process.env.KRATOS_NAV_PERMITIR_LOCAL = '1';
  assert.match(valorProhibido('4242 4242 4242 4242')!, /tarjeta/); assert.match(valorProhibido('somonholding@gmail.com')!, /propietario/); assert.equal(valorProhibido('Hola'), null);
});

test('rellena el formulario con {{correo}} y {{contraseña}} (única, en el llavero) y pulsa el botón', { timeout: 120_000 }, async () => {
  const a: any = await nav(db, { accion: 'abrir', url: `${base}/registro` }, 'agente:jupiter');
  assert.equal(a.captcha, false); assert.ok(a.elementos.some((e: any) => e.etiqueta.includes('Correo')));
  const r: any = await nav(db, { accion: 'rellenar', campos: { Correo: '{{correo}}', 'Contraseña': '{{contraseña}}' } }, 'agente:jupiter');
  assert.equal(r.ok, true, JSON.stringify(r));
  const clave = leerSecreto('127.0.0.1'); assert.ok(clave && clave.length > 20);
  assert.doesNotMatch(JSON.stringify(r), new RegExp(clave.slice(0, 12).replace(/[-_]/g, '.')));   // el modelo nunca ve la contraseña
  const p: any = await nav(db, { accion: 'pulsar', texto: 'Crear cuenta' }, 'agente:jupiter');
  assert.equal(p.ok, true); assert.match(p.titulo, /hecho:streetlumos@gmail\.com/);
});

test('se niega a escribir tarjetas, a poner contraseñas en claro, a pulsar pagos y a seguir ante un captcha', { timeout: 120_000 }, async () => {
  await nav(db, { accion: 'abrir', url: `${base}/registro` }, 'agente:jupiter');
  assert.match((await nav(db, { accion: 'rellenar', campos: { Tarjeta: '4242 4242 4242 4242' } }, 'x') as any).mensaje, /tarjeta/);
  assert.match((await nav(db, { accion: 'rellenar', campos: { 'Contraseña': 'abc123' } }, 'x') as any).mensaje, /\{\{contraseña\}\}/);
  assert.match((await nav(db, { accion: 'rellenar', campos: { cardnumber: '1234' } }, 'x') as any).mensaje, /pago o de identidad/);
  assert.match((await nav(db, { accion: 'pulsar', texto: 'Buy now' }, 'x') as any).mensaje, /pago|suscripción/);
  await nav(db, { accion: 'abrir', url: `${base}/captcha` }, 'x');
  const c: any = await nav(db, { accion: 'rellenar', campos: { email: '{{correo}}' } }, 'x'); assert.equal(c.captcha, true);
});
