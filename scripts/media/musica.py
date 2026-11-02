# Música instrumental gratis y local con ACE-Step 1.5 (MIT). Uso:
#   ~/.local/share/kratos-media/acestep/.venv/bin/python scripts/media/musica.py "descripción" segundos salida.wav
import os, sys, shutil, tempfile
ROOT = os.path.expanduser('~/.local/share/kratos-media/acestep')
sys.path.insert(0, ROOT)
from acestep.handler import AceStepHandler
from acestep.inference import GenerationParams, GenerationConfig, generate_music

caption, seconds, out = sys.argv[1], float(sys.argv[2]), os.path.abspath(sys.argv[3])
dit = AceStepHandler()
msg, ok = dit.initialize_service(project_root=ROOT, config_path='acestep-v15-turbo', device='auto')
if not ok: sys.exit(f'ACE-Step no arrancó: {msg}')
params = GenerationParams(caption=caption, lyrics='[Instrumental]', instrumental=True, duration=seconds, inference_steps=8, shift=3.0, thinking=False)
tmp = tempfile.mkdtemp()
r = generate_music(dit, None, params, GenerationConfig(batch_size=1, audio_format='wav'), save_dir=tmp)
if not r.success: sys.exit(f'Falló: {r.error}')
shutil.move(r.audios[0]['path'], out)
print(out)
