# Motor v2: renderiza un episodio entero a partir de ep1.BEATS (una escena por beat) con fondos, objetos y movimientos reutilizables.
# Uso: python anim2.py timeline.json voz.wav musica.wav|- salida.mp4 [--preview 3,10,25] [--from 0 --to 20]
import sys, json, math, random, subprocess
import numpy as np
from PIL import Image, ImageDraw, ImageFont
import animar
animar.K = 3   # lienzo 3840x2160: supersampling 1.5x frente a la salida 2560x1440
from animar import *   # primitivas, orin, put, stand, label, hallway, stars, moon, base, outro...
import importlib, os
_EP = importlib.import_module(os.environ.get('EPISODIO', 'ep1')); BEATS = _EP.BEATS
# Cada episodio tiene su propia identidad de color: LOOK = dict(nombre, hue (0-255, vuelta completa = 256), sat, val). Solo cambia los fondos; Orin y el dorado de marca no cambian.
LOOK = getattr(_EP, 'LOOK', dict(nombre='indigo', hue=0, sat=1.0, val=1.0))
if os.environ.get('LOOK'): _h, _s, _v = os.environ['LOOK'].split(','); LOOK = dict(nombre='prueba', hue=int(_h), sat=float(_s), val=float(_v))
def _look(im):
    if not (LOOK['hue'] or LOOK['sat'] != 1.0 or LOOK['val'] != 1.0): return
    h, sa, v = im.convert('HSV').split()
    h = h.point([(x + LOOK['hue']) % 256 for x in range(256)]); sa = sa.point([min(255, int(x * LOOK['sat'])) for x in range(256)]); v = v.point([min(255, int(x * LOOK['val'])) for x in range(256)])
    im.paste(Image.merge('HSV', (h, sa, v)).convert('RGB'))
FPS = 30
OW, OH = 3840, 2160   # salida 4K nativa (el lienzo ya es 3840x2160): sin reducir, YouTube sirve mejor códec y bitrate
APPLE = '/System/Library/Fonts/Apple Symbols.ttf'
_gf = {}
def gfont(sz):
    if sz not in _gf: _gf[sz] = ImageFont.truetype(APPLE, S(sz))
    return _gf[sz]
def glyph(d, ch, x, y, size, col): d.text((S(x), S(y)), ch, font=gfont(size), fill=col, anchor='mm')
PLANETS = ['\u2609', '\u263d', '\u263f', '\u2640', '\u2642', '\u2643', '\u2644']

def at(p, a): return a - p.get('at', 0.0)

# ---------- fondos ----------
def hills(d, col, yy, amp, ph=0.0, step=24):
    pts = [(x, yy + amp * math.sin(x / 170 + ph) + 0.4 * amp * math.sin(x / 61 + ph * 2)) for x in range(-20, W + 40, step)]
    poly(d, pts + [(W + 40, H), (-20, H)], col)

def bg_sky(T, t, k):
    im = base((8, 12, 38), (46, 56, 124)); d = ImageDraw.Draw(im, 'RGBA'); stars(d, T, 220, 420)
    moon(d, 1000, 160, 66, True, (252, 238, 196), (16, 22, 58)); hills(d, (22, 30, 78), 560, 36); hills(d, (12, 18, 54), 620, 26, 2.0)
    return im, d
def bg_dawn(T, t, k):
    im = base((255, 190, 150), (96, 124, 214)); d = ImageDraw.Draw(im, 'RGBA')
    sy = 470 - 40 * eo(t / 6); circ(d, 640, sy, 70, (255, 238, 180)); circ(d, 640, sy, 110, (255, 238, 180, 60))
    hills(d, (86, 78, 150), 540, 34); hills(d, (52, 52, 112), 610, 26, 1.4)
    return im, d
def bg_void(T, t, k):
    pal = {'dusk': ((20, 14, 60), (70, 44, 130), 30), 'lucid': ((22, 14, 62), (66, 42, 128), 42), 'party': ((16, 14, 56), (50, 36, 112), 18),
           'navy': ((8, 12, 36), (20, 28, 72), 0), 'dark': ((6, 6, 18), (28, 12, 46), 0)}[k.get('pal', 'dusk')]
    im = base(pal[0], pal[1]); d = ImageDraw.Draw(im, 'RGBA')
    if pal[2]:
        for j in range(24):
            a0 = math.radians(j * 15 + T * 7); a1 = a0 + math.radians(5)
            poly(d, [(640, 330), (640 + 900 * math.cos(a0), 330 + 900 * math.sin(a0)), (640 + 900 * math.cos(a1), 330 + 900 * math.sin(a1))], (255, 220, 140, pal[2]))
    stars(d, T, 190)
    if k.get('pal', 'dusk') in ('dusk', 'lucid', 'party'): pr_sigil(im, d, T, 99, dict(x=640, y=340, r=330, alpha=34, gs=34))
    return im, d
def bg_lab(T, t, k):
    im = base((8, 14, 40), (14, 24, 66)); d = ImageDraw.Draw(im, 'RGBA')
    for gx in range(0, W, 40):
        for gy in range(0, H, 40): circ(d, gx, gy, 1.2, (120, 150, 230, 50))
    return im, d
def bg_room(T, t, k):
    im = base((34, 40, 98), (30, 32, 78)); d = ImageDraw.Draw(im, 'RGBA')
    d.rectangle([0, S(600), S(W), S(H)], fill=(66, 46, 62)); line(d, (0, 600), (W, 600), 6, (46, 32, 46))
    rrect(d, 840, 70, 1160, 400, 12, (74, 90, 156)); rrect(d, 856, 86, 1144, 384, 8, (12, 20, 58)); moon(d, 1020, 220, 52, True, (252, 238, 196), (12, 20, 58))
    line(d, (1000, 86), (1000, 384), 5, (74, 90, 156)); line(d, (856, 235), (1144, 235), 5, (74, 90, 156))
    circ(d, 150, 330, 190, (255, 210, 130, 22)); circ(d, 150, 330, 110, (255, 210, 130, 30)); rrect(d, 120, 300, 180, 330, 10, (240, 190, 90)); line(d, (150, 330), (150, 600), 8, (100, 80, 70))
    return im, d
