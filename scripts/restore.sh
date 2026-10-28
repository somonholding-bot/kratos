#!/bin/bash
# Restaura una copia en una base NUEVA (nunca sobrescribe la activa).
# Uso: scripts/restore.sh backups/archivo.dump nombre_base_destino
set -euo pipefail
FILE="$1"; TARGET="$2"
[ "$TARGET" = "jarvis" ] && { echo "Restaura en otra base y cámbiala después de verificarla."; exit 1; }
createdb -h 127.0.0.1 -O jarvis_app "$TARGET"
pg_restore -h 127.0.0.1 -U jarvis_app -d "$TARGET" --no-owner "$FILE"
echo "Restaurado en $TARGET"
