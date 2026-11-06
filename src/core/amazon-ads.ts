import { execFileSync } from 'node:child_process';
import zlib from 'node:zlib';
import type { Db } from '../db.ts';
import { audit } from './state.ts';

// Amazon Ads API (anuncios de los libros del propietario, autor Lyamdi Nomos). SOLO LECTURA por ahora: perfiles, campañas y informes
// (términos de búsqueda, campañas) para aprender qué funcionó en las campañas antiguas. Las credenciales viven en el Llavero
// (kratos-amazon-ads: client_id, client_secret, refresh_token). KRATOS no crea ni modifica anuncios aquí: eso necesitaría aprobación.
const API = 'https://advertising-api.amazon.com';
export type Fetcher = (url: string, init: RequestInit) => Promise<Response>;
const llavero = (cuenta: string) => {
  const e = process.env[`KRATOS_AMZ_${cuenta.toUpperCase()}`]; if (e !== undefined) return e || null;
  try { return execFileSync('/usr/bin/security', ['find-generic-password', '-s', 'kratos-amazon-ads', '-a', cuenta, '-w'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 5000 }).trim() || null; } catch { return null; }
};
let cache: { token: string; hasta: number } | null = null;
async function accesoToken(f: Fetcher) {
  if (cache && Date.now() < cache.hasta) return cache.token;
  const id = llavero('client_id'), sec = llavero('client_secret'), ref = llavero('refresh_token');
  if (!id || !sec || !ref) throw new Error('Amazon Ads no está conectado: faltan credenciales en el Llavero (kratos-amazon-ads)');
  const r = await f('https://api.amazon.com/auth/o2/token', { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: ref, client_id: id, client_secret: sec }) });
  const d: any = await r.json().catch(() => ({}));
  if (!r.ok || !d.access_token) throw new Error(`Amazon rechazó la renovación del acceso: ${d.error_description ?? d.error ?? r.status}`);
  cache = { token: d.access_token, hasta: Date.now() + (Number(d.expires_in ?? 3600) - 120) * 1000 };
  return cache.token;
}
async function llamar(path: string, o: { method?: string; perfil?: string; body?: any; tipo?: string; f?: Fetcher } = {}) {
  const f = o.f ?? fetch; const tk = await accesoToken(f);
  const h: Record<string, string> = { authorization: `Bearer ${tk}`, 'Amazon-Advertising-API-ClientId': llavero('client_id')!, ...(o.perfil ? { 'Amazon-Advertising-API-Scope': o.perfil } : {}) };
  if (o.tipo) { h['content-type'] = o.tipo; h.accept = o.tipo; }
  const r = await f(`${API}${path}`, { method: o.method ?? 'GET', headers: h, body: o.body ? JSON.stringify(o.body) : undefined, signal: AbortSignal.timeout(60_000) });
  const d: any = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`Amazon Ads ${r.status}: ${d?.message ?? d?.details ?? 'error'}`);
  return d;
}

