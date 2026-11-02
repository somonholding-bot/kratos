# KRATOS — estado de la implementación del sistema híbrido (agentes + playbooks)

Programa: «Master execution prompt — KRATOS hybrid agent operating system» (1-nov-2026). Optimización en el sitio, sin rehacer nada.
Lee este archivo al retomar una sesión; no vuelvas a auditar todo el repositorio.

## Fase actual
**E — Optimización** (siguiente). A, B, C y D terminadas y confirmadas (servicios reiniciados el 2-nov-2026 tras recuperar Postgres).

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
- (D) `db/032_playbooks.sql`: tablas `playbooks` (estado prueba/produccion, versión activa, éxitos, fallos seguidos, coste medido, archivo semilla) y `playbook_versions` (contenido jsonb, hash, activa/sustituida/borrador/rechazada, origen, reversión); `tasks.playbook_version`; Saturno recibe `estado_youtube`.
- (D) `src/core/playbookchecks.ts`: 17 comprobaciones ejecutables sin IA (secciones, tabla_filas, numero_de_items, fuentes_citadas, sin_frases, entradas_reflejadas, bloque_json, lista_minima, campo_longitud, palabras, ritmo, idioma [aviso], sin_promesas_medicas, herramienta_usada [audit_log], archivo_existe, longitud_minima/maxima), marcadores `{{entrada}}`/`{{hoy}}` y expresiones numéricas (`{{duracion_min}}*2`).
- (D) `src/core/playbooks.ts`: ciclo completo. ENTREVISTA `missingInputs` (defectos, validación, preguntas); CREAR `createPlaybook`/archivos semilla `playbooks/<agente>/<id>.json` (`syncPlaybooksFromFiles` al arrancar servidor y worker: archivo = semilla, BD = verdad); VALIDAR `validateShape` + `validatePlaybook` (agente, skill, herramientas del registro y permisos del agente); EJECUTAR `instantiatePlaybook` (tarea `agente` con `playbook_id/version`, procedimiento en el brief ≤ 3.000 caracteres, idempotente, aprobación previa → `esperando_permiso`); PROBAR en `verify.ts` con la versión exacta de la tarea; MEJORAR `recordPlaybookOutcome` (éxitos, fallos seguidos, coste medido, «degradado» a los 2 fallos), política `si_falla_verificacion` en el worker (reintentar/revisar/fallar), `proposeVersion` (prueba → activa; producción → borrador; nunca por un solo fallo salvo «propietario: …»), `promotePlaybook`, `activateVersion` (exige ejecución verificada), `revertPlaybook` (versión nueva con `revierte_a`), `rejectVersion`; encadenado `afterPlaybookTask` (guion verificado → `produccion_video` una sola vez, respeta `subir`; `instruccion_ceo` → `result.siguiente_paso`, que el ciclo del CEO lee).
- (D) Herramientas `ver_playbooks` (texto, voz, CEO), `ejecutar_playbook` y `editar_playbook` (texto, CEO), las tres en `READ_ONLY` (19/20 estrictas); `playbookContext` en la conversación (selección por palabras clave, ≤ 200 caracteres); `editar_playbook crear` devuelve `parecido` en vez de duplicar; regla «un agente, una tarea abierta» también en `ejecutar_playbook` desde el ciclo del CEO. `specialistSystem` fija la skill del playbook e idioma del entregable.
- (D) Semillas: `playbooks/mercurio/yt-investigacion-competencia.json`, `venus/yt-guion-ritual-lunar.json` (encadena `producir_video`), `jupiter/yt-calendario-30-dias.json`, `saturno/yt-analisis-semanal.json` (recurrente semanal); esquema y ciclo en `playbooks/README.md`.

## Vídeo del canal Aion (2-nov-2026)
- Cadena antigua (imágenes fijas + zoom) RETIRADA por el propietario: `produceVideo` lanza un error explicativo y `producir_video` figura como retirada; el playbook de guion de Venus aún declara `tras_completar: producir_video` (fallará con ese error hasta que se adapte al motor nuevo).
- Cadena aprobada: motor de Orin en `scripts/media/episodio` (ver `LEEME.md`), voz Kokoro am_michael a velocidad 1.03, música ACE-Step. Episodio 1 «What If You Could Wake Up Inside Every Dream?» (5:37, 86 escenas) subido PRIVADO: https://youtu.be/SHzPra7QxeE, con subtítulos en inglés y banner del canal. La miniatura personalizada la rechazó YouTube (403: el canal necesita verificación por teléfono).
- Preferencias de KRATOS: Venus usa Sonnet 5.5; episodios de más de 5 minutos con pregunta de apertura; sin mencionar apps hasta 1.000 suscriptores y 4.000 horas.
- Pendiente: que Venus produzca el storyboard por beats (formato de `ep1.py`) y adaptar el playbook de guion; verificación por teléfono del canal; foto de perfil (la API no la cambia); nombre del canal: YouTube rechaza «Aion», sigue «IAON».

