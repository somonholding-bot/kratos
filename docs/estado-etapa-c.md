# Estado de la Etapa C (voz) — 28-oct-2026

## Implementado y probado (automático, con audio sintetizado por voces de macOS)

| Prueba | Resultado |
|---|---|
| «Kratos, ¿cómo van mis negocios?» (voz Paulina, MX) | Exacta · 2,4 s de audio → 1,18 s de transcripción |
| «Muéstrame qué hiciste hoy y cuánto costó.» | Exacta · 0,88 s |
| «Crea una tarea: revisar la ficha…» | Correcta (puntuación distinta) · 1,18 s |
| «Detén todas las acciones.» | Exacta · 0,86 s, y activa la parada de emergencia |
| Acento de España (voz Mónica) | Correcta |
| Silencio | Descartado sin llamar a whisper |
| Pulsación < 0,4 s | Descartada |
| Ruido sin voz | Descartado (antes producía «y»: corregido filtrando transcripciones de menos de 3 letras) |
| Alucinaciones típicas («Subtítulos… Amara.org», «[Música]») | Filtradas |
| Cancelación durante la transcripción | Detiene whisper |
| Sin grabaciones en disco tras transcribir | Verificado |
| La voz no autoriza aprobaciones; voz y texto comparten historial | Verificado |
| Endpoint de voz exige sesión y audio WAV | Verificado |

Motor: whisper.cpp 1.9.2 (ya instalado con Homebrew) + modelo `ggml-large-v3-turbo-q5_0.bin` (547 MB, SHA-256 verificado contra Hugging Face `ggerganov/whisper.cpp`).

## Implementado, pendiente de tu prueba real

- Captura del micrófono en el navegador, medidor de nivel y franja «MICRÓFONO ACTIVO».
- Selección de micrófono y de voz de respuesta; respuesta hablada e «Interrumpir voz».
- Desconexión del micrófono a mitad de frase.
- Latencia extremo a extremo (se mide sola y aparece en Configuración tras tus primeras frases).
- Eco: el micrófono nunca está abierto mientras Kratos habla (pulsar para hablar corta la voz antes de escuchar), y se pide cancelación de eco al navegador.

## Qué audio sale de tu Mac

Ninguno. El navegador envía el audio a `127.0.0.1` y whisper.cpp lo transcribe localmente. Si eliges en Configuración una voz marcada «EN LA NUBE», el texto de la respuesta (no tu audio) lo procesaría el proveedor de esa voz; por defecto se usa una voz local.

## Propuesto para después

- Palabra de activación («Kratos») sin pulsar: requiere escucha continua; se evaluará con un detector local y su riesgo de activaciones falsas.
- Conversación en tiempo real con interrupción por voz (Pipecat), si la de pulsar para hablar se queda corta.
