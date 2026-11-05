import type { Db } from '../db.ts';
import { audit } from './state.ts';

// Expansión cognitiva C05 — predicción y aprendizaje activo. Algoritmo práctico (no la teoría de Friston): creencias gaussianas por
// opción con actualización bayesiana normal-normal; cada decisión registra antes su predicción (valor, rango, incertidumbre); al observar
// se mide el error de predicción, se revisa la creencia y las decisiones siguientes usan la creencia revisada. El aprendizaje activo
// elige el experimento con más información (mayor varianza) cuando hay que explorar, o la mejor cota optimista (UCB) al decidir.

export type Creencia = { contexto: string; clave: string; media: number; varianza: number; ruido: number; n: number };
const r4 = (x: number) => Math.round(x * 10_000) / 10_000;

export async function creencia(db: Db, contexto: string, clave: string, prior?: { media: number; varianza: number; ruido: number }): Promise<Creencia> {
  const c = (await db.query(`SELECT contexto, clave, media, varianza, ruido, n FROM cog_creencias WHERE contexto = $1 AND clave = $2`, [contexto, clave])).rows[0];
  if (c) return c;
  if (!prior) throw new Error(`Sin creencia previa para ${contexto}/${clave}: da un prior (media, varianza, ruido) explícito`);
  await db.query(`INSERT INTO cog_creencias (contexto, clave, media, varianza, ruido) VALUES ($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING`, [contexto, clave, prior.media, prior.varianza, prior.ruido]);
  return { contexto, clave, ...prior, n: 0 };
}

// Predicción explícita ANTES de observar: valor esperado, rango del 95 % e incertidumbre (desviación de la predictiva)
export async function predecir(db: Db, i: { contexto: string; clave: string; hipotesis?: string; decision?: string; prior?: any; experimento_ref?: string }, actor: string) {
  const c = await creencia(db, i.contexto, i.clave, i.prior);
  const sd = Math.sqrt(c.varianza + c.ruido ** 2);
  const r = (await db.query(`INSERT INTO cog_predicciones (actor, contexto, clave, hipotesis, decision, valor, rango_min, rango_max, incertidumbre, creencia_antes, experimento_ref)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING id, registrada_at`,
    [actor, i.contexto, i.clave, i.hipotesis ?? null, i.decision ?? null, r4(c.media), r4(c.media - 1.96 * sd), r4(c.media + 1.96 * sd), r4(sd), JSON.stringify(c), i.experimento_ref ?? null])).rows[0];
  return { id: r.id, valor: r4(c.media), rango: [r4(c.media - 1.96 * sd), r4(c.media + 1.96 * sd)], incertidumbre: r4(sd), registrada_at: r.registrada_at };
}

// Observación: error de predicción y revisión bayesiana de la creencia (una sola vez por predicción)
export async function observar(db: Db, id: number, valor: number, evidencia: string, actor: string) {
  if (!Number.isFinite(valor)) throw new Error('La observación debe ser un número');
  if (!String(evidencia ?? '').trim()) throw new Error('La observación necesita evidencia (de dónde sale el dato)');
  const p = (await db.query(`SELECT * FROM cog_predicciones WHERE id = $1`, [id])).rows[0];
  if (!p) throw new Error(`No existe la predicción ${id}`);
  if (p.observado != null) throw new Error(`La predicción ${id} ya tiene observación`);
  const c = await creencia(db, p.contexto, p.clave);
  const err = valor - p.valor, dentro = valor >= p.rango_min && valor <= p.rango_max;
  const prec = 1 / c.varianza + 1 / c.ruido ** 2, var2 = 1 / prec, media2 = var2 * (c.media / c.varianza + valor / c.ruido ** 2);
  const despues = { ...c, media: r4(media2), varianza: r4(var2), n: c.n + 1 };
  const z = err / p.incertidumbre;
  const revision = `${dentro ? 'Dentro del rango' : 'FUERA del rango'}: error ${r4(err)} (${r4(z)} desviaciones). Creencia ${p.clave}: ${r4(c.media)} → ${r4(media2)}, varianza ${r4(c.varianza)} → ${r4(var2)}.${Math.abs(z) > 2 ? ' Sorpresa alta: revisar la hipótesis y repetir la prueba.' : ''}`;
  await db.query(`UPDATE cog_creencias SET media = $3, varianza = $4, n = n + 1, actualizado = now() WHERE contexto = $1 AND clave = $2`, [p.contexto, p.clave, media2, var2]);
  await db.query(`UPDATE cog_predicciones SET observado = $2, observado_at = clock_timestamp(), evidencia = $3, error = $4, dentro_rango = $5, revision = $6, creencia_despues = $7 WHERE id = $1`,
    [id, valor, String(evidencia).slice(0, 600), r4(err), dentro, revision, JSON.stringify(despues)]);
  await audit(db, actor, 'cog.prediccion_observada', { id, error: r4(err), dentro });
  return { id, prediccion: p.valor, observado: valor, error: r4(err), sorpresa: r4(z), dentro_rango: dentro, revision, creencia: despues };
}

// Decisión con las creencias actuales: explotar (UCB) o explorar (máxima varianza = experimento más informativo)
export async function decidir(db: Db, contexto: string, opciones: string[], modo: 'explotar' | 'explorar' = 'explotar', k = 1) {
  const cs = [] as Creencia[];
  for (const o of opciones) cs.push(await creencia(db, contexto, o));
  const puntua = (c: Creencia) => (modo === 'explorar' ? c.varianza : c.media + k * Math.sqrt(c.varianza));
  const orden = [...cs].sort((a, b) => puntua(b) - puntua(a) || a.clave.localeCompare(b.clave));
  return { elegida: orden[0].clave, modo, puntuaciones: orden.map((c) => ({ opcion: c.clave, media: r4(c.media), sd: r4(Math.sqrt(c.varianza)), n: c.n, puntuacion: r4(puntua(c)) })) };
}

