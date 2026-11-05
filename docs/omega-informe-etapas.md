# Operación Omega — informe de etapas (se actualiza al cerrar cada etapa)

## Etapa 1 · Descubrimiento (auditoría del sistema real, 4-nov-2026)
- **Repositorio:** `~/Jarvis` (rama `main`). Servidor `src/server.ts`, trabajador `src/worker.ts`, cerebro `src/core/brain.ts`, herramientas MCP `src/mcp-kratos.ts`.
- **Agentes:** tabla `agent_functions` (KRATOS + Sol, Luna, Mercurio, Venus, Marte, Júpiter, Saturno): perfiles con herramientas, no procesos. Motor: Claude Code por suscripción (respaldo API).
- **Capacidades que ya existían y se reutilizan:** cola de tareas con reintentos y verificación en código (`tasks`, `verify.ts`), playbooks con comprobaciones (`playbookchecks.ts`), informes de agentes guardados y leídos de vuelta en la bóveda de Obsidian (`~/Documents/Kratos/Tareas`), búsqueda de informes (`buscar_informes`, `ver_resultado_tarea`), conocimiento (`knowledge_items`), lecciones (`lessons`), auditoría (`audit_log`), fábrica de vídeo y cadena final.
- **Ausente antes de Omega:** biblioteca de fuentes con procedencia; nivel de evidencia por afirmación; conexiones entre disciplinas; predicciones con resultado; paquete de producción con componentes obligatorios; estado de proyecto contrastado con archivos.
- **Problemas encontrados:** una tarea de agente podía «terminar» con un informe de texto sin paquete estructurado; el trabajador ejecuta una tarea de agente a la vez (cola en serie); cortes de internet aplazan tareas; KRATOS aún llama «Aion» al canal (se llama «Aion Mind»).
- **Costes:** agentes por suscripción (0 USD de API); las búsquedas web cuentan en la cuota de la suscripción.
- **Riesgos:** límite de 20 herramientas estrictas de la API (las de Omega se declararon no estrictas); no reiniciar el trabajador con tareas de agente en curso.

## Etapa 2 · Diseño
- Reutilizar PostgreSQL y la bóveda; **sin** base vectorial ni grafo externo hasta demostrar que hacen falta (búsqueda de texto + temas).
- Garantías en código, no en el prompt: fuente «verificada» solo si su URL se abrió; A/B exigen fuente verificada; proyecto `completed` solo con todos los componentes y archivos en disco; predicción solo con rango, confianza y base.

## Etapa 3 · Memoria (hecha y probada)
- Migración `db/037_omega_memorias.sql`: `sol_fuentes` (bibliográfica), `sol_afirmaciones` + `sol_conexiones` (semántica), `sol_proyectos` (operativa/episódica), `sol_predicciones` (experimental).
- Código `src/core/omega.ts`; herramientas `biblioteca_sol` y `proyecto_sol` (Sol y KRATOS); comprobación de playbook `proyecto_sol_completo`.
- Pruebas `test/omega.test.ts` (4): verificación de fuentes, niveles de evidencia, paquete bloqueado/completo/archivos borrados, predicciones.

## Etapa 4 · Biblioteca (primera carga)
- `scripts/sol/ingesta-fuentes.ts`: abrió las 150 URLs citadas en las 5 bibliotecas de conocimiento de Sol y las guías; **140 verificadas** (página abierta), 10 no verificadas (bloqueadas o caídas).
- **Honestidad:** acceso = «pagina». No se ha leído ningún libro entero; enciclopedias 81, web 21, artículos 16, documentación oficial 12, documento oficial 1. Faltan fuentes primarias (PubMed, CIA Reading Room, textos clásicos de dominio público).

## Etapa 5 · Inteligencia científica (pruebas superadas, 4-nov-2026)
- Playbook `sol-investigacion` y comprobación en código `afirmaciones_sol` (≥ 6 afirmaciones con nivel y fuente; A y B exigen fuente verificada).
- **Las 4 pruebas del documento, completadas al primer intento y verificadas en código** (tareas 620–623, proyectos P2–P5 en `~/Documents/Kratos/Proyectos/`):
  - Científica (autohipnosis, atención y dolor): sólida en laboratorio (g ≈ 0,54–0,76, 85 estudios), moderada e insegura en dolor agudo, no clara en dolor crónico.
  - Biohacking (cetosis, autofagia, cognición): evidencia humana débil; la autofagia cerebral por ayuno en humanos es hipótesis (nivel D).
  - Documental (Gateway Process): memorando del Ejército de 1983 (McDonnell), sin experimentos ni datos; demuestra interés institucional, no que el método funcione.
  - Esotérica (Akasha de Bardon): relación histórica y de analogía con los modelos de conciencia, no científica.