export async function perfiles(f?: Fetcher) {
  const d: any[] = await llamar('/v2/profiles', { f });
  return d.map((p) => ({ perfil: String(p.profileId), pais: p.countryCode, moneda: p.currencyCode, tipo: p.accountInfo?.type, nombre: p.accountInfo?.name, marketplace: p.accountInfo?.marketplaceStringId }));
}
export async function campanas(perfil: string, f?: Fetcher) {
  const d = await llamar('/sp/campaigns/list', { method: 'POST', perfil, body: { maxResults: 100 }, tipo: 'application/vnd.spCampaign.v3+json', f });
  return (d.campaigns ?? []).map((c: any) => ({ id: c.campaignId, nombre: c.name, estado: c.state, presupuesto: c.budget?.budget, inicio: c.startDate, fin: c.endDate ?? null }));
}
// Informe asíncrono (v3): términos de búsqueda o campañas de los últimos 90 días como máximo
export async function informe(perfil: string, tipo: 'terminos' | 'campanas', dias = 90, f?: Fetcher) {
  const fin = new Date(), ini = new Date(Date.now() - Math.min(95, Math.max(1, dias)) * 86_400_000), ymd = (d: Date) => d.toISOString().slice(0, 10);
  const cols = tipo === 'terminos' ? ['searchTerm', 'campaignName', 'impressions', 'clicks', 'cost', 'purchases7d', 'sales7d'] : ['campaignName', 'impressions', 'clicks', 'cost', 'purchases7d', 'sales7d', 'unitsSoldClicks7d'];
  const cfg = { adProduct: 'SPONSORED_PRODUCTS', groupBy: [tipo === 'terminos' ? 'searchTerm' : 'campaign'], columns: cols, reportTypeId: tipo === 'terminos' ? 'spSearchTerm' : 'spCampaigns', timeUnit: 'SUMMARY', format: 'GZIP_JSON' };
  const r = await llamar('/reporting/reports', { method: 'POST', perfil, tipo: 'application/vnd.createasyncreportrequest.v3+json', f, body: { name: `kratos-${tipo}`, startDate: ymd(ini), endDate: ymd(fin), configuration: cfg } });
  for (let i = 0; i < 30; i++) {
    const s = await llamar(`/reporting/reports/${r.reportId}`, { perfil, f });
    if (s.status === 'COMPLETED' && s.url) {
      const gz = Buffer.from(await (await (f ?? fetch)(s.url, { signal: AbortSignal.timeout(60_000) })).arrayBuffer());
      const filas: any[] = JSON.parse(zlib.gunzipSync(gz).toString('utf8'));
      return filas.slice(0, 500).map((x) => ({ ...x, coste: Number(x.cost ?? 0), ventas: Number(x.sales7d ?? 0) }));
    }
    if (s.status === 'FAILURE') throw new Error(`El informe falló: ${s.failureReason ?? ''}`);
    await new Promise((ok) => setTimeout(ok, process.env.KRATOS_AMZ_RAPIDO ? 5 : 4000));
  }
  throw new Error('El informe tarda demasiado: reintenta en unos minutos');
}

export async function resumen(db: Db, perfil: string, f?: Fetcher) {
  const [cs, tr] = [await informe(perfil, 'campanas', 90, f), await informe(perfil, 'terminos', 90, f)];
  const gasto = cs.reduce((s, x) => s + x.coste, 0), ventas = cs.reduce((s, x) => s + x.ventas, 0);
  const buenos = tr.filter((x) => x.ventas > 0).sort((a, b) => b.ventas - a.ventas).slice(0, 15), malos = tr.filter((x) => x.coste >= 1 && x.ventas === 0).sort((a, b) => b.coste - a.coste).slice(0, 15);
  await audit(db, 'amazon_ads', 'amazon_ads.resumen', { perfil, gasto: Math.round(gasto * 100) / 100, ventas: Math.round(ventas * 100) / 100 });
  return { periodo_dias: 90, gasto_total: Math.round(gasto * 100) / 100, ventas_atribuidas: Math.round(ventas * 100) / 100, acos_pct: ventas ? Math.round((gasto / ventas) * 1000) / 10 : null,
    campanas: cs.sort((a, b) => b.ventas - a.ventas).slice(0, 15), terminos_que_vendieron: buenos, terminos_que_gastaron_sin_vender: malos,
    nota: 'Ventas atribuidas a anuncios (7 días): no son tus regalías de KDP. Datos reales de Amazon.' };
}

export const AMAZON_TOOL = {
  description: 'Amazon Ads (anuncios de los libros del propietario, SOLO LECTURA): perfiles (lista las cuentas y países), campanas (perfil: campañas existentes, también las viejas), informe (perfil, tipo terminos|campanas, dias ≤ 95: datos reales de gasto, clics y ventas) y resumen (perfil: lo que funcionó y lo que gastó sin vender en 90 días). '
    + 'Úsalo para aprender de las campañas anteriores del propietario. No crea ni modifica anuncios.',
  input_schema: { type: 'object', properties: { accion: { type: 'string', enum: ['perfiles', 'campanas', 'informe', 'resumen'] }, perfil: { type: 'string' }, tipo: { type: 'string', enum: ['terminos', 'campanas'] }, dias: { type: 'number' } }, required: ['accion'] },
};
export async function herramientaAmazon(db: Db, i: any, _actor: string) {
  if (i.accion === 'perfiles') return await perfiles();
  if (!i.perfil) throw new Error('Falta perfil (usa accion=perfiles para verlos)');
  if (i.accion === 'campanas') return await campanas(String(i.perfil));
  if (i.accion === 'informe') return await informe(String(i.perfil), i.tipo === 'campanas' ? 'campanas' : 'terminos', Number(i.dias ?? 90));
  if (i.accion === 'resumen') return await resumen(db, String(i.perfil));
  return { error: 'Acción no válida' };
}
