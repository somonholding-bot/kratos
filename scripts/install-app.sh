#!/bin/bash
# Compila e instala la app nativa Kratos en ~/Applications, con acceso directo en el Escritorio
# y arranque automático al iniciar sesión (oculta, en la barra de menú). Revertir: scripts/uninstall-app.sh
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
APP="$HOME/Applications/Kratos.app"
WORK="$(mktemp -d)"; trap 'rm -rf "$WORK"' EXIT

swiftc -O -o "$WORK/Kratos" "$ROOT/native/main.swift" -framework AppKit -framework WebKit -framework AVFoundation
swift "$ROOT/scripts/make-icon.swift" "$WORK/icon.png"
mkdir "$WORK/Kratos.iconset"
for s in 16 32 128 256 512; do
  sips -z $s $s "$WORK/icon.png" --out "$WORK/Kratos.iconset/icon_${s}x${s}.png" >/dev/null
  sips -z $((s*2)) $((s*2)) "$WORK/icon.png" --out "$WORK/Kratos.iconset/icon_${s}x${s}@2x.png" >/dev/null
done
iconutil -c icns "$WORK/Kratos.iconset" -o "$WORK/Kratos.icns"
cp "$WORK/icon.png" "$ROOT/public/icon.png"

osascript -e 'tell application "Kratos" to quit' 2>/dev/null || true
launchctl bootout "gui/$(id -u)/com.jarvis.app" 2>/dev/null || true
mkdir -p "$HOME/Applications"
rm -rf "$APP"
mkdir -p "$APP/Contents/MacOS" "$APP/Contents/Resources"
cp "$WORK/Kratos" "$APP/Contents/MacOS/Kratos"
cp "$WORK/Kratos.icns" "$APP/Contents/Resources/Kratos.icns"
cat > "$APP/Contents/Info.plist" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleName</key><string>Kratos</string>
  <key>CFBundleDisplayName</key><string>Kratos</string>
  <key>CFBundleIdentifier</key><string>local.kratos.app</string>
  <key>CFBundleVersion</key><string>2</string>
  <key>CFBundleShortVersionString</key><string>0.2</string>
  <key>CFBundlePackageType</key><string>APPL</string>
  <key>CFBundleExecutable</key><string>Kratos</string>
  <key>CFBundleIconFile</key><string>Kratos</string>
  <key>LSMinimumSystemVersion</key><string>13.0</string>
  <key>NSHighResolutionCapable</key><true/>
  <key>NSMicrophoneUsageDescription</key><string>Kratos escucha tu voz para recibir órdenes. El audio se procesa solo en esta Mac y no se guarda.</string>
  <key>NSAppTransportSecurity</key><dict><key>NSAllowsLocalNetworking</key><true/></dict>
</dict>
</plist>
EOF
codesign --force --sign - "$APP" >/dev/null 2>&1

# Acceso directo en el Escritorio (sustituye al lanzador anterior)
rm -rf "$HOME/Desktop/Kratos.app"
ln -s "$APP" "$HOME/Desktop/Kratos"

# Arranque al iniciar sesión, oculta; se relanza si se cierra por error (no si eliges «Salir»)
cat > "$HOME/Library/LaunchAgents/com.jarvis.app.plist" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>com.jarvis.app</string>
  <key>ProgramArguments</key><array><string>$APP/Contents/MacOS/Kratos</string><string>--hidden</string></array>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><dict><key>SuccessfulExit</key><false/></dict>
  <key>ThrottleInterval</key><integer>15</integer>
  <key>LimitLoadToSessionType</key><string>Aqua</string>
  <key>StandardErrorPath</key><string>$ROOT/.jarvis/logs/app.log</string>
</dict>
</plist>
EOF
launchctl bootstrap "gui/$(id -u)" "$HOME/Library/LaunchAgents/com.jarvis.app.plist"
echo "Instalada $APP (en marcha en la barra de menú)"
