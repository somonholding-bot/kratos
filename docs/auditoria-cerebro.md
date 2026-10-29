# Auditoría del cerebro de KRATOS (29-oct-2026)

Fase 1 de la reingeniería. Lo que sigue está comprobado en el código (`src/core/brain.ts`, `src/core/chat.ts`).

| # | Pregunta | Respuesta comprobada |
|---|---|---|
| 1 | Proveedor de IA | Anthropic, con el SDK oficial `@anthropic-ai/sdk` 1.3.0 |
| 2 | Modelo | Voz: Haiku 5.5 (ajustable). Texto y especialistas: Opus 5.5 |
| 3 | Claude API, Claude Code u otro | Claude API. Claude Code solo para encargos aprobados, no para conversar |
| 4 | Conversaciones | Se guardan en la tabla `messages` |
| 5 | Historial enviado | Últimos 16 mensajes, sin resumen ni memoria de preferencias |
| 6 | Streaming real | **No.** Ninguna llamada usa streaming: la respuesta llega completa al final |
| 7 | Conexión nueva por mensaje | **Sí.** Se crea un cliente nuevo en cada turno (`new Anthropic` en cada petición) |
| 8 | Herramientas | 23 herramientas (19 estrictas), más las funciones aprobadas (fn_*) |
| 9 | Errores y límites | Un reintento; si falla, se responde en «modo demostración» con texto fijo |
| 10 | Respuestas robóticas | Ver abajo |

## Causas de las respuestas robóticas
1. **Capa de reglas antes que la IA.** `chat.ts` intercepta frases con expresiones regulares (reporte, agenda, llamadas, correo, hora). Lo que no encaja cae en un texto fijo. Por eso «señor Idalmi», «¿qué puedes hacer?» y respuestas idénticas.
2. **El clima y el tiempo de viaje pasan por aprobación.** La instrucción del sistema obliga a proponer una función nueva. Es exactamente el comportamiento que la Fase 4 prohíbe: una consulta pública debería resolverse con una herramienta directa.
3. **Sin preferencias persistentes.** «No me llames por mi nombre» solo vive en el historial de 16 mensajes; se pierde al reiniciar.
4. **Sin streaming.** Aunque el modelo responda rápido, la voz espera la respuesta completa.
5. **Cliente nuevo por turno.** Añade latencia de conexión en cada mensaje.

## Qué se puede corregir sin pagar nada
- Activar streaming y empezar a hablar con el primer fragmento.
- Mantener un cliente de conexión reutilizable.
- Quitar la capa de reglas para consultas normales; dejarla solo para acciones con permiso (aprobar, detener).
- Herramienta directa de clima con Open-Meteo (gratis, sin clave) y de hora y fecha, sin aprobación.
- Tabla de preferencias permanentes (SQLite o PostgreSQL existente, sin instalar nada nuevo).

## Lo que requiere tu autorización
- Comparar OpenAI Realtime y GPT-Live: exige claves de pago. Antes de activarlas hay que medir coste por hora con sus páginas oficiales.
- Búsqueda web con Tavily o Brave: también tiene coste; hoy la búsqueda ya funciona con la herramienta web de Claude.

## Orden propuesto
1. Copia de seguridad con etiqueta en git (`pre-reingenieria`) y cambios por pasos reversibles.
2. Streaming y cliente reutilizable; medir primer audio antes y después.
3. Quitar reglas para consultas normales y herramienta directa de clima y hora.
4. Preferencias permanentes.
5. Solo después: comparación de motores de voz, con costes verificados y tu aprobación.
