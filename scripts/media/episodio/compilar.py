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
# Atención: Orin se mueve por la escena y cada beat lleva un símbolo esotérico real, seres de color y destellos (ver docs/guia-atencion.md)
SYMS = [  # (patrón sobre texto+escena, objeto del motor, parámetros)
    (r'pentagram|occult|ritual|magic|spell|witch|protect|sigil|invok', 'pentagram', dict(r=175, col=(255, 70, 60))),
    (r'hermes|hermetic|above|below|emerald|solomon|kybalion|mirror|reflect', 'hexa', dict(r=165)),
    (r'cycle|loop|again|repeat|serpent|snake|infinit|ouroboros|return|spiral', 'ouro', dict(r=150)),
    (r'\beye|watch|aware|awake|observe|notice|conscious|lucid|attention|wake', 'eyetri', dict(s=1.1)),
    (r'geometr|pattern|creation|universe|sacred|unity|whole|mandala|center|self\b', 'flower', dict(r=70)),
    (r'moon|planet|saturn|mars|venus|jupiter|mercury|zodiac|astro|star|night|sky', 'sigil', dict(r=190, alpha=210)),
    (r'nigredo|albedo|rubedo', 'alchemy', dict(n=3, every=1.3)),
    (r'tarot|card|fate|destiny|future|predict|choose|choice|door', 'card', dict()),
    (r'\blife\b|egypt|ankh|breath|health|heart|body|sleep', 'ankh', dict(r=125)),
    (r'fire|burn|flame|candle|heat|energy|power|passion|courage', 'trinity_flame', dict()),
    (r'brain|neuro|\brem\b|science|study|data|research|experiment|percent|%', 'brain', dict()),
]
BEINGS = [  # seres de color: tensión y miedo → rojo; energía y creación → naranja; misterio → violeta
    (r'shadow|fear|nightmare|dark|monster|danger|chase|anxiety|threat|trap|afraid|panic|demon|enemy', 'red'),
    (r'energy|passion|creat|courage|warrior|sun\b|fire|power|rage|anger', 'orange'),
    (r'secret|hidden|unknown|mystery|strange|ghost|spirit|guide|wise|ancient', 'violet'),
]
DEFAULT = ['sigil', 'flower', 'hexa', 'eyetri', 'ouro', 'pentagram', 'card', 'ankh', 'trinity_flame']
FLASH = [(255, 70, 40), (255, 160, 30), (200, 60, 255), (40, 200, 255)]
def props_for(i, blob, side):
    out = []; kind = None; kw = {}
    for pat, k, par in SYMS:
        if re.search(pat, blob): kind, kw = k, par; break
    if kind is None: kind, kw = DEFAULT[i % len(DEFAULT)], {}
    base = dict(x=950 if side > 0 else 330, y=300, at=0.15); base.update(kw)
    out.append(f"P({kind!r}, " + ', '.join(f"{k}={v!r}" for k, v in base.items()) + ")")
    for pat, col in BEINGS:
        if re.search(pat, blob) and i % 2 == 0:
            out.append(f"P('being', x={300 if side > 0 else 980}, y=330, s=1.7, col={col!r}, at=0.4, flip={side < 0})"); break
    if i % 4 == 1: out.append(f"P('burst', x=640, y=330, col={FLASH[(i // 4) % 4]!r}, at=0.0)")
    if re.search(r'fire|burn|flame|candle', blob): out.append("P('flames', y=700, at=0.2)")
    return out
for gi, g in enumerate(groups):
    for i in g:
        b = beats[i]; text = ascii_(b['texto']); scene = b.get('escena', ''); blob = (b['texto'] + ' ' + scene).lower(); side = 1 if i % 2 == 0 else -1
        q = text.rstrip().endswith('?'); fear = bool(re.search(r'fear|panic|chase|run|escape|danger|nightmare|afraid', blob))
        if q: orin = "O(x=640, s=1.15, e='wide', m='o', look=(0, -0.5))"
        elif fear: orin = f"O(x={300 if side > 0 else 980}, s=1.2, e='wide', m='o', mv='run', vx={230 * side})"
        elif text.rstrip().endswith('!'): orin = f"O(x={420 if side > 0 else 860}, s=1.1, e='open', m='smile', mv='jump')"
        elif re.search(r'fly|float|rise|soar|sky|lucid', blob) and i % 3 == 0: orin = "O(x=640, y=330, s=1.0, e='open', m='smile', mv='fly')"
        else: orin = f"O(x={260 if side > 0 else 1020}, s=1.2, e='open', m='smile', mv='walk', vx={92 * side})"
        pr = props_for(i, blob, side)
        if any(x.startswith("P('alchemy'") for x in pr): orin = 'None'
        if q: pr.append("P('qmark', x=640, y=130, at=0.5)")
        lb = short_label(scene); label = f", label={json.dumps(lb)}, gold=True, ly=640" if lb else ''
        para = ', para=True' if i and i % 9 == 0 else ''
        cam = ", cam='out'" if i % 3 == 2 else ''
        flash = f", flash={FLASH[(i // 5) % 4]!r}" if i % 5 == 0 else ''
        out.append(f" B({json.dumps(text)}, 'img', {orin}, [{', '.join(pr)}]{label}{para}{cam}, src='escenarios/e{gi:02d}.png', dir={1 if gi % 2 == 0 else -1}{flash}),")
out.append("]")
open(sys.argv[2], 'w').write('\n'.join(out) + '\n')
print(len(beats), 'beats,', len(scenes), 'escenarios ->', sys.argv[2])
