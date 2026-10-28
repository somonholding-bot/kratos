# Jarvis — Etapa A: diagnóstico, investigación y arquitectura

Fecha de la investigación: **28 de octubre de 2026**. Nada instalado, conectado ni pagado.

Etiquetas de evidencia usadas en todo el documento:

| Etiqueta | Significado |
|---|---|
| **[Doc]** | Comprobado hoy en documentación oficial o en el repositorio original |
| **[Equipo]** | Comprobado en esta computadora (solo lectura) |
| **[Terceros]** | Fuentes no oficiales; requiere confirmación antes de gastar |
| **[Inferido]** | Deducción razonada, no comprobada |
| **[Desconocido]** | No verificado todavía |

---

## 1. Comprensión resumida

Jarvis es un **sistema operativo de trabajo** para tus negocios, no un chatbot:

- Un **Director** (Claude) que es el único coordinador. Recibe objetivos tuyos, los convierte en tareas persistentes y delega en 8 funciones especializadas.
- **Código determinista, fuera del modelo**, para lo que no puede fallar: presupuesto, permisos, aprobaciones, parada de emergencia, cuotas, auditoría. Claude propone; el código decide si se permite.
- **Memoria por negocio y producto**, con separación entre hechos, hipótesis, decisiones aprobadas y datos externos no confiables, aislada a nivel de base de datos.
- **Proactividad real pero sobria**: objetivos permanentes → cola priorizada → ejecución dentro de cuotas → verificación → registro. Si no hay trabajo útil, espera.
- **Panel visual tipo centro de mando** con estados reales (nunca simulados), voz en español con pulsar-para-hablar, y botones visibles de silencio, cancelación, pausa y emergencia.
- **Autonomía por niveles (0–4)** que nunca sube sola. Toda acción externa, gasto o publicación pasa por una aprobación con alcance, cuenta, importe máximo y vigencia.
- Primer departamento: **agencia de marketing de apps**, orientada a usuarios activados, retención y margen (no a vistas).

---

## 2. Diagnóstico del equipo (solo lectura) [Equipo]

| Aspecto | Resultado | Efecto práctico |
|---|---|---|
| Equipo | MacBook Air, Apple **M5**, 10 núcleos, **16 GB RAM**, macOS 26.6.2 (arm64) | Suficiente para panel, base de datos y transcripción local. Justo para modelos de lenguaje locales grandes. |
| Disco | 926 GB, **142 GB libres** | Holgado. Modelo de voz local ≈ 1,6 GB. |
| Energía | En **batería** (59 %). Reposo del sistema configurado a **1 minuto** en batería y en corriente | **Hoy no puede trabajar 24 h**: un Mac dormido no ejecuta nada. Ver §9. |
| Node.js | v24.18.0 | Válido para Claude Agent SDK (≥18.14). **No** válido para OpenClaw actual (exige ≥24.22.1). |
| Python | 3.9.6 del sistema (antiguo) | Pipecat y la skill webapp-testing requerirían un Python moderno aislado (uv + 3.12). |
| PostgreSQL | **16.15 ya instalado y en ejecución** (Homebrew, solo 127.0.0.1:5432) | Reutilizable con una base y un usuario dedicados; no hace falta instalar otro motor. |
| Docker | 29.8.0, en ejecución | Disponible si alguna pieza lo necesita; no es obligatorio. |
| FFmpeg | 9.0.1 | Necesario para video (HyperFrames) y audio. Ya está. |
| Ollama | 0.40.7 con `gemma4:26b` (17 GB) | Ese modelo **no cabe cómodamente** en 16 GB junto al resto. No lo usaré como cerebro de Jarvis. |
| Otras | git, gh (sesión activa), Homebrew, Xcode, bun, Claude Code 2.1.252 | — |
| No instalados | n8n, OpenClaw, whisper.cpp, uv, Redis, Caddy, Tailscale | Ninguno es imprescindible para la Etapa B. |
| Puertos ocupados | 5000 y 7000 (AirPlay), 5432 (Postgres), 11434 (Ollama), 8768 (un proceso node desconocido), 5037 (adb), 39127 (1Password) | Jarvis usará **127.0.0.1:7420** (libre). No tocaré el proceso del 8768. |
| Audio | Micrófono y altavoces del MacBook Air (predeterminados) + un micrófono adicional de un dispositivo personal | Selección de dispositivo será obligatoria en la interfaz. |
| Instalación previa | No existe `~/jarvis`, `~/.openclaw` ni `~/.n8n`; ningún servicio Jarvis/OpenClaw/n8n en launchd | Instalación limpia. |
| Otra carpeta de proyecto reciente | Aparece entre tus proyectos recientes. **No la he abierto.** | Pregunta abierta (§10). |

