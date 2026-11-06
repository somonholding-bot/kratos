import fs from 'node:fs';
import path from 'node:path';
import type { Db } from '../db.ts';
import { ROOT } from '../config.ts';
import { audit } from './state.ts';
import { instantiatePlaybook } from './playbooks.ts';
import { beneficioReal, comparar, detectarFijacion, recomendar } from './ksie.ts';
import { buscarMemoria } from './autobiografia.ts';
import { saldoPruebas } from './presupuesto-pruebas.ts';
import { stripeKey } from './stripe.ts';

// Motor de dinero (orden del propietario, 5-nov-2026 noche): la misión de KRATOS es generar beneficio neto por CUALQUIER vía legal
// —no solo vídeos ni apps— decidiendo con todo lo que ya tiene instalado, sin preguntarle al propietario. Dos piezas:
//  1) SABER: antes de decidir, KRATOS y sus agentes leen un resumen de su conocimiento (mente humana, lecciones, errores, datos reales,
//     cartera, límites) para saber qué le conviene y qué no.
//  2) MOTOR: un planificador de código mantiene viva una cartera diversa de oportunidades y la empuja sola: descubrir (Júpiter) →
//     validar con evidencia (Mercurio) → recomendar (KSIE, código) → experimento más barato (Júpiter) → aprender. Prueba y error medidos.
// Límites que no se tocan: nada ilegal ni engañoso; gastar dinero, operar con capital (trading), firmar o contratar algo nuevo
// necesita la aprobación del propietario en el panel; borrar vídeos también. Todo lo demás lo decide KRATOS.

const corta = (s: any, n: number) => String(s ?? '').replace(/\s+/g, ' ').trim().slice(0, n);
const SKILLS_MENTE = [['sol', 'hipnosis-mentalismo-psicologia-profunda'], ['sol', 'direccion-creativa'], ['mercurio', 'customer-research'], ['mercurio', 'copywriting'], ['jupiter', 'marketing-ideas'], ['jupiter', 'lead-magnets']];

