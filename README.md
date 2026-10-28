# Kratos — manual breve

KRATOS es tu asistente personal y empresarial: una app de Mac con panel, voz, memoria en Obsidian e inteligencia con Claude. La carpeta y los servicios internos conservan el nombre técnico `jarvis`. Identidad: [docs/identidad-kratos.md](docs/identidad-kratos.md) · Agentes: [AGENTS.md](AGENTS.md) · Voz: [docs/voz.md](docs/voz.md).

## Etapas

| # | Etapa | Estado |
|---|---|---|
| 1 | A · Diagnóstico e investigación | ✅ Hecha ([docs/etapa-a-informe.md](docs/etapa-a-informe.md)) |
| 2 | B · Base local: panel, conversación por texto, negocios, tareas, presupuesto, aprobaciones, auditoría, parada de emergencia | ✅ Implementada y probada |
| 3 | C · Voz en español: pulsar para hablar + «Kratos, Kratos» / «Hey Kratos» en la app de Mac | ✅ Implementada y probada con audio sintetizado; falta tu prueba con micrófono real |
| 4 | D · Trabajo 24 h: servicio, cola, horarios, recuperación, copias | 🟡 Parcial: servicio, cola, recuperación y copias listos; faltan cuotas de IA y objetivos proactivos (requieren Claude) |
| 5 | E · Conexiones | 🟡 Obsidian conectado; Claude listo, falta tu clave y aprobar su presupuesto; resto pendiente de autorización |
| 6 | F · Departamento de marketing | Propuesto |
| 7 | G · Simulación financiera y de acciones | Propuesto |
| 8 | H · Piloto real | ⛔ Requiere autorización explícita |
| 9 | I · Autonomía limitada | Propuesto |

## Conectar la inteligencia (Claude)

1. Crea una clave en [console.anthropic.com](https://console.anthropic.com) → *API Keys*. Pon allí también un límite de gasto mensual.
2. Guárdala en el Llavero (te la pedirá sin mostrarla; no la pegues en chats):
   `security add-generic-password -U -s kratos-anthropic -a api -w`
3. En el panel → *Aprobaciones*, aprueba (o rechaza) la asignación de presupuesto para la IA.

Sin clave o sin presupuesto, KRATOS responde en modo demostración y lo indica. Modelo: `claude-opus-5-5` con esfuerzo bajo; cada llamada reserva antes y descuenta el coste real del libro financiero. Si Claude rechaza una petición, la API reintenta con el modelo de respaldo (`fallbacks: "default"`).

## Memoria (Obsidian)

Bóveda en `~/Documents/Kratos` (ábrela en Obsidian: *Abrir carpeta como bóveda*). KRATOS escribe el diario, notas y expedientes, y busca en ella antes de responder.

## Uso diario

- **Abrir el panel:** doble clic en **Kratos** del Escritorio (abre su propia ventana de Chrome; si el servicio está caído, lo arranca). También: `npm run open` en `~/Jarvis`. Para recrear el icono: `bash scripts/install-desktop-app.sh`.
- **Hablarle (texto):** pantalla «Conversación». Órdenes que entiende hoy: «¿cómo van mis negocios?», «¿qué hiciste?», «presupuesto», «tienes 50 dólares para X», «crea una tarea: …», «aprobaciones pendientes», «detén todas las acciones».
- **Dinero:** por defecto todo está en 0 y Jarvis no puede gastar. Si le dices «tienes N dólares para X», crea una **propuesta**; solo vale cuando la apruebas en «Aprobaciones».
- **Parada de emergencia:** botón rojo arriba a la derecha. Detiene trabajo nuevo, cancela lo que esté en curso y bloquea reservas de dinero. Reanudar exige pulsar «Reanudar».

## Voz

- Mantén pulsado **🎙 Mantén para hablar** (o la barra espaciadora) y suelta para enviar. **Esc** cancela.
- Mientras el micrófono está abierto verás una franja roja «MICRÓFONO ACTIVO»; al soltar se cierra del todo.
- **Interrumpir voz** corta la respuesta hablada; **Silenciar micrófono** bloquea la escucha.
- Micrófono y voz de respuesta se eligen en «Configuración y privacidad», donde también ves la latencia medida.
- Todo el audio se procesa en tu Mac (whisper.cpp). No se guardan grabaciones.

## Servicio 24 h

Tres servicios de usuario (launchd), sin permisos de administrador:

| Servicio | Qué hace |
|---|---|
| `com.jarvis.server` | Panel en `127.0.0.1:7420` (solo esta Mac) |
| `com.jarvis.worker` | Trabajador: revisa salud cada 15 min, informe diario, recupera tareas tras caídas |
| `com.jarvis.backup` | Copia de la base cada día a las 03:15 (conserva 14) en `backups/` |

Arrancan solos al iniciar sesión y se reinician si se caen. Comandos:

- Instalar o reinstalar: `bash scripts/install-service.sh`
- Ver estado: `launchctl list | grep com.jarvis`
- Registros: `.jarvis/logs/`
- Quitar el servicio (sin borrar datos): `bash scripts/uninstall-service.sh`

**Con la tapa cerrada:** macOS duerme al cerrar la tapa y un Mac dormido no ejecuta nada. Para evitarlo, ejecuta tú en Terminal (pide tu contraseña):

```
sudo pmset -a disablesleep 1
```

Para volver a lo normal: `sudo pmset -a disablesleep 0`. Mantén el Mac enchufado y fuera de fundas o mochilas mientras esté así (no se enfría bien cerrado). Tras un reinicio, Jarvis vuelve cuando inicias sesión.

## Recuperación

- **Copia manual:** `npm run backup`
- **Restaurar** (en una base nueva, nunca encima de la activa): `bash scripts/restore.sh backups/ARCHIVO.dump jarvis_restaurada`
- Tras una caída, las tareas interrumpidas se reanudan; las que tienen efectos externos pasan a «requiere revisión» en vez de repetirse.

## Pruebas

`npm test` ejecuta 37 pruebas (base, voz, activación e IA sin llamar a la API) sobre la base `jarvis_test` (nunca toca `jarvis`).

## Desinstalación completa

1. `bash scripts/uninstall-service.sh`
2. `dropdb -h 127.0.0.1 jarvis && dropdb -h 127.0.0.1 jarvis_test`
3. `psql -h 127.0.0.1 -d postgres -c "DROP ROLE jarvis_agent; DROP ROLE jarvis_app;"`
4. Borrar `~/Desktop/Kratos.app` y la carpeta `~/Jarvis` (incluye el modelo de voz de 547 MB en `.jarvis/models`)
5. Si cambiaste el reposo: `sudo pmset -a disablesleep 0`