No he leído carpetas personales, credenciales, historial ni archivos ajenos.

---

## 3. Investigación de bases (central, voz, automatización, datos, contenido, medición)

Métricas de GitHub tomadas hoy vía API oficial. Las estrellas indican adopción, no calidad ni seguridad.

### 3.1 Central y agentes

| Candidato | Función | Licencia | Mantenimiento [Doc] | Hechos clave | Datos que salen | Decisión |
|---|---|---|---|---|---|---|
| **Claude Agent SDK** (TS `anthropics/claude-agent-sdk-typescript`) | Bucle de agente de Claude: herramientas, subagentes, sesiones, permisos por herramienta, hooks | Términos comerciales de Anthropic (no OSS) | v0.3.312 del 27-oct-2026; publicación casi diaria | Node ≥18.14 [Doc]. Permite listas blancas de herramientas por agente y hooks previos a cada herramienta: encaje directo con un “portero” de permisos | Prompts y resultados de herramientas → API de Anthropic | **Seleccionado como único coordinador** |
| **OpenClaw** (`openclaw/openclaw`) | Asistente personal completo: Gateway local, Control UI, 20+ canales de mensajería, apps y nodos, voz | MIT | 393 k estrellas; v2026.10.8 y betas a diario | Talk mode: STT nativo de Apple (puede usar red), TTS local MLX/sistema o ElevenLabs; `speechLocale` configurable; interrupción por voz [Doc]. **Herramientas se ejecutan en el host por defecto** salvo sandbox [Doc]. Requiere Node ≥24.22.1 [Doc] | Al proveedor de modelo y canales configurados; chequeo diario de versión (desactivable) [Doc] | **Descartado como central** (ver §6). Reconsiderar sus apps de voz/canales en Etapa I |
| **LangGraph** | Grafos de agentes con estado y checkpoints | MIT | Muy activo | Durabilidad sólida, pero añade una segunda abstracción sobre Claude | Según proveedor | Descartado: redundante con Agent SDK + cola en Postgres |
| **CrewAI** | Equipos de agentes por roles (Python) | MIT | Muy activo | Fomenta conversación entre agentes; menos control fino de permisos | Según proveedor | Descartado: riesgo de bucles entre agentes, Python |
| **eve** (`vercel/eve`) | Framework de agentes durables (sesiones, skills, horarios, canales) | Apache-2.0 | v0.85.0 hoy; **en beta** [Doc] | “APIs y comportamiento pueden cambiar antes de GA” [Doc]. Acepta clave de Anthropic directa [Doc]. Orientado a despliegue en Vercel | Según despliegue | Descartado por ahora (beta, cambios diarios). Revisar cuando sea GA |

