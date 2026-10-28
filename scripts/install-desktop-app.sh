#!/bin/bash
# Crea «Kratos.app» en el Escritorio. Al abrirla: comprueba el servicio, lo arranca si hace falta
# y abre el panel en su propia ventana de Chrome con un código de acceso de un solo uso.
# Revertir: borrar ~/Desktop/Kratos.app
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
APP="$HOME/Desktop/Kratos.app"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

# Icono
swift "$ROOT/scripts/make-icon.swift" "$WORK/icon.png"
mkdir "$WORK/Kratos.iconset"
for s in 16 32 128 256 512; do
  sips -z $s $s "$WORK/icon.png" --out "$WORK/Kratos.iconset/icon_${s}x${s}.png" >/dev/null
  sips -z $((s*2)) $((s*2)) "$WORK/icon.png" --out "$WORK/Kratos.iconset/icon_${s}x${s}@2x.png" >/dev/null
done
iconutil -c icns "$WORK/Kratos.iconset" -o "$WORK/Kratos.icns"

rm -rf "$APP"
mkdir -p "$APP/Contents/MacOS" "$APP/Contents/Resources"
cp "$WORK/Kratos.icns" "$APP/Contents/Resources/Kratos.icns"
cp "$WORK/icon.png" "$ROOT/public/icon.png"

cat > "$APP/Contents/Info.plist" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleName</key><string>Kratos</string>
  <key>CFBundleDisplayName</key><string>Kratos</string>
  <key>CFBundleIdentifier</key><string>local.kratos.launcher</string>
  <key>CFBundleVersion</key><string>1</string>
  <key>CFBundlePackageType</key><string>APPL</string>
  <key>CFBundleExecutable</key><string>kratos</string>
  <key>CFBundleIconFile</key><string>Kratos</string>
  <key>LSUIElement</key><true/>
</dict>
</plist>
EOF

cat > "$APP/Contents/MacOS/kratos" <<EOF
#!/bin/bash
ROOT="$ROOT"
NODE="$(command -v node)"
UID_="\$(id -u)"
healthy() { curl -sf --max-time 2 http://127.0.0.1:7420/api/health >/dev/null; }
if ! healthy; then
  launchctl kickstart "gui/\$UID_/com.jarvis.server" 2>/dev/null || bash "\$ROOT/scripts/install-service.sh"
  launchctl kickstart "gui/\$UID_/com.jarvis.worker" 2>/dev/null || true
  for i in \$(seq 1 20); do healthy && break; sleep 0.5; done
fi
if ! healthy; then
  osascript -e 'display alert "Kratos no responde" message "El servicio no arrancó. Revisa ~/Jarvis/.jarvis/logs/server.log" as critical'
  exit 1
fi
CODE="\$(cd "\$ROOT" && "\$NODE" -e "import('./src/auth.ts').then(m => process.stdout.write(m.issueLoginCode()))")"
URL="http://127.0.0.1:7420/login?c=\$CODE"
if [ -d "/Applications/Google Chrome.app" ]; then
  open -na "Google Chrome" --args --app="\$URL" --window-size=1440,900
else
  open "\$URL"
fi
EOF
chmod +x "$APP/Contents/MacOS/kratos"
touch "$APP"
echo "Creada $APP"
