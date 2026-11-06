// Amazon Ads (simulado, solo lectura): renueva el acceso, lista perfiles y campañas y resume informes sin inventar nada.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import zlib from 'node:zlib';
import { createPool, type Db } from '../src/db.ts';
import { migrate } from '../src/migrate.ts';
import { perfiles, campanas, resumen, type Fetcher } from '../src/core/amazon-ads.ts';

let db: Db;
const filasC = [{ campaignName: 'Libro A', cost: '12.5', sales7d: '50' }, { campaignName: 'Libro B', cost: '5', sales7d: '0' }];
const filasT = [{ searchTerm: 'masonic symbols', cost: '2', sales7d: '30' }, { searchTerm: 'free book', cost: '4', sales7d: '0' }];
const falso: Fetcher = async (url, init) => {
  const u = String(url), j = (o: any) => new Response(JSON.stringify(o));
  if (u.includes('api.amazon.com/auth/o2/token')) return j({ access_token: 'tk', expires_in: 3600 });
  if (u.endsWith('/v2/profiles')) return j([{ profileId: 1, countryCode: 'US', currencyCode: 'USD', accountInfo: { type: 'vendor', name: 'Autor' } }]);
  if (u.endsWith('/sp/campaigns/list')) return j({ campaigns: [{ campaignId: 'c1', name: 'Vieja', state: 'PAUSED', budget: { budget: 1.5 } }] });
  if (u.endsWith('/reporting/reports') && init.method === 'POST') return j({ reportId: /spSearchTerm/.test(String(init.body)) ? 'rt' : 'rc' });
  if (u.includes('/reporting/reports/')) return j({ status: 'COMPLETED', url: `https://descarga.test/${u.endsWith('rt') ? 't' : 'c'}` });
  if (u.startsWith('https://descarga.test/')) return new Response(zlib.gzipSync(JSON.stringify(u.endsWith('/t') ? filasT : filasC)));
  return new Response('{}', { status: 404 });
};
before(async () => { process.env.KRATOS_AMZ_CLIENT_ID = 'id'; process.env.KRATOS_AMZ_CLIENT_SECRET = 's'; process.env.KRATOS_AMZ_REFRESH_TOKEN = 'r'; process.env.KRATOS_AMZ_RAPIDO = '1'; db = createPool(); await migrate(db, () => {}); });
after(async () => { for (const k of ['CLIENT_ID', 'CLIENT_SECRET', 'REFRESH_TOKEN', 'RAPIDO']) delete process.env[`KRATOS_AMZ_${k}`]; await db.end(); });

test('lista perfiles y campañas viejas', async () => {
  assert.equal((await perfiles(falso))[0].pais, 'US'); assert.equal((await campanas('1', falso))[0].estado, 'PAUSED');
});
test('el resumen separa lo que vendió de lo que gastó sin vender y calcula el ACOS real', async () => {
  const r = await resumen(db, '1', falso);
  assert.equal(r.gasto_total, 17.5); assert.equal(r.ventas_atribuidas, 50); assert.equal(r.acos_pct, 35);
  assert.equal(r.terminos_que_vendieron[0].searchTerm, 'masonic symbols'); assert.equal(r.terminos_que_gastaron_sin_vender[0].searchTerm, 'free book'); assert.match(r.nota, /no son tus regal/);
});
