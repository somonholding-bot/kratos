# Miniatura de YouTube: imagen de fondo + texto grande dorado con sombra, legible en móvil.
# Uso: python miniatura.py fondo.png "Texto" salida.jpg [horizontal|vertical]
import sys, textwrap
from PIL import Image, ImageDraw, ImageFilter, ImageFont, ImageEnhance

src, text, out = sys.argv[1], sys.argv[2], sys.argv[3]
vertical = len(sys.argv) > 4 and sys.argv[4] == 'vertical'
W, H = (1080, 1920) if vertical else (1280, 720)
img = Image.open(src).convert('RGB')
s = max(W / img.width, H / img.height)
img = img.resize((round(img.width * s), round(img.height * s)), Image.LANCZOS)
img = img.crop(((img.width - W) // 2, (img.height - H) // 2, (img.width - W) // 2 + W, (img.height - H) // 2 + H))
img = ImageEnhance.Contrast(img).enhance(1.15)
# Degradado oscuro en la parte del texto para que se lea
shade = Image.new('L', (W, H), 0)
d = ImageDraw.Draw(shade)
for y in range(H):
    d.line([(0, y), (W, y)], fill=int(170 * max(0, (y - H * 0.45) / (H * 0.55))))
img = Image.composite(Image.new('RGB', (W, H), (5, 8, 20)), img, shade)

words = text.upper().split()
lines = textwrap.wrap(' '.join(words), width=14 if not vertical else 12)[:3]
size = 120 if not vertical else 130
try:
    font = ImageFont.truetype('/System/Library/Fonts/Supplemental/Georgia Bold.ttf', size)
except OSError:
    font = ImageFont.load_default()
draw = ImageDraw.Draw(img)
line_h = int(size * 1.1)
y = H - 60 - line_h * len(lines) - (H * 0.12 if vertical else 0)
for ln in lines:
    w = draw.textlength(ln, font=font)
    x = (W - w) / 2
    shadow = Image.new('RGBA', (W, H), (0, 0, 0, 0))
    ImageDraw.Draw(shadow).text((x + 4, y + 6), ln, font=font, fill=(0, 0, 0, 230))
    img.paste(shadow.filter(ImageFilter.GaussianBlur(6)), (0, 0), shadow.filter(ImageFilter.GaussianBlur(6)))
    draw.text((x, y), ln, font=font, fill=(236, 198, 110), stroke_width=3, stroke_fill=(40, 25, 5))
    y += line_h
img.save(out, 'JPEG', quality=92)
print(out)
