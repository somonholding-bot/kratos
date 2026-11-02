# Efectos de sonido de las transiciones y golpes, sintetizados (gratis, sin derechos). Uso: python sfx.py <timeline.json> <salida.wav> [LEAD]
# Lee las mismas escenas que el motor (ep2) para sonar justo en cada cambio; whoosh según el tipo de transición.
import sys, os, json, importlib, wave
import numpy as np
sys.path.insert(0, os.path.dirname(__file__))
from transiciones import tipo_para, DUR
SR = 44100
rng = np.random.default_rng(7)
def lp(x, a):                      # filtro paso bajo de un polo con coeficiente variable (array)
    y = np.empty_like(x); s = 0.0
    for i in range(len(x)): s += a[i] * (x[i] - s); y[i] = s
    return y
def whoosh(dur, subida=True):
    n = int(SR * dur); t = np.linspace(0, 1, n); x = rng.standard_normal(n).astype(np.float32)
    a = (0.02 + 0.5 * (t if subida else 1 - t) ** 1.5).astype(np.float32); y = lp(x, a); y -= lp(y, np.full(n, 0.01, np.float32))
    env = np.sin(np.pi * t) ** 1.6; return (y * env / (np.abs(y).max() + 1e-9) * 0.5).astype(np.float32)
def boom(dur=1.1):
    n = int(SR * dur); t = np.arange(n) / SR; f = 62 * np.exp(-t * 1.8) + 38
    return (np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-t * 3.2) * 0.9).astype(np.float32)
def shimmer(dur=0.8):
    n = int(SR * dur); t = np.arange(n) / SR; y = sum(np.sin(2 * np.pi * f * t + i) for i, f in enumerate((1568, 2093, 2637, 3136)))
    return (y / 4 * np.sin(np.pi * np.linspace(0, 1, n)) ** 2 * 0.35).astype(np.float32)
def main():
    tl = json.load(open(sys.argv[1])); out = sys.argv[2]; lead = float(sys.argv[3]) if len(sys.argv) > 3 else 0.5
    beats = importlib.import_module(os.environ.get('EPISODIO', 'ep2')).BEATS
    st = [lead + s['start'] for s in tl['sentences']]; starts = [0.0] + [st[i] - 0.10 for i in range(1, len(beats))]
    total = lead + tl['duration'] + 4; buf = np.zeros(int(SR * total), np.float32)
    def put(x, t0, g=1.0):
        i = int(t0 * SR); i = max(0, i); j = min(len(buf), i + len(x)); buf[i:j] += x[:j - i] * g
    for k in range(1, len(beats)):
        tipo = tipo_para(k, beats[k - 1]['bg'], beats[k]['bg']); d = DUR[tipo]
        if tipo == 'fade': continue
        t0 = starts[k] - 0.05
        if tipo == 'flash': put(boom(), t0 + d / 2 - 0.05, 0.8); put(whoosh(d), t0, 0.45)
        elif tipo == 'iris': put(shimmer(), t0, 0.7); put(whoosh(d, True), t0, 0.3)
        elif tipo == 'zoom': put(whoosh(d, True), t0, 0.6)
        else: put(whoosh(d, tipo == 'push'), t0, 0.5)
    pcm = (np.clip(buf, -1, 1) * 32767).astype(np.int16)
    w = wave.open(out, 'wb'); w.setnchannels(1); w.setsampwidth(2); w.setframerate(SR); w.writeframes(pcm.tobytes()); w.close(); print(out, f'{total:.1f} s')
main()
