#!/bin/bash
# Acceso remoto a KRATOS desde cualquier computadora: https://kratos.<tu-dominio> → túnel cifrado de Cloudflare → este Mac.
# - El servidor sigue escuchando solo en 127.0.0.1: no se abre ningún puerto del router.
# - Dos cerraduras: Cloudflare Access (código a tu correo) y la clave remota de KRATOS (solo se guarda su hash).
# Requisito: el dominio debe estar gestionado por Cloudflare (plan gratuito).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
TITLE="KRATOS · Acceso remoto"
DOMAIN_DEFAULT="kratos.kybalionus.com"
dialog() { osascript -e "text returned of (display dialog \"$1\" default answer \"${2:-}\" ${3:-} with title \"$TITLE\" buttons {\"Cancelar\", \"Siguiente\"} default button \"Siguiente\")" 2>/dev/null; }

HOST=$(dialog "Dirección privada para entrar a KRATOS desde otra computadora:" "$DOMAIN_DEFAULT") || exit 0
printf '%s' "$HOST" | grep -qE '^[a-z0-9-]+(\.[a-z0-9-]+)+$' || { echo "Dirección no válida"; exit 1; }

P1=$(dialog "Elige la clave remota de KRATOS (mínimo 10 caracteres). Se guarda solo su huella cifrada." "" "with hidden answer") || exit 0
P2=$(dialog "Repite la clave remota:" "" "with hidden answer") || exit 0
[ "$P1" = "$P2" ] || { osascript -e 'display alert "Las claves no coinciden"' >/dev/null; exit 1; }
# La clave viaja por stdin, nunca como argumento
printf '%s' "$P1" | (cd "$ROOT" && node --input-type=module -e "
import { setRemote } from './src/auth.ts'; let s=''; process.stdin.on('data', d => s += d).on('end', () => { setRemote('$HOST', s); console.log('Clave remota guardada (hash scrypt).'); });")
unset P1 P2

command -v cloudflared >/dev/null || brew install cloudflared
[ -f "$HOME/.cloudflared/cert.pem" ] || { echo "Se abrirá Cloudflare: entra y elige tu dominio."; cloudflared tunnel login; }
cloudflared tunnel info kratos >/dev/null 2>&1 || cloudflared tunnel create kratos
TID=$(cloudflared tunnel list -o json | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>console.log(JSON.parse(s).find(t=>t.name==="kratos").id))')
cloudflared tunnel route dns kratos "$HOST" || true

cat > "$HOME/.cloudflared/kratos.yml" <<EOF
tunnel: $TID
credentials-file: $HOME/.cloudflared/$TID.json
ingress:
  - hostname: $HOST
    service: http://127.0.0.1:7420
  - service: http_status:404
EOF

PLIST="$HOME/Library/LaunchAgents/com.jarvis.tunnel.plist"
cat > "$PLIST" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>com.jarvis.tunnel</string>
  <key>ProgramArguments</key><array><string>$(command -v cloudflared)</string><string>tunnel</string><string>--config</string><string>$HOME/.cloudflared/kratos.yml</string><string>run</string><string>kratos</string></array>
  <key>RunAtLoad</key><true/><key>KeepAlive</key><true/>
  <key>StandardOutPath</key><string>$ROOT/.jarvis/logs/tunnel.log</string><key>StandardErrorPath</key><string>$ROOT/.jarvis/logs/tunnel.log</string>
</dict></plist>
EOF
launchctl bootout gui/$(id -u)/com.jarvis.tunnel 2>/dev/null || true
launchctl bootstrap gui/$(id -u) "$PLIST"
launchctl kickstart -k gui/$(id -u)/com.jarvis.server

osascript -e "display dialog \"✅ Túnel activo: https://$HOST\n\nÚltimo paso (2 minutos) para la segunda cerradura:\nCloudflare › Zero Trust › Access › Applications › Add › Self-hosted\n· Dominio: $HOST\n· Política: Allow · Emails · tu correo\n\nAsí, antes de la clave de KRATOS, Cloudflare te pedirá un código enviado a tu correo.\" with title \"$TITLE\" buttons {\"Abrir Cloudflare\", \"Listo\"} default button \"Listo\"" 2>/dev/null | grep -q "Abrir" && open "https://one.dash.cloudflare.com/" || true
echo "Acceso remoto listo: https://$HOST"
