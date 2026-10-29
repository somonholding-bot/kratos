# Voz de KRATOS

## Frases de activación

- «**Kratos, Kratos**»: dos menciones seguidas. Si llegan en fragmentos separados, cuentan dentro de una ventana configurable (por defecto 3 s).
- «**Hey Kratos**»: también vale «Ey» u «Oye». Se normalizan mayúsculas y puntuación.
- Una sola mención («Kratos, ¿cómo van?») **no** despierta. Repetir el nombre reduce las activaciones accidentales, pero no las elimina.

## Arquitectura actual

1. **App de macOS** (`native/main.swift`): micrófono abierto de forma continua con detector de voz por energía y umbral adaptativo al ruido.
2. Cada frase se envía **solo a 127.0.0.1**. whisper.cpp (modelo large-v3-turbo q5_0) analiza los primeros 2,5 s y, si aparece el nombre, la frase completa. Lo demás se descarta sin guardarse.
3. Al despertar: sonido breve («Tink»), aviso en el panel y cambio del icono de la barra de menú.
4. La orden va al cerebro (Claude) o al modo demostración por `/api/chat/stream`: la respuesta llega **en tiempo real**, frase a frase, y cada frase se dice en cuanto está escrita (no se espera a la respuesta completa). Con la Voz Personal suena al instante; con Piper/Kokoro cada frase se sintetiza en paralelo y se reproduce en orden.
   - Modo voz ligero: por voz Claude recibe solo las herramientas del día a día; las de código, plan y base de datos entran si la orden las menciona, y la búsqueda web solo si pides buscar algo.
5. Tras la respuesta vuelve a escuchar. Tras «¿Sí?» espera la orden durante un tiempo configurable (8 s por defecto).

Se elige whisper.cpp porque ya estaba instalado, es MIT, funciona en local con Metal, entiende español y acepta un nombre nuevo sin entrenamiento. Alternativas evaluadas: openWakeWord (necesita entrenar un modelo para «Kratos») y Porcupine (requiere cuenta y clave de Picovoice).

## Controles

- **Pulsar para hablar** (botón o barra espaciadora). Mientras se usa, la escucha continua se pausa.
- **Silenciar micrófono**: apaga también el detector. El micrófono queda cerrado y el punto naranja de macOS desaparece.
- Activación por voz opcional, sensibilidad, ventana entre menciones y tiempo de espera: en *Configuración y privacidad* (app de Mac).
- Protección contra su propia voz: no se procesa audio mientras KRATOS habla (también entre frases de una misma respuesta) ni durante 0,4 s después.
- Fin de frase: 0,5 s de silencio cierran lo que dijiste y se envía.

## Voz Personal de Apple

La voz de respuesta por defecto es la **Voz Personal** del propietario (`tts_voice = personal`). Para que macOS la ofrezca:
1. Ajustes del Sistema › Accesibilidad › Voz Personal: la voz debe figurar como lista y estar activado «Permitir que las apps soliciten usar la Voz Personal».
2. Al abrir KRATOS, aceptar el aviso de macOS. Si no se autoriza, KRATOS habla con Piper.
3. Para cambiar de voz: «Kratos, pon la voz Piper» / «pon mi voz personal».

## Mensajes de texto que llegan

El servidor mira cada 2 s la base de la app Mensajes (`~/Library/Messages/chat.db`, solo lectura) y la app de Mac dice en voz alta «Mensaje de texto de Fulano: …» sin abrir la ventana (espera si KRATOS está hablando). Después queda la conversación abierta para decir «respóndele que…» sin repetir «Kratos». Los nombres salen de Contactos de macOS o de la libreta de KRATOS.
- Requiere **Acceso total al disco** para `node` (Ajustes del Sistema › Privacidad y seguridad › Acceso total al disco › «+» › la ruta que da `which node`). Sin él, `/api/mensajes/estado` dice `sin_permiso`.
- Solo los mensajes nuevos: la primera vez no lee el historial. El texto de terceros es dato, nunca una orden.
- El correo se lee solo cuando lo pides.

## Música

«Kratos, pon música lounge / techno / ópera», «ponme una canción de …», «pausa la música», «siguiente», «sube / baja el volumen», «quita la música». La app busca en YouTube con `yt-dlp` y reproduce solo el audio con AVPlayer (no carga la página de YouTube, así que no hay anuncios). Arriba a la izquierda del universo aparece una ventanita con el título, el canal y los botones. Mientras KRATOS te escucha o habla, la música baja; con música sonando, la conversación abierta dura 8 s para que la canción no se tome por órdenes.

## Cerebro rápido y gratis (Groq + IA local)

Lo sencillo (charla, cultura general, explicaciones), por voz o por escrito, lo responde primero **Groq** (modelos abiertos como Llama, casi instantáneos, plan gratis con límites; clave en el Llavero con `bash scripts/conectar-groq.sh`). Si Groq llega a su límite gratis o no hay internet, responde la **IA local** (Ollama). Lo que necesita tus datos o una acción sigue yendo a **Claude**. Groq recibe solo la pregunta y las últimas frases de la conversación, nunca tus mensajes, negocios ni claves.

## IA local (Ollama)

`bash scripts/instalar-ia-local.sh` instala Ollama y descarga el modelo de código abierto más moderno que cabe en la memoria del Mac (familias Qwen y Gemma; prueba primero las versiones más nuevas y, si aún no están publicadas, usa la siguiente). Por voz, lo sencillo (charla, cultura general, explicaciones) lo responde este modelo: gratis, sin internet y sin esperar a la red. Lo que necesita tus datos o una acción (mensajes, agenda, tareas, negocios, internet, agentes) va a Claude; si el modelo local no está seguro, responde «[CLAUDE]» en silencio y pasa a Claude. Si se cae la conexión con Claude, responde el local en vez del modo demostración.
- Se actualiza solo cada domingo a las 04:20 (Ollama, pesos nuevos del modelo o un modelo más moderno). Registro: `.jarvis/logs/ia-local.log`.
- Apagar: «Kratos, apaga el cerebro local» (ajuste `cerebro_local = apagado`). Quitar: `bash scripts/instalar-ia-local.sh --quitar`.
- El modelo no aprende solo: lo que crece es la memoria de KRATOS (lecciones, preferencias y Obsidian), que se le da en cada pregunta.

## Diagnóstico

`bash scripts/diagnostico-voz.sh`: versión instalada, servicios, tiempos de cada respuesta (transcripción, primera frase, voz), voz en uso, Voz Personal, mensajes y música.

## Privacidad

El audio nunca sale de la Mac y no se guarda. El archivo temporal se borra tras transcribir. Solo se registran tiempos y resultados (sin audio ni texto) en `voice_metrics`.

## Límites

- Con la Mac **dormida, bloqueada en la pantalla de inicio o apagada** no hay detección. En un MacBook con la **tapa cerrada**, macOS desconecta el micrófono interno aunque el reposo esté desactivado; hace falta un micrófono externo.
- La app debe estar abierta (arranca sola al iniciar sesión, oculta en la barra de menú).
- Cada frase con el nombre cuesta cerca de 1 s de GPU. En una sala con mucha conversación o televisión, el consumo sube.

## Pendiente

- Pruebas con micrófono real: ruido, distancias y audio reproducido por altavoces.
- Interrumpir a KRATOS hablando por encima (requiere cancelación de eco y pruebas con micrófono real).
