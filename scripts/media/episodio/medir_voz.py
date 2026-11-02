# Mide una narración con datos objetivos: velocidad, inteligibilidad (transcripción local), expresividad de tono y estructura de pausas.
# Uso: python medir_voz.py "texto original" a.wav b.wav ...   (el texto se usa para el error de palabras; "-" = no comparar)
import sys, re, json, subprocess, urllib.request, numpy as np, librosa

def wer(ref, hyp):
    n = lambda s: re.findall(r"[a-z']+", s.lower().replace('a m', 'am').replace('nineteen eighties', '1980s'))
    r, h = n(ref), n(hyp)
    d = np.zeros((len(r) + 1, len(h) + 1), dtype=int); d[:, 0] = range(len(r) + 1); d[0, :] = range(len(h) + 1)
    for i in range(1, len(r) + 1):
        for j in range(1, len(h) + 1):
            d[i, j] = min(d[i-1, j] + 1, d[i, j-1] + 1, d[i-1, j-1] + (r[i-1] != h[j-1]))
    return d[-1, -1] / max(1, len(r))

def transcribe(path):
    subprocess.run(['ffmpeg', '-loglevel', 'error', '-y', '-i', path, '-ar', '16000', '-ac', '1', '/tmp/_m16.wav'], check=True)
    out = subprocess.run(['curl', '-sf', 'http://127.0.0.1:7432/inference', '-F', 'file=@/tmp/_m16.wav', '-F', 'language=en', '-F', 'response_format=text'], capture_output=True, text=True).stdout
    return out.strip()

ref_text = sys.argv[1]
print(f"{'voz':26} {'seg':>5} {'ppm':>4} {'error':>6} {'tono Hz':>8} {'variación st':>12} {'pausas':>6} {'pausa media':>11}")
for p in sys.argv[2:]:
    y, sr = librosa.load(p, sr=16000)
    dur = len(y) / sr
    hyp = transcribe(p)
    words = len(re.findall(r"[A-Za-z']+", hyp))
    f0, vf, _ = librosa.pyin(y, fmin=65, fmax=330, sr=sr, frame_length=1024)
    f = f0[~np.isnan(f0)]
    st = 12 * np.log2(f / np.median(f)) if len(f) else np.array([0.0])
    iv = librosa.effects.split(y, top_db=32, frame_length=1024, hop_length=256)
    gaps = [(iv[i + 1][0] - iv[i][1]) / sr for i in range(len(iv) - 1)]
    longp = [g for g in gaps if g >= 0.25]
    print(f"{p.split('/')[-1][:26]:26} {dur:5.1f} {words / (dur / 60):4.0f} {('-' if ref_text == '-' else f'{wer(ref_text, hyp) * 100:.0f}%'):>6} {np.median(f) if len(f) else 0:8.0f} {np.std(st):12.2f} {len(longp):6d} {(np.mean(longp) if longp else 0):10.2f}s")
