// Autoriza a KRATOS a gestionar tu canal de YouTube (una sola vez): leer, subir vídeos como privados y editarlos. Uso: node scripts/conectar-youtube.ts
// Abre la ventana de Google en el navegador; al aceptar, el permiso se guarda en el Llavero («kratos-google»).
// Flujo oficial de Google para apps de escritorio: redirección a 127.0.0.1 y PKCE.
import http from 'node:http';
import crypto from 'node:crypto';
import { execFile } from 'node:child_process';
import { SCOPES, saveSecret, secret, youtubeSummary } from '../src/core/youtube.ts';

const id = secret('client_id'), sec = secret('client_secret');
if (!id || !sec) { console.error('Falta la credencial de Google en el Llavero (kratos-google).'); process.exit(1); }
const verifier = crypto.randomBytes(48).toString('base64url');
const challenge = crypto.createHash('sha256').update(verifier).digest('base64url');
const state = crypto.randomBytes(16).toString('hex');

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', 'http://127.0.0.1');
  if (url.pathname !== '/') { res.writeHead(404); return res.end(); }
  const page = (msg: string) => { res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }); res.end(`<body style="font:18px system-ui;background:#05080d;color:#cfe8ff;padding:40px">${msg}</body>`); };
  if (url.searchParams.get('state') !== state) return page('Respuesta no válida. Vuelve a intentarlo.');
  const code = url.searchParams.get('code');
  if (!code) { page(`Google no dio permiso: ${url.searchParams.get('error') ?? 'cancelado'}.`); server.close(); return; }
  const port = (server.address() as any).port;
  const r = await fetch('https://oauth2.googleapis.com/token', { method: 'POST',
    body: new URLSearchParams({ client_id: id, client_secret: sec, code, code_verifier: verifier, grant_type: 'authorization_code', redirect_uri: `http://127.0.0.1:${port}` }) });
  const j: any = await r.json();
  if (!r.ok || !j.refresh_token) { page(`No se pudo completar (${j.error ?? r.status}). Vuelve a intentarlo.`); console.error('Error:', j.error, j.error_description); server.close(); return; }
  saveSecret('refresh_token', j.refresh_token);
  page('✅ KRATOS ya tiene acceso a tu canal de YouTube. Puedes cerrar esta pestaña.');
  server.close();
  try {
    const s: any = await youtubeSummary();
    console.log(`Conectado: ${s.canal?.nombre ?? '(sin canal)'} · ${s.canal?.suscriptores ?? 0} suscriptores · ${s.canal?.videos ?? 0} vídeos`);
  } catch (e: any) { console.log('Permiso guardado, pero la primera lectura falló:', e.message); }
});

server.listen(0, '127.0.0.1', () => {
  const port = (server.address() as any).port;
  const auth = new URL('https://accounts.google.com/o/oauth2/v2/auth');
  for (const [k, v] of Object.entries({ client_id: id, redirect_uri: `http://127.0.0.1:${port}`, response_type: 'code', scope: SCOPES.join(' '),
    access_type: 'offline', prompt: 'consent', code_challenge: challenge, code_challenge_method: 'S256', state })) auth.searchParams.set(k, v);
  console.log('Abriendo Google en el navegador para autorizar a KRATOS en tu canal de YouTube…');
  execFile('/usr/bin/open', [auth.toString()]);
});
setTimeout(() => { console.log('Tiempo agotado (10 min) sin respuesta de Google.'); process.exit(1); }, 600_000).unref();
