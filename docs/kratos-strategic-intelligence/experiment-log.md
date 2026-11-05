# KSIE — Registro de experimentos y modelo financiero (TAREA 07)

## Contrato de un experimento (tabla `experiments` existente, ampliada en la migración 056)

Cada experimento registra:
- hipótesis, línea base y métrica;
- presupuesto;
- resultado previsto (además, una predicción C05 registrada **antes**);
- umbral de éxito y umbral de corte (umbral_fracaso < umbral_exito, los dos decididos antes);
- resultados, interpretación, siguiente decisión y aprobación.

Tipos aceptados: entrevistas, página de interés, lista de espera no vinculante, demostración de prototipo, anuncio pequeño (de pago), preventa veraz, presupuestos de proveedor y simulación de economía unitaria.

- Gasto o acción externa → se pide aprobación. Un experimento de pago no se ejecuta hasta que el propietario lo aprueba.
- **Clics, likes, vistas, comentarios, seguidores y halagos no son compras.** Si la métrica mide compras, el resultado queda «no concluyente».
- Cuenta como compra: compra, preventa pagada, depósito o contrato.
- El resultado actualiza la predicción C05 (error de predicción) y la memoria C03. Un fracaso deja una lección.

## Modelo financiero (`modeloFinanciero`)

Para cada escenario (pesimista, base y optimista) calcula:
- ingresos, coste de ventas (con comisiones) y margen bruto;
- captación (CAC × clientes nuevos) y costes fijos;
- beneficio antes de impuestos, impuestos y **beneficio neto**;
- capital circulante y caja acumulada a 12 meses, con el capital inicial;
- mes en que se recupera el capital, LTV, LTV/CAC y unidades de equilibrio.

El avance hacia el hito usa **solo el beneficio neto**. El modelo avisa en tres casos: el escenario base pierde dinero, LTV/CAC < 3, o el pesimista no recupera el capital en 12 meses.

## Beneficio neto real (`beneficioReal`, OBSERVED)

Ingresos registrados con fuente en `metrics`, menos el gasto real: los `budget_movements` de tipo «cargo» y los costes anotados en `metrics`.

A 5-nov-2026, últimos 30 días:
- ingresos: 0 $ (ningún registro);
- gasto: 9,57 $;
- **beneficio neto observado: −9,57 $**, es decir, 0 % del hito.

## Experimentos reales en producción

Ninguno todavía; solo existe la fila de demostración anterior. No se lanza ningún experimento sin una oportunidad evaluada. Si cuesta dinero, tampoco sin la aprobación del propietario.
