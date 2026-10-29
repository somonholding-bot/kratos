#!/bin/bash
# Conecta KRATOS a App Store Connect en SOLO LECTURA.
# Pide Issuer ID, Key ID y el archivo .p8; los guarda en el Llavero (servicio kratos-appstore), comprueba con Apple
# y hace la primera lectura. Nada se escribe en archivos ni registros, y KRATOS solo hace peticiones GET.
set -u
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
TITLE="KRATOS · Conectar App Store Connect"
ask() { osascript -e "text returned of (display dialog \"$1\" default answer \"${2:-}\" with title \"$TITLE\" buttons {\"Cancelar\", \"Siguiente\"} default button \"Siguiente\")" 2>/dev/null; }
fail() { osascript -e "display alert \"No se pudo conectar\" message \"$1\" as warning" >/dev/null; exit 1; }

B=$(osascript -e "button returned of (display dialog \"Para que KRATOS vea en tiempo real tus apps en revisión:\n\n1. Abre App Store Connect › Usuarios y acceso › Integraciones › App Store Connect API.\n2. Pestaña «Claves del equipo» › botón «+».\n3. Nombre: KRATOS. Acceso: «Desarrollador» (para ver el estado de revisión). Si quieres que lea reseñas, Apple puede pedir «Atención al cliente».\n4. Descarga el archivo .p8 (solo se puede una vez) y copia el Issuer ID y el Key ID.\n\nKRATOS solo hace lecturas: no puede cambiar ni enviar nada a Apple.\" with title \"$TITLE\" buttons {\"Cancelar\", \"Abrir App Store Connect\", \"Ya tengo la clave\"} default button \"Ya tengo la clave\")" 2>/dev/null) || exit 0
if [ "$B" = "Abrir App Store Connect" ]; then
  open "https://appstoreconnect.apple.com/access/integrations/api"
  osascript -e "display dialog \"Cuando tengas el archivo .p8, el Issuer ID y el Key ID, pulsa Continuar.\" with title \"$TITLE\" buttons {\"Cancelar\", \"Continuar\"} default button \"Continuar\"" >/dev/null 2>&1 || exit 0
fi

ISSUER=$(ask "Pega el Issuer ID (aparece encima de la lista de claves; formato xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx):" "${KRATOS_ISSUER:-}" | tr -d '[:space:]') || exit 0
printf '%s' "$ISSUER" | grep -qE '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$' || fail "El Issuer ID no tiene el formato esperado (xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx)."
KEYID=$(ask "Pega el Key ID (10 caracteres, columna «ID de clave»):" | tr -d '[:space:]') || exit 0
printf '%s' "$KEYID" | grep -qE '^[A-Z0-9]{10}$' || fail "El Key ID debe tener 10 letras mayúsculas o números."
P8=$(osascript -e "POSIX path of (choose file with prompt \"Elige el archivo AuthKey_${KEYID}.p8 que descargaste\")" 2>/dev/null) || exit 0
grep -q "BEGIN PRIVATE KEY" "$P8" 2>/dev/null || fail "Ese archivo no es una clave .p8 de Apple."

# Guardar en el Llavero sin pasar los secretos como argumentos (no aparecen en la lista de procesos)
P8B64=$(base64 < "$P8" | tr -d '\n')
{ printf 'add-generic-password -U -s kratos-appstore -a issuer -w %s\n' "$ISSUER"
  printf 'add-generic-password -U -s kratos-appstore -a keyid -w %s\n' "$KEYID"
  printf 'add-generic-password -U -s kratos-appstore -a p8 -w %s\n' "$P8B64"; } | security -i >/dev/null 2>&1
unset P8B64
security find-generic-password -s kratos-appstore -a p8 >/dev/null 2>&1 || fail "No se pudo guardar en el Llavero."

# Comprobar con Apple y hacer la primera lectura
OUT=$(cd "$ROOT" && node --input-type=module -e "
import { createPool } from './src/db.ts'; import { appleSync } from './src/core/apple.ts';
const db = createPool(); try { const r = await appleSync(db); console.log(JSON.stringify(r)); } catch (e) { console.log('ERROR ' + e.message); process.exitCode = 1; } finally { await db.end(); }" 2>&1 | tail -1)
case "$OUT" in
  ERROR*) fail "${OUT#ERROR }" ;;
esac
APPS=$(printf '%s' "$OUT" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const r=JSON.parse(s);console.log((r.apps||[]).join("\\n")||"(ninguna app en la cuenta)");if(r.sinPermiso?.length)console.log("\\nSin permiso para: "+r.sinPermiso.join(", "))})' | tr -d '"\\')
osascript -e "display dialog \"✅ App Store Connect conectado en solo lectura.\n\n$APPS\n\nKRATOS revisará cada 15 minutos y le avisará en voz alta cuando Apple cambie el estado de una app. Puede guardar el archivo .p8 en un lugar seguro o borrarlo: ya está en el Llavero.\" with title \"$TITLE\" buttons {\"Perfecto\"} default button \"Perfecto\"" >/dev/null 2>&1
echo "Conectado: $OUT"
