import { execFileSync } from 'node:child_process';
import crypto from 'node:crypto';
import type { Db } from '../db.ts';
import { audit } from './state.ts';
import { addAgenda } from './agenda.ts';

// App Store Connect en SOLO LECTURA.
// - La clave (Issuer ID, Key ID y .p8) vive en el Llavero, servicio «kratos-appstore»; nunca en archivos ni registros.
// - El cliente solo hace peticiones GET: aunque la clave tuviera más permisos, KRATOS no puede cambiar nada.

const API = 'https://api.appstoreconnect.apple.com';
const SERVICE = 'kratos-appstore';

// Estados de revisión de Apple en español, y cuáles merecen aviso hablado
const STATES: Record<string, string> = {
  PREPARE_FOR_SUBMISSION: 'en preparación', WAITING_FOR_REVIEW: 'esperando revisión', IN_REVIEW: 'en revisión',
  PENDING_DEVELOPER_RELEASE: 'aprobada, pendiente de que la publiques', PENDING_APPLE_RELEASE: 'aprobada, pendiente de publicación por Apple',
  PROCESSING_FOR_APP_STORE: 'aprobada, procesándose para la App Store', READY_FOR_SALE: 'publicada en la App Store', READY_FOR_DISTRIBUTION: 'publicada en la App Store',
  REJECTED: 'rechazada', METADATA_REJECTED: 'rechazada por la ficha (metadatos)', DEVELOPER_REJECTED: 'retirada de revisión por ti',
  INVALID_BINARY: 'binario no válido', WAITING_FOR_EXPORT_COMPLIANCE: 'esperando cumplimiento de exportación', REMOVED_FROM_SALE: 'retirada de la venta',
  DEVELOPER_REMOVED_FROM_SALE: 'retirada de la venta por ti', REPLACED_WITH_NEW_VERSION: 'sustituida por otra versión', ACCEPTED: 'aceptada', NOT_APPLICABLE: 'no aplica',
};
export const stateEs = (s: string | null) => (s ? STATES[s] ?? s.toLowerCase().replaceAll('_', ' ') : 'desconocido');
const ANNOUNCE = new Set(['IN_REVIEW', 'PENDING_DEVELOPER_RELEASE', 'PENDING_APPLE_RELEASE', 'READY_FOR_SALE', 'READY_FOR_DISTRIBUTION', 'REJECTED', 'METADATA_REJECTED', 'INVALID_BINARY']);

