# Motor de episodios de Aion (animación 2D de Orin, gratis y local)

Cadena aprobada por el propietario (2-nov-2026). Todo con Python en entornos propios de `~/.local/share/kratos-media` (ver `../instalar.sh`).

1. **Guion y storyboard**: `ep1.py` (lista `BEATS`; cada beat = frase narrada + fondo, personaje, objetos y rótulo). Episodios nuevos: copiar `ep1.py` a `epN.py`.
2. **Voz**: `voz_episodio.py <velocidad> voz.wav timeline.json` (Kokoro am_michael, entorno `.jarvis/tts/venv`). Velocidad 1.03 ≈ 162 ppm con pausas.
3. **Música**: ACE-Step (`../musica.py "descripción" segundos salida.wav`); se alarga con `acrossfade`.
4. **Imagen y montaje**: `anim2.py timeline.json voz.wav musica.wav salida.mp4` (Pillow + ffmpeg; `--preview t1,t2` para ver fotogramas). Usa `animar.py` (primitivas y personaje Orin).
5. **Arte del canal**: `arte.py` (banner, foto de perfil y miniatura).
6. **Subida**: `../subir-episodio.ts` (vídeo privado + miniatura + subtítulos + banner).
7. **Medir una voz**: `medir_voz.py` (error de lectura, tono, expresividad y pausas).
8. **Desde KRATOS**: herramienta `fabrica_aion` (producir_episodio → qa → miniatura → subir_privado) sobre `content_queue`; la producción es `node ../fabrica.ts producir <id>` (voz Liam con tope de créditos, salida en `~/Movies/Kratos/cola-<id>`, registro en `.jarvis/logs/fabrica-<id>.log`). Publicar sigue siendo `publicar_video_youtube`.
