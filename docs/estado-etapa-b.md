# Estado tras las Etapas B y D (parcial) — 28-oct-2026

## Implementado y probado

| Pieza | Cómo se verificó |
|---|---|
| Base `jarvis` + roles `jarvis_app` / `jarvis_agent` en el PostgreSQL 16 existente | Migraciones aplicadas; pruebas de permisos |
| Persistencia tras reinicio | Prueba automática |
| Cola sin duplicados (`FOR UPDATE SKIP LOCKED`, claves de idempotencia) | 8 trabajadores concurrentes, 5 tareas → 5 reclamos únicos |
| Libro financiero determinista (reservas con bloqueo de fila, idempotencia, cierres) | Dos agentes reservando el mismo saldo → solo uno lo consigue; repetición no cobra dos veces |
| Saldo 0 por defecto: nada se puede reservar | Prueba automática |
| Parada de emergencia (cancela, bloquea trabajo y gasto, reanudación explícita) | Prueba automática + botón en el panel |
| Recuperación tras caída (acciones con efectos externos → revisión humana) | Prueba automática |
| Reintentos limitados con espera creciente | Prueba automática |
| Tareas recurrentes sin duplicados | Prueba automática y en ejecución real |
| Aislamiento por negocio con RLS; agentes sin permiso sobre presupuesto, aprobaciones y estado | Prueba automática con el rol `jarvis_agent` |
| Auditoría de solo inserción | Prueba automática (UPDATE/DELETE rechazados) |
| Aprobaciones solo desde el panel; caducan | Pruebas automáticas |
| Instrucciones maliciosas en la conversación no aprueban ni gastan | Prueba automática |
| Panel: solo 127.0.0.1, sesión con código de un solo uso, protección de host y origen | Prueba automática + curl (host ajeno → 421) |
| Servicio launchd con reinicio automático | Proceso matado con `kill -9` → relanzado en ~10 s |
| Copia y restauración | Restaurada en base aparte con mismos recuentos |
| Panel de 12 pantallas con estados reales y datos DEMO marcados | Revisado en navegador; sin errores de consola |

## Implementado, pendiente de prueba

- Vista en móvil/pantallas estrechas del panel (diseñada, no revisada).
- Comportamiento con la tapa cerrada: depende del ajuste de reposo que debes aplicar tú.

## Decisiones tomadas por mí (reversibles)

- Panel sin framework (HTML/CSS/JS) y servidor con `node:http`: única dependencia externa `pg@8.23.1`. Menos superficie de ataque y nada que compilar.
- Cola propia sobre Postgres en lugar de pg-boss: el caso es simple y queda probado.
- Ubicación `~/Jarvis`, puerto 7420.

## Riesgos y limitaciones abiertos

- Tu PostgreSQL acepta conexiones locales sin contraseña (`trust`, configuración previa de Homebrew). Cualquier programa de tu Mac puede entrar como cualquier rol, así que el aislamiento por roles protege frente a errores de Jarvis, no frente a software malicioso local. Recomendación: pasar a `scram-sha-256` (cambio de seguridad: lo haré solo si lo apruebas).
- Los registros de `.jarvis/logs/` no rotan todavía.
- Sin IA: las 8 funciones están configuradas pero inactivas; la tarea DEMO de competidores queda «esperando IA».
- Tras reiniciar el Mac, Jarvis vuelve al iniciar sesión (FileVault exige iniciar sesión).

## Costes observados

0 USD.
