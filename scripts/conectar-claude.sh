#!/bin/bash
# Abre una ventana para pegar la clave de Claude, la guarda en el Llavero (nunca en archivos),
# comprueba con Anthropic que funciona y ofrece aprobar el presupuesto de la IA.
# La clave no se muestra ni se escribe en ningún registro.
set -u
ROOT="$(cd "$(dirname "$0")/.." && pwd)"

# 1) El propietario copia la clave y pulsa el botón: se lee del portapapeles (sin campo oculto)
[ "${1:-}" = "--portapapeles" ] || osascript -e 'button returned of (display dialog "1. En console.anthropic.com → API Keys, pulsa «Copy» junto a tu clave.\n2. Vuelve aquí y pulsa «Usar la clave copiada».\n\nSe guardará solo en el Llavero de tu Mac y se borrará del portapapeles." with title "KRATOS · Conectar Claude" buttons {"Cancelar", "Usar la clave copiada"} default button "Usar la clave copiada")' >/dev/null 2>&1 || exit 0
KEY=$(pbpaste 2>/dev/null | tr -d '[:space:]"'"'"'')
FOUND=$(printf '%s' "$KEY" | grep -oE 'sk-ant-[A-Za-z0-9_-]{20,}' | head -1)
echo "Diagnóstico: portapapeles con ${#KEY} caracteres, empieza por «$(printf '%s' "$KEY" | cut -c1-11)…»; clave de Claude encontrada: $([ -n "$FOUND" ] && echo sí || echo no)"
if [ -z "$FOUND" ]; then
  LEN=${#KEY}; START=$(printf '%s' "$KEY" | cut -c1-7)
  case "$START" in
    sk-proj*|sk-svca*) HINT="Lo copiado es una clave de OpenAI (ChatGPT). KRATOS necesita una de Anthropic.";;
    "") HINT="El portapapeles está vacío: pulsa «Copy» junto a la clave y vuelve a intentarlo.";;
    *) HINT="Lo copiado empieza por «${START}…» y tiene ${LEN} caracteres; no es una clave de Claude.";;
  esac
  osascript -e "display alert \"No encuentro una clave de Claude\" message \"$HINT\n\nLa clave correcta empieza por sk-ant-api03- y mide unos 100 caracteres.\" as warning" >/dev/null
  exit 1
fi
KEY="$FOUND"

# Guardar sin pasar la clave como argumento (no aparece en la lista de procesos)
printf 'add-generic-password -U -s kratos-anthropic -a api -w %s\n' "$KEY" | security -i >/dev/null 2>&1
security find-generic-password -s kratos-anthropic -a api >/dev/null 2>&1 && echo "Diagnóstico: guardada en el Llavero" || echo "Diagnóstico: NO se pudo guardar en el Llavero"
CODE=$(curl -s -o /dev/null -w "%{http_code}" https://api.anthropic.com/v1/models -H "x-api-key: $KEY" -H "anthropic-version: 2023-06-01")
echo "Diagnóstico: Anthropic respondió HTTP $CODE"
unset KEY
printf "" | pbcopy   # vaciar el portapapeles
if [ "$CODE" != "200" ]; then
  osascript -e "display alert \"Anthropic rechazó la clave (código $CODE)\" message \"Revisa que la copiaste completa y que tu cuenta tiene saldo.\" as warning" >/dev/null
  exit 1
fi

# Ofrecer aprobar el presupuesto pendiente de la IA (decisión del propietario, con su clic)
ID=$(psql -h 127.0.0.1 -U jarvis_app -d jarvis -Atc "select id from approvals where account_label='Operación: API de Claude' and status='pendiente' order by id limit 1" 2>/dev/null)
if [ -n "$ID" ]; then
  ANSWER=$(osascript -e 'button returned of (display dialog "✅ Clave guardada y aceptada por Anthropic.\n\n¿Apruebas 10 USD durante 30 días para que KRATOS piense con Claude? Cada conversación cuesta céntimos y nunca podrá gastar más de esa cantidad." with title "KRATOS · Presupuesto de la IA" buttons {"Ahora no", "Aprobar 10 USD"} default button "Aprobar 10 USD")' 2>/dev/null)
  if [ "$ANSWER" = "Aprobar 10 USD" ]; then
    TOKEN=$(cat "$ROOT/.jarvis/session-token")
    curl -s -o /dev/null -b "jarvis=$TOKEN" -H 'content-type: application/json' -d '{"approve":true}' "http://127.0.0.1:7420/api/approvals/$ID"
    osascript -e 'display dialog "KRATOS ya piensa con Claude.\n\nDi «Hey Kratos» y pregúntale lo que quieras." with title "KRATOS · Listo" buttons {"Genial"} default button "Genial"' >/dev/null
  fi
else
  osascript -e 'display dialog "✅ Clave guardada y aceptada por Anthropic." with title "KRATOS" buttons {"OK"} default button "OK"' >/dev/null
fi
