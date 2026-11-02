# Voz completa del piloto con tiempos por frase. Uso:
#   voz_piloto.py kokoro <voz> guion.txt salida.wav timeline.json     (python del entorno TTS)
#   voz_piloto.py chatterbox <A|B> guion.txt salida.wav timeline.json (python del entorno Chatterbox)
import re, sys, json, wave
import numpy as np

engine, voice, src, out, tl = sys.argv[1:6]
text = open(src).read().strip()
sents = []
for para in text.split('\n\n'):
    ss = re.split(r'(?<=[.!?])\s+', para.strip())
    sents += [(s, i == len(ss) - 1) for i, s in enumerate(ss)]   # (frase, última del párrafo)

if engine == 'kokoro':
    from kokoro_onnx import Kokoro
    k = Kokoro('/Users/unidad/Jarvis/.jarvis/tts/kokoro/kokoro-v1.0.onnx', '/Users/unidad/Jarvis/.jarvis/tts/kokoro/voices-v1.0.bin')
    def say(s): a, sr = k.create(s, voice=voice, speed=0.93, lang='en-us'); return np.asarray(a, dtype=np.float32), sr
else:
    import torch
    from chatterbox.tts import ChatterboxTTS
    m = ChatterboxTTS.from_pretrained(device='mps' if torch.backends.mps.is_available() else 'cpu')
    exag, cfg, temp = (0.40, 0.30, 0.75) if voice == 'A' else (0.65, 0.25, 0.85)
    def say(s): return m.generate(s, exaggeration=exag, cfg_weight=cfg, temperature=temp).cpu().numpy().reshape(-1).astype(np.float32), m.sr

parts, timeline, t, sr = [], [], 0.0, 24000
for i, (s, last_in_para) in enumerate(sents):
    a, sr = say(s)
    timeline.append({'i': i, 'text': s, 'start': round(t, 3), 'end': round(t + len(a) / sr, 3)})
    gap = 0.75 if last_in_para else (0.28 if s.endswith('.') else 0.36)   # pausas de narrador: más largas entre párrafos
    parts += [a, np.zeros(int(sr * gap), dtype=np.float32)]
    t += len(a) / sr + gap
pcm = (np.clip(np.concatenate(parts), -1, 1) * 32767).astype(np.int16)
w = wave.open(out, 'wb'); w.setnchannels(1); w.setsampwidth(2); w.setframerate(sr); w.writeframes(pcm.tobytes()); w.close()
json.dump({'sr': sr, 'duration': round(t, 3), 'sentences': timeline}, open(tl, 'w'), indent=1)
print(f'{engine}:{voice} {t:.1f} s, {len(sents)} frases')
