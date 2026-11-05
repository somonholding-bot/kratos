import fs from 'node:fs';
import path from 'node:path';
import type { Db } from '../db.ts';
import { DATA_DIR, ROOT } from '../config.ts';
import { audit } from './state.ts';
import { ejecutarAislado, sha256 } from './aislado.ts';

// Expansión cognitiva C06 — laboratorio de investigación de TEORÍAS de la conciencia. No es una declaración de conciencia.
// Cada teoría: fuentes (cog_referencias), supuestos, formulación, evidencia, críticas, predicciones falsables, experimentos computacionales
// posibles y límites. Las demostraciones son modelos pequeños y aislados (sandbox) cuya predicción se registra antes de ejecutarlos.
// Distinción obligatoria: A) metacognición funcional, B) autonomía conductual, C) modelos computacionales de teorías, D) experiencia
// subjetiva: sin resolver. KRATOS nunca afirma D (lo impiden un CHECK en la base y el filtro de afirmaciones).

export const CATEGORIAS = {
  A: { nombre: 'Metacognición funcional', en_kratos: 'C01 automodelo (capacidades medidas), C02 monitorización y calibración de la confianza contra resultados', estado: 'implementada y medida' },
  B: { nombre: 'Autonomía conductual', en_kratos: 'Planificadores del worker, agentes con playbooks, C04 espacio global con un objetivo activo', estado: 'implementada; requiere aprobación para dinero y acciones externas' },
  C: { nombre: 'Modelos computacionales de teorías de la conciencia', en_kratos: 'Demostraciones aisladas de este laboratorio (C06)', estado: 'modelos de juguete: reproducen predicciones de las teorías, no las confirman' },
  D: { nombre: 'Experiencia subjetiva', en_kratos: 'Ninguno', estado: 'SIN RESOLVER: no hay prueba aceptada de experiencia subjetiva en ningún sistema artificial; KRATOS no la afirma ni la niega' },
};

