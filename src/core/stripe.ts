import { execFileSync } from 'node:child_process';
import type { Db } from '../db.ts';
import { audit } from './state.ts';

// Ventas con Stripe (orden del propietario, 5-nov-2026): KRATOS crea productos y enlaces de pago, y lee sus ventas para medir
// INGRESOS REALES. Usa la cuenta de Stripe del propietario, pero solo cuenta como suyo lo que lleva la marca kratos=1 (los otros
// proyectos del propietario no se mezclan). La clave vive en el Llavero (servicio kratos-stripe, cuenta api); nunca en la base ni en el código.
// Reglas: solo se vende lo que existe o se puede entregar (una preventa se anuncia como preventa), precios honestos, nada engañoso.

const API = 'https://api.stripe.com/v1';
let cache: { key: string | null; at: number } | null = null;
export function stripeKey(): string | null {
  if (process.env.KRATOS_STRIPE_KEY !== undefined) return process.env.KRATOS_STRIPE_KEY || null;   // pruebas
  if (cache && Date.now() - cache.at < 60_000) return cache.key;
  let key: string | null = null;
  try { key = execFileSync('/usr/bin/security', ['find-generic-password', '-s', 'kratos-stripe', '-a', 'api', '-w'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 5000 }).trim() || null; } catch { key = null; }
  cache = { key, at: Date.now() };
  return key;
}

// Codifica objetos anidados al formato de formulario de Stripe (a[b][c]=v)
function form(o: Record<string, any>, pre = ''): string[] {
  const out: string[] = [];
  for (const [k, v] of Object.entries(o)) {
    if (v === undefined || v === null) continue;
    const name = pre ? `${pre}[${k}]` : k;
    if (typeof v === 'object' && !Array.isArray(v)) out.push(...form(v, name));
    else if (Array.isArray(v)) v.forEach((x, i) => (typeof x === 'object' ? out.push(...form(x, `${name}[${i}]`)) : out.push(`${encodeURIComponent(`${name}[${i}]`)}=${encodeURIComponent(String(x))}`)));
    else out.push(`${encodeURIComponent(name)}=${encodeURIComponent(String(v))}`);
  }
  return out;
}
export type Fetcher = (url: string, init: RequestInit) => Promise<Response>;
async function stripe(path: string, opts: { method?: string; body?: Record<string, any>; query?: Record<string, any>; fetcher?: Fetcher } = {}) {
  const key = stripeKey();
  if (!key) throw new Error('Stripe no está conectado: falta la clave en el Llavero (servicio kratos-stripe, cuenta api)');
  const qs = opts.query ? `?${form(opts.query).join('&')}` : '';
  const r = await (opts.fetcher ?? fetch)(`${API}${path}${qs}`, { method: opts.method ?? 'GET', headers: { authorization: `Bearer ${key}`, 'content-type': 'application/x-www-form-urlencoded', 'stripe-version': '2024-06-20' },
    body: opts.body ? form(opts.body).join('&') : undefined, signal: AbortSignal.timeout(20_000) });
  const d: any = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`Stripe ${r.status}: ${d?.error?.message ?? 'error'}`);
  return d;
}

export async function estado(fetcher?: Fetcher) {
  if (!stripeKey()) return { conectado: false, como_conectar: 'Crea en Stripe una clave restringida y guárdala con: security add-generic-password -s kratos-stripe -a api -w' };
  const key = stripeKey()!;
  const bal = await stripe('/balance', { fetcher });
  const disp = (bal.available ?? []).find((b: any) => b.currency === 'usd')?.amount ?? 0;
  return { conectado: true, modo: key.includes('_live_') ? 'real' : 'pruebas', saldo_disponible_usd: disp / 100, nota: 'El saldo es de toda la cuenta; los ingresos de KRATOS se cuentan aparte (solo ventas con marca kratos=1).' };
}

