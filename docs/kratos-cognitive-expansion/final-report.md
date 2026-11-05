# KRATOS — Informe final de la expansión cognitiva (TAREA 10)

Fecha: 5-nov-2026. Repositorio `~/Jarvis`, rama `main`. Todas las cifras salen de comandos ejecutados; nada se da por hecho porque exista un archivo.

## Qué se construyó

| Módulo | Código | Tablas | Herramienta | Pruebas |
|---|---|---|---|---|
| C01 Automodelo funcional | `src/core/automodelo.ts` | `cog_capacidades`, `cog_capacidad_pruebas`, `cog_automodelo` (048) | `automodelo` | `test/automodelo.test.ts` 6/6 |
| C02 Monitorización metacognitiva | `src/core/metacognicion.ts` | `cog_decisiones` (049) | `metacognicion` | `test/metacognicion.test.ts` 5/5 |
| C03 Memoria autobiográfica | `src/core/autobiografia.ts` | `cog_experiencias` (050) | `memoria_autobiografica` | `test/autobiografia.test.ts` 6/6 |
| C04 Espacio de trabajo global | `src/core/espacio.ts` | `cog_objetivos`, `cog_transiciones`, `cog_mensajes`, `cog_conflictos` (051) | `espacio_global` | `test/espacio.test.ts` 4/4 |
| C05 Predicción y aprendizaje activo | `src/core/prediccion.ts` | `cog_creencias`, `cog_predicciones` (052) | `prediccion` | `test/prediccion.test.ts` 3/3 |
| C06 Laboratorio de teorías de la conciencia | `src/core/conciencia.ts`, `src/core/aislado.ts`, `scripts/cognicion/demos/*.py` | `cog_teorias`, `cog_demos` (053) | `conciencia_lab` | `test/conciencia.test.ts` 4/4 |
| Ciclo operativo integrado | `src/core/ciclo-cognitivo.ts` | `cog_ciclos` (054) | `ciclo_cognitivo` | `test/ciclo-cognitivo.test.ts` 3/3, `test/cognicion-integracion.test.ts` 6/6 |
| Literatura y repositorios | `scripts/cognicion/cargar-referencias.ts` | `cog_referencias`, `cog_repositorios` (047) | — | 26 referencias (20 verificadas), 19 repositorios |

Se integró sin crear agentes nuevos. Las herramientas cognitivas se dieron a los agentes existentes (migración 054). El prompt del CEO recibió la regla 5b. El worker siembra las teorías al arrancar y cada 10 minutos sincroniza el automodelo, importa la historia a la memoria y recupera los ciclos interrumpidos.

**Dependencias instaladas: ninguna.** Se usa el Python aislado de ACD, que ya existía (numpy y scipy).

## Criterios de aceptación

Comando común: `npm test` → **229/229 PASS** (antes de la expansión: 192/192).

