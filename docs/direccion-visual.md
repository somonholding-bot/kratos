# Dirección visual de KRATOS (corrección del 28-oct-2026)

Estado anterior guardado: commit `8e57164`, etiqueta `estado-antes-direccion-visual`.

## Dónde me aparté de tus instrucciones

1. Construí un **panel administrativo** (menú lateral, tablas, barra superior llena de botones) y metí la escena en un **rectángulo** dentro de él.
2. Los astros **orbitaban y aparecían o desaparecían** según el estado; podían solaparse o salir del encuadre.
3. Animé un fondo de estrellas plano, sin sensación de **mente neuronal** ni profundidad.
4. Avancé funciones (zorro articulado, conexión al panel) **antes de validar la apariencia** contigo.

## Experiencia acordada

- Pantalla completa sin marco: la mente de KRATOS en el centro y los siete astros **siempre visibles** en una composición fija (nunca orbitan fuera de cuadro).
- KRATOS ≠ Sol. Los siete: Sol, Luna, Mercurio, Venus, Marte, Júpiter y Saturno (correspondencias simbólicas).
- Ramificaciones neuronales entre la mente y cada astro. El brillo **ambiental** es lento y no viaja; los **impulsos** que viajan solo existen ligados a eventos reales.
- Controles ocultos que aparecen al mover el ratón o pulsar una tecla. Salida con Esc.

## Investigación (28-oct-2026)

| Referencia | Licencia | Qué comprobé | Uso |
|---|---|---|---|
| [3d-force-graph](https://github.com/vasturiano/3d-force-graph) | MIT | **Vi** las demos *bloom-effect* y *directional-links-particles* | Referencia de resplandor y partículas en enlaces; no hace falta su física de grafos (composición fija) |
| [react-force-graph](https://github.com/vasturiano/react-force-graph) | MIT | Solo metadatos y README | Misma librería en React: descartada (sin React) |
| [solar-system-threejs](https://github.com/themrboyd/solar-system-threejs) | MIT | La demo **no se dibujó** en el navegador de pruebas; las texturas no indican su origen | Ninguno; no se copian sus texturas |
| [react-three-fiber](https://github.com/pmndrs/react-three-fiber) / [drei](https://github.com/pmndrs/drei) | MIT | Metadatos | Buenos, pero exigen React + compilación; Three.js directo basta |
| [three.js](https://github.com/mrdoob/three.js) 0.186.1 | MIT | Instalado y usado | **Elegido** para la escena |
| Webb: [Acantilados Cósmicos](https://esawebb.org/images/weic2205a/), [Pilares de la Creación](https://esawebb.org/images/weic2216a/) | CC BY 4.0 (ESA/Webb, con crédito visible) | **Vistas** | Inspiración de paleta, polvo y difracción; no se usan sus píxeles |

### Escritorio: Electron, Tauri o la app nativa actual

- **Electron**: sus ventanas transparentes no dejan pasar el clic por las zonas vacías; hay que usar `setIgnoreMouseEvents` (con `forward` en macOS/Windows), no son redimensionables y pierden la sombra ([documentación](https://www.electronjs.org/docs/latest/tutorial/custom-window-styles)). Añadiría otro runtime completo.
- **Tauri 2**: transparencia disponible (desde 2.12.1 sin bandera privada, según su referencia de configuración); no verifiqué aún su clic a través.
- **Recomendación**: seguir con la **app nativa en Swift** que ya tiene micrófono, «Kratos, Kratos», Llavero y panel. Desde ella se ofrecen dos ventanas:
  - **Modo inmersivo**: ventana sin bordes a pantalla completa en su propio Espacio; se minimiza con Esc o el control de salida.
  - **Modo compañero**: panel transparente que no se activa (no roba foco), con clic a través salvo en las zonas del zorro y los controles. *Pendiente de prototipo nativo; las limitaciones de macOS se verificarán en la práctica.*

## Prototipo (fase de validación)

`public/prototipo/` (abre `http://127.0.0.1:7420/prototipo/`): Three.js + resplandor, cielo profundo procedural (≈14 000 estrellas en calidad media, franja galáctica, difracción tipo Webb, galaxias), astros con superficie por shader, ramificaciones neuronales, acantilados de polvo y zorro de partículas **provisional**. Eventos y estados se **simulan** con teclas y se marcan como SIMULADOS.

- Medido en el navegador integrado (1512×945, calidad media): **60–61 fps, ≈1 ms de CPU por fotograma, 82 llamadas de dibujo, ≈23 000 puntos**. El coste de la GPU y del proceso completo se medirá en la app nativa.
- Teclado: Esc salir · Espacio pausar · M silenciar · R movimiento reducido · Q calidad · L lista · I consumo · F pantalla completa · 1–7 delegación simulada · S estado simulado.

## Pendiente tras tu aprobación

1. Arte del zorro (hoy partículas provisionales).
2. Ventanas inmersiva y compañero en la app nativa, con mediciones de CPU, GPU y memoria.
3. Conectar estados y eventos reales (voz, Claude, tareas), sustituyendo las simulaciones.
4. Retirar el panel administrativo como pantalla principal (quedará accesible como «detalles»).
