# Identidad visual de KRATOS

Tres manifestaciones conectadas:

1. **Cuerpo**: zorro blanco de pelaje luminoso con cola de fuego vivo. Inteligente, elegante y cercano; nada infantil y sin imitar personajes existentes.
2. **Mente**: núcleo neuronal luminoso.
3. **Equipo**: constelación de siete especialistas (☉ ☾ ☿ ♀ ♂ ♃ ♄, ver [AGENTS.md](../AGENTS.md)).

Fondo espacial oscuro, sinapsis y filamentos de luz, movimiento orbital elegante, tipografía legible y controles discretos.

## Estados (siempre ligados a datos reales)

| Estado | Zorro | Núcleo / constelación |
|---|---|---|
| Reposo | Camina, descansa o mira alrededor; fuego suave | Oculto o tenue. No indica grabación ni trabajo |
| Despertar | Se detiene y mira al usuario; la cola dibuja un arco | Aparece el núcleo y se despliegan los siete astros |
| Escuchando | Atento | El núcleo responde al **nivel real** del micrófono |
| Pensando | Quieto | Pulso lento del núcleo |
| Hablando | Atento | La animación sigue el **audio real** de salida |
| Ejecutando | Centro de la escena | Se iluminan **solo** los agentes con tarea real; las conexiones muestran delegaciones reales |
| Esperando permiso | Mira hacia el panel | Saturno marca el límite; aviso de aprobación |
| Detenido / error | Sentado, fuego mínimo | Rojo, sin movimiento |
| Fin | Vuelve a reposo | Las conexiones se atenúan |

## Modalidades

- **A. Dentro de la app**: escena propia en la ventana de KRATOS.
- **B. Compañero de escritorio**: ventana nativa transparente que no roba foco ni intercepta clics fuera del zorro. Se evaluará por separado en `native/`; no se simula en la web.

## Propuesta visual (fase 1)

`public/propuesta.html` (enlace en *Inicio*): escena con los ocho estados, simulados con un selector y marcados como PROPUESTA. Motor reutilizable: `public/kratos-scene.js` (`createScene(el).set({ state, level, active })`) y `public/kratos-scene.css`.

- Medido: 0,39 ms de dibujo por fotograma en calidad media **con imagen estática** (presupuesto a 60 fps: 16,7 ms). El modo animado con partículas no se pudo medir aquí porque el navegador de pruebas limita la animación a 2 fps; la página muestra la cifra en vivo («ms de dibujo por fotograma») para comprobarlo en la app.
- Sin dibujo continuo con la ventana oculta ni con movimiento reducido (imagen estática).
- Vista en lista accesible por teclado; cada astro lleva símbolo y nombre, no solo color.

## Escena conectada (fase 2)

La escena es la pantalla de *Inicio* y refleja datos reales:

| Señal real | Efecto |
|---|---|
| «Kratos, Kratos» / «Hey Kratos» (app de Mac) | Despertar durante 1,8 s, luego escuchando |
| Micrófono abierto (pulsar para hablar) | Escuchando; el núcleo sigue el nivel real |
| Transcribiendo o esperando a Claude | Pensando |
| Voz de KRATOS | Hablando; un pulso por cada palabra pronunciada (`willSpeakRange` en la app, `boundary` en el navegador) |
| Tareas `en_ejecucion` | Ejecutando; solo se iluminan sus responsables |
| Aprobación nueva | Esperando permiso durante 2 min; después, el aviso queda en la barra superior y el zorro vuelve a reposo |
| Parada de emergencia, error o servicio caído | Detenido |
| Conversación o ruido sin la palabra de activación | Sigue en reposo (no se finge escucha) |

Junto a la escena: una lista accesible de especialistas (estado, tarea actual y último resultado verificado, desde `/api/agents`). La lista solo se redibuja cuando algo cambia, para no perder el foco del teclado.

Pendiente: arte definitivo del zorro (caminar, sentarse, tumbarse), compañero de escritorio (modalidad B) y un medidor real del audio de salida (hoy se usan los pulsos por palabra).

## Rendimiento

- Escena con Canvas 2D / WebGL ligero; pausa cuando la ventana no es visible.
- Calidad configurable, partículas limitadas y versión estática si falla la aceleración.
- Movimiento reducido, vista de lista accesible, navegación por teclado y etiquetas que no dependen solo del color.

## Activos y licencias

| Activo | Estado | Origen / licencia |
|---|---|---|
| Icono de la app (anillos + K) | Provisional | Propio, generado por `scripts/make-icon.swift` |
| Zorro blanco | **Pendiente**: se usará un marcador identificado | Por producir (propio) o con licencia verificada; no se descarga material de terceros sin derechos |
| Símbolos planetarios | Caracteres Unicode | Dominio público |

Carpeta prevista para activos: `public/assets/kratos/` con un `LICENCIAS.md`.