| # | Criterio | Estado | Evidencia (comando → resultado) | Límite |
|---|---|---|---|---|
| 1 | Conocimiento exacto de sus capacidades | PASS | `automodelo accion=ver` → 105 capacidades (78 herramientas del `tool_registry`, subsistemas, dependencias y conectores). Cada una tiene nivel instalada / disponible / probada / degradada, y la confianza sale de las pruebas reales (audit_log, sondeos de conectores, experimentos ACD). Test: un éxito antiguo no tapa un fallo posterior. | El uso registrado en audit cuenta como prueba superada si no hay error: es una evidencia débil para algunas herramientas. |
| 2 | Reconoce las capacidades que le faltan | PASS | `capacidad q_lab` → `no_existe`, confianza 0. CUDA → `no_existe`. Conectores R01, R03 y R05 → `degradada` (429/500). `puedo(['q_lab'])` → «No puedo completarlo ahora». | La lista de subsistemas y dependencias que se comprueban es fija en el código. |
| 3 | Detecta contradicciones o errores en una decisión | PASS | `test/metacognicion.test.ts`: detecta una elegida fuera de las candidatas, más evidencia en contra que a favor, ninguna evidencia a favor, confianza alta con incertidumbre alta, un supuesto que contradice la evidencia y una sola estrategia. También detecta sobreconfianza: declara 0,95 con un acierto medido de 0,30, y la decisión se escala. | En producción hay solo 3 decisiones resueltas, así que la calibración real dice «sin historial suficiente» (es honesto, pero todavía no está calibrada). |
| 4 | Memoria duradera tras reinicios | PASS | Hay 566 experiencias en producción (340 verificadas, 226 inferidas), importadas de 334 tareas y de 225 lecciones. Los tests reabren la conexión y recuperan por error, texto y agente. | Las lecciones antiguas sin respaldo quedan como inferidas. |
| 5 | Recupera un error previo relevante | PASS | `memoria_autobiografica accion=buscar clasificacion_error=verificacion` → 7 errores reales (p. ej. «afirma he publicado: un especialista solo entrega análisis»). `antes_de_actuar` devuelve el error con su corrección. | La búsqueda es por texto completo en español, no semántica. |
| 6 | Cambia de estrategia por ese error | PASS | `elegirConMemoria` descarta «anuncios pagados» por un error documentado y elige «entrevistas a clientes». C02 añade la alerta `error_documentado` y escala si el error está verificado. En C05, una decisión pasa de canal A a canal B tras un error de predicción. | Se demostró con casos de prueba; aún no hay un caso de negocio real en producción. |
| 7 | Coordina agentes sin perder la propiedad de las tareas | PASS | `test/espacio.test.ts`: solo el propietario o KRATOS traspasan, el mensaje registra la procedencia y la lectura es priorizada y marcada. Los conflictos bloquean el cierre y una parte no se lo resuelve sola. En producción, los ciclos 1–3 hicieron el traspaso kratos → sol. | El espacio global todavía no sustituye a la cola `tasks` de los agentes: convive con ella. |
| 8 | Un objetivo a la vez | PASS | Índice único `cog_un_objetivo_activo`: la base rechaza un segundo objetivo ACTIVE aunque se salte el código (test). El ciclo 2.º simultáneo queda «bloqueado». | — |
| 9 | Predicciones registradas antes de observar | PASS | Un disparador `cog_prediccion_inmutable` impide editar o re-observar una predicción, y un CHECK obliga a `observado_at ≥ registrada_at`. En producción, 3/3 predicciones cumplen registrada < observada. Las demos registran su predicción antes de ejecutarse. | — |
| 10 | Compara predicción y resultado | PASS | `observar` → error, sorpresa (z), dentro o fuera del rango del 95 % y revisión bayesiana. En el banco con semilla 42, el error de la 2.ª mitad es menor que el de la 1.ª y la cobertura es ≥ 0,8. | Las creencias son gaussianas de una variable. |
| 11 | Artefacto de verificación independiente | PASS | No hay COMPLETED sin artefacto `{tipo, ref, verificador ≠ propietario, resultado ok}`, sin conflictos ni subtareas abiertas. Una decisión crítica no se da por buena sin una revisión de otro actor. En producción, los objetivos 1–3 tienen como verificador «verificador (código)» y como propietario sol. | En el ciclo automático el verificador es código, no Saturno. |
| 12 | Manejo seguro de experimentos fallidos | PASS | Un experimento que lanza una excepción acaba en el ciclo «fallido» con la etapa 6 en `error` y no deja ningún objetivo activo. Un bucle infinito se corta por timeout. Todo corre en el sandbox: sin red, sin escribir fuera de su carpeta, sin leer la carpeta personal ni el llavero, sin fork y sin variables sensibles (test). | Docker no se usa: el aislamiento es `sandbox-exec` de macOS. |
| 13 | Separa las teorías de la conciencia de las afirmaciones de conciencia | PASS | 7 teorías con fuentes, supuestos, formulación, evidencia, críticas, predicciones y límites. Las 6 demos cumplen su predicción. El CHECK `afirma_experiencia = false` bloquea en la base cualquier afirmación. `revisarAfirmacion("KRATOS es consciente…")` → bloqueada (categoría D, sin resolver). | La demo de IIT es una medida de juguete, no el Φ de IIT 3.0. Orch OR no tiene demo porque es una hipótesis física. |
| 14 | Conserva la funcionalidad existente | PASS | Las 192 pruebas previas siguen pasando dentro de las 229. Los servicios se reiniciaron sin errores (`launchctl list`: server y worker activos) y siempre con 0 tareas en ejecución. SOL/ACD no se interrumpió. | Las pruebas no ejecutan agentes reales con IA. |
| 15 | Sin gasto de API no autorizado | PASS | Un test comprueba que los 8 módulos cognitivos no importan el SDK de Anthropic ni hacen `fetch` a la red. Las demos y los cálculos son locales. | — |
| 16 | Recupera sesiones interrumpidas | PASS | `recuperarCiclos`: si un ciclo lleva más de 30 min «en curso», pasa a «fallido» con la última etapa, su objetivo queda BLOCKED con el motivo «reanudar» y se listan las predicciones pendientes (test, idempotente). El trabajo de esta directiva se retomó desde `progress.json` tras compactar el contexto. | La reanudación automática desde la etapa intermedia no está implementada: se informa y se bloquea. |
| 17 | Pruebas reproducibles con evidencia | PASS | Generadores con semilla (bandido mulberry32 y demos con `default_rng`): la misma demo da las mismas métricas (test). Cada demo y cada ciclo guarda el sha256 del código y de la salida, y su carpeta. | — |
| 18 | Explicación inspeccionable de por qué un objetivo se aceptó, rechazó o quedó sin resolver | PASS | `espacio_global accion=explicar id` devuelve el motivo de aceptación, el historial de transiciones con su motivo, el artefacto o motivo de cierre, lo que falta y el presupuesto. `ciclo_cognitivo accion=ver` muestra las 10 etapas con entrada, salida, responsable y criterio. | — |