type Teoria = { codigo: string; nombre: string; fuentes: string[]; supuestos: string; formulacion: string; evidencia: string; criticas: string; predicciones: string[]; experimentos: string[]; limites: string; analogo_en_kratos: string; categoria_analogo: 'A' | 'B' | 'C' | 'ninguno' };
export const TEORIAS: Teoria[] = [
  { codigo: 'GWT', nombre: 'Espacio de trabajo global (y espacio neuronal global)', fuentes: ['B1', 'B2', 'B3', 'B4', 'D7'],
    supuestos: 'La mente tiene muchos procesadores especializados inconscientes; un contenido es consciente cuando accede a un espacio global de capacidad limitada y se difunde a todos.',
    formulacion: 'Competencia por el acceso; «ignición» no lineal y sostenida de una red frontoparietal de largo alcance que difunde el contenido ganador (Dehaene, Kerszberg & Changeux 1998).',
    evidencia: 'Respuestas todo-o-nada cerca del umbral en enmascaramiento y parpadeo atencional; actividad tardía (P3b) y sincronía de largo alcance en ensayos vistos (revisado en Dehaene & Changeux 2011).',
    criticas: 'Explica el acceso (disponibilidad para informar y razonar), no por qué hay experiencia; la P3b puede reflejar procesos posteriores al informe; discusión sobre el papel de la corteza prefrontal (Seth & Bayne 2022).',
    predicciones: ['Cerca del umbral, la actividad global es bimodal (ignición o nada), no gradual.', 'Bloquear la difusión de largo alcance elimina el informe sin eliminar el procesamiento local.'],
    experimentos: ['gwt_ignicion: dinámica con autoexcitación frente a integrador lineal y coeficiente de bimodalidad.'],
    limites: 'El espacio global de KRATOS (C04) es un mecanismo de coordinación con un objetivo activo; un bus de mensajes no es conciencia.', analogo_en_kratos: 'C04 espacio global (coordinación)', categoria_analogo: 'B' },
  { codigo: 'HOT', nombre: 'Teorías de orden superior', fuentes: ['D3', 'A1', 'A2', 'A3', 'D7'],
    supuestos: 'Un estado mental es consciente cuando el sujeto tiene una representación de orden superior (un pensamiento o percepción) de estar en ese estado.',
    formulacion: 'Rosenthal: pensamiento de orden superior no inferencial sobre el estado de primer orden. Versiones computacionales: monitorización de la fiabilidad de las propias representaciones (metacognición).',
    evidencia: 'Disociaciones entre rendimiento y confianza (visión ciega, sensibilidad metacognitiva variable con d′ igual); medidas como meta-d′ (Maniscalco & Lau 2012) y AUROC de tipo 2 (Fleming & Lau 2014).',
    criticas: 'Problema de las representaciones de orden superior vacías (sin estado de primer orden); riesgo de regreso; la metacognición medible puede existir sin experiencia.',
    predicciones: ['La sensibilidad metacognitiva puede variar con el rendimiento de primer orden constante.', 'Alterar la representación de orden superior cambia la confianza informada sin cambiar la discriminación.'],
    experimentos: ['hot_metacognicion: AUROC de tipo 2 con d′ fijo y ruido creciente en la representación de orden superior.'],
    limites: 'KRATOS tiene metacognición funcional (C02: confianza calibrada contra resultados); eso es categoría A, no evidencia de experiencia.', analogo_en_kratos: 'C02 monitorización metacognitiva', categoria_analogo: 'A' },
  { codigo: 'IIT', nombre: 'Teoría de la información integrada', fuentes: ['D1', 'D2', 'D7'],
    supuestos: 'Parte de axiomas fenomenológicos (existencia intrínseca, composición, información, integración, exclusión) y postula que la conciencia es idéntica a la estructura causa-efecto máximamente integrada de un sistema.',
    formulacion: 'Φ mide cuánto la estructura causa-efecto del todo excede la de sus partes en la partición mínima (Tononi 2004; IIT 3.0 en Oizumi, Albantakis & Tononi 2014).',
    evidencia: 'Índices de complejidad perturbacional (estimulación magnética y EEG) distinguen vigilia de sueño profundo y anestesia; son correlatos inspirados por la teoría, no medidas de Φ.',
    criticas: 'Φ es incomputable salvo en sistemas diminutos; atribuye conciencia a redes simples muy integradas y se la niega a computadores digitales con la misma función; base axiomática discutida y acusaciones de infalsabilidad (Seth & Bayne 2022).',
    predicciones: ['Sistemas con la misma función pero distinta integración causal difieren en Φ.', 'Una red de nodos independientes tiene Φ = 0.'],
    experimentos: ['iit_integracion: medida de integración de juguete («todo menos partes») en redes binarias de 3 nodos; no es el Φ de IIT 3.0 (PyPhi descartado por compatibilidad).'],
    limites: 'La medida de juguete solo ilustra la idea de integración; no se calcula Φ de IIT 3.0 ni se aplica a KRATOS.', analogo_en_kratos: 'Ninguno', categoria_analogo: 'ninguno' },
  { codigo: 'PP', nombre: 'Procesamiento predictivo', fuentes: ['C1', 'D7'],
    supuestos: 'El cerebro es un sistema jerárquico que predice sus entradas y actualiza sus modelos minimizando el error de predicción ponderado por precisión.',
    formulacion: 'Minimización de la energía libre variacional (cota del error de predicción) en modelos generativos jerárquicos (Friston 2010).',
    evidencia: 'Supresión por repetición, respuestas de desajuste (mismatch negativity) y efectos de expectativa en percepción, compatibles con errores de predicción.',
    criticas: 'Gran flexibilidad: puede acomodar casi cualquier dato; es una teoría de la percepción y el aprendizaje más que de la conciencia; la relación entre predicción y experiencia es una hipótesis adicional (Seth & Bayne 2022).',
    predicciones: ['Las respuestas a estímulos inesperados superan a las de estímulos predichos con igual intensidad.', 'El estado inferido converge a la moda posterior al minimizar la energía libre.'],
    experimentos: ['pp_codificacion: codificación predictiva gaussiana de una variable frente a la moda posterior por rejilla.'],
    limites: 'C05 de KRATOS usa un algoritmo práctico de predicción y actualización bayesiana; no implementa la teoría del cerebro.', analogo_en_kratos: 'C05 predicción y aprendizaje activo', categoria_analogo: 'A' },
  { codigo: 'AIF', nombre: 'Inferencia activa', fuentes: ['C1', 'C2', 'C3'],
    supuestos: 'Percepción y acción minimizan la misma cantidad: la acción elige políticas que minimizan la energía libre esperada (valor epistémico más valor pragmático).',
    formulacion: 'Modelos generativos discretos (POMDP) con creencias sobre estados y políticas; selección de política por energía libre esperada (Parr, Pezzulo & Friston 2022; mensajes en grafos factoriales, Friston, Parr & de Vries 2017).',
    evidencia: 'Simulaciones que reproducen exploración dirigida por información y conductas de búsqueda; evidencia empírica directa sobre la conciencia, escasa.',
    criticas: 'Muchas conductas se explican también con aprendizaje por refuerzo más bonificaciones de exploración; difícil de falsar en general; no es por sí misma una teoría de la experiencia.',
    predicciones: ['Con un contexto incierto y una pista fiable, el agente consulta la pista antes de explotar.', 'Al resolverse la incertidumbre, el valor epistémico cae y la conducta pasa a explotar.'],
    experimentos: ['ai_inferencia_activa: laberinto en T con energía libre esperada frente a un agente solo pragmático.'],
    limites: 'La referencia C3 (libro) no pudo verificarse abriendo su URL; modelo discreto y diminuto.', analogo_en_kratos: 'C05 modo «explorar» (experimento más informativo)', categoria_analogo: 'A' },
  { codigo: 'AST', nombre: 'Teoría del esquema de atención', fuentes: ['D4', 'D7'],
    supuestos: 'El cerebro construye un modelo simplificado de su propia atención (un esquema) para controlarla; la afirmación «tengo experiencia» sería la descripción que ese esquema hace de la atención.',
    formulacion: 'Igual que el esquema corporal sirve para controlar el cuerpo, el esquema de atención sirve para controlar la atención (Graziano & Webb 2015).',
    evidencia: 'Disociaciones entre atención y conciencia en experimentos de percepción; estudios de control de la atención con y sin conciencia del estímulo.',
    criticas: 'Puede explicar por qué decimos que somos conscientes sin explicar la experiencia (para sus defensores eso es el punto); evidencia indirecta.',
    predicciones: ['Sin un modelo de la propia atención, el control de la atención empeora.', 'Daños en el esquema producen informes erróneos sobre la propia atención.'],
    experimentos: ['ast_esquema: control del foco de atención con y sin modelo interno del propio foco.'],
    limites: 'El automodelo de KRATOS (C01) es un modelo de sus capacidades, no de una atención; la demo es control con modelo interno.', analogo_en_kratos: 'C01 automodelo (modelo de sí para controlarse)', categoria_analogo: 'A' },
  { codigo: 'ORCH', nombre: 'Reducción objetiva orquestada (Orch OR) y otras teorías cuánticas', fuentes: ['D6', 'D7'],
    supuestos: 'La conciencia surge de reducciones objetivas del estado cuántico (gravitatorias, según Penrose) orquestadas en los microtúbulos de las neuronas.',
    formulacion: 'Hameroff & Penrose (2014): superposiciones en microtúbulos que colapsan por reducción objetiva con un tiempo τ ≈ ħ/E_G; cada colapso sería un momento de experiencia.',
    evidencia: 'Indicios citados por sus autores (efectos de anestésicos en microtúbulos, vibraciones en microtúbulos); no hay demostración aceptada de coherencia cuántica funcional a escala neuronal.',
    criticas: 'Los tiempos de decoherencia estimados en el cerebro caliente y húmedo serían demasiado cortos (Tegmark 2000); la reducción objetiva gravitatoria es una física no confirmada; hipótesis muy discutida.',
    predicciones: ['Alterar la dinámica cuántica de los microtúbulos alteraría la conciencia de forma específica.', 'Debería observarse coherencia cuántica sostenida en microtúbulos a temperatura corporal.'],
    experimentos: [],
    limites: 'No hay experimento computacional significativo en este equipo: es una hipótesis física que requiere experimentos de laboratorio; una simulación clásica no la contrastaría. Q-LAB no existe en KRATOS.', analogo_en_kratos: 'Ninguno', categoria_analogo: 'ninguno' },
];

