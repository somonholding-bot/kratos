#!/bin/bash
# Copia de seguridad de la base de Jarvis. Conserva las últimas 14.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DB="${JARVIS_DB:-jarvis}"
OUT="$ROOT/backups/${DB}-$(date +%Y%m%d-%H%M%S).dump"
mkdir -p "$ROOT/backups"; chmod 700 "$ROOT/backups"
pg_dump -h 127.0.0.1 -U jarvis_app -Fc -f "$OUT" "$DB"
chmod 600 "$OUT"
ls -1t "$ROOT"/backups/"$DB"-*.dump | tail -n +15 | xargs -r rm -f
echo "$OUT"
