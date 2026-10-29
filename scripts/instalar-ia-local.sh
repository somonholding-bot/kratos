#!/bin/bash
# IA local de KRATOS (Ollama + modelo de código abierto): responde lo sencillo por voz, gratis y sin internet.
# Elige el modelo más nuevo que cabe en la memoria de este Mac (prueba de más nuevo a más probado) y deja
# su nombre en .jarvis/local-model. Con --actualizar (lo hace solo cada domingo a las 04:20) actualiza Ollama,
# vuelve a descargar el modelo si hay pesos nuevos y cambia a uno más moderno si ya está publicado.
# Elegir otro modelo: KRATOS_LOCAL_MODEL=qwen3:8b bash scripts/instalar-ia-local.sh
# Quitar: bash scripts/instalar-ia-local.sh --quitar
set -uo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
FILE="$ROOT/.jarvis/local-model"
AGENT="$HOME/Library/LaunchAgents/com.jarvis.ia-local.plist"
mkdir -p "$ROOT/.jarvis/logs"
log() { echo "$(date '+%F %T') $*"; }

if [ "${1:-}" = "--quitar" ]; then
  launchctl bootout "gui/$(id -u)/com.jarvis.ia-local" 2>/dev/null; rm -f "$AGENT"
  [ -f "$FILE" ] && ollama rm "$(cat "$FILE")" 2>/dev/null; rm -f "$FILE"
  log "IA local quitada (Ollama sigue instalado: brew uninstall ollama para borrarlo)"; exit 0
fi

command -v brew >/dev/null || { echo "Falta Homebrew (https://brew.sh)"; exit 1; }
if ! command -v ollama >/dev/null; then log "Instalando Ollama…"; brew install ollama || exit 1
elif [ "${1:-}" = "--actualizar" ]; then brew upgrade ollama 2>/dev/null || true; fi
brew services restart ollama >/dev/null 2>&1 || brew services start ollama >/dev/null 2>&1
for i in $(seq 1 20); do curl -s -m 1 http://127.0.0.1:11434/api/tags >/dev/null && break; sleep 1; done

# Candidatos de más moderno a más probado según la memoria (los primeros pueden no existir aún: se saltan).
# Para voz importa la rapidez: se prefieren modelos «MoE» (pocos parámetros activos) o de tamaño medio.
RAM=$(( $(sysctl -n hw.memsize) / 1073741824 ))
if [ -n "${KRATOS_LOCAL_MODEL:-}" ]; then C=("$KRATOS_LOCAL_MODEL")
elif [ "$RAM" -ge 48 ]; then C=(qwen3.6:35b-a3b qwen3.5:35b-a3b qwen3:30b-a3b gemma3:27b)
elif [ "$RAM" -ge 32 ]; then C=(qwen3.6:35b-a3b qwen3:30b-a3b gemma4:12b qwen3:14b)
elif [ "$RAM" -ge 24 ]; then C=(gemma4:12b qwen3.6:14b qwen3:14b gemma3:12b qwen3:8b)
elif [ "$RAM" -ge 16 ]; then C=(gemma4:12b qwen3.6:8b qwen3:8b gemma3:12b)
else C=(gemma4:4b qwen3.6:4b qwen3:4b gemma3:4b); fi
log "Memoria: ${RAM} GB · candidatos: ${C[*]}"

OLD="$(cat "$FILE" 2>/dev/null || true)"
CHOSEN=""
for m in "${C[@]}"; do
  log "Descargando $m (puede tardar varios minutos)…"
  if ollama pull "$m"; then CHOSEN="$m"; break; fi
  log "$m no está disponible; pruebo el siguiente"
done
[ -n "$CHOSEN" ] || { log "No pude descargar ningún modelo"; exit 1; }
echo "$CHOSEN" > "$FILE"
if [ -n "$OLD" ] && [ "$OLD" != "$CHOSEN" ]; then ollama rm "$OLD" >/dev/null 2>&1 && log "Quitado el modelo anterior: $OLD"; fi

# Prueba rápida en español
OUT=$(curl -s -m 120 http://127.0.0.1:11434/api/chat -d "{\"model\":\"$CHOSEN\",\"stream\":false,\"think\":false,\"keep_alive\":\"24h\",\"messages\":[{\"role\":\"user\",\"content\":\"Saluda en una frase corta en español.\"}]}" | python3 -c 'import sys,json; print(json.load(sys.stdin).get("message",{}).get("content","").strip())' 2>/dev/null)
log "Modelo activo: $CHOSEN · prueba: ${OUT:-sin respuesta}"

# Revisión semanal automática (domingo 04:20)
if [ ! -f "$AGENT" ]; then
  cat > "$AGENT" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>com.jarvis.ia-local</string>
  <key>ProgramArguments</key><array><string>/bin/bash</string><string>$ROOT/scripts/instalar-ia-local.sh</string><string>--actualizar</string></array>
  <key>StartCalendarInterval</key><dict><key>Weekday</key><integer>0</integer><key>Hour</key><integer>4</integer><key>Minute</key><integer>20</integer></dict>
  <key>StandardOutPath</key><string>$ROOT/.jarvis/logs/ia-local.log</string>
  <key>StandardErrorPath</key><string>$ROOT/.jarvis/logs/ia-local.log</string>
  <key>EnvironmentVariables</key><dict><key>PATH</key><string>/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin</string></dict>
</dict>
</plist>
EOF
  launchctl bootstrap "gui/$(id -u)" "$AGENT" 2>/dev/null || true
  log "Revisión semanal programada (domingos 04:20, registro en .jarvis/logs/ia-local.log)"
fi
log "Listo. KRATOS usa la IA local en cuanto el servidor la detecta (unos 30 s)."