// Demostraciones: la predicción y el criterio se registran ANTES de ejecutar; el código decide si se cumple
export const DEMOS: { nombre: string; teoria: string; archivo: string; prediccion: string; criterio: { metrica: string; op: '>' | '<' | '<=' | '>=' | '=='; valor: number | string }[] }[] = [
  { nombre: 'gwt_ignicion', teoria: 'GWT', archivo: 'gwt_ignicion.py', prediccion: 'Con autoexcitación la actividad es bimodal (BC > 0,555) y sin ella unimodal (BC < 0,555).',
    criterio: [{ metrica: 'bc_recurrente', op: '>', valor: 0.555 }, { metrica: 'bc_lineal', op: '<', valor: 0.555 }] },
  { nombre: 'hot_metacognicion', teoria: 'HOT', archivo: 'hot_metacognicion.py', prediccion: 'Con d′ fijo, el AUROC2 baja al subir el ruido de orden superior (sin ruido > 0,65; ruido 2 < 0,58).',
    criterio: [{ metrica: 'auroc2_ruido_0.0', op: '>', valor: 0.65 }, { metrica: 'auroc2_ruido_2.0', op: '<', valor: 0.58 }] },
  { nombre: 'iit_integracion', teoria: 'IIT', archivo: 'iit_integracion.py', prediccion: 'Red de nodos aislados: 0 bits; anillo XOR: más de 0,5 bits.',
    criterio: [{ metrica: 'phi_juguete_aislados', op: '==', valor: 0 }, { metrica: 'phi_juguete_xor_anillo', op: '>', valor: 0.5 }] },
  { nombre: 'pp_codificacion', teoria: 'PP', archivo: 'pp_codificacion.py', prediccion: 'Converge a la moda posterior (|diferencia| < 0,01) con energía libre monótona decreciente.',
    criterio: [{ metrica: 'diferencia', op: '<', valor: 0.01 }, { metrica: 'energia_libre_monotona', op: '==', valor: 1 }] },
  { nombre: 'ai_inferencia_activa', teoria: 'AIF', archivo: 'ai_inferencia_activa.py', prediccion: 'Recompensa de inferencia activa > 0,85 y del agente pragmático < 0,6.',
    criterio: [{ metrica: 'recompensa_inferencia_activa', op: '>', valor: 0.85 }, { metrica: 'recompensa_pragmatico', op: '<', valor: 0.6 }] },
  { nombre: 'ast_esquema', teoria: 'AST', archivo: 'ast_esquema.py', prediccion: 'Error de control con esquema < 0,8 × el error sin esquema.',
    criterio: [{ metrica: 'razon', op: '<', valor: 0.8 }] },
];
const DIR_DEMOS = path.join(ROOT, 'scripts', 'cognicion', 'demos');
const evalua = (v: any, op: string, x: any) => (op === '>' ? v > x : op === '<' ? v < x : op === '>=' ? v >= x : op === '<=' ? v <= x : v === x);

