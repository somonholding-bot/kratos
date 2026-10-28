#!/bin/bash
# Instala Jarvis como servicio de usuario (launchd): arranca al iniciar sesión y se reinicia si cae.
# No requiere permisos de administrador. Revertir: scripts/uninstall-service.sh
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
NODE="$(command -v node)"
AGENTS="$HOME/Library/LaunchAgents"
LOGS="$ROOT/.jarvis/logs"
mkdir -p "$AGENTS" "$LOGS"

plist() { # nombre, args..., extra
  local label="com.jarvis.$1"; shift
  local extra="$1"; shift
  local args=""; for a in "$@"; do args+="    <string>$a</string>"$'\n'; done
  cat > "$AGENTS/$label.plist" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>$label</string>
  <key>ProgramArguments</key>
  <array>
$args  </array>
  <key>WorkingDirectory</key><string>$ROOT</string>
  <key>StandardOutPath</key><string>$LOGS/${label#com.jarvis.}.log</string>
  <key>StandardErrorPath</key><string>$LOGS/${label#com.jarvis.}.log</string>
  <key>EnvironmentVariables</key><dict><key>PATH</key><string>/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin</string></dict>
$extra
</dict>
</plist>
EOF
  plutil -lint "$AGENTS/$label.plist" >/dev/null
  launchctl bootout "gui/$(id -u)/$label" 2>/dev/null || true
  launchctl bootstrap "gui/$(id -u)" "$AGENTS/$label.plist"
  echo "instalado $label"
}

KEEP='  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>ThrottleInterval</key><integer>10</integer>'
plist server "$KEEP" "$NODE" "$ROOT/src/server.ts"
plist worker "$KEEP" "$NODE" "$ROOT/src/worker.ts"
plist backup '  <key>StartCalendarInterval</key><dict><key>Hour</key><integer>3</integer><key>Minute</key><integer>15</integer></dict>' /bin/bash "$ROOT/scripts/backup.sh"
