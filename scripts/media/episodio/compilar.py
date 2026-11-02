# Traduce el «paquete» de Venus (beats con texto + escena en inglés libre) a un módulo epN.py del motor de Orin.
# Uso: python compilar.py paquete.json salida/epN.py
# Solo usa fondos y elementos que el motor ya domina (copiados de ep1/ep2), para que el render no falle a mitad.
import json, re, sys

P = json.load(open(sys.argv[1]))
beats, look = P['beats'], P.get('look', {})

BG_WORDS = [  # (palabras de la escena, fondo del motor); gana la primera coincidencia
    ('bedroom|bed |night|sleep|dream', 'bedroom'), ('lab|laborator|clinic|monitor|wired|research|experiment|brain|eeg|study card', 'lab'),
    ('library|book|manuscript|archive|notebook|scroll', 'library'), ('desert|dune|pyramid|sand', 'desert'), ('city|street|market|crowd|town', 'city'),
    ('dawn|sunrise|sunset|window|garden|field|hill|mountain|sea|ocean|shore', 'dawn'), ('sky|cloud|star|moon', 'sky'),
    ('hall|corridor|cloister|arcade|chapel|temple|church|stone', 'hall'), ('room|study|table|desk|office|clock|metronome', 'room'),
]
PROP_WORDS = [  # (palabras, factoría de elemento con parámetros ya probados en ep1/ep2)
    ('ouroboros|serpent|snake|cycle', lambda: "P('ouro', x=640, y=330, r=170, at=0.0)"),
    ('flower of life|geometry|circle', lambda: "P('flower', x=640, y=330, r=90, at=0.0)"),
    ('eye|vision|sight', lambda: "P('eyetri', x=640, y=330, s=0.8, at=0.4)"),
    ('sigil|symbol|seal|glyph', lambda: "P('sigil', x=640, y=340, r=300, alpha=120, gs=44)"),
    ('tablet|emerald|inscription', lambda: "P('tablet', x=640, y=300, at=0.0)"),
    ('brain|neuro|mind', lambda: "P('brain', x=640, y=330, s=1.5, on_at=99, at=0.0)"),
    ('sparkle|glow|light|spark|candle', lambda: "P('sparkle', at=0.0)"),
    ('ripple|wave|water|fountain', lambda: "P('ripple', x=640, y=330, at=0.1)"),
]
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
last_bg, run = None, 0
for i, b in enumerate(beats):
    text = ascii_(b['texto']); scene = b.get('escena', '')
    bg = pick(BG_WORDS, scene, ['void', 'room', 'library', 'dawn', 'hall'][i % 5])
    run = run + 1 if bg == last_bg else 0; last_bg = bg
    if run >= 3: bg = ['void', 'hall', 'room', 'library'][i % 4]   # nunca más de 3 beats seguidos con el mismo fondo
    orin = "O(x=640, g=670, s=1.0, e='open', m='smile')" if re.search(r'orin|character|narrator|guide', scene.lower()) or i % 6 == 0 else 'None'
    prop = pick(PROP_WORDS, scene)
    props = f"[{prop()}]" if prop else '[]'
    lb = short_label(scene); label = f", label={json.dumps(lb)}, gold=True, ly=640" if lb else ''
    para = ', para=True' if i and i % 9 == 0 else ''
    cam = ", cam='out'" if i % 3 == 2 else ''
    out.append(f" B({json.dumps(text)}, {bg!r}, {orin}, {props}{label}, pal={PALS[i % len(PALS)]!r}{para}{cam}),")
out.append("]")
open(sys.argv[2], 'w').write('\n'.join(out) + '\n')
print(len(beats), 'beats ->', sys.argv[2])
