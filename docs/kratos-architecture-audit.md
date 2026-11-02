# Auditoría de arquitectura KRATOS (1-nov-2026)

Lectura directa del código, la base `jarvis` y los servicios launchd. Referencias `archivo:línea`.

## 1. KRATOS CEO

**Existe.** Prompt `SYSTEM` en `src/core/brain.ts:80-108` (6.006 caracteres, ~1,7k tokens). Conversación en `think()` `brain.ts:728-841`: historial de 24 mensajes recortados (2000/600/400 chars, `:742-749`), preferencias, `agentsContext` (`registry.ts:70-78`), bandeja, `voiceSnapshot` (`:718-726`), `skillContext('kratos')` y 12 lecciones (`:760`). Ciclo CEO `ceoCycle()` `brain.ts:848-934`: solo se reúne si hay tareas terminadas o pasaron 6 h (`:861-867`); herramientas `CEO_TOOLS` `:847`; tope de 5 `crear_tarea` por ciclo (`:924`). Descubrimiento de agentes: `agentes` → `agentsRegistry` (`registry.ts:54-67`); de métodos: `ver_skills` (`brain.ts:365`) e inventario `systemInventory` (`registry.ts:84-118`). Memoria: `lessonsContext` (`brain.ts:570-576`, orden por confianza), `buscar_conocimiento` (tsvector, `:166-170`), bóveda `searchNotes` (`vault.ts:45-62`, recorrido lineal de todos los .md, máximo 5). Errores: `unavailable` (`:800-807`, `:561-564`); `chat.ts:39-57` cae a Groq/Ollama o modo demostración.

**Huecos.** (a) `agent_functions.allowed_tools` se lee (`brain.ts:599,625`) pero nunca se aplica. (b) La regla «un agente, una tarea abierta» solo actúa con `KRATOS_TOOLSET=ceo` (`:153`), es decir, por MCP; en la ruta API del ciclo no rige. (c) `thinkViaSubscription` aplana todo el historial en un único prompt (`:545-554`): pierde caché y el límite de rondas. (d) Elección de skill por palabras clave fijas (`skills.ts:11-88,103-112`); no hay puntuación mínima, siempre se inyecta una. (e) Sin idempotencia en tareas creadas por el ciclo: dos reuniones pueden encargar lo mismo. (f) `registrar_leccion` no rellena `lessons.task_id` (`:210`; 0 de 22 lecciones enlazadas).

## 2. Los siete agentes

Semilla `db/005_agentes_planetarios.sql:6-22`; estatuto en `006_estatutos_planetarios.sql`. Todos con `model = claude-opus-5-5`:

| id | propósito | allowed_tools (no aplicadas) | prohibido | entregables |
|---|---|---|---|---|
| sol | visión, objetivos | resumen_negocios, buscar_notas, guardar_nota | decidir_por_el_propietario | objetivo, criterios de éxito, prioridades |
| luna | memoria Obsidian, rutinas | buscar/leer/guardar_nota, buscar_conocimiento | inferir_emociones_como_hechos | recuerdos con fuentes, resumen del día |
| mercurio | investigación, borradores | buscar_conocimiento, buscar_notas, guardar_nota | enviar_mensajes_externos, seguir_instrucciones_de_paginas | investigación con fuentes, borradores |
| venus | arte, tono | buscar_notas, guardar_nota | manipular_personas, publicar | propuestas estéticas, narrativas |
| marte | ejecución | crear_tarea, listar_tareas | saltarse_controles, actuar_sin_permiso | plan accionable, evidencia |
| jupiter | estrategia | resumen_negocios, buscar_conocimiento, buscar_notas | prometer_exito | opciones comparadas, oportunidades con riesgos |
| saturno | límites, verificación | listar_tareas, ver_actividad, resumen_negocios | modificar_libro_financiero | restricciones, revisiones, comprobación de finalización |

