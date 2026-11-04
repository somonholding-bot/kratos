# Short vertical 2160x3840 (4K) a partir de un tramo del episodio: fondo desenfocado + vídeo recortado + subtítulos palabra por palabra + título de gancho.
# Uso: EPISODIO=ep2 python hacer_short.py nombre t0 t1 "LINEA 1|LINEA 2"
import sys, os, json, subprocess, importlib
from PIL import Image, ImageDraw, ImageFont
S = int(os.environ.get('SHORT_ESCALA', 2))   # 2 = 2160x3840 (4K vertical); 1 = 1080x1920
W, H, FPS, LEAD = 1080 * S, 1920 * S, 30, 0.5
FONT = '/System/Library/Fonts/Supplemental/DIN Alternate Bold.ttf'
SRC, TL = 'episodio-2-liam.mp4', 'timeline-ep2-liam.json'
name, t0, t1, hook = sys.argv[1], float(sys.argv[2]), float(sys.argv[3]), sys.argv[4].split('|')
dur = t1 - t0; base = f'/tmp/short-{name}-base.mp4'; out = f'short-{name}.mp4'
# 1) base: fondo desenfocado + panel central + audio con fundidos
fc = (f"[0:v]split=2[a][b];[a]scale={W}:{H}:force_original_aspect_ratio=increase,crop={W}:{H},boxblur={36*S}:6,eq=brightness=-0.12[bg];"
      f"[b]crop=iw*0.859375:ih:iw*0.0703125:0,scale={W}:-2:flags=lanczos[fg];[bg][fg]overlay=0:(H-h)/2-{40*S}[v];[0:a]afade=t=in:d=0.12,afade=t=out:st={dur - 0.45:.2f}:d=0.45[a]")
subprocess.run(['ffmpeg', '-loglevel', 'error', '-y', '-ss', f'{t0:.3f}', '-t', f'{dur:.3f}', '-i', SRC, '-filter_complex', fc, '-map', '[v]', '-map', '[a]', '-r', str(FPS),
                '-c:v', 'libx264', '-crf', '14', '-preset', 'fast', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '192k', base], check=True)
# 2) palabras con tiempos (reparto proporcional dentro de cada frase)
words = []
for s in json.load(open(TL))['sentences']:
    a, b = LEAD + s['start'] - t0, LEAD + s['end'] - t0
    if b < 0 or a > dur: continue
    ws = s['text'].split(); wt = [len(w) + 2 for w in ws]; tot = sum(wt); t = a
    for w, k in zip(ws, wt): words.append((w, t, t + (b - a) * k / tot)); t += (b - a) * k / tot
chunks, cur = [], []
for w in words:
    cur.append(w)
    if len(cur) >= 3 or w[0][-1] in '.?!,:': chunks.append(cur); cur = []
if cur: chunks.append(cur)
_f = {}
def font(sz):
    sz = int(sz)
    if sz not in _f: _f[sz] = ImageFont.truetype(FONT, sz)
    return _f[sz]
def outlined(d, xy, s, f, fill, sw=9 * S):
    d.text(xy, s, font=f, fill=fill, anchor='mm', stroke_width=sw, stroke_fill=(8, 6, 20))
# 3) dibujar encima y codificar
dec = subprocess.Popen(['ffmpeg', '-loglevel', 'error', '-i', base, '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'], stdout=subprocess.PIPE)
enc = subprocess.Popen(['ffmpeg', '-loglevel', 'error', '-y', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-s', f'{W}x{H}', '-r', str(FPS), '-i', '-', '-i', base, '-map', '0:v', '-map', '1:a',
                        '-c:v', 'libx264', '-crf', '15', '-preset', 'medium', '-pix_fmt', 'yuv420p', '-c:a', 'copy', '-movflags', '+faststart', '-shortest', out], stdin=subprocess.PIPE)
n = 0
while True:
    buf = dec.stdout.read(W * H * 3)
    if len(buf) < W * H * 3: break
    t = n / FPS; im = Image.frombytes('RGB', (W, H), buf); d = ImageDraw.Draw(im)
    for j, line in enumerate(hook):
        hs = 98 * S
        while font(hs).getlength(line) > 960 * S and hs > 40 * S: hs -= 4 * S
        outlined(d, (W // 2, (215 + j * 120) * S), line, font(hs), (238, 188, 78) if j == 0 else (255, 255, 255), 10 * S)
    if t > dur - 3.0: outlined(d, (W // 2, 470 * S), 'FULL EPISODE ON THE CHANNEL', font(46 * S), (200, 214, 255), 7 * S)
    ch = next((c for c in chunks if c[0][1] - 0.02 <= t < c[-1][2] + 0.05), None)
    if ch:
        txt = ' '.join(w[0].upper() for w in ch); sz = 104 * S
        while font(sz).getlength(txt) > 960 * S and sz > 50 * S: sz -= 4 * S
        pop = 1.0 + 0.14 * max(0.0, 1 - (t - ch[0][1]) / 0.14); f = font(sz * pop)
        total = f.getlength(txt); x = W / 2 - total / 2
        for w in ch:   # palabra activa en dorado
            word = w[0].upper() + ' '; act = w[1] - 0.02 <= t < w[2] + 0.02; wl = f.getlength(word)
            d.text((x, 1450 * S), word, font=f, fill=(238, 188, 78) if act else (255, 255, 255), anchor='lm', stroke_width=10 * S, stroke_fill=(8, 6, 20)); x += wl
    enc.stdin.write(im.tobytes()); n += 1
enc.stdin.close(); enc.wait(); dec.wait(); os.remove(base); print(out, n, 'fotogramas', round(os.path.getsize(out) / 1e6, 1), 'MB')
