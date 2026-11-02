# Traduce el «paquete» de Venus (beats con texto + escena en inglés libre) a un módulo epN.py del motor de Orin.
# Uso: python compilar.py paquete.json salida/epN.py
# Solo usa fondos y elementos que el motor ya domina (copiados de ep1/ep2), para que el render no falle a mitad.
import json, re, sys

P = json.load(open(sys.argv[1]))
beats, look = P['beats'], P.get('look', {})

PALS = ['dusk', 'navy', 'dark', 'dusk', 'lucid']

def pick(rules, text, default=None):
    t = ' ' + text.lower() + ' '
    for pat, val in rules:
        if re.search(pat, t): return val
    return default

def ascii_(s):
    s = s.replace('’', "'").replace('“', '"').replace('”', '"').replace('/', ' per ').replace(':', ' -')
    return re.sub(r'\s+', ' ', re.sub(r"[^A-Za-z0-9 .,!?'\"-]", '', s)).strip()

def norm(x):  # sat/val del motor son multiplicadores (1.0 = igual); Venus a veces da 0-255 -> se normaliza y se acota a 0.7-1.25
    x = float(x); x = x / 128.0 if x > 3 else x
    return round(min(1.25, max(0.7, x)), 2)

def short_label(scene):  # rótulo de pantalla solo si la escena trae un año o una cifra clave (nunca indicaciones de escena)
    m = re.search(r"\b(1[0-9]{3}|20[0-9]{2})\b", scene)
    return m.group(1) if m else ''

out = [f"# Generado por compilar.py desde el paquete de Venus. No editar a mano: se regenera.",
       "from ep1 import B, O, P", f"TITLE = {json.dumps(ascii_(P['titulo']))}", f"MUSICA = {json.dumps(ascii_(look.get('musica') or 'cinematic ambient, slow strings and soft pads, warm and mysterious, no vocals'))}",
       f"LOOK = dict(nombre={json.dumps(ascii_(look.get('nombre', 'episodio')))}, hue={int(look.get('hue', 0)) % 256}, sat={norm(look.get('sat', 1.0))}, val={norm(look.get('val', 1.0))})", "", "BEATS = ["]
STYLE = ("flat 2D vector cartoon illustration background for an animated explainer, simple bold shapes, soft gradients, calm and mysterious mood, "
         "wide empty open ground across the lower third, no people, no characters, no text, no letters, no logos")
per = max(1, -(-len(beats) // 14))           # como mucho 14 escenarios por episodio (varios beats seguidos comparten uno)
groups = [list(range(i, min(i + per, len(beats)))) for i in range(0, len(beats), per)]
paleta = ', '.join(x for x in [look.get('nombre'), look.get('acento')] if x)
scenes = []
for g in groups:
    desc = re.sub(r'\b(orin|character|narrator|guide)\b[^,]*,?', '', beats[g[0]].get('escena', ''), flags=re.I).strip(' ,')
    scenes.append(ascii_(f"{STYLE}. Scene: {desc}. Color palette: {paleta}" if paleta else f"{STYLE}. Scene: {desc}"))
out.insert(5, f"SCENES = {json.dumps(scenes, indent=1)}")
for gi, g in enumerate(groups):
    for i in g:
        b = beats[i]; text = ascii_(b['texto']); scene = b.get('escena', '')
        orin = "O(x=640, g=670, s=1.0, e='open', m='smile')" if i % 3 == 0 or re.search(r'orin|character|narrator|guide', scene.lower()) else 'None'
        lb = short_label(scene); label = f", label={json.dumps(lb)}, gold=True, ly=640" if lb else ''
        para = ', para=True' if i and i % 9 == 0 else ''
        cam = ", cam='out'" if i % 3 == 2 else ''
        out.append(f" B({json.dumps(text)}, 'img', {orin}, []{label}{para}{cam}, src='escenarios/e{gi:02d}.png', dir={1 if gi % 2 == 0 else -1}),")
out.append("]")
open(sys.argv[2], 'w').write('\n'.join(out) + '\n')
print(len(beats), 'beats,', len(scenes), 'escenarios ->', sys.argv[2])
