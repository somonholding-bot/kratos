#!/bin/bash
# Conecta ElevenLabs (voz narradora realista). Requiere cuenta propia y, para canales monetizados, plan de pago con licencia comercial.
# 1) En elevenlabs.io → Developers → API Keys → Create, pulsa «Copy». 2) Ejecuta este script.
# La clave se lee del portapapeles, se guarda solo en el Llavero («kratos-elevenlabs») y se comprueba con ElevenLabs.
set -u
osascript -e 'button returned of (display dialog "1. En elevenlabs.io → Developers → API Keys → «Create API Key», pulsa «Copy».\n2. Vuelve aquí y pulsa «Usar la clave copiada».\n\nSe guardará solo en el Llavero de tu Mac y se borrará del portapapeles." with title "KRATOS · Conectar ElevenLabs" buttons {"Cancelar", "Usar la clave copiada"} default button "Usar la clave copiada")' >/dev/null 2>&1 || exit 0
KEY=$(pbpaste 2>/dev/null | tr -d '[:space:]"'"'"'' | grep -oE '(sk_)?[A-Za-z0-9]{32,}' | head -1)
if [ -z "$KEY" ]; then
  osascript -e 'display alert "No encuentro una clave de ElevenLabs" message "Pulsa «Copy» junto a la clave y vuelve a intentarlo." as warning' >/dev/null
  exit 1
fi
printf 'add-generic-password -U -s kratos-elevenlabs -a api_key -w %s\n' "$KEY" | security -i >/dev/null 2>&1
CODE=$(curl -s -o /tmp/_el_user.json -w "%{http_code}" https://api.elevenlabs.io/v1/user/subscription -H "xi-api-key: $KEY")
unset KEY; printf "" | pbcopy
echo "ElevenLabs respondió HTTP $CODE"
if [ "$CODE" = "200" ]; then
  python3 -c "import json;d=json.load(open('/tmp/_el_user.json'));print('Plan:',d.get('tier'),'| créditos usados:',d.get('character_count'),'de',d.get('character_limit'))"; rm -f /tmp/_el_user.json
  osascript -e 'display dialog "✅ ElevenLabs conectado." with title "KRATOS" buttons {"Genial"} default button "Genial"' >/dev/null
else
  osascript -e "display alert \"ElevenLabs rechazó la clave (código $CODE)\" message \"Revisa que la copiaste completa.\" as warning" >/dev/null; exit 1
fi
