# Demo de la teoría del esquema de atención (Graziano & Webb 2015): un modelo interno simplificado del propio estado de atención
# mejora su control. El foco de atención deriva con perturbaciones; el controlador A usa un esquema (filtro de Kalman del foco)
# y el B actúa solo con la observación ruidosa directa. Predicción falsable: error medio de control de A < 0,8 × el de B.
# Es control con un modelo interno; no muestra ni implica experiencia.
import json, numpy as np
rng = np.random.default_rng(2015)
T, q, r, objetivo = 5000, 0.05, 0.5, 0.0
def simular(con_esquema):
    a, est, P, err = 0.0, 0.0, 1.0, []
    for _ in range(T):
        obs = a + np.sqrt(r) * rng.standard_normal()
        if con_esquema:
            K = P / (P + r); est = est + K * (obs - est); P = (1 - K) * P
            u = objetivo - est; est = est + u; P = P + q
        else:
            u = objetivo - obs
        a = a + u + np.sqrt(q) * rng.standard_normal(); err.append(abs(a - objetivo))
    return float(np.mean(err))
ea, eb = simular(True), simular(False)
json.dump({"metricas": {"error_con_esquema": round(ea, 4), "error_sin_esquema": round(eb, 4), "razon": round(ea / eb, 4)},
           "descripcion": "Control del foco de atención con y sin modelo interno (esquema) del propio foco.", "datos": "sintetico"}, open("salida.json", "w"))
