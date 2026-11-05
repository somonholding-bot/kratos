# KSIE — TAREA 00: auditoría y prerrequisitos (5-nov-2026)

## Prerrequisitos
| Prerrequisito | Estado | Evidencia |
|---|---|---|
| Fases anteriores terminadas y verificadas | CUMPLE | Expansión cognitiva C01–C06 con 18/18 PASS (docs/kratos-cognitive-expansion/final-report.md) y npm test 229/229. SOL/ACD integrado y funcionando (rastreador sol_requisitos). |
| SOL/ACD identificado y su verificación | CUMPLE | src/core/conectores.ts, acd.ts, curriculo.ts, examen.ts, requisitos.ts; verificación por playbookchecks y rastreador. No se interrumpe: los planificadores siguen en el worker. |
| C01–C06 identificados | CUMPLE | automodelo, metacognicion, autobiografia, espacio, prediccion, conciencia (+ ciclo-cognitivo). |
| Orden del propietario | CUMPLE | Dejó KSIE en cola para hacerla tras la expansión cognitiva (supera la congelación). |

## Qué se reutiliza (no se recrea)
- **Registro de herramientas**: `tool_registry` (78 herramientas, sincronizado con el array TOOLS) + `cog_capacidades` de C01 (niveles y confianza medidos). KSIE añade solo los metadatos que faltan (operaciones, coste, latencia, autenticación, permisos, privacidad) en una tabla complementaria.
- **Memoria**: C03 `cog_experiencias` (decisiones, errores, lecciones) y `lessons`.
- **Decisiones y calibración**: C02 `cog_decisiones`.
- **Objetivo activo**: C04 `cog_objetivos` (una sola ejecución activa).
- **Predicciones**: C05 `cog_predicciones`.
- **Experimentos de negocio**: tabla existente `experiments` (1 fila de demostración) — se amplía con línea base y umbrales en vez de crear otra.
- **Dinero**: `budget_accounts`, `budget_movements` (gasto real: 957 céntimos cargados), `approvals` (aprobaciones del propietario). No hay tabla de ingresos reales: los ingresos/costes observados se registrarán en `metrics` con fuente.
- **Agentes**: los 8 existentes; Júpiter (estrategia y oportunidades), Mercurio (investigación), Saturno (crítica independiente, riesgos, presupuestos). No se crean agentes.

## Estado estratégico actual (datos reales)
- Plan maestro v23 (3-nov-2026): foco único en la app «Aion: Moon & Horoscope» y el canal de YouTube AION MIND (preferencia 10 del propietario: orden explícita).
- Productos registrados: KYBALION NFC, Mimigra, SoloBiz AI, ARCANA WARS Mobile, Aion (y uno de demostración). Ingresos netos verificados: **0 USD** (no hay ningún ingreso observado registrado; las métricas existentes son de demostración).
- Riesgo de fijación ya visible: casi todas las líneas son apps y contenido de YouTube; no hay ninguna oportunidad física, local o de servicios evaluada.

## Huecos que cubre KSIE
1. Estados por herramienta DISCOVERED…UNAVAILABLE y enrutado por operación, fiabilidad, coste y privacidad con aprendizaje medido.
2. Marco de 100 preguntas con respuestas con evidencia y etiqueta (HYPOTHESIS/ESTIMATE/OBSERVED/INDEPENDENTLY VERIFIED).
3. Cartera de oportunidades de cualquier sector comparada con rangos; anti-fijación; crítica independiente.
4. Experimentos con umbrales falsables y modelo financiero que separa ingresos, margen, beneficio neto y caja.
5. Memoria estratégica: no reabrir estrategias abandonadas sin evidencia nueva; explicar cambios de recomendación.
