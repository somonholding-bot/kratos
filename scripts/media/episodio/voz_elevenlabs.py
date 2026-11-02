# Narración del episodio con ElevenLabs (voz realista), una frase-beat cada vez, con los mismos tiempos/formatos que voz_episodio.py.
# Sin dependencias (solo la librería estándar). La clave está en el Llavero («kratos-elevenlabs», ver scripts/conectar-elevenlabs.sh).
# Uso:
#   EPISODIO=ep2 python voz_elevenlabs.py --listar                       # voces disponibles en tu cuenta
#   EPISODIO=ep2 python voz_elevenlabs.py --estimar                      # caracteres y créditos que costaría, sin llamar a nada
#   EPISODIO=ep2 python voz_elevenlabs.py "Brian" voz.wav timeline.json  # genera (voz por nombre o id)
import sys, os, json, wave, subprocess, urllib.request, urllib.error, importlib
import numpy as np

BEATS = importlib.import_module(os.environ.get('EPISODIO', 'ep1')).BEATS
MODEL = os.environ.get('EL_MODEL', 'eleven_v4')   # Eleven v4 (el más expresivo, límite 10.000 caracteres); alternativas: eleven_multilingual_v2, eleven_v3 (5.000)
SETTINGS = dict(stability=float(os.environ.get('EL_STABILITY', 0.45)), similarity_boost=0.80, style=float(os.environ.get('EL_STYLE', 0.35)), use_speaker_boost=True)

def key():
    r = subprocess.run(['security', 'find-generic-password', '-s', 'kratos-elevenlabs', '-a', 'api_key', '-w'], capture_output=True, text=True)
    if r.returncode != 0 or not r.stdout.strip(): sys.exit('Falta la clave de ElevenLabs: ejecuta scripts/conectar-elevenlabs.sh')
    return r.stdout.strip()

def call(path, body=None, k=None, raw=False):
    req = urllib.request.Request('https://api.elevenlabs.io' + path, data=json.dumps(body).encode() if body is not None else None, headers={'xi-api-key': k or key(), 'content-type': 'application/json'})
    try:
        with urllib.request.urlopen(req, timeout=120) as r: return r.read() if raw else json.loads(r.read())
    except urllib.error.HTTPError as e: sys.exit(f'ElevenLabs respondió {e.code}: {e.read().decode()[:300]}')

if '--estimar' in sys.argv:
    chars = sum(len(b['text']) for b in BEATS); print(f'{len(BEATS)} frases, {chars} caracteres = ~{chars} créditos (multilingual_v2/v3: 1 crédito por carácter; Flash: 0,5).'); sys.exit()
if '--listar' in sys.argv:
    for v in call('/v1/voices')['voices']:
        lab = v.get('labels', {}); print(f"{v['name']:<22} {v['voice_id']}  {v.get('category', ''):<10} {lab.get('gender', '')} {lab.get('age', '')} {lab.get('accent', '')} {lab.get('use_case', '') or lab.get('descriptive', '')}")
    sys.exit()

voice, out, tl = sys.argv[1:4]
k = key()
if len(voice) < 18:   # nombre → id
    match = [v for v in call('/v1/voices', k=k)['voices'] if v['name'].lower().startswith(voice.lower())]
    if not match: sys.exit(f'No encuentro la voz «{voice}». Usa --listar.')
    voice = match[0]['voice_id']
parts, timeline, t, sr, words = [], [], 0.0, 24000, 0
for i, b in enumerate(BEATS):
    body = dict(text=b['text'], model_id=MODEL, voice_settings=SETTINGS)
    if MODEL != 'eleven_v3':   # continuidad de entonación entre frases
        if i: body['previous_text'] = BEATS[i - 1]['text'][-250:]
        if i + 1 < len(BEATS): body['next_text'] = BEATS[i + 1]['text'][:250]
    pcm = call(f'/v1/text-to-speech/{voice}?output_format=pcm_24000', body, k, raw=True)
    a = np.frombuffer(pcm, dtype='<i2').astype(np.float32) / 32768.0
    nxt_para = i + 1 < len(BEATS) and BEATS[i + 1]['para']
    gap = 0.70 if nxt_para else (0.34 if b['text'].rstrip().endswith('?') else 0.20)
    timeline.append({'i': i, 'text': b['text'], 'start': round(t, 3), 'end': round(t + len(a) / sr, 3)})
    parts += [a, np.zeros(int(sr * gap), dtype=np.float32)]; t += len(a) / sr + gap; words += len(b['text'].split())
    print(f'{i + 1}/{len(BEATS)}', end='\r', flush=True)
pcm = (np.clip(np.concatenate(parts), -1, 1) * 32767).astype(np.int16)
w = wave.open(out, 'wb'); w.setnchannels(1); w.setsampwidth(2); w.setframerate(sr); w.writeframes(pcm.tobytes()); w.close()
json.dump({'sr': sr, 'duration': round(t, 3), 'sentences': timeline}, open(tl, 'w'), indent=1)
print(f'\n{len(BEATS)} beats, {words} palabras, {t:.1f} s ({t / 60:.2f} min), {words / (t / 60):.0f} ppm')
