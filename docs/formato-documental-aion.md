# Formato del canal Aion — documental animado «What If» (2-nov-2026)

Referencia principal elegida por el propietario: https://youtu.be/KbiT7wwtWGc (canal Iflord, 8:02, animación 2D plana). Se analizó de verdad
(subtítulos, audio, cortes y fotogramas), no por suposición. Lo que se imita es el **oficio** (estructura, ritmo, retención), nunca su guion,
sus dibujos ni su voz. El canal es íntegramente en inglés americano; YouTube dobla y traduce solo.

## Lo medido en la referencia
- **Ritmo visual:** 89 cortes en 482 s → una imagen nueva cada 5,4 s; ~13 palabras por corte.
- **Narración:** 148 palabras/min en el texto (142 medidas en el audio), voz masculina grave (~121 Hz) y muy expresiva (±7,5 semitonos),
  13 pausas largas (media 1,2 s), mezcla a −14 LUFS con música baja.
- **Estética:** personajes de palitos, fondos pastel lisos y escenas de infografía en azul noche, rótulos cortos en mayúsculas que «saltan»,
  planos cerrados con fondo desenfocado.
- **Guion (capítulos con sello de tiempo en la descripción):** gancho en segunda persona («Estás haciendo scroll a las 2 a. m.…») →
  «Congratulations. You can…» (la premisa) → promesa de lo que descubrirás al final → ciencia con estudios reales y nombre propio →
  escalada «Week 1 / Month 1» → los límites de la idea → giro emocional → pregunta final a los comentarios.
- Usa el doblaje automático de YouTube (pistas de audio en DE, ES, FR, JA, PT, RU): confirma la estrategia de canal en inglés.

## Adaptación a Aion (original)
Temas: filosofía hermética, sueño lúcido, Carl Jung, conciencia y espiritualidad práctica. Siempre tono tentativo, sin predicciones ni promesas médicas.
Plantilla de episodio (8–10 min; piloto de 60–70 s):
1. Gancho en segunda persona, en presente, con un detalle concreto y extraño (3 a. m., pasillo, siete dedos).
2. «Congratulations. You can… (premisa What If)» + promesa de lo que se sabrá al final.
3. «First, the science»: un estudio o autor real con nombre y fecha (p. ej. LaBerge, Stanford, años 80; Jung y la sombra).
4. Escalada de la hipótesis y sus límites; giro emocional.
5. Cierre con una pregunta que pide comentarios y deja el siguiente episodio abierto.
Rótulos de 2–4 palabras que refuerzan lo que dice la voz; un cambio de imagen cada ~5 s; sin música que pise la voz.

## Personaje original: ORIN
Soñador de capa índigo con capucha, luna creciente dorada en la frente, ojos grandes y mejillas rosadas; zapatos dorados.
Distinto de la referencia a propósito (nada de cabeza negra y sudadera). Su sombra (silueta negra con ojos blancos) es el antagonista recurrente.
Paleta: azul noche, índigo, dorado, turquesa. Código en `~/Movies/Kratos/piloto/animar.py` (Pillow + ffmpeg, gratis y local).

## Voz: elegida por datos, a validar con el oído del propietario
Mismas frases, mismo instrumento (transcripción local para error de lectura, tono y variación con librosa):
| Voz | ppm | Tono | Variación | Error |
|---|---|---|---|---|
| Referencia | 142 | 121 Hz | 7,5 st | – |
| Chatterbox A (calmada) | 157 | 120 Hz | 4,9 st | 6 % |
| Kokoro am_michael | 138 | 113 Hz | 3,4 st | 4 % |
| Kokoro am_fenrir | 163 | 134 Hz | 4,8 st | 3 % |
| macOS Alex | 204 | 178 Hz | 2,5 st | 6 % |
Ninguna alcanza la expresividad de la referencia; Chatterbox A es la más cercana. Un número no sustituye al oído: la decisión final es del propietario.
Licencias: Chatterbox (MIT), Kokoro (Apache-2.0), ACE-Step (MIT): uso comercial permitido. No se clona la voz de nadie.
