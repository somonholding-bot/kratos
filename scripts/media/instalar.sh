#!/bin/bash
# Herramientas gratis de producción de vídeo (locales, licencias comerciales): voz, música e imágenes.
# Cada una en su propio entorno en ~/.local/share/kratos-media. Uso: bash scripts/media/instalar.sh
set -euo pipefail
M=~/.local/share/kratos-media; mkdir -p "$M"; cd "$M"
# Voz: Chatterbox Multilingual (MIT). perth necesita pkg_resources (setuptools < 81)
[ -d chatterbox ] || python3.11 -m venv chatterbox
chatterbox/bin/pip install -q chatterbox-tts "setuptools<81"
# Imágenes: mflux (MIT) con Z-Image-Turbo (Apache-2.0)
[ -d mflux ] || python3.11 -m venv mflux
mflux/bin/pip install -q mflux
# Música: ACE-Step 1.5 (MIT), con uv
command -v uv >/dev/null || brew install uv
[ -d acestep ] || git clone -q --depth 1 https://github.com/ace-step/ACE-Step-1.5 acestep
(cd acestep && uv sync)
echo "Listo: voz, imágenes y música en $M"
