# Registro de implementación

## TAREA 00 (5-nov-2026)
- Auditoría: 00-baseline.md. Cambios: `.gitignore` (informes generados del rastreador SOL), worktree `Jarvis-acd` ya fusionado eliminado. Pruebas: npm test 192/192.

## TAREA 01
- Investigación de 26 referencias y 19 repositorios (docs/kratos-cognitive-expansion/referencias.json, repositorios.json, references.md). Registro buscable: migración 047 (cog_referencias, cog_repositorios) y scripts/cognicion/cargar-referencias.ts. Resultado: 26 referencias, 20 verificadas; repositorios: 4 EXISTING_INTEGRATION, 6 RESEARCH_ONLY, 6 REJECT_UNNECESSARY, 3 REJECT_INCOMPATIBLE, 0 INTEGRATE_NOW. Correcciones a la directiva: el DOI de C2 corresponde a «The graphical brain» (Friston, Parr & de Vries 2017). Dependencias instaladas: ninguna.

## TAREA 02: C01 automodelo funcional
- Migración 048 (cog_capacidades, cog_capacidad_pruebas, cog_automodelo). src/core/automodelo.ts: niveles no_existe/instalada/disponible/probada/degradada, confianza de Laplace sobre pruebas reales (audit_log herramienta.*, sol_conectores_pruebas, acd_experimentos), quienHace (agente por función/estatuto/herramientas o «ninguno»), puedo (qué falta), registrarPrueba (un fallo posterior degrada). Herramienta `automodelo` (solo lectura) para CEO y agentes. Pruebas: test/automodelo.test.ts 6/6 (autoevaluación incorrecta corregida tras un fallo, herramienta inexistente, Q-LAB/CUDA ausentes, agente adecuado y ninguno). npm test 198/198. En vivo: Q-LAB no_existe con confianza 0; R01/R03/R05 degradados.
