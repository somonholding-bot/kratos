# Voz de KRATOS

## Frases de activación

- «**Kratos, Kratos**»: dos menciones seguidas. Si llegan en fragmentos separados, cuentan dentro de una ventana configurable (por defecto 3 s).
- «**Hey Kratos**»: también vale «Ey» u «Oye». Se normalizan mayúsculas y puntuación.
- Una sola mención («Kratos, ¿cómo van?») **no** despierta. Repetir el nombre reduce las activaciones accidentales, pero no las elimina.

## Arquitectura actual

1. **App de macOS** (`native/main.swift`): micrófono abierto de forma continua con detector de voz por energía y umbral adaptativo al ruido.
2. Cada frase se envía **solo a 127.0.0.1**. whisper.cpp (modelo large-v3-turbo q5_0) analiza los primeros 2,5 s y, si aparece el nombre, la frase completa. Lo demás se descarta sin guardarse.
3. Al despertar: sonido breve («Tink»), aviso en el panel y cambio del icono de la barra de menú.
4. La orden va al cerebro (Claude) o al modo demostración, y la respuesta se dice con una voz local de macOS.
5. Tras la respuesta vuelve a escuchar. Tras «¿Sí?» espera la orden durante un tiempo configurable (8 s por defecto).

Se elige whisper.cpp porque ya estaba instalado, es MIT, funciona en local con Metal, entiende español y acepta un nombre nuevo sin entrenamiento. Alternativas evaluadas: openWakeWord (necesita entrenar un modelo para «Kratos») y Porcupine (requiere cuenta y clave de Picovoice).

## Controles

- **Pulsar para hablar** (botón o barra espaciadora). Mientras se usa, la escucha continua se pausa.
- **Silenciar micrófono**: apaga también el detector. El micrófono queda cerrado y el punto naranja de macOS desaparece.
- Activación por voz opcional, sensibilidad, ventana entre menciones y tiempo de espera: en *Configuración y privacidad* (app de Mac).
- Protección contra su propia voz: no se procesa audio mientras KRATOS habla ni durante 0,4 s después.

## Privacidad

El audio nunca sale de la Mac y no se guarda. El archivo temporal se borra tras transcribir. Solo se registran tiempos y resultados (sin audio ni texto) en `voice_metrics`.

## Límites

- Con la Mac **dormida, bloqueada en la pantalla de inicio o apagada** no hay detección. En un MacBook con la **tapa cerrada**, macOS desconecta el micrófono interno aunque el reposo esté desactivado; hace falta un micrófono externo.
- La app debe estar abierta (arranca sola al iniciar sesión, oculta en la barra de menú).
- Cada frase con el nombre cuesta cerca de 1 s de GPU. En una sala con mucha conversación o televisión, el consumo sube.

## Pendiente

- Pruebas con micrófono real: ruido, distancias y audio reproducido por altavoces.
- Conversación en tiempo real (p. ej. OpenAI Realtime) tras el despertar: requiere decisión del propietario sobre proveedor, coste y privacidad.
