# Demo de orden superior / metacognición (Rosenthal; Fleming & Lau 2014; Maniscalco & Lau 2012): la sensibilidad metacognitiva
# (AUROC de tipo 2: ¿la confianza distingue aciertos de errores?) es separable del rendimiento de primer orden (d').
# Predicción falsable: con d' fijo, el AUROC2 baja al aumentar el ruido de la representación de orden superior.
import json, numpy as np
rng = np.random.default_rng(2014)
def auroc(conf, acierto):
    p, n = conf[acierto], conf[~acierto]
    orden = np.argsort(np.concatenate([p, n])); rangos = np.empty(len(orden)); rangos[orden] = np.arange(1, len(orden) + 1)
    return float((rangos[:len(p)].sum() - len(p) * (len(p) + 1) / 2) / (len(p) * len(n)))
N, dprime = 20000, 1.5
estimulo = rng.integers(0, 2, N) * 2 - 1
x = estimulo * dprime / 2 + rng.standard_normal(N)
respuesta = np.sign(x); acierto = respuesta == estimulo
res = {}
for ruido in [0.0, 0.5, 1.0, 2.0]:
    conf = np.abs(x + ruido * rng.standard_normal(N))       # la confianza lee una copia (más o menos ruidosa) de la evidencia
    res[f"auroc2_ruido_{ruido}"] = round(auroc(conf, acierto), 4)
res["acierto_primer_orden"] = round(float(acierto.mean()), 4)
json.dump({"metricas": res, "descripcion": "Sensibilidad metacognitiva (AUROC tipo 2) con d'=1,5 fijo y ruido creciente en la representación de orden superior.", "datos": "sintetico"}, open("salida.json", "w"))
