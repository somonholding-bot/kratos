# Registro de implementación

## TAREA 00 (5-nov-2026)
- Auditoría: 00-baseline.md. Cambios: `.gitignore` (informes generados del rastreador SOL), worktree `Jarvis-acd` ya fusionado eliminado. Pruebas: npm test 192/192.

## TAREA 01
- Investigación de 26 referencias y 19 repositorios (docs/kratos-cognitive-expansion/referencias.json, repositorios.json, references.md). Registro buscable: migración 047 (cog_referencias, cog_repositorios) y scripts/cognicion/cargar-referencias.ts. Resultado: 26 referencias, 20 verificadas; repositorios: 4 EXISTING_INTEGRATION, 6 RESEARCH_ONLY, 6 REJECT_UNNECESSARY, 3 REJECT_INCOMPATIBLE, 0 INTEGRATE_NOW. Correcciones a la directiva: el DOI de C2 corresponde a «The graphical brain» (Friston, Parr & de Vries 2017). Dependencias instaladas: ninguna.

## TAREA 02: C01 automodelo funcional
- Migración 048 (cog_capacidades, cog_capacidad_pruebas, cog_automodelo). src/core/automodelo.ts: niveles no_existe/instalada/disponible/probada/degradada, confianza de Laplace sobre pruebas reales (audit_log herramienta.*, sol_conectores_pruebas, acd_experimentos), quienHace (agente por función/estatuto/herramientas o «ninguno»), puedo (qué falta), registrarPrueba (un fallo posterior degrada). Herramienta `automodelo` (solo lectura) para CEO y agentes. Pruebas: test/automodelo.test.ts 6/6 (autoevaluación incorrecta corregida tras un fallo, herramienta inexistente, Q-LAB/CUDA ausentes, agente adecuado y ninguno). npm test 198/198. En vivo: Q-LAB no_existe con confianza 0; R01/R03/R05 degradados.

## TAREA 03: C02 monitorización metacognitiva
- Migración 049 (cog_decisiones). src/core/metacognicion.ts: registro por decisión (objetivo, estrategias, elegida, evidencia a favor/en contra, supuestos, incertidumbre, confianza declarada, resultado esperado/real, errores, estrategia revisada). Confianza calibrada con el acierto medido de la categoría (Laplace por tramo; Brier y error de calibración); «sin calibración» si hay menos de 3 casos. Contradicciones: elegida fuera de candidatas, evidencia en contra ≥ a favor, sin evidencia a favor, confianza alta con incertidumbre alta, supuesto que choca con la evidencia, una sola estrategia. Fallos repetidos: misma estrategia fallida en la categoría (con la estrategia revisada previa). Escalado si confianza calibrada < 0,5, incertidumbre > 0,7, contradicciones o fallo repetido. Revisión independiente: el autor no se revisa; una decisión crítica no se da por buena sin revisión aprobada; un fallo exige estrategia revisada. Historial de fiabilidad por agente desde tasks. Pruebas 5/5.
