# KSIE — Registro de capacidades de herramientas (TAREAS 01–02)

Código: `src/core/ksie-herramientas.ts` · tablas `ksie_herramientas`, `ksie_selecciones` (migración 055) · pruebas `test/ksie-herramientas.test.ts` (7/7).

## De dónde sale cada dato (nada inventado)
| Campo | Fuente |
|---|---|
| id, nombre, descripción, permisos (aprobación) | `tool_registry` (sincronizado con el array TOOLS de KRATOS) |
| último éxito, último fallo, fiabilidad, evidencia | automodelo C01 (`cog_capacidades`): uso real en audit_log, sondeos de conectores, experimentos, resultados de KSIE |
| operaciones, entradas, salidas, coste, latencia, privacidad, recursos, limitaciones | tabla `META` del código (revisable); lo que no tiene operaciones no se enruta |
| autenticación | existencia de la credencial en el llavero de macOS **sin leer su valor** (`security find-generic-password` sin `-w`) |
| compatibilidad | macOS Apple Silicon (todo lo registrado corre en este equipo) |

## Estados
- **DISCOVERED**: encontrada en el equipo (p. ej. `ollama`, `yt-dlp`) pero ninguna herramienta de KRATOS la integra; no se elige nunca.
- **INSTALLED**: código presente sin dependencias o sin registrar.
- **CONFIGURED**: necesita credencial, la credencial existe, sin prueba reciente.
- **AVAILABLE**: registrada y activa, sin prueba reciente.
- **VERIFIED**: éxito reciente sin fallos posteriores.
- **DEGRADED**: falló después de su último éxito (penaliza 0,25 en el enrutado).
- **UNAVAILABLE**: desactivada, sin credencial o desaparecida (no se borra: queda con su motivo).

Estado en vivo (5-nov-2026): 80 entradas — 53 VERIFIED, 25 AVAILABLE, 2 DISCOVERED.

## Enrutado (3.2)
1. Operaciones de la necesidad; las internas (razonar, resumir, comparar, redactar, criticar, aritmética simple, clasificar) **no llaman a ninguna herramienta**.
2. Candidatas del registro que cubren alguna operación; descarte explícito por estado, privacidad pedida, presupuesto (gratis / suscripción / pago autorizado), API de pago sin autorización, uso solo con orden del propietario o fiabilidad bajo la calidad mínima.
3. Puntuación = 0,40·fiabilidad (0,6 C01 + 0,4 historial de selecciones; −0,25 si DEGRADED) + 0,25·cobertura + 0,15·coste + 0,10·velocidad + 0,10·privacidad.
4. Conjunto mínimo por cobertura voraz; plan con pasos, operaciones y si requiere autorización. Nada se ejecuta desde el enrutado.
5. Resultado (`exito` / `insuficiente` / `fallo`) → prueba en C01 (un fallo degrada) → replanificación excluyendo la herramienta (si fue insuficiente, exige más calidad), enlazada con `replanificada_de`.

## Huecos (3.3)
Si nada cubre una operación: lista las existentes no usables y por qué, recomienda reparar o autorizar antes de buscar otra; si no hay ninguna, investigar alternativas gratuitas y estimar instalación y mantenimiento. **Nunca instala, crea cuentas ni compra.**

## Aprendizaje (3.4)
`aprendizaje()`: éxito/fallo por operación, mejor herramienta por operación, éxito de la primera frente a la segunda mitad de las selecciones, número de tareas resueltas sin herramientas. Persiste en PostgreSQL.
