# Demo IIT de juguete (inspirada en Tononi 2004: información integrada como «el todo menos la suma de las partes»).
# NO es el Φ de IIT 3.0 (Oizumi et al. 2014: requiere estructuras causa-efecto y la distancia EMD; PyPhi se descartó por compatibilidad).
# Medida: para una red binaria determinista y pasado uniforme, I(todo) − [I(A) + I(B)] en la bipartición mínima (información mutua
# pasado→presente). Predicción falsable: red de nodos aislados → 0 bits; red XOR en anillo → > 0 bits.
import json, itertools, numpy as np
def mi(pares):
    from collections import Counter
    n = len(pares); pj = Counter(pares); pa = Counter(a for a, _ in pares); pb = Counter(b for _, b in pares)
    return sum(c / n * np.log2((c / n) / ((pa[a] / n) * (pb[b] / n))) for (a, b), c in pj.items())
def phi(f, n=3):
    estados = list(itertools.product([0, 1], repeat=n)); sig = {s: f(s) for s in estados}
    todo = mi([(s, sig[s]) for s in estados]); mejor = None
    for k in range(1, n // 2 + 1):
        for A in itertools.combinations(range(n), k):
            B = tuple(i for i in range(n) if i not in A)
            pa = mi([(tuple(s[i] for i in A), tuple(sig[s][i] for i in A)) for s in estados])
            pb = mi([(tuple(s[i] for i in B), tuple(sig[s][i] for i in B)) for s in estados])
            v = todo - (pa + pb)
            if mejor is None or v < mejor[0]: mejor = (v, A, B)
    return round(float(mejor[0]), 4), mejor[1], mejor[2]
redes = {"aislados": lambda s: s, "xor_anillo": lambda s: (s[1] ^ s[2], s[0] ^ s[2], s[0] ^ s[1]), "mayoria": lambda s: tuple(int(sum(s) >= 2) for _ in s),
         "cadena": lambda s: (s[0], s[0], s[1])}
m = {}
for nombre, f in redes.items():
    v, A, B = phi(f); m[f"phi_juguete_{nombre}"] = v
json.dump({"metricas": m, "descripcion": "Integración de juguete (todo menos partes, bipartición mínima) en redes binarias de 3 nodos. No es Φ de IIT 3.0.", "datos": "sintetico"}, open("salida.json", "w"))