export async function historial(db: Db, contexto?: string) {
  const r = (await db.query(`SELECT count(*)::int AS n, avg(abs(error)) AS mae, avg(CASE WHEN dentro_rango THEN 1 ELSE 0 END) AS cobertura,
      count(*) FILTER (WHERE observado IS NULL)::int AS pendientes FROM cog_predicciones WHERE ${contexto ? 'contexto = $1 AND' : ''} true`, contexto ? [contexto] : [])).rows[0];
  const serie = (await db.query(`SELECT abs(error) AS e FROM cog_predicciones WHERE observado IS NOT NULL ${contexto ? 'AND contexto = $1' : ''} ORDER BY id`, contexto ? [contexto] : [])).rows.map((x) => Number(x.e));
  const mitad = Math.floor(serie.length / 2), m = (a: number[]) => (a.length ? r4(a.reduce((s, x) => s + x, 0) / a.length) : null);
  return { contexto: contexto ?? 'todos', predicciones: r.n, pendientes_de_observar: r.pendientes, error_medio_absoluto: r.mae == null ? null : r4(Number(r.mae)), cobertura_rango_95: r.cobertura == null ? null : r4(Number(r.cobertura)),
    error_primera_mitad: m(serie.slice(0, mitad)), error_segunda_mitad: m(serie.slice(mitad)) };
}

// Banco de pruebas determinista: bandido de k brazos con recompensas gaussianas y semilla fija (mulberry32). Reproducible.
export function generador(semilla: number) {
  let a = semilla >>> 0;
  const u = () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  return { u, normal: (m: number, s: number) => m + s * Math.sqrt(-2 * Math.log(1 - u())) * Math.cos(2 * Math.PI * u()) };
}
export async function ejecutarBanco(db: Db, i: { contexto: string; medias: Record<string, number>; ruido: number; prior: { media: number; varianza: number }; pasos: number; semilla: number; exploracion?: number }, actor: string) {
  const g = generador(i.semilla), brazos = Object.keys(i.medias), mejor = brazos.reduce((a, b) => (i.medias[b] > i.medias[a] ? b : a));
  for (const b of brazos) await creencia(db, i.contexto, b, { ...i.prior, ruido: i.ruido });
  const traza = [] as any[]; let arrepentimiento = 0;
  for (let t = 0; t < i.pasos; t++) {
    const modo = t < (i.exploracion ?? 0) ? 'explorar' : 'explotar';
    const d = await decidir(db, i.contexto, brazos, modo);
    const p = await predecir(db, { contexto: i.contexto, clave: d.elegida, decision: `paso ${t}: ${modo} → ${d.elegida}`, hipotesis: `recompensa de ${d.elegida}` }, actor);
    const obs = r4(g.normal(i.medias[d.elegida], i.ruido));
    const o = await observar(db, p.id, obs, `banco semilla ${i.semilla} paso ${t}`, actor);
    arrepentimiento += i.medias[mejor] - i.medias[d.elegida];
    traza.push({ paso: t, eleccion: d.elegida, prediccion: p.valor, observado: obs, error: o.error, dentro: o.dentro_rango });
  }
  return { mejor_real: mejor, ultima_eleccion: traza.at(-1)?.eleccion, arrepentimiento: r4(arrepentimiento), traza, historial: await historial(db, i.contexto) };
}

export const PREDICCION_TOOL = {
  description: 'Predicción y aprendizaje activo (C05). predecir (contexto, clave, hipotesis, decision, prior{media,varianza,ruido} si es nueva): registra ANTES de observar valor, rango 95 % e incertidumbre; no se puede editar después. '
    + 'observar (id, valor, evidencia): error de predicción y revisión bayesiana de la creencia. decidir (contexto, opciones[], modo explotar|explorar): usa las creencias revisadas. creencia (contexto, clave). historial (contexto): error medio, cobertura del rango y si mejora.',
  input_schema: { type: 'object', properties: { accion: { type: 'string', enum: ['predecir', 'observar', 'decidir', 'creencia', 'historial'] }, contexto: { type: 'string' }, clave: { type: 'string' }, hipotesis: { type: 'string' }, decision: { type: 'string' },
    prior: { type: 'object' }, id: { type: 'number' }, valor: { type: 'number' }, evidencia: { type: 'string' }, opciones: { type: 'array', items: { type: 'string' } }, modo: { type: 'string', enum: ['explotar', 'explorar'] }, experimento_ref: { type: 'string' } }, required: ['accion'] },
};
export async function herramientaPrediccion(db: Db, i: any, actor: string) {
  if (i.accion === 'predecir') return await predecir(db, i, actor);
  if (i.accion === 'observar') return await observar(db, Number(i.id), Number(i.valor), String(i.evidencia ?? ''), actor);
  if (i.accion === 'decidir') return await decidir(db, String(i.contexto), (i.opciones ?? []).map(String), i.modo ?? 'explotar');
  if (i.accion === 'creencia') return await creencia(db, String(i.contexto), String(i.clave));
  if (i.accion === 'historial') return await historial(db, i.contexto);
  return { error: 'Acción no válida' };
}