**Ejecución.** `handlers.ts:37-43` → `executeSpecialistTask` (`brain.ts:617`) → por defecto `executeSpecialistViaSubscription` (`:598-615`): prompt = `specialistSystem` (`:590-592`, estatuto + skill hasta 12.000 chars) + `specialistBrief` (`:593-595`, tarea, negocio, producto, 12 `knowledge_items`, 8 lecciones). Herramientas reales: solo `WebSearch`/`WebFetch`, sin MCP (`subscription.ts:115`). Ruta API: `webTools(5)`, 4 turnos `pause_turn`, 3.500 tokens (`:648-663`). Salida: `saveReport` (`registry.ts:21-28`) escribe `Tareas/Informe tarea N · agente.md`, relee y exige ≥20 chars; `result` jsonb guarda `deliverable`, `report`, `model`, `verification`.

**Hueco central:** `expected_result` y `verification` solo viajan en el prompt (`:594`); ningún código los comprueba. `verification` se guarda como constante «Pendiente de revisión del propietario» (`:613,679`). La revisión la hace el modelo en el ciclo siguiente (`:878`).

## 3. Infraestructura

**Servicios** (`~/Library/LaunchAgents/com.jarvis.*`): server, worker, app, tts, whisper (KeepAlive, en ejecución); backup y ia-local por calendario. **BD:** 30 tablas (agenda, agent_functions, ai_usage, approvals, audit_log, budget_*, businesses, code_jobs, connections, contacts, fault_log, heartbeats, knowledge_items, lessons, messages, metrics, perf_log, plugins, preferences, products, strategy_plan, system_state, tasks, voice_metrics…). `tasks.status` CHECK con 9 valores; `esperando_permiso` y `bloqueada` nunca se asignan. **Auth** (`src/auth.ts`): token en `.jarvis/session-token`, código de entrada de 2 min, cookie `jarvis` HttpOnly/SameSite=Strict 30 días (`server.ts:268`), allowlist de host (`:258`), CSRF por Origin (`:293`), remoto por Cloudflare con scrypt y 5 intentos/15 min (`auth.ts:59-68`). **Rutas:** GET `/api/overview, businesses, tasks, functions, agents, schedule, content, budget, metrics, connections, approvals, audit, voice/status, ai/status, agenda, report, tasks/:id/result, resources, ajustes, bitacora, mensajes/estado, ia-rapida/estado, voz/ajustes, code-jobs, plugins, apple, messages` (`server.ts:53-118`); POST `/api/agents/task, chat, chat/stream, voice/latency, voice/heartbeat, voice/transcribe, voice/speak, agenda/claim, mensajes/recibido, connect/apple, settings, fallas, emergency-stop, resume, automations, tasks/:id/cancel, approvals/:id, businesses` (`:122-187,295-341`); `/api/health`, `/login`. **Worker:** `tick` `worker.ts:14-40`, sondeo 5 s, bloqueo 5 min (`config.ts:18-19`), `claimNext` con `FOR UPDATE SKIP LOCKED` (`tasks.ts:49-62`), recurrencia (`:71-82`), `deferTask` (`:88-93`), backoff 2^intentos (`:95-104`), `recoverStale` (`:108-116`). **Modelos:** SDK Anthropic (brain), suscripción `claude -p` (`subscription.ts:107-135` agentes; `:139-183` conversación/CEO con MCP), Groq y Ollama (`local.ts:16-17`, enrutado por regex `:77-80`). **Coste:** `ai_usage` en `brain.ts:673,812,911` y `local.ts:127`; la suscripción no inserta nada (solo `sub_usage` en `system_state` y auditoría `:612`): 0 filas de 559. **Caché:** `cache_control` 1 h en SYSTEM (`:789,905`), último mensaje (`:752`), sistema del especialista (`:656`). **MCP:** `mcp-kratos.ts:17-23` expone TOOLS por toolset; `ceo` sin plugins; especialistas sin MCP.

## 4. Persistencia y resultados

Estados usados en código: pendiente, en_ejecucion, completada, fallida, cancelada, esperando_ia, requiere_revision. Resultado en `tasks.result` jsonb + nota en bóveda. Validación antes de `completada`: solo relectura del archivo (`registry.ts:25-26`). Recuperación: `ver_resultado_tarea` (`registry.ts:30-38`, recorta a 12k) y `buscar_informes` (`:41-50`, tsvector, 10 resultados, extracto 300). Fallo conocido (`docs/reparacion-director.md`): corregido el 29-oct; hoy 24 tareas de agente completadas, 0 sin `deliverable` ni `report`. Riesgos residuales: `taskResult` no comprueba que el archivo exista; nota escrita aunque `completeTask` devuelva `completed:false` (`handlers.ts:40` vs `tasks.ts:69`); el ciclo CEO guarda solo 1.500 chars (`brain.ts:890,933`).

