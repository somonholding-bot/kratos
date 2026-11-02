# Playbooks de KRATOS (fase D)

Un playbook es un procedimiento reutilizable de un agente: entradas, pasos, herramientas, salidas y **comprobaciones ejecutables en código** (`src/core/verify.ts`), con versiones e historial. KRATOS lo busca antes de crear una tarea a mano (`ver_playbooks`), pregunta solo las entradas que falten y lo ejecuta (`ejecutar_playbook`). Motor: `src/core/playbooks.ts`; comprobaciones: `src/core/playbookchecks.ts`.

## Esquema (JSON, un archivo por playbook en `playbooks/<agente>/<id>.json`)
| Campo | Obligatorio | Regla |
|---|---|---|
| `id` | sí | minúsculas, números y guiones; igual al nombre del archivo |
| `nombre`, `objetivo`, `descripcion` | sí (descripcion no) | textos; `objetivo` admite `{{entrada}}` |
| `version` | sí | entero ≥ 1 (en la BD manda el número de versión propio) |
| `agentes.responsable` | sí | uno de los siete planetas; igual a la carpeta; nunca `kratos` |
| `skill` | no | nombre de una skill en `skills/<agente>/` (se fija en el prompt) |
| `palabras_clave` | no | frases para que KRATOS lo seleccione ante una petición |
| `entradas` | sí | `{clave: {tipo: texto\|numero\|booleano\|fecha\|opcion, descripcion, requerida, defecto?, min?, max?, max_caracteres?, opciones?, pregunta?}}` |
| `herramientas` | sí | nombres del registro (`tool_registry`), permitidas para el agente; `WebSearch`/`WebFetch` incluidas |
| `pasos` | sí | `[{n consecutivo desde 1, titulo, instruccion, herramienta?}]` |
| `salidas` | sí | `[{nombre, tipo: informe\|bloque_json\|archivo, descripcion, obligatoria}]` |
| `ubicacion_artefactos` | no | `{boveda: "Tareas"}` |
| `criterios_exito` | sí | lista de textos |
| `verificacion` | sí | lista de comprobaciones (abajo); al menos una bloqueante |
| `recuperacion` | sí | `si_falla_verificacion: reintentar\|revisar\|fallar`, `si_falta_herramienta: revisar\|fallar` |
| `reintentos.max` | sí | 0–5 (la tarea nace con `max_attempts = max + 1`) |
| `aprobaciones` | no | `[{cuando: antes\|despues, tipo, descripcion}]`; `antes` deja la tarea en `esperando_permiso` |
| `coste` | no | `{duracion_estimada_min, usd_estimado, nota}`; lo medido va a `playbooks.coste_medido` |
| `programacion` | no | `{recurrencia_minutos ≥ 60}` (tarea recurrente) |
| `tras_completar` | no | `{accion: producir_video}` (exige bloque `encargo`) o `{accion: instruccion_ceo, instruccion}` |
| `idioma_entregable` | no | `es` \| `en` \| `mixto` |

## Las 17 comprobaciones (`nivel: aviso` no bloquea; `idioma` es aviso por defecto)
- `longitud_minima` / `longitud_maxima`: `{"caracteres": 2500, "campo"?: "encargo.guion"}`
- `secciones`: `{"titulos": ["Resumen", "Fuentes"]}` (encabezados `##`)
- `tabla_filas`: `{"minimo": "{{n_videos}}", "seccion": "Top videos"}`
- `numero_de_items`: `{"minimo": 3, "seccion": "Lecciones"}` (ítems de lista)
- `fuentes_citadas`: `{"minimo": 10, "dominio"?: "youtube.com"}` (URLs distintas)
- `sin_frases`: `{"frases": ["no tengo acceso"], "campo"?: …}`
- `entradas_reflejadas`: `{"entradas": ["tema"]}` (el valor aparece literal en el informe)
- `bloque_json`: `{"bloque": "encargo", "campos": ["titulo", "guion"]}` (bloque ```` ```json encargo ````; lo extraído queda en `result.extraido`)
- `lista_minima`: `{"campo": "encargo.imagenes", "minimo": "{{duracion_min}}*2"}`
- `campo_longitud`: `{"campo": "encargo.titulo", "minimo": 10, "maximo": 60}`
- `palabras`: `{"campo": "encargo.guion", "minimo": 600, "maximo": 1200}`
- `ritmo`: `{"campo": "encargo.guion", "duracion": "{{duracion_min}}", "ppm_min": 90, "ppm_max": 170}`
- `idioma`: `{"campo": "encargo.guion", "idioma": "en"}` (heurística por palabras vacías)
- `sin_promesas_medicas`: `{"campo": "encargo.guion"}`
- `herramienta_usada`: `{"herramienta": "estado_youtube"}` (fila `herramienta.<nombre>` del agente en `audit_log`; con motor API es aviso)
- `archivo_existe`: `{"campo": "encargo.video"}` o `{"ruta": "…"}`

Marcadores: `{{entrada}}` y `{{hoy}}` (AAAA-MM-DD) en objetivo, pasos, salidas, criterios e instrucción al CEO. Los campos numéricos (`minimo`, `maximo`, `caracteres`, `duracion`, `ppm_*`) admiten expresiones con entradas numéricas: `"{{duracion_min}}*2+1"`.

## Archivo = semilla, BD = verdad
- Al arrancar servidor y trabajador, `syncPlaybooksFromFiles` importa los archivos nuevos y, si un archivo cambió, crea y **activa** una versión `archivo` (autoría del propietario, también en producción). El proceso nunca escribe en el repositorio.
- `ver_playbooks {id}` devuelve `archivo_desactualizado: true` cuando la versión activa ya no coincide con el archivo (p. ej. tras versiones propuestas por el CEO). Para exportar la activa, con `consultar_bd`: `SELECT jsonb_pretty(contenido) FROM playbook_versions WHERE playbook_id='x' AND estado='activa'`.

## Ciclo de versiones
- Estados del playbook: `prueba` → `produccion` (`editar_playbook promover`, exige ≥ 1 éxito verificado).
- En `prueba`, `proponer_version` activa la nueva versión directamente. En `produccion` queda como `borrador`: se prueba con `ejecutar_playbook {version}` y se activa con `activar_version` solo tras una ejecución completada y verificada con esa versión. `rechazar_version` la descarta.
- Regla de un solo fallo: en producción no se admite `causa: fallo` con menos de 2 fallos seguidos, salvo motivo `propietario: …`. Cada éxito reinicia `fallos_seguidos`; dos seguidos dejan una observación «degradado» en `knowledge_items`.
- `revertir {version}` crea una versión nueva activa con el contenido de la anterior (`origen: reversion`, `revierte_a`, mismo hash). Cada tarea conserva `playbook_version` y se verifica con esa versión exacta.
