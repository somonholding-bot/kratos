# Fábrica de contenido Aion (v2, 2-nov-2026)

Adaptación del prompt «Autonomous YouTube Content Factory V2» a lo que el canal ya hace. Lo que no se toca: el motor de Orin (animación 2D con Pillow + ffmpeg, 1440p), la voz Liam de ElevenLabs, los Shorts verticales con subtítulos, la subida y programación por la API de YouTube.

## Cambios frente al prompt original
- **Sin 3D, sin vídeo de IA, sin stock de pago.** Ya era así: el estilo del canal es el personaje original Orin en ilustración 2D, símbolos esotéricos, parallax y efectos. No se usa Blender ni stock de pago.
- **Los 16 roles son lentes dentro de 3 playbooks** y comprobaciones en código, no 16 agentes permanentes (ver tabla).
- **El canal no menciona la app** hasta 1.000 suscriptores y 4.000 horas (orden del propietario).
- **Aprobación:** el propietario ordenó publicar directamente los vídeos que él pida. Sin una orden suya, todo se sube como privado/programado. La publicación sin supervisión necesita su aprobación expresa (no está activada).
- **Voz y créditos (límite real):** Starter = 40.000 créditos/mes; un minuto de narración gasta ≈ 800 créditos (ep. 1: 5.545 por 6:53). Un largo de 9 min ≈ 7.200 créditos → con Starter caben unos 5 largos al mes. Para 2 largos por semana hace falta el plan superior (Creator, 100.000 créditos). Los Shorts reutilizan el audio del episodio y no gastan créditos.
- **Duración:** largos de 8–12 min. El episodio 1 (6:53) queda fuera de ese rango; la puerta de calidad lo marca.

## Estilo de producción v3 (por orden del propietario, 2-nov-2026)
- **Cada vídeo es original:** el motor aplica un «look» por episodio (`LOOK` en el módulo del episodio: tono, saturación, brillo de los fondos; Orin y el dorado de marca no cambian) y el storyboard debe usar escenarios propios del tema. Venus elige un look distinto de los tres últimos (`content_queue.look`).
- **Transiciones:** `episodio/transiciones.py` (barrido, empuje, zoom con desenfoque, iris, destello dorado); dentro de una misma escena, fundido corto. Se desactivan con `TRANS=0`.
- **Sonido:** música cinematográfica épica con ACE-Step (local, gratis; generarla sin otra tarea pesada en marcha, o se queda sin memoria) y efectos de transición sintetizados con `episodio/sfx.py` (variable `SFX=ruta.wav`).
- Muestra: `~/Movies/Kratos/piloto/demo-v3-transiciones-musica.mp4` y `paletas-por-episodio.jpg`.

## Piezas (todo reutiliza lo existente)
| Pieza | Dónde |
|---|---|
| Playbook lunes: 30 ideas con evidencia, jurado y lentes de audiencia | `playbooks/mercurio/yt-fabrica-ideas-semanal.json` |
| Playbook de guion + storyboard por beats (3 títulos, 5 ganchos, brecha de curiosidad, riesgos de retención) | `playbooks/venus/yt-episodio-orin.json` |
| Playbook diario (recurrente cada 24 h): lee cola y YouTube, decide la tarea del día, puerta de calidad | `playbooks/jupiter/yt-fabrica-diaria.json` |
| Base de ideas (sin repetir, por huella) y cola con estados IDEA→…→ANALYZED | tablas `content_ideas`, `content_queue` (migración 033); KRATOS las lee con `consultar_bd` |
| Estado real de YouTube con visibilidad y fecha de salida | `estado_youtube` (corregido) |
| Cola frente a YouTube, importar ideas, puerta de calidad | `node scripts/media/fabrica.ts estado \| ideas \| qa` |
| Producción del episodio, voz, Shorts, subida | `scripts/media/episodio/*`, `subir-episodio.ts`, `subir-shorts.ts` |

## Los 16 roles
| Rol | Dónde vive |
|---|---|
| 1–5 Tendencia, Jung, Misterio, Relato, Comodín | cinco lentes del paso 3 de `yt-fabrica-ideas-semanal` |
| 6 Jurado | paso 4 (rúbrica) + cálculo del total en `fabrica.ts ideas` |
| 7–11 Escéptico, Principiante, Espiritual, Documental, Short | paso 5 (una línea por lente; críticas editoriales, no predicciones) |
| 12 Editor de guion | pasos 2–4 de `yt-episodio-orin` + comprobaciones (ritmo, ganchos, sin saludos) |
| 13 Director de voz | paso 6 + `voz_elevenlabs.py` con caché del audio aprobado |
| 14 Director visual | pasos 5–6 (storyboard, 3 miniaturas) |
| 15 Hechos y seguridad | paso 1 y 6 + `fuentes_citadas`, `sin_promesas_medicas` + `fabrica.ts qa` |
| 16 Analista de crecimiento | `yt-analisis-semanal` (Saturno) con YouTube Analytics real |

## Rúbrica de ideas (0–10, total ponderado)
curiosidad 20 % · demanda 15 % · relato 15 % · originalidad 10 % · credibilidad 10 % · competencia (10 = poco saturado) 10 % · relevancia 8 % · potencial Shorts 6 % · viabilidad 4 % · coste 2 %. Demanda y competencia solo con evidencia comprobada; sin ella, 5 y «sin datos». Nunca se inventan búsquedas, estadísticas ni vistas previstas.

## Calendario
Lunes: 30 ideas. Martes y jueves: episodio largo. Miércoles, viernes, sábado y domingo: un Short. Domingo: análisis y ciclo siguiente. Cadencia objetivo: 2 largos + 4 Shorts por semana y una tarea de producción cada día, siempre que la voz y la calidad lo permitan (calidad antes que cuota).

## Puerta de calidad (`fabrica.ts qa`)
Automáticas: MP4 reproducible, códecs h264+aac, relación de aspecto, duración, sincronía, volumen (−14 LUFS ±2), sin saturación, sin cuadros negros, miniatura (largos). Un fallo deja el elemento en BLOQUEADO. Revisiones editoriales (hechos, ganchos, título engañoso) las hacen los playbooks y quedan en el informe.

## Pendiente
Producir con KRATOS un piloto completo de punta a punta (guion → voz → animación → QA → subida) sin intervención: el paso de animación/voz aún se lanza con los scripts de `scripts/media/episodio`; falta encadenarlo en una tarea. Medir el coste real por episodio en cuanto haya uno.
