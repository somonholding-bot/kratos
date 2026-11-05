# Demo de procesamiento predictivo (Friston 2010; formulación tutorial de codificación predictiva gaussiana): inferir una causa oculta v
# a partir de u = v² + ruido minimizando la energía libre por descenso de gradiente sobre los errores de predicción.
# Predicción falsable: el estado al que converge coincide con la moda posterior calculada por rejilla (|diferencia| < 0,01) y la
# energía libre baja de forma monótona. Es un algoritmo práctico; no demuestra la teoría del cerebro.
import json, numpy as np
vp, sp, su, u = 3.0, 1.0, 1.0, 2.0
F = lambda v: (v - vp) ** 2 / (2 * sp) + (u - v ** 2) ** 2 / (2 * su)
v, hist = vp, []
for _ in range(2000):
    ep, eu = (v - vp) / sp, (u - v ** 2) / su
    v += 0.01 * (-ep + eu * 2 * v); hist.append(F(v))
rej = np.linspace(-1, 5, 600001); post = -F(rej); moda = float(rej[np.argmax(post)])
mon = bool(all(b <= a + 1e-12 for a, b in zip(hist, hist[1:])))
json.dump({"metricas": {"v_inferido": round(float(v), 5), "moda_posterior": round(moda, 5), "diferencia": round(abs(float(v) - moda), 6), "energia_libre_monotona": int(mon), "energia_final": round(float(hist[-1]), 5)},
           "descripcion": "Codificación predictiva de una variable: descenso de la energía libre frente a la moda posterior por rejilla.", "datos": "sintetico"}, open("salida.json", "w"))
