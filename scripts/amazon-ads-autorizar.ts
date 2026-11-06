// Autorización única de la Amazon Ads API para KRATOS: abre la pantalla de permiso de Amazon, recibe el código en http://localhost:8765/callback
// y lo cambia por un token de actualización que se guarda en el Llavero. Nunca imprime secretos.
// Requiere en el Llavero: kratos-amazon-ads / client_id y kratos-amazon-ads / client_secret.
import http from 'node:http';
import { execFileSync } from 'node:child_process';
const get = (cuenta: string) => { try { return execFileSync('/usr/bin/security', ['find-generic-password', '-s', 'kratos-amazon-ads', '-a', cuenta, '-w'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim(); } catch { return ''; } };
const id = get('client_id'), secreto = get('client_secret');
if (!id || !secreto) { console.error('Faltan client_id o client_secret en el Llavero (servicio kratos-amazon-ads).'); process.exit(1); }
const REDIRECT = 'http://localhost:8765/callback';
const url = `https://www.amazon.com/ap/oa?${new URLSearchParams({ client_id: id, scope: 'advertising::campaign_management', response_type: 'code', redirect_uri: REDIRECT })}`;
const srv = http.createServer(async (q, r) => {
  const u = new URL(q.url!, 'http://localhost:8765');
  if (u.pathname !== '/callback') { r.writeHead(404); return r.end(); }
  const code = u.searchParams.get('code');
  if (!code) { r.writeHead(400, { 'content-type': 'text/plain; charset=utf-8' }); r.end('Amazon no devolvió ningún código.'); return; }
  try {
    const t: any = await (await fetch('https://api.amazon.com/auth/o2/token', { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ grant_type: 'authorization_code', code, redirect_uri: REDIRECT, client_id: id, client_secret: secreto }) })).json();
    if (!t.refresh_token) throw new Error(t.error_description ?? t.error ?? 'sin token');
    execFileSync('/usr/bin/security', ['add-generic-password', '-s', 'kratos-amazon-ads', '-a', 'refresh_token', '-w', t.refresh_token, '-U'], { stdio: 'ignore' });
    r.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }); r.end('<h2>Listo: KRATOS ya tiene acceso a la API de anuncios de Amazon.</h2><p>Puedes cerrar esta pestaña.</p>');
    console.log('Token de actualización guardado en el Llavero.'); srv.close(); setTimeout(() => process.exit(0), 300);
  } catch (e: any) { r.writeHead(500, { 'content-type': 'text/plain; charset=utf-8' }); r.end(`Falló: ${e.message}`); console.error('Falló:', e.message); }
});
srv.listen(8765, '127.0.0.1', () => { console.log('Esperando la autorización en Chrome…'); execFileSync('open', ['-a', 'Google Chrome', url]); });
setTimeout(() => { console.error('Tiempo agotado (5 min).'); process.exit(1); }, 300_000);