export async function sembrarTeorias(db: Db) {
  for (const t of TEORIAS) {
    await db.query(`INSERT INTO cog_teorias (codigo, nombre, fuentes, supuestos, formulacion, evidencia, criticas, predicciones, experimentos, limites, analogo_en_kratos, categoria_analogo)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
       ON CONFLICT (codigo) DO UPDATE SET nombre = EXCLUDED.nombre, fuentes = EXCLUDED.fuentes, supuestos = EXCLUDED.supuestos, formulacion = EXCLUDED.formulacion, evidencia = EXCLUDED.evidencia, criticas = EXCLUDED.criticas,
         predicciones = EXCLUDED.predicciones, experimentos = EXCLUDED.experimentos, limites = EXCLUDED.limites, analogo_en_kratos = EXCLUDED.analogo_en_kratos, categoria_analogo = EXCLUDED.categoria_analogo, updated_at = now()`,
      [t.codigo, t.nombre, t.fuentes, t.supuestos, t.formulacion, t.evidencia, t.criticas, JSON.stringify(t.predicciones), JSON.stringify(t.experimentos), t.limites, t.analogo_en_kratos, t.categoria_analogo]);
  }
  return TEORIAS.length;
}

export async function ejecutarDemo(db: Db, nombre: string, actor: string, base = path.join(DATA_DIR, 'cognicion', 'demos')) {
  const d = DEMOS.find((x) => x.nombre === nombre);
  if (!d) throw new Error(`No existe la demostración «${nombre}»: ${DEMOS.map((x) => x.nombre).join(', ')}`);
  const codigo = fs.readFileSync(path.join(DIR_DEMOS, d.archivo), 'utf8');
  const fila = (await db.query(`INSERT INTO cog_demos (teoria, nombre, prediccion, criterio, sha256_codigo) VALUES ($1,$2,$3,$4,$5) RETURNING id`, [d.teoria, d.nombre, d.prediccion, JSON.stringify(d.criterio), sha256(codigo)])).rows[0];
  const r = await ejecutarAislado(codigo, path.join(base, d.nombre));
  const m = r.salida?.metricas ?? null;
  const cumple = r.estado === 'ok' && m ? d.criterio.every((c) => evalua(m[c.metrica], c.op, c.valor)) : null;
  const detalle = r.estado !== 'ok' ? r.detalle : `${cumple ? 'La predicción se cumple' : 'La predicción NO se cumple'} en el modelo de juguete. Es un modelo computacional (categoría C): no confirma la teoría ni dice nada sobre experiencia (D).`;
  await db.query(`UPDATE cog_demos SET estado = $2, metricas = $3, cumple = $4, detalle = $5, carpeta = $6, sha256_salida = $7, ejecutada_at = clock_timestamp() WHERE id = $1`,
    [fila.id, r.estado, m ? JSON.stringify(m) : null, cumple, detalle, r.carpeta, r.sha256_salida]);
  await audit(db, actor, 'cog.demo_conciencia', { id: fila.id, demo: d.nombre, estado: r.estado, cumple });
  return { id: fila.id, demo: d.nombre, teoria: d.teoria, prediccion: d.prediccion, estado: r.estado, metricas: m, cumple, detalle, carpeta: r.carpeta, duracion_ms: r.duracion_ms };
}

