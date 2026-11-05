# KSIE — Marco de decisión (TAREAS 03–08)

Código: `src/core/ksie.ts` · migración 056 · herramienta `estrategia_ksie` · pruebas `test/ksie.test.ts` (9/9).

## Preguntas (03) y profundidad (04)
- `questions.json` contiene 100 preguntas (A–J × 10). Cada una tiene: id, categoría, texto, relevancia, evidencia necesaria, operaciones de investigación, capacidades de herramienta, respuesta, procedencia, confianza, supuestos y seguimiento.
- Las respuestas se guardan en `ksie_respuestas` por oportunidad y con la etiqueta **HYPOTHESIS / ESTIMATE / OBSERVED / INDEPENDENTLY_VERIFIED**.
  - Sin evidencia ni fuente, la respuesta se rechaza y la pregunta queda sin resolver.
  - OBSERVED exige una fuente comprobable.
  - INDEPENDENTLY_VERIFIED exige otro verificador (lo obliga un CHECK en la base).
- Afirmaciones sin respaldo (absolutos, cifras sin fuente comprobable, «según estudios» sin cita, deseo de compra sin compra): se señalan, la respuesta baja a HYPOTHESIS y su confianza a 0,3 como máximo.
- Niveles de profundidad:
  - **Nivel 1** (10 críticas: Q001, Q002, Q010, Q011, Q020, Q030, Q061, Q064, Q083, Q093): barato, reversible y de bajo riesgo.
  - **Nivel 2** (+40, priorizadas según el tipo: física, digital o servicio): inversión > 200 $, riesgo o irreversibilidad ≥ 0,4, o incertidumbre ≥ 0,6.
  - **Nivel 3** (las 100 + crítica independiente): inversión > 2.000 $, riesgo o irreversibilidad ≥ 0,7, o paso a ejecución.

## Oportunidades (05)
- Sirven todos los sectores (13 tipos: software, producto físico, fabricación, agricultura, automoción, servicios locales e industriales, mejora de procesos, comercialización científica, digital, suscripción, contenido, híbrido).
- La evaluación usa rangos {min, base, max}: beneficio neto mensual, capital y meses al primer ingreso, más 7 factores de 0 a 1.
- Valor esperado = media PERT del beneficio neto × probabilidad de éxito. Esa probabilidad se calcula con la evidencia de demanda, el encaje, la dificultad, la distribución, la competencia y la defensibilidad, y se limita a 0,02–0,9.
- Se informa con 2 cifras significativas y con la contribución al hito de 10.000 $/mes de beneficio neto.
- La cartera puede tener varias candidatas, pero solo **una en ejecución**: lo impone el índice único `ksie_una_ejecucion` y el objetivo activo de C04.

## Anti-fijación y crítica (06)
- `detectarFijacion` recorre la cartera, las recomendaciones, los productos (incluidas sus plataformas) y el plan vigente. Alerta cuando un modelo (app, SaaS, web, YouTube o NFC) supera la mitad, cuando ≥ 75 % es digital o cuando todos los productos son apps sin ninguna alternativa física, local o de servicios.
  - Producción a 5-nov: **fijación detectada**. Los 6 productos registrados son apps iOS y el plan menciona app y YouTube.
- `revisionPrevia`, antes de asignar recursos, exige: ≥ 2 alternativas creíbles evaluadas, el mejor argumento en contra, el coste de oportunidad, los experimentos fallidos previos (incluida la memoria C03) y la evidencia que invalidaría la propuesta (Q093).
- `criticar` emite un veredicto («esta idea es DÉBIL…») con su evidencia, las alternativas y el experimento más barato que cambiaría la conclusión.
  - Una **sugerencia** del propietario es una hipótesis.
  - Una **orden** se ejecuta, dejando constancia del desacuerdo si la evidencia es débil.

## Decisión (11) y memoria (08)
- `recomendar` aplica estas reglas, en orden:
  1. **DISCARD** si un experimento cruzó su corte o si el valor esperado es ínfimo.
  2. **INVESTIGATE** si quedan más de 3 críticas sin resolver o no hay evaluación.
  3. **EXPERIMENT** si las críticas están respondidas pero no hay evidencia de pago.
  4. **EXECUTE** solo con un experimento de pago exitoso y una revisión previa completa; si la revisión está incompleta, vuelve a INVESTIGATE.
- Cada recomendación queda también como decisión C02, con confianza calibrada y escalado.
- Si cambia respecto a la anterior, `explicacion_cambio` detalla la evidencia nueva: respuestas y experimentos.
- **Descartar** guarda el motivo y una lección C03 («No reabrir… sin evidencia nueva»).
- **Reabrir** solo es posible con evidencia OBSERVED o verificada posterior al abandono.

## Permisos (10)
- Permitido sin pedir nada: investigar información pública, analizar datos autorizados, hipótesis, comparar, modelos financieros, diseñar experimentos, criticar, registrar y recomendar.
- Necesita autorización: gastar, anunciar, publicar, contactar clientes, comprar inventario, contratos, modificar producción, cuentas privadas y experimentos regulados.
- Los experimentos con gasto o acción externa piden aprobación (`approvals`). **El dinero lo decide siempre el propietario en el panel**; no hay resultados de un experimento no autorizado.

## Conducta final (14)
`encontrar_forma` hace, en este orden:
- examina la situación real (beneficio neto observado, presupuesto, limitaciones y preferencias);
- declara lo que no hará (crear app, lanzar canal, suscripciones por defecto, ideas genéricas, programar, comprar);
- planifica las herramientas de investigación;
- compara las alternativas evaluadas y los sectores sin explorar;
- cuestiona sus supuestos (fijación);
- prioriza por evidencia y propone el experimento útil más barato;
- lista lo que necesita autorización.
