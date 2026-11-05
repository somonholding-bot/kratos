import { withTx, type Db } from '../db.ts';
import { audit } from './state.ts';

// PROJECT SOL / ACD: la directiva del propietario (docs/SOL-DIRECTIVA-ACD.md) convertida en datos que el código puede rastrear.
//  · REQUISITOS: los 139 identificadores del rastreador permanente (tabla sol_requisitos), en el orden de la directiva.
//  · UNIDADES: las 80 unidades de investigación (56 materias S/H/V, 12 puentes B y 12 temas de ingeniería generativa G).
//  · FUSION_MODULOS: módulos todavía pendientes del currículo anterior (sol_modulos) que absorbe una materia nueva,
//    para no estudiar nada dos veces. Los módulos completados (1–4) se conservan y se reutilizan (modulos_previos).
// La siembra es idempotente y nunca toca estado, evidencia ni fechas de verificación: eso solo cambia con pruebas reales.

export type Requisito = { id: string; etapa: 1 | 2 | 3; grupo: string; descripcion: string };
export type Unidad = { codigo: string; tipo: 'materia' | 'puente' | 'generativa'; area: string; titulo: string; alcance: string; orden: number; relacionadas: string[]; modulos_previos: number[] };

type T3 = [string, string, string];   // [código, título, temario tal como lo da la directiva]
type T2 = [string, string];           // [código, descripción]

// ---------- Etapa 1 · Sección A: 20 materias científicas y filosóficas ----------
const S: T3[] = [
  ['S01', 'Matemáticas', 'álgebra, álgebra lineal, geometría, trigonometría, cálculo, cálculo multivariable, ecuaciones diferenciales, probabilidad, estadística, tensores, topología, teoría de números, métodos numéricos, física matemática, optimización, demostración.'],
  ['S02', 'Lógica y epistemología', 'lógica formal, razonamiento deductivo e inductivo, abducción, causalidad, método científico, falsabilidad, razonamiento bayesiano, filosofía de la ciencia, selección de modelos, diseño experimental, incertidumbre epistémica.'],
  ['S03', 'Física clásica', 'mecánica newtoniana, movimiento, fuerzas, gravitación, fluidos, termodinámica, óptica, acústica, electromagnetismo clásico, leyes de conservación, osciladores, ondas.'],
  ['S04', 'Física cuántica', 'estados, función de onda, superposición, incertidumbre, interferencia, doble rendija, medición, decoherencia, entrelazamiento, información cuántica, interpretaciones, fundamentos de teoría cuántica de campos.'],
  ['S05', 'Física nuclear y atómica', 'estructura atómica, núcleos, isótopos, radiactividad, energía de enlace, interacciones fuerte y débil, fusión, fisión, física de partículas, Modelo Estándar (trabajo experimental y computacional dentro de límites de seguridad aprobados).'],
  ['S06', 'Química', 'tabla periódica, enlace, estructura molecular, reacciones, termoquímica, fisicoquímica, química orgánica e inorgánica, química cuántica, electroquímica, autoensamblaje molecular.'],
  ['S07', 'Ciencia de materiales', 'cristalografía, física del estado sólido, semiconductores, superconductores, nanomateriales, metamateriales, transiciones de fase, materiales magnéticos, propiedades emergentes.'],
  ['S08', 'Cosmología y astronomía', 'universo temprano, Big Bang, formación estelar, galaxias, agujeros negros, ondas gravitacionales, fondo cósmico de microondas, materia oscura, energía oscura, formación de estructuras.'],
  ['S09', 'Relatividad y tiempo', 'relatividad especial y general, espacio-tiempo, efectos gravitatorios, dilatación temporal, causalidad, tiempo termodinámico, entropía, percepción del tiempo, preguntas abiertas sobre el tiempo.'],
  ['S10', 'Biología', 'origen de la vida, biología celular, genética, evolución, microbiología, biología molecular, fisiología, ecología, organización biológica.'],
  ['S11', 'Bioquímica y biofísica', 'proteínas, enzimas, metabolismo, energía celular, motores moleculares, membranas, señalización, bioelectricidad, organización física de los seres vivos.'],
  ['S12', 'Neurociencia', 'neuronas, redes, sistemas cerebrales, percepción, memoria, atención, emociones, oscilaciones neurales, sueño, sueños, sueño lúcido, conciencia. Reutilizar los módulos ya completados y evaluar el dominio existente antes de programar más estudio.'],
  ['S13', 'Psicología', 'cognitiva, emocional, motivación, miedo, amor, deseo, inseguridad, conducta, personalidad, aprendizaje, procesos inconscientes, decisiones, necesidades humanas.'],
  ['S14', 'Ciencia cognitiva', 'representación mental, inteligencia, lenguaje, creatividad, imaginación, razonamiento, modelos de conciencia, arquitecturas cognitivas, resolución de problemas.'],
  ['S15', 'Información y computación', 'teoría de la información, algoritmos, complejidad, aprendizaje automático, IA, neurociencia computacional, computación cuántica, modelos computacionales de sistemas físicos.'],
  ['S16', 'Sistemas complejos', 'caos, dinámica no lineal, emergencia, autoorganización, fractales, redes, sincronización, retroalimentación, sistemas adaptativos, comportamiento colectivo.'],
  ['S17', 'Ingeniería e invención', 'diseño generativo, ingeniería computacional, control, robótica, optimización, simulación, gemelos digitales, prototipado rápido, experimentación de ingeniería.'],
  ['S18', 'Filosofía y metafísica', 'ontología, filosofía de la mente, identidad, existencia, fisicalismo, idealismo, dualismo, panpsiquismo, causalidad, conciencia, explicaciones rivales de la realidad.'],
  ['S19', 'Hermetismo y esoterismo, fundamentos interdisciplinarios', 'filosofía hermética histórica, alquimia, cosmologías esotéricas, sistemas simbólicos, correspondencia, mentalismo, relación entre filosofía oculta y filosofía natural.'],
  ['S20', 'Historia del conocimiento', 'filosofía antigua, filosofía natural, historia de las matemáticas, alquimia, revoluciones científicas, historia de los métodos experimentales, evolución de las teorías.'],
];

