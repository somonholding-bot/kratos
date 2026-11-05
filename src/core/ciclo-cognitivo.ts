import type { Db } from '../db.ts';
import path from 'node:path';
import { DATA_DIR } from '../config.ts';
import { audit } from './state.ts';
import { capacidad, puedo, quienHace } from './automodelo.ts';
import { activar, aVerificacion, cerrarSinExito, completar, explicar, proponer, traspasar } from './espacio.ts';
import { herramientaAcd } from './acd.ts';
import { ejecutarAislado } from './aislado.ts';
import { registrarDecision, resolverDecision, revisarDecision } from './metacognicion.ts';
import { observar, predecir } from './prediccion.ts';
import { recordar } from './autobiografia.ts';

// TAREA 08 — ciclo operativo de la expansión cognitiva. Cada etapa deja entrada, salida, responsable y criterio en cog_ciclos.
// 1 KRATOS recibe UN objetivo (C04) · 2 C01 comprueba capacidades y límites · 3 C04 lo asigna al agente adecuado (traspaso)
// 4 SOL reúne evidencia (biblioteca local sol_fuentes) · 5 ACD registra la pregunta y una hipótesis comprobable
// 6 cálculo: Q-LAB si existiera; si no, se informa de la dependencia ausente y se usa el ejecutor aislado · 7 C02 evalúa con revisión
// independiente · 8 C05 compara la predicción registrada antes con la observación · 9 C03 registra resultado y lección
// 10 KRATOS completa con artefacto de verificación o informa de un fallo verificado.

export const VERIFICADOR = 'verificador (código)';
export type EntradaCiclo = {
  titulo: string; criterio_exito: string; aceptacion: string; capacidades: string[]; tipo_tarea?: string;
  consulta_evidencia: string; pregunta: string; hipotesis: { titulo: string; enunciado: string; mecanismo: string };
  calculo: { codigo: string; metrica: string }; prediccion: { contexto: string; clave: string; prior: { media: number; varianza: number; ruido: number } };
  umbral: { op: '>' | '<' | '>=' | '<='; valor: number };
};
const cumple = (v: number, op: string, x: number) => (op === '>' ? v > x : op === '<' ? v < x : op === '>=' ? v >= x : v <= x);

