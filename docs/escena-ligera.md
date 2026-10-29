# Escena ligera de KRATOS (plan)

**Objetivo:** que el universo se vea 3D y vivo, pero consuma casi nada de CPU y GPU.
**Estado:** planeado, no implementado. Requiere aprobación antes de codificar.

## Idea
- **Fondo fijo:** una imagen renderizada una sola vez (cielo, nebulosa, galaxias, planetas con sombreado 3D). No se recalcula en cada fotograma.
- **Movimiento ligero:** una bola de energía en el centro con unas 300–600 partículas que orbitan y laten. Se dibuja con canvas 2D, sin bloom ni sombreadores pesados.
- **Planetas:** imágenes pre-renderizadas con leve oscilación y un halo que se enciende cuando el agente trabaja.
- **Voz:** la energía del núcleo crece con el nivel de voz (el mismo dato que hoy usa `kratosMicLevel`).

## Qué se elimina en modo ligero
- Bloom (UnrealBloomPass) y renderizado a 1,25× de resolución.
- Miles de estrellas animadas por fotograma (se hornean en la imagen).
- Red neuronal de 7.000 puntos y sinapsis animadas.

## Integración
1. Nuevo nivel de calidad `ligera` en `ajustes` (`ui_quality`), con validación en `src/core/bitacora.ts`.
2. Escena alternativa `public/prototipo/ligera.js` que comparte la lista de agentes y los estados del universo.
3. Por defecto, `ligera` cuando el Mac tenga menos de 2 GB libres o haya navegadores abiertos.
4. La escena 3D completa se conserva para cuando el Mac esté libre.

## Criterios de aceptación
- CPU del proceso de la ventana por debajo del 10 % en reposo y del 25 % al hablar.
- Sin avisos de error en consola durante 10 minutos.
- La bola de energía reacciona a la voz en menos de 100 ms.
- Las pruebas automáticas siguen en verde.

## Pendiente de decisión
- ¿Quieres la escena ligera como predeterminada, o solo cuando el Mac esté ocupado?