**Resultado: 18/18 PASS.**

## Problemas encontrados y corregidos

- Las herramientas nuevas quedaron en modo estricto y se superó el límite de 20 de la API (2 tests fallaron). Corregido en c587c3d.
- Ciclo de producción #1: el enrutado por palabras no encontró agente y asignó Sol por defecto, indicándolo como tal. Corregido: la función principal pondera el doble y Saturno, el evaluador, queda excluido.
- Ciclo de producción #2: `herramientaAcd` devuelve `{error}` en lugar de lanzar. La etapa 5 quedó sin cumplir y aun así el objetivo se completó. **Es un defecto real de ese registro.** Corregido: un fallo de ACD bloquea el ciclo y los duplicados se reutilizan por su id. El ciclo #3 cumple 10/10 etapas.
- Los duplicados de memoria no enlazaban el nuevo ciclo. Ahora acumulan los enlaces.

## Pendiente y límites

- Q-LAB no existe: se informa como dependencia ausente y se usa el ejecutor aislado.
- 6 referencias sin verificar: B1, B3, C2, C3, D3 y F1. B3 y C2 lo están por discrepancia entre la verificación del investigador y el código.
- La calibración de C02 necesita decisiones reales resueltas para dejar de decir «sin historial».
- El enrutado `quienHace` es léxico, no semántico.

## TAREA 11 — Congelación

La arquitectura cognitiva C01–C06 queda **congelada**: no se añaden módulos ni se cambia su diseño sin una nueva directiva. Por orden explícita del propietario (5-nov-2026), el siguiente trabajo es la directiva KSIE (`docs/kratos-strategic-intelligence/`). Esa directiva reutiliza estos módulos y no los redefine. No se empieza ningún reto científico propio hasta que el propietario dé uno.
