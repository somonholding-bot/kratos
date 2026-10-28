// Escena de KRATOS: zorro blanco (marcador vectorial propio y provisional), cola de fuego,
// núcleo neuronal y constelación de siete especialistas.
// Uso: const scene = createScene(contenedor, { quality, reducedMotion }); scene.set({ state, level, active })
// La escena solo dibuja lo que se le indica: quien la usa es responsable de pasarle estados reales.

export const AGENTS = [
  { id: 'sol', name: 'Sol', symbol: '☉', color: '#ffc94a', role: 'Propósito e identidad', r: 1.0, speed: 0.10 },
  { id: 'luna', name: 'Luna', symbol: '☾', color: '#cfe3ff', role: 'Memoria y cuidado', r: 0.62, speed: 0.22 },
  { id: 'mercurio', name: 'Mercurio', symbol: '☿', color: '#3fd8ff', role: 'Comunicación e investigación', r: 0.48, speed: 0.34 },
  { id: 'venus', name: 'Venus', symbol: '♀', color: '#ff9a8b', role: 'Arte y sensibilidad', r: 0.7, speed: 0.18 },
  { id: 'marte', name: 'Marte', symbol: '♂', color: '#ff5a36', role: 'Voluntad y ejecución', r: 0.6, speed: 0.15 },
  { id: 'jupiter', name: 'Júpiter', symbol: '♃', color: '#9b7bff', role: 'Expansión y oportunidades', r: 0.95, speed: 0.08 },
  { id: 'saturno', name: 'Saturno', symbol: '♄', color: '#6f7cff', role: 'Estructura y límites', r: 0.85, speed: 0.06 },
];

// Zorro sentado, tres cuartos, mirando a la izquierda. viewBox 0 0 400 420.
// Grupos animables: .fx-body (respira), .fx-head (gira), .fx-ear-* (orejas).
export const FOX_SVG = `
<svg viewBox="0 0 400 420" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="KRATOS, zorro blanco (marcador provisional)">
  <defs>
    <linearGradient id="fx-fur" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#ffffff"/><stop offset=".55" stop-color="#eef3fb"/><stop offset="1" stop-color="#c9d5e8"/>
    </linearGradient>
    <linearGradient id="fx-shade" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0" stop-color="#dfe8f5"/><stop offset="1" stop-color="#aebdd6"/>
    </linearGradient>
    <linearGradient id="fx-ember" x1="0" y1="1" x2="0" y2="0">
      <stop offset="0" stop-color="#ff7a2f"/><stop offset="1" stop-color="#ffd27a"/>
    </linearGradient>
    <radialGradient id="fx-eye"><stop offset="0" stop-color="#fff6d8"/><stop offset=".5" stop-color="#ffc24a"/><stop offset="1" stop-color="#ff7a1a"/></radialGradient>
    <filter id="fx-glow" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="2.4" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter>
    <filter id="fx-soft" x="-20%" y="-20%" width="140%" height="140%"><feDropShadow dx="0" dy="0" stdDeviation="6" flood-color="#9fd8ff" flood-opacity=".35"/></filter>
  </defs>
  <g filter="url(#fx-soft)">
    <!-- arranque de la cola: pelaje que se convierte en fuego (el fuego lo dibuja el lienzo) -->
    <path d="M286 352 C312 344 336 352 350 340 C342 364 318 378 290 378 Z" fill="url(#fx-shade)"/>
    <g class="fx-body">
      <path d="M168 382 C158 300 166 238 204 200 C242 194 288 214 308 256 C338 314 322 384 258 386 Z" fill="url(#fx-fur)"/>
      <path d="M262 250 C292 262 314 300 306 350 C300 372 284 382 262 384 C286 352 288 300 262 250 Z" fill="url(#fx-shade)" opacity=".75"/>
      <path d="M200 302 C203 332 206 360 206 378 L224 380 C222 350 219 323 215 300 Z" fill="#c4d1e6"/>
      <path d="M178 300 C176 330 176 360 172 378 L194 380 C196 352 198 324 200 300 Z" fill="url(#fx-fur)"/>
      <ellipse cx="183" cy="381" rx="15" ry="5.5" fill="#f4f7fd"/>
      <ellipse cx="215" cy="381" rx="13" ry="5" fill="#cdd8ea"/>
      <path d="M184 214 C172 246 177 276 190 302 L197 290 L204 304 L210 288 L217 300 C224 270 227 240 221 214 Z" fill="#ffffff"/>
    </g>
    <path d="M190 168 C187 190 194 206 206 212 L246 206 C250 190 248 176 243 166 Z" fill="url(#fx-fur)"/>
    <g class="fx-head">
      <g class="fx-ear-back"><path d="M226 106 L254 66 L256 120 Z" fill="#d3ddee"/><path d="M234 104 L250 80 L251 112 Z" fill="url(#fx-ember)" opacity=".55"/></g>
      <path d="M249 150 C251 124 239 106 222 102 C204 98 189 107 181 121 L149 161 C146 166 150 171 156 171 L190 173 C206 184 232 184 244 171 C248 165 249 157 249 150 Z" fill="url(#fx-fur)"/>
      <path d="M183 122 L150 161 C148 165 151 168 156 168 L178 166 C176 150 178 134 183 122 Z" fill="#e8eef8"/>
      <path d="M198 172 L208 192 L216 178 L226 194 L236 176 L242 170 C230 182 210 182 198 172 Z" fill="#ffffff"/>
      <g class="fx-ear-front"><path d="M195 112 L198 58 L230 104 Z" fill="url(#fx-fur)"/><path d="M201 104 L203 74 L221 101 Z" fill="url(#fx-ember)" opacity=".8"/></g>
      <g class="fx-eye" filter="url(#fx-glow)">
        <path d="M190 136 C195 129 206 129 211 134 C205 140 196 141 190 136 Z" fill="url(#fx-eye)"/>
        <ellipse cx="201" cy="135" rx="1.4" ry="3.6" fill="#2a1406"/>
      </g>
      <circle cx="152" cy="164" r="4.6" fill="#1b2434"/>
      <path d="M156 170 C166 176 176 177 186 174" stroke="#9fb0c9" stroke-width="1.6" fill="none" stroke-linecap="round"/>
    </g>
  </g>
</svg>`;

