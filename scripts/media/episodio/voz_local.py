# Narración del episodio, local y gratis (sin ElevenLabs, sin créditos), una frase-beat cada vez, con los mismos tiempos/formatos que voz_elevenlabs.py.
# Voz elegida por el propietario (2-nov-2026): Kokoro «bm_george» (británica, tono de narrador de documental).
# Si algún día quiere su propia voz: VOZ_MOTOR=chatterbox con una referencia de 10-30 s en ~/Movies/Kratos/voz/referencia.wav (o VOZ_REF=ruta).
# Uso:  EPISODIO=ep3 python voz_local.py voz.wav timeline.json     (python del entorno .jarvis/tts/venv; con chatterbox, el de kratos-media/chatterbox)
import sys, os, json, wave, re, importlib
import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__)); sys.path.insert(0, HERE)
BEATS = importlib.import_module(os.environ.get('EPISODIO', 'ep1')).BEATS[:int(os.environ.get('VOZ_MAX', 9999))]   # VOZ_MAX: solo para pruebas
out, tl = sys.argv[1:3]
MOTOR = os.environ.get('VOZ_MOTOR', 'kokoro')
VOZ = os.environ.get('VOZ_KOKORO', 'bm_george'); VELOCIDAD = float(os.environ.get('VOZ_VELOCIDAD', 0.92))

if MOTOR == 'kokoro':
    from kokoro_onnx import Kokoro
    d = os.environ.get('KOKORO_DIR') or os.path.join(HERE, '../../../.jarvis/tts/kokoro')
    k = Kokoro(os.path.join(d, 'kokoro-v1.0.onnx'), os.path.join(d, 'voices-v1.0.bin'))
    sr = 24000
    def say(text, i):
        a, s = k.create(text, voice=VOZ, speed=VELOCIDAD, lang='en-gb' if VOZ[0] == 'b' else 'en-us')
        return np.asarray(a, dtype=np.float32)
    print(f'voz: Kokoro {VOZ} (velocidad {VELOCIDAD})', flush=True)
else:
    import torch
    from chatterbox.mtl_tts import ChatterboxMultilingualTTS
    ref = os.environ.get('VOZ_REF') or os.path.expanduser('~/Movies/Kratos/voz/referencia.wav'); ref = ref if os.path.exists(ref) else None
    tts = ChatterboxMultilingualTTS.from_pretrained(device='mps' if torch.backends.mps.is_available() else 'cpu'); sr = tts.sr
    def say(text, i):
        torch.manual_seed(1000 + i)
        return tts.generate(text, language_id='en', audio_prompt_path=ref, exaggeration=0.7, cfg_weight=0.2, temperature=0.9).squeeze().cpu().numpy().astype(np.float32)
    print('voz: Chatterbox', f'clonada de {ref}' if ref else 'por defecto', flush=True)

parts, timeline, t, words = [], [], 0.0, 0
for i, b in enumerate(BEATS):
    pieces = [b['text']] if len(b['text']) <= 300 else re.split(r'(?<=[.!?])\s+', b['text'])
    a = np.concatenate([x for p in pieces for x in (say(p, i), np.zeros(int(sr * 0.18), dtype=np.float32))][:-1])
    nxt_para = i + 1 < len(BEATS) and BEATS[i + 1]['para']
    gap = 0.70 if nxt_para else (0.34 if b['text'].rstrip().endswith('?') else 0.20)
    timeline.append({'i': i, 'text': b['text'], 'start': round(t, 3), 'end': round(t + len(a) / sr, 3)})
    parts += [a, np.zeros(int(sr * gap), dtype=np.float32)]; t += len(a) / sr + gap; words += len(b['text'].split())
    print(f'{i + 1}/{len(BEATS)}', end='\r', flush=True)
pcm = (np.clip(np.concatenate(parts), -1, 1) * 32767).astype(np.int16)
w = wave.open(out, 'wb'); w.setnchannels(1); w.setsampwidth(2); w.setframerate(sr); w.writeframes(pcm.tobytes()); w.close()
json.dump({'sr': sr, 'duration': round(t, 3), 'sentences': timeline}, open(tl, 'w'), indent=1)
print(f'\n{len(BEATS)} beats, {words} palabras, {t:.1f} s ({t / 60:.2f} min), {words / (t / 60):.0f} ppm')
