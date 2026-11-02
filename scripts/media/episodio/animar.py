# Motor de animación 2D plana (Pillow + ffmpeg, gratis y local) para el piloto del canal Aion.
# Personaje original: ORIN, un soñador con capa índigo y capucha, luna creciente dorada en la frente, ojos grandes.
# Uso:  python animar.py timeline.json voz.wav musica.wav|- salida.mp4 [--preview 3,10,25]
import sys, json, math, random, subprocess, os
import numpy as np
from PIL import Image, ImageDraw, ImageFont

K, W, H, FPS = 2, 1280, 720, 24
S = lambda v: int(round(v * K))
FONT = '/System/Library/Fonts/Supplemental/DIN Alternate Bold.ttf'
_fc = {}
def font(sz):
    if sz not in _fc: _fc[sz] = ImageFont.truetype(FONT, S(sz))
    return _fc[sz]

INK, NIGHT1, NIGHT2 = (16, 18, 40), (10, 12, 34), (30, 40, 98)
GOLD, IVORY, TEAL, ROSE = (238, 188, 78), (248, 228, 204), (74, 202, 204), (228, 112, 132)
CLOAK, CLOAK_D, CLOAK_L = (56, 64, 148), (38, 44, 108), (84, 96, 186)

clamp = lambda x, a=0.0, b=1.0: max(a, min(b, x))
lerp = lambda a, b, x: a + (b - a) * x
def eo(x): x = clamp(x); return 1 - (1 - x) ** 3
def eio(x): x = clamp(x); return 3 * x * x - 2 * x ** 3
def back(x): x = clamp(x); c = 1.70158; return 1 + (c + 1) * (x - 1) ** 3 + c * (x - 1) ** 2

# ---------- primitivas ----------
def circ(d, x, y, r, f): d.ellipse([S(x - r), S(y - r), S(x + r), S(y + r)], fill=f)
def ell(d, x, y, rx, ry, f): d.ellipse([S(x - rx), S(y - ry), S(x + rx), S(y + ry)], fill=f)
def line(d, p, q, w, f):
    d.line([(S(p[0]), S(p[1])), (S(q[0]), S(q[1]))], fill=f, width=S(w)); circ(d, p[0], p[1], w / 2, f); circ(d, q[0], q[1], w / 2, f)
def poly(d, pts, f): d.polygon([(S(x), S(y)) for x, y in pts], fill=f)
def rrect(d, x0, y0, x1, y1, r, f): d.rounded_rectangle([S(x0), S(y0), S(x1), S(y1)], radius=S(r), fill=f)
def text(d, s, x, y, size, f, anchor='mm'): d.text((S(x), S(y)), s, font=font(size), fill=f, anchor=anchor)

_bg = {}
def base(top, bot):
    k = (top, bot)
    if k not in _bg:
        a = np.linspace(0, 1, S(H))[:, None, None]
        arr = (np.array(top) * (1 - a) + np.array(bot) * a).astype(np.uint8)
        _bg[k] = Image.fromarray(np.repeat(arr, S(W), axis=1))
    return _bg[k].copy()

_r = random.Random(7)
STARS = [(_r.uniform(0, W), _r.uniform(0, H), _r.uniform(0.8, 2.2), _r.uniform(0, 6.28)) for _ in range(100)]
def stars(d, T, alpha=190, ymax=H):
    for x, y, r, ph in STARS:
        if y <= ymax: circ(d, x, y, r, (255, 240, 205, int(alpha * (0.55 + 0.45 * math.sin(T * 1.7 + ph)))))

def moon(d, x, y, r, lit, col=GOLD, dark=(14, 22, 60)):
    if lit: circ(d, x, y, r, col); circ(d, x + r * 0.42, y - r * 0.18, r * 0.86, dark)
    else: d.ellipse([S(x - r), S(y - r), S(x + r), S(y + r)], outline=(120, 130, 190, 160), width=S(2.5))

