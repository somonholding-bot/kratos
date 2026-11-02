# Narración en español gratis y local con Chatterbox Multilingual (MIT). Uso:
#   ~/.local/share/kratos-media/chatterbox/bin/python scripts/media/voz.py texto.txt salida.wav [voz_referencia.wav]
# Tono calmado: poca exageración y ritmo pausado. Con una voz de referencia (10 s limpios) clona ese timbre.
import re, sys, torch, torchaudio
from chatterbox.mtl_tts import ChatterboxMultilingualTTS

src, out = sys.argv[1], sys.argv[2]
ref = sys.argv[3] if len(sys.argv) > 3 else None
text = open(src, encoding='utf-8').read().strip()
device = 'mps' if torch.backends.mps.is_available() else 'cpu'
tts = ChatterboxMultilingualTTS.from_pretrained(device=device)
# Frases de hasta ~250 caracteres: el modelo rinde mejor en trozos cortos
parts, cur = [], ''
for s in re.split(r'(?<=[.!?…])\s+', text):
    if cur and len(cur) + len(s) > 250: parts.append(cur); cur = s
    else: cur = f'{cur} {s}'.strip()
if cur: parts.append(cur)
pause = torch.zeros(1, int(tts.sr * 0.45))
wavs = []
for p in parts:
    wavs += [tts.generate(p, language_id='es', audio_prompt_path=ref, exaggeration=0.35, cfg_weight=0.3, temperature=0.7).cpu(), pause]
torchaudio.save(out, torch.cat(wavs, dim=1), tts.sr)
print(out)