**Autenticación de Claude (importante)** [Doc]: el centro de ayuda de Anthropic indica que, con sesión de suscripción, el Agent SDK consume los límites del plan, y que desde el 7-oct-2026 los planes **Max y Team incluyen créditos mensuales de API** aplicables al Agent SDK **cuando se usa una clave de API de la organización de Console vinculada** ([support.claude.com/en/articles/15036540](https://support.claude.com/en/articles/15036540)). Fuentes de febrero de 2026 indicaban que usar tokens OAuth de suscripción en herramientas de terceros violaba los términos ([alternativeto](https://alternativeto.net/news/2026/2/anthropic-officially-bans-using-subscription-authentication-for-third-party-claude-use), [winbuzzer](https://winbuzzer.com/2026/02/19/anthropic-bans-claude-subscription-oauth-in-third-party-apps-xcxwbn/)). **Decisión: Jarvis usará solo una clave de API de Claude Console**, guardada en el Llavero de macOS. Nunca reutilizaré credenciales de tu suscripción.

**Precios de modelos** [Doc] ([platform.claude.com/docs/en/about-claude/pricing](https://platform.claude.com/docs/en/about-claude/pricing)), USD por millón de tokens:

| Modelo | Entrada | Salida | Lectura de caché | Uso en Jarvis |
|---|---|---|---|---|
| Haiku 5.5 (≤100 k tokens) | 0,10 | 0,50 | 0,01 | Clasificación, resúmenes, revisiones rutinarias |
| Sonnet 5.5 | 2 | 10 | 0,10 | Director y departamentos |
| Opus 5.5 | 4 | 20 | 0,20 | Solo planificación compleja, bajo cuota |

### 3.2 Voz

| Candidato | Hechos | Local / externo | Decisión |
|---|---|---|---|
| **whisper.cpp** (`ggml-org/whisper.cpp`, MIT, activo) | Transcripción con aceleración Metal en Apple Silicon; español soportado por los modelos multilingües | **100 % local** | **Seleccionado** para transcripción v1 [Inferido: latencia en M5 por medir en Etapa C] |
| Voces del sistema macOS (Web Speech `speechSynthesis` con voz local en español) | Sin coste, sin red si la voz es local (`localService: true`) | Local | **Seleccionado** como voz v1; calidad aceptable, no premium |
| Kokoro (`hexgrad/kokoro`, Apache-2.0) | TTS local de buena calidad; **último commit ago-2025** [Doc] | Local | Alternativa; mantenimiento débil → no por defecto |
| Piper (`OHF-Voice/piper1-gpl`) | TTS local, **GPL-3.0** | Local | Descartado: licencia más restrictiva para un sistema que puede crecer |
| **Pipecat** (BSD-2, v1.14.0 del 24-oct) | Tubería de voz en tiempo real (VAD, interrupción, STT/TTS intercambiables; Deepgram, Cartesia, Speechmatics, Soniox…) [Doc] ([docs.pipecat.ai](https://docs.pipecat.ai/pipecat/learn/speech-to-text)) | Según proveedores | **Ruta de mejora** si pulsar-para-hablar no basta. Exige Python moderno |
| **LiveKit Agents** (Apache-2.0) | Muy sólido para voz en tiempo real, pero requiere servidor LiveKit (Docker o nube) | Servidor | Descartado para un solo usuario local |
| Voz de OpenClaw | Ver 3.1; STT de Apple puede usar la red [Doc] | Mixto | No aplica (OpenClaw descartado) |
| ElevenLabs / Deepgram / Cartesia | Proveedores en la nube con español | **Envían audio/texto fuera** | Opcionales tras tu aprobación. Precios [Desconocido] |

Descartado expresamente: el reconocimiento de voz del navegador Chrome (envía audio a Google).

### 3.3 Automatización y ejecución duradera

| Candidato | Licencia | Hechos | Decisión |
|---|---|---|---|
| **pg-boss** (MIT, activo) | MIT | Cola de trabajos sobre PostgreSQL: reintentos, horarios cron, bloqueo para evitar duplicados | **Seleccionado**: reutiliza el Postgres que ya tienes |
| graphile-worker | MIT | Equivalente | Alternativa |
| **n8n** | Sustainable Use License (+ partes `.ee` con licencia empresarial) [Doc] | Uso interno permitido; no revender como servicio [Inferido de la licencia] | **Diferido a Etapa E**, solo si una integración concreta lo justifica |
| **Activepieces** | MIT salvo carpetas `ee` [Doc] | Alternativa más abierta a n8n | Diferido; comparar con n8n en Etapa E |
| Temporal / Inngest | MIT / no estándar | Potentes pero requieren servidor adicional | Descartados: complejidad no justificada hoy |

### 3.4 Conocimiento

- **PostgreSQL 16 (ya instalado)** con búsqueda de texto completo en español (`to_tsvector('spanish', …)`) y **seguridad por filas (RLS) por negocio**. [Doc del motor; Equipo: instalado]
- **Documentos versionados** en git dentro de la carpeta del proyecto (expedientes en Markdown + metadatos en BD).
- **pgvector** (búsqueda semántica): **no** en la primera instalación; solo si una prueba demuestra que mejora resultados frente a la búsqueda textual.

### 3.5 Contenido y distribución

| Candidato | Licencia | Hechos | Decisión |
|---|---|---|---|
| **HyperFrames** (`heygen-com/hyperframes`) | Apache-2.0 [Doc] | Video desde HTML; Node ≥22 y FFmpeg [Doc]; render local con Chrome sin cuota | **Seleccionado para Etapa F** |
| Remotion | Licencia propia “source-available” [Doc] | Empresas con más de cierto tamaño necesitan licencia de pago [Inferido de su licencia; verificar] | Descartado: HyperFrames cubre lo mismo con licencia abierta |
| Postiz (`gitroomhq/postiz-app`) | **AGPL-3.0** | Programador de publicaciones autoalojado; requiere varios servicios | Diferido a Etapa H; publicar exige tu política aprobada |

### 3.6 Medición

| Pieza | Para qué | Decisión |
|---|---|---|
| Instrumentación existente de tu app | Fuente principal | Revisar primero (pregunta §10) |
| PostHog (cloud o autoalojado) | Analítica de producto y embudos | Candidato; plan gratuito y límites [Desconocido] |
| Firebase/GA4 | Si tu app ya lo usa | Solo lectura |
| AppsFlyer / Adjust | Atribución móvil pagada | Solo si hay publicidad móvil con volumen; probablemente **no** en el piloto de 500 USD [Inferido] |
| RevenueCat | Suscripciones móviles | Solo si tu app cobra suscripciones |
| Observabilidad de agentes | Costes, latencia, errores | Tabla propia en Postgres; sin servicio externo al principio |

---

## 4. Skills: inventario, revisión y selección

Revisiones registradas hoy (commit corto en la rama principal):

| Repositorio | Tipo real | Licencia | Commit | Hallazgos de revisión | Decisión |
|---|---|---|---|---|---|
| `anthropics/skills` → **skill-creator** | Skill (con scripts y visor de evaluaciones) | Apache-2.0 (por skill) [Doc] | `dbd4588f9e` | Scripts de evaluación locales | **Instalar en Etapa B** (proyecto) para crear tus skills propias con pruebas |
| `anthropics/skills` → **frontend-design** | Skill (solo SKILL.md) | Apache-2.0 | `dbd4588f9e` | Sin scripts | **Instalar en Etapa B** para el panel |
| `anthropics/skills` → **webapp-testing** | Skill + scripts Playwright (Python) | Apache-2.0 | `dbd4588f9e` | Requiere Python moderno + Chromium | **Opcional**: el navegador integrado de esta app ya permite probar el panel |
| `anthropics/skills` → **mcp-builder** | Skill + scripts | Apache-2.0 | `dbd4588f9e` | Solo útil si construimos un servidor MCP propio | Diferida a Etapa E |
| `n8n-io/skills` (oficial) | **Plugin** (15 skills + servidor MCP + hooks SessionStart/PreToolUse/PostToolUse) | Apache-2.0 | `27b6b9f429` | El hook SessionStart inyecta instrucciones en **cada** sesión; requiere instancia n8n ≥2.2.0 con MCP activado [Doc] | Diferido; si adoptamos n8n, **preferir este** sobre el comunitario |
| `czlonkowski/n8n-skills` + `n8n-mcp` | Plugin (14 skills + router + hooks) + servidor MCP | MIT | `e037563e10` | n8n-mcp tiene 21 herramientas de gestión, incluidas **borrar workflows y credenciales**; permite `DISABLED_TOOLS` [Doc] | Diferido; si se usa, solo lectura con herramientas destructivas desactivadas |
| `coreyhaines31/marketingskills` | Colección de **52 skills** + carpeta `tools/` con CLIs e integraciones (102 scripts) | MIT | `0cd9b3a0ef` | Los SKILL.md son instrucciones; los scripts llaman APIs externas | **Copiar solo ~10 SKILL.md** (aso, launch, ad-creative, ab-testing, analytics, attribution, influencer-marketing, content-strategy, copywriting, onboarding) **sin `tools/`**, revisando cada uno antes de Etapa F |
| `obra/superpowers` | Plugin de metodología de desarrollo (15 skills + hook SessionStart) | MIT | `2ce8aa15d0` | El hook se activa en startup/clear/compact e impone su flujo en todas las sesiones | **No instalar**. Aplicaré sus principios (verificar antes de declarar terminado, TDD) sin el hook |
| `heygen-com/hyperframes` | Skills + CLI | Apache-2.0 | `67c7ec27d9` | Node ≥22, FFmpeg, Chrome headless [Doc] | **Etapa F** |
| `msitarzewski/agency-agents` | **Perfiles de agentes** (Markdown), no skills | MIT | `b37b5bb33b` | Muchos perfiles orientados a China/otras plataformas | **No instalar**; usar 3–4 perfiles (app-store-optimizer, growth-hacker, tiktok-strategist, content-creator) como **referencia** para redactar los departamentos |
| `vercel-labs/agent-browser` | **Herramienta ejecutable** (CLI Rust) | Apache-2.0 | `5801a50d26` | Descarga Chrome for Testing | Diferido a Etapa F, solo lectura de páginas públicas; nunca para eludir verificaciones |

Nota: en esta sesión de Claude Code ya aparecen cargadas las colecciones de marketing y HyperFrames. Eso afecta **a mi trabajo como desarrollador**, no al runtime de Jarvis: Jarvis tendrá su propia carpeta `skills/` con versiones fijadas y revisadas.

**Reglas permanentes**: sin autoactualización de skills/plugins; cada actualización = diff revisado + pruebas. Jarvis puede **proponer** una skill nueva (procedimiento “propuesta de capacidad faltante”), nunca instalarla.

Pendiente: comparación con/sin skill en tareas representativas (se hará en Etapa F con 3 tareas: ficha ASO, brief UGC, evaluación de experimento).

---

## 5. Arquitectura recomendada: **B — central propia con Claude Agent SDK**

```
 Tú (voz / texto)                        Navegador local  http://127.0.0.1:7420
        │                                 ┌───────────────────────────────────┐
        ▼                                 │ Panel Jarvis (React)              │
 [Micrófono]─pulsar─► whisper.cpp local ─►│ estados reales · 12 pantallas     │
                                          │ silencio · cancelar · pausa · STOP│
                                          └───────────────┬───────────────────┘
                                                          │ HTTP/WebSocket (token local)
 ┌────────────────────────────────────────────────────────▼─────────────────────┐
 │ Servidor Jarvis (Node 24, TypeScript)                                        │
 │                                                                              │
 │  DIRECTOR (Claude Agent SDK)  ── delega (profundidad máx. 1) ──► 7 funciones │
 │        │  cada llamada a herramienta pasa por ▼                              │
 │  PORTERO DE POLÍTICAS (código determinista)                                  │
 │   · parada de emergencia · nivel de autonomía · aprobaciones vigentes        │
 │   · cuotas (tokens, llamadas, voz, búsquedas, render)                        │
 │   · reserva de presupuesto (transacción + idempotencia)                      │
 │        │                                                                     │
 │  COLA Y PLANIFICADOR (pg-boss): horarios, eventos, reintentos limitados      │
 │  LIBRO FINANCIERO · REGISTRO DE AUDITORÍA · SALUD                            │
 └────────────────────────────────────────────────────────┬─────────────────────┘
                                                          ▼
                 PostgreSQL 16 local (base "jarvis", RLS por negocio)
                 + expedientes versionados en git
```

### Por qué B y no A (OpenClaw)

| Criterio | A: OpenClaw central | B: Agent SDK + panel propio |
|---|---|---|
| Encaje con “sistema operativo de negocios” | Asistente personal multicanal; presupuesto, aprobaciones y libro financiero habría que construirlos igual como plugins | El núcleo es exactamente lo que pides: tareas, políticas, presupuesto |
| Voz en español | Talk mode maduro; STT de Apple puede usar la red | Pulsar-para-hablar local (whisper.cpp); tiempo real con Pipecat como mejora |
| Seguridad | Herramientas en el host por defecto; incidentes de skills maliciosas en ClawHub en 2026 según fuentes de seguridad ([Unit42](https://unit42.paloaltonetworks.com/openclaw-ai-supply-chain-risk/), [CSA](https://labs.cloudsecurityalliance.org/agentic/agentic-openclaw-hardening-guide-v1/)) [Terceros] | Superficie mínima: solo 127.0.0.1, sin canales abiertos, portero en código |
| Estabilidad | Lanzamientos casi diarios, betas frecuentes | Dependencias pocas y fijadas |
| Compatibilidad hoy | Requiere actualizar Node | Funciona con tu Node actual |
| Esfuerzo de personalización | Adaptar su UI a un centro de mando: alto | Construir UI propia: medio |
| Coordinadores | Riesgo de dos coordinadores si se combina con otro runtime | Un único Director; sin conversación libre entre agentes |

**Reglas anti-bucle**: un solo Director; subagentes sin capacidad de delegar; máximo de turnos por tarea; presupuesto de tokens por tarea; una tarea solo la ejecuta quien tiene el bloqueo en la cola.

### Ocho funciones (resumen; la ficha completa se generará en Etapa F)

| Función | Modelo | Herramientas en Etapa B–D | Prohibido siempre |
|---|---|---|---|
| Director Jarvis | Sonnet 5.5 | Crear/priorizar tareas, consultar expedientes, pedir aprobaciones | Cambiar políticas, presupuestos o niveles |
| Inteligencia e investigación | Sonnet/Haiku | Búsqueda web (cuota), lectura | Seguir instrucciones encontradas en páginas |
| Producto, ASO y conversión | Sonnet | Lectura de fichas y analítica | Editar fichas sin aprobación |
| Estudio creativo | Sonnet | Borradores, HyperFrames local | Publicar; testimonios o funciones inventadas |
| Creadores y afiliados | Haiku/Sonnet | Investigación, briefs | Contactar o pagar a terceros sin aprobación |
| Distribución y comunidad | Haiku | Calendarios y borradores | Publicar fuera de política |
| Publicidad y experimentos | Sonnet | Propuestas, simulación | Activar o subir presupuestos |
| Analítica, operaciones y control | Haiku | Lectura de métricas, salud, informes | Modificar el libro financiero (solo lo hace el código) |

Las restricciones viven en la base de datos bajo un **rol de Postgres distinto** del que usa el proceso de agentes: los agentes, técnicamente, no pueden escribir sus propias reglas.

---

## 6. Presupuesto y costes previstos (supuestos explícitos)

**Decisión del usuario (28-oct-2026):** no hay un presupuesto fijo. Los 500 USD del encargo eran solo un ejemplo. El usuario asignará dinero a cada objetivo cuando lo decida (p. ej. “Jarvis, tienes X para esto”). Mientras tanto:

- El **saldo disponible de todas las partidas es 0**. Jarvis no puede reservar ni gastar nada.
- El libro financiero se construye igual (límites, reservas, auditoría), pero arranca vacío.
- Una asignación dicha por voz o texto queda como **propuesta**; solo pasa a vigor cuando el usuario la confirma en el panel, con importe, finalidad, cuenta y vigencia.
- Las cifras de esta sección son informativas para cuando haya presupuesto; no son un plan de gasto.

| Concepto | Estimación mensual | Base |
|---|---|---|
| API de Claude | **Tope duro configurado: 35 USD** (objetivo 15–30) | [Inferido] Haiku para rutina, Sonnet para decisiones, caché de prompts; el libro financiero bloquea al llegar al tope. Si tienes plan Max/Team, los créditos de API incluidos pueden cubrir parte [Doc] |
| Transcripción y voz | 0 USD | Local (whisper.cpp + voces del sistema) |
| PostgreSQL, cola, panel | 0 USD | Local, ya instalado |
| Servidor 24 h (opcional) | ≈ 5–15 USD | [Desconocido] Precio exacto se cotizará antes de proponerlo |
| Voz premium (opcional) | [Desconocido] | Solo si la apruebas |
| **Total operación** | **≤ 60 USD** | Encaja en tu partida de operación |

### Plataformas de creadores (para el piloto, todas [Terceros], confirmar en sitio oficial)

| Plataforma | Modelo | Condiciones encontradas | ¿Encaja en un piloto pequeño (≈150 USD)? |
|---|---|---|---|
| Whop Content Rewards | Pago por vistas (CPM) | Mínimo reportado ≈ **1.000 USD por campaña**, comisión ≈10 %, CPM típico 0,2–6 USD ([findclout](https://findclout.com/blog/whop-clipping-pricing), [clipspeed](https://www.clipspeed.ai/blog/whop-content-rewards-clipping-guide.html)) | **No** → descartar para el piloto |
| Insense | Suscripción + comisión | ≈400–650 USD/mes de plataforma + 7–20 % ([biddyco](https://www.biddyco.com/blog-posts/best-ugc-platforms)) | **No** |
| Billo | Compra de video | ≈99 USD por video ([memvers](https://memvers.com/blog/best-ugc-platforms-creators-2026)) | Sí, 1 video |
| JoinBrands | Compra de video, con plan gratuito | Pago por uso 15 % comisión; desde ≈25 USD/video; derechos de uso incluidos según fuentes ([topyappers](https://www.topyappers.com/blog/ugc-platforms-for-brands)) | **Sí**, 3–4 videos |

Ninguna API confirmada todavía → seguimiento manual + carga de informes hasta comprobarlo.

---

## 7. Permisos y lo que **no** hará Jarvis sin tu aprobación

Sin aprobación específica (alcance + cuenta + importe máximo + vigencia): gastar, contratar, aceptar términos, publicar, activar campañas, escribir a terceros, cambiar facturación/propietarios/permisos, conectar cuentas nuevas, instalar skills, subir de nivel de autonomía, desplegar públicamente, borrar datos importantes.

La voz reconocida **nunca** basta para autorizar pagos, borrados, accesos o cambios de seguridad: esas aprobaciones se confirman en el panel.

---

## 8. Alcance propuesto de la primera instalación (Etapa B) — **para tu aprobación**

Nivel de autonomía: **0 (demostración)**, pasando a **1 (lectura y borradores)** solo cuando aportes la clave de API.

| # | Acción | Efecto en tu Mac | Reversión |
|---|---|---|---|
| 1 | Crear carpeta dedicada del proyecto (propuesta: `~/Jarvis`) con git | Una carpeta | Borrar la carpeta |
| 2 | Instalar dependencias npm **dentro del proyecto** (Agent SDK fijado, servidor, React/Vite, pg, pg-boss, zod, vitest), con lockfile revisado | ≈ 300–500 MB en `node_modules` | Borrar `node_modules` |
| 3 | Crear base `jarvis` y dos roles (`jarvis_app`, `jarvis_agent`) en tu Postgres local existente | Una base nueva; tu Postgres sigue solo en 127.0.0.1 | `DROP DATABASE jarvis` + roles |
| 4 | Copiar skills fijadas: skill-creator, frontend-design | Archivos en `skills/` | Borrar carpeta |
| 5 | Construir: panel con las 12 pantallas (datos de demostración etiquetados), conversación por texto, negocios/productos, tareas persistentes, libro financiero simulado, aprobaciones, auditoría, parada de emergencia | Servidor en 127.0.0.1:7420 solo mientras lo arranques | Detener proceso |
| 6 | Pruebas de aceptación de Etapa B (persistencia tras reinicio, duplicados, dos agentes reservando el mismo saldo, cuota excedida, parada de emergencia, aislamiento entre negocios, inyección de instrucciones) | — | — |

**Fuera de este alcance** (pediré permiso en su etapa): servicio de arranque automático (launchd), whisper.cpp y su modelo (≈1,6 GB), Python/uv, n8n, conexiones a cuentas, cualquier gasto, servidor externo, cambios de energía del Mac.

La clave de API la guardarás tú en el Llavero de macOS con un comando que te daré; **no la pegues en el chat**.

---

## 9. Operación 24 horas: lo que hay que saber

- Un Mac **dormido o apagado no ejecuta trabajo**. Hoy tu Mac duerme al minuto y está en batería.
- Opción local: mantenerlo enchufado y que tú cambies el reposo en Ajustes del Sistema (no lo cambiaré yo). Jarvis recupera lo pendiente al despertar, sin repetir acciones ya hechas.
- Opción servidor: un servidor pequeño para la cola y las revisiones programadas. Te traeré una cotización exacta y esperaré tu aprobación antes de crear nada.

---

## 10. Preguntas imprescindibles

1. **Primera app**: nombre, enlace y plataformas (iOS / Android / web). ¿Tiene relación con algún proyecto existente?
2. **Audiencia, mercado e idioma** del piloto (p. ej. hispanohablantes en EE. UU., España, México…).
3. **Modelo de ingresos**: gratuita con anuncios, compra única, suscripción (¿RevenueCat?), freemium.
4. **Herramientas y cuentas** que ya usas: analítica, App Store Connect / Play Console, redes, correo.
5. ~~Presupuesto~~ — **Resuelto**: no hay presupuesto por ahora; el usuario lo asignará por objetivo cuando quiera (§6).
6. **Acceso a Claude**: usar Claude por API tiene un pequeño coste por uso. ¿La Etapa B debe funcionar a 0 USD (modo demostración sin Claude) o puede usar la API, cubierta por créditos de un plan Max/Team si lo tienes o con un tope muy bajo?
7. **24 h**: ¿Mac enchufado y sin reposo, o prefieres que cotice un servidor pequeño?
8. **Voz y privacidad**: ¿aceptas la propuesta 100 % local (sin enviar audio fuera, calidad de voz estándar) o quieres además evaluar una voz premium en la nube?
9. **Ubicación**: ¿`~/Jarvis` como carpeta del proyecto?

---

## 11. Estado de cada pieza

| Estado | Piezas |
|---|---|
| Implementado y probado | Ninguna (Etapa A no implementa) |
| Pendiente de autorización | Toda la Etapa B (§8) |
| Pendiente de conexión | Todas las cuentas externas |
| Propuesto para después | Voz (C), proactividad y launchd (D), conexiones de lectura (E), marketing (F), simulación (G), piloto (H), autonomía (I) |

## 12. Desinstalación (cuando exista instalación)

Detener el servidor → borrar la carpeta del proyecto → `DROP DATABASE jarvis` y roles → borrar la clave del Llavero. Etapa A no dejó nada que revertir.