// ---------- Etapa 1 · Sección B: 24 materias herméticas y esotéricas ----------
const H: T3[] = [
  ['H01', 'Hermetismo clásico', 'Corpus Hermeticum, Asclepio, Poimandres, Nous, Logos, creación, cosmología, fundamentos filosóficos.'],
  ['H02', 'Filosofía hermética', 'unidad, emanación, macrocosmos y microcosmos, transformación, conocimiento, mente y naturaleza.'],
  ['H03', 'Siete principios del Kybalión', 'mentalismo, correspondencia, vibración, polaridad, ritmo, causa y efecto, género; historia textual y posibles interpretaciones científicas por separado.'],
  ['H04', 'Tabla Esmeralda', 'versiones históricas, transmisión textual, correspondencia, transformación, unidad, interpretaciones alquímicas.'],
  ['H05', 'Alquimia espiritual', 'nigredo, albedo, rubedo, prima materia, la Gran Obra, transformación simbólica.'],
  ['H06', 'Alquimia histórica y de laboratorio', 'azufre, mercurio, sal, operaciones alquímicas, experimentación histórica, desarrollo de la química.'],
  ['H07', 'Magia natural', 'Agrippa, Paracelso, Ficino, filosofía natural renacentista, correspondencias, teorías de propiedades ocultas.'],
  ['H08', 'Cábala y Qabalah hermética', 'Árbol de la Vida, sefirot, emanación, correspondencias, diferencias entre la cábala judía y la Qabalah hermética posterior.'],
  ['H09', 'Rosacrucismo', 'Fama Fraternitatis, Confessio Fraternitatis, Bodas Químicas, historia, filosofía iniciática.'],
  ['H10', 'Franz Bardon', 'Iniciación al Hermetismo, los elementos, Akasha, concentración, imaginación, voluntad, su modelo de desarrollo espiritual.'],
  ['H11', 'B.O.T.A.', 'Paul Foster Case, Ann Davies, simbolismo del tarot, meditación, Qabalah, formación iniciática.'],
  ['H12', 'Golden Dawn', 'grados, simbolismo ceremonial, sistemas elementales, astrología, documentos históricos publicados.'],
  ['H13', 'Martinismo', 'Louis-Claude de Saint-Martin, Martinez de Pasqually, reintegración, filosofía mística.'],
  ['H14', 'Teosofía', 'Blavatsky, Besant, Leadbeater, cosmología esotérica, historia del movimiento.'],
  ['H15', 'Antroposofía', 'Rudolf Steiner, epistemología espiritual, cosmología, interpretaciones de la naturaleza.'],
  ['H16', 'Neoplatonismo y teúrgia', 'Plotino, Jámblico, Proclo, el Uno, el Intelecto, emanación, teúrgia.'],
  ['H17', 'Gnosticismo', 'textos de Nag Hammadi, conocimiento, relatos de creación, cosmologías gnósticas rivales.'],
  ['H18', 'Tradiciones religiosas e iniciáticas egipcias', 'Thot, cosmologías egipcias, tradiciones de templo, textos religiosos, relación histórica con el hermetismo posterior.'],
  ['H19', 'Yoga y tantra', 'prana, nadis, chakras, kundalini, meditación, concentración, respiración, sistemas contemplativos históricos.'],
  ['H20', 'Taoísmo y alquimia interna', 'qi, yin-yang, alquimia interna, respiración, contemplación, transformación.'],
  ['H21', 'Magia ceremonial y grimorios', 'grimorios históricos, símbolos, estructuras rituales, correspondencias, tradiciones manuscritas, interpretaciones iniciáticas.'],
  ['H22', 'Mesmerismo y magnetismo', 'Mesmer, magnetismo animal, sugestión, hipnosis, desarrollo histórico de las explicaciones psicológicas.'],
  ['H23', 'Parapsicología histórica', 'telepatía, psicoquinesis, percepción extrasensorial, parapsicología experimental, crítica metodológica, replicación.'],
  ['H24', 'Modelos esotéricos contemporáneos', 'Jacobo Grinberg, teoría sintérgica, mentalismo moderno, modelos alternativos de conciencia e investigación relacionada.'],
];

