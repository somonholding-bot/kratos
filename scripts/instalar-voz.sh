#!/bin/bash
# Voz natural local de KRATOS: Piper (MIT) + voz masculina es_MX «claude» (calidad alta, ~63 MB). Sin coste ni nube.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"; D="$ROOT/.jarvis/tts"
mkdir -p "$D"
[ -x "$D/venv/bin/piper" ] || { /opt/homebrew/bin/python3.11 -m venv "$D/venv" && "$D/venv/bin/pip" install -q piper-tts==1.3.0; }
V=https://huggingface.co/rhasspy/piper-voices/resolve/main/es/es_MX/claude/high
for f in es_MX-claude-high.onnx es_MX-claude-high.onnx.json; do [ -s "$D/$f" ] || curl -sfL -o "$D/$f" "$V/$f"; done
echo "Voz natural instalada en $D"