// Resumen del conocimiento de KRATOS para decidir (≤ ~4.000 caracteres): se lee ANTES de cada decisión de negocio
export async function saberParaDecidir(db: Db, tema = '', max = 4200) {
  const real = await beneficioReal(db).catch(() => null);
  const t = String(tema).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').split(/[^a-z0-9]+/).filter((w) => w.length > 3).slice(0, 6);
  const afirm = (await db.query(`SELECT nivel, left(texto, 170) AS texto FROM sol_afirmaciones WHERE nivel IN ('A','B','C')
     ${t.length ? `ORDER BY (${t.map((_, k) => `(texto ILIKE $${k + 1} OR coalesce(tema, '') ILIKE $${k + 1})::int`).join(' + ')}) DESC, confianza DESC NULLS LAST` : 'ORDER BY confianza DESC NULLS LAST'} LIMIT 8`, t.map((w) => `%${w}%`))).rows;
  const bien = (await db.query(`SELECT left(content, 150) AS c FROM lessons WHERE kind = 'funciono' ORDER BY id DESC LIMIT 6`)).rows;
  const mal = (await db.query(`SELECT left(content, 150) AS c FROM lessons WHERE kind = 'no_funciono' ORDER BY id DESC LIMIT 6`)).rows;
  const errores = t.length ? await buscarMemoria(db, { texto: t.join(' '), resultado: 'fallo', limite: 4 }).catch(() => [] as any[]) : [];
  const cartera = await comparar(db).catch(() => ({ ranking: [], sin_evaluar: [], diversidad: { digitales: 0, no_digitales: 0 } } as any));
  const fij = await detectarFijacion(db).catch(() => ({ alertas: [] } as any));
  const skills = SKILLS_MENTE.filter(([a, s]) => fs.existsSync(path.join(ROOT, 'skills', a, s))).map(([a, s]) => `${a}/${s}`);
  const docs = ['docs/guia-mentalismo-jung.md', 'docs/estrategia-viral-aion.md', 'docs/kratos-strategic-intelligence/decision-framework.md'].filter((d) => fs.existsSync(path.join(ROOT, d)));
  const pres = await saldoPruebas(db).catch(() => ({ activa: false, disponible_cents: 0 } as any));
  const L: string[] = [
    `MISIÓN: generar beneficio neto verificado (hito 10.000 $/mes) por CUALQUIER vía legal; vídeos y apps son solo dos vías entre muchas. Hoy: beneficio neto observado ${real?.beneficio_neto_observado ?? '¿?'} $ en 30 días.`,
    'DECIDE TÚ con este conocimiento; no le preguntes al propietario qué hacer. Solo él aprueba: gastar dinero fuera del presupuesto de pruebas, operar con capital, contratar o firmar algo nuevo, y borrar vídeos.',
    `HERRAMIENTAS PARA GANAR: Stripe ${stripeKey() ? 'CONECTADO: crea productos con enlace de pago (stripe_ventas accion=crear_producto) y mide ventas reales' : 'sin conectar todavía'}; páginas web propias con paginas_web accion=publicar (GitHub Pages); presupuesto de pruebas ${pres.activa ? `ACTIVO con ${pres.disponible_cents / 100} USD disponibles este mes (gástalo en experimentos sin preguntar, con cabeza)` : 'pendiente de aprobación del propietario'}.`,
    `CÓMO PIENSA LA GENTE (investigación de Sol, niveles A–C): ${afirm.map((a) => `[${a.nivel}] ${a.texto}`).join(' · ') || 'sin afirmaciones aún'}`,
    `MÉTODOS INSTALADOS sobre la mente y la persuasión ética: skills ${skills.join(', ')}; documentos ${docs.join(', ')}.`,
    `LO QUE FUNCIONÓ: ${bien.map((b) => corta(b.c, 150)).join(' · ')}`,
    `LO QUE NO FUNCIONÓ (no lo repitas sin evidencia nueva): ${mal.map((b) => corta(b.c, 150)).join(' · ')}`,
    ...(errores.length ? [`ERRORES DOCUMENTADOS sobre este tema: ${errores.map((e: any) => corta(e.leccion ?? e.detalle, 140)).join(' · ')}`] : []),
    `CARTERA (KSIE): ${cartera.ranking.slice(0, 5).map((r: any) => `${r.nombre} (${r.tipo}, valor esperado ${r.valor_esperado_mensual} $/mes, ${r.etiqueta})`).join('; ') || 'vacía: hay que descubrir oportunidades'}; sin evaluar ${cartera.sin_evaluar.length}; digitales ${cartera.diversidad.digitales} / no digitales ${cartera.diversidad.no_digitales}.`,
    ...(fij.alertas?.length ? [`FIJACIÓN: ${fij.alertas.join(' · ')}`] : []),
    'MÉTODO: prueba y error medidos. Hipótesis → experimento más barato con umbral decidido antes → resultado → aprender. Clics y vistas no son ventas; ingresos no son beneficio.',
  ];
  return L.join('\n').slice(0, max);
}

// ---------- Comprobaciones en código para los procedimientos del motor ----------
type Ctx = { texto: string; params: Record<string, unknown>; extraido: Record<string, any>; db?: Db; task?: any };
const ventana = (ctx: Ctx) => (ctx.db && ctx.task?.owner_function ? { since: new Date(ctx.task.started_at ?? ctx.task.created_at), actor: `agente:${ctx.task.owner_function}` } : null);
const minimo = (c: any) => (Number(c.minimo) > 0 ? Number(c.minimo) : 1);
const opId = (c: any, p: Record<string, unknown>) => Number(String(c.oportunidad ?? '').replace(/\{\{\s*oportunidad_id\s*\}\}/, String(p.oportunidad_id ?? '')) || p.oportunidad_id) || 0;
export const KSIE_CHECKS: Record<string, { claves: string[]; describir(c: any, p?: any): string; comprobar(c: any, ctx: Ctx): Promise<{ ok: boolean; detalle: string }> }> = {
  ksie_oportunidades_min: {
    claves: ['minimo', 'tipos_min'],
    describir: (c) => `al menos ${minimo(c)} oportunidades nuevas registradas y evaluadas con rangos en KSIE, de ${c.tipos_min ?? 1} tipos distintos`,
    async comprobar(c, ctx) {
      const w = ventana(ctx); if (!w) return { ok: false, detalle: 'sin tarea' };
      const r = (await ctx.db!.query(`SELECT count(*)::int AS n, count(DISTINCT tipo)::int AS tipos FROM ksie_oportunidades WHERE creado_por = $1 AND created_at >= $2 AND evaluacion <> '{}'::jsonb`, [w.actor, w.since])).rows[0];
      const tmin = Number(c.tipos_min) || 1;
      return { ok: r.n >= minimo(c) && r.tipos >= tmin, detalle: `${r.n} oportunidades evaluadas de ${r.tipos} tipos (mínimo ${minimo(c)} de ${tmin})` };
    },
  },
  ksie_respuestas_min: {
    claves: ['minimo', 'oportunidad'],
    describir: (c) => `al menos ${minimo(c)} preguntas del marco respondidas con evidencia y fuente para la oportunidad`,
    async comprobar(c, ctx) {
      const w = ventana(ctx); if (!w) return { ok: false, detalle: 'sin tarea' };
      const id = opId(c, ctx.params);
      const n = (await ctx.db!.query(`SELECT count(DISTINCT pregunta_id)::int AS n FROM ksie_respuestas WHERE actor = $1 AND created_at >= $2 AND ($3 = 0 OR oportunidad_id = $3)`, [w.actor, w.since, id])).rows[0].n;
      return { ok: n >= minimo(c), detalle: `${n} preguntas respondidas con evidencia (mínimo ${minimo(c)})` };
    },
  },
  ksie_experimentos_min: {
    claves: ['minimo', 'oportunidad'],
    describir: (c) => `al menos ${minimo(c)} experimento diseñado con umbrales de éxito y de corte decididos antes`,
    async comprobar(c, ctx) {
      const w = ventana(ctx); if (!w) return { ok: false, detalle: 'sin tarea' };
      const id = opId(c, ctx.params);
      const n = (await ctx.db!.query(`SELECT count(*)::int AS n FROM experiments WHERE oportunidad_id IS NOT NULL AND created_at >= $1 AND umbral_exito IS NOT NULL AND umbral_fracaso IS NOT NULL AND ($2 = 0 OR oportunidad_id = $2)`, [w.since, id])).rows[0].n;
      return { ok: n >= minimo(c), detalle: `${n} experimentos con umbrales (mínimo ${minimo(c)})` };
    },
  },
};