- Biblioteca tras las pruebas: 175 fuentes verificadas de 186 (6 leídas a texto completo); de las registradas por Sol: 7 metaanálisis, 6 ensayos, 5 revisiones, 2 documentos oficiales. 43 afirmaciones (A 4, B 14, C 14, D 7, E 2, H 2) y 13 conexiones tipificadas.
- **Límites que Sol declaró:** PubMed/PMC, Cochrane y cia.gov bloquearon la lectura automática (resúmenes vía Europe PMC, OCR de Internet Archive); varios textos solo en resumen; Bardon leído solo en su parte teórica.

## Etapa 7 · Integración KRATOS–Sol (demostración superada, 4-nov-2026)
- Playbooks `sol-paquete-video` y `sol-paquete-estrategia` (campañas, lanzamientos, libros, investigación: toda la empresa, no solo vídeos).
- **Prueba de coordinación y prueba creativa:** se pidió a KRATOS por chat un Short de 60 s sobre sueños lúcidos → KRATOS creó la tarea 617 para Sol → Sol investigó (8 llamadas a la biblioteca, 3 fuentes nuevas, 4 afirmaciones con nivel B/C) → entregó el proyecto P1 (`completed`, 18 archivos en `~/Documents/Kratos/Proyectos/P1-…/v1/`) → verificación en código superada → predicción registrada (60–900 vistas a 7 días, confianza 0,6, con su base) → **KRATOS recuperó el paquete** en una conversación nueva y citó el guion.
- **No probado todavía:** prueba de memoria tras reiniciar el Mac; prueba de aprendizaje (resolver la predicción con datos reales, exige publicar el Short); que la fábrica convierta el paquete en vídeo (el motor aún no renderiza Shorts desde un paquete).

## Pendiente
Etapa 5 (afirmaciones y conexiones cargadas con contenido), etapa 6 (motor de audiencias con datos reales), etapa 8 (que la fábrica consuma el paquete de Sol), etapa 9 (resolver predicciones con analítica real), etapa 10 (las 8 pruebas y los 15 criterios), currículo de 36 módulos, biblioteca a 500+.

## Estado al 4-nov-2026, 23:55 (currículo en marcha)
- **Currículo:** módulos 1–4 completados y verificados (Neurociencia, Psicología cognitiva, Atención, Memoria); cupo diario de 4 alcanzado, el 5 (Emoción) se lanza solo al liberarse el cupo. KRATOS, por su cuenta, encargó además un módulo extra de sueño y sueño lúcido.
- **Biblioteca:** 273 fuentes verificadas de 302; 11 leídas a texto completo (el código anota el porcentaje leído); 127 afirmaciones (A 21, B 42, C 28, D 11, E 20, H 5); 35 conexiones tipificadas.
- **Lectura real en uso:** Sol leyó enteros artículos de acceso abierto (p. ej. dispositivos de inducción de sueño lúcido; Godden y Baddeley 1975) y una obra de Project Gutenberg; James y Freud solo en parte (2 % y 9 %, así anotado).
- **Empresa:** el ciclo del CEO encargó a Sol el paquete de estrategia del lanzamiento iOS de «Aion: Fasting & Meditation» (proyecto P11, completado) con una predicción: 25–120 primeras descargas en 30 días, confianza 0,6.

### Criterios de aceptación (sección 34) con evidencia
| # | Criterio | Estado | Evidencia |
|---|---|---|---|
| 1 | Sol existe y conserva su identidad | Cumplido | `agent_functions.sol`, estatuto Omega |
| 2 | KRATOS se comunica con Sol | Cumplido | tareas 617, 638, 647 creadas por KRATOS |
| 3 | Sol accede a su biblioteca | Cumplido | herramienta `biblioteca_sol`, 8+ llamadas por tarea |
| 4 | Las fuentes se recuperan | Cumplido | `biblioteca_sol accion=buscar`; 302 fichas |
| 5 | Citas trazables | Cumplido | cada afirmación exige `fuente_id`; A/B exigen fuente verificada |
| 6 | La memoria persiste | Cumplido | PostgreSQL + bóveda; sobrevivió a 3 recargas de servicios |
| 7 | Entregables guardados | Cumplido | 11 proyectos en `~/Documents/Kratos/Proyectos/` |
| 8 | KRATOS encuentra los resultados | Cumplido | prueba del 4-nov: recuperó P1 en conversación nueva |
| 9 | Guiones con investigación | Cumplido | P1: fuentes y afirmaciones antes del guion |
| 10 | Dirección narrativa a vídeos | Parcial | el paquete existe; la fábrica aún no lo consume |
| 11 | Evaluación de calidad | Parcial | verificación en código; falta evaluador independiente del generador |
| 12 | Sistema de aprendizaje | Parcial | predicciones registradas (2); ninguna resuelta todavía |
| 13 | Errores registrados | Cumplido | `audit_log` (`omega.*`), lecciones |
| 14 | Continuar proyectos anteriores | Cumplido | reentrega por `proyecto_id` con versiones |
| 15 | Funciones existentes operativas | Cumplido | 117/118 pruebas (la de voz falla a ratos por carga) |

**No probado:** reinicio completo del Mac; resolución de predicciones con datos reales; examen de dominio de cada módulo.
