# Demo GWT (Dehaene, Kerszberg & Changeux 1998; Dehaene & Changeux 2011): «ignición» no lineal del espacio global.
# Modelo de juguete: un estímulo de intensidad cercana al umbral entra con ruido. (a) Espacio global con autoexcitación recurrente
# (dinámica biestable) frente a (b) un integrador lineal sin recurrencia. Predicción falsable: con recurrencia la actividad final es
# bimodal (todo o nada: coeficiente de bimodalidad > 0,555); sin recurrencia es unimodal (< 0,555). No es conciencia: es dinámica.
import json, numpy as np
rng = np.random.default_rng(1998)
def bc(x):
    n = len(x); m = x.mean(); s = x.std()
    g = ((x - m) ** 3).mean() / s ** 3; k = ((x - m) ** 4).mean() / s ** 4 - 3
    return float((g ** 2 + 1) / (k + 3 * (n - 1) ** 2 / ((n - 2) * (n - 3))))
N, T, dt = 4000, 200, 0.05
estimulo = 0.5 + 0.15 * rng.standard_normal(N)          # intensidad cercana al umbral en cada ensayo
def recurrente(s):
    a = np.zeros_like(s)
    for _ in range(T):
        a += dt * (-a + 1 / (1 + np.exp(-12 * (a + s - 1.0))) ) + 0.02 * np.sqrt(dt) * rng.standard_normal(len(s))
    return a
def lineal(s):
    a = np.zeros_like(s)
    for _ in range(T):
        a += dt * (-a + s) + 0.02 * np.sqrt(dt) * rng.standard_normal(len(s))
    return a
r, l = recurrente(estimulo), lineal(estimulo)
salida = {"metricas": {"bc_recurrente": round(bc(r), 4), "bc_lineal": round(bc(l), 4), "fraccion_ignicion": round(float((r > 0.5).mean()), 4)},
          "descripcion": "Coeficiente de bimodalidad de la actividad final del espacio global con y sin autoexcitación recurrente (4000 ensayos, semilla 1998).",
          "datos": "sintetico"}
json.dump(salida, open("salida.json", "w"))