// ---------- Etapa 1 · Sección C: 12 especializaciones en materia y vibración ----------
const V: T3[] = [
  ['V01', 'Física de las vibraciones', 'frecuencia, amplitud, fase, oscilador armónico, modos normales, osciladores acoplados.'],
  ['V02', 'Ondas y resonancia', 'propagación, interferencia, ondas estacionarias, radiación electromagnética, resonancia acústica y no lineal.'],
  ['V03', 'Campos cuánticos', 'excitaciones de campo, interacciones de partículas, estados de vacío, relación matemática entre campos y partículas.'],
  ['V04', 'Vibraciones en sólidos', 'fonones, redes cristalinas, excitaciones colectivas, propiedades dependientes de la vibración.'],
  ['V05', 'Sincronización natural', 'osciladores acoplados, ritmos biológicos, enganche de fase, coherencia, fenómenos de sincronización.'],
  ['V06', 'Formación de patrones', 'reacción-difusión, patrones de ondas estacionarias, autoorganización, estructuras no lineales.'],
  ['V07', 'Simetría y ruptura de simetría', 'principios de simetría, ruptura espontánea, transiciones de fase, estructura emergente.'],
  ['V08', 'Origen de la materia', 'física del universo temprano, producción de partículas, bariogénesis, nucleosíntesis, asimetría materia-antimateria.'],
  ['V09', 'Formación atómica y molecular', 'estructura electrónica, enlace, estados de energía, estabilidad molecular, autoensamblaje.'],
  ['V10', 'Información y organización física', 'entropía, información, complejidad, computación física, descripciones informacionales de la materia.'],
  ['V11', 'Escala y correspondencia', 'fractales, leyes de escala, renormalización, universalidad, semejanzas entre escalas y los límites de esas analogías.'],
  ['V12', 'Conciencia y observación', 'medición cuántica, conciencia, percepción, intención, interacción con instrumentos, hipótesis mente-materia comprobables.'],
];

// ---------- Etapa 1 · Infraestructura de fuentes (conectores con procedencia) ----------
const R: T2[] = [
  ['R01', 'OpenAlex: descubrimiento de literatura, citas, autores, instituciones, mapa de temas.'],
  ['R02', 'arXiv: preprints de física, matemáticas, computación y otras.'],
  ['R03', 'Semantic Scholar: trabajos relacionados, redes de citas.'],
  ['R04', 'Crossref: metadatos DOI y verificación de publicación.'],
  ['R05', 'PubMed y Europe PMC: neurociencia, psicología, biología, medicina y texto completo disponible.'],
  ['R06', 'INSPIRE-HEP: física de partículas y altas energías.'],
  ['R07', 'OSTI: energía, física e informes técnicos.'],
  ['R08', 'NASA NTRS y NASA ADS: investigación aeroespacial, astronomía, astrofísica, documentación técnica.'],
  ['R09', 'Unpaywall y repositorios institucionales: texto completo de acceso abierto legal.'],
  ['R10', 'Internet Archive y Project Gutenberg: obras históricas, dominio público, publicaciones digitalizadas autorizadas.'],
  ['R11', 'Hermetic Library y Esoteric Archives: literatura hermética, grimorios históricos, materiales de referencia esotérica.'],
  ['R12', 'Internet Sacred Text Archive e IAPSOP: colecciones históricas espirituales, ocultistas y filosóficas.'],
  ['R13', 'Colecciones académicas de esoterismo: recursos Hermetica de la Universidad de Ámsterdam, directorios de la ESSWE, catálogos de manuscritos, archivos universitarios.'],
  ['R14', 'Materiales raros e iniciáticos: manuscritos históricos accesibles legalmente, textos iniciáticos publicados, archivos de órdenes, correspondencia, documentos autenticados.'],
  ['R15', 'Sci-Hub como contexto de investigación: estudiar el Sci-Hub de Alexandra Elbakyan como hito histórico del acceso a la literatura. No eludir muros de pago ni obtener material con derechos sin autorización; usar alternativas legales basadas en DOI para la ingesta automática.'],
  ['R16', 'Preprints y resultados negativos: preprints, replicaciones fallidas, retractaciones, estudios negativos e hipótesis archivadas.'],
];

// ---------- Etapa 2: 12 puentes hermético-científicos ----------
const B: T3[] = [
  ['B01', 'Mentalismo y conciencia', 'idealismo, conciencia, percepción, atención, información, interacciones mente-materia comprobables.'],
  ['B02', 'Correspondencia y escala', 'analogías microcosmos-macrocosmos, escalado matemático, autosemejanza, fractales, clases de universalidad, diferencias entre escalas físicas.'],
  ['B03', 'Vibración y materia', 'dinámica de ondas, campos cuánticos, resonancia, sistemas oscilatorios, estructura material, mecanismos físicos de organización.'],
  ['B04', 'Polaridad y simetría', 'dualidades matemáticas, variables complementarias, simetría, opuestos y límites de la comparación simbólica.'],
  ['B05', 'Ritmo y ciclos físicos', 'oscilaciones, periodicidad, sincronización, ritmos biológicos, ciclos celestes, dinámica no lineal.'],
  ['B06', 'Causa y efecto', 'causalidad, modelos deterministas y probabilísticos, interacciones físicas, retroalimentación, inferencia causal.'],
  ['B07', 'Género y organización generativa', 'significado simbólico histórico del principio hermético de género y si puede derivarse un modelo físico preciso y no metafórico; no suponer que los procesos físicos tienen categorías de género humanas.'],
  ['B08', 'Tabla Esmeralda y transformación', 'transformación alquímica histórica, conservación, relación materia-energía, cambios de estado.'],
  ['B09', 'Elementos y Akasha de Bardon', 'su sistema conceptual interno, su interpretación filosófica y si alguna afirmación concreta da predicciones medibles.'],
  ['B10', 'Grinberg e información', 'la teoría sintérgica, sus mecanismos propuestos, investigación histórica, limitaciones matemáticas y afirmaciones comprobables.'],
  ['B11', 'Observador y medición cuántica', 'separar conciencia, preparación experimental, interacción de medición, decoherencia, registro de información e interpretación.'],
  ['B12', 'Mente, tiempo y realidad', 'neurociencia de la percepción temporal, relatividad, memoria, causalidad y teorías filosóficas de la experiencia del tiempo.'],
];

