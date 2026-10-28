// Voz de Kratos: pulsar para hablar. El micrófono solo está abierto mientras mantienes pulsado;
// al soltar se cierran sus pistas (el indicador naranja de macOS se apaga). El audio va solo
// a 127.0.0.1 y se transcribe localmente; no se guarda.

const RATE = 16000;
const MAX_MS = 30000;

// Dentro de la app de Mac existe un puente nativo: la voz sale por la app y la escucha
// continua de «Kratos» se pausa mientras usas «pulsar para hablar».
const native = window.webkit?.messageHandlers?.kratos ?? null;
const tell = (msg) => { try { native?.postMessage(msg); } catch {} };
export const isNative = !!native;

function store(key, val) { try { if (val === undefined) return localStorage.getItem(key); localStorage.setItem(key, val); } catch { return null; } }

function encodeWav(chunks) {
  const len = chunks.reduce((n, c) => n + c.length, 0);
  const buf = new ArrayBuffer(44 + len * 2);
  const v = new DataView(buf);
  const w = (o, s) => [...s].forEach((ch, i) => v.setUint8(o + i, ch.charCodeAt(0)));
  w(0, 'RIFF'); v.setUint32(4, 36 + len * 2, true); w(8, 'WAVE'); w(12, 'fmt ');
  v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
  v.setUint32(24, RATE, true); v.setUint32(28, RATE * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true);
  w(36, 'data'); v.setUint32(40, len * 2, true);
  let o = 44;
  for (const c of chunks) for (let i = 0; i < c.length; i++, o += 2) v.setInt16(o, Math.max(-1, Math.min(1, c[i])) * 0x7fff, true);
  return new Blob([buf], { type: 'audio/wav' });
}

export class Voice extends EventTarget {
  state = 'inactivo'; // inactivo | escuchando | transcribiendo | hablando
  muted = store('kratos.micMuted') === '1';
  deviceId = store('kratos.micDevice') || '';
  voiceURI = store('kratos.ttsVoice') || '';
  speakReplies = store('kratos.speak') !== '0';
  level = 0;
  #stream = null; #ctx = null; #chunks = []; #timer = null; #abort = null; #startedAt = 0;

  get supported() { return !!(navigator.mediaDevices?.getUserMedia && window.AudioWorkletNode); }

  #set(state, detail = {}) { this.state = state; this.dispatchEvent(new CustomEvent('change', { detail: { state, ...detail } })); }

  setMuted(m) {
    this.muted = m; store('kratos.micMuted', m ? '1' : '0');
    tell({ event: 'mute', muted: m });
    if (m && this.state === 'escuchando') this.cancel();
    this.#set(this.state);
  }
  setDevice(id) { this.deviceId = id; store('kratos.micDevice', id); }
  setVoice(uri) { this.voiceURI = uri; store('kratos.ttsVoice', uri); }
  setSpeak(on) { this.speakReplies = on; store('kratos.speak', on ? '1' : '0'); if (!on) this.interrupt(); }

  async devices() {
    const all = await navigator.mediaDevices.enumerateDevices();
    return all.filter((d) => d.kind === 'audioinput');
  }

  setWake(enabled) { tell({ event: 'wake', enabled }); }
  setWakeConfig(cfg) { tell({ event: 'config', ...cfg }); }

  spanishVoices() {
    return speechSynthesis.getVoices().filter((v) => v.lang.toLowerCase().startsWith('es'));
  }

