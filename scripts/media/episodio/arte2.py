# Miniaturas llamativas (1920x1080, texto enorme y contraste alto, un solo punto focal) con el motor HD y los símbolos esotéricos.
import os
os.environ['EPISODIO'] = 'ep2'
from anim2 import *   # fija K=3 y trae props, orin, stand, base, text...

def outlined(d, s, x, y, size, fill, stroke=(8, 6, 20), sw=7, shadow=True):
    f = font(size)
    if shadow:
        for dx, dy in ((8, 10), (5, 8)): d.text((S(x + dx), S(y + dy)), s, font=f, fill=(0, 0, 0, 200), anchor='mm', stroke_width=S(sw), stroke_fill=(0, 0, 0, 200))
    d.text((S(x), S(y)), s, font=f, fill=fill, anchor='mm', stroke_width=S(sw), stroke_fill=stroke)

def save(im, out): im.resize((1920, 1080), Image.LANCZOS).convert('RGB').save(out, 'JPEG', quality=90, optimize=True); print(out, os.path.getsize(out) // 1024, 'KB')

def glow(d, x, y, r, col, steps=14):
    for i in range(steps): rr = r * (1 - i / steps); d.ellipse([S(x - rr), S(y - rr), S(x + rr), S(y + rr)], fill=(*col, int(14 + 7 * i)))

def thumb_a(out):   # Orin + sigilo gigante
    im = base((12, 8, 44), (84, 46, 140)); d = ImageDraw.Draw(im, 'RGBA'); rr = random.Random(2)
    for j in range(28):
        a0 = math.radians(j * 12.9); a1 = a0 + math.radians(4.5); poly(d, [(380, 340), (380 + 1500 * math.cos(a0), 340 + 1500 * math.sin(a0)), (380 + 1500 * math.cos(a1), 340 + 1500 * math.sin(a1))], (255, 214, 130, 46))
    glow(d, 380, 340, 330, (255, 190, 90)); pr_flower(im, d, 5.0, 9, dict(x=380, y=340, r=120, alpha=130)); pr_sigil(im, d, 5.0, 99, dict(x=380, y=340, r=330, alpha=255, gs=62))
    for _ in range(90): circ(d, rr.uniform(0, W), rr.uniform(0, H), rr.uniform(1, 3), (255, 240, 205, rr.randint(120, 255)))
    stand(im, orin('wide', 'o', armL=70, armR=70), 380, 720, 2.15)
    outlined(d, 'WAKE UP', 905, 190, 168, GOLD); outlined(d, 'INSIDE YOUR', 905, 345, 108, (255, 255, 255)); outlined(d, 'DREAMS', 905, 490, 168, (255, 255, 255))
    pr_eyetri(im, d, 5.0, 9, dict(x=1130, y=630, s=0.62)); save(im, out)

def thumb_b(out):   # la sombra gigante
    im = base((8, 6, 28), (60, 20, 70)); d = ImageDraw.Draw(im, 'RGBA'); rr = random.Random(5)
    glow(d, 930, 330, 480, (150, 60, 190)); pr_sigil(im, d, 5.0, 99, dict(x=930, y=330, r=380, alpha=120, gs=60))
    for _ in range(80): circ(d, rr.uniform(0, W), rr.uniform(0, H), rr.uniform(1, 3), (255, 240, 205, rr.randint(100, 240)))
    stand(im, orin(shadow=True, armL=70, armR=70, mouth='flat'), 930, 900, 3.0)
    stand(im, orin('wide', 'worry', armL=40, armR=40, look=(1, -0.4)), 250, 735, 1.45)
    outlined(d, 'YOUR SHADOW', 440, 105, 120, GOLD); outlined(d, 'IS WAITING', 440, 228, 120, (255, 255, 255)); save(im, out)

def thumb_c(out):   # esoterico: tabla esmeralda + ouroboros
    im = base((6, 14, 34), (14, 44, 70)); d = ImageDraw.Draw(im, 'RGBA'); rr = random.Random(8)
    glow(d, 640, 330, 420, (60, 220, 160)); pr_ouro(im, d, 5.0, 9, dict(x=640, y=300, r=250)); pr_flower(im, d, 5.0, 9, dict(x=640, y=330, r=96, alpha=120))
    pr_tablet(im, d, 5.0, 9, dict(x=640, y=300)); pr_sigil(im, d, 5.0, 99, dict(x=640, y=330, r=420, alpha=140, gs=56))
    for _ in range(80): circ(d, rr.uniform(0, W), rr.uniform(0, H), rr.uniform(1, 3), (230, 255, 240, rr.randint(100, 240)))
    outlined(d, 'THE HERMETIC SECRET', 640, 655, 104, GOLD, sw=6); save(im, out)

if __name__ == '__main__':
    thumb_a('miniatura-A.jpg'); thumb_b('miniatura-B.jpg'); thumb_c('miniatura-C.jpg')