// ---------- Etapa 3 · Sección D: modelos de ingeniería generativa existentes ----------
const G: T3[] = [
  ['G01', 'Estructuras evolucionadas de la NASA (Ryan McClelland)', 'objetivos y restricciones, cargas, topología, generación de geometría, simulación, restricciones de material, fabricabilidad, evaluación iterativa, validación experimental; extraer los principios computacionales documentados.'],
  ['G02', 'Noyron de LEAP 71', 'representación del conocimiento de ingeniería, modelos físicos, generación paramétrica, restricciones, modelado consciente de la fabricación, rendimiento previsto, pruebas físicas y retroalimentación; distinguir lo público de lo propietario o desconocido.'],
  ['G03', 'PicoGK', 'qué ofrece realmente y sus límites frente a Noyron.'],
  ['G04', 'Computación evolutiva', 'algoritmos genéticos, programación genética, estrategias evolutivas, mutación, selección, recombinación, optimización multiobjetivo.'],
  ['G05', 'Búsqueda de novedad', 'buscar soluciones realmente distintas en vez de optimizar candidatos conocidos.'],
  ['G06', 'Descubrimiento científico automatizado', 'generación automática de hipótesis, razonamiento científico asistido, agentes de investigación, sistemas de descubrimiento.'],
  ['G07', 'Regresión simbólica', 'descubrir relaciones matemáticas a partir de datos con búsqueda de expresiones simbólicas.'],
  ['G08', 'Descubrimiento bayesiano', 'inferencia probabilística, actualización de hipótesis, incertidumbre, diseño experimental, comparación de modelos.'],
  ['G09', 'Modelado informado por la física', 'ML científico, restricciones físicas, solucionadores numéricos, simulación, comprobaciones de consistencia.'],
  ['G10', 'Experimentación automatizada', 'experimentación en bucle cerrado, aprendizaje activo, selección de experimentos, evaluación, investigación adaptativa.'],
  ['G11', 'Generación y falsación de teorías', 'modelos mecanicistas, explicaciones rivales, predicciones, contraejemplos, reproducibilidad.'],
  ['G12', 'Arquitectura cognitiva generativa', 'sintetizar las técnicas documentadas en el diseño ACD propio de SOL. No afirmar reproducir algoritmos propietarios de la NASA o de Noyron sin evidencia.'],
];

// ---------- Etapa 3 · Secciones E y F: capacidades ACD, autonomía y crítica ----------
const D: T2[] = [
  ['D01', 'IMAGINAR: generar varios mecanismos y modelos explicativos candidatos originales (divergencia controlada, analogía interdisciplinar, búsqueda de novedad, supuestos alternativos); no confundir una idea existente renombrada con una hipótesis nueva.'],
  ['D02', 'MODELAR: traducir ideas a estructuras causales, expresiones matemáticas, algoritmos o modelos computacionales con variables, supuestos, límites y predicciones.'],
  ['D03', 'EXPERIMENTAR: ejecutar experimentos computacionales reales cuando sea viable; comparar con teorías existentes, observaciones, controles sintéticos o datos validados; decir qué es simulado y qué observado.'],
  ['D04', 'EVOLUCIONAR: rechazar, modificar, combinar o mejorar modelos con retroalimentación, guardando el linaje completo de cada hipótesis.'],
  ['D05', 'Curiosidad autónoma: identificar fenómenos sin explicar, contradicciones, predicciones fallidas, mecanismos ausentes y direcciones inexploradas sin esperar instrucciones.'],
  ['D06', 'Crítico independiente: un evaluador independiente cuestiona supuestos, consistencia matemática, novedad, evidencia e interpretación.'],
  ['D07', 'Memoria de descubrimiento persistente: preguntas, hipótesis, modelos, código, experimentos, predicciones, fallos, revisiones y resultados.'],
  ['D08', 'Priorización: ordenar investigaciones por importancia científica, novedad, coherencia, comprobabilidad, coste computacional y evidencia disponible.'],
  ['D09', 'Integración con KRATOS: KRATOS conoce las investigaciones en curso, resultados, límites y tareas pendientes de SOL.'],
  ['D10', 'Fiabilidad operativa: verificar el planificador, cuotas, recuperación de errores, persistencia tras reinicio y recuperación de tareas.'],
  ['D11', 'Descubrimiento de propósito general: no limitado a física o aplicaciones comerciales; apto para teorías científicas, diseños de ingeniería, materiales, tecnologías, modelos psicológicos y productos.'],
  ['D12', 'Informe científico veraz: nunca presentar especulación como descubrimiento confirmado; nunca afirmar que una simulación prueba una ley física nueva; nunca informar de un experimento con éxito si no se ejecutó y sus salidas no se conservan.'],
];