// Puntos del zorro en coordenadas del SVG (para anclar fuego y filamento)
const TAIL = [[296, 366], [430, 392], [452, 236], [366, 168]]; // bézier cúbica de la cola
const MIND = [214, 96];                                        // de aquí sale el filamento hacia el núcleo

const QUALITY = { baja: { particles: 110, dpr: 1, stars: 90 }, media: { particles: 240, dpr: 1.5, stars: 160 }, alta: { particles: 420, dpr: 2, stars: 240 } };

const STATE_PRESET = {
  reposo: { expand: 0, core: 0, fire: 0.45, tint: null },
  despertar: { expand: 1, core: 0.7, fire: 1.0, tint: null },
  escuchando: { expand: 1, core: 0.8, fire: 0.8, tint: null },
  pensando: { expand: 1, core: 0.6, fire: 0.7, tint: null },
  hablando: { expand: 1, core: 0.8, fire: 0.85, tint: null },
  ejecutando: { expand: 1, core: 0.7, fire: 0.9, tint: null },
  esperando_permiso: { expand: 1, core: 0.5, fire: 0.6, tint: '#ffb547' },
  detenido: { expand: 0.6, core: 0.25, fire: 0.15, tint: '#ff4d5e' },
};

const lerp = (a, b, t) => a + (b - a) * t;
const bez = (p, t) => {
  const u = 1 - t;
  return [0, 1].map((k) => u * u * u * p[0][k] + 3 * u * u * t * p[1][k] + 3 * u * t * t * p[2][k] + t * t * t * p[3][k]);
};
const hexA = (hex, a) => { const n = parseInt(hex.slice(1), 16); return `rgba(${n >> 16},${(n >> 8) & 255},${n & 255},${a})`; };

