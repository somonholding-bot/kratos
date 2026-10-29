#!/bin/bash
# Conecta Groq (gratis, sin tarjeta): el cerebro rápido de KRATOS para lo sencillo.
# 1) En console.groq.com → API Keys → Create API Key, pulsa «Copy». 2) Ejecuta este script.
# La clave se lee del portapapeles, se guarda solo en el Llavero («kratos-groq») y se comprueba con Groq.
set -u
osascript -e 'button returned of (display dialog "1. En console.groq.com → API Keys → «Create API Key», pulsa «Copy».\n2. Vuelve aquí y pulsa «Usar la clave copiada».\n\nSe guardará solo en el Llavero de tu Mac y se borrará del portapapeles." with title "KRATOS · Conectar Groq" buttons {"Cancelar", "Usar la clave copiada"} default button "Usar la clave copiada")' >/dev/null 2>&1 || exit 0
KEY=$(pbpaste 2>/dev/null | tr -d '[:space:]"'"'"'' | grep -oE 'gsk_[A-Za-z0-9]{20,}' | head -1)
if [ -z "$KEY" ]; then
  osascript -e 'display alert "No encuentro una clave de Groq" message "La clave de Groq empieza por gsk_. Pulsa «Copy» junto a ella y vuelve a intentarlo." as warning' >/dev/null
  exit 1
fi
printf 'add-generic-password -U -s kratos-groq -a api -w %s\n' "$KEY" | security -i >/dev/null 2>&1
CODE=$(curl -s -o /dev/null -w "%{http_code}" https://api.groq.com/openai/v1/models -H "Authorization: Bearer $KEY")
unset KEY; printf "" | pbcopy
echo "Groq respondió HTTP $CODE"
if [ "$CODE" = "200" ]; then
  osascript -e 'display dialog "✅ Groq conectado. KRATOS responderá lo sencillo al instante y gratis (lo demás sigue con Claude)." with title "KRATOS" buttons {"Genial"} default button "Genial"' >/dev/null
else
  osascript -e "display alert \"Groq rechazó la clave (código $CODE)\" message \"Revisa que la copiaste completa.\" as warning" >/dev/null; exit 1
fi