// ---------- Planificador: empuja la cartera sola (lo llama el worker) ----------
const ABIERTA = `status IN ('pendiente','en_ejecucion','verificando','esperando_ia','esperando_permiso')`;
async function abierta(db: Db, playbook: string, oportunidad?: number) {
  return !!(await db.query(`SELECT 1 FROM tasks WHERE playbook_id = $1 AND ${ABIERTA} ${oportunidad ? `AND inputs->'parametros'->>'oportunidad_id' = $2` : ''} LIMIT 1`, oportunidad ? [playbook, String(oportunidad)] : [playbook])).rows[0];
}
async function lanzadasHoy(db: Db) {
  return (await db.query(`SELECT count(*)::int AS n FROM tasks WHERE playbook_id LIKE 'ksie-%' AND created_at > now() - interval '24 hours'`)).rows[0].n;
}
async function lanzar(db: Db, id: string, parametros: Record<string, unknown>, creadoPor = 'motor de dinero') {
  const negocio = (await db.query(`SELECT id FROM businesses WHERE NOT is_demo ORDER BY id LIMIT 1`)).rows[0]?.id ?? 1;
  const r: any = await instantiatePlaybook(db, { id, negocioId: negocio, parametros, version: null, soloValidar: false, creadoPor });
  if (r?.ok && r.tarea) await audit(db, 'motor de dinero', 'motor.lanzado', { playbook: id, tarea: r.tarea, parametros });
  else throw new Error(`No pude lanzar ${id}: ${r?.error ?? 'sin tarea'}`);
  return r;
}
export async function avanzarMotor(db: Db, opts: { creadoPor?: string } = {}) {
  const st = (await db.query(`SELECT key, value FROM system_state WHERE key IN ('emergency_stop','automations_paused','motor_dinero_dia')`)).rows;
  const v = (k: string) => st.find((x) => x.key === k)?.value;
  if (v('emergency_stop') === true || v('automations_paused') === true) return { hecho: null, motivo: 'parada o automatizaciones en pausa' };
  const cupo = Number(v('motor_dinero_dia') ?? 3);
  if ((await lanzadasHoy(db)) >= cupo) return { hecho: null, motivo: `cupo diario del motor (${cupo}) cubierto` };
  const creadoPor = opts.creadoPor ?? 'motor de dinero';
  const vivas = (await db.query(`SELECT id, nombre, tipo, evaluacion, estado FROM ksie_oportunidades WHERE estado <> 'descartada' ORDER BY id`)).rows;
  const evaluadas = vivas.filter((o) => Object.keys(o.evaluacion ?? {}).length);
  const tipos = new Set(evaluadas.map((o) => o.tipo)).size;
  // 1) Descubrir: cartera pequeña o poco diversa
  if ((evaluadas.length < 8 || tipos < 5) && !(await abierta(db, 'ksie-descubrir')))
    return { hecho: 'descubrir', tarea: (await lanzar(db, 'ksie-descubrir', { foco: tipos < 5 ? 'sectores que aún no están en la cartera (físicos, servicios locales e industriales, libros, productos digitales, licencias, B2B)' : 'nuevas vías con evidencia de pago' }, creadoPor)).tarea };
  // 2) Validar: la mejor oportunidad con preguntas críticas sin evidencia
  const ranking = (await comparar(db)).ranking;
  for (const r of ranking) {
    const crit = (await db.query(`SELECT count(DISTINCT pregunta_id)::int AS n FROM ksie_respuestas WHERE oportunidad_id = $1 AND pregunta_id IN ('Q001','Q002','Q010','Q011','Q020','Q030','Q061','Q064','Q083','Q093')`, [r.id])).rows[0].n;
    if (crit < 7) {
      if (await abierta(db, 'ksie-validar', r.id)) return { hecho: null, motivo: `validación de «${r.nombre}» en curso` };
      return { hecho: 'validar', oportunidad: r.id, tarea: (await lanzar(db, 'ksie-validar', { oportunidad_id: r.id, nombre: r.nombre }, creadoPor)).tarea };
    }
    // 3) Recomendar (código) y, si toca, diseñar el experimento más barato
    const ult = (await db.query(`SELECT decision, created_at FROM ksie_recomendaciones WHERE oportunidad_id = $1 ORDER BY id DESC LIMIT 1`, [r.id])).rows[0];
    const rec = !ult || Date.now() - new Date(ult.created_at).getTime() > 12 * 3_600_000 ? await recomendar(db, r.id, 'kratos (motor de dinero)').catch(() => null) : { decision: ult.decision };
    const exp = (await db.query(`SELECT 1 FROM experiments WHERE oportunidad_id = $1 AND status NOT IN ('fracaso','no_concluyente') LIMIT 1`, [r.id])).rows[0];
    if (rec?.decision === 'EXPERIMENT' && !exp) {
      if (await abierta(db, 'ksie-experimento', r.id)) return { hecho: null, motivo: `experimento de «${r.nombre}» en diseño` };
      return { hecho: 'experimentar', oportunidad: r.id, tarea: (await lanzar(db, 'ksie-experimento', { oportunidad_id: r.id, nombre: r.nombre }, creadoPor)).tarea };
    }
  }
  return { hecho: null, motivo: 'cartera al día: esperando resultados de experimentos' };
}