export async function ejecutarCiclo(db: Db, e: EntradaCiclo, opts: { base?: string } = {}) {
  const ciclo = (await db.query(`INSERT INTO cog_ciclos (titulo) VALUES ($1) RETURNING id`, [e.titulo])).rows[0].id as number;
  const etapas: any[] = [];
  const etapa = async (n: number, nombre: string, responsable: string, entrada: any, salida: any, criterio: string, ok: boolean, extra: any = {}) => {
    etapas.push({ n, etapa: nombre, responsable, entrada, salida, criterio, cumple: ok, ...extra });
    await db.query(`UPDATE cog_ciclos SET etapas = $2 WHERE id = $1`, [ciclo, JSON.stringify(etapas)]);
  };
  const terminar = async (estado: 'completado' | 'fallido' | 'bloqueado', resultado: string) => {
    await db.query(`UPDATE cog_ciclos SET estado = $2, resultado = $3, cerrado_at = now() WHERE id = $1`, [ciclo, estado, resultado]);
    await audit(db, 'kratos', 'cog.ciclo', { id: ciclo, estado });
    return { ciclo_id: ciclo, estado, resultado, etapas };
  };

  // 1 — un objetivo
  const o = await proponer(db, { titulo: e.titulo, criterio_exito: e.criterio_exito, propietario: 'kratos', aceptacion: e.aceptacion }, 'kratos');
  if (o.redundante) { await etapa(1, 'recibir objetivo', 'kratos', e.titulo, o, 'objetivo nuevo, no redundante', false); return terminar('bloqueado', o.motivo!); }
  try { await activar(db, o.id, 'kratos', 'ciclo cognitivo'); }
  catch (x: any) { await etapa(1, 'recibir objetivo', 'kratos', e.titulo, { error: x.message }, 'un solo objetivo activo', false); await cerrarSinExito(db, o.id, 'CANCELLED', x.message, 'kratos'); return terminar('bloqueado', x.message); }
  await db.query(`UPDATE cog_ciclos SET objetivo_id = $2 WHERE id = $1`, [ciclo, o.id]);
  await etapa(1, 'recibir objetivo', 'kratos', e.titulo, { objetivo_id: o.id, estado: 'ACTIVE' }, 'un solo objetivo principal ACTIVO', true);

  // 2 — capacidades y límites
  const cap = await puedo(db, e.capacidades);
  await etapa(2, 'comprobar capacidades (C01)', 'automodelo', e.capacidades, cap, 'todas las capacidades necesarias existen y no están degradadas', cap.puedo);
  if (!cap.puedo) { await cerrarSinExito(db, o.id, 'BLOCKED', cap.respuesta, 'kratos'); return terminar('bloqueado', cap.respuesta); }

  // 3 — asignación
  // Saturno es el evaluador independiente: no se le asigna el trabajo que después tendría que evaluar
  const q = await quienHace(db, e.tipo_tarea ?? `${e.titulo} ${e.pregunta}`, { excluir: ['saturno'] });
  const agente = q.agente ?? 'sol';
  await traspasar(db, o.id, agente, `Asignado por el ciclo cognitivo: ${q.motivo}`, 'kratos');
  await etapa(3, 'asignar agente (C04)', 'kratos', e.titulo, { agente, motivo: q.motivo, por_defecto: !q.agente }, 'agente con función adecuada o motivo explícito', true);

  // 4 — evidencia (biblioteca de Sol, local; los conectores en vivo los usa Sol en sus tareas)
  const terms = e.consulta_evidencia.split(/\s+/).filter((w) => w.length > 3).slice(0, 6);
  const fuentes = terms.length ? (await db.query(`SELECT id, titulo, url, verificada FROM sol_fuentes WHERE ${terms.map((_, k) => `(titulo ILIKE $${k + 1} OR coalesce(notas, '') ILIKE $${k + 1} OR array_to_string(temas, ' ') ILIKE $${k + 1})`).join(' OR ')} ORDER BY verificada DESC, id DESC LIMIT 8`, terms.map((t) => `%${t}%`))).rows : [];
  await etapa(4, 'reunir evidencia (SOL)', 'sol', e.consulta_evidencia, { fuentes: fuentes.map((f) => ({ id: f.id, titulo: f.titulo, verificada: f.verificada })) }, 'al menos una fuente de la biblioteca; si no, se declara sin evidencia', fuentes.length > 0);

  // 5 — ACD: pregunta e hipótesis comprobable (reutiliza las existentes si ya están registradas)
  // herramientaAcd devuelve {error} en vez de lanzar; un duplicado se reutiliza (el mensaje trae su #id)
  const reuso = (m: string) => Number(/#(\d+)/.exec(m)?.[1] ?? 0);
  const acd = async (i: any, campo: string) => { const r: any = await herramientaAcd(db, i, 'kratos (ciclo cognitivo)'); return r?.error ? { id: reuso(r.error), reutilizada: true, error: r.error } : { id: Number(r?.[campo]) || 0, reutilizada: false }; };
  const pq = await acd({ accion: 'registrar_pregunta', texto: e.pregunta, origen: 'kratos', area: 'cognicion', fuente_ids: fuentes.slice(0, 3).map((f) => f.id) }, 'pregunta_id');
  const hp = pq.id ? await acd({ accion: 'imaginar', pregunta_id: pq.id, ...e.hipotesis }, 'hipotesis_id') : { id: 0, reutilizada: false, error: 'sin pregunta' };
  const okAcd = !!(pq.id && hp.id);
  await etapa(5, 'hipótesis comprobable (ACD)', 'acd', e.pregunta, { pregunta_id: pq.id || null, hipotesis_id: hp.id || null, reutilizadas: pq.reutilizada || hp.reutilizada, error: okAcd ? undefined : (hp as any).error ?? (pq as any).error },
    'pregunta e hipótesis registradas (o reutilizadas) en ACD; especulativas, no descubrimientos', okAcd);
  if (!okAcd) { await cerrarSinExito(db, o.id, 'BLOCKED', `ACD no registró la hipótesis: ${(hp as any).error ?? (pq as any).error}`, 'kratos'); return terminar('bloqueado', `ACD no registró la pregunta o la hipótesis: ${(hp as any).error ?? (pq as any).error}`); }

  // 8a — predicción ANTES del cálculo (C05)
  const pr = await predecir(db, { ...e.prediccion, hipotesis: e.hipotesis.enunciado.slice(0, 300), decision: `ciclo ${ciclo}`, experimento_ref: `ciclo ${ciclo}` }, agente);

  // 6 — cálculo: Q-LAB ausente → ejecutor aislado
  const qlab = await capacidad(db, 'q_lab');
  const r = await ejecutarAislado(e.calculo.codigo, opts.base ?? path.join(DATA_DIR, 'cognicion', 'ciclos'));
  const valor = Number(r.salida?.metricas?.[e.calculo.metrica]);
  await etapa(6, 'calcular', qlab.existe ? 'q_lab' : 'ejecutor aislado', { metrica: e.calculo.metrica }, { estado: r.estado, valor: Number.isFinite(valor) ? valor : null, carpeta: r.carpeta, sha256_salida: r.sha256_salida },
    'cálculo terminado en el sandbox con métrica numérica', r.estado === 'ok' && Number.isFinite(valor), qlab.existe ? {} : { dependencia_ausente: 'Q-LAB no existe en KRATOS: se usó el ejecutor aislado de ACD (sin red ni acceso a secretos)' });

  // 8b — observación y error de predicción
  const obs = Number.isFinite(valor) ? await observar(db, pr.id, valor, `ciclo ${ciclo}, ${r.carpeta}`, agente) : null;
  await etapa(8, 'comparar predicción y observación (C05)', 'prediccion', { prediccion: pr.valor, rango: pr.rango }, obs ? { observado: valor, error: obs.error, dentro_rango: obs.dentro_rango } : { observado: null },
    'predicción registrada antes del cálculo y comparada', !!obs);

  // 7 — evaluación con revisión independiente (C02)
  const ok = Number.isFinite(valor) && cumple(valor, e.umbral.op, e.umbral.valor);
  const dec = await registrarDecision(db, { categoria: 'ciclo:hipotesis', objetivo: e.titulo, estrategias: [{ nombre: 'aceptar provisionalmente' }, { nombre: 'rechazar' }], elegida: ok ? 'aceptar provisionalmente' : 'rechazar',
    evidencia: [{ texto: `${e.calculo.metrica} = ${Number.isFinite(valor) ? valor : 'sin dato'} (umbral ${e.umbral.op} ${e.umbral.valor})`, fuente: r.carpeta, apoya: true }, ...fuentes.slice(0, 2).map((f) => ({ texto: f.titulo, fuente: `sol_fuentes#${f.id}`, apoya: true }))],
    supuestos: ['el modelo computacional representa la hipótesis'], incertidumbre: obs && !obs.dentro_rango ? 0.6 : 0.3, confianza_declarada: 0.6, resultado_esperado: e.criterio_exito, critica: true, tarea_id: null }, agente);
  const rev = await revisarDecision(db, dec.id, VERIFICADOR, Number.isFinite(valor) ? 'aprobada' : 'rechazada', `Comprobado por código: ${e.calculo.metrica}=${valor} ${ok ? 'cumple' : 'no cumple'} ${e.umbral.op} ${e.umbral.valor}; sha256 salida ${r.sha256_salida}`);
  await resolverDecision(db, dec.id, { exito: Number.isFinite(valor), resultado_real: ok ? 'hipótesis apoyada provisionalmente por el cálculo' : 'hipótesis no apoyada por el cálculo', errores: Number.isFinite(valor) ? undefined : r.detalle, estrategia_revisada: Number.isFinite(valor) ? undefined : 'revisar el cálculo' }, agente);
  await etapa(7, 'evaluación independiente (C02)', VERIFICADOR, { decision_id: dec.id }, { veredicto: rev.veredicto, alertas: dec.alertas.map((a: any) => a.tipo), escalada: dec.estado === 'escalada' }, 'revisor distinto del autor; decisión crítica no se da por buena sin revisión', true);

  // 9 — memoria autobiográfica
  const mem = await recordar(db, { agente, objetivo: e.titulo, acciones: ['C01 puedo', 'C04 asignación', 'SOL biblioteca', 'ACD hipótesis', 'cálculo aislado', 'C02 decisión', 'C05 predicción'], herramientas: ['automodelo', 'espacio_global', 'acd', 'prediccion', 'metacognicion'],
    resultado: ok ? 'exito' : 'fallo', detalle_resultado: `${e.calculo.metrica}=${valor}; predicción ${pr.valor} → error ${obs?.error ?? 'n/d'}`, leccion: ok ? `La hipótesis «${e.hipotesis.titulo}» supera el umbral en el modelo computacional; sigue siendo provisional` : `La hipótesis «${e.hipotesis.titulo}» no supera el umbral: no reutilizar sin evidencia nueva`,
    evidencia: r.carpeta, enlaces: [{ tipo: 'decision', ref: dec.id }, { tipo: 'objetivo', ref: o.id }, { tipo: 'ciclo', ref: ciclo }], procedencia: 'ciclo cognitivo' }, 'ciclo cognitivo');
  await etapa(9, 'registrar resultado y lección (C03)', 'memoria', { decision_id: dec.id }, mem, 'experiencia registrada (o reconocida como duplicada) con procedencia y certeza', true);

  // 10 — cierre verificado o fallo verificado
  await aVerificacion(db, o.id, agente, `${e.calculo.metrica}=${valor}`);
  if (ok) {
    await completar(db, o.id, { tipo: 'ciclo_cognitivo', ref: `cog_ciclos#${ciclo}; salida sha256 ${r.sha256_salida}`, verificador: VERIFICADOR, resultado: 'ok', detalle: `${e.calculo.metrica}=${valor} ${e.umbral.op} ${e.umbral.valor}` }, VERIFICADOR);
    await etapa(10, 'completar (KRATOS)', VERIFICADOR, { objetivo_id: o.id }, { estado: 'COMPLETED' }, 'artefacto de verificación de un actor distinto del propietario', true);
    return terminar('completado', `Objetivo #${o.id} COMPLETED: ${e.calculo.metrica}=${valor} cumple ${e.umbral.op} ${e.umbral.valor} (provisional, modelo computacional)`);
  }
  await cerrarSinExito(db, o.id, 'FAILED', `Fallo verificado: ${e.calculo.metrica}=${Number.isFinite(valor) ? valor : r.detalle} no cumple ${e.umbral.op} ${e.umbral.valor}`, VERIFICADOR);
  await etapa(10, 'informar fallo verificado (KRATOS)', VERIFICADOR, { objetivo_id: o.id }, { estado: 'FAILED', explicacion: (await explicar(db, o.id)).cierre }, 'fallo con evidencia, sin maquillar', true);
  return terminar('fallido', `Objetivo #${o.id} FAILED con evidencia: ${e.calculo.metrica}=${Number.isFinite(valor) ? valor : 'sin dato'}`);
}

export async function verCiclo(db: Db, id?: number) {
  return id ? (await db.query(`SELECT * FROM cog_ciclos WHERE id = $1`, [id])).rows[0] ?? null
    : (await db.query(`SELECT id, objetivo_id, titulo, estado, resultado, created_at FROM cog_ciclos ORDER BY id DESC LIMIT 10`)).rows;
}

export const CICLO_TOOL = {
  description: 'Ciclo operativo cognitivo (TAREA 08): ver (id opcional) los ciclos ejecutados con sus 10 etapas (entrada, salida, responsable, criterio). ejecutar (entrada): recorre C01→C04→SOL→ACD→cálculo aislado→C02→C05→C03→cierre para UN objetivo comprobable con un cálculo; '
    + 'entrada = {titulo, tipo_tarea (breve: qué clase de trabajo es, para elegir agente), criterio_exito, aceptacion, capacidades[], consulta_evidencia, pregunta, hipotesis{titulo, enunciado, mecanismo}, calculo{codigo python que escribe salida.json con metricas, metrica}, prediccion{contexto, clave, prior{media, varianza, ruido}}, umbral{op, valor}}. El código se ejecuta en el sandbox (sin red ni secretos).',
  input_schema: { type: 'object', properties: { accion: { type: 'string', enum: ['ver', 'ejecutar'] }, id: { type: 'number' }, entrada: { type: 'object' } }, required: ['accion'] },
};
export async function herramientaCiclo(db: Db, i: any, _actor: string) {
  if (i.accion === 'ver') return await verCiclo(db, i.id ? Number(i.id) : undefined);
  if (i.accion === 'ejecutar') return await ejecutarCiclo(db, i.entrada as EntradaCiclo);
  return { error: 'Acción no válida' };
}

// Recuperación tras una interrupción (KRATOS se reinició a mitad de un ciclo): el ciclo queda «fallido» por interrupción con la última
// etapa alcanzada, su objetivo BLOQUEADO con el motivo (no se da por hecho ni se pierde) y las predicciones sin observar quedan señaladas.
export async function recuperarCiclos(db: Db, minutos = 30) {
  const colgados = (await db.query(`SELECT id, objetivo_id, etapas FROM cog_ciclos WHERE estado = 'en_curso' AND created_at < now() - make_interval(mins => $1)`, [minutos])).rows;
  const out = [] as any[];
  for (const c of colgados) {
    const ultima = (c.etapas ?? []).at(-1);
    const motivo = `Interrumpido tras la etapa ${ultima?.n ?? 0} (${ultima?.etapa ?? 'ninguna'}): KRATOS se detuvo a mitad del ciclo; requiere reanudar desde esa etapa`;
    await db.query(`UPDATE cog_ciclos SET estado = 'fallido', resultado = $2, cerrado_at = now() WHERE id = $1`, [c.id, motivo]);
    if (c.objetivo_id) {
      const o = (await db.query(`SELECT estado FROM cog_objetivos WHERE id = $1`, [c.objetivo_id])).rows[0];
      if (o && ['ACTIVE', 'VERIFYING'].includes(o.estado)) {
        await db.query(`UPDATE cog_objetivos SET estado = 'BLOCKED', motivo_cierre = $2, updated_at = now() WHERE id = $1`, [c.objetivo_id, motivo]);
        await db.query(`INSERT INTO cog_transiciones (objetivo_id, de, a, actor, motivo) VALUES ($1,$2,'BLOCKED','recuperacion',$3)`, [c.objetivo_id, o.estado, motivo]);
      }
    }
    const pend = (await db.query(`SELECT id FROM cog_predicciones WHERE experimento_ref = $1 AND observado IS NULL`, [`ciclo ${c.id}`])).rows.map((x) => x.id);
    out.push({ ciclo: c.id, objetivo: c.objetivo_id, motivo, predicciones_sin_observar: pend });
    await audit(db, 'recuperacion', 'cog.ciclo_interrumpido', { ciclo: c.id, objetivo: c.objetivo_id });
  }
  return out;
}