// ---------- Etapa 3: primera campaña autónoma ----------
const E: T2[] = [
  ['E01', 'Identificar 10 preguntas sin resolver sobre materia, energía, física cuántica, información, tiempo o conciencia.'],
  ['E02', 'Generar 20 hipótesis candidatas sustancialmente distintas.'],
  ['E03', 'Compararlas con la literatura para identificar arte previo y posible novedad.'],
  ['E04', 'Seleccionar cinco candidatas con criterios explícitos.'],
  ['E05', 'Formulación matemática o computacional de las viables.'],
  ['E06', 'Derivar predicciones falsables.'],
  ['E07', 'Implementar y ejecutar al menos un experimento computacional real.'],
  ['E08', 'Comparar los resultados con una referencia (baseline) adecuada.'],
  ['E09', 'Evaluación crítica independiente.'],
  ['E10', 'Revisar o rechazar hipótesis según los resultados.'],
  ['E11', 'Conservar todas las salidas y el linaje.'],
  ['E12', 'Proponer de forma autónoma la siguiente pregunta de investigación.'],
];

// ---------- Criterios de aceptación de las tres etapas ----------
const A: T2[] = [
  ['A01', 'Las 56 materias existen como registros de currículo numerados y distintos.'],
  ['A02', 'Los módulos completados se conservan sin duplicación innecesaria.'],
  ['A03', 'Cada materia tiene objetivos, fuentes, conceptos, preguntas abiertas y evaluación.'],
  ['A04', 'Los conectores están implementados y probados uno a uno.'],
  ['A05', 'La procedencia y el grado de lectura se registran con exactitud.'],
  ['A06', 'El material científico y esotérico se recupera por una interfaz de investigación unificada.'],
  ['A07', 'El grafo de investigación conecta materias sin perder la distinción entre evidencia, interpretación y especulación.'],
  ['A08', 'El progreso sobrevive a reinicios y KRATOS puede recuperarlo.'],
  ['A09', 'Los 12 puentes están registrados y enlazados con el conocimiento de la etapa 1.'],
  ['A10', 'Cada puente incluye fuentes históricas, referencias científicas, semejanzas, diferencias y preguntas abiertas.'],
  ['A11', 'SOL genera preguntas nuevas combinando conceptos de disciplinas distintas.'],
  ['A12', 'SOL distingue interpretaciones simbólicas de afirmaciones matemáticas y experimentales.'],
  ['A13', 'Al menos 12 hipótesis o preguntas exploratorias documentadas, con procedencia y comprobación de originalidad.'],
  ['A14', 'Un proceso crítico independiente evalúa las hipótesis candidatas más fuertes.'],
  ['A15', 'KRATOS recupera los resultados de la investigación interdisciplinar.'],
  ['A16', 'Métodos de ingeniería generativa de la NASA investigados con referencias técnicas.'],
  ['A17', 'Noyron y PicoGK de LEAP 71 investigados con sus límites documentados.'],
  ['A18', 'Métodos G04–G11 evaluados por su aplicabilidad a ACD.'],
  ['A19', 'Las cuatro capacidades D01–D04 existen como software que funciona.'],
  ['A20', 'La curiosidad autónoma inicia una tarea de investigación sin orden directa del propietario.'],
  ['A21', 'Al menos una hipótesis se formaliza en un modelo ejecutable.'],
  ['A22', 'Al menos un experimento computacional real se ejecuta y conserva sus salidas.'],
  ['A23', 'Un crítico independiente evalúa los resultados.'],
  ['A24', 'Una hipótesis se revisa, rechaza o hace evolucionar según los resultados observados.'],
  ['A25', 'La memoria y el progreso sobreviven a un reinicio.'],
  ['A26', 'KRATOS recupera y entiende los resultados de SOL.'],
  ['A27', 'La primera campaña E01–E12 se rastrea punto por punto.'],
];

const GRUPOS: Record<string, string> = { S: 'Materias científicas', H: 'Materias herméticas', V: 'Materia y vibración', R: 'Conectores', B: 'Puentes', G: 'Ingeniería generativa', D: 'Capacidades ACD', E: 'Primera campaña', A: 'Aceptación' };
const etapa = (id: string): 1 | 2 | 3 => {
  const p = id[0], n = Number(id.slice(1));
  if ('SHVR'.includes(p)) return 1;
  if (p === 'B') return 2;
  if ('GDE'.includes(p)) return 3;
  return n <= 8 ? 1 : n <= 15 ? 2 : 3;   // A01–A08 etapa 1 · A09–A15 etapa 2 · A16–A27 etapa 3
};
const req = (id: string, descripcion: string): Requisito => ({ id, etapa: etapa(id), grupo: GRUPOS[id[0]], descripcion });
const conTitulo = ([c, t, x]: T3) => req(c, `${t}: ${x}`);

