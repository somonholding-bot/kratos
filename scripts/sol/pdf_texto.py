#!/usr/bin/env python3
# PROJECT SOL (R09): extrae el texto de un PDF de acceso abierto legal con pypdf.
# Entrada: los bytes del PDF por la entrada estándar. Salida: JSON {ok, paginas, titulo, texto} o {ok: false, error}.
# Lo invoca src/core/conectores.ts con el Python de .jarvis/acd/venv (instalar: uv pip install --python .jarvis/acd/venv/bin/python pypdf).
import io
import json
import sys

MAX_PAGINAS = 3000


def salir(obj):
    sys.stdout.write(json.dumps(obj, ensure_ascii=False))
    sys.stdout.flush()


def main():
    datos = sys.stdin.buffer.read()
    if not datos.startswith(b'%PDF'):
        return salir({'ok': False, 'error': 'la entrada no es un PDF'})
    try:
        from pypdf import PdfReader
    except ImportError:
        return salir({'ok': False, 'error': 'pypdf no está instalado en .jarvis/acd/venv'})
    try:
        lector = PdfReader(io.BytesIO(datos))
        if lector.is_encrypted:
            # muchos PDF abiertos van «cifrados» con contraseña de usuario vacía; si no, no se leen (no se fuerza nada)
            try:
                resultado = lector.decrypt('')
            except Exception:
                resultado = 0
            if not resultado:
                return salir({'ok': False, 'error': 'PDF cifrado: no se puede leer sin contraseña'})
        partes = []
        for n, pagina in enumerate(lector.pages):
            if n >= MAX_PAGINAS:
                break
            try:
                partes.append(pagina.extract_text() or '')
            except Exception:
                partes.append('')
        titulo = None
        try:
            titulo = (lector.metadata.title if lector.metadata else None) or None
        except Exception:
            titulo = None
        salir({'ok': True, 'paginas': len(lector.pages), 'titulo': titulo, 'texto': '\n\n'.join(partes)})
    except Exception as e:
        salir({'ok': False, 'error': f'{type(e).__name__}: {e}'[:300]})


if __name__ == '__main__':
    main()
