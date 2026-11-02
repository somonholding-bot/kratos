# Transiciones de escena del motor de Orin: mezcla dos fotogramas (PIL, mismo tamaño) según p en [0,1].
# Tipos: fade (continuidad dentro de una escena), wipe (barrido suave), push (empuje), zoom (atravesar con zoom y desenfoque), iris (círculo que se abre), flash (destello dorado).
import numpy as np
from PIL import Image, ImageFilter

TIPOS = ['wipe', 'zoom', 'iris', 'push', 'flash']   # rotación para escenas distintas
DUR = {'fade': 0.14, 'wipe': 0.45, 'push': 0.42, 'zoom': 0.5, 'iris': 0.5, 'flash': 0.5}

def _ease(p): return p * p * (3 - 2 * p)

def tipo_para(k, bg_ant, bg_nuevo, forzado=None):
    if forzado: return forzado
    if bg_ant == bg_nuevo: return 'fade'
    return TIPOS[k % len(TIPOS)]

def mezclar(a, b, p, tipo):
    p = min(1.0, max(0.0, p)); e = _ease(p)
    if tipo == 'fade': return Image.blend(a, b, e)
    A = np.asarray(a, dtype=np.float32); B = np.asarray(b, dtype=np.float32); h, w = A.shape[:2]
    if tipo == 'wipe':                       # borde suave que avanza de izquierda a derecha
        x = np.arange(w, dtype=np.float32)[None, :]; borde = e * (w + 360) - 180
        m = np.clip((borde - x) / 360 + 0.5, 0, 1)[..., None]
        return Image.fromarray((A * (1 - m) + B * m).astype(np.uint8))
    if tipo == 'push':                       # la escena nueva empuja a la vieja
        dx = int(round(e * w)); out = np.empty_like(A)
        out[:, :w - dx] = A[:, dx:]; out[:, w - dx:] = B[:, :dx]
        return Image.fromarray(out.astype(np.uint8))
    if tipo == 'zoom':                       # la vieja se acerca y se desenfoca; la nueva llega desde un zoom ligero
        z1 = 1 + 0.35 * e; z2 = 1.18 - 0.18 * e
        def zoom(img, z, blur):
            bw, bh = w / z, h / z; x0, y0 = (w - bw) / 2, (h - bh) / 2
            r = img.resize((w, h), Image.BILINEAR, box=(x0, y0, x0 + bw, y0 + bh))
            return r.filter(ImageFilter.GaussianBlur(blur)) if blur > 0.5 else r
        za = np.asarray(zoom(a, z1, 14 * e), dtype=np.float32); zb = np.asarray(zoom(b, z2, 14 * (1 - e)), dtype=np.float32)
        return Image.fromarray((za * (1 - e) + zb * e).astype(np.uint8))
    if tipo == 'iris':                       # círculo que se abre desde el centro
        yy, xx = np.mgrid[0:h, 0:w]; r = np.sqrt((xx - w / 2) ** 2 + (yy - h / 2) ** 2); rmax = np.hypot(w / 2, h / 2)
        m = np.clip((e * (rmax + 120) - r) / 120 + 0.5, 0, 1)[..., None]
        borde = np.exp(-((e * (rmax + 120) - r) / 60) ** 2)[..., None] * np.array([255, 214, 130], dtype=np.float32) * 0.45
        return Image.fromarray(np.clip(A * (1 - m) + B * m + borde, 0, 255).astype(np.uint8))
    if tipo == 'flash':                      # destello dorado en el punto medio
        base = A * (1 - e) + B * e; f = np.exp(-((p - 0.5) / 0.16) ** 2) * 0.85
        return Image.fromarray(np.clip(base * (1 - f) + np.array([255, 226, 160], dtype=np.float32) * f, 0, 255).astype(np.uint8))
    return Image.blend(a, b, e)