export const REQUISITOS: Requisito[] = [
  ...S.map(conTitulo), ...H.map(conTitulo), ...V.map(conTitulo), ...R.map(([c, d]) => req(c, d)),
  ...B.map(conTitulo), ...G.map(conTitulo), ...D.map(([c, d]) => req(c, d)), ...E.map(([c, d]) => req(c, d)), ...A.map(([c, d]) => req(c, d)),
];
// Ojo: la directiva habla de «139 identificadores», pero su propia enumeración (S01–S20, H01–H24, V01–V12, R01–R16, B01–B12,
// G01–G12, D01–D12, E01–E12, A01–A27) suma 20+24+12+16+12+12+12+12+27 = 147. Se rastrean todos; los informes deben usar este total.
export const TOTAL_REQUISITOS = REQUISITOS.length;

// ---------- Currículo anterior (sol_modulos, migración 039): reutilización y fusión ----------
const MODULOS_ANTIGUOS: Record<number, string> = {
  1: 'Neurociencia', 2: 'Psicología cognitiva', 3: 'Atención', 4: 'Memoria', 5: 'Emoción', 6: 'Aprendizaje', 7: 'Hipnosis', 8: 'Sugestión',
  9: 'Sueño', 10: 'Meditación', 11: 'Metodología científica', 12: 'Estadística', 13: 'Jung', 14: 'Freud y psicología profunda', 15: 'Simbolismo',
  16: 'Hermetismo', 17: 'Alquimia', 18: 'Cábala', 19: 'Mentalismo escénico', 20: 'Filosofía de la conciencia', 21: 'Biohacking', 22: 'Longevidad',
  23: 'Neurotecnología', 24: 'Estados alterados de conciencia',
};
// Módulos ya completados que una materia nueva reutiliza: se examina el dominio existente antes de programar más estudio.
const PREVIOS: Record<string, number[]> = { S12: [1, 3, 4], S13: [2] };
// Módulos todavía pendientes que absorbe una materia nueva (así no se estudian dos veces). 19 y 25–36 siguen siendo
// el currículo de aplicación a la empresa y la creación, y no se fusionan.
export const FUSION_MODULOS: Record<number, string> = {
  5: 'S13', 6: 'S14', 7: 'H22', 8: 'H22', 9: 'S12', 10: 'H19', 11: 'S02', 12: 'S01', 13: 'S13', 14: 'S13',
  15: 'S19', 16: 'H01', 17: 'H05', 18: 'H08', 20: 'S18', 21: 'S11', 22: 'S10', 23: 'S12', 24: 'H19',
};

// ---------- Unidades de investigación ----------
// Orden de estudio de las materias: primero lo que más alimenta el descubrimiento (método, matemáticas, física, vibración,
// sistemas complejos, los textos herméticos centrales y la conciencia); después el resto de ciencias y tradiciones.
const ORDEN_MATERIAS = ['S02', 'S01', 'S03', 'V01', 'V02', 'S04', 'S16', 'V05', 'V06', 'V07', 'H01', 'H03', 'H04', 'S09', 'S15', 'V10', 'S18', 'H10', 'H24', 'V12',
  'S12', 'S13', 'S14', 'S05', 'S06', 'S07', 'S08', 'V03', 'V04', 'V08', 'V09', 'V11', 'S10', 'S11', 'S17', 'S19', 'S20', 'H02', 'H05', 'H06', 'H07', 'H08',
  'H09', 'H11', 'H12', 'H13', 'H14', 'H15', 'H16', 'H17', 'H18', 'H19', 'H20', 'H21', 'H22', 'H23'];