  async start() {
    if (this.muted || this.state === 'escuchando' || this.state === 'transcribiendo') return;
    this.interrupt(); // nunca escuchar mientras habla: evita que su propia voz entre por el micrófono
    tell({ event: 'ptt', active: true });
    try {
      this.#stream = await navigator.mediaDevices.getUserMedia({
        audio: { deviceId: this.deviceId ? { exact: this.deviceId } : undefined, channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      });
    } catch (e) {
      const msg = e.name === 'NotAllowedError' ? 'Permiso de micrófono denegado en el navegador.' :
        e.name === 'OverconstrainedError' || e.name === 'NotFoundError' ? 'El micrófono elegido no está disponible. Elige otro en Configuración.' : `Micrófono: ${e.message}`;
      this.#set('inactivo', { error: msg });
      tell({ event: 'ptt', active: false });
      return;
    }
    this.#stream.getAudioTracks()[0].addEventListener('ended', () => {
      if (this.state === 'escuchando') { this.#release(); this.#set('inactivo', { error: 'El micrófono se desconectó.' }); }
    });
    this.#ctx = new AudioContext({ sampleRate: RATE });
    await this.#ctx.audioWorklet.addModule('/recorder-worklet.js');
    const src = this.#ctx.createMediaStreamSource(this.#stream);
    const node = new AudioWorkletNode(this.#ctx, 'recorder');
    this.#chunks = [];
    node.port.onmessage = (e) => {
      this.#chunks.push(e.data);
      let peak = 0; for (const s of e.data) peak = Math.max(peak, Math.abs(s));
      this.level = this.level * 0.8 + peak * 0.2;
      this.dispatchEvent(new CustomEvent('level', { detail: this.level }));
    };
    src.connect(node);
    this.#startedAt = performance.now();
    this.#timer = setTimeout(() => this.stop(), MAX_MS);
    this.#set('escuchando');
  }

  #release() {
    tell({ event: 'ptt', active: false });
    clearTimeout(this.#timer);
    this.#stream?.getTracks().forEach((t) => t.stop());
    this.#ctx?.close().catch(() => {});
    this.#stream = null; this.#ctx = null; this.level = 0;
  }

  // Suelta el botón: cierra el micrófono y transcribe localmente.
  async stop() {
    if (this.state !== 'escuchando') return null;
    const chunks = this.#chunks; this.#chunks = [];
    const heldMs = performance.now() - this.#startedAt;
    this.#release();
    if (heldMs < 400) { this.#set('inactivo', { error: 'Mantén pulsado mientras hablas.' }); return null; }
    this.#set('transcribiendo');
    this.#abort = new AbortController();
    try {
      const r = await fetch('/api/voice/transcribe', { method: 'POST', headers: { 'content-type': 'audio/wav' }, body: encodeWav(chunks), signal: this.#abort.signal });
      const data = await r.json();
      this.#set('inactivo', data.ok ? {} : { error: data.message || data.error });
      return data.ok ? data : null;
    } catch (e) {
      this.#set('inactivo', { error: e.name === 'AbortError' ? 'Cancelado.' : 'Sin conexión con Kratos.' });
      return null;
    } finally { this.#abort = null; }
  }

  // Cancela lo que esté en curso: grabación o transcripción.
  cancel() {
    if (this.state === 'escuchando') { this.#chunks = []; this.#release(); this.#set('inactivo', { error: 'Cancelado.' }); }
    this.#abort?.abort();
  }

  speak(text) {
    return new Promise((resolve) => {
      if (!this.speakReplies || !text) return resolve(null);
      if (native) {
        const t0 = performance.now();
        this.#set('hablando');
        window.kratosSpoke = () => { if (this.state === 'hablando') this.#set('inactivo'); resolve(null); };
        tell({ event: 'speak', text });
        return void t0;
      }
      const u = new SpeechSynthesisUtterance(text.replace(/[¿¡*_#`]/g, ''));
      const v = this.spanishVoices().find((x) => x.voiceURI === this.voiceURI) || this.spanishVoices().find((x) => x.localService) || null;
      if (v) { u.voice = v; u.lang = v.lang; } else u.lang = 'es-ES';
      const t0 = performance.now(); let startMs = null;
      u.onboundary = () => this.dispatchEvent(new CustomEvent('pulse'));
      u.onstart = () => { startMs = Math.round(performance.now() - t0); this.#set('hablando'); };
      u.onend = u.onerror = () => { if (this.state === 'hablando') this.#set('inactivo'); resolve(startMs); };
      speechSynthesis.speak(u);
    });
  }

  interrupt() {
    tell({ event: 'hush' });
    if (speechSynthesis.speaking || speechSynthesis.pending) speechSynthesis.cancel();
    if (this.state === 'hablando') this.#set('inactivo');
  }
}
