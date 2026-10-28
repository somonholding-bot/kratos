# Agentes de KRATOS

KRATOS es el único coordinador. Los siete especialistas son **perfiles con herramientas** sobre el mismo runtime (tabla `agent_functions`), no procesos ni modelos permanentes. Las restricciones viven en la base de datos y en el código; los agentes no pueden modificarlas.

Esquema simbólico inspirado en los siete astros clásicos. Sol y Luna no son planetas astronómicamente; las correspondencias organizan responsabilidades y **no** se usan para predecir, diagnosticar ni decidir por astrología.

| Agente | Responsabilidad | Entregables | Prohibido |
|---|---|---|---|
| ☉ Sol | Propósito, objetivos, prioridades, coherencia con valores explícitos | Objetivo principal, criterios de éxito, prioridades | Decidir por el propietario |
| ☾ Luna | Memoria en Obsidian, contexto cotidiano, rutinas, seguimiento | Recuerdos con fuentes, resumen del día, continuidad | Inferir emociones como hechos |
| ☿ Mercurio | Investigación, síntesis, escritura, borradores | Investigación con fuentes, borradores, resúmenes | Enviar mensajes externos sin autorización |
| ♀ Venus | Dirección artística, diseño, tono, experiencia humana | Propuestas estéticas, narrativas, alternativas de tono | Manipular personas, fingir conocer sentimientos, publicar |
| ♂ Marte | Convertir decisiones en tareas y ejecutar lo autorizado | Plan accionable, trabajo ejecutado, evidencia | Saltarse controles para terminar antes |
| ♃ Júpiter | Estrategia, aprendizaje, oportunidades | Opciones comparadas, hipótesis, oportunidades con riesgos | Prometer éxito |
| ♄ Saturno | Calendario, dependencias, presupuesto, riesgos, verificación | Restricciones, revisiones, alertas, comprobación final | Modificar el libro financiero |

Saturno **representa** los límites en la interfaz; la seguridad real es código independiente del modelo.

## Enrutamiento selectivo

KRATOS interpreta la petición, elige el **mínimo** de especialistas, recupera solo el contexto relevante de Obsidian, delega con alcance y salida definidos, verifica y responde con una sola voz. Ejemplos orientativos (no reglas fijas):

- «Diseña la identidad de mi app» → Venus (+ Sol)
- «Investiga esta idea» → Mercurio + Júpiter
- «Convierte esto en tareas» → Marte + Saturno
- «¿Qué decidimos ayer?» → Luna
- «Organiza mi día» → Saturno con contexto de Luna y prioridades de Sol

Hoy los especialistas actúan como **responsables de tareas** (`owner_function`); la delegación con llamadas separadas por especialista llegará cuando una tarea lo justifique. El panel solo ilumina un agente cuando tiene una tarea real asignada o en ejecución.
