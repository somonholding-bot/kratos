"""Voz persistente de KRATOS (solo 127.0.0.1): el modelo se carga una vez y cada frase se sintetiza al momento.

POST /tts  {"text": "...", "voice": "piper"|"kokoro"}  ->  audio/wav
Piper (es_MX «claude», masculina) siempre; Kokoro (em_alex) solo si está instalado en .jarvis/tts/kokoro.
"""
import io, json, os, wave
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from threading import Lock

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
D = os.path.join(ROOT, ".jarvis", "tts")

from piper import PiperVoice, SynthesisConfig
piper_voice = PiperVoice.load(os.path.join(D, "es_MX-claude-high.onnx"))
piper_cfg = SynthesisConfig(length_scale=0.93)
lock = Lock()

kokoro = None
KOKORO_DIR = os.path.join(D, "kokoro")
if os.path.exists(os.path.join(KOKORO_DIR, "kokoro-v1.0.onnx")):
    try:
        from kokoro_onnx import Kokoro
        kokoro = Kokoro(os.path.join(KOKORO_DIR, "kokoro-v1.0.onnx"), os.path.join(KOKORO_DIR, "voices-v1.0.bin"))
    except Exception as e:  # Kokoro es opcional
        print("Kokoro no disponible:", e, flush=True)


def synth(text: str, voice: str, speed: float = 1.0) -> bytes:
    buf = io.BytesIO()
    with lock:
        if voice == "kokoro" and kokoro is not None:
            import numpy as np
            samples, rate = kokoro.create(text, voice="em_alex", speed=1.05 * speed, lang="es")
            pcm = (np.clip(samples, -1, 1) * 32767).astype("<i2").tobytes()
            with wave.open(buf, "wb") as w:
                w.setnchannels(1); w.setsampwidth(2); w.setframerate(rate); w.writeframes(pcm)
        else:
            with wave.open(buf, "wb") as w:
                piper_voice.synthesize_wav(text, w, syn_config=SynthesisConfig(length_scale=0.93 / speed))
    return buf.getvalue()


class H(BaseHTTPRequestHandler):
    def log_message(self, *a):  # sin registrar textos
        pass

    def do_GET(self):
        body = json.dumps({"ok": True, "voices": ["piper"] + (["kokoro"] if kokoro else [])}).encode()
        self.send_response(200); self.send_header("Content-Type", "application/json"); self.end_headers(); self.wfile.write(body)

    def do_POST(self):
        if self.path != "/tts" or self.client_address[0] != "127.0.0.1":
            self.send_response(404); self.end_headers(); return
        n = min(int(self.headers.get("Content-Length", 0)), 20000)
        try:
            req = json.loads(self.rfile.read(n) or b"{}")
            text = str(req.get("text", "")).strip()[:2000]
            if not text:
                raise ValueError("texto vacío")
            wav = synth(text, str(req.get("voice", "piper")), min(1.4, max(0.7, float(req.get("speed", 1.0)))))
        except Exception as e:
            self.send_response(400); self.end_headers(); self.wfile.write(str(e).encode()[:200]); return
        self.send_response(200); self.send_header("Content-Type", "audio/wav"); self.send_header("Content-Length", str(len(wav))); self.end_headers(); self.wfile.write(wav)


ThreadingHTTPServer(("127.0.0.1", 7431), H).serve_forever()