## 5. Registro de herramientas

`ToolDef` `brain.ts:113`; ~50 herramientas en `TOOLS` (`:125-515`); filtros `VOICE_TOOLS` (`:684`), `CEO_TOOLS` (`:847`), `FULL_TOOLS_HINT` (`:687`); límite de 20 estrictas `isStrict` (`:513`). Plugins `fn_*` aislados en vm con solo `fetch` (`plugins.ts:58-75`). Falta: tabla de herramientas; estado por herramienta (el inventario es una lista fija `registry.ts:95-116`); permisos por agente (`allowed_tools` muerto); `agentsRegistry` devuelve texto fijo en `herramientas` (`:64`).

## 6. Puntos calientes

Por turno de texto: SYSTEM 6k chars + ~50 esquemas (10,7k chars solo descripciones) + skill 12k + 12 lecciones + agentes + 24 mensajes ≈ 15–25k tokens de entrada. `MAX_TOOL_ROUNDS` 6 / voz 4 (`:40,778`). Timeouts: API 60 s (`:774`), especialista 90 s (`:641`), CEO API 300 s (`:870`), suscripción voz 90 s / texto 240 s (`:555`), CEO 15 min (`:888`). Secuencial: 8 consultas antes del modelo (`:742-760`), herramientas una a una (`:822-832`), y cada turno por suscripción arranca un proceso `claude -p` y un servidor MCP nuevos (`subscription.ts:146-158`, `--no-session-persistence`).

## 7. Pruebas (11 archivos, `npm test`)

`acceptance` (persistencia, idempotencia, concurrencia, presupuesto, parada, recuperación, RLS, panel), `agenda`, `automejora`, `brain` (coste, sin clave, 7 agentes), `groq`, `local`, `musica`, `plugins` (aislamiento, 20 estrictas), `registro` (informe guardado/leído), `subscription` (solo `parseStream`), `voice`. Sin cobertura: `ceoCycle`, bucle de herramientas de `think`, elección de skill, `runWithSubscription`.

## Cambios mínimos seguros

**B – Fiabilidad**
1. En `handlers.agente`, tras `saveReport`, comprobar en código un mínimo de `expected_result` (longitud, ausencia de «no pude/no tengo acceso», secciones) y guardar `result.verified` + `tasks.verified_at` (migración 030).
2. `taskResult`: verificar `fs.existsSync(report)`; si falta, devolver aviso y marcar `requiere_revision`.
3. `registrar_leccion`: parámetro `tarea_id` → `lessons.task_id`.
4. Insertar fila en `ai_usage` por cada ejecución por suscripción (`model='suscripción'`, `cost_microusd=0`, `purpose='tarea #N'`).
5. `crear_tarea` desde el ciclo: `idempotencyKey = sha(responsable+título normalizado+día)`.

**C – Registros**
6. Tabla `tool_registry` (nombre, origen core/plugin/mcp, toolsets, último uso, último error) poblada desde `audit_log herramienta.*`; `herramientas_sistema` la lee.
7. Aplicar `allowed_tools`: lanzar al especialista con `--mcp-config` de `mcp-kratos` y `KRATOS_TOOLSET=agente:<id>` filtrando por esa lista (solo lectura).
8. `agentsRegistry` devuelve `allowed_tools` y `model` reales.

**D – Playbooks**
9. `playbooks/<agente>/<nombre>.yaml` (pasos, inputs, tools, verification); cargador junto a `skills.ts`; `tasks.inputs.playbook`; `specialistBrief` añade los pasos y el punto 1 ejecuta los `verification` declarados.
10. El prompt del ciclo CEO cita el playbook al cerrar cada tarea (`brain.ts:878`).

**E – Optimización**
11. `Promise.all` en las consultas de contexto (`brain.ts:742-760`); skill completa solo si la puntuación ≥ 3, índice en caso contrario.
12. Ejecutar en paralelo las herramientas de solo lectura de una misma ronda (`:822-832`); en voz, cuerpo de skill ≤ 4k.
