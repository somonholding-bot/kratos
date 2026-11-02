# Narración del episodio con Kokoro (am_michael), una frase-beat cada vez, con tiempos exactos.
# Uso: python voz_episodio.py velocidad salida.wav timeline.json   (python del entorno TTS)
import sys, json, wave
import numpy as np
from kokoro_onnx import Kokoro
from ep1 import BEATS

speed, out, tl = float(sys.argv[1]), sys.argv[2], sys.argv[3]
k = Kokoro('/Users/unidad/Jarvis/.jarvis/tts/kokoro/kokoro-v1.0.onnx', '/Users/unidad/Jarvis/.jarvis/tts/kokoro/voices-v1.0.bin')
parts, timeline, t, sr, words = [], [], 0.0, 24000, 0
for i, b in enumerate(BEATS):
    a, sr = k.create(b['text'], voice='am_michael', speed=speed, lang='en-us'); a = np.asarray(a, dtype=np.float32)
    nxt_para = i + 1 < len(BEATS) and BEATS[i + 1]['para']
    gap = 0.70 if nxt_para else (0.34 if b['text'].rstrip().endswith('?') else 0.20)
    timeline.append({'i': i, 'text': b['text'], 'start': round(t, 3), 'end': round(t + len(a) / sr, 3)})
    parts += [a, np.zeros(int(sr * gap), dtype=np.float32)]; t += len(a) / sr + gap; words += len(b['text'].split())
pcm = (np.clip(np.concatenate(parts), -1, 1) * 32767).astype(np.int16)
w = wave.open(out, 'wb'); w.setnchannels(1); w.setsampwidth(2); w.setframerate(sr); w.writeframes(pcm.tobytes()); w.close()
json.dump({'sr': sr, 'duration': round(t, 3), 'sentences': timeline}, open(tl, 'w'), indent=1)
print(f'{len(BEATS)} beats, {words} palabras, {t:.1f} s ({t / 60:.2f} min), {words / (t / 60):.0f} ppm')