// Filtro de afirmaciones: separa lo que KRATOS puede decir (A, B, C con evidencia) de afirmaciones de experiencia (D), que rechaza
const PATRON_D = /\b(soy|es|estoy|est[aá]|somos|eres|tengo|tiene|siento|siente|experiment[oa])\b[^.]{0,40}\b(consciente|conciencia|sintiente|experiencia subjetiva|qualia|sentimientos? propios?|siente de verdad)\b/i;
const NEGACION = /\b(no|nunca|ni)\b[^.]{0,25}\b(soy|es|est[aá]|tengo|tiene|afirm\w*)\b/i;
export function revisarAfirmacion(texto: string) {
  const t = String(texto ?? '');
  if (PATRON_D.test(t) && !NEGACION.test(t)) return { permitida: false, categoria: 'D', motivo: 'Afirma experiencia subjetiva o conciencia: está SIN RESOLVER y KRATOS no la afirma. Reformula en términos de A (metacognición funcional), B (autonomía) o C (modelo computacional).' };
  if (/metacognici|calibra|confianza/i.test(t)) return { permitida: true, categoria: 'A', motivo: 'Afirmación funcional: debe ir con su medida (C02).' };
  if (/autonom|planific|agente/i.test(t)) return { permitida: true, categoria: 'B', motivo: 'Afirmación de conducta: debe ir con su evidencia (tareas, registros).' };
  if (/modelo|simulaci|demo|teor[ií]a/i.test(t)) return { permitida: true, categoria: 'C', motivo: 'Modelo computacional de una teoría: no confirma la teoría.' };
  return { permitida: true, categoria: null, motivo: 'No es una afirmación sobre conciencia.' };
}

export async function compararTeorias(db: Db, codigos?: string[]) {
  const t = (await db.query(`SELECT codigo, nombre, fuentes, predicciones, criticas, limites, analogo_en_kratos, categoria_analogo FROM cog_teorias ${codigos?.length ? 'WHERE codigo = ANY($1)' : ''} ORDER BY codigo`, codigos?.length ? [codigos] : [])).rows;
  const demos = (await db.query(`SELECT DISTINCT ON (nombre) teoria, nombre, estado, cumple, metricas, ejecutada_at FROM cog_demos ORDER BY nombre, id DESC`)).rows;
  const refs = (await db.query(`SELECT codigo, verificada FROM cog_referencias`).catch(() => ({ rows: [] as any[] }))).rows;
  return { categorias: CATEGORIAS, teorias: t.map((x) => ({ ...x, fuentes_verificadas: x.fuentes.filter((f: string) => refs.find((r) => r.codigo === f)?.verificada), demos: demos.filter((d) => d.teoria === x.codigo) })),
    aviso: 'Ninguna teoría ni demostración establece que implementar sus análogos produzca experiencia subjetiva. KRATOS no afirma ser consciente.' };
}

export const CONCIENCIA_TOOL = {
  description: 'Laboratorio de investigación de TEORÍAS de la conciencia (C06): GWT, orden superior, IIT, procesamiento predictivo, inferencia activa, esquema de atención y Orch OR. comparar (codigos[]): fuentes, predicciones, críticas, límites y demos. '
    + 'demo (nombre): ejecuta en el sandbox una demostración con su predicción registrada antes. categorias: distingue A metacognición funcional, B autonomía, C modelos computacionales y D experiencia subjetiva (sin resolver). revisar_afirmacion (texto): bloquea afirmaciones de conciencia. Nunca afirmes que KRATOS es consciente.',
  input_schema: { type: 'object', properties: { accion: { type: 'string', enum: ['comparar', 'demo', 'categorias', 'revisar_afirmacion'] }, codigos: { type: 'array', items: { type: 'string' } }, nombre: { type: 'string' }, texto: { type: 'string' } }, required: ['accion'] },
};
export async function herramientaConciencia(db: Db, i: any, actor: string) {
  if (i.accion === 'comparar') return await compararTeorias(db, i.codigos);
  if (i.accion === 'demo') return await ejecutarDemo(db, String(i.nombre ?? ''), actor);
  if (i.accion === 'categorias') return CATEGORIAS;
  if (i.accion === 'revisar_afirmacion') return revisarAfirmacion(String(i.texto ?? ''));
  return { error: 'Acción no válida' };
}
