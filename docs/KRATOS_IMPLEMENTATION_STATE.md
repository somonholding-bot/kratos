# KRATOS — estado de la implementación del sistema híbrido (agentes + playbooks)

Programa: «Master execution prompt — KRATOS hybrid agent operating system» (1-nov-2026). Optimización en el sitio, sin rehacer nada.
Lee este archivo al retomar una sesión; no vuelvas a auditar todo el repositorio.

## Fase actual
**D — Playbooks** (siguiente). A, B y C terminadas y confirmadas.

## Línea base (1-nov-2026)
- Rama de trabajo: `musica-eco` (los servicios launchd `com.jarvis.*` corren desde este checkout, así que no se cambia de rama).
- Punto de retorno: etiqueta git `pre-hibrido-2026-11-01` (commit `de2f951`).
- Cambios sin confirmar al empezar: `docs/aion-funciones.md` (inventario de la app Aion; su subida al repo está pendiente de decisión del propietario).
- Pruebas: `npm test` → 75/75 (node --test, BD `jarvis_test`, sin IA).
- Motor de IA: suscripción de Claude (`claude -p` + MCP `src/mcp-kratos.ts`); API de Anthropic opcional; Groq/Ollama para lo simple.
- Fallos conocidos de partida: tareas dadas por completadas sin resultado recuperable (corregido en parte el 29-oct, ver `docs/reparacion-director.md`); contexto de agentes inconsistente; latencia y tokens; KRATOS sin conciencia de todas las herramientas instaladas; el CEO canceló su propio ciclo (ya bloqueado).

## Hecho
- (A) Etiqueta de retorno, este archivo y la auditoría `docs/kratos-architecture-audit.md` (hallazgos clave: `allowed_tools` de los agentes nunca se aplica; la verificación de tareas era solo del modelo; la suscripción no escribe en `ai_usage`; inventario de herramientas fijo en código; ~15–25k tokens por turno de texto).
- (B) `db/030_resultados_duraderos.sql`: columnas `artifacts`, `checkpoints`, `verification_result`, `verified_at`, `started_at`, `completed_at`, `playbook_id`; índices de búsqueda.
- (B) `src/core/verify.ts`: verificación objetiva por tipo (informe ≥200 caracteres, guardado y leído de vuelta, sin acciones externas inventadas; vídeo: archivos, duración, miniatura, subtítulos, subida).
- (B) Estado `verificando` entre ejecutar y completar (`src/worker.ts`, `tasks.ts: markVerifying`); `completeTask` guarda artefactos y comprobaciones; `checkpoint()` para progreso recuperable (usado por `video.ts`).
- (C) `db/031_registro_herramientas.sql` + `src/core/toolregistry.ts`: tabla `tool_registry` sincronizada desde el código al arrancar servidor y worker (origen, toolsets, agentes, estricta, aprobación) con uso 7 d, último uso, último error y salud desde `audit_log`; herramienta `registro_herramientas` (también en el ciclo del CEO).
- (C) `allowed_tools` de cada agente se aplica de verdad: el especialista corre por `runAgentWithSubscription` con `KRATOS_TOOLSET=agente:<id>` y el MCP le da solo `allowed_tools ∩ AGENT_SAFE_TOOLS` más un mínimo de lectura (informes, conocimiento, notas) y web. Errores de herramientas auditados (`herramienta.error`).
- (C) `agentsRegistry` devuelve herramientas, modelo, salud, última actividad y tareas en curso reales.
- (B) `searchReports` filtra por agente, negocio, playbook, tipo, estado y fechas; `taskResult` devuelve artefactos, verificación y puntos de control; herramienta `buscar_informes` ampliada.

## Pruebas verificadas
- `npm test` 75/75 antes de tocar nada; 80/80 con la fase B; 83/83 con la fase C (`test/herramientas.test.ts`: sincronización, permisos por agente, registro de agentes real) (`test/verificacion.test.ts`: informe corto/sin archivo no pasa; informe real → verificado, artefacto y búsqueda por agente/tipo/fecha; acciones externas inventadas invalidan; el worker no completa sin verificación; vídeo comprueba archivos y duración; checkpoints).

## Pendiente
- B (restos para E): `ai_usage` para la suscripción, `lessons.task_id`, idempotencia de tareas del CEO. Reiniciar `com.jarvis.worker` cuando termine el vídeo 342 (hasta entonces corre el código anterior).
- D: motor de playbooks (definición, validación, ejecución, prueba, versiones).
- E: contexto mínimo, enrutado de modelos, caché medida, coste por tarea, límites de ejecución.
- F: panel: solo añadidos mínimos con los componentes existentes.
- G: API remota segura para el reloj. H: app watchOS.

## Bloqueos reales
- Ninguno por ahora. Mientras el worker produce un vídeo (tarea 342) no se reinicia `com.jarvis.worker`.

## Decisiones
- Todo se extiende sobre tablas y módulos existentes (`tasks`, `agent_functions`, `system_state`, `registry.ts`, `handlers.ts`), sin framework nuevo de workflows.
- Los ocho avatares (KRATOS + 7 planetas) no cambian; la ejecución interna puede compartir sesión/modelo.

## Siguiente acción exacta
Fase D: `playbooks/<agente>/<nombre>.yaml` (id, nombre, versión, objetivo, agente, entradas, herramientas, pasos, salidas, verificación, reintentos, aprobaciones); cargador y validador en `src/core/playbooks.ts`; `tasks.playbook_id`; `specialistBrief` incluye los pasos; `verify.ts` ejecuta las comprobaciones declaradas; herramientas `ver_playbooks`/`ejecutar_playbook`; versiones e historial.
