#!/bin/bash
# Diagnóstico de la voz de KRATOS: dónde se va el tiempo en cada respuesta, qué voz usa y si lee los mensajes.
# Solo lectura. Uso: bash scripts/diagnostico-voz.sh  (y pega el resultado en el chat con Claude)
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
echo "== Versión instalada"; git log --oneline -1
echo; echo "== Servicios (PID, último código de salida)"; launchctl list | grep com.jarvis || echo "ningún servicio com.jarvis activo"
echo; echo "== Transcripción persistente (whisper-server en 7432)"; curl -s -o /dev/null -w "%{http_code}\n" -m 2 http://127.0.0.1:7432/ || echo "no responde: se usa whisper-cli (más lento)"
echo; echo "== Últimas respuestas por voz (ms): audio, transcripción, hasta la primera frase, hasta que suena"
bash scripts/consulta-bd.sh "SELECT to_char(at, 'DD HH24:MI:SS') AS hora, audio_ms, stt_ms AS transcripcion, think_ms AS primera_frase, tts_start_ms AS suena, outcome FROM voice_metrics WHERE outcome = 'ok' ORDER BY id DESC LIMIT 10" 2>&1
echo; echo "== Ajustes de voz"
bash scripts/consulta-bd.sh "SELECT key, value FROM system_state WHERE key IN ('tts_voice','voice_model','ai_effort','autonomia','follow_up')" 2>&1
echo; echo "== Uso de la IA en la última hora (llamadas por voz)"
bash scripts/consulta-bd.sh "SELECT model, count(*) AS llamadas, round(avg(input_tokens)) AS entrada_media, round(avg(output_tokens)) AS salida_media FROM ai_usage WHERE at > now() - interval '1 hour' GROUP BY model" 2>&1
echo; echo "== Voz Personal (registro de la app)"; grep -E "voz personal|voz: personal" .jarvis/logs/app.log 2>/dev/null | tail -5 || echo "sin registros"
echo; echo "== Mensajes de texto"; T=$(cat .jarvis/session-token 2>/dev/null); curl -s -m 3 -H "Cookie: jarvis=$T" http://127.0.0.1:7420/api/mensajes/estado; echo
echo; echo "== Música"; command -v yt-dlp >/dev/null && echo "yt-dlp instalado: $(yt-dlp --version)" || echo "falta yt-dlp: brew install yt-dlp"
echo; echo "== IA local (Ollama)"; [ -f .jarvis/local-model ] && echo "modelo: $(cat .jarvis/local-model)" || echo "sin instalar: bash scripts/instalar-ia-local.sh"
curl -s -m 2 http://127.0.0.1:11434/api/ps 2>/dev/null | python3 -c 'import sys,json; m=json.load(sys.stdin).get("models",[]); print("en memoria: " + (", ".join(x["name"] for x in m) or "ninguno"))' 2>/dev/null || echo "Ollama no responde"
bash scripts/consulta-bd.sh "SELECT model, count(*) AS respuestas FROM ai_usage WHERE at > now() - interval '1 day' GROUP BY model ORDER BY 2 DESC" 2>&1
echo; echo "== Memoria del Mac"; sysctl -n hw.memsize | awk '{print $1/1073741824 " GB"}'; sysctl -n machdep.cpu.brand_string