// Crea un producto vendible con su precio y un enlace de pago público. Exige decir qué recibe el comprador.
export async function crearProducto(db: Db, i: { nombre: string; descripcion: string; entrega: string; precio_usd: number; recurrente?: boolean; preventa?: boolean; oportunidad_id?: number }, actor: string, fetcher?: Fetcher) {
  if (!String(i.nombre ?? '').trim() || !String(i.descripcion ?? '').trim()) throw new Error('Faltan nombre y descripción');
  if (!String(i.entrega ?? '').trim()) throw new Error('Di qué recibe exactamente el comprador y cuándo (no se vende lo que no existe)');
  const precio = Math.round(Number(i.precio_usd) * 100);
  if (!(precio >= 100 && precio <= 100_000)) throw new Error('Precio entre 1 y 1.000 USD');
  if (/garantiz|cura|milagro|hazte rico|100 ?%/i.test(`${i.nombre} ${i.descripcion}`)) throw new Error('La descripción promete algo que no se puede garantizar');
  const desc = `${i.preventa ? '[PREVENTA] ' : ''}${i.descripcion}\n\nQué recibes: ${i.entrega}`.slice(0, 1500);
  const meta = { kratos: '1', oportunidad_id: i.oportunidad_id ? String(i.oportunidad_id) : undefined, creado_por: actor.slice(0, 40) };
  const prod = await stripe('/products', { method: 'POST', body: { name: i.nombre.slice(0, 120), description: desc, metadata: meta }, fetcher });
  const price = await stripe('/prices', { method: 'POST', body: { product: prod.id, unit_amount: precio, currency: 'usd', recurring: i.recurrente ? { interval: 'month' } : undefined, metadata: meta }, fetcher });
  const link = await stripe('/payment_links', { method: 'POST', body: { line_items: [{ price: price.id, quantity: 1 }], metadata: meta, ...(i.recurrente ? { subscription_data: { metadata: meta } } : { payment_intent_data: { metadata: meta } }) }, fetcher });
  await db.query(`INSERT INTO stripe_productos (producto_id, precio_id, enlace_id, url, nombre, precio_cents, recurrente, preventa, oportunidad_id, creado_por) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
    [prod.id, price.id, link.id, link.url, i.nombre, precio, !!i.recurrente, !!i.preventa, i.oportunidad_id ?? null, actor]);
  await audit(db, actor, 'stripe.producto', { producto: prod.id, precio_cents: precio, url: link.url });
  return { producto: prod.id, enlace_de_pago: link.url, precio_usd: precio / 100, preventa: !!i.preventa };
}

// Lee las ventas de KRATOS (marca kratos=1) y las registra como ingresos OBSERVADOS en metrics, con su comisión como coste. Idempotente.
export async function sincronizarVentas(db: Db, fetcher?: Fetcher) {
  if (!stripeKey()) return { conectado: false, nuevas: 0 };
  const desde = Math.floor((Date.now() - 35 * 86_400_000) / 1000);
  let nuevas = 0, starting_after: string | undefined;
  for (let pagina = 0; pagina < 10; pagina++) {
    const r = await stripe('/charges', { query: { limit: 100, created: { gte: desde }, starting_after, expand: ['data.balance_transaction'] }, fetcher });
    for (const c of r.data ?? []) {
      if (c.metadata?.kratos !== '1' || c.status !== 'succeeded' || c.currency !== 'usd') continue;
      const neto = (c.amount - (c.amount_refunded ?? 0)) / 100, fee = (c.balance_transaction?.fee ?? 0) / 100;
      const ya = (await db.query(`SELECT 1 FROM metrics WHERE source = $1`, [`stripe:${c.id}`])).rows[0];
      if (ya) continue;
      const negocio = (await db.query(`SELECT id FROM businesses WHERE NOT is_demo ORDER BY id LIMIT 1`)).rows[0]?.id ?? 1;
      await db.query(`INSERT INTO metrics (business_id, metric, value, unit, source, observed_at, is_demo) VALUES ($1, 'ingresos_usd', $2, 'USD', $3, to_timestamp($4), false)`, [negocio, neto, `stripe:${c.id}`, c.created]);
      if (fee) await db.query(`INSERT INTO metrics (business_id, metric, value, unit, source, observed_at, is_demo) VALUES ($1, 'costes_usd', $2, 'USD', $3, to_timestamp($4), false)`, [negocio, fee, `stripe-comision:${c.id}`, c.created]);
      nuevas++;
    }
    if (!r.has_more || !r.data?.length) break;
    starting_after = r.data.at(-1).id;
  }
  if (nuevas) await audit(db, 'stripe', 'stripe.ventas', { nuevas });
  return { conectado: true, nuevas };
}

export async function ventas(db: Db) {
  const r = (await db.query(`SELECT count(*) FILTER (WHERE metric = 'ingresos_usd')::int AS n, coalesce(sum(value) FILTER (WHERE metric = 'ingresos_usd'), 0)::float AS ingresos, coalesce(sum(value) FILTER (WHERE metric = 'costes_usd'), 0)::float AS comisiones
     FROM metrics WHERE source LIKE 'stripe%' AND observed_at > now() - interval '30 days'`)).rows[0];
  const productos = (await db.query(`SELECT nombre, url, precio_cents / 100.0 AS precio_usd, preventa, created_at FROM stripe_productos ORDER BY id DESC LIMIT 20`)).rows;
  return { ventas_30d: r.n, ingresos_30d_usd: r.ingresos, comisiones_30d_usd: r.comisiones, productos };
}

export const STRIPE_TOOL = {
  description: 'Ventas reales con Stripe (cuenta del propietario; solo cuenta lo de KRATOS, marcado kratos=1). estado: si está conectado y en qué modo. crear_producto (nombre, descripcion, entrega = qué recibe el comprador y cuándo, precio_usd, recurrente, preventa, oportunidad_id): crea producto, precio y ENLACE DE PAGO. '
    + 'ventas: ventas e ingresos de los últimos 30 días. sincronizar: trae las ventas nuevas como ingresos observados. Solo vende lo que existe o se puede entregar; una preventa se anuncia como preventa; nada de promesas engañosas.',
  input_schema: { type: 'object', properties: { accion: { type: 'string', enum: ['estado', 'crear_producto', 'ventas', 'sincronizar'] }, nombre: { type: 'string' }, descripcion: { type: 'string' }, entrega: { type: 'string' },
    precio_usd: { type: 'number' }, recurrente: { type: 'boolean' }, preventa: { type: 'boolean' }, oportunidad_id: { type: 'number' } }, required: ['accion'] },
};
export async function herramientaStripe(db: Db, i: any, actor: string) {
  if (i.accion === 'estado') return await estado();
  if (i.accion === 'crear_producto') return await crearProducto(db, i, actor);
  if (i.accion === 'ventas') return await ventas(db);
  if (i.accion === 'sincronizar') return await sincronizarVentas(db);
  return { error: 'Acción no válida' };
}