const REL: Record<string, string[]> = {
  S01: ['S02', 'S03', 'S15', 'V11'], S02: ['S01', 'S18', 'S20', 'S15'], S03: ['S01', 'V01', 'V02', 'S09', 'S04'], S04: ['S03', 'V03', 'V12', 'S05', 'S15'],
  S05: ['S04', 'V03', 'V08', 'V09', 'S06'], S06: ['S05', 'V09', 'S07', 'H06', 'S11'], S07: ['S06', 'V04', 'V07', 'S04'], S08: ['S09', 'V08', 'S05', 'S03'],
  S09: ['S03', 'S08', 'V10', 'S12', 'S18'], S10: ['S11', 'S06', 'S16', 'S12'], S11: ['S10', 'S06', 'V05', 'S16'], S12: ['S13', 'S14', 'V12', 'S18', 'V05'],
  S13: ['S12', 'S14', 'H22', 'H23'], S14: ['S12', 'S13', 'S15', 'S18'], S15: ['S01', 'V10', 'S14', 'S17', 'S04'], S16: ['V05', 'V06', 'V11', 'S15', 'S10'],
  S17: ['S15', 'S16', 'S07', 'S01'], S18: ['S02', 'S14', 'V12', 'H16', 'H02'], S19: ['H01', 'H02', 'H05', 'H07', 'S20'], S20: ['S02', 'S19', 'H06', 'H16'],
  H01: ['H02', 'H04', 'H16', 'H18', 'S19'], H02: ['H01', 'H03', 'H16', 'V11', 'S18'], H03: ['H02', 'V01', 'V07', 'V05', 'S18'], H04: ['H01', 'H05', 'H06', 'H02'],
  H05: ['H06', 'H04', 'H20', 'S13'], H06: ['H05', 'S06', 'S20', 'H07'], H07: ['H06', 'H21', 'S20', 'H08'], H08: ['H11', 'H12', 'H02', 'H16'],
  H09: ['H12', 'H13', 'H06', 'S20'], H10: ['H21', 'H19', 'S14', 'H12'], H11: ['H08', 'H12', 'H19'], H12: ['H08', 'H11', 'H21', 'H09'],
  H13: ['H09', 'H16', 'H17'], H14: ['H15', 'H19', 'H18'], H15: ['H14', 'S02', 'S18'], H16: ['H01', 'H17', 'S18', 'H02'], H17: ['H16', 'H01', 'H13'],
  H18: ['H01', 'H04', 'S20'], H19: ['H20', 'S12', 'H10', 'H14'], H20: ['H19', 'H05', 'V05'], H21: ['H12', 'H07', 'H10'], H22: ['S13', 'H23', 'S12', 'S20'],
  H23: ['H22', 'S02', 'S13', 'V12'], H24: ['S12', 'V12', 'S18', 'S15'],
  V01: ['V02', 'S03', 'V05', 'H03'], V02: ['V01', 'S03', 'V06', 'V03'], V03: ['S04', 'V07', 'V08', 'S05'], V04: ['S07', 'V01', 'V03'], V05: ['V01', 'S16', 'S12', 'S10'],
  V06: ['S16', 'V02', 'V07', 'S06'], V07: ['V03', 'S07', 'S04', 'H03'], V08: ['S08', 'V03', 'S05', 'V07'], V09: ['S05', 'S06', 'V03'], V10: ['S15', 'S16', 'S09', 'S04'],
  V11: ['S16', 'S01', 'H02', 'V06'], V12: ['S04', 'S12', 'S18', 'H24', 'H23'],
  // Puentes: cada uno enlaza el principio esotérico con las materias científicas que permiten ponerlo a prueba (A09)
  B01: ['H03', 'S18', 'S12', 'V12'], B02: ['H02', 'V11', 'S16'], B03: ['H03', 'V01', 'V02', 'V03', 'S07'], B04: ['H03', 'V07', 'S04'], B05: ['H03', 'V05', 'S16', 'S08'],
  B06: ['H03', 'S02', 'S03'], B07: ['H03', 'S19'], B08: ['H04', 'H06', 'S06', 'S03'], B09: ['H10', 'S18', 'S12'], B10: ['H24', 'S12', 'S15'], B11: ['V12', 'S04'], B12: ['S09', 'S12', 'S18'],
  // Ingeniería generativa: todo cuelga de S17 (ingeniería e invención)
  G01: ['S17', 'S03', 'S07'], G02: ['S17', 'S03', 'S07'], G03: ['S17', 'G02'], G04: ['S17', 'S15', 'S16'], G05: ['S17', 'S15', 'G04'], G06: ['S17', 'S14', 'S15'],
  G07: ['S17', 'S01', 'S15'], G08: ['S17', 'S02'], G09: ['S17', 'S03', 'S15'], G10: ['S17', 'S02', 'G08'], G11: ['S17', 'S02', 'S20'], G12: ['S17', 'S14', 'S15'],
};

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
function alcance(codigo: string, temario: string): string {
  let s = cap(temario);
  const prev = PREVIOS[codigo] ?? [];
  if (prev.length) s += ` Módulos anteriores que ya cubren parte (se reutilizan y se evalúan, no se repiten): ${prev.map((n) => MODULOS_ANTIGUOS[n]).join(', ')}.`;
  const fus = Object.entries(FUSION_MODULOS).filter(([, c]) => c === codigo).map(([n]) => MODULOS_ANTIGUOS[Number(n)]);
  if (fus.length) s += ` Incluye además (módulos anteriores fusionados): ${fus.join(', ')}.`;
  return s;
}
const AREA: Record<string, string> = { S: 'ciencia', H: 'esoterismo', V: 'vibracion', B: 'puente', G: 'generativa' };
const unidad = (tipo: Unidad['tipo'], orden: (c: string) => number) => ([codigo, titulo, temario]: T3): Unidad =>
  ({ codigo, tipo, area: AREA[codigo[0]], titulo, alcance: alcance(codigo, temario), orden: orden(codigo), relacionadas: REL[codigo] ?? [], modulos_previos: PREVIOS[codigo] ?? [] });
const enOrden = (lista: T3[]) => (c: string) => lista.findIndex((x) => x[0] === c) + 1;

export const UNIDADES: Unidad[] = [
  ...[...S, ...H, ...V].map(unidad('materia', (c) => ORDEN_MATERIAS.indexOf(c) + 1)),
  ...B.map(unidad('puente', enOrden(B))),
  ...G.map(unidad('generativa', enOrden(G))),
];