export function createScene(root, opts = {}) {
  root.classList.add('kscene');
  root.innerHTML = `<canvas class="kscene-canvas" aria-hidden="true"></canvas><div class="kscene-fox">${FOX_SVG}</div>`;
  const canvas = root.querySelector('canvas');
  const foxEl = root.querySelector('.kscene-fox');
  const ctx = canvas.getContext('2d');

  const s = {
    state: 'reposo', level: 0, active: [], selected: null,
    quality: opts.quality ?? 'media', reduced: !!opts.reducedMotion,
    expand: 0, core: 0, fire: 0.45, tint: null, t: 0, last: 0, raf: 0, fps: 0, frames: 0, fpsAt: 0, drawMs: 0,
    particles: [], stars: null, w: 0, h: 0, dpr: 1, fox: { x: 0, y: 0, k: 1, dir: 1, target: 0.2, wait: 0 },
    hits: [],
  };

  function resize() {
    const r = root.getBoundingClientRect();
    s.dpr = Math.min(window.devicePixelRatio || 1, QUALITY[s.quality].dpr);
    s.w = Math.max(320, r.width); s.h = Math.max(240, r.height);
    canvas.width = Math.round(s.w * s.dpr); canvas.height = Math.round(s.h * s.dpr);
    canvas.style.width = `${s.w}px`; canvas.style.height = `${s.h}px`;
    s.stars = makeStars();
    layoutFox();
    if (!s.raf) draw(performance.now());
  }

  function makeStars() {
    const off = document.createElement('canvas');
    off.width = canvas.width; off.height = canvas.height;
    const c = off.getContext('2d');
    const g = c.createLinearGradient(0, 0, 0, off.height);
    g.addColorStop(0, '#04060d'); g.addColorStop(1, '#070b18');
    c.fillStyle = g; c.fillRect(0, 0, off.width, off.height);
    for (const [x, y, col, rad] of [[0.72, 0.3, '#3a2a7a', 0.45], [0.25, 0.75, '#0f3a55', 0.4], [0.55, 0.55, '#2a1440', 0.3]]) {
      const n = c.createRadialGradient(x * off.width, y * off.height, 0, x * off.width, y * off.height, rad * off.width);
      n.addColorStop(0, hexA(col, 0.35)); n.addColorStop(1, 'rgba(0,0,0,0)');
      c.fillStyle = n; c.fillRect(0, 0, off.width, off.height);
    }
    for (let i = 0; i < QUALITY[s.quality].stars; i++) {
      const a = Math.random() * 0.7 + 0.15;
      c.fillStyle = `rgba(220,235,255,${a})`;
      c.beginPath(); c.arc(Math.random() * off.width, Math.random() * off.height, Math.random() * 1.2 * s.dpr + 0.2, 0, 7); c.fill();
    }
    return off;
  }

  // El zorro ocupa ~45 % de la altura, abajo a la izquierda; nunca tapa la zona central de trabajo.
  function layoutFox() {
    const k = (s.h * 0.46) / 420;
    s.fox.k = k;
    s.fox.y = s.h - 420 * k - s.h * 0.04;
    if (!s.fox.x) s.fox.x = s.w * 0.08;
    foxEl.style.width = `${400 * k}px`;
    placeFox();
  }
  function placeFox() {
    foxEl.style.transform = `translate(${s.fox.x}px, ${s.fox.y}px) scaleX(${s.fox.dir < 0 ? -1 : 1})`;
  }
  const foxPt = ([x, y]) => {
    const fx = s.fox.dir < 0 ? 400 - x : x;
    return [(s.fox.x + fx * s.fox.k) * s.dpr, (s.fox.y + y * s.fox.k) * s.dpr];
  };

  function set(next) {
    if (next.state && STATE_PRESET[next.state]) s.state = next.state;
    if (typeof next.level === 'number') s.level = Math.max(s.level, Math.min(1, next.level));
    if (Array.isArray(next.active)) s.active = next.active;
    if ('selected' in next) s.selected = next.selected;
    if (next.quality && QUALITY[next.quality]) { s.quality = next.quality; resize(); }
    if (typeof next.reducedMotion === 'boolean') s.reduced = next.reducedMotion;
    root.dataset.state = s.state;
    if (s.reduced) { const p = STATE_PRESET[s.state]; s.expand = p.expand; s.core = p.core; s.fire = p.fire; s.tint = p.tint; draw(performance.now()); }
    else start();
  }

  // Reposo: el zorro cambia de sitio despacio dentro de su franja (sin cruzar el centro).
  function wander(dt) {
    const f = s.fox;
    if (s.state !== 'reposo') { f.target = 0.08; }
    else if (f.wait > 0) f.wait -= dt;
    else if (Math.abs(f.x / s.w - f.target) < 0.004) { f.target = 0.03 + Math.random() * 0.2; f.wait = 6 + Math.random() * 10; }
    const goal = f.target * s.w;
    const dx = goal - f.x;
    // El dibujo mira a la izquierda; dir = -1 lo voltea para mirar a la derecha (hacia el núcleo).
    if (Math.abs(dx) > 1) { f.dir = s.state === 'reposo' ? (dx > 0 ? -1 : 1) : -1; f.x += Math.sign(dx) * Math.min(Math.abs(dx), dt * s.w * 0.025); }
    else if (s.state !== 'reposo') f.dir = -1;
    placeFox();
    foxEl.classList.toggle('walking', Math.abs(dx) > 1 && s.state === 'reposo');
  }

  function spawn(n) {
    const want = Math.round(QUALITY[s.quality].particles * s.fire);
    for (let i = 0; i < n && s.particles.length < want; i++) {
      const t = Math.pow(Math.random(), 0.55);                 // más densidad hacia la punta
      const [x, y] = foxPt(bez(TAIL, t));
      const [x2, y2] = foxPt(bez(TAIL, Math.min(1, t + 0.02)));
      const tx = (x2 - x), ty = (y2 - y), tl = Math.hypot(tx, ty) || 1;
      const sp = (20 + Math.random() * 40) * s.dpr;
      s.particles.push({ x: x + (Math.random() - 0.5) * 10 * s.dpr * (0.4 + t), y, vx: (tx / tl) * sp * 0.6 + (Math.random() - 0.5) * 18 * s.dpr, vy: -sp - Math.random() * 30 * s.dpr, life: 0, max: 0.5 + Math.random() * 0.7, size: (3 + Math.random() * 9 * (0.5 + t)) * s.dpr });
    }
  }

  function drawFire(dt) {
    ctx.globalCompositeOperation = 'lighter';
    // cuerpo de la llama a lo largo de la cola
    for (let i = 0; i <= 24; i++) {
      const t = i / 24;
      const [x, y] = foxPt(bez(TAIL, t));
      const flick = s.reduced ? 1 : 0.85 + 0.15 * Math.sin(s.t * 9 + i * 1.7) * Math.sin(s.t * 5.3 + i);
      const r = (8 + 22 * Math.sin(Math.PI * Math.min(1, t * 1.1))) * s.dpr * s.fox.k * 2.6 * (0.6 + s.fire * 0.6) * flick;
      const g = ctx.createRadialGradient(x, y, 0, x, y, r);
      g.addColorStop(0, `rgba(255,240,200,${0.35 * s.fire})`); g.addColorStop(0.4, `rgba(255,140,40,${0.25 * s.fire})`); g.addColorStop(1, 'rgba(255,60,0,0)');
      ctx.fillStyle = g; ctx.beginPath(); ctx.arc(x, y, r, 0, 7); ctx.fill();
    }
    if (!s.reduced) {
      spawn(Math.ceil(dt * 400));
      for (const p of s.particles) {
        p.life += dt; p.x += p.vx * dt; p.y += p.vy * dt; p.vx *= 0.97; p.vy -= 12 * s.dpr * dt;
        const k = p.life / p.max;
        const a = (1 - k) * 0.55 * s.fire;
        const r = p.size * (1 - k * 0.6);
        const col = k < 0.25 ? `rgba(255,236,190,${a})` : k < 0.6 ? `rgba(255,150,50,${a})` : `rgba(230,60,20,${a * 0.8})`;
        ctx.fillStyle = col; ctx.beginPath(); ctx.arc(p.x, p.y, r, 0, 7); ctx.fill();
      }
      s.particles = s.particles.filter((p) => p.life < p.max);
    }
    ctx.globalCompositeOperation = 'source-over';
  }

  function corePos() { return [s.w * 0.6 * s.dpr, s.h * 0.44 * s.dpr]; }

  function drawCore(t) {
    if (s.core < 0.02) return;
    const [cx, cy] = corePos();
    const lvl = s.state === 'escuchando' || s.state === 'hablando' ? s.level : 0;
    const base = Math.min(s.w, s.h) * 0.075 * s.dpr * (0.5 + s.expand * 0.5);
    const breathe = s.state === 'pensando' ? Math.sin(t * 2.2) * 0.08 : Math.sin(t * 0.9) * 0.03;
    const R = base * (1 + breathe + lvl * 0.45);
    const tint = s.tint ?? '#7fd8ff';
    ctx.globalCompositeOperation = 'lighter';
    const halo = ctx.createRadialGradient(cx, cy, 0, cx, cy, R * 3.2);
    halo.addColorStop(0, hexA(tint, 0.35 * s.core)); halo.addColorStop(0.4, hexA('#6a5cff', 0.12 * s.core)); halo.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = halo; ctx.beginPath(); ctx.arc(cx, cy, R * 3.2, 0, 7); ctx.fill();
    // sinapsis: filamentos curvos que giran y laten
    const n = 14;
    ctx.lineWidth = 1.1 * s.dpr;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2 + t * (s.state === 'pensando' ? 0.5 : 0.18);
      const len = R * (1.3 + 0.5 * Math.sin(t * 1.7 + i * 1.3) + lvl * 0.8);
      const ex = cx + Math.cos(a) * len, ey = cy + Math.sin(a) * len;
      const mx = cx + Math.cos(a + 0.6) * len * 0.6, my = cy + Math.sin(a + 0.6) * len * 0.6;
      ctx.strokeStyle = hexA(tint, 0.35 * s.core);
      ctx.beginPath(); ctx.moveTo(cx, cy); ctx.quadraticCurveTo(mx, my, ex, ey); ctx.stroke();
      ctx.fillStyle = hexA('#ffffff', 0.6 * s.core); ctx.beginPath(); ctx.arc(ex, ey, 1.6 * s.dpr, 0, 7); ctx.fill();
    }
    const g = ctx.createRadialGradient(cx - R * 0.25, cy - R * 0.3, R * 0.1, cx, cy, R);
    g.addColorStop(0, hexA('#ffffff', 0.95 * s.core)); g.addColorStop(0.45, hexA(tint, 0.75 * s.core)); g.addColorStop(1, hexA('#3a2fa8', 0.25 * s.core));
    ctx.fillStyle = g; ctx.beginPath(); ctx.arc(cx, cy, R, 0, 7); ctx.fill();
    ctx.globalCompositeOperation = 'source-over';
    // filamento mente: del zorro al núcleo
    const [mx, my] = foxPt(MIND);
    ctx.strokeStyle = hexA(tint, 0.25 * s.core); ctx.lineWidth = 1.4 * s.dpr;
    ctx.beginPath(); ctx.moveTo(mx, my); ctx.bezierCurveTo(mx + 60 * s.dpr, my - 80 * s.dpr, cx - 120 * s.dpr, cy - 40 * s.dpr, cx, cy); ctx.stroke();
    if (!s.reduced) {
      const k = (t * 0.6) % 1;
      const px = Math.pow(1 - k, 3) * mx + 3 * Math.pow(1 - k, 2) * k * (mx + 60 * s.dpr) + 3 * (1 - k) * k * k * (cx - 120 * s.dpr) + k * k * k * cx;
      const py = Math.pow(1 - k, 3) * my + 3 * Math.pow(1 - k, 2) * k * (my - 80 * s.dpr) + 3 * (1 - k) * k * k * (cy - 40 * s.dpr) + k * k * k * cy;
      ctx.fillStyle = hexA('#ffffff', 0.8 * s.core); ctx.beginPath(); ctx.arc(px, py, 2.2 * s.dpr, 0, 7); ctx.fill();
    }
  }

  function drawPlanet(a, x, y, rad, alpha, t) {
    ctx.save(); ctx.globalAlpha = alpha;
    const g = ctx.createRadialGradient(x - rad * 0.35, y - rad * 0.35, rad * 0.1, x, y, rad);
    if (a.id === 'sol') {
      ctx.globalCompositeOperation = 'lighter';
      const c = ctx.createRadialGradient(x, y, rad * 0.4, x, y, rad * 2.6);
      c.addColorStop(0, 'rgba(255,210,90,.55)'); c.addColorStop(1, 'rgba(255,150,0,0)');
      ctx.fillStyle = c; ctx.beginPath(); ctx.arc(x, y, rad * 2.6, 0, 7); ctx.fill();
      ctx.globalCompositeOperation = 'source-over';
      g.addColorStop(0, '#fffbe6'); g.addColorStop(0.5, '#ffd25a'); g.addColorStop(1, '#ff9a1a');
    } else if (a.id === 'luna') {
      g.addColorStop(0, '#ffffff'); g.addColorStop(1, '#9fb4d6');
    } else if (a.id === 'jupiter') {
      g.addColorStop(0, '#d9ccff'); g.addColorStop(1, '#4b2fa8');
    } else {
      g.addColorStop(0, '#ffffff'); g.addColorStop(0.25, a.color); g.addColorStop(1, hexA(a.color, 0.35));
    }
    if (a.id === 'saturno') ringHalf(x, y, rad, true, a.color);
    ctx.fillStyle = g; ctx.beginPath(); ctx.arc(x, y, rad, 0, 7); ctx.fill();
    if (a.id === 'luna') { ctx.fillStyle = 'rgba(8,12,26,.55)'; ctx.beginPath(); ctx.arc(x + rad * 0.45, y - rad * 0.1, rad * 0.9, 0, 7); ctx.fill(); }
    if (a.id === 'jupiter') {
      ctx.save(); ctx.beginPath(); ctx.arc(x, y, rad, 0, 7); ctx.clip();
      for (let i = -2; i <= 2; i++) { ctx.fillStyle = i % 2 ? 'rgba(255,220,255,.18)' : 'rgba(40,10,90,.25)'; ctx.fillRect(x - rad, y + i * rad * 0.32 - rad * 0.08, rad * 2, rad * 0.16); }
      ctx.restore();
    }
    if (a.id === 'marte') { ctx.fillStyle = 'rgba(110,20,10,.35)'; ctx.beginPath(); ctx.arc(x + rad * 0.2, y + rad * 0.25, rad * 0.35, 0, 7); ctx.fill(); }
    if (a.id === 'saturno') ringHalf(x, y, rad, false, a.color);
    if (a.id === 'mercurio' && !s.reduced) {
      ctx.strokeStyle = hexA(a.color, 0.35); ctx.lineWidth = rad * 0.6; ctx.lineCap = 'round';
      ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x - rad * 2.4, y - rad * 0.4); ctx.stroke();
    }
    ctx.restore();
  }
  function ringHalf(x, y, rad, back, color) {
    ctx.strokeStyle = hexA(color, back ? 0.35 : 0.8); ctx.lineWidth = rad * 0.22;
    ctx.beginPath(); ctx.ellipse(x, y, rad * 2, rad * 0.55, -0.35, back ? Math.PI : 0, back ? Math.PI * 2 : Math.PI); ctx.stroke();
  }

  function drawConstellation(t) {
    s.hits = [];
    if (s.expand < 0.02) return;
    const [cx, cy] = corePos();
    const Rx = Math.min(s.w * 0.36, s.h * 0.62) * s.dpr * s.expand;
    const placed = AGENTS.map((a, i) => {
      const ang = (i / AGENTS.length) * Math.PI * 2 + (s.reduced ? 0 : t * a.speed * 0.6) + 0.4;
      const orbit = 0.55 + (i % 3) * 0.2;
      const z = Math.sin(ang);
      return { a, x: cx + Math.cos(ang) * Rx * orbit, y: cy + z * Rx * orbit * 0.32, z, orbit };
    });
    // órbitas tenues
    ctx.lineWidth = 1 * s.dpr;
    for (const o of [0.55, 0.75, 0.95]) {
      ctx.strokeStyle = `rgba(150,170,255,${0.07 * s.expand})`;
      ctx.beginPath(); ctx.ellipse(cx, cy, Rx * o, Rx * o * 0.32, 0, 0, 7); ctx.stroke();
    }
    const busy = new Set(s.active);
    const waiting = s.state === 'esperando_permiso';
    for (const p of placed.sort((m, n) => m.z - n.z)) {
      const isActive = busy.has(p.a.id) || (waiting && p.a.id === 'saturno');
      const depth = 0.7 + (p.z + 1) * 0.25;
      const rad = (5 + 9 * p.a.r) * s.dpr * depth * (0.6 + 0.4 * s.expand) * (isActive ? 1.25 : 1);
      const dim = s.active.length || waiting ? (isActive ? 1 : 0.35) : 0.85;
      // conexión solo para agentes realmente implicados
      if (isActive) {
        ctx.strokeStyle = hexA(waiting ? '#ffb547' : p.a.color, 0.55 * s.expand); ctx.lineWidth = 1.6 * s.dpr;
        ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(p.x, p.y); ctx.stroke();
        if (!s.reduced) {
          const k = (t * 0.9 + p.orbit) % 1;
          ctx.fillStyle = '#ffffff'; ctx.beginPath(); ctx.arc(lerp(cx, p.x, k), lerp(cy, p.y, k), 2.4 * s.dpr, 0, 7); ctx.fill();
        }
        ctx.strokeStyle = hexA(waiting ? '#ffb547' : p.a.color, 0.9); ctx.lineWidth = 1.5 * s.dpr;
        ctx.beginPath(); ctx.arc(p.x, p.y, rad * 1.7 + Math.sin(t * 4) * s.dpr, 0, 7); ctx.stroke();
      }
      drawPlanet(p.a, p.x, p.y, rad, dim * s.expand, t);
      if (s.selected === p.a.id) { ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 2 * s.dpr; ctx.setLineDash([4 * s.dpr, 4 * s.dpr]); ctx.beginPath(); ctx.arc(p.x, p.y, rad * 2.1, 0, 7); ctx.stroke(); ctx.setLineDash([]); }
      if (s.expand > 0.6) {
        ctx.font = `${12 * s.dpr}px system-ui, sans-serif`; ctx.textAlign = 'center';
        ctx.fillStyle = `rgba(230,240,255,${(isActive ? 0.95 : 0.6) * s.expand})`;
        ctx.fillText(`${p.a.symbol} ${p.a.name}`, p.x, p.y + rad + 16 * s.dpr);
      }
      s.hits.push({ id: p.a.id, x: p.x / s.dpr, y: p.y / s.dpr, r: Math.max(18, rad / s.dpr * 2) });
    }
  }

  function draw(now) {
    const t0 = performance.now();
    const dt = Math.min(0.05, (now - (s.last || now)) / 1000);
    s.last = now; s.t += dt;
    const p = STATE_PRESET[s.state];
    const ease = s.reduced ? 1 : 1 - Math.pow(0.02, dt);
    s.expand = lerp(s.expand, p.expand, ease * 0.9);
    s.core = lerp(s.core, p.core, ease);
    s.fire = lerp(s.fire, p.fire, ease);
    s.tint = p.tint;
    if (!s.reduced) wander(dt);
    s.level *= Math.pow(0.04, dt); // el nivel cae solo si deja de llegar señal real
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    if (s.stars) ctx.drawImage(s.stars, 0, 0); else { ctx.fillStyle = '#04060d'; ctx.fillRect(0, 0, canvas.width, canvas.height); }
    if (s.tint) { ctx.fillStyle = hexA(s.tint, 0.06); ctx.fillRect(0, 0, canvas.width, canvas.height); }
    drawConstellation(s.t);
    drawCore(s.t);
    drawFire(dt);
    s.drawMs = s.drawMs * 0.9 + (performance.now() - t0) * 0.1;
    s.frames++;
    if (now - s.fpsAt > 1000) { s.fps = s.frames; s.frames = 0; s.fpsAt = now; }
  }

  function loop(now) {
    s.raf = 0;
    if (document.hidden || s.reduced || !root.offsetParent) return; // sin dibujo si no se ve o con movimiento reducido
    draw(now);
    s.raf = requestAnimationFrame(loop);
  }
  function start() { if (!s.raf && !document.hidden && !s.reduced && root.offsetParent) s.raf = requestAnimationFrame(loop); }
  // Pulso real de voz (una palabra pronunciada) o de micrófono.
  function pulse(amount = 0.75) { s.level = Math.min(1, Math.max(s.level, amount)); }
  function stop() { cancelAnimationFrame(s.raf); s.raf = 0; }

  document.addEventListener('visibilitychange', () => (document.hidden ? stop() : start()));
  new ResizeObserver(resize).observe(root);
  canvas.addEventListener('click', (e) => {
    const r = canvas.getBoundingClientRect();
    const x = e.clientX - r.left, y = e.clientY - r.top;
    const hit = s.hits.find((h) => Math.hypot(h.x - x, h.y - y) < h.r);
    root.dispatchEvent(new CustomEvent('agent-select', { detail: hit?.id ?? null }));
  });

  resize();
  set({ state: s.state });
  return { set, stop, start, pulse, get fps() { return s.fps; }, get drawMs() { return s.drawMs; }, get state() { return s.state; } };
}
