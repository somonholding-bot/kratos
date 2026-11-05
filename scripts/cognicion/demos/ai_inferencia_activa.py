# Demo de inferencia activa (Friston et al.; Parr, Pezzulo & Friston 2022) en un laberinto en T discreto: el premio está a la izquierda
# o a la derecha (50/50); una pista indica el lado con fiabilidad 0,95. Un agente que minimiza la energía libre esperada (valor
# epistémico + pragmático) consulta primero la pista; un agente solo pragmático elige un brazo al azar.
# Predicción falsable: recompensa media del agente de inferencia activa > 0,85 y la del agente pragmático < 0,6 (1000 episodios, semilla).
import json, numpy as np
rng = np.random.default_rng(2022)
fiab = 0.95
def H(p): p = np.clip(np.asarray(p, float), 1e-12, 1); return float(-(p * np.log(p)).sum())
def G_pista(creencia):
    # valor epistémico = información mutua esperada entre contexto y pista; valor pragmático posterior: luego elegirá el brazo más probable
    po = np.array([creencia[0] * fiab + creencia[1] * (1 - fiab), creencia[0] * (1 - fiab) + creencia[1] * fiab])
    epist = H(creencia) - sum(po[o] * H(np.array([creencia[0] * (fiab if o == 0 else 1 - fiab), creencia[1] * (1 - fiab if o == 0 else fiab)]) / po[o]) for o in range(2))
    prag = sum(po[o] * max(np.array([creencia[0] * (fiab if o == 0 else 1 - fiab), creencia[1] * (1 - fiab if o == 0 else fiab)]) / po[o]) for o in range(2))
    return -(epist + prag)
def G_brazo(creencia, lado): return -(creencia[lado])          # sin ganancia de información; valor pragmático = probabilidad de premio
def episodio(epistemico):
    lado = int(rng.integers(0, 2)); creencia = np.array([0.5, 0.5])
    opciones = {"izquierda": G_brazo(creencia, 0), "derecha": G_brazo(creencia, 1)}
    if epistemico: opciones["pista"] = G_pista(creencia)
    accion = min(opciones, key=lambda k: (opciones[k], k == "izquierda", k == "derecha"))
    if accion == "pista":
        obs = lado if rng.random() < fiab else 1 - lado
        creencia = np.array([fiab if obs == 0 else 1 - fiab, 1 - fiab if obs == 0 else fiab]); accion = "izquierda" if creencia[0] > creencia[1] else "derecha"
    elif not epistemico: accion = "izquierda" if rng.random() < 0.5 else "derecha"
    return int((accion == "izquierda") == (lado == 0)), accion
r_ai = [episodio(True)[0] for _ in range(1000)]; r_p = [episodio(False)[0] for _ in range(1000)]
json.dump({"metricas": {"recompensa_inferencia_activa": round(float(np.mean(r_ai)), 4), "recompensa_pragmatico": round(float(np.mean(r_p)), 4), "G_pista_inicial": round(G_pista(np.array([0.5, 0.5])), 4), "G_brazo_inicial": -0.5},
           "descripcion": "Laberinto en T: energía libre esperada (epistémica + pragmática) frente a un agente solo pragmático.", "datos": "sintetico"}, open("salida.json", "w"))