## Pruebas verificadas
- `npm test` 98/98 con la fase D (`test/playbooks.test.ts`, 15 pruebas: forma y validación contra BD, sincronización de archivos, entrevista, instanciación con aprobación previa, brief, verificación de texto y de bloques JSON, herramienta usada, política del worker y degradación, encadenado a vídeo, recurrencia, versiones/promoción/activación, regla de un solo fallo y reversión, herramientas y selección).
- `npm test` 75/75 antes de tocar nada; 80/80 con la fase B; 83/83 con la fase C (`test/herramientas.test.ts`: sincronización, permisos por agente, registro de agentes real) (`test/verificacion.test.ts`: informe corto/sin archivo no pasa; informe real → verificado, artefacto y búsqueda por agente/tipo/fecha; acciones externas inventadas invalidan; el worker no completa sin verificación; vídeo comprueba archivos y duración; checkpoints).

## Pendiente
- B (restos para E): `ai_usage` para la suscripción, `lessons.task_id`, idempotencia de tareas del CEO. Reiniciar `com.jarvis.worker` cuando termine el vídeo 342 (hasta entonces corre el código anterior).
- D (restos): confirmar en vivo tras reiniciar `com.jarvis.server` y `com.jarvis.worker` (hasta entonces los procesos viejos no exponen las herramientas ni ejecutan la política; la BD `jarvis` ya tiene la 032 y los 4 playbooks importados en `prueba`); primera ejecución real de cada semilla y `promover` a producción tras un éxito verificado; `registrar_leccion` con `tarea_id` (lo pide el análisis semanal); panel (fase F) para versiones y aprobaciones de playbooks.
- E: contexto mínimo, enrutado de modelos, caché medida, coste por tarea, límites de ejecución.
- F: panel: solo añadidos mínimos con los componentes existentes.
- G: API remota segura para el reloj. H: app watchOS.

## Bloqueos reales
- Ninguno por ahora. Mientras el worker produce un vídeo (tarea 342) no se reinicia `com.jarvis.worker`.

## Decisiones
- Todo se extiende sobre tablas y módulos existentes (`tasks`, `agent_functions`, `system_state`, `registry.ts`, `handlers.ts`), sin framework nuevo de workflows.
- Los ocho avatares (KRATOS + 7 planetas) no cambian; la ejecución interna puede compartir sesión/modelo.
- (D) Playbooks en JSON validado en código (sin dependencia YAML ni nueva); el archivo es la semilla y la BD la verdad; el proceso nunca escribe en el repositorio.
- (D) `approvals.ts` no se tocó: la aprobación previa de un playbook (`scope.tipo = playbook_ejecucion`) se resuelve desde el gancho existente `plugins.onApprovalDecided`.
- (D) El calendario de 30 días lo lleva Júpiter (estrategia) para no cargar a Venus ni a Saturno, que ya tienen el guion y el análisis semanal.

## Siguiente acción exacta
1. Confirmar la fase D con el propietario y hacer commit en `musica-eco` (regla del propietario; esta sesión no confirmó nada). 2. Cuando termine el vídeo 342, reiniciar `com.jarvis.worker` y `com.jarvis.server` (`launchctl kickstart -k gui/$(id -u)/com.jarvis.worker`, ídem server): al arrancar importan `playbooks/` y sincronizan el registro. 3. Primera ejecución real: `ejecutar_playbook {id: "yt-investigacion-competencia", negocio_id: <Aion>, parametros: {tema: "planetary hours"}}` y revisar el informe; después `yt-guion-ritual-lunar` (encadena el vídeo). 4. Fase E: contexto mínimo (`Promise.all` en `think`, skill completa solo con puntuación ≥ 3), enrutado de modelos, `ai_usage` para la suscripción, coste por tarea y límites de ejecución.