def bg_library(T, t, k):
    im = base((30, 18, 44), (12, 10, 30)); d = ImageDraw.Draw(im, 'RGBA'); rr = random.Random(11)
    for side in (0, 1):
        for row in range(5):
            y0 = 30 + row * 135; x = 20 if side == 0 else 880
            while x < (360 if side == 0 else 1260):
                w = rr.randint(14, 30); h = rr.randint(70, 108); col = rr.choice([(120, 50, 70), (60, 70, 150), (150, 110, 50), (50, 120, 110), (110, 70, 150)])
                rrect(d, x, y0 + 118 - h, x + w, y0 + 118, 3, col); x += w + 2
            d.rectangle([S(20 if side == 0 else 880), S(y0 + 118), S(380 if side == 0 else 1260), S(y0 + 126)], fill=(88, 56, 50))
    for j in range(20): circ(d, (j * 163 + T * 14) % W, (j * 97 + T * 8) % H, 2, (255, 220, 150, 120))
    return im, d
def bg_desert(T, t, k):
    im = base((8, 12, 36), (70, 46, 96)); d = ImageDraw.Draw(im, 'RGBA'); stars(d, T, 220, 400)
    for cx, s in ((300, 1.0), (520, 0.65), (900, 1.25)):
        poly(d, [(cx - 150 * s, 540), (cx, 540 - 170 * s), (cx + 150 * s, 540)], (84, 58, 96)); poly(d, [(cx, 540 - 170 * s), (cx + 150 * s, 540), (cx + 20 * s, 540)], (64, 44, 78))
    hills(d, (58, 42, 70), 560, 24); hills(d, (36, 26, 52), 625, 18, 1.0)
    return im, d
def bg_city(T, t, k):
    im = base((8, 10, 34), (60, 52, 124)); d = ImageDraw.Draw(im, 'RGBA'); stars(d, T, 200, 360)
    moon(d, 240, 130, 54, True, (252, 238, 196), (18, 20, 52)); rr = random.Random(5)
    for layer, (col, base_y) in enumerate([((26, 30, 80), 520), ((14, 16, 50), 600)]):
        x = -20
        while x < W:
            w = rr.randint(60, 120); h = rr.randint(90, 280) if layer else rr.randint(60, 200)
            rrect(d, x, base_y - h + (0 if layer else 40), x + w, 740, 4, col)
            for wy in range(int(base_y - h + 20), base_y - 6, 28):
                for wx in range(x + 10, x + w - 10, 20):
                    if rr.random() < 0.35: d.rectangle([S(wx), S(wy), S(wx + 8), S(wy + 12)], fill=(255, 226, 150, 190 if layer else 120))
            x += w + 4
    return im, d
def bg_chase(T, t, k):
    im = base((26, 12, 40), (60, 24, 70)); d = ImageDraw.Draw(im, 'RGBA'); stars(d, T, 120, 400)
    d.rectangle([0, S(600), S(W), S(H)], fill=(18, 12, 34))
    for j in range(18): circ(d, (j * 97 + T * 60) % 1400 - 60, 590 + (j % 3) * 8, 26 + (j % 4) * 8, (10, 6, 22, 120))
    return im, d
def bg_bedroom(T, t, k):
    im = base(NIGHT1, (30, 40, 96)); d = ImageDraw.Draw(im, 'RGBA'); stars(d, T, 170, 300)
    rrect(d, 770, 80, 1100, 440, 14, (74, 90, 156)); rrect(d, 788, 98, 1082, 422, 8, (12, 20, 58))
    moon(d, 950, 235, 62, True, (252, 238, 196), (12, 20, 58)); line(d, (935, 98), (935, 422), 6, (74, 90, 156)); line(d, (788, 268), (1082, 268), 6, (74, 90, 156))
    d.rectangle([0, S(560), S(W), S(H)], fill=(22, 26, 66)); rrect(d, 90, 440, 780, 575, 18, (88, 60, 54)); rrect(d, 118, 410, 330, 480, 22, (236, 232, 244))
    br = 3 * math.sin(T * 1.6); put(im, orin('closed', 'flat', armL=12, armR=12), 290, 452 + br, 0.85, rot=90)
    rrect(d, 345, 428 + br, 770, 560, 16, CLOAK_D); rrect(d, 345, 428 + br, 770, 450 + br, 12, CLOAK_L)
    rrect(d, 830, 470, 1010, 570, 12, (88, 60, 54)); rrect(d, 850, 410, 990, 462, 10, (8, 10, 28)); text(d, '3' + (':' if int(T * 2) % 2 == 0 else ' ') + '00', 920, 437, 38, TEAL)
    for j in range(3):
        u = (t * 0.5 + j / 3) % 1; text(d, 'Z', 340 + 34 * j + 20 * u, 400 - 120 * u, 26 + 12 * j, (255, 240, 205, int(230 * math.sin(u * math.pi))))
    return im, d
def bg_hall(T, t, k):
    im, d, rect = hallway(T, breathe=k.get('breathe', 0.0), water=k.get('water', False), glow=k.get('glow', 0.5))
    animar._last_rect = rect; return im, d
# Fondo generado para este episodio (imagen local en escenarios/): cámara lenta con zoom y desplazamiento, para que no se vea estático
_IMG = {}
def bg_img(T, t, k):
    cw, ch = W * K, H * K; src = k['src']
    if src not in _IMG:
        im = Image.open(src).convert('RGB'); sc = max(cw * 1.12 / im.width, ch * 1.12 / im.height)
        _IMG[src] = im.resize((round(im.width * sc), round(im.height * sc)), Image.LANCZOS)
    big = _IMG[src]; z = 1.0 + 0.06 * min(t / 7.0, 1.0)
    vw, vh = big.width / 1.12 / z, big.height / 1.12 / z
    px = (big.width - vw) * (0.5 + 0.35 * (1 if k.get('dir', 1) > 0 else -1) * (min(t / 7.0, 1.0) - 0.5)); py = (big.height - vh) * 0.5
    im = big.crop((int(px), int(py), int(px + vw), int(py + vh))).resize((cw, ch), Image.BILINEAR)
    return im, ImageDraw.Draw(im, 'RGBA')

BG = dict(sky=bg_sky, dawn=bg_dawn, void=bg_void, lab=bg_lab, room=bg_room, library=bg_library, desert=bg_desert, city=bg_city, chase=bg_chase, bedroom=bg_bedroom, hall=bg_hall)
BG['img'] = bg_img

