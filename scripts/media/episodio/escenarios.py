# Genera los escenarios propios de un episodio (SCENES de su módulo epN.py) con un modelo de imagen abierto y local (mflux, FLUX.2 klein 4B, Apache-2.0).
# Cada episodio tiene escenarios nuevos y su propia simbología, sacados de la descripción de escena que escribió Venus. Se saltan los que ya existen.
# Uso (desde la carpeta del episodio):  EPISODIO=ep3 python escenarios.py [carpeta_salida=escenarios]
import sys, os, importlib, subprocess
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
SCENES = importlib.import_module(os.environ.get('EPISODIO', 'ep3')).SCENES
out = sys.argv[1] if len(sys.argv) > 1 else 'escenarios'
os.makedirs(out, exist_ok=True)
GEN = os.path.expanduser('~/.local/share/kratos-media/mflux/bin/mflux-generate-flux2')
for i, prompt in enumerate(SCENES):
    f = os.path.join(out, f'e{i:02d}.png')
    if os.path.exists(f): continue
    print(f'escenario {i + 1}/{len(SCENES)}', flush=True)
    r = subprocess.run([GEN, '--model', 'flux2-klein-4b', '-q', '4', '--steps', '4', '--width', '1344', '--height', '768', '--seed', str(100 + i), '--prompt', prompt, '--output', f + '.tmp.png'],
                       capture_output=True, text=True, timeout=1800)
    if r.returncode != 0 or not os.path.exists(f + '.tmp.png'): sys.exit(f'No pude generar el escenario {i}: {(r.stderr or r.stdout)[-400:]}')
    os.replace(f + '.tmp.png', f)
print('escenarios listos:', len(SCENES))