// ---------- Siembra idempotente ----------
// Inserta o actualiza la definición (descripciones, títulos, alcance, orden, enlaces) sin tocar nunca lo que refleja trabajo real:
// estado, evidencia, verificado_en, pendiente y siguiente de un requisito; estado, tarea, proyecto, intentos y fechas de una unidad.
// Al crear una materia cuyos módulos previos están TODOS completados, empieza «estudiada»: el planificador examina el dominio
// existente antes de programar más estudio (si suspende, se vuelve a estudiar). Sin módulos previos, o con alguno sin completar,
// empieza «pendiente». Los módulos antiguos absorbidos solo se marcan «fusionado» si siguen pendientes.
// Devuelve los totales presentes tras la siembra (requisitos y unidades de la definición, módulos antiguos fusionados).
export async function seedSolDef(db: Db): Promise<{ requisitos: number; unidades: number; fusionados: number }> {
  return withTx(db, async (tx) => {
    await tx.query('SELECT pg_advisory_xact_lock(7441)');   // servidor y trabajador pueden arrancar a la vez
    const reqNuevos: string[] = [], reqCambiados: string[] = [], uniNuevas: string[] = [], uniCambiadas: string[] = [], estudiadas: string[] = [];
    for (const r of REQUISITOS) {
      const q = (await tx.query(`INSERT INTO sol_requisitos (id, etapa, grupo, descripcion) VALUES ($1, $2, $3, $4)
        ON CONFLICT (id) DO UPDATE SET etapa = EXCLUDED.etapa, grupo = EXCLUDED.grupo, descripcion = EXCLUDED.descripcion, updated_at = now()
        WHERE (sol_requisitos.etapa, sol_requisitos.grupo, sol_requisitos.descripcion) IS DISTINCT FROM (EXCLUDED.etapa, EXCLUDED.grupo, EXCLUDED.descripcion)
        RETURNING (xmax = 0) AS nuevo`, [r.id, r.etapa, r.grupo, r.descripcion])).rows[0];
      if (q) (q.nuevo ? reqNuevos : reqCambiados).push(r.id);
    }
    for (const u of UNIDADES) {
      const q = (await tx.query(`INSERT INTO sol_unidades (codigo, tipo, area, titulo, alcance, orden, relacionadas, modulos_previos, estado)
        VALUES ($1, $2::text, $3, $4, $5, $6, $7::text[], $8::int[], CASE WHEN $2::text = 'materia' AND cardinality($8::int[]) > 0
          AND (SELECT count(DISTINCT m.n) FROM sol_modulos m WHERE m.n = ANY($8::int[]) AND m.estado = 'completado') = cardinality($8::int[])
          THEN 'estudiada' ELSE 'pendiente' END)
        ON CONFLICT (codigo) DO UPDATE SET tipo = EXCLUDED.tipo, area = EXCLUDED.area, titulo = EXCLUDED.titulo, alcance = EXCLUDED.alcance,
          orden = EXCLUDED.orden, relacionadas = EXCLUDED.relacionadas, modulos_previos = EXCLUDED.modulos_previos
        WHERE (sol_unidades.tipo, sol_unidades.area, sol_unidades.titulo, sol_unidades.alcance, sol_unidades.orden, sol_unidades.relacionadas, sol_unidades.modulos_previos)
          IS DISTINCT FROM (EXCLUDED.tipo, EXCLUDED.area, EXCLUDED.titulo, EXCLUDED.alcance, EXCLUDED.orden, EXCLUDED.relacionadas, EXCLUDED.modulos_previos)
        RETURNING (xmax = 0) AS nuevo, estado`, [u.codigo, u.tipo, u.area, u.titulo, u.alcance, u.orden, u.relacionadas, u.modulos_previos])).rows[0];
      if (!q) continue;
      (q.nuevo ? uniNuevas : uniCambiadas).push(u.codigo);
      if (q.nuevo && q.estado === 'estudiada') estudiadas.push(u.codigo);
    }
    const ns = Object.keys(FUSION_MODULOS).map(Number);
    const fusionadosAhora = (await tx.query(`UPDATE sol_modulos m SET estado = 'fusionado', fusionado_en = f.codigo
      FROM unnest($1::int[], $2::text[]) AS f(n, codigo) WHERE m.n = f.n AND m.estado = 'pendiente' RETURNING m.n, m.fusionado_en`,
      [ns, ns.map((n) => FUSION_MODULOS[n])])).rows.sort((a, b) => a.n - b.n);
    const t = (await tx.query(`SELECT (SELECT count(*)::int FROM sol_requisitos WHERE id = ANY($1::text[])) AS r,
        (SELECT count(*)::int FROM sol_unidades WHERE codigo = ANY($2::text[])) AS u,
        (SELECT count(*)::int FROM sol_modulos WHERE estado = 'fusionado' AND n = ANY($3::int[])) AS f`,
      [REQUISITOS.map((r) => r.id), UNIDADES.map((u) => u.codigo), ns])).rows[0];
    if (reqNuevos.length || reqCambiados.length || uniNuevas.length || uniCambiadas.length || fusionadosAhora.length)
      await audit(tx, 'kratos (sol-def)', 'sol.definicion_sembrada', {
        requisitos_nuevos: reqNuevos.length, requisitos_actualizados: reqCambiados, unidades_nuevas: uniNuevas.length, unidades_actualizadas: uniCambiadas,
        materias_estudiadas_por_modulos_previos: estudiadas, modulos_fusionados: fusionadosAhora.map((m) => `${m.n}→${m.fusionado_en}`),
      });
    return { requisitos: t.r, unidades: t.u, fusionados: t.f };
  });
}