# ---------- objetos ----------
def pr_qmark(im, d, T, a, p):
    pop = back(a / 0.4); text(d, '?', p.get('x', 640), p.get('y', 150) + 8 * math.sin(T * 2.4), int(p.get('size', 140) * pop) + 1, (*GOLD, int(255 * clamp(a / 0.2))))
def pr_hand(im, d, T, a, p):
    x, y, n = p.get('x', 640), p.get('y', 470), p.get('n', 7)
    if 'grow_at' in p and a >= p['grow_at']: n = 5 + int(min(2, (a - p['grow_at']) / 0.35 + 1))
    rrect(d, x - 240, y + 90, x + 240, y + 330, 40, CLOAK); line(d, (x - 240, y + 130), (x + 240, y + 130), 8, GOLD)
    ell(d, x, y + 30, 165, 120, IVORY); ca = p.get('count_at', -9)
    for j in range(n):
        ang = math.radians(-66 + j * (132 / max(1, n - 1))); bx, by = x + 110 * math.sin(ang), y + 30 - 96 * math.cos(ang)
        Ln = 128 - 44 * abs(math.sin(ang)) + (12 if j == n // 2 else 0); tx, ty = bx + Ln * math.sin(ang), by - Ln * math.cos(ang)
        line(d, (bx, by), (tx, ty), 40, IVORY)
        st = a - ca - j * 0.36
        if st >= 0:
            pop = back(st / 0.25); circ(d, tx, ty - 50, 22 * pop, GOLD); text(d, str(j + 1), tx, ty - 49, int(28 * pop) + 1, INK)
def pr_ripple(im, d, T, a, p):
    for j in range(3):
        u = a - j * 0.25
        if 0 < u < 1.6: r = 40 + 560 * eo(u / 1.6); d.ellipse([S(p['x'] - r), S(p['y'] - r), S(p['x'] + r), S(p['y'] + r)], outline=(*GOLD, int(220 * (1 - u / 1.6))), width=S(4))
def pr_sparkle(im, d, T, a, p):
    rr = random.Random(2)
    for j in range(26):
        ang = rr.uniform(0, 6.28); sp = rr.uniform(120, 420); r0 = (a * sp) % 520; col = rr.choice([GOLD, TEAL, (255, 255, 255)])
        circ(d, 640 + math.cos(ang) * r0, 330 + math.sin(ang) * r0 * 0.7, 3, (*col, int(230 * (1 - r0 / 520))))
def pr_confetti(im, d, T, a, p):
    rr = random.Random(3)
    for j in range(40):
        x0 = rr.uniform(60, 1220); sp = rr.uniform(70, 150); ph = rr.uniform(0, 8); col = rr.choice([GOLD, TEAL, ROSE, (255, 255, 255)])
        y = ((T * sp + ph * 90) % 800) - 40; ang = T * rr.uniform(2, 6)
        poly(d, [(x0 + 7 * math.cos(ang + q * 1.57), y + 7 * math.sin(ang + q * 1.57)) for q in range(4)], (*col, 230))
def pr_moons(im, d, T, a, p):
    for j in range(p.get('n', 7)):
        lit = a >= 0.35 * j; pop = back((a - 0.35 * j) / 0.3) if lit else 1; moon(d, p.get('x', 340) + 100 * j, p.get('y', 110), 28 * (pop if lit else 1), lit)
def pr_sleeper(im, d, T, a, p):
    rrect(d, 80, 380, 560, 480, 14, CLOAK_D); rrect(d, 100, 350, 230, 410, 18, (236, 232, 244)); put(im, orin('closed', 'flat'), 205, 395, 0.6, rot=90); rrect(d, 270, 372, 556, 480, 14, CLOAK)
    for j in range(3): d.line([(S(150), S(358 + j * 6)), (S(150 + 120 * j), S(250 - 30 * j)), (S(760), S(300 + 20 * j))], fill=(*TEAL, 170), width=S(3))
    rrect(d, 740, 190, 1170, 440, 16, (36, 44, 92)); rrect(d, 756, 206, 1154, 424, 8, (6, 12, 28))
    d.line([(S(770 + i * 3.4), S(315 + 38 * math.sin((i * 3.4 + T * 90) / 28) + 14 * math.sin((i * 3.4 + T * 130) / 9))) for i in range(112)], fill=(*TEAL, 255), width=S(3))
def pr_sci(im, d, T, a, p):
    x, y = p.get('x', 1000), p.get('y', 640); rrect(d, x - 80, y - 190, x + 80, y, 50, (236, 240, 250)); circ(d, x, y - 205, 38, IVORY)
    for sg in (-1, 1): d.ellipse([S(x + sg * 14 - 11), S(y - 215), S(x + sg * 14 + 11), S(y - 193)], outline=INK, width=S(3))
    line(d, (x - 4, y - 204), (x + 4, y - 204), 3, INK); arc_s = math.sin(T * 3) * 6; line(d, (x + 60, y - 150), (x + 120, y - 190 + arc_s), 14, (236, 240, 250)); circ(d, x + 120, y - 190 + arc_s, 9, IVORY)
def pr_timeline(im, d, T, a, p):
    items = [('1975', 'HEARNE'), ('1981', 'LABERGE'), ('2009', 'GERMANY')]; line(d, (200, 610), (1080, 610), 4, (120, 140, 220, 160))
    for j, (yr, cap) in enumerate(items[:p.get('upto', 1)]):
        x = 280 + j * 360; u = a - (0.0 if j == p['upto'] - 1 else -9); pop = back(a / 0.35) if j == p['upto'] - 1 else 1
        circ(d, x, 610, 16 * pop, GOLD); text(d, yr, x, 560, int(40 * pop) + 1, GOLD); text(d, cap, x, 660, 24, (200, 214, 255))
def pr_eye(im, d, T, a, p):
    cx, cy, rx, ry = p.get('x', 640), p.get('y', 330), 300, 130; seq = [-1, 1, -1, 1]; pos = 0.0; st = a - 0.9
    if st >= 0:
        k = min(3, int(st / 0.62)); u = eio((st - k * 0.62) / 0.28) if st < 2.48 else 1; pos = lerp(seq[k - 1] if k else 0, seq[k], u)
    pts = [(cx + rx * math.cos(q), cy - ry * math.sin(q)) for q in np.linspace(math.pi, 0, 60)]
    low = [(cx + rx * math.cos(q), cy + ry * 0.35 * math.sin(q)) for q in np.linspace(0, math.pi, 40)]
    poly(d, pts + low, (238, 200, 176)); circ(d, cx + 170 * pos, cy - 6, 78, (206, 160, 140)); circ(d, cx + 170 * pos - 20, cy - 26, 24, (222, 182, 160, 150))
    for q in np.linspace(math.pi * 0.06, math.pi * 0.94, 20): x0, y0 = cx + rx * math.cos(q), cy + ry * 0.35 * math.sin(q); line(d, (x0, y0), (x0 + 10 * math.cos(q), y0 + 30), 4, INK)
    d.arc([S(cx - rx * 0.8), S(cy - ry * 1.55), S(cx + rx * 0.8), S(cy - ry * 0.55)], 200, 340, fill=(190, 140, 124, 255), width=S(5)); d.line([(S(x), S(y)) for x, y in pts], fill=INK, width=S(7))
    text(d, 'LEFT', 200, 530, 44, GOLD if pos < -0.6 else (110, 124, 190)); text(d, 'RIGHT', 1080, 530, 44, GOLD if pos > 0.6 else (110, 124, 190))
def pr_eyes_free(im, d, T, a, p):
    label(im, 'EYES MOVE', a, 900, 300, 26, gold=True)
def pr_eeg(im, d, T, a, p):
    x0, y0, x1, y1 = p.get('box', (170, 110, 1110, 540)); rrect(d, x0, y0, x1, y1, 22, (44, 52, 104)); rrect(d, x0 + 24, y0 + 24, x1 - 24, y1 - 24, 10, (6, 12, 28))
    for gx in range(x0 + 24, x1 - 24, 56): d.line([(S(gx), S(y0 + 24)), (S(gx), S(y1 - 24))], fill=(30, 70, 80, 90), width=S(1))
    p0 = T - a; cy = (y0 + y1) / 2
    def sig(tau):
        v = 14 * math.sin(tau * 3.1) + 9 * math.sin(tau * 7.7 + 1)
        if p.get('mode') == 'signal':
            for q, sg in enumerate((-1, 1, -1, 1)): tt = tau - p0 - (0.9 + q * 0.5); v += sg * 120 * (math.tanh((tt + 0.1) * 18) - math.tanh((tt - 0.17) * 18)) / 2
        return v
    n = 300; w = x1 - x0 - 60
    d.line([(S(x0 + 30 + i * w / n), S(cy - sig(T - (n - i) * (w / n) / 95.0))) for i in range(n + 1)], fill=(*TEAL, 255), width=S(4))
def pr_brain(im, d, T, a, p):
    x, y, s = p.get('x', 640), p.get('y', 330), p.get('s', 1.0); skin = (236, 170, 190)
    for dx, dy, rx, ry in [(-50, 0, 110, 90), (50, -8, 120, 96), (0, 38, 130, 62)]: ell(d, x + dx * s, y + dy * s, rx * s, ry * s, skin)
    rrect(d, x + 40 * s, y + 80 * s, x + 80 * s, y + 130 * s, 10, (210, 140, 164))
    for cx, cy, r in [(-60, -20, 40), (10, -30, 46), (70, -10, 40), (-20, 30, 48), (50, 40, 40)]: d.arc([S(x + (cx - r) * s), S(y + (cy - r * 0.6) * s), S(x + (cx + r) * s), S(y + (cy + r * 0.6) * s)], 200, 340, fill=(206, 124, 150), width=S(4))
    on = a >= p.get('on_at', 999); gx, gy = x - 120 * s, y - 24 * s
    if on: pul = 0.75 + 0.25 * math.sin(T * 5); circ(d, gx, gy, 95 * s * pul, (*GOLD, 70)); circ(d, gx, gy, 62 * s, (*GOLD, 200)); text(d, '40 Hz', x - 120 * s, y - 150 * s, 30, GOLD)
    else: circ(d, gx, gy, 62 * s, (60, 70, 140, 170))
def pr_eyesym(im, d, T, a, p):
    if a < 0: return
    x, y = p.get('x', 640), p.get('y', 140); ell(d, x, y, 70, 38, (255, 255, 255)); circ(d, x + 10 * math.sin(T * 1.4), y, 24, TEAL); circ(d, x + 10 * math.sin(T * 1.4), y, 11, INK)
    for q in range(-3, 4): line(d, (x + q * 26, y - 54), (x + q * 34, y - 78), 3, (*GOLD, 220))
def pr_stat(im, d, T, a, p):
    pop = back(a / 0.4); text(d, p['text'], p.get('x', 640), p.get('y', 270), int(190 * pop) + 1, GOLD)
    if a > 0.5: label(im, p['sub'], a - 0.5, p.get('x', 640), p.get('y', 270) + 150, 32)
def pr_bubble(im, d, T, a, p):
    if a < 0: return
    x, y, w = p.get('x', 430), p.get('y', 190), p.get('w', 120); pop = back(a / 0.3); ww = w * pop
    rrect(d, x - ww / 2, y - 48 * pop, x + ww / 2, y + 48 * pop, 30, (248, 248, 255, 245)); poly(d, [(x - 14, y + 44), (x + 12, y + 44), (x - 4, y + 78)], (248, 248, 255, 245))
    text(d, p['text'], x, y, int(40 * pop) + 1, INK)
def pr_book(im, d, T, a, p):
    if a < 0: return
    x, y = p.get('x', 640), p.get('y', 330) + 8 * math.sin(T * 1.6); pop = back(a / 0.5)
    rrect(d, x - 150 * pop, y - 200 * pop, x + 150 * pop, y + 200 * pop, 14, (110, 36, 60)); rrect(d, x - 130 * pop, y - 180 * pop, x + 130 * pop, y + 180 * pop, 8, (*GOLD, 0))
    d.rounded_rectangle([S(x - 132 * pop), S(y - 182 * pop), S(x + 132 * pop), S(y + 182 * pop)], radius=S(8), outline=GOLD, width=S(4))
    if pop > 0.9:
        text(d, p['title'], x, y - 20, 34 if len(p['title']) > 8 else 64, GOLD); text(d, p.get('sub', ''), x, y + 70, 28, (240, 220, 170)); moon(d, x, y - 110, 26, True, GOLD, (110, 36, 60))
def pr_hexa(im, d, T, a, p):
    x, y, r = p.get('x', 640), p.get('y', 300), p.get('r', 150); rot = T * 0.25
    for sgn in (1, -1):
        pts = [(x + r * math.cos(rot + sgn * math.pi / 2 + q * 2.0944), y - sgn * 0 + r * math.sin(rot + sgn * math.pi / 2 + q * 2.0944)) for q in range(3)]
        for q in range(3): line(d, pts[q], pts[(q + 1) % 3], 5, (*GOLD, 235))
    d.ellipse([S(x - r * 1.18), S(y - r * 1.18), S(x + r * 1.18), S(y + r * 1.18)], outline=(*GOLD, 140), width=S(3)); circ(d, x, y, 12, (*GOLD, 255))
def pr_quote(im, d, T, a, p):
    if a < 0: return
    x, y = p.get('x', 640), p.get('y', 330); pop = back(a / 0.5); text(d, p['text'], x, y, int(84 * pop) + 1, GOLD); line(d, (x - 280 * pop, y + 70), (x + 280 * pop, y + 70), 4, (*GOLD, 200)); line(d, (x - 280 * pop, y - 70), (x + 280 * pop, y - 70), 4, (*GOLD, 200))
def pr_floaters(im, d, T, a, p):
    rr = random.Random(9)
    for j in range(16):
        x = rr.uniform(60, 1220) + 30 * math.sin(T * 0.8 + j); y = rr.uniform(60, 600) + 24 * math.cos(T * 0.7 + j * 2); col = rr.choice([GOLD, TEAL, ROSE, CLOAK_L]); kind = j % 3; r = rr.uniform(14, 34)
        if kind == 0: circ(d, x, y, r, (*col, 170))
        elif kind == 1: poly(d, [(x + r * math.cos(T + q * 2.09), y + r * math.sin(T + q * 2.09)) for q in range(3)], (*col, 170))
        else: rrect(d, x - r, y - r * 1.4, x + r, y + r * 1.4, 6, (*col, 170))
def pr_notebook(im, d, T, a, p):
    if a < 0: return
    x, y = p.get('x', 640), p.get('y', 470); rrect(d, x - 250, y - 140, x + 250, y + 140, 12, (96, 62, 50)); rrect(d, x - 238, y - 128, x - 4, y + 128, 6, (250, 244, 228)); rrect(d, x + 4, y - 128, x + 238, y + 128, 6, (250, 244, 228))
    for j in range(p.get('lines', 4)):
        prog = clamp((a - 0.5 * j) / 0.9); yy = y - 90 + j * 36
        if prog > 0: line(d, (x + 24, yy), (x + 24 + 190 * prog, yy + 2 * math.sin(j * 3 + a * 6) * (1 if prog < 1 else 0)), 4, (60, 70, 140, 220))
    line(d, (x - 220, y - 90), (x - 30, y - 90), 3, (200, 190, 170)); circ(d, x + 30 + 190 * clamp(a / 3), y - 70, 6, GOLD)
def pr_ring(im, d, T, a, p):
    cx, cy = p.get('x', 640), p.get('y', 300); tints = [(60, 150, 160), (170, 70, 110), (190, 140, 50), (100, 100, 190), (70, 150, 90), (150, 80, 170)]
    d.ellipse([S(cx - 380), S(cy - 135), S(cx + 380), S(cy + 135)], outline=(*GOLD, 90), width=S(2)); items = []
    for q in range(6): ang = math.radians(q * 60 + T * 9); items.append((cy + 135 * math.cos(ang), cx + 380 * math.sin(ang), q))
    for y, x, q in sorted(items): d.line([(S(cx), S(cy)), (S(x), S(y))], fill=(*GOLD, 70), width=S(2))
    for y, x, q in sorted(items): stand(im, orin('open', 'flat', tint=tints[q], armL=30, armR=30), x, y + 80, 0.36 + 0.12 * (y - 165) / 270)
def _shadow(im, T, x, g, s, xs=1.0, alpha=1.0, **kw): stand(im, orin(shadow=True, **kw), x, g, s, alpha=alpha, xs=max(0.05, abs(xs)) * (1 if xs >= 0 else -1))
def pr_shadow_far(im, d, T, a, p):
    rect = getattr(animar, '_last_rect', (500, 210, 780, 360)); ix0, iy0, ix1, iy1 = rect; fade = eo((a - 0.0) / 1.0)
    ta = p.get('turn_at', 99); xs = math.cos(clamp((a - ta) / 1.6) * math.pi) if ta < 90 else 1.0
    if ta < 0: xs = -1.0
    _shadow(im, T, (ix0 + ix1) / 2, iy1 - GY * 0.3 + 4 - 0 + 0, 0.3, xs=xs, alpha=fade)
def pr_shadow_near(im, d, T, a, p): _shadow(im, T, p.get('x', 860), 665, 1.2, alpha=eo(a / 0.8), armL=40, armR=40, mouth='flat')
def pr_shadow_big(im, d, T, a, p): _shadow(im, T, 640 + 6 * math.sin(T * 1.1), 740, 2.3, alpha=eo(a / 0.8), armL=60, armR=60, mouth='flat')
def pr_shadow_chase(im, d, T, a, p):
    sw = math.sin(T * 9.5) * 38; _shadow(im, T, 330 + 60 * math.sin(T * 0.7), 690, 2.05, armL=105, armR=105, legL=sw, legR=-sw, mouth='flat')
def pr_words(im, d, T, a, p):
    for j, w in enumerate(p['items']):
        st = a - j * p.get('every', 1.2)
        if st >= 0:
            pop = back(st / 0.4); col = (*[GOLD, ROSE, TEAL, (200, 214, 255)][j % 4], 255)
            if p.get('stack'): text(d, w, 640, 150 + j * 120, int(74 * pop) + 1, col)
            else: text(d, w, 220 + j * 280, 320 + 40 * math.sin(T * 1.5 + j), int(66 * pop) + 1, col)
def pr_house(im, d, T, a, p):
    x = p.get('x', 640); names = ['UPPER ROOMS', 'THE CELLAR', 'THE CAVE']; cols = [(120, 90, 130), (70, 60, 100), (40, 34, 64)]
    hl = -1 if p.get('hl', -9) < 0 and a < 0 else int(max(0, (a - p.get('hl', 0)) / p.get('every', 1.6))) if p.get('hl', -9) >= 0 else -1
    poly(d, [(x - 230, 150), (x, 60), (x + 230, 150)], (150, 70, 80))
    for j in range(3):
        y0 = 150 + j * 140; rrect(d, x - 230, y0, x + 230, y0 + 134, 6, cols[j]); on = (hl == j) or (hl > 2 and j == 2)
        if on: rrect(d, x - 230, y0, x + 230, y0 + 134, 6, (255, 220, 140, 70))
        text(d, names[j], x, y0 + 68, 34, GOLD if on else (190, 200, 240)); line(d, (x - 150, y0 + 100), (x - 100, y0 + 100), 4, (20, 20, 40, 120))
def pr_cycles(im, d, T, a, p):
    base_y = 520; line(d, (150, base_y), (1130, base_y), 4, (150, 170, 240, 180)); text(d, 'NIGHT', 640, base_y + 50, 28, (150, 170, 240))
    for j in range(6):
        w = 90 + j * 22; x = 160 + j * 160; hgt = 60 + j * 30; st = a - j * 0.28
        if st >= 0:
            pop = eo(st / 0.5); last = j == 5 and p.get('hl', -9) >= 0 and a >= p['hl']; rrect(d, x, base_y - hgt * pop, x + w, base_y, 10, GOLD if last else CLOAK_L)
            if last: d.rounded_rectangle([S(x - 8), S(base_y - hgt - 8), S(x + w + 8), S(base_y + 6)], radius=S(12), outline=GOLD, width=S(3))
def pr_clock(im, d, T, a, p):
    x, y = p.get('x', 1000), p.get('y', 150); rrect(d, x - 120, y - 46, x + 120, y + 46, 12, (8, 10, 28)); d.rounded_rectangle([S(x - 120), S(y - 46), S(x + 120), S(y + 46)], radius=S(12), outline=(*TEAL, 200), width=S(3)); text(d, p['text'], x, y, 54, TEAL)

def pr_sigil(im, d, T, a, p):
    x, y, r, al, gs = p.get('x', 640), p.get('y', 330), p.get('r', 300), p.get('alpha', 255), p.get('gs', 56); rot = T * 0.12
    for rr, w in ((r, 4), (r * 0.80, 2), (r * 1.08, 2)): d.ellipse([S(x - rr), S(y - rr), S(x + rr), S(y + rr)], outline=(*GOLD, int(al * 0.8)), width=S(w))
    for q in range(72):
        ang = math.radians(q * 5) - rot * 0.5; l0, l1 = r * 1.08, r * (1.15 if q % 6 == 0 else 1.12); d.line([(S(x + l0 * math.cos(ang)), S(y + l0 * math.sin(ang))), (S(x + l1 * math.cos(ang)), S(y + l1 * math.sin(ang)))], fill=(*GOLD, int(al * 0.7)), width=S(2))
    for q, ch in enumerate(PLANETS):
        ang = rot + q * 2 * math.pi / 7 - math.pi / 2; glyph(d, ch, x + r * 0.9 * math.cos(ang), y + r * 0.9 * math.sin(ang), gs, (*GOLD, al))
    pts = [(x + r * 0.8 * math.cos(rot + q * 2 * math.pi / 7), y + r * 0.8 * math.sin(rot + q * 2 * math.pi / 7)) for q in range(7)]
    for q in range(7): d.line([(S(pts[q][0]), S(pts[q][1])), (S(pts[(q + 3) % 7][0]), S(pts[(q + 3) % 7][1]))], fill=(*GOLD, int(al * 0.45)), width=S(2))
def pr_flower(im, d, T, a, p):
    x, y, r = p.get('x', 640), p.get('y', 330), p.get('r', 80); rot = T * 0.08; pop = eo(a / 0.8); al = int(p.get('alpha', 230) * pop)
    for i in range(-3, 4):
        for j in range(-3, 4):
            cx, cy = (i + j * 0.5) * r * pop, j * r * 0.8660254 * pop
            if math.hypot(cx, cy) <= 2.05 * r * pop:
                px, py = x + cx * math.cos(rot) - cy * math.sin(rot), y + cx * math.sin(rot) + cy * math.cos(rot)
                d.ellipse([S(px - r * pop), S(py - r * pop), S(px + r * pop), S(py + r * pop)], outline=(*GOLD, al), width=S(3))
    d.ellipse([S(x - 2.05 * r * pop), S(y - 2.05 * r * pop), S(x + 2.05 * r * pop), S(y + 2.05 * r * pop)], outline=(*GOLD, al), width=S(5))
def pr_ouro(im, d, T, a, p):
    x, y, r = p.get('x', 640), p.get('y', 330), p.get('r', 150); rot = T * 20; pop = eo(a / 0.7)
    for q in range(46):
        t0 = q / 46; ang = math.radians(rot + 25 + t0 * 320); w = 8 + 24 * t0
        circ(d, x + r * math.cos(ang), y + r * math.sin(ang), w * 0.5 * pop, (*(int(40 + 190 * t0), int(150 + 60 * t0), int(80)), 255))
    ang = math.radians(rot + 25 + 320); hx, hy = x + r * math.cos(ang), y + r * math.sin(ang); circ(d, hx, hy, 24 * pop, (230, 200, 90)); circ(d, hx + 6, hy - 6, 5, INK)
    d.ellipse([S(x - r * 0.7), S(y - r * 0.7), S(x + r * 0.7), S(y + r * 0.7)], outline=(*GOLD, 70), width=S(2))
def pr_eyetri(im, d, T, a, p):
    x, y, s = p.get('x', 640), p.get('y', 300), p.get('s', 1.0); pop = back(a / 0.5) * s
    for q in range(-6, 7): line(d, (x, y - 10 * pop), (x + q * 90 * pop, y - 330 * pop), 2, (*GOLD, 60))
    poly(d, [(x, y - 150 * pop), (x - 160 * pop, y + 120 * pop), (x + 160 * pop, y + 120 * pop)], (*GOLD, 40))
    for q in range(3): ang = [math.radians(-90), math.radians(30), math.radians(150)]; line(d, (x + 170 * pop * math.cos(ang[q]), y + 5 * pop + 170 * pop * math.sin(ang[q])), (x + 170 * pop * math.cos(ang[(q + 1) % 3]), y + 5 * pop + 170 * pop * math.sin(ang[(q + 1) % 3])), 6, GOLD)
    ell(d, x, y + 20 * pop, 64 * pop, 34 * pop, (255, 255, 255)); circ(d, x + 8 * math.sin(T * 1.3), y + 20 * pop, 22 * pop, TEAL); circ(d, x + 8 * math.sin(T * 1.3), y + 20 * pop, 10 * pop, INK)
def pr_card(im, d, T, a, p):
    x, y = p.get('x', 640), p.get('y', 330) + 6 * math.sin(T * 1.5); pop = back(a / 0.5)
    rrect(d, x - 150 * pop, y - 230 * pop, x + 150 * pop, y + 230 * pop, 18, (244, 232, 208)); rrect(d, x - 134 * pop, y - 214 * pop, x + 134 * pop, y + 214 * pop, 10, (20, 24, 76))
    d.rounded_rectangle([S(x - 134 * pop), S(y - 214 * pop), S(x + 134 * pop), S(y + 214 * pop)], radius=S(10), outline=GOLD, width=S(4))
    if pop > 0.9:
        text(d, 'XVIII', x, y - 185, 30, GOLD); moon(d, x, y - 40, 78, True, GOLD, (20, 24, 76)); circ(d, x + 6, y - 40, 22, (20, 24, 76)); circ(d, x + 4, y - 36, 18, (244, 232, 208, 235))
        for sg in (-1, 1): rrect(d, x + sg * 96 - 20, y + 40, x + sg * 96 + 20, y + 130, 4, (150, 140, 190)); poly(d, [(x + sg * 96 - 26, y + 40), (x + sg * 96, y + 14), (x + sg * 96 + 26, y + 40)], (150, 140, 190))
        d.arc([S(x - 70), S(y + 80), S(x + 70), S(y + 190)], 200, 340, fill=(*TEAL, 255), width=S(5)); text(d, 'THE MOON', x, y + 185, 34, GOLD)
def pr_alchemy(im, d, T, a, p):
    names = [('NIGREDO', 'THE BLACKENING', (10, 10, 18), (230, 230, 255)), ('ALBEDO', 'THE WHITENING', (240, 240, 250), INK), ('RUBEDO', 'THE REDDENING', (170, 40, 60), (255, 230, 230))]
    for j in range(p.get('n', 3)):
        st = a - j * p.get('every', 2.2)
        if st < 0: continue
        pop = back(st / 0.5); cx = 280 + j * 360; circ(d, cx, 300, 120 * pop, names[j][2]); d.ellipse([S(cx - 120 * pop), S(300 - 120 * pop), S(cx + 120 * pop), S(300 + 120 * pop)], outline=GOLD, width=S(4))
        text(d, names[j][0], cx, 470, int(44 * pop) + 1, GOLD); text(d, names[j][1], cx, 520, int(26 * pop) + 1, (200, 214, 255))
def pr_tablet(im, d, T, a, p):
    x, y = p.get('x', 640), p.get('y', 330); pop = back(a / 0.5)
    for q in range(5): d.rounded_rectangle([S(x - 300 * pop - q * 6), S(y - 150 * pop - q * 6), S(x + 300 * pop + q * 6), S(y + 150 * pop + q * 6)], radius=S(20), outline=(70, 220, 150, 40 - q * 6), width=S(4))
    rrect(d, x - 300 * pop, y - 150 * pop, x + 300 * pop, y + 150 * pop, 20, (18, 90, 70)); d.rounded_rectangle([S(x - 280 * pop), S(y - 130 * pop), S(x + 280 * pop), S(y + 130 * pop)], radius=S(12), outline=(150, 255, 210), width=S(3))
    if pop > 0.9:
        text(d, 'THE EMERALD TABLET', x, y - 90, 30, (190, 255, 225)); text(d, 'THAT WHICH IS BELOW', x, y - 10, 42, (255, 255, 255)); text(d, 'IS LIKE THAT WHICH IS ABOVE', x, y + 50, 42, (255, 255, 255))
def pr_bigtext(im, d, T, a, p):
    y = p.get('y', 330)
    for j, (txt, size) in enumerate(p['lines']):
        st = a - j * p.get('every', 0.5)
        if st >= 0: pop = back(st / 0.4); text(d, txt, 640, y + j * (size + 18), int(size * pop) + 1, (*(GOLD if j == len(p['lines']) - 1 and p.get('gold_last') else (255, 255, 255)), int(255 * clamp(st / 0.2))))

PROP = {k[3:]: v for k, v in globals().items() if k.startswith('pr_')}
PROP['shadow_near'] = pr_shadow_near

# ---------- Orin con movimientos ----------
def draw_orin(im, T, t, o):
    if o is None: return
    if isinstance(o, list):
        for q in o: draw_orin(im, T, t, q)
        return
    mv = o.get('mv'); al, ar, ll, lr = o.get('al', 16), o.get('ar', 16), o.get('ll', 6), o.get('lr', 6); y_off = 5 * math.sin(T * 2.2); rot = o.get('rot', 0); s = o.get('s', 1.0)
    if mv == 'jump': y_off = -abs(math.sin(T * 4.2)) * 34; ll, lr = 14 + 10 * math.sin(T * 8.4), 14 - 10 * math.sin(T * 8.4)
    if mv == 'run': sw = math.sin(T * 9.5) * 38; al, ar, ll, lr = 40 - sw, 40 + sw, -sw * 1.2, sw * 1.2; y_off = -abs(math.sin(T * 9.5)) * 10
    if mv == 'rub': al, ar = 18 + 6 * math.sin(T * 14), 18 - 6 * math.sin(T * 14)
    ee, mm = o.get('e', 'open'), o.get('m', 'smile')
    if o.get('e2_at') is not None and t >= o['e2_at']: ee, mm = o.get('e2', ee), o.get('m2', mm)
    blink = 1.0 if (T % 4.1) < 0.12 and ee == 'open' else 0.0
    L = orin(ee if ee != 'half' else 'open', mm, o.get('look', (0, 0)), al, ar, ll, lr, o.get('shadow', False), o.get('tint'), 0.55 if ee == 'half' else blink)
    if mv == 'fly':
        put(im, L, o.get('x', 640) + 40 * math.sin(T * 0.9), o.get('y', 300) + 22 * math.sin(T * 1.6), s, rot=-72 - 6 * math.sin(T * 1.6), flip=o.get('flip', False)); return
    stand(im, L, o.get('x', 640), o.get('g', 650) + y_off, s, rot=rot, flip=o.get('flip', False))

# ---------- escena ----------
def render_beat(bt, T, t):
    im, d = BG[bt['bg']](T, t, bt['bgk'])
    if bt['bg'] != 'img': _look(im)
    for p in bt['p']:
        if not p.get('z') and t - p.get('at', 0.0) >= 0: PROP[p['k']](im, ImageDraw.Draw(im, 'RGBA'), T, t - p.get('at', 0.0), p)
    draw_orin(im, T, t, bt['o'])
    for p in bt['p']:
        if p.get('z') and t - p.get('at', 0.0) >= 0: PROP[p['k']](im, ImageDraw.Draw(im, 'RGBA'), T, t - p.get('at', 0.0), p)
    if bt['label']: label(im, bt['label'], t - bt['lt'], 640, bt['ly'], 38, gold=bt['gold'])
    return im

_yy, _xx = np.mgrid[0:OH, 0:OW]; _r = np.sqrt(((_xx - OW / 2) / (OW / 2)) ** 2 + ((_yy - OH / 2) / (OH / 2)) ** 2)
VIG = (1.0 - 0.34 * np.clip((_r - 0.55) / 0.85, 0, 1) ** 1.6).astype(np.float32)[..., None]

import transiciones as TR

def main():
    tlf, voz, musica, out = sys.argv[1:5]
    tl = json.load(open(tlf)); LEAD = float(os.environ.get('LEAD', 0.5)); ST = [LEAD + s['start'] for s in tl['sentences']]; END_V = LEAD + tl['duration']; TOTAL = END_V + 3.0
    starts = [0.0] + [ST[i] - 0.10 for i in range(1, len(BEATS))]; ends = starts[1:] + [END_V + 0.2]
    def scene_frame(k, T):
        bt = BEATS[k]; t = T - starts[k]; dur = ends[k] - starts[k]; im = render_beat(bt, T, t)
        p = clamp(t / max(0.1, dur)); z = 1.0 + 0.06 * (p if bt['cam'] == 'in' else 1 - p); pan = (-1) ** k * 0.5
        bw, bh = S(W) / z, S(H) / z; x0 = (S(W) - bw) / 2 * (1 + pan * (1 - 2 * p) * 0.6); y0 = (S(H) - bh) / 2
        return im.resize((OW, OH), Image.LANCZOS, box=(x0, y0, x0 + bw, y0 + bh))
    def render(T):
        k = max(i for i, s in enumerate(starts) if T >= s - 1e-9); t = T - starts[k]
        frame = scene_frame(k, T)
        if k > 0 and os.environ.get('TRANS', '1') != '0':
            tipo = TR.tipo_para(k, BEATS[k - 1]['bg'], BEATS[k]['bg'], BEATS[k].get('tr'))
            if t < TR.DUR[tipo]: frame = TR.mezclar(scene_frame(k - 1, T), frame, t / TR.DUR[tipo], tipo)
        elif t < 0.14 and k > 0: frame = Image.blend(scene_frame(k - 1, T), frame, eio(t / 0.14))
        o = clamp((T - (END_V + 0.7)) / 1.0)
        if o > 0: frame = Image.blend(frame, outro(T, o).resize((OW, OH), Image.LANCZOS), eio(o))
        frame = Image.fromarray((np.asarray(frame, dtype=np.float32) * VIG).astype(np.uint8))
        fade = clamp(T / 0.8) * clamp((TOTAL - T) / 0.9)
        return Image.blend(Image.new('RGB', (OW, OH), (0, 0, 0)), frame, fade) if fade < 1 else frame
    if '--preview' in sys.argv:
        for T in [float(x) for x in sys.argv[sys.argv.index('--preview') + 1].split(',')]: render(T).save(f'/tmp/f2-{T:06.1f}.png')
        print('previews'); return
    n0, n1 = 0, int(TOTAL * FPS)
    if '--from' in sys.argv: n0 = int(float(sys.argv[sys.argv.index('--from') + 1]) * FPS); n1 = int(float(sys.argv[sys.argv.index('--to') + 1]) * FPS)
    sfx = os.environ.get('SFX'); mus = (['-i', musica] if musica != '-' else []) + (['-i', sfx] if sfx else [])
    af = (f"[1:a]adelay={int(LEAD * 1000)}|{int(LEAD * 1000)},apad[v];" +
          (f"[2:a]volume=0.42,afade=t=in:d=2,afade=t=out:st={TOTAL - 3:.2f}:d=3[m];[v]asplit=2[v1][sc];[m][sc]sidechaincompress=threshold=0.04:ratio=9:attack=20:release=700[md];[v1][md]amix=inputs=2:duration=first:normalize=0[mx];" + (f"[3:a]volume=0.8,apad[fx];[mx][fx]amix=inputs=2:duration=first:normalize=0,loudnorm=I=-14:TP=-1.5:LRA=7[a]" if os.environ.get('SFX') else "[mx]loudnorm=I=-14:TP=-1.5:LRA=7[a]")
           if musica != '-' else "[v]loudnorm=I=-14:TP=-1.5:LRA=7[a]"))
    if n0 > 0: af = af[:af.rindex('[a]')] + f'[a0];[a0]atrim=start={n0 / FPS:.3f},asetpts=PTS-STARTPTS[a]'   # tramo parcial: el audio se recorta al mismo punto
    cmd = ['ffmpeg', '-loglevel', 'error', '-y', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-s', f'{OW}x{OH}', '-r', str(FPS), '-i', '-', '-i', voz, *mus,
           '-filter_complex', af, '-map', '0:v', '-map', '[a]', '-t', f'{(n1 - n0) / FPS:.2f}', '-c:v', 'libx264', '-preset', 'medium', '-crf', '15', '-r', str(FPS), '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '192k', '-movflags', '+faststart', out]
    pr = subprocess.Popen(cmd, stdin=subprocess.PIPE)
    for n in range(n0, n1):
        pr.stdin.write(render(n / FPS).tobytes())
        if n % 240 == 0: print(f'{n}/{n1}', flush=True)
    pr.stdin.close(); pr.wait(); print('listo', out, f'{TOTAL:.1f} s')

if __name__ == '__main__': main()