# ---------- ORIN ----------
def orin(eyes='open', mouth='smile', look=(0, 0), armL=16, armR=16, legL=6, legR=6, shadow=False, tint=None, blink=0.0):
    LW, LH, ox, oy = 320, 325, 160, 175
    im = Image.new('RGBA', (S(LW), S(LH)), (0, 0, 0, 0)); d = ImageDraw.Draw(im, 'RGBA')
    cl, cd, cll = (tint or CLOAK), tuple(int(c * 0.7) for c in (tint or CLOAK)), tuple(min(255, int(c * 1.3)) for c in (tint or CLOAK))
    skin, legc, trim = IVORY, (30, 34, 74), GOLD
    if shadow: cl = cd = cll = legc = skin = (6, 6, 14); trim = (40, 40, 70)
    P = lambda x, y: (x + ox, y + oy)
    for sg, ang in ((-1, legL), (1, legR)):
        hx, hy = sg * 14, 40; a = math.radians(ang); fx, fy = hx + sg * math.sin(a) * 84, hy + math.cos(a) * 84
        line(d, P(hx, hy), P(fx, fy), 11, legc); circ(d, *P(fx, fy), 9, trim)
    ell(d, *P(0, -62), 34, 14, cl)
    poly(d, [P(-32, -66), P(32, -66), P(54, 84), P(-54, 84)], cl)
    poly(d, [P(-9, -60), P(9, -60), P(15, 84), P(-15, 84)], cd)
    line(d, P(-54, 84), P(54, 84), 6, trim)
    for sg, ang in ((-1, armL), (1, armR)):
        sx, sy = sg * 30, -58; a = math.radians(ang); hx, hy = sx + sg * math.sin(a) * 72, sy + math.cos(a) * 72
        line(d, P(sx, sy), P(hx, hy), 17, cll); circ(d, *P(hx, hy), 9.5, skin)
    circ(d, *P(0, -112), 47, cd)
    circ(d, *P(0, -107), 34, skin)
    if not shadow:
        circ(d, *P(0, -153), 8, GOLD); circ(d, *P(3, -156), 7, cd)
        circ(d, *P(-22, -96), 6, (*ROSE, 90)); circ(d, *P(22, -96), 6, (*ROSE, 90))
    eye_c = (255, 255, 255) if shadow else (255, 255, 255)
    for sg in (-1, 1):
        ex, ey = sg * 13, -110
        if eyes == 'closed':
            d.arc([S(P(ex - 8, 0)[0]), S(P(0, ey - 6)[1]), S(P(ex + 8, 0)[0]), S(P(0, ey + 8)[1])], 0, 180, fill=INK if not shadow else (255, 255, 255), width=S(3))
            continue
        rx, ry = (10, 13) if eyes == 'wide' else (8, 10.5)
        ry *= (1 - 0.9 * blink)
        if shadow: ell(d, *P(ex, ey), rx + 2, ry + 3, (255, 255, 255, 60)); ell(d, *P(ex, ey), rx, ry, (255, 255, 255))
        else:
            ell(d, *P(ex, ey), rx, ry, eye_c)
            circ(d, *P(ex + look[0] * 3.5, ey + look[1] * 3.5), 4.8 if eyes != 'wide' else 3.8, INK)
            circ(d, *P(ex + look[0] * 3.5 - 1.5, ey + look[1] * 3.5 - 2), 1.6, (255, 255, 255))
        if eyes == 'wide' and not shadow: line(d, P(ex - sg * 7, ey - 22), P(ex + sg * 8, ey - 25), 3, INK)
    mc = INK if not shadow else (255, 255, 255)
    if mouth == 'smile': d.arc([S(P(-10, 0)[0]), S(P(0, -97)[1]), S(P(10, 0)[0]), S(P(0, -82)[1])], 20, 160, fill=mc, width=S(3))
    elif mouth == 'flat': line(d, P(-7, -88), P(7, -88), 3, mc)
    elif mouth == 'o': ell(d, *P(0, -88), 5, 7, mc)
    elif mouth == 'grin': d.pieslice([S(P(-13, 0)[0]), S(P(0, -100)[1]), S(P(13, 0)[0]), S(P(0, -76)[1])], 0, 180, fill=mc); ell(d, *P(0, -81), 6, 3, (*ROSE, 255))
    elif mouth == 'worry': d.arc([S(P(-9, 0)[0]), S(P(0, -90)[1]), S(P(9, 0)[0]), S(P(0, -78)[1])], 200, 340, fill=mc, width=S(3))
    return im

