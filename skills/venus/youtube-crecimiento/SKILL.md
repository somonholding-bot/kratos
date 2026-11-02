---
name: youtube-crecimiento
description: Crecer un canal de YouTube de espiritualidad en español y convertir espectadores en usuarios de las apps; vídeos de alto valor, títulos, miniaturas, retención, Shorts y producción local gratuita.
---
# Crecimiento en YouTube y vídeos de alto valor (playbook propio de KRATOS)

## Principio
Un vídeo vale si cumple una promesa concreta para una persona concreta, y la cumple mejor que lo que ya existe. Antes de producir, define: ¿para quién?, ¿qué siente o consigue al terminar?, ¿por qué haría clic en este y no en otro?

## Antes de producir (investigación, 15 min)
1. Busca en la web y en YouTube los 10 vídeos con más vistas del tema en los últimos 12 meses (en español y en inglés). Anota títulos, miniaturas, duración y el primer minuto.
2. Identifica el patrón ganador y el hueco: lo que la gente pide en los comentarios y nadie responde bien.
3. Elige un ángulo: dolor emocional (ansiedad, insomnio, duelo, propósito), deseo (abundancia, amor, claridad) o curiosidad (leyes herméticas, la Luna, símbolos).

## Fórmulas que funcionan en el nicho
- Meditaciones guiadas por objetivo y momento: «Meditación para dormir en 10 minutos», «Afirmaciones de abundancia para la mañana».
- Enseñanza + práctica: explica una ley del Kybalión en 3 min y guía una práctica de 5 min.
- Calendario lunar: «Luna llena de [mes]: ritual de 7 minutos», publicado 1–2 días antes (búsqueda estacional garantizada).
- Shorts de 20–45 s: una frase potente, una pregunta o una afirmación, con llamada a la app.

## Título y miniatura (se deciden antes de grabar)
- Título ≤ 60 caracteres, beneficio o emoción + concreción (tiempo, momento, resultado). Sin clickbait que el vídeo no cumpla.
- Miniatura: una sola idea, 3 palabras como máximo, contraste alto (dorado/blanco sobre azul noche), un elemento visual central (luna, mano, ojo, luz). Haz 3 variantes y elige la más legible en tamaño móvil.

## Retención
- 0–15 s: promesa + prueba de que se cumplirá (nada de saludos largos ni logos).
- Cada 60–90 s: un cambio (imagen, música, pregunta, giro).
- Voz pausada, frases cortas, silencios intencionales; música ambiental 18–22 dB por debajo de la voz.
- Final: una acción concreta (otro vídeo o la app), sin «despedidas» largas que hagan cerrar.

## Embudo a la app (sin parecer anuncio)
- La app aparece como la herramienta natural de la práctica: «la fase de la Luna de hoy la ves en Aion».
- Enlace en la primera línea de la descripción y en el comentario fijado; en Shorts, en el vídeo relacionado.
- Mide: clics del enlace (con UTM/enlace propio), instalaciones esa semana, y qué vídeo las trajo.

## Cadencia y aprendizaje
- Semana tipo: 2 vídeos largos (8–20 min) + 5 Shorts.
- A las 48 h de cada vídeo: CTR de miniatura, retención media y a 30 s, fuentes de tráfico. Registra una lección por vídeo (qué repetir, qué cambiar).
- Duplica lo que funciona: si un tema supera la media ×2, haz 3 variantes más.

## Producción local y gratuita (ya instalada en el Mac)
- Voz: `~/.local/share/kratos-media/chatterbox/bin/python scripts/media/voz.py texto.txt voz.wav [referencia.wav]`
- Música: `~/.local/share/kratos-media/acestep/.venv/bin/python scripts/media/musica.py "descripción" segundos musica.wav`
- Imágenes: `~/.local/share/kratos-media/mflux/bin/mflux-generate-z-image-turbo --prompt "…" --width 1280 --height 720 --steps 9 --quantize 4 --output img.png` (no más de 1280×720: más grande supera la memoria del Mac; para banner o 4K, amplía después con `sips -z 1152 2048 img.png`). Tarda ~1–3 min por imagen.
- Subtítulos: whisper-server local (127.0.0.1:7432). Montaje: ffmpeg (Ken Burns lento sobre imágenes, ducking de música).
- Todo se sube como PRIVADO; publicar exige la aprobación del propietario.

## Reglas
- Nada de promesas médicas o de resultados garantizados; aviso de bienestar en la descripción.
- No usar música, imágenes o voces con licencia no comercial.
- No copiar guiones ajenos: inspírate en la estructura, no en el texto.
