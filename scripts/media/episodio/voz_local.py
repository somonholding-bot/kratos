# Narración del episodio con Chatterbox (local, gratis, sin créditos ni claves), una frase-beat cada vez, con los mismos tiempos/formatos que voz_elevenlabs.py.
# Con una voz de referencia (10-30 s limpios, tuya) clona ese timbre: VOZ_REF=/ruta/referencia.wav, o ~/Movies/Kratos/voz/referencia.wav si existe.
# Uso (python del entorno chatterbox):  EPISODIO=ep3 python voz_local.py voz.wav timeline.json
import sys, os, json, wave, importlib, subprocess
import numpy as np, torch
from chatterbox.mtl_tts import ChatterboxMultilingualTTS

BEATS = importlib.import_module(os.environ.get('EPISODIO', 'ep1')).BEATS[:int(os.environ.get('VOZ_MAX', 9999))]   # VOZ_MAX: solo para pruebas
out, tl = sys.argv[1:3]
ref = os.environ.get('VOZ_REF') or os.path.expanduser('~/Movies/Kratos/voz/referencia.wav')
ref = ref if os.path.exists(ref) else None
device = 'mps' if torch.backends.mps.is_available() else 'cpu'
tts = ChatterboxMultilingualTTS.from_pretrained(device=device); sr = tts.sr
print('voz:', f'clonada de {ref}' if ref else 'natural por defecto (sin voz de referencia)', flush=True)
PPM = float(os.environ.get('VOZ_PPM', 155))   # ritmo de narración objetivo (palabras por minuto): Chatterbox sale más rápido y se alarga sin cambiar el tono
def estirar(a, f):
    r = subprocess.run(['ffmpeg', '-v', 'error', '-f', 'f32le', '-ar', str(sr), '-ac', '1', '-i', '-', '-af', f'atempo={f:.4f}', '-f', 'f32le', '-'], input=a.tobytes(), capture_output=True)
    return np.frombuffer(r.stdout, dtype=np.float32).copy() if r.returncode == 0 and r.stdout else a
parts, timeline, t, words = [], [], 0.0, 0
for i, b in enumerate(BEATS):
    torch.manual_seed(1000 + i)
    chunks = []
    for piece in [b['text']] if len(b['text']) <= 250 else __import__('re').split(r'(?<=[.!?])\s+', b['text']):
        chunks.append(tts.generate(piece, language_id='en', audio_prompt_path=ref, exaggeration=0.4, cfg_weight=0.3, temperature=0.7).squeeze().cpu().numpy().astype(np.float32))
        chunks.append(np.zeros(int(sr * 0.18), dtype=np.float32))
    a = np.concatenate(chunks[:-1]) if len(chunks) > 1 else chunks[0]
    # recorta el silencio sobrante del principio y el final (los tiempos del timeline deben ser los de la voz)
    idx = np.where(np.abs(a) > 0.01)[0]
    if len(idx): a = a[max(0, idx[0] - int(sr * 0.03)): idx[-1] + int(sr * 0.08)]
    f = max(0.7, min(1.0, (len(b['text'].split()) / (PPM / 60)) and (len(a) / sr) / (len(b['text'].split()) / (PPM / 60))))
    if f < 0.98: a = estirar(a, f)
    nxt_para = i + 1 < len(BEATS) and BEATS[i + 1]['para']
    gap = 0.70 if nxt_para else (0.34 if b['text'].rstrip().endswith('?') else 0.20)
    timeline.append({'i': i, 'text': b['text'], 'start': round(t, 3), 'end': round(t + len(a) / sr, 3)})
    parts += [a, np.zeros(int(sr * gap), dtype=np.float32)]; t += len(a) / sr + gap; words += len(b['text'].split())
    print(f'{i + 1}/{len(BEATS)}', end='\r', flush=True)
pcm = (np.clip(np.concatenate(parts), -1, 1) * 32767).astype(np.int16)
w = wave.open(out, 'wb'); w.setnchannels(1); w.setsampwidth(2); w.setframerate(sr); w.writeframes(pcm.tobytes()); w.close()
json.dump({'sr': sr, 'duration': round(t, 3), 'sentences': timeline}, open(tl, 'w'), indent=1)
print(f'\n{len(BEATS)} beats, {words} palabras, {t:.1f} s ({t / 60:.2f} min), {words / (t / 60):.0f} ppm')