function secret(account: string): string | null {
  try {
    return execFileSync('/usr/bin/security', ['find-generic-password', '-s', SERVICE, '-a', account, '-w'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim() || null;
  } catch { return null; }
}

export function appleCredentials() {
  if (process.env.KRATOS_DISABLE_AI === '1') return null; // pruebas: nunca tocar el Llavero real
  const issuer = secret('issuer'), keyId = secret('keyid'), p8 = secret('p8');
  if (!issuer || !keyId || !p8) return null;
  return { issuer, keyId, pem: Buffer.from(p8, 'base64').toString('utf8') };
}

const b64u = (b: Buffer | string) => Buffer.from(b).toString('base64url');
export function appleJwt(c: { issuer: string; keyId: string; pem: string }, now = Math.floor(Date.now() / 1000)): string {
  const head = b64u(JSON.stringify({ alg: 'ES256', kid: c.keyId, typ: 'JWT' }));
  const body = b64u(JSON.stringify({ iss: c.issuer, iat: now, exp: now + 15 * 60, aud: 'appstoreconnect-v1' }));
  const sig = crypto.sign('sha256', Buffer.from(`${head}.${body}`), { key: c.pem, dsaEncoding: 'ieee-p1363' });
  return `${head}.${body}.${b64u(sig)}`;
}

async function get(token: string, pathAndQuery: string): Promise<any> {
  const r = await fetch(API + pathAndQuery, { method: 'GET', headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(20_000) });
  if (r.status === 401) throw new Error('Apple rechazó la clave (401): revisa Issuer ID, Key ID y el archivo .p8');
  if (r.status === 403) return { forbidden: true };
  if (!r.ok) throw new Error(`App Store Connect respondió ${r.status}`);
  return r.json();
}

// Sincroniza apps, versión más reciente, estado de revisión y reseñas. Si cambia el estado, KRATOS lo anuncia en voz alta.
export async function appleSync(db: Db) {
  const c = appleCredentials();
  if (!c) return { omitido: 'App Store Connect sin conectar' };
  const token = appleJwt(c);
  const apps = await get(token, '/v1/apps?limit=50&fields[apps]=name,bundleId');
  if (apps.forbidden) throw new Error('La clave no tiene permiso para ver las apps');
  const seen: string[] = [], missing = new Set<string>();
  for (const app of apps.data ?? []) {
    const v = await get(token, `/v1/apps/${app.id}/appStoreVersions?limit=1&fields[appStoreVersions]=versionString,appStoreState,platform,createdDate`);
    const ver = v.forbidden ? null : v.data?.[0];
    if (v.forbidden) missing.add('versiones');
    const rv = await get(token, `/v1/apps/${app.id}/customerReviews?limit=5&sort=-createdDate`);
    if (rv.forbidden) missing.add('reseñas');
    const reviews = (rv.data ?? []).map((x: any) => ({ rating: x.attributes.rating, title: x.attributes.title, body: String(x.attributes.body ?? '').slice(0, 400), at: x.attributes.createdDate, territory: x.attributes.territory }));
    const state = ver?.attributes?.appStoreState ?? null;
    const prev = (await db.query(`SELECT state FROM app_store_apps WHERE apple_id = $1`, [app.id])).rows[0];
    await db.query(`INSERT INTO app_store_apps (apple_id, name, bundle_id, platform, version, state, state_since, rating_count, latest_reviews, checked_at)
        VALUES ($1,$2,$3,$4,$5,$6,now(),$7,$8,now())
      ON CONFLICT (apple_id) DO UPDATE SET name = $2, bundle_id = $3, platform = $4, version = $5,
        state_since = CASE WHEN app_store_apps.state IS DISTINCT FROM $6 THEN now() ELSE app_store_apps.state_since END,
        state = $6, rating_count = coalesce($7, app_store_apps.rating_count), latest_reviews = CASE WHEN $9 THEN app_store_apps.latest_reviews ELSE $8 END, checked_at = now()`,
      [app.id, app.attributes.name, app.attributes.bundleId, ver?.attributes?.platform ?? null, ver?.attributes?.versionString ?? null, state,
        rv.meta?.paging?.total ?? null, JSON.stringify(reviews), !!rv.forbidden]);
    if (prev && prev.state !== state && state) {
      await audit(db, 'luna', 'apple.estado_cambiado', { app: app.attributes.name, de: prev.state, a: state });
      if (ANNOUNCE.has(state)) {
        const good = !/REJECT|INVALID/.test(state);
        await addAgenda(db, { at: new Date(), kind: 'aviso', text: `${good ? 'buenas noticias' : 'atención'}: su app ${app.attributes.name}, versión ${ver?.attributes?.versionString ?? ''}, ahora está ${stateEs(state)} en Apple.` }, 'luna (App Store Connect)');
      }
    }
    seen.push(`${app.attributes.name}: ${stateEs(state)}`);
  }
  await db.query(`UPDATE connections SET status = 'conectado', access = 'lectura', last_check = now(), account = $1 WHERE service = 'App Store Connect'`,
    [`Clave ${c.keyId.slice(0, 4)}… (Llavero: ${SERVICE})${missing.size ? ` · sin permiso para: ${[...missing].join(', ')}` : ''}`]);
  return { apps: seen, sinPermiso: [...missing] };
}

export async function appleSummary(db: Db) {
  const rows = (await db.query(`SELECT name, version, platform, state, state_since, rating_count, latest_reviews, checked_at FROM app_store_apps ORDER BY name`)).rows;
  if (!rows.length) return { conectado: !!appleCredentials(), apps: [], nota: appleCredentials() ? 'Conectado; aún sin primera lectura' : 'App Store Connect sin conectar: el propietario debe crear la clave (ver Conexiones)' };
  return { apps: rows.map((r) => ({ ...r, estado: stateEs(r.state) })) };
}
