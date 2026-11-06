import { execFileSync } from 'node:child_process';
import type { Db } from '../db.ts';
import { audit } from './state.ts';
import { reservarExperimento } from './presupuesto-pruebas.ts';

// Anuncios en Meta (Facebook/Instagram) para los experimentos de KRATOS (orden del propietario, 6-nov-2026). El token vive en el Llavero
// (kratos-meta, cuenta api); la cuenta publicitaria y la página están en system_state (meta_ad_account, meta_page_id). El gasto SOLO sale
// del presupuesto mensual de pruebas ya aprobado (se reserva antes de crear nada), cada campaña tiene tope de importe y de días, el destino
// debe ser una página o enlace de pago de KRATOS, y el texto no puede prometer lo imposible. Los resultados se leen de Meta (no se inventan).
const API = 'https://graph.facebook.com/v21.0';
const TOPE_CAMPANA_USD = 50, TOPE_DIAS = 7, TOPE_DIARIO_USD = 15;
const PROHIBIDO = /garantiz|cura\b|curar|milagro|hazte rico|dinero f[aá]cil|100 ?%|sin riesgo|resultados asegurados|antes y despu[eé]s/i;
export type Fetcher = (url: string, init: RequestInit) => Promise<Response>;
export function token(): string | null {
  if (process.env.KRATOS_META_TOKEN !== undefined) return process.env.KRATOS_META_TOKEN || null;
  try { return execFileSync('/usr/bin/security', ['find-generic-password', '-s', 'kratos-meta', '-a', 'api', '-w'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 5000 }).trim() || null; } catch { return null; }
}
const ajuste = async (db: Db, k: string) => String((await db.query(`SELECT value FROM system_state WHERE key = $1`, [k])).rows[0]?.value ?? '').replace(/^"|"$/g, '');
async function meta(path: string, o: { method?: string; body?: Record<string, any>; query?: Record<string, string>; fetcher?: Fetcher } = {}) {
  const t = token(); if (!t) throw new Error('Meta no está conectado: falta el token en el Llavero (servicio kratos-meta, cuenta api)');
  const qs = new URLSearchParams({ ...(o.query ?? {}) }).toString();
  const r = await (o.fetcher ?? fetch)(`${API}${path}${qs ? `?${qs}` : ''}`, { method: o.method ?? 'GET', headers: { authorization: `Bearer ${t}`, 'content-type': 'application/json' }, body: o.body ? JSON.stringify(o.body) : undefined, signal: AbortSignal.timeout(30_000) });
  const d: any = await r.json().catch(() => ({}));
  if (!r.ok || d.error) throw new Error(`Meta ${r.status}: ${d?.error?.message ?? 'error'}`);
  return d;
}
async function destinoPermitido(db: Db, url: string) {
  if (!/^https:\/\//.test(url)) throw new Error('El destino del anuncio debe ser https');
  const ok = (await db.query(`SELECT 1 FROM paginas_web WHERE url = $1 OR cta_url = $1 UNION SELECT 1 FROM stripe_productos WHERE url = $1 LIMIT 1`, [url])).rows[0];
  if (!ok) throw new Error('El destino debe ser una página o un enlace de pago creado por KRATOS (paginas_web o stripe_ventas)');
}

export async function estado(db: Db, fetcher?: Fetcher) {
  if (!token()) return { conectado: false, falta: 'token en el Llavero (kratos-meta)' };
  const cuenta = await ajuste(db, 'meta_ad_account'), pagina = await ajuste(db, 'meta_page_id');
  if (!cuenta || !pagina) return { conectado: true, configurado: false, falta: 'meta_ad_account y meta_page_id (el propietario los da una vez)' };
  const a = await meta(`/act_${cuenta}`, { query: { fields: 'name,currency,account_status,amount_spent,spend_cap' }, fetcher });
  return { conectado: true, configurado: true, cuenta: a.name, moneda: a.currency, activa: a.account_status === 1, gastado_centavos: Number(a.amount_spent ?? 0) };
}

export async function lanzarCampana(db: Db, i: { experimento_id: number; nombre: string; destino: string; titulo: string; texto: string; pais?: string; edad_min?: number; edad_max?: number; presupuesto_diario_usd: number; dias: number }, actor: string, fetcher?: Fetcher) {
  const cuenta = await ajuste(db, 'meta_ad_account'), pagina = await ajuste(db, 'meta_page_id');
  if (!cuenta || !pagina) throw new Error('Falta configurar meta_ad_account y meta_page_id');
  const diario = Number(i.presupuesto_diario_usd), dias = Math.round(Number(i.dias)), total = diario * dias;
  if (!(diario >= 1 && diario <= TOPE_DIARIO_USD)) throw new Error(`Presupuesto diario entre 1 y ${TOPE_DIARIO_USD} USD`);
  if (!(dias >= 1 && dias <= TOPE_DIAS)) throw new Error(`Duración entre 1 y ${TOPE_DIAS} días`);
  if (total > TOPE_CAMPANA_USD) throw new Error(`Tope por campaña ${TOPE_CAMPANA_USD} USD (esta sumaría ${total})`);
  if (PROHIBIDO.test(`${i.titulo} ${i.texto}`)) throw new Error('El anuncio promete algo que no se puede garantizar');
  if (String(i.titulo).length > 40 || String(i.texto).length < 20 || String(i.texto).length > 300) throw new Error('Título ≤ 40 caracteres y texto entre 20 y 300');
  await destinoPermitido(db, i.destino);
  const exp = (await db.query(`SELECT id, status FROM experiments WHERE id = $1 AND oportunidad_id IS NOT NULL`, [i.experimento_id])).rows[0];
  if (!exp) throw new Error('El anuncio debe pertenecer a un experimento KSIE (estrategia_ksie accion=experimento)');
  if ((await db.query(`SELECT 1 FROM meta_campanas WHERE experimento_id = $1`, [i.experimento_id])).rows[0]) throw new Error('Ese experimento ya tiene una campaña');
  // El dinero se reserva del presupuesto de pruebas ANTES de crear nada en Meta
  const res = await reservarExperimento(db, exp.id, Math.round(total * 100), actor);
  if (!res.ok) throw new Error(`No se lanza: ${res.motivo}`);
  try {
    const hasta = new Date(Date.now() + dias * 86_400_000).toISOString();
    const camp = await meta(`/act_${cuenta}/campaigns`, { method: 'POST', fetcher, body: { name: `KRATOS · ${i.nombre}`.slice(0, 100), objective: 'OUTCOME_TRAFFIC', status: 'PAUSED', special_ad_categories: [] } });
    const set = await meta(`/act_${cuenta}/adsets`, { method: 'POST', fetcher, body: { name: `${i.nombre} · conjunto`.slice(0, 100), campaign_id: camp.id, daily_budget: Math.round(diario * 100), billing_event: 'IMPRESSIONS', optimization_goal: 'LINK_CLICKS', bid_strategy: 'LOWEST_COST_WITHOUT_CAP', end_time: hasta, status: 'PAUSED',
      targeting: { geo_locations: { countries: [(i.pais ?? 'US').toUpperCase().slice(0, 2)] }, age_min: Math.max(18, i.edad_min ?? 18), age_max: Math.min(65, i.edad_max ?? 65) } } });
    const cre = await meta(`/act_${cuenta}/adcreatives`, { method: 'POST', fetcher, body: { name: `${i.nombre} · creatividad`.slice(0, 100), object_story_spec: { page_id: pagina, link_data: { link: i.destino, message: i.texto, name: i.titulo, call_to_action: { type: 'LEARN_MORE' } } } } });
    const ad = await meta(`/act_${cuenta}/ads`, { method: 'POST', fetcher, body: { name: `${i.nombre} · anuncio`.slice(0, 100), adset_id: set.id, creative: { creative_id: cre.id }, status: 'PAUSED' } });
    // Se activa al final y solo si todo se creó: el gasto ya está reservado y topado por el conjunto de anuncios
    await meta(`/${camp.id}`, { method: 'POST', fetcher, body: { status: 'ACTIVE' } }); await meta(`/${set.id}`, { method: 'POST', fetcher, body: { status: 'ACTIVE' } }); await meta(`/${ad.id}`, { method: 'POST', fetcher, body: { status: 'ACTIVE' } });
    await db.query(`INSERT INTO meta_campanas (experimento_id, campana_id, conjunto_id, anuncio_id, presupuesto_cents, dias, destino) VALUES ($1,$2,$3,$4,$5,$6,$7)`, [exp.id, camp.id, set.id, ad.id, Math.round(total * 100), dias, i.destino]);
    await audit(db, actor, 'meta.campana', { experimento: exp.id, total_usd: total, dias });
    return { lanzada: true, campana: camp.id, gasto_maximo_usd: total, termina: hasta, disponible_restante_usd: res.disponible_restante_usd };
  } catch (e) {
    const { cerrarGastoExperimento } = await import('./presupuesto-pruebas.ts'); await cerrarGastoExperimento(db, exp.id, 0, actor).catch(() => {});   // devuelve la reserva si algo falló
    throw e;
  }
}

// Resultados reales de Meta: gasto, impresiones y clics. Los clics NO son ventas: las ventas se miden en Stripe.
export async function resultados(db: Db, experimento_id: number, fetcher?: Fetcher) {
  const c = (await db.query(`SELECT * FROM meta_campanas WHERE experimento_id = $1`, [experimento_id])).rows[0];
  if (!c) throw new Error('Ese experimento no tiene campaña');
  const d = await meta(`/${c.campana_id}/insights`, { query: { fields: 'spend,impressions,clicks,ctr' }, fetcher });
  const r = d.data?.[0] ?? {};
  return { gasto_usd: Number(r.spend ?? 0), impresiones: Number(r.impressions ?? 0), clics: Number(r.clicks ?? 0), ctr: Number(r.ctr ?? 0), nota: 'Los clics no son compras: mide las ventas con stripe_ventas.' };
}
export async function detener(db: Db, experimento_id: number, actor: string, fetcher?: Fetcher) {
  const c = (await db.query(`SELECT * FROM meta_campanas WHERE experimento_id = $1`, [experimento_id])).rows[0];
  if (!c) throw new Error('Ese experimento no tiene campaña');
  await meta(`/${c.campana_id}`, { method: 'POST', fetcher, body: { status: 'PAUSED' } });
  const r = await resultados(db, experimento_id, fetcher).catch(() => null);
  if (r) { const { cerrarGastoExperimento } = await import('./presupuesto-pruebas.ts'); await cerrarGastoExperimento(db, experimento_id, r.gasto_usd * 100, actor).catch(() => {}); }
  await audit(db, actor, 'meta.detenida', { experimento: experimento_id });
  return { detenida: true, gasto_real_usd: r?.gasto_usd ?? null };
}

export const META_TOOL = {
  description: 'Anuncios en Meta (Facebook/Instagram) para experimentos KSIE, pagados SOLO con el presupuesto mensual de pruebas ya aprobado. estado. lanzar (experimento_id, nombre, destino = página o enlace de pago de KRATOS, titulo ≤40, texto 20–300, pais, edad_min, edad_max, presupuesto_diario_usd 1–15, dias 1–7; tope 50 USD por campaña): '
    + 'reserva el dinero y crea la campaña. resultados (experimento_id): gasto, impresiones y clics reales. detener (experimento_id): pausa y cierra el gasto real. Los clics no son ventas. Sin promesas imposibles.',
  input_schema: { type: 'object', properties: { accion: { type: 'string', enum: ['estado', 'lanzar', 'resultados', 'detener'] }, experimento_id: { type: 'number' }, nombre: { type: 'string' }, destino: { type: 'string' }, titulo: { type: 'string' }, texto: { type: 'string' },
    pais: { type: 'string' }, edad_min: { type: 'number' }, edad_max: { type: 'number' }, presupuesto_diario_usd: { type: 'number' }, dias: { type: 'number' } }, required: ['accion'] },
};
export async function herramientaMeta(db: Db, i: any, actor: string) {
  if (i.accion === 'estado') return await estado(db);
  if (i.accion === 'lanzar') return await lanzarCampana(db, i, actor);
  if (i.accion === 'resultados') return await resultados(db, Number(i.experimento_id));
  if (i.accion === 'detener') return await detener(db, Number(i.experimento_id), actor);
  return { error: 'Acción no válida' };
}
