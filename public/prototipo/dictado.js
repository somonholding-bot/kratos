// Dictado para el chat de KRATOS: pulsas una vez para empezar a hablar y otra para terminar (no corta por silencio).
// Mientras hablas, el audio se transcribe por tramos en local (whisper en 127.0.0.1) y el texto va apareciendo en la caja
// para que lo revises y completes antes de enviarlo. Se corta en pausas naturales y nunca a mitad de una frase larga
// salvo que pase de 28 s sin respirar. El audio no se guarda.

const RATE = 16000;
const TRAMO_MIN = 12_000, TRAMO_MAX = 28_000, PAUSA = 450, MAX_TOTAL = 15 * 60_000;
const UMBRAL = 0.012;   // nivel por debajo del cual un fragmento cuenta como silencio
const native = window.webkit?.messageHandlers?.kratos ?? null;
const tell = (msg) => { try { native?.postMessage(msg); } catch {} };

function encodeWav(chunks) {
  const len = chunks.reduce((n, c) => n + c.length, 0);
  const buf = new ArrayBuffer(44 + len * 2), v = new DataView(buf);
  const w = (o, s) => [...s].forEach((ch, i) => v.setUint8(o + i, ch.charCodeAt(0)));
  w(0, 'RIFF'); v.setUint32(4, 36 + len * 2, true); w(8, 'WAVE'); w(12, 'fmt ');
  v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
  v.setUint32(24, RATE, true); v.setUint32(28, RATE * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true);
  w(36, 'data'); v.setUint32(40, len * 2, true);
  let o = 44;
  for (const c of chunks) for (let i = 0; i < c.length; i++, o += 2) v.setInt16(o, Math.max(-1, Math.min(1, c[i])) * 0x7fff, true);
  return new Blob([buf], { type: 'audio/wav' });
}

export class Dictado extends EventTarget {
  activo = false; pendientes = 0; inicio = 0;
  #stream = null; #ctx = null; #tramo = []; #msTramo = 0; #msSilencio = 0; #cola = Promise.resolve(); #limite = null;

  #emit(tipo, detail = {}) { this.dispatchEvent(new CustomEvent(tipo, { detail })); }

  async empezar() {
    if (this.activo) return;
    try {
      this.#stream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
    } catch (e) {
      this.#emit('error', { mensaje: e.name === 'NotAllowedError' ? 'Permiso de micrófono denegado.' : `Micrófono: ${e.message}` });
      return;
    }
    tell({ event: 'ptt', active: true });   // la escucha de «Kratos» se pausa mientras dictas
    this.#ctx = new AudioContext({ sampleRate: RATE });
    await this.#ctx.audioWorklet.addModule('/recorder-worklet.js');
    const node = new AudioWorkletNode(this.#ctx, 'recorder');
    this.#ctx.createMediaStreamSource(this.#stream).connect(node);
    this.#tramo = []; this.#msTramo = 0; this.#msSilencio = 0;
    node.port.onmessage = (e) => this.#muestras(e.data);
    this.activo = true; this.inicio = performance.now();
    this.#limite = setTimeout(() => { this.#emit('aviso', { mensaje: 'Llevas 15 minutos: termino el dictado aquí.' }); this.terminar(); }, MAX_TOTAL);
    this.#emit('estado');
  }

  #muestras(s) {
    if (!this.activo) return;
    let suma = 0; for (const x of s) suma += x * x;
    const rms = Math.sqrt(suma / s.length), ms = (s.length / RATE) * 1000;
    this.#emit('nivel', { nivel: rms });
    this.#tramo.push(s); this.#msTramo += ms;
    this.#msSilencio = rms < UMBRAL ? this.#msSilencio + ms : 0;
    // Corta el tramo en una pausa natural (o, como mucho, a los 28 s) para transcribir mientras sigues hablando
    if ((this.#msTramo >= TRAMO_MIN && this.#msSilencio >= PAUSA) || this.#msTramo >= TRAMO_MAX) this.#enviarTramo();
  }

  #enviarTramo() {
    const tramo = this.#tramo, ms = this.#msTramo;
    this.#tramo = []; this.#msTramo = 0; this.#msSilencio = 0;
    if (ms < 500) return;
    this.pendientes++; this.#emit('estado');
    const wav = encodeWav(tramo);
    // En orden: el texto aparece en el mismo orden en que hablaste
    this.#cola = this.#cola.then(async () => {
      try {
        const r = await fetch('/api/voice/transcribe', { method: 'POST', headers: { 'content-type': 'audio/wav' }, body: wav });
        const d = await r.json();
        if (d.ok && d.text) this.#emit('texto', { texto: d.text });
        else if (d.outcome === 'error') this.#emit('error', { mensaje: d.message || 'La transcripción falló.' });
      } catch { this.#emit('error', { mensaje: 'Sin conexión con KRATOS para transcribir.' }); }
      finally { this.pendientes--; this.#emit('estado'); }
    });
  }

  // Termina: cierra el micrófono y transcribe lo que quedaba. Devuelve cuando todo el texto ya está en la caja.
  async terminar() {
    if (!this.activo) return this.#cola;
    this.activo = false;
    clearTimeout(this.#limite);
    this.#enviarTramo();
    this.#stream?.getTracks().forEach((t) => t.stop());
    this.#ctx?.close().catch(() => {});
    this.#stream = null; this.#ctx = null;
    tell({ event: 'ptt', active: false });
    this.#emit('estado');
    await this.#cola;
    this.#emit('estado');
  }

  cancelar() {
    if (!this.activo) return;
    this.#tramo = []; this.#msTramo = 0;
    this.activo = false; clearTimeout(this.#limite);
    this.#stream?.getTracks().forEach((t) => t.stop());
    this.#ctx?.close().catch(() => {});
    tell({ event: 'ptt', active: false });
    this.#emit('estado');
  }
}
