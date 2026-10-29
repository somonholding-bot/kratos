#!/bin/bash
# Consulta de SOLO LECTURA a la base de datos de KRATOS (la usa la auto-mejora). Cualquier escritura falla.
set -euo pipefail
[ $# -eq 1 ] || { echo 'Uso: bash scripts/consulta-bd.sh "SELECT …"'; exit 1; }
PGOPTIONS='-c default_transaction_read_only=on -c statement_timeout=5000' psql -h 127.0.0.1 -U jarvis_app -d jarvis -v ON_ERROR_STOP=1 -P pager=off -c "$1"
