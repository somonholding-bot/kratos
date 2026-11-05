# Referencias y repositorios (Tarea 01)

Generado a partir de `referencias.json` y `repositorios.json`. Solo se registran campos obtenidos de páginas abiertas; lo no abierto está marcado. Resúmenes con palabras propias.

## Referencias

### A1 — Metacognición
- Cita: Nelson, T. O., & Narens, L. (1990). Metamemory: A theoretical framework and new findings. Psychology of Learning and Motivation, 26, 125-173.
- URL: https://doi.org/10.1016/S0079-7421(08)60053-5
- Acceso: metadatos (verificada: sí)
- Hipótesis: Marco teórico (según el título y la cita establecida): la memoria se modela en dos niveles, un nivel objeto y un metanivel, con flujos de monitorización (objeto a meta) y de control (meta a objeto). Resumen no leído: solo se abrió el registro Crossref del DOI.
- Aplicación: Separar en KRATOS el nivel objeto (producir respuesta) del metanivel (monitorizar y decidir si se confía, se revisa o se escala) y registrar ambos flujos en C02.
- Justificación: parcial

### A2 — Metacognición
- Cita: Fleming, S. M., & Lau, H. C. (2014). How to measure metacognition. Frontiers in Human Neuroscience, 8, 443.
- URL: https://doi.org/10.3389/fnhum.2014.00443
- Acceso: texto_completo (verificada: sí)
- Hipótesis: La metacognición debe cuantificarse separando sesgo (nivel medio de confianza), sensibilidad (cuánto discrimina la confianza entre aciertos y fallos) y eficiencia (sensibilidad relativa al rendimiento en la tarea).
- Aplicación: Medir la calibración de la confianza declarada de KRATOS contra resultados verificados con métricas de tipo 2 (AUROC tipo 2, meta-d' cuando haya datos suficientes), reportando sesgo y sensibilidad por separado; no fiarse de un «95 % seguro» declarado.
- Justificación: justificada

### A3 — Metacognición
- Cita: Maniscalco, B., & Lau, H. (2012). A signal detection theoretic approach for estimating metacognitive sensitivity from confidence ratings. Consciousness and Cognition, 21(1), 422-430.
- URL: https://doi.org/10.1016/j.concog.2011.09.021
- Acceso: resumen (verificada: sí)
- Hipótesis: Las medidas disponibles de sensibilidad metacognitiva (tipo 2) están contaminadas por el sesgo de respuesta y la sensibilidad tipo 1; se propone una medida libre de esos factores, meta-d', expresada en las mismas unidades que d'.
- Aplicación: Implementar meta-d' (con ajuste de máxima verosimilitud o aproximación) sobre el histórico de decisiones de KRATOS cuando existan cientos de ensayos con confianza y resultado; usar el cociente meta-d'/d' como eficiencia metacognitiva.
- Justificación: justificada

### B1 — Espacio global
- Cita: Baars, B. J. (1988). A Cognitive Theory of Consciousness. Cambridge University Press (Cambridge/Nueva York), xxiii + 424 pp.
- URL: https://philpapers.org/rec/BAAACT
- Acceso: metadatos (verificada: no)
- Hipótesis: Teoría del espacio global de trabajo: contenidos conscientes son los que se difunden a una red de procesadores especializados e inconscientes que compiten por acceso a un espacio de difusión limitado. Basado en registros bibliográficos y resúmenes de búsqueda; el libro no se abrió.
- Aplicación: Un único espacio de trabajo compartido con competencia/selección y difusión de un solo objetivo activo (C04), con procedencia de mensajes.
- Justificación: parcial

### B2 — Espacio global
- Cita: Baars, B. J., & Franklin, S. (2007). An architectural model of conscious and unconscious brain functions: Global Workspace Theory and IDA. Neural Networks, 20(9), 955-961.
- URL: https://doi.org/10.1016/j.neunet.2007.09.013
- Acceso: resumen (verificada: sí)
- Hipótesis: Una arquitectura cognitiva híbrida (códelets distribuidos, paso de activación) puede implementar la teoría del espacio global (GWT) y el modelo LIDA/IDA con agencia autónoma.
- Aplicación: Patrón de arquitectura para C04: procesadores especializados que compiten, difusión del ganador y ciclo de decisión; cola persistente con un objetivo principal.
- Justificación: justificada

### B3 — Espacio global
- Cita: Dehaene, S., Kerszberg, M., & Changeux, J.-P. (1998). A neuronal model of a global workspace in effortful cognitive tasks. Proceedings of the National Academy of Sciences, 95(24), 14529-14534.
- URL: https://doi.org/10.1073/pnas.95.24.14529
- Acceso: resumen (verificada: sí)
- Hipótesis: Hay un espacio de trabajo global de neuronas con axones de largo alcance, movilizado en tareas que exigen esfuerzo, que activa o suprime procesadores modulares especializados.
- Aplicación: Mecanismo de selección y activación de módulos por una señal de esfuerzo/error; el error eleva la prioridad de una tarea en la cola de C04.
- Justificación: parcial

### B4 — Espacio global
- Cita: Dehaene, S., & Changeux, J.-P. (2011). Experimental and theoretical approaches to conscious processing. Neuron, 70(2), 200-227.
- URL: https://doi.org/10.1016/j.neuron.2011.03.018
- Acceso: resumen (verificada: sí)
- Hipótesis: El acceso consciente ocurre cuando la información se hace globalmente disponible a muchos sistemas cerebrales (espacio neuronal global), con «ignición» de una red amplia prefronto-parietal.
- Aplicación: Criterio operativo de «difusión»: una información cuenta como disponible globalmente en KRATOS si todos los agentes pueden consultarla con procedencia; solo ingeniería de acceso, no conciencia.
- Justificación: parcial

### C1 — Procesamiento predictivo
- Cita: Friston, K. (2010). The free-energy principle: a unified brain theory? Nature Reviews Neuroscience, 11(2), 127-138.
- URL: https://doi.org/10.1038/nrn2787
- Acceso: resumen (verificada: sí)
- Hipótesis: Un principio de energía libre explica percepción, acción y aprendizaje como optimización de un mismo cuanto: el valor o su complemento, la sorpresa (error de predicción).
- Aplicación: Hacer explícitas las predicciones antes de observar y usar el error de predicción para revisar creencias y elegir la siguiente prueba (C05), con algoritmos prácticos simples; la teoría completa no se implementa.
- Justificación: parcial

### C2 — Procesamiento predictivo
- Cita: Friston, K., Parr, T., & de Vries, B. (2017). The graphical brain: Belief propagation and active inference. Network Neuroscience, 1(4), 381-414. (La directiva cita el DOI 10.1162/NETN_a_00018, que corresponde a este artículo.)
- URL: https://doi.org/10.1162/netn_a_00018
- Acceso: resumen (verificada: sí)
- Hipótesis: La integración funcional cerebral puede formularse como propagación de creencias bajo modelos generativos profundos (estados discretos y continuos), tal como exige la inferencia activa.
- Aplicación: Referencia de fondo para distinguir predicción práctica de teoría de inferencia activa; no se implementa propagación de creencias en KRATOS.
- Justificación: parcial

### C3 — Procesamiento predictivo
- Cita: Parr, T., Pezzulo, G., & Friston, K. J. (2022). Active Inference: The Free Energy Principle in Mind, Brain, and Behavior. MIT Press.
- URL: https://mitpress.mit.edu/9780262045353/active-inference/
- Acceso: metadatos (verificada: no)
- Hipótesis: Libro de texto sobre inferencia activa. La página de MIT Press devolvió 403, por lo que no se pudo abrir; los datos bibliográficos proceden de la directiva y de la URL consultada, sin comprobar.
- Aplicación: Fuente conceptual para la separación entre teoría y algoritmos prácticos; sin implementación prevista.
- Justificación: especulativa

### D1 — Teorías de la conciencia
- Cita: Tononi, G. (2004). An information integration theory of consciousness. BMC Neuroscience, 5, 42.
- URL: https://doi.org/10.1186/1471-2202-5-42
- Acceso: resumen (verificada: sí)
- Hipótesis: La conciencia corresponde a la capacidad de un sistema para integrar información; motivada por diferenciación (muchas experiencias posibles) e integración (unidad de cada experiencia).
- Aplicación: Demostración pequeña de una medida de integración en una red de 3-4 nodos calculada por nosotros, dentro del laboratorio comparativo; sin atribuir conciencia. Ninguna de las teorías D1-D7 demuestra que implementar sus análogos computacionales produzca experiencia subjetiva; en KRATOS solo sirve como registro comparativo.
- Justificación: especulativa

### D2 — Teorías de la conciencia
- Cita: Oizumi, M., Albantakis, L., & Tononi, G. (2014). From the phenomenology to the mechanisms of consciousness: Integrated Information Theory 3.0. PLoS Computational Biology, 10(5), e1003588.
- URL: https://doi.org/10.1371/journal.pcbi.1003588
- Acceso: resumen (verificada: sí)
- Hipótesis: IIT 3.0 parte de axiomas fenomenológicos (información, integración, exclusión) formalizados en postulados sobre mecanismos físicos; una experiencia es una estructura conceptual máximamente irreducible.
- Aplicación: Comparación de teorías en C06 con un cálculo de Φ de juguete (3-4 nodos); implementar nosotros una medida simplificada es suficiente. Ninguna de las teorías D1-D7 demuestra que implementar sus análogos computacionales produzca experiencia subjetiva; en KRATOS solo sirve como registro comparativo.
- Justificación: especulativa

### D3 — Teorías de la conciencia
- Cita: Rosenthal, D. M. (1986). Two concepts of consciousness. Philosophical Studies, 49(3), 329-359. | Rosenthal, D. M. (2005). Consciousness and Mind. Oxford University Press (ISBN 9780198236962; recopilación de ensayos). | Lau, H., & Rosenthal, D. (2011). Empirical support for higher-order theories of conscious awareness. Trends in Cognitive Sciences, 15(8), 365-373. (Rosenthal 1997 «A theory of consciousness» no se verificó.)
- URL: https://doi.org/10.1007/BF00355521
- Acceso: metadatos (verificada: no)
- Hipótesis: Teoría de pensamiento de orden superior (HOT): un estado mental es consciente cuando el sujeto tiene un pensamiento de orden superior dirigido a él. Datos obtenidos de resultados de búsqueda (registros bibliográficos y reseñas); ninguna de las tres obras se abrió directamente.
- Aplicación: Metacognición funcional en C02: un componente que representa y evalúa los estados de otro componente (como análogo de HOT). Ninguna de las teorías D1-D7 demuestra que implementar sus análogos computacionales produzca experiencia subjetiva; en KRATOS solo sirve como registro comparativo.
- Justificación: especulativa

### D4 — Teorías de la conciencia
- Cita: Graziano, M. S. A., & Webb, T. W. (2015). The attention schema theory: a mechanistic account of subjective awareness. Frontiers in Psychology, 6, 500.
- URL: https://doi.org/10.3389/fpsyg.2015.00500
- Acceso: resumen (verificada: sí)
- Hipótesis: El cerebro construye un modelo simplificado de su propia atención (esquema de atención); el contenido de ese modelo lleva al cerebro a concluir que tiene experiencia subjetiva.
- Aplicación: Modelo interno de qué atiende KRATOS y por qué (autoinforme inspeccionable de C01/C04). Ninguna de las teorías D1-D7 demuestra que implementar sus análogos computacionales produzca experiencia subjetiva; en KRATOS solo sirve como registro comparativo.
- Justificación: especulativa

### D5 — Teorías de la conciencia
- Cita: Butlin, P., Long, R., Elmoznino, E., Bengio, Y., Birch, J., Constant, A., Deane, G., Fleming, S. M., et al. (2023). Consciousness in Artificial Intelligence: Insights from the Science of Consciousness. arXiv:2308.08708.
- URL: https://arxiv.org/abs/2308.08708
- Acceso: resumen (verificada: sí)
- Hipótesis: Se puede evaluar la posible conciencia de sistemas de IA con «propiedades indicadoras» derivadas de teorías neurocientíficas (procesamiento recurrente, espacio global, orden superior, procesamiento predictivo, esquema de atención).
- Aplicación: Lista de verificación de indicadores como registro comparativo de qué análogos funcionales tiene KRATOS, sin declarar conciencia. Ninguna de las teorías D1-D7 demuestra que implementar sus análogos computacionales produzca experiencia subjetiva; en KRATOS solo sirve como registro comparativo.
- Justificación: parcial

### D6 — Teorías de la conciencia
- Cita: Hameroff, S., & Penrose, R. (2014). Consciousness in the universe: A review of the 'Orch OR' theory. Physics of Life Reviews, 11(1), 39-78.
- URL: https://doi.org/10.1016/j.plrev.2013.08.002
- Acceso: resumen (verificada: sí)
- Hipótesis: Hipótesis discutida y minoritaria: la conciencia depende de procesos cuánticos coherentes «orquestados» en microtúbulos neuronales, cuya reducción objetiva (esquema Diósi-Penrose) produce momentos de conciencia.
- Aplicación: Solo entrada del registro comparativo, marcada como hipótesis contestada; no hay cómputo cuántico implementable que justifique experiencia en KRATOS. Ninguna de las teorías D1-D7 demuestra que implementar sus análogos computacionales produzca experiencia subjetiva; en KRATOS solo sirve como registro comparativo.
- Justificación: especulativa

### D7 — Teorías de la conciencia
- Cita: Seth, A. K., & Bayne, T. (2022). Theories of consciousness. Nature Reviews Neuroscience, 23(7), 439-452.
- URL: https://doi.org/10.1038/s41583-022-00587-4
- Acceso: resumen (verificada: sí)
- Hipótesis: Las teorías actuales difieren en qué aspectos de la conciencia explican y en sus compromisos neurobiológicos; conviene compararlas y enfrentarlas empíricamente.
- Aplicación: Estructura de la tabla comparativa de C06 (qué explica, supuestos, evidencia, predicciones). Ninguna de las teorías D1-D7 demuestra que implementar sus análogos computacionales produzca experiencia subjetiva; en KRATOS solo sirve como registro comparativo.
- Justificación: justificada

### E1 — Descubrimiento científico autónomo
- Cita: Romera-Paredes, B., Barekatain, M., Novikov, A., Balog, M., Kumar, M. P., Dupont, E., Ruiz, F. J. R., Ellenberg, J., et al. (2023). Mathematical discoveries from program search with large language models. Nature, 625(7995), 468-475.
- URL: https://doi.org/10.1038/s41586-023-06924-6
- Acceso: resumen (verificada: sí)
- Hipótesis: Emparejar un LLM preentrenado con un evaluador sistemático en un procedimiento evolutivo (FunSearch) evita confabulaciones y permite descubrir programas que superan resultados conocidos.
- Aplicación: Bucle generar-evaluar-seleccionar con evaluadores automáticos deterministas para tareas acotadas de KRATOS, con LLM local.
- Justificación: justificada

### E2 — Descubrimiento científico autónomo
- Cita: Novikov, A., Vũ, N., Eisenberger, M., Dupont, E., Huang, P.-S., Wagner, A. Z., Shirobokov, S., Kozlovskii, B., et al. (2025). AlphaEvolve: A coding agent for scientific and algorithmic discovery. arXiv:2506.13131.
- URL: https://arxiv.org/abs/2506.13131
- Acceso: resumen (verificada: sí)
- Hipótesis: Un agente de código evolutivo que orquesta LLM y recibe retroalimentación de evaluadores mejora algoritmos de forma iterativa.
- Aplicación: Mismo patrón que E1: generar, evaluar, seleccionar con evaluador automático y registro de cada candidato.
- Justificación: justificada

### E3 — Descubrimiento científico autónomo
- Cita: Lu, C., Lu, C., Lange, R. T., Foerster, J., Clune, J., & Ha, D. (2024). The AI Scientist: Towards Fully Automated Open-Ended Scientific Discovery. arXiv:2408.06292.
- URL: https://arxiv.org/abs/2408.06292
- Acceso: resumen (verificada: sí)
- Hipótesis: Un LLM de frontera puede ejecutar el ciclo científico completo: ideas, código, experimentos, redacción y revisión simulada.
- Aplicación: Solo el diseño del ciclo y el revisor automático como idea; no se ejecuta el sistema.
- Justificación: parcial

### E4 — Descubrimiento científico autónomo
- Cita: Sakana AI. (2025). The AI Scientist-v2: Workshop-Level Automated Scientific Discovery via Agentic Tree Search [repositorio de código]. GitHub, SakanaAI/AI-Scientist-v2.
- URL: https://github.com/SakanaAI/AI-Scientist-v2
- Acceso: pagina (verificada: sí)
- Hipótesis: Búsqueda en árbol agéntica guiada por un gestor de experimentos, sin plantillas escritas por humanos.
- Aplicación: Ninguna instalación; solo ideas de gestor de experimentos con evaluadores.
- Justificación: parcial

### E5 — Descubrimiento científico autónomo
- Cita: Sakana AI. ShinkaEvolve: Towards Open-Ended and Sample-Efficient Program Evolution [repositorio de código]. GitHub, SakanaAI/ShinkaEvolve (v0.0.7).
- URL: https://github.com/SakanaAI/ShinkaEvolve
- Acceso: pagina (verificada: sí)
- Hipótesis: Población de programas con un conjunto de LLM como operadores de mutación, para evolución eficiente en muestras.
- Aplicación: Patrón evolutivo con LLM local como referencia de diseño.
- Justificación: parcial

### E6 — Descubrimiento científico autónomo
- Cita: Gottweis, J., & Natarajan, V. (2025, 19 de febrero). Accelerating scientific breakthroughs with an AI co-scientist. Google Research Blog.
- URL: https://research.google/blog/accelerating-scientific-breakthroughs-with-an-ai-co-scientist/
- Acceso: pagina (verificada: sí)
- Hipótesis: Un sistema multiagente sobre Gemini 2.0 (Supervisor; Generación, Reflexión, Clasificación, Evolución, Proximidad y Meta-revisión) genera, critica y refina hipótesis mediante torneos con puntuación Elo y debate simulado.
- Aplicación: Idea de torneo de hipótesis con revisores independientes en ACD; imposible de instalar o reproducir.
- Justificación: parcial

### F1 — Ingeniería computacional
- Cita: McClelland, R. (NASA Goddard Space Flight Center). «Evolved structures»: diseño generativo asistido por IA de piezas de misión. Cobertura: Paul, A. (16 feb. 2023). NASA is using AI to help design lighter parts. Popular Science.
- URL: https://www.popsci.com/technology/nasa-evolved-structures-spacecraft-ai/
- Acceso: pagina (verificada: no)
- Hipótesis: Software comercial de IA generativa propone estructuras a partir de requisitos y restricciones; piezas hasta dos tercios más ligeras. Solo se abrió la cobertura de Popular Science; la página primaria de NASA devolvió 404 en el enlace probado.
- Aplicación: Ideas de diseño por restricciones (cargas, montajes, validación) para el módulo de diseño computacional; sin implementación.
- Justificación: parcial

### F2 — Ingeniería computacional
- Cita: LEAP 71. Noyron: Computational Engineering Model [página de producto]. Dubái: LEAP 71.
- URL: https://leap71.com/noyron/
- Acceso: pagina (verificada: sí)
- Hipótesis: Un modelo de ingeniería computacional codifica física, reglas de diseño y restricciones de fabricación para generar geometría con predicción de rendimiento.
- Aplicación: Idea de diseño generativo guiado por restricciones y bucle de realimentación con datos de ensayo.
- Justificación: parcial

### F3 — Ingeniería computacional
- Cita: LEAP 71. PicoGK: A compact and robust geometry kernel for Computational Engineering [repositorio de código]. GitHub, leap71/PicoGK (v2.3.0).
- URL: https://github.com/leap71/PicoGK
- Acceso: pagina (verificada: sí)
- Hipótesis: Núcleo geométrico abierto en C# (licencia Apache-2.0) para ingeniería computacional.
- Aplicación: Solo referencia; no se instala.
- Justificación: parcial

## Repositorios

| Nombre | Licencia | Versión | Clasificación | Motivo |
|---|---|---|---|---|
| alphaevolve | Apache-2.0 (software); CC-BY 4.0 (otros materiales) | Sin releases ni tags; último push 2026-11-04 | RESEARCH_ONLY | Implementación mínima y cuadernos de verificación; la ejecución requiere API Gemini (de pago) y Docker; no es producto instalable. |
| funsearch | Apache-2.0 (software); CC-BY 4.0 (otros) | Sin releases; último push 2024-02-05 | RESEARCH_ONLY | El README dice que no incluye LLM, sandbox ni infraestructura distribuida; sirve para entender el método. |
| AI-Scientist-v2 | The AI Scientist Source Code License v1.0 (derivada de Responsible AI Source Code License; GitHub: NOASSERTION) | Sin releases; último push 2025-12-19 | REJECT_INCOMPATIBLE | Exige Linux+CUDA y APIs de pago (README estima 15-20 USD por experimento); ejecuta código de LLM; incompatible con Mac sin CUDA ni gasto autorizado. |
| AI-Scientist | The AI Scientist Source Code License (GitHub: NOASSERTION) | Sin releases; último push 2025-12-19 | REJECT_INCOMPATIBLE | Linux+CUDA y APIs de pago; CPU sola probablemente inviable según README. |
| ShinkaEvolve | Apache-2.0 | v0.0.7 (2026-06-02); push 2026-10-05 | RESEARCH_ONLY | Útil como referencia del bucle evolutivo con LLM; un bucle generar-evaluar-seleccionar sencillo con Ollama cubre la necesidad inicial; no se ha probado. |
| pymdp | MIT | v1.0.4 (2026-08-23); PyPI inferactively-pymdp 1.0.4 | REJECT_UNNECESSARY | Las pruebas de predicción deterministas simples no requieren un marco de inferencia activa; añade JAX y muchas dependencias. |
| pyphi | GPL-3.0 (LICENSE.md) | 2.0.0rc4 (tag); última versión estable 1.2.0 (2019-06-22) | REJECT_INCOMPATIBLE | Venv en Python 3.11: PyPhi 2.0 exige 3.13+; la 1.2 es de 2019, con issue abierto #108 «Python3.12: Tests fail» y pyemd actual pide Python >=3.12. Un Φ de juguete de 3-4 nodos se calcula con numpy propio y se valida contra casos conocidos de la literatura. |
| nengo | GPL v2 (LICENSE.rst) | v4.1.0 (tag); release v4.0.0 2023-11-17; push 2026-08-02 | REJECT_UNNECESSARY | Simulador neuronal a gran escala; no resuelve ninguna falta de KRATOS; licencia GPL-2. |
| ACT-R | LGPL 2.1 según el espejo de GitHub (sitio oficial no comprobado) | 7.21.6 (dic 2020) según Wikipedia; sitio oficial inaccesible (ECONNREFUSED) | RESEARCH_ONLY | Arquitectura cognitiva de referencia; no hay integración necesaria. Datos de segunda mano porque el sitio no respondió. |
| scipy | BSD-3-Clause | v1.18.1 (2026-08-21); instalada en venv: 1.17.1 | EXISTING_INTEGRATION | Ya está en el venv acd (1.17.1) y cubre estadística y optimización necesarias. |
| sympy | BSD (LICENSE) | 1.14.0 (2025-04-27); instalada: 1.14.0 | EXISTING_INTEGRATION | Ya instalada con la última versión. |
| networkx | BSD-3-Clause | 3.7 (2026-09-21); instalada: 3.6.1 | EXISTING_INTEGRATION | Ya instalada (3.6.1); basta para redes de juguete de la demostración de integración. |
| qiskit | Apache-2.0 | 2.6.1 (2026-10-22) | REJECT_UNNECESSARY | No hay falta de KRATOS que lo exija en esta fase; Orch OR no requiere computación cuántica real. No está en el venv. |
| pennylane | Apache-2.0 | v0.45.1 (2026-06-26) | REJECT_UNNECESSARY | Sin falta concreta que resolver; coste de dependencias. |
| PicoGK | Apache-2.0 | PicoGK-v2.3.0 (2026-08-05) | RESEARCH_ONLY | Núcleo geométrico; no contiene Noyron. Útil solo como referencia de diseño computacional. |
| leap71 (organización) | Apache-2.0 solo PicoGK declarada; resto no indicada en la ficha leída | Varios repositorios; ShapeKernel v1.0.0 | RESEARCH_ONLY | Biblioteca base abierta; Noyron es propietario y no se publica. |
| ollama | MIT | v0.40.14 (2026-11-03); instalado localmente: 0.40.14 | EXISTING_INTEGRATION | Ya instalado con gemma4:12b; ninguna acción nueva. |
| mlx | MIT | v0.32.4 (2026-10-14) | REJECT_UNNECESSARY | Ollama ya cubre la inferencia local; añadir otro marco duplica funciones. |
| llama.cpp | MIT | v0.9.0 (2026-11-04) | REJECT_UNNECESSARY | Ollama ya cubre la inferencia local. |

Conteo: EXISTING_INTEGRATION=4, REJECT_INCOMPATIBLE=3, REJECT_UNNECESSARY=6, RESEARCH_ONLY=6
Verificadas: 22/26.
