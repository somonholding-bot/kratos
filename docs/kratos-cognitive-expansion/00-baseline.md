# TAREA 00 — Punto de partida (5-nov-2026, antes de cualquier cambio)

**Repositorio:** ~/Jarvis, rama `main`, commit 478da1f, árbol limpio (los informes generados del rastreador SOL salen de git: `.gitignore`). Pruebas: `npm test` → 192/192 en la base `jarvis_test`.

## Componentes existentes (verificados en el código y en la base `jarvis`)
- **KRATOS (CEO):** `src/core/brain.ts` (herramientas, ciclo CEO cada 20 min `ceoCycle`, conversación), `src/worker.ts` (cola `tasks` con reintentos, verificación en código `verify.ts`, vigilantes), `src/server.ts` (panel 127.0.0.1:7420). Aprobaciones solo para dinero/suscripciones/borrar vídeos (`approvals.ts`), parada de emergencia (`state.ts`).
- **Siete agentes** en `agent_functions`: sol, luna, mercurio, venus, marte, jupiter, saturno (+ kratos). Se ejecutan como Claude Code por suscripción con sus herramientas (`toolregistry.ts`, `mcp-kratos.ts`).
- **Herramientas:** 71 activas en `tool_registry` (sincronizado con el código al arrancar).
- **Memoria existente:** `lessons` (221 lecciones), `knowledge_items`, bóveda Obsidian (~/Documents/Kratos), informes de tareas, `audit_log` (inmutable por trigger), biblioteca de Sol (`sol_fuentes`, `sol_afirmaciones`, `sol_conexiones`, `sol_proyectos`, `sol_predicciones`).
- **SOL/ACD:** directiva en docs/SOL-DIRECTIVA-ACD.md (enumera 147 ids, dice 139). Rastreador `sol_requisitos`: 18 VERIFIED, 16 IMPLEMENTED_UNVERIFIED, 9 PARTIAL, 2 BLOCKED (R01, R03), 1 FAILED (R05), 101 NOT_STARTED. Motor ACD (`src/core/acd.ts`) con ejecutor aislado (sandbox-exec sin red, escritura solo en su carpeta, sin fork/exec, límites de tiempo/CPU/archivo). Currículo de 56 materias con exámenes (`curriculo.ts`, `examen.ts`), grafo (`grafo.ts`), conectores R01–R16 (`conectores.ts`). Trabajo en curso que NO se toca: examen S12 (tarea 709), campaña C1 (tarea 710).
- **Predicción existente:** `sol_predicciones` (rango, confianza, base, resolución, calibración básica).
- **Q-LAB: NO EXISTE** en el repositorio (búsqueda sin resultados). Se informa como ausente; para cálculos se usa el ejecutor aislado del ACD.

## Capacidades ausentes (lo que pide la directiva)
Automodelo funcional (C01), registro de decisiones con calibración medida y escalado (C02), memoria autobiográfica estructurada con correcciones y recuperación para decidir (C03), espacio global con un objetivo activo y cola QUEUED→ACTIVE→VERIFYING→COMPLETED (C04), bucle predicción–error–revisión con entorno de prueba (C05), laboratorio comparativo de teorías de la conciencia (C06).

## Dependencias técnicas
Node 24 (type-stripping), PostgreSQL 16, Python 3.11 en `.jarvis/acd/venv` (numpy 2.4.6, scipy 1.17.1, sympy, pandas, networkx, pypdf), Ollama con gemma4:12b (respaldo local ya integrado), Claude Code por suscripción (sin gasto de API).

## Limitaciones de hardware
MacBook Air Apple Silicon, 16 GB de memoria unificada, 10 núcleos, 625 GB libres. Un solo trabajo pesado a la vez; los agentes se ejecutan en serie; sin CUDA (nada de pipelines Linux/CUDA).

## Defectos conocidos
R01/R03 limitados por peticiones anónimas (faltan claves gratuitas); R05 con PubMed caído; la prueba de voz falla a veces bajo carga; la cola de agentes es serie (el trabajo cognitivo comparte turno con la empresa).

## Estrategia de vuelta atrás
Cada tarea en un commit propio; migraciones solo añadiendo archivos; módulos nuevos en archivos nuevos; para revertir: `git revert <commit>` y, si la migración creó tablas nuevas, quedan sin uso (no se borra nada). Antes de recargar servicios se comprueba que no haya tarea de agente a medias.
