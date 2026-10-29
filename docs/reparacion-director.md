# Reparación: KRATOS como director (29-oct-2026)

## Por qué KRATOS «perdió» el resultado de Venus
- **Venus sí trabajó.** La tarea #71 (concepto de app para hombres) tiene un informe real de 8.878 caracteres, generado con la suscripción de Claude.
- **El informe estaba guardado** en la base de datos (`tasks.result.deliverable`).
- **KRATOS no tenía forma de leerlo.** Su herramienta `listar_tareas` solo devolvía título y estado. Por eso decía que no encontraba nada.
- **Confusión de nombres por voz:** «Venus» se transcribió como «Benu» y «Mercurio» como «Melcure». KRATOS creó las tareas #74 y #75 sobre una persona inexistente («Benu»).
- **Tu nombre en cada respuesta:** el contexto de cada turno le ordenaba «trátale de Idalmi», y tu preferencia solo estaba en una nota que no leía.

## Qué se corrigió
| Archivo | Cambio |
|---|---|
| `src/core/registry.ts` (nuevo) | Guardar y verificar informes, leer resultado por tarea, buscar informes, registro de agentes, inventario real de herramientas |
| `src/core/handlers.ts` | Una tarea de agente no se completa sin informe guardado como nota y leído de vuelta |
| `src/core/brain.ts` | Herramientas `ver_resultado_tarea`, `buscar_informes`, `agentes`, `herramientas_sistema`, `recordar_preferencia`, `olvidar_preferencia`; contexto compacto con agentes, tareas recientes y preferencias; corrección de nombres mal transcritos; sin nombre al inicio de cada respuesta |
| `db/018_preferencias_registro.sql` | Tabla de preferencias permanentes con las que ya habías pedido |

## Cómo se guardan ahora los resultados
1. El agente termina y entrega su texto.
2. Se guarda como nota en `~/Documents/Kratos/Tareas/Informe tarea N · agente.md` y se lee de vuelta.
3. Solo entonces la tarea pasa a completada, con el texto y la ruta del archivo.
4. Si algo falla, la tarea no se da por buena: se reintenta o queda fallida con su error.

## Pruebas reales
| Prueba | Resultado |
|---|---|
| ¿Quién es Venus? | ✅ Respondió desde el registro (función, límites, herramientas, tareas) |
| ¿Qué encontró Venus? (tarea #71) | ✅ Resumió el informe real en 3,7 s |
| Análisis de mercado nuevo a Venus (#78) | ✅ pendiente → en ejecución → completada en 45 s, con fuentes y fecha |
| Informe guardado y legible | ✅ `Tareas/Informe tarea 78 · venus.md` |
| Reiniciar servidor, trabajador y app, y preguntar | ✅ Recuperó el informe en 4,3 s |
| Tareas antiguas | ✅ #3 (la primera) recuperable; búsqueda por tema encuentra #78, #75, #31 y #3 |
| ¿Qué herramientas están operativas? | ✅ Inventario comprobado en vivo |
| Pruebas automáticas | ✅ 56/56 |

## Latencia medida
- Transcripción: 0,55–0,70 s
- Respuesta de la IA a preguntas con consulta: 2,3–6,1 s
- Primera respuesta tras un rato sin uso: hasta 40 s, porque la IA vuelve a cargar su contexto en caché

## Pendiente
- Streaming (empezar a hablar con la primera frase) para bajar la espera de la primera respuesta.
- LangGraph, n8n, LiveKit y Langfuse no están instalados: la coordinación la hace la cola de tareas de KRATOS.
