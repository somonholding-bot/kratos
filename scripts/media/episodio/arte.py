# Arte del canal Aion (banner 2560x1440, foto de perfil 800x800 y miniatura 1280x720) con el mismo estilo del episodio.
import sys, math
from PIL import Image, ImageDraw, ImageFont, ImageFilter
import animar as A
from animar import *
from anim2 import bg_hall

def canvas(w, h, top, bot):
    a = np.linspace(0, 1, h)[:, None, None]
    arr = (np.array(top) * (1 - a) + np.array(bot) * a).astype(np.uint8)
    return Image.fromarray(np.repeat(arr, w, axis=1))

def crescent(im, cx, cy, r, off, col=(252, 238, 196)):
    L = Image.new('RGBA', im.size, (0, 0, 0, 0)); dd = ImageDraw.Draw(L)
    dd.ellipse([cx - r, cy - r, cx + r, cy + r], fill=col + (255,)); dd.ellipse([cx - r + off, cy - r - off * 0.35, cx + r + off, cy + r - off * 0.35], fill=(0, 0, 0, 0))
    im.paste(L, (0, 0), L)

def font_px(px): return ImageFont.truetype(FONT, px)

def banner(out):
    # lienzo 2560x1440; zona segura central de YouTube 1546x423 (el texto vive ahi)
    W2, H2 = 2560, 1440
    im = canvas(W2, H2, (8, 10, 34), (44, 36, 104)); d = ImageDraw.Draw(im, 'RGBA'); rr = random.Random(21)
    for _ in range(260): x, y, r = rr.uniform(0, W2), rr.uniform(0, H2), rr.uniform(1.5, 4.2); d.ellipse([x - r, y - r, x + r, y + r], fill=(255, 240, 205, rr.randint(90, 230)))
    for j in range(36):   # rayos desde la puerta de luz
        a0 = math.radians(j * 10 + 5); a1 = a0 + math.radians(3.2)
        d.polygon([(1280, 700), (1280 + 2200 * math.cos(a0), 700 + 2200 * math.sin(a0)), (1280 + 2200 * math.cos(a1), 700 + 2200 * math.sin(a1))], fill=(255, 220, 140, 20))
    # luna creciente grande a la izquierda y Orin a la derecha, fuera de la zona segura estrecha
    crescent(im, 460, 520, 200, 130)
    layer = orin('open', 'smile', armL=40, armR=40)
    L = layer.resize((int(layer.width * 1.15), int(layer.height * 1.15)), Image.LANCZOS)
    im.paste(L, (2050 - L.width // 2, 930 - L.height // 2), L)
    sh = orin(shadow=True, armL=60, armR=60, mouth='flat'); Ls = sh.resize((int(sh.width * 0.95), int(sh.height * 0.95)), Image.LANCZOS)
    im.paste(Ls, (2400 - Ls.width // 2, 980 - Ls.height // 2), Ls)
    d.text((1280, 590), 'AION', font=font_px(230), fill=GOLD, anchor='mm', stroke_width=6, stroke_fill=(20, 14, 50))
    d.text((1280, 748), 'WAKE UP INSIDE YOUR DREAMS', font=font_px(74), fill=(255, 255, 255), anchor='mm', stroke_width=4, stroke_fill=(20, 14, 50))
    d.text((1280, 832), 'LUCID DREAMING  -  JUNG  -  HERMETIC SECRETS', font=font_px(46), fill=(210, 220, 255), anchor='mm')
    d.rounded_rectangle([1020, 874, 1540, 934], radius=30, fill=(238, 188, 78)); d.text((1280, 905), 'NEW EPISODE EVERY WEEK', font=font_px(36), fill=(20, 14, 50), anchor='mm')
    d.ellipse([1180, 440, 1380, 640 - 70], outline=(*GOLD, 0))
    im.convert('RGB').save(out, 'JPEG', quality=94); print(out, im.size)

def avatar(out):
    im = canvas(800, 800, (14, 12, 52), (70, 46, 132)); d = ImageDraw.Draw(im, 'RGBA'); rr = random.Random(4)
    for _ in range(70): x, y, r = rr.uniform(0, 800), rr.uniform(0, 800), rr.uniform(1.2, 3.4); d.ellipse([x - r, y - r, x + r, y + r], fill=(255, 240, 205, rr.randint(90, 230)))
    d.ellipse([-200, 140, 560, 900], outline=(*GOLD, 0))
    # media luna dorada con el rostro de Orin
    crescent(im, 400, 380, 270, 120)
    layer = orin('open', 'smile'); crop = layer.crop((layer.width // 2 - 150 * 2 // 1 // 2 * 1, 0, layer.width // 2 + 150, int(layer.height * 0.52)))
    L = crop.resize((int(crop.width * 2.2), int(crop.height * 2.2)), Image.LANCZOS)
    im.paste(L, (400 - L.width // 2, 800 - L.height - 8), L)
    # recorte circular
    m = Image.new('L', (800, 800), 0); ImageDraw.Draw(m).ellipse([0, 0, 799, 799], fill=255); out_im = Image.new('RGB', (800, 800), (0, 0, 0)); out_im.paste(im, (0, 0), m)
    out_im.save(out, 'PNG'); print(out)

def thumb(out, lines):
    im, d = bg_hall(5.0, 5.0, dict(water=True, breathe=0.6, glow=1.0)); d = ImageDraw.Draw(im, 'RGBA')
    ix0, iy0, ix1, iy1 = A._last_rect
    sh = orin(shadow=True, mouth='flat', armL=40, armR=40); Ls = sh.resize((int(sh.width * 0.36), int(sh.height * 0.36)), Image.LANCZOS)
    im.paste(Ls, (S((ix0 + ix1) / 2) - Ls.width // 2, S(iy1 - 40) - Ls.height // 2), Ls)
    L = orin('wide', 'o', armL=40, armR=40); L = L.resize((int(L.width * 1.3), int(L.height * 1.3)), Image.LANCZOS)
    im.paste(L, (S(260) - L.width // 2, S(480) - L.height // 2), L)
    y = 150
    for txt, size, col in lines:
        f = ImageFont.truetype(FONT, S(size))
        for dx, dy in ((6, 8), (-4, 6), (0, 10)): d.text((S(975) + dx, S(y) + dy), txt, font=f, fill=(0, 0, 0, 220), anchor='mm')
        d.text((S(975), S(y)), txt, font=f, fill=col, anchor='mm', stroke_width=S(3), stroke_fill=(30, 20, 5) if col == GOLD else (10, 14, 40))
        y += size * 1.08
    im.resize((1280, 720), Image.LANCZOS).convert('RGB').save(out, 'JPEG', quality=93); print(out)

if __name__ == '__main__':
    import random, numpy as np
    banner('banner.jpg'); avatar('avatar.png'); thumb('miniatura-ep1.jpg', [('WAKE UP', 124, GOLD), ('INSIDE', 104, (255, 255, 255)), ('YOUR DREAMS', 76, (255, 255, 255))])
