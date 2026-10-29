# Hoja de ruta de KRATOS

**Meta de vida:** 100.000 usuarios y 250.000 USD de ingresos mensuales. **Primer hito:** 10.000 usuarios.
Siempre por medios legales y honestos, dentro de los presupuestos y aprobaciones del propietario.

Actualizada: 28-oct-2026.

## ✅ Hecho

| # | Etapa | Estado |
|---|---|---|
| 1 | Diagnóstico, investigación y arquitectura | ✅ |
| 2 | Base local: servidor, base de datos, tareas, presupuesto, aprobaciones, auditoría, parada de emergencia | ✅ |
| 3 | Voz: «Hey Kratos» / «Kratos, Kratos», transcripción local, respuesta hablada | ✅ |
| 4 | Trabajo 24 h: servicios, cola, recuperación, copias, Mac sin reposo | ✅ |
| 5 | Inteligencia con Claude (clave + 10 USD aprobados) | ✅ |
| 6 | Memoria en Obsidian (`~/Documents/Kratos`) | ✅ |
| 7 | Siete agentes planetarios con estatuto por regente | ✅ |
| 8 | 72 skills (versión fijada, solo instrucciones): KRATOS 10 de CEO; planetas 5–12 cada uno, incluidas contratación de creadores y prensa | ✅ ([skills/MANIFEST.md](../skills/MANIFEST.md)) |
| 9 | Meta de vida en el núcleo + ciclo proactivo del CEO cada 12 h | ✅ |
| 10 | Motor de aprendizaje: lecciones (funcionó / no funcionó) que KRATOS y los agentes leen antes de trabajar | ✅ |
| 11 | Universo 3D a pantalla completa; panel interno con el mismo universo | ✅ |
| 12 | Repositorio público en GitHub | ✅ |

## 🚀 Plan actual

| Etapa | Qué incluye | Estado |
|---|---|---|
| 1 | Universo encuadrado, cielo en movimiento, más nebulosa, «¡pum!» al hablar; skills de creadores, comunidades y prensa | ✅ |
| 2 | Apple App Store Connect (solo lectura): estado de revisión cada 15 min y aviso hablado si cambia | ✅ código · ⏳ falta tu clave (`scripts/conectar-apple.sh` o botón «Conectar» en Conexiones) |
| 2b | Saludo «señor Idalmi», agenda y alarmas habladas («despiértame a las 8») | ✅ |
| 2c | Llamadas desde tu iPhone vía el Mac, solo por tu orden («guarda el número de Ana: …», «llama a Ana») | ✅ |
| 2d | Acceso remoto con enlace propio (túnel Cloudflare + clave remota + código al correo) | ✅ código · ⏳ falta mover el dominio a Cloudflare y ejecutar `scripts/acceso-remoto.sh` |
| 3 | Correo y lista de correo (leer, borradores; enviar solo con aprobación) | ⏳ |
| 4 | Búsqueda web para los agentes y delegación en Claude Code | ⏳ |
| 5 | Creadores reales, Google Play, panel mínimo, voz más humana | ⏳ |

## ⏳ Falta (en orden)

| # | Etapa | Qué incluye | Qué necesita del propietario |
|---|---|---|---|
| 13 | **Panel mínimo** | Solo voz, diseños precargados, saldo de IA y conexiones | Nada |
| 14 | **Datos de tus apps** | Expediente real de cada app (nombre, enlace, público, precio) | Tus datos |
| 15 | **Apple Developer (lectura)** | Estado de revisión en tiempo real de tus apps, descargas, reseñas | Crear una clave de API de App Store Connect con rol de solo lectura |
| 16 | **Google Play (lectura)** | Estado, instalaciones, reseñas | Cuenta de servicio con permiso de solo lectura |
| 17 | **GitHub y Vercel** | Ver repositorios y despliegues | Token de solo lectura de cada uno |
| 18 | **Correo** | Leer y preparar borradores; enviar solo con tu aprobación | Autorizar Gmail (OAuth) |
| 19 | **Navegador propio de KRATOS** | Investigar en la web (solo lectura, sin iniciar sesión por ti) | Aprobar la instalación |
| 20 | **Finanzas** | Ver saldos y movimientos (solo lectura); los pagos los autorizas tú siempre | Conector bancario de solo lectura (p. ej. Plaid) |
| 21 | **Teléfono** | Llamadas y mensajes de voz solo cuando tú se lo pidas | Proveedor de telefonía (p. ej. Twilio), verificar tu número, coste por minuto |
| 22 | **Publicación y anuncios** | Programar publicaciones y campañas | Política de aprobación por canal y presupuesto |
| 23 | **Autonomía ampliada** | Más acciones sin preguntar, con límites | Resultados medidos y tu aprobación |

## Por qué cada conexión es una etapa aparte

- Lo que yo (Claude Code) tengo conectado **no se puede transferir**: KRATOS necesita sus **propias** credenciales para cada servicio, creadas por ti y guardadas en el Llavero.
- Se empieza siempre en **solo lectura**. Escribir, enviar, publicar o pagar exige tu aprobación expresa, con importe y vigencia.
- **Dinero:** KRATOS nunca mueve dinero por su cuenta. Puede preparar un pago y pedirte que lo apruebes; la confirmación es tuya.
- **Llamadas:** solo cuando tú se lo ordenes, con aviso de que es un asistente cuando la ley lo exija.

## El «aprendizaje» de KRATOS

No es un modelo entrenado desde cero: es una **memoria que crece**. Cada resultado se guarda como lección (qué funcionó, qué no, con evidencia y confianza) en la base de datos y en Obsidian. Antes de decidir, KRATOS y cada planeta leen las lecciones más fiables. Así mejora con cada ciclo sin coste de entrenamiento.
