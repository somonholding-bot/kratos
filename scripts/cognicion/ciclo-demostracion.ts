// Ejecuta en producción un ciclo cognitivo completo de demostración (TAREA 08) y muestra sus etapas.
import { createPool } from '../../src/db.ts';
import { ejecutarCiclo } from '../../src/core/ciclo-cognitivo.ts';
const db = createPool();
const codigo = `import json, numpy as np
rng = np.random.default_rng(3); t = np.linspace(0, 10, 60); T = 20 + 60*np.exp(-0.3*t) + rng.normal(0, 0.5, t.size)
y = np.log(np.clip(T - 20, 1e-6, None)); A = np.vstack([t, np.ones_like(t)]).T; c, *_ = np.linalg.lstsq(A, y, rcond=None)
pred = 20 + np.exp(c[1] + c[0]*t); r2 = 1 - ((T-pred)**2).sum()/((T-T.mean())**2).sum()
json.dump({'metricas': {'r2': round(float(r2), 4), 'k_estimado': round(float(-c[0]), 4)}, 'datos': 'sintetico'}, open('salida.json', 'w'))`;
const r = await ejecutarCiclo(db, {
  titulo: 'Ciclo cognitivo integrado: ajuste de enfriamiento de Newton en registro simulado', criterio_exito: 'ajuste exponencial con R² > 0,95 en datos simulados',
  aceptacion: 'TAREA 08 de la expansión cognitiva: demostrar el ciclo integrado con un problema pequeño y comprobable',
  tipo_tarea: 'investigación científica: hipótesis, modelo y experimento computacional',
  capacidades: ['acd', 'dependencia:python_acd', 'dependencia:sandbox_exec'], consulta_evidencia: 'thermodynamics termodinamica heat',
  pregunta: '¿Un registro simulado de enfriamiento en aire quieto se ajusta a un decaimiento exponencial hacia la temperatura ambiente (ley de Newton)?',
  hipotesis: { titulo: 'Enfriamiento exponencial de Newton en datos simulados', enunciado: 'En un registro simulado con ruido de medida de 0,5 °C, la diferencia de temperatura con el ambiente decae exponencialmente con una sola constante k.', mecanismo: 'Convección proporcional a la diferencia de temperatura (ley de enfriamiento de Newton); el ruido es gaussiano e independiente.' },
  calculo: { codigo, metrica: 'r2' }, prediccion: { contexto: 'ciclo:enfriamiento', clave: 'r2', prior: { media: 0.97, varianza: 0.001, ruido: 0.01 } }, umbral: { op: '>', valor: 0.95 },
});
console.log(JSON.stringify({ ciclo: r.ciclo_id, estado: r.estado, resultado: r.resultado, etapas: r.etapas.map((e: any) => [e.n, e.etapa, e.responsable, e.cumple, e.dependencia_ausente ?? '']) }, null, 1));
await db.end();
