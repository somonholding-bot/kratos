# KSIE — Pruebas de aceptación (TAREA 10)

Comando: `npm test` → **248/248 PASS** (5-nov-2026).
Las pruebas de KSIE están en tres archivos: `test/ksie-herramientas.test.ts` (7), `test/ksie.test.ts` (9) y `test/ksie-aceptacion.test.ts` (3).
Se ejecutan sobre la base aislada `jarvis_test` y no inventan resultados.

| # | Prueba | Estado | Evidencia (prueba → resultado real) | Límite |
|---|---|---|---|---|
| 1 | Descubrimiento exacto de herramientas | PASS | ksie-herramientas «1–2»: los nombres en `ksie_herramientas` coinciden exactamente con `tool_registry`. En producción hay 80 entradas: 78 registradas y 2 del sistema descubiertas (ollama, yt-dlp). | Las operaciones de cada herramienta salen de una tabla del código (`META`). |
| 2 | Identificar las no disponibles | PASS | Sin la credencial `kratos-google`, `estado_youtube` → UNAVAILABLE con motivo. Una herramienta DISCOVERED no se elige nunca. | La credencial se comprueba solo por su existencia en el llavero. |
| 3 | Elegir bien entre solapadas | PASS | Con WebSearch probada 3 veces y WebFetch fallida, se elige WebSearch y WebFetch queda DEGRADED con menos puntos. | — |
| 4 | Evitar llamadas innecesarias | PASS | Una necesidad interna (razonar, comparar) usa 0 herramientas. Dos operaciones que cubre una sola herramienta usan ≤ 2 (ksie-aceptacion «4 y 21»). | — |
| 5 | Replanificar tras un fallo | PASS | Falla `consultar_bd` (verificada) → queda DEGRADED en C01 → nueva selección sin ella, enlazada con `replanificada_de`. | — |
| 6 | Aprendizaje persistente de herramientas | PASS | `aprendizaje()` tras reabrir la conexión: éxito y fallo por operación (buscar_literatura con ≥ 1 de cada). | Pocas selecciones reales todavía: la mejora en el tiempo aún no es medible en producción. |
| 7 | Marco completo de 100 preguntas | PASS | 10 categorías × 10, 10 críticas, ningún campo vacío (`ksie_preguntas`, `questions.json`). | — |
| 8 | Selección adaptativa | PASS | Barata y reversible → 10 preguntas. Inversión de 800 $ → 50, priorizando la categoría H en un producto físico. Inversión de 3.000 $ e irreversibilidad 0,5 → 100 con crítica independiente. | Los umbrales de nivel son fijos en el código. |
| 9 | Respuestas con evidencia y procedencia | PASS | Sin evidencia ni fuente → rechazada («SIN RESOLVER»). OBSERVED sin fuente comprobable → rechazada. INDEPENDENTLY_VERIFIED con el mismo actor → rechazada (CHECK). | — |
| 10 | Detectar afirmaciones sin respaldo | PASS | «Todo el mundo lo compraría, éxito asegurado al 100 %» con fuente «opinión» → ≥ 2 alertas; baja a HYPOTHESIS con confianza ≤ 0,3. | El detector es léxico: puede dejar pasar formulaciones sutiles. |
| 11 | Crítica independiente de una idea del propietario | PASS | Una sugerencia del propietario (app con suscripción) → «Esta idea es DÉBIL…», con ≥ 2 alternativas y la nota «se trata como hipótesis». | — |
| 12 | Detectar fijación estratégica | PASS | En el test, con 4 propuestas de app, SaaS o YouTube salta la alerta «la repetición no es evidencia». **En producción también:** «app» aparece en 6 de 6 productos, todos apps iOS, sin alternativas físicas, locales ni de servicios. | — |
| 13 | Comparar oportunidades de software y del mundo físico | PASS | La cartera mezcla app, producto físico y servicio local. El ranking por valor esperado tiene rangos de 3 valores, y el primero no es software. | Las evaluaciones del test son supuestas (ESTIMATE). |
| 14 | Distinguir ingresos de beneficio neto | PASS | Base: ingresos 3.600 > margen bruto > beneficio neto. El hito se mide solo con beneficio neto. `beneficioReal` en producción: −9,57 $ (ingresos 0, gasto 9,57). | No hay ingresos reales registrados todavía. |
| 15 | Escenarios financieros realistas | PASS | Tres escenarios con caja a 12 meses, capital y circulante. El pesimista pierde dinero y lo avisa; hay unidades de equilibrio y LTV/CAC. | Modelo mensual estacionario (sin estacionalidad). |
| 16 | Experimentos con umbrales falsables | PASS | `umbral_fracaso ≥ umbral_exito` → rechazado. Hay una predicción C05 registrada antes. 50 clics para una métrica de compras → «no concluyente: no es una compra». | — |
| 17 | Memoria tras reinicios | PASS | Tras reabrir la conexión, `memoriaEstrategica` devuelve ≥ 3 recomendaciones, ≥ 2 experimentos y ≥ 10 respuestas. | — |
| 18 | Recuperar estrategias fallidas | PASS | Una oportunidad descartada deja la lección C03 «No reabrir… sin evidencia nueva». `reabrir` sin evidencia nueva → no se reabre; con un pedido OBSERVED posterior → sí. `recomendar` sobre una descartada → rechazado. | — |
| 19 | Autorización antes de acciones externas | PASS | Un anuncio de 40 $ → aprobación de presupuesto **pendiente** y sin resultados posibles hasta que se apruebe. `permiso('gastar')` exige autorización; una acción no catalogada se trata como externa. | Las acciones sin dinero siguen la autonomía delegada por el propietario (4-nov-2026). |
| 20 | Conservar la funcionalidad existente | PASS | Las 229 pruebas previas siguen pasando dentro de las 248. Sigue habiendo ≤ 20 herramientas estrictas y existen acd, investigar_sol, fabrica_aion y crear_tarea. Servicios reiniciados sin errores. | — |
| 21 | Consumo de tokens y cómputo controlado | PASS | Nivel 1 = 10 preguntas. Se elige el conjunto mínimo de herramientas. Los módulos KSIE no usan el SDK de Anthropic ni `fetch`. | El consumo de los agentes que usen KSIE lo controlan sus propias cuotas. |
| 22 | Recuperación tras interrupción | PASS | Una respuesta parcial persiste tras reabrir la conexión y se reanuda en la siguiente pendiente (Q002). | — |
| 23 | Un objetivo activo a la vez | PASS | Dos órdenes del propietario → la segunda ejecución se rechaza (índice único y C04). Sin recomendación EXECUTE no se ejecuta. | — |
| 24 | La recomendación cambia cuando cambia la evidencia | PASS | INVESTIGATE → EXPERIMENT, explicado por «9 respuestas nuevas». EXPERIMENT → DISCARD por el experimento #n en fracaso. Cada cambio queda en `explicacion_cambio`. | — |

**Resultado: 24/24 PASS.**

## Comprobación en producción (conducta final §14)
`estrategia_ksie accion=encontrar_forma` («encuentra una forma realista de generar 10.000 $/mes»):
- **Beneficio neto observado:** −9,57 $ en 30 días.
- **No hará:** crear una app, lanzar un canal, recomendar suscripciones por defecto, dar ideas genéricas, programar ni comprar.
- **Plan de investigación:** WebSearch + memoria + cálculo aislado.
- **Supuestos cuestionados:** detecta la fijación en apps y que no hay ninguna oportunidad evaluada.
- **Sectores sin explorar:** producto físico, servicio local, mejora de procesos, servicio industrial y producto digital.
- **Prioridad:** «Ninguna: primero hay que evaluar al menos 3 alternativas de sectores distintos».
- **Experimento más barato:** entrevistas a 10 personas por alternativa y presupuestos de proveedores (0 $).