export async function estadoMotor(db: Db) {
  const tareas = (await db.query(`SELECT id, playbook_id, status, inputs->'parametros'->>'nombre' AS oportunidad, created_at FROM tasks WHERE playbook_id LIKE 'ksie-%' ORDER BY id DESC LIMIT 10`)).rows;
  return { cartera: (await comparar(db)).ranking.slice(0, 10), tareas_del_motor: tareas, beneficio_real: await beneficioReal(db), lanzadas_24h: await lanzadasHoy(db) };
}

export const SABER_TOOL = {
  description: 'Conocimiento de KRATOS para decidir (léelo ANTES de cualquier decisión de negocio, vídeo, producto o estrategia): misión de dinero, cómo piensa la gente según la investigación de Sol, métodos instalados, lo que funcionó y lo que no, errores documentados, cartera y límites. '
    + 'briefing (tema): el resumen. motor: estado del motor de dinero (cartera, tareas, beneficio real). empujar: avanza el motor ahora (descubrir → validar → experimentar).',
  input_schema: { type: 'object', properties: { accion: { type: 'string', enum: ['briefing', 'motor', 'empujar'] }, tema: { type: 'string' } }, required: ['accion'] },
};
export async function herramientaSaber(db: Db, i: any, actor: string) {
  if (i.accion === 'briefing') return { saber: await saberParaDecidir(db, String(i.tema ?? '')) };
  if (i.accion === 'motor') return await estadoMotor(db);
  // Si lo pide el propietario en la conversación, es su orden (prioridad de uso del plan); si lo hace el ciclo del CEO, es trabajo de fondo
  if (i.accion === 'empujar') return await avanzarMotor(db, { creadoPor: process.env.KRATOS_TOOLSET === 'ceo' ? 'motor de dinero' : 'kratos (IA)' });
  return { error: 'Acción no válida' };
}