def put(im, layer, x, y, scale=1.0, rot=0, flip=False, alpha=1.0, vflip=False, xs=1.0):
    L = layer
    if flip: L = L.transpose(Image.FLIP_LEFT_RIGHT)
    if vflip: L = L.transpose(Image.FLIP_TOP_BOTTOM)
    if scale != 1.0 or xs != 1.0: L = L.resize((max(1, int(L.width * scale * abs(xs))), max(1, int(L.height * scale))), Image.LANCZOS)
    if xs < 0: L = L.transpose(Image.FLIP_LEFT_RIGHT)
    if rot: L = L.rotate(rot, resample=Image.BICUBIC, expand=True)
    if alpha < 1.0: L = L.copy(); L.putalpha(L.getchannel('A').point(lambda v: int(v * alpha)))
    im.paste(L, (S(x) - L.width // 2, S(y) - L.height // 2), L)
GY = 132.5   # distancia del centro de la capa a los pies (a escala 1)
def stand(im, layer, x, ground, scale=1.0, **kw): put(im, layer, x, ground - GY * scale, scale, **kw)

def label(im, s, a, x=640, y=620, size=36, color=(255, 255, 255), gold=False):
    if a < 0: return
    f = font(size); d0 = ImageDraw.Draw(im); bb = d0.textbbox((0, 0), s, font=f); tw, th = bb[2] - bb[0], bb[3] - bb[1]
    pad = S(18); L = Image.new('RGBA', (tw + 2 * pad, th + 2 * pad + S(6)), (0, 0, 0, 0)); d = ImageDraw.Draw(L)
    d.rounded_rectangle([0, 0, L.width - 1, L.height - 1], radius=S(14), fill=(8, 12, 32, 225), outline=(*GOLD, 255) if gold else (150, 170, 255, 120), width=S(2.5))
    d.text((L.width // 2 - bb[0] // 2 - 0, L.height // 2 - S(2)), s, font=f, fill=GOLD if gold else color, anchor='mm')
    sc = back(a / 0.30) if a < 0.30 else 1.0
    L = L.resize((max(1, int(L.width * sc)), max(1, int(L.height * sc))), Image.LANCZOS)
    L.putalpha(L.getchannel('A').point(lambda v: int(v * clamp(a / 0.12))))
    im.paste(L, (S(x) - L.width // 2, S(y) - L.height // 2), L)

# ---------- escenario común ----------
def hallway(T, breathe=0.0, water=True, glow=0.5, vp=(640, 285)):
    im = base((8, 10, 30), (14, 18, 48)); d = ImageDraw.Draw(im, 'RGBA')
    s2 = 1 + 0.09 * breathe * math.sin(T * 2.4)
    iw, ih = 250 * s2, 175 * s2; cx, cy = vp
    ix0, ix1, iy0, iy1 = cx - iw / 2, cx + iw / 2, cy - ih / 2, cy + ih / 2
    poly(d, [(0, 0), (W, 0), (ix1, iy0), (ix0, iy0)], (14, 18, 52))
    poly(d, [(0, H), (W, H), (ix1, iy1), (ix0, iy1)], (28, 112, 142) if water else (26, 30, 74))
    poly(d, [(0, 0), (ix0, iy0), (ix0, iy1), (0, H)], (36, 44, 112))
    poly(d, [(W, 0), (ix1, iy0), (ix1, iy1), (W, H)], (26, 32, 92))
    for k in range(1, 8):
        f = clamp(((k + 0.25 * breathe * math.sin(T * 2.4 + k)) / 8) ** 1.7)
        for sg, e in ((-1, 0), (1, W)):
            xa = lerp(e, ix0 if sg < 0 else ix1, f)
            line(d, (xa, lerp(0, iy0, f)), (xa, lerp(H, iy1, f)), 3, (70, 84, 168, 150))
    if water:
        for k in range(10):
            f = ((k / 10 + (T * 0.12) % 0.1) ** 1.8)
            y = lerp(H, iy1, f); line(d, (lerp(0, ix0, f), y), (lerp(W, ix1, f), y), 2, (150, 220, 235, 90))
    for i in range(5): d.rectangle([S(ix0 - (5 - i) * 10 * glow), S(iy0 - (5 - i) * 8 * glow), S(ix1 + (5 - i) * 10 * glow), S(iy1 + (5 - i) * 8 * glow)], fill=(255, 226, 150, int(26 * glow)))
    d.rectangle([S(ix0), S(iy0), S(ix1), S(iy1)], fill=(255, 232, 170, int(60 + 195 * glow)))
    return im, d, (ix0, iy0, ix1, iy1)

# ---------- escenas ----------
def sc_bed(T, t, dur, A):
    im = base(NIGHT1, (30, 40, 96)); d = ImageDraw.Draw(im, 'RGBA'); stars(d, T, 170, 300)
    rrect(d, 770, 80, 1100, 440, 14, (74, 90, 156)); rrect(d, 788, 98, 1082, 422, 8, (12, 20, 58))
    moon(d, 950, 235, 62, True, (252, 238, 196), (12, 20, 58)); line(d, (935, 98), (935, 422), 6, (74, 90, 156)); line(d, (788, 268), (1082, 268), 6, (74, 90, 156))
    d.rectangle([0, S(560), S(W), S(H)], fill=(22, 26, 66))
    rrect(d, 90, 440, 780, 575, 18, (88, 60, 54)); rrect(d, 118, 410, 330, 480, 22, (236, 232, 244))
    br = 3 * math.sin(T * 1.6)
    put(im, orin('closed', 'flat', armL=12, armR=12), 290, 452 + br, 0.85, rot=90)
    rrect(d, 345, 428 + br, 770, 560, 16, CLOAK_D); rrect(d, 345, 428 + br, 770, 450 + br, 12, CLOAK_L)
    for x in (470, 600): line(d, (x, 450 + br), (x - 10, 556), 3, (30, 36, 96, 160))
    rrect(d, 830, 470, 1010, 570, 12, (88, 60, 54)); rrect(d, 850, 410, 990, 462, 10, (8, 10, 28))
    text(d, '3' + (':' if int(T * 2) % 2 == 0 else ' ') + '00', 920, 437, 38, TEAL)
    for k in range(3):
        u = (t * 0.5 + k / 3) % 1; text(d, 'Z', 340 + 34 * k + 20 * u, 400 - 120 * u, 26 + 12 * k, (255, 240, 205, int(230 * math.sin(u * math.pi))))
    label(im, '3:00 AM', A(0), 640, 640, 40, gold=True)
    return im

def sc_hall(T, t, dur, A):
    water = A(2) > -0.01
    im, d, _ = hallway(T, breathe=1.0 if A(3) > -0.01 else 0.35, water=water)
    L = orin('wide', 'o', look=(0, 0.2), armL=22, armR=22)
    stand(im, L, 640, 650, 0.95)
    if water: put(im, L, 640, 650 + GY * 0.95, 0.95, vflip=True, alpha=0.20)
    label(im, 'A HALLWAY YOU\'VE NEVER SEEN', A(1), 640, 70, 32) if A(1) >= 0 and A(2) < 0 else None
    label(im, 'THE FLOOR IS WATER', A(2), 640, 70, 36) if A(2) >= 0 and A(3) < 0 else None
    label(im, 'THE WALLS ARE BREATHING', A(3), 640, 70, 36, gold=True) if A(3) >= 0 else None
    return im

def sc_hands(T, t, dur, A):
    im = base(NIGHT1, (26, 30, 84)); d = ImageDraw.Draw(im, 'RGBA'); stars(d, T, 130)
    rrect(d, 400, 610, 880, 800, 40, CLOAK); line(d, (400, 650), (880, 650), 8, GOLD)
    ell(d, 640, 550, 165, 120, IVORY)
    n = 7; counted = lambda k: (A(5) >= 0) if k == 6 else (A(4) >= 1.2 + k * 0.36)
    for k in range(n):
        a = math.radians(-66 + k * 22); bx, by = 640 + 110 * math.sin(a), 550 - 96 * math.cos(a)
        Ln = 128 - 44 * abs(math.sin(a)) + (12 if k == 3 else 0); tx, ty = bx + Ln * math.sin(a), by - Ln * math.cos(a)
        line(d, (bx, by), (tx, ty), 40, IVORY)
        if counted(k):
            st = (A(5) if k == 6 else A(4) - 1.2 - k * 0.36); pop = back(st / 0.25)
            circ(d, tx, ty - 50, 22 * pop, GOLD); text(d, str(k + 1), tx, ty - 49, int(28 * pop) + 1, INK)
    label(im, 'SEVEN.', A(5), 640, 130, 56, gold=True)
    label(im, 'YOU COUNT THE FINGERS', A(4) - 0.6, 640, 640, 32) if 0 <= A(4) - 0.6 and A(5) < 0 else None
    return im

def sc_lucid(T, t, dur, A):
    im = base((22, 14, 62), (66, 42, 128)); d = ImageDraw.Draw(im, 'RGBA'); cx, cy = 640, 330
    for k in range(24):
        a0 = math.radians(k * 15 + T * 7); a1 = a0 + math.radians(5)
        poly(d, [(cx, cy), (cx + 900 * math.cos(a0), cy + 900 * math.sin(a0)), (cx + 900 * math.cos(a1), cy + 900 * math.sin(a1))], (255, 220, 140, 34))
    stars(d, T, 230)
    rr = A(7)
    if rr >= 0:
        for j in range(3):
            u = rr - j * 0.25
            if 0 < u < 1.6: d.ellipse([S(cx - 40 - 560 * eo(u / 1.6)), S(cy - 40 - 560 * eo(u / 1.6)), S(cx + 40 + 560 * eo(u / 1.6)), S(cy + 40 + 560 * eo(u / 1.6))], outline=(*GOLD, int(220 * (1 - u / 1.6))), width=S(4))
    bob = 6 * math.sin(T * 2.2)
    awake = A(8) >= 0
    stand(im, orin('wide' if not awake else 'open', 'o' if not awake else 'smile', look=(0, -0.2), armL=30 if not awake else 70, armR=30 if not awake else 70), 640, 640 + bob, 1.45)
    label(im, 'THAT\'S WHEN IT HITS YOU', A(6), 640, 80, 32) if A(6) >= 0 and A(7) < 0 else None
    label(im, 'YOU\'RE DREAMING', A(7), 640, 80, 40, gold=True) if A(7) >= 0 and A(8) < 0 else None
    label(im, 'AND AWAKE INSIDE IT', A(8), 640, 80, 40, gold=True) if A(8) >= 0 else None
    return im

def sc_every(T, t, dur, A):
    im = base((16, 14, 56), (50, 36, 112)); d = ImageDraw.Draw(im, 'RGBA'); stars(d, T, 210)
    for i in range(7):
        lit = A(10) >= 0.35 * i
        pop = back((A(10) - 0.35 * i) / 0.3) if lit else 1
        moon(d, 340 + 100 * i, 110, 28 * (pop if lit else 1), lit)
    rr = random.Random(3)
    for k in range(34):
        x0 = rr.uniform(60, 1220); sp = rr.uniform(70, 150); ph = rr.uniform(0, 8); col = rr.choice([GOLD, TEAL, ROSE, (255, 255, 255)])
        y = ((T * sp + ph * 90) % 800) - 40; a = T * rr.uniform(2, 6)
        poly(d, [(x0 + 7 * math.cos(a + j * 1.57), y + 7 * math.sin(a + j * 1.57)) for j in range(4)], (*col, 230))
    jump = abs(math.sin(T * 4.2)) * 34
    stand(im, orin('open', 'grin', armL=150, armR=150, legL=14 + 10 * math.sin(T * 8.4), legR=14 - 10 * math.sin(T * 8.4)), 640, 640 - jump, 1.35)
    label(im, 'CONGRATULATIONS', A(9), 640, 215, 40, gold=True) if A(9) >= 0 and A(10) < 0 else None
    label(im, 'EVERY SINGLE NIGHT', A(10), 640, 215, 40, gold=True) if A(10) >= 0 else None
    return im

def sc_end(T, t, dur, A):
    g = clamp(0.45 + 0.5 * eo(A(11) / 4))
    im, d, (ix0, iy0, ix1, iy1) = hallway(T, breathe=0.25, water=False, glow=g)
    if A(11) > 2.2:
        a = eo((A(11) - 2.2) / 1.2)
        put(im, orin(shadow=True), (ix0 + ix1) / 2, iy1 - GY * 0.2 + 6, 0.2, alpha=a)
    stand(im, orin('open', 'flat', look=(0, -0.5)), 640, 665, 0.95)
    label(im, 'WHAT LIVES AT THE END?', A(11) - 2.4, 640, 90, 40, gold=True)
    return im

def sc_stan(T, t, dur, A):
    im = base((8, 14, 40), (14, 24, 66)); d = ImageDraw.Draw(im, 'RGBA')
    for gx in range(0, W, 40):
        for gy in range(0, H, 40): circ(d, gx, gy, 1.2, (120, 150, 230, 50))
    rrect(d, 80, 380, 560, 480, 14, CLOAK_D); rrect(d, 100, 350, 230, 410, 18, (236, 232, 244))
    put(im, orin('closed', 'flat'), 205, 395, 0.6, rot=90); rrect(d, 270, 372, 556, 480, 14, CLOAK)
    for k in range(3): d.line([(S(150), S(358 + k * 6)), (S(150 + 120 * k), S(250 - 30 * k)), (S(760), S(300 + 20 * k))], fill=(*TEAL, 170), width=S(3))
    rrect(d, 740, 190, 1170, 440, 16, (36, 44, 92)); rrect(d, 756, 206, 1154, 424, 8, (6, 12, 28))
    pts = [(S(770 + i * 3.4), S(315 + 38 * math.sin((i * 3.4 + T * 90) / 28) + 14 * math.sin((i * 3.4 + T * 130) / 9))) for i in range(112)]
    d.line(pts, fill=(*TEAL, 255), width=S(3))
    cx = 1000
    rrect(d, 920, 450, 1080, 640, 50, (236, 240, 250)); circ(d, cx, 420, 0, IVORY)
    circ(d, 720 + 280, 452, 38, IVORY)
    for sg in (-1, 1): d.ellipse([S(1000 + sg * 14 - 11), S(446 - 10), S(1000 + sg * 14 + 11), S(446 + 12)], outline=INK, width=S(3))
    line(d, (1000, 450), (1000, 452), 3, INK)
    label(im, 'THE SCIENCE', A(12), 640, 100, 44, gold=True) if A(12) >= 0 and A(13) < 0 else None
    label(im, 'STANFORD  -  EARLY 1980s', A(13), 640, 100, 36, gold=True) if A(13) >= 0 else None
    label(im, 'STEPHEN LABERGE', A(13) - 2.0, 640, 640, 32) if A(13) >= 2.0 else None
    label(im, 'SLEEPING VOLUNTEERS', A(13) - 5.2, 300, 300, 28) if A(13) >= 5.2 else None
    return im

def sc_eye(T, t, dur, A):
    im = base((10, 14, 42), (20, 28, 74)); d = ImageDraw.Draw(im, 'RGBA'); stars(d, T, 120)
    cx, cy, rx, ry = 640, 330, 300, 130
    seq = [-1, 1, -1, 1]; pos = 0.0; st = A(14) - 1.0
    if st >= 0:
        k = min(3, int(st / 0.62)); u = eio((st - k * 0.62) / 0.28) if st < 2.48 else 1
        prev = seq[k - 1] if k > 0 else 0; pos = lerp(prev, seq[k], u)
    pts = [(cx + rx * math.cos(a), cy - ry * math.sin(a) * 1.0) for a in np.linspace(math.pi, 0, 60)]
    low = [(cx + rx * math.cos(a), cy + ry * 0.35 * math.sin(a)) for a in np.linspace(0, math.pi, 40)]
    poly(d, pts + [(x, y) for x, y in low], (238, 200, 176))
    circ(d, cx + 170 * pos, cy - 6, 78, (206, 160, 140)); circ(d, cx + 170 * pos - 20, cy - 26, 24, (222, 182, 160, 150))
    for a in np.linspace(math.pi * 0.06, math.pi * 0.94, 20):
        x0, y0 = cx + rx * math.cos(a), cy + ry * 0.35 * math.sin(a)
        line(d, (x0, y0), (x0 + 10 * math.cos(a), y0 + 30), 4, INK)
    d.arc([S(cx - rx * 0.8), S(cy - ry * 1.55), S(cx + rx * 0.8), S(cy - ry * 0.55)], 200, 340, fill=(190, 140, 124, 255), width=S(5))
    d.line([(S(x), S(y)) for x, y in pts], fill=INK, width=S(7))
    text(d, 'LEFT', 220, 560, 44, GOLD if pos < -0.6 else (110, 124, 190)); text(d, 'RIGHT', 1060, 560, 44, GOLD if pos > 0.6 else (110, 124, 190))
    label(im, 'LEFT  /  RIGHT  /  LEFT  /  RIGHT', A(14) - 0.4, 640, 650, 34, gold=True) if A(14) >= 0.4 else None
    label(im, 'FROM INSIDE A DREAM', A(14) - 3.0, 640, 90, 34) if A(14) >= 3.0 else None
    return im

def sc_mon(T, t, dur, A):
    im = base((8, 12, 36), (16, 22, 60)); d = ImageDraw.Draw(im, 'RGBA')
    rrect(d, 170, 110, 1110, 540, 22, (44, 52, 104)); rrect(d, 194, 134, 1086, 516, 10, (6, 12, 28))
    for gx in range(194, 1086, 56): d.line([(S(gx), S(134)), (S(gx), S(516))], fill=(30, 70, 80, 90), width=S(1))
    for gy in range(134, 516, 48): d.line([(S(194), S(gy)), (S(1086), S(gy))], fill=(30, 70, 80, 90), width=S(1))
    t0 = T - A(15)   # instante absoluto en que empieza la frase 15
    def sig(tau):
        v = 14 * math.sin(tau * 3.1) + 9 * math.sin(tau * 7.7 + 1)
        for k, sg in enumerate((-1, 1, -1, 1)):   # cuatro movimientos de ojos: izquierda, derecha, izquierda, derecha
            tt = tau - t0 - (0.9 + k * 0.5)
            v += sg * 120 * (math.tanh((tt + 0.1) * 18) - math.tanh((tt - 0.17) * 18)) / 2
        return v
    pts = [(S(210 + i * 2.7), S(325 - sig(T - (870 - i * 2.7) / 95.0))) for i in range(320)]
    d.line(pts, fill=(*TEAL, 255), width=S(4))
    label(im, 'THE SIGNAL APPEARED', A(15), 640, 600, 38, gold=True) if A(15) >= 0 and A(16) < 0 else None
    label(im, 'THEY WERE ASLEEP', A(16), 640, 600, 38) if A(16) >= 0 and A(17) < 0 else None
    label(im, 'AND THEY WERE ANSWERING', A(17), 640, 600, 38, gold=True) if A(17) >= 0 else None
    return im

def sc_jung(T, t, dur, A):
    im = base((26, 18, 66), (10, 10, 36)); d = ImageDraw.Draw(im, 'RGBA'); stars(d, T, 170)
    d.ellipse([S(640 - 380), S(300 - 135), S(640 + 380), S(300 + 135)], outline=(*GOLD, 90), width=S(2))
    tints = [(60, 150, 160), (170, 70, 110), (190, 140, 50), (100, 100, 190), (70, 150, 90), (150, 80, 170)]
    items = []
    for k in range(6):
        a = math.radians(k * 60 + T * 9); items.append((300 + 135 * math.sin(a), 640 + 380 * math.cos(a), k))
    for y, x, k in sorted(items):
        d.line([(S(640), S(300)), (S(x), S(y))], fill=(*GOLD, 70), width=S(2))
    stand(im, orin('open', 'smile'), 640, 600, 0.85)
    for y, x, k in sorted(items):
        sc = 0.36 + 0.12 * (y - 165) / 270
        stand(im, orin('open', 'flat', tint=tints[k], armL=30, armR=30), x, y + 80, sc)
    label(im, 'CARL JUNG', A(18), 640, 80, 46, gold=True)
    label(im, 'EVERY FIGURE IS PART OF YOU', A(18) - 2.6, 640, 650, 34) if A(18) >= 2.6 else None
    return im

def sc_chase(T, t, dur, A):
    im = base((26, 12, 40), (60, 24, 70)); d = ImageDraw.Draw(im, 'RGBA'); stars(d, T, 120, 400)
    d.rectangle([0, S(600), S(W), S(H)], fill=(18, 12, 34))
    for k in range(18):
        x = (k * 97 + T * 60) % 1400 - 60; circ(d, x, 590 + (k % 3) * 8, 26 + (k % 4) * 8, (10, 6, 22, 120))
    sw = math.sin(T * 9.5) * 38
    sh_x = 330 + 60 * math.sin(T * 0.7) + 40 * eo(t / 6)
    stand(im, orin(shadow=True, armL=105, armR=105, legL=sw, legR=-sw, mouth='flat'), sh_x, 690, 2.05, alpha=0.96)
    stand(im, orin('wide', 'worry', look=(-0.6, 0), armL=40 - sw, armR=40 + sw, legL=-sw * 1.2, legR=sw * 1.2), 900, 640 - abs(math.sin(T * 9.5)) * 10, 1.0)
    label(im, 'EVEN THE ONE THAT CHASES YOU', A(19), 640, 90, 34) if A(19) >= 0 and A(20) < 0 else None
    label(im, 'THE SHADOW', A(20), 640, 90, 52, gold=True) if A(20) >= 0 else None
    return im

def sc_final(T, t, dur, A):
    im, d, (ix0, iy0, ix1, iy1) = hallway(T, breathe=0.5, water=True, glow=0.85)
    turn = clamp((A(21) - 3.2) / 1.6); xs = math.cos(turn * math.pi)
    put(im, orin(shadow=True), (ix0 + ix1) / 2, iy1 - GY * 0.3 + 4, 0.3, xs=xs if abs(xs) > 0.05 else 0.05)
    L = orin('open', 'flat', look=(0, -0.4))
    stand(im, L, 640, 668, 0.95); put(im, L, 640, 668 + GY * 0.95, 0.95, vflip=True, alpha=0.22)
    if A(22) >= 0:
        a = back(A(22) / 0.5); text(d, '?', 640, 210, int(150 * a) + 1, (*GOLD, int(255 * clamp(A(22) / 0.3))))
    label(im, 'WHEN THE SHADOW TURNS AROUND', A(21) - 1.0, 640, 70, 32) if 0 <= A(21) - 1.0 and A(22) < 0 else None
    label(im, 'ASK IT ONE QUESTION', A(22), 640, 620, 44, gold=True) if A(22) >= 0 else None
    return im

SCENES = [(sc_bed, [0]), (sc_hall, [1, 2, 3]), (sc_hands, [4, 5]), (sc_lucid, [6, 7, 8]), (sc_every, [9, 10]), (sc_end, [11]),
          (sc_stan, [12, 13]), (sc_eye, [14]), (sc_mon, [15, 16, 17]), (sc_jung, [18]), (sc_chase, [19, 20]), (sc_final, [21, 22])]

def outro(T, a):
    im = base((6, 8, 24), (14, 18, 48)); d = ImageDraw.Draw(im, 'RGBA'); stars(d, T, 200)
    moon(d, 640, 290, 70, True); text(d, 'AION', 640, 440, 96, (*GOLD, 255)); return im

def main():
    tlf, voz, musica, out = sys.argv[1:5]; prev = None
    if '--preview' in sys.argv: prev = [float(x) for x in sys.argv[sys.argv.index('--preview') + 1].split(',')]
    tl = json.load(open(tlf)); LEAD = 1.4
    ST = [LEAD + s['start'] for s in tl['sentences']]; EN = [LEAD + s['end'] for s in tl['sentences']]
    END_V = LEAD + tl['duration']; TOTAL = END_V + 3.0
    starts = [0.0] + [ST[s[1][0]] - 0.12 for s in SCENES[1:]]
    N = int(TOTAL * FPS)
    def render(T):
        k = max(i for i, s in enumerate(starts) if T >= s - 1e-9)
        fn, idx = SCENES[k]; t0 = starts[k]; t1 = starts[k + 1] if k + 1 < len(starts) else TOTAL - 2.4
        A = lambda i: T - ST[i]
        im = fn(T, T - t0, t1 - t0, A)
        p = clamp((T - t0) / max(0.1, t1 - t0)); z = 1.0 + 0.055 * p + (0.0 if k % 2 else 0.0); pan = (-1) ** k * 0.5
        bw, bh = S(W) / z, S(H) / z; x0 = (S(W) - bw) / 2 * (1 + pan * (1 - 2 * p) * 0.6); y0 = (S(H) - bh) / 2
        frame = im.resize((W, H), Image.LANCZOS, box=(x0, y0, x0 + bw, y0 + bh))
        o = clamp((T - (END_V + 0.7)) / 1.0)
        if o > 0:
            f2 = outro(T, o).resize((W, H), Image.LANCZOS); frame = Image.blend(frame, f2, eio(o))
        fade = clamp(T / 0.8) * clamp((TOTAL - T) / 0.9)
        if fade < 1: frame = Image.blend(Image.new('RGB', (W, H), (0, 0, 0)), frame, fade)
        return frame
    if prev:
        for T in prev: render(T).save(f'/tmp/frame-{T:05.1f}.png')
        print('vistas previas en /tmp/frame-*.png'); return
    mus = ['-stream_loop', '-1', '-i', musica] if musica != '-' else []
    af = (f"[1:a]adelay={int(LEAD * 1000)}|{int(LEAD * 1000)},apad[v];" + (f"[2:a]volume=0.42,afade=t=in:d=2,afade=t=out:st={TOTAL - 3:.2f}:d=3[m];[v]asplit=2[v1][sc];[m][sc]sidechaincompress=threshold=0.04:ratio=9:attack=20:release=700[md];[v1][md]amix=inputs=2:duration=first:normalize=0,loudnorm=I=-14:TP=-1.5:LRA=7[a]"
          if musica != '-' else "[v]loudnorm=I=-14:TP=-1.5:LRA=7[a]"))
    cmd = ['ffmpeg', '-loglevel', 'error', '-y', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-s', f'{W}x{H}', '-r', str(FPS), '-i', '-', '-i', voz, *mus,
           '-filter_complex', af, '-map', '0:v', '-map', '[a]', '-t', f'{TOTAL:.2f}', '-c:v', 'libx264', '-preset', 'medium', '-crf', '18', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '192k', '-movflags', '+faststart', out]
    p = subprocess.Popen(cmd, stdin=subprocess.PIPE)
    for n in range(N):
        p.stdin.write(render(n / FPS).tobytes())
        if n % 120 == 0: print(f'{n}/{N}', flush=True)
    p.stdin.close(); p.wait(); print('listo', out)

if __name__ == "__main__":
    main()
