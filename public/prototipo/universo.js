// KRATOS · prototipo de universo a pantalla completa (Three.js, sin activos de terceros).
// Composición fija: la mente de KRATOS en el centro, su zorro de luz y siete especialistas
// siempre visibles, unidos por ramificaciones neuronales. El brillo ambiental es lento y no
// viaja; los impulsos que viajan solo aparecen con un evento (aquí, simulado con teclas).
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { makeStarfield, makeBrightStars, makeGalaxies, makeNebula as makeDeepSky } from './cielo.js?v=cinema-4';
import { planetMaterial, ringMaterial } from './astros.js?v=cinema-4';

const AGENTS = [
  { id: 'sol', real: '#ffad3d', name: 'Sol', symbol: '☉', color: '#ffc24a', size: 0.83, role: 'Propósito e identidad' },
  { id: 'mercurio', real: '#a89c90', name: 'Mercurio', symbol: '☿', color: '#46d9ff', size: 0.37, role: 'Investigación y comunicación' },
  { id: 'venus', real: '#f3e2b5', name: 'Venus', symbol: '♀', color: '#ff9c8a', size: 0.54, role: 'Belleza, arte y sensibilidad' },
  { id: 'marte', real: '#d9714a', name: 'Marte', symbol: '♂', color: '#ff5533', size: 0.48, role: 'Iniciativa y ejecución' },
  { id: 'jupiter', real: '#e5cfae', name: 'Júpiter', symbol: '♃', color: '#a184ff', size: 0.75, role: 'Expansión y oportunidades' },
  { id: 'saturno', real: '#ead7a8', name: 'Saturno', symbol: '♄', color: '#7482ff', size: 0.59, role: 'Estructura, tiempo y límites' },
  { id: 'luna', real: '#c9c9c9', name: 'Luna', symbol: '☾', color: '#d4e4ff', size: 0.45, role: 'Memoria, hábitos y cuidado' },
];
const QUALITY = {
  baja: { dpr: 1, bloom: false, stars: 11000, bright: 20, galaxies: 6, fox: 5000, strands: 4, neurons: 3000, fire: 500, field: 450 },
  media: { dpr: 1.25, bloom: true, stars: 28000, bright: 48, galaxies: 12, fox: 11000, strands: 6, neurons: 7000, fire: 1100, field: 900 },
  alta: { dpr: 2, bloom: true, stars: 44000, bright: 80, galaxies: 18, fox: 16000, strands: 8, neurons: 12000, fire: 1800, field: 1500 },
};
const STATES = ['reposo', 'escuchando', 'pensando', 'hablando', 'ejecutando', 'esperando_permiso', 'detenido'];
const STATE_NAME = { reposo: 'en reposo', escuchando: 'escuchando', pensando: 'pensando', hablando: 'hablando', ejecutando: 'ejecutando', esperando_permiso: 'esperando permiso', detenido: 'detenido' };

const store = (k, v) => { try { if (v === undefined) return localStorage.getItem(k); localStorage.setItem(k, v); } catch { return null; } };
const prefersReduced = matchMedia('(prefers-reduced-motion: reduce)').matches;

const ui = {
  quality: store('kratos.proto.quality') || 'media',
  reduced: prefersReduced || store('kratos.proto.reduced') === '1',
  paused: false, muted: false, state: 'reposo', stateSimulated: false,
};
const real = { agents: [], businesses: [], overview: null, connected: false, state: 'reposo' };
// Modo integrado (dentro del panel): sin controles ni salida propios
const embedded = new URLSearchParams(location.search).has('embed');
if (embedded) document.documentElement.classList.add('embed');
// Voz real desde la app de Mac: despertar, nivel del micrófono y pulsos de cada palabra de KRATOS
const voice = { nativeState: null, enabled: true, awake: false, wokeAt: 0, level: 0, pulse: 0, thinking: false, burst: 0 };
// «¡Pum!»: al despertar y en cada golpe de voz, el núcleo, las neuronas y el cielo se expanden y vuelven
const boom = (k) => { voice.burst = Math.max(voice.burst, k); if (k >= 0.6 && world?.shock) world.shock.t = 0; };
const nativeBridge = window.webkit?.messageHandlers?.kratos ?? null;
window.kratosNativeState = (state, enabled) => {
  voice.nativeState = state; voice.enabled = enabled;
  if (state === 'Di «Kratos»' || state === 'Escucha apagada') voice.awake = false;
  ui.muted = !enabled; document.querySelector('[data-act="mute"]')?.setAttribute('aria-pressed', ui.muted);
};
window.kratosWoke = () => { voice.awake = true; voice.wokeAt = performance.now(); boom(1); log('KRATOS ha despertado'); };
window.kratosSpeechPulse = () => { voice.pulse = 1; boom(0.45); };
window.kratosMicLevel = (v) => { const l = Math.min(1, v * 9); if (l > voice.level + 0.35) boom(Math.min(1, l)); voice.level = l; };
window.kratosRefresh = () => refreshReal();
function voiceState() {
  const w = voice.nativeState;
  if (performance.now() - voice.wokeAt < 1200) return 'escuchando';
  if (w === 'Respondiendo') return 'hablando';
  if (voice.awake && w === 'Procesando…') return 'pensando';
  if (voice.awake && (w === 'Te escucho…' || w === 'Oyendo…')) return 'escuchando';
  return null;
}

async function api(path, body) {
  const options = body === undefined ? {} : { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) };
  const response = await fetch(path, options);
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`);
  return data;
}

const agentData = (id) => real.agents.find((agent) => agent.id === id);
const taskState = (id) => agentData(id)?.current_task?.status ?? null;
const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));

// ---------- motor ----------
const canvas = document.getElementById('universo');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
renderer.setClearColor(0x010208, 1);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 0.58;
renderer.info.autoReset = false; // contamos todas las pasadas del fotograma
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(42, innerWidth / innerHeight, 0.1, 300);
camera.position.set(0, 0.25, 14);
let composer, bloom;
let world = null; // todo lo construido según la calidad

const U = { time: { value: 0 }, dim: { value: 1 }, pixelRatio: { value: 1 }, speak: { value: 0 } };
const MIND_POS = new THREE.Vector3(0, 0.7, 0);

function radialTexture(stops, size = 256) {
  const c = document.createElement('canvas'); c.width = c.height = size;
  const g = c.getContext('2d');
  const grd = g.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  for (const [o, col] of stops) grd.addColorStop(o, col);
  g.fillStyle = grd; g.fillRect(0, 0, size, size);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}
const rand = (a, b) => a + Math.random() * (b - a);

// ---------- fondo: nebulosa y estrellas ----------
function makeNebula() {
  const m = new THREE.ShaderMaterial({
    uniforms: { uTime: U.time, uDim: U.dim },
    vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.9999, 1.0); }`,
    fragmentShader: `
      varying vec2 vUv; uniform float uTime; uniform float uDim;
      float h(vec2 p){ return fract(sin(dot(p, vec2(127.1,311.7))) * 43758.5453); }
      float n(vec2 p){ vec2 i=floor(p), f=fract(p); f=f*f*(3.0-2.0*f);
        return mix(mix(h(i),h(i+vec2(1,0)),f.x), mix(h(i+vec2(0,1)),h(i+vec2(1,1)),f.x), f.y); }
      float fbm(vec2 p){ float v=0.0, a=0.5; for(int i=0;i<6;i++){ v+=a*n(p); p*=2.03; a*=0.5; } return v; }
      void main(){
        vec2 p = vUv * vec2(3.2, 1.8);
        float t = uTime * 0.004;
        float a = fbm(p + vec2(t, -t));
        float b = fbm(p * 1.7 - vec2(t * 1.3, 0.0) + a);
        vec3 col = vec3(0.004, 0.006, 0.02);
        col += vec3(0.16, 0.06, 0.32) * pow(b, 3.0) * 0.9;           // violeta
        col += vec3(0.02, 0.16, 0.22) * pow(a, 4.0) * 0.8;           // turquesa
        float vign = smoothstep(1.25, 0.35, length(vUv - vec2(0.5, 0.52)) * 1.6);
                           // luz de la mente
        gl_FragColor = vec4(col * uDim, 1.0);
      }`,
    depthWrite: false, depthTest: false,
  });
  const q = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), m);
  q.frustumCulled = false; q.renderOrder = -10;
  return q;
}

function makeStars(count) {
  const g = new THREE.BufferGeometry();
  const pos = new Float32Array(count * 3), seed = new Float32Array(count), size = new Float32Array(count);
  for (let i = 0; i < count; i++) {
    const layer = Math.random();
    const z = layer < 0.6 ? rand(-90, -40) : layer < 0.9 ? rand(-40, -15) : rand(-15, -6);
    const spread = (-z + 14) * 0.9;
    pos.set([rand(-spread, spread) * 1.6, rand(-spread, spread), z], i * 3);
    seed[i] = Math.random(); size[i] = layer < 0.6 ? rand(0.6, 1.4) : layer < 0.9 ? rand(1, 2) : rand(1.5, 2.6);
  }
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('seed', new THREE.BufferAttribute(seed, 1));
  g.setAttribute('size', new THREE.BufferAttribute(size, 1));
  const m = new THREE.ShaderMaterial({
    uniforms: { uTime: U.time, uDim: U.dim, uPR: U.pixelRatio },
    vertexShader: `attribute float seed; attribute float size; varying float vA; uniform float uTime; uniform float uPR;
      void main(){ vec4 mv = modelViewMatrix * vec4(position,1.0);
        vA = 0.55 + 0.45 * sin(uTime * (0.3 + seed) + seed * 40.0);
        gl_PointSize = size * uPR; gl_Position = projectionMatrix * mv; }`,
    fragmentShader: `varying float vA; uniform float uDim;
      void main(){ float d = length(gl_PointCoord - 0.5); float a = smoothstep(0.5, 0.0, d);
        gl_FragColor = vec4(vec3(0.82,0.88,1.0) * a * vA * 0.9 * uDim, a * vA); }`,
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
  });
  return new THREE.Points(g, m);
}

// ---------- la mente de KRATOS ----------
function makeMind(q) {
  const group = new THREE.Group();
  const uniforms = { uTime: U.time, uLevel: { value: 0 }, uTint: { value: new THREE.Color('#8fdcff') }, uDim: U.dim, uPR: U.pixelRatio, uSpin: { value: 0.15 } };
  // núcleo: fresnel + ruido interno
  const core = new THREE.Mesh(new THREE.SphereGeometry(1.0, 96, 96), new THREE.ShaderMaterial({
    uniforms,
    vertexShader: `varying vec3 vN; varying vec3 vP; varying vec3 vV;
      void main(){ vN = normalize(normalMatrix * normal); vP = position; vec4 mv = modelViewMatrix * vec4(position,1.0); vV = normalize(-mv.xyz); gl_Position = projectionMatrix * mv; }`,
    fragmentShader: `varying vec3 vN; varying vec3 vP; varying vec3 vV; uniform float uTime; uniform float uLevel; uniform vec3 uTint; uniform float uDim;
      float h(vec3 p){ return fract(sin(dot(p, vec3(127.1, 311.7, 74.7))) * 43758.5453); }
      float n(vec3 p){ vec3 i=floor(p), f=fract(p); f=f*f*(3.0-2.0*f);
        return mix(mix(mix(h(i),h(i+vec3(1,0,0)),f.x),mix(h(i+vec3(0,1,0)),h(i+vec3(1,1,0)),f.x),f.y),
                   mix(mix(h(i+vec3(0,0,1)),h(i+vec3(1,0,1)),f.x),mix(h(i+vec3(0,1,1)),h(i+vec3(1,1,1)),f.x),f.y),f.z); }
      void main(){
        float a = uTime * 0.25; float c = cos(a), s = sin(a);
        vec3 p = vP / 1.0; p.xz = mat2(c, -s, s, c) * p.xz;              // gira sin parar
        float rim = pow(1.0 - max(dot(vN, vV), 0.0), 2.4);
        float depth = max(dot(vN, vV), 0.0);                               // más denso en el centro
        float plasma = n(p * 3.0 + uTime * 0.15) * 0.6 + n(p * 7.0 - uTime * 0.25) * 0.4;
        // estrellas dentro de la esfera, en varias capas que se dispersan hacia el borde
        float st = 0.0;
        for (int k = 0; k < 5; k++) {
          vec3 q = p * (10.0 + float(k) * 9.0) + float(k) * 7.3;
          vec3 cell = floor(q); vec3 f = fract(q) - 0.5;
          float r = h(cell);
          float tw = 0.6 + 0.4 * sin(uTime * (1.0 + r * 3.0) + r * 40.0);
          st += step(0.8, r) * smoothstep(0.2, 0.0, length(f)) * tw;
        }
        // filamentos de energía que giran dentro de la esfera
        float fil = pow(n(vec3(p.x * 5.0 + uTime * 0.4, p.y * 14.0, p.z * 5.0 - uTime * 0.3)), 6.0) * 3.0;
        vec3 col = uTint * (0.015 + 0.07 * pow(depth, 2.0)) * (0.4 + 0.9 * plasma);
        col += vec3(0.95, 0.97, 1.0) * st * (1.4 + depth * 0.9);
        col += mix(uTint, vec3(0.8, 0.9, 1.0), 0.5) * fil * (0.35 + depth * 0.6) * (1.0 + uLevel * 1.5);
        col += uTint * rim * (0.22 + uLevel * 0.5);
        col += vec3(1.0) * pow(depth, 9.0) * (0.75 + uLevel * 0.9);        // corazón brillante
        gl_FragColor = vec4(col * uDim, 1.0);
      }`,
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
  }));
  group.add(core);
  const halo = new THREE.Sprite(new THREE.SpriteMaterial({ map: radialTexture([[0, 'rgba(150,220,255,0.38)'], [0.22, 'rgba(110,140,255,0.10)'], [1, 'rgba(0,0,0,0)']]), blending: THREE.AdditiveBlending, depthWrite: false, transparent: true }));
  halo.material.opacity = 0.38;
  halo.scale.setScalar(5.5); group.add(halo);
  // neuronas: corteza de puntos con ruido
  const n = q.neurons;
  const g = new THREE.BufferGeometry();
  const pos = new Float32Array(n * 3), seed = new Float32Array(n);
  const pts = [];
  for (let i = 0; i < n; i++) {
    const v = new THREE.Vector3().randomDirection();
    // denso alrededor del zorro y cada vez más disperso hasta más allá de los planetas
    // concentrado: casi todas las neuronas cerca del núcleo, unas pocas se alejan
    const r = 0.75 + Math.pow(Math.random(), 2.6) * 4.2;
    v.multiplyScalar(r).multiply(new THREE.Vector3(1.25, 0.95, 0.8));
    pos.set([v.x, v.y, v.z], i * 3); seed[i] = Math.random(); pts.push(v);
  }
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('seed', new THREE.BufferAttribute(seed, 1));
  const neurons = new THREE.Points(g, new THREE.ShaderMaterial({
    uniforms,
    vertexShader: `attribute float seed; varying float vA; uniform float uTime; uniform float uLevel; uniform float uPR; uniform float uSpin;
      void main(){ float a = uTime * uSpin * (0.4 + seed) / (0.6 + length(position) * 0.18);   // el remolino gira más rápido cerca del centro
        vec3 p = position; float c = cos(a), s = sin(a); p.xz = mat2(c, -s, s, c) * p.xz;
        p *= 1.0 + uLevel * 0.35 * sin(seed * 30.0 + uTime * 8.0);   // al hablar, las neuronas se expanden y laten
        vec4 mv = modelViewMatrix * vec4(p, 1.0);
        vA = 0.35 + 0.65 * pow(0.5 + 0.5 * sin(uTime * (0.6 + seed * 1.4) + seed * 50.0), 3.0);
        gl_PointSize = (1.4 + seed * 2.6) * uPR * (13.0 / -mv.z); gl_Position = projectionMatrix * mv; }`,
    fragmentShader: `varying float vA; uniform vec3 uTint; uniform float uDim;
      void main(){ float d = length(gl_PointCoord - 0.5); float a = smoothstep(0.5, 0.05, d);
        gl_FragColor = vec4(mix(uTint, vec3(1.0), 0.4) * a * vA * 1.1 * uDim, a); }`,
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
  }));
  group.add(neurons);
  // sinapsis internas: pares cercanos
  const seg = [];
  for (let i = 0; i < pts.length && seg.length < 900 * 6; i += 2) {
    for (let j = i + 1; j < Math.min(pts.length, i + 40); j++) {
      if (pts[i].length() < 2.4 && pts[i].distanceTo(pts[j]) < 0.32) { seg.push(pts[i].x, pts[i].y, pts[i].z, pts[j].x, pts[j].y, pts[j].z); break; }
    }
  }
  const sg = new THREE.BufferGeometry(); sg.setAttribute('position', new THREE.Float32BufferAttribute(seg, 3));
  const syn = new THREE.LineSegments(sg, new THREE.LineBasicMaterial({ color: 0x7fc8ff, transparent: true, opacity: 0.18, blending: THREE.AdditiveBlending, depthWrite: false }));
  group.add(syn);
  group.position.set(0, 0.7, 0);
  return { group, uniforms, synMat: syn.material, syn, neuronGeo: g };
}

// ---------- ramificaciones neuronales ----------
function branchPath(a, b, jitter) {
  const pts = [];
  const dir = new THREE.Vector3().subVectors(b, a);
  const perp = new THREE.Vector3(-dir.y, dir.x, 0).normalize();
  const perp2 = new THREE.Vector3(0, 0, 1);
  const o1 = rand(-1, 1) * jitter, o2 = rand(-1, 1) * jitter * 0.6;
  for (let i = 0; i <= 24; i++) {
    const t = i / 24;
    const bow = Math.sin(Math.PI * t);
    pts.push(new THREE.Vector3().copy(a).addScaledVector(dir, t).addScaledVector(perp, bow * o1 + Math.sin(t * 9 + o1 * 5) * 0.04 * jitter).addScaledVector(perp2, bow * o2));
  }
  return pts;
}

function makeConnection(from, to, color, strands) {
  const pos = [], u = [], seed = [];
  const push = (p0, p1, u0, u1, s) => { pos.push(p0.x, p0.y, p0.z, p1.x, p1.y, p1.z); u.push(u0, u1); seed.push(s, s); };
  for (let k = 0; k < strands; k++) {
    const s = Math.random();
    const path = branchPath(from, to, 0.35 + k * 0.12);
    for (let i = 0; i < path.length - 1; i++) push(path[i], path[i + 1], i / (path.length - 1), (i + 1) / (path.length - 1), s);
    // dendritas laterales
    for (let d = 0; d < 4; d++) {
      const i0 = Math.floor(rand(3, path.length - 4));
      let p = path[i0].clone();
      const dir = new THREE.Vector3().randomDirection().multiplyScalar(0.07);
      const len = Math.floor(rand(4, 10));
      for (let j = 0; j < len; j++) {
        const q = p.clone().add(dir).add(new THREE.Vector3().randomDirection().multiplyScalar(0.03));
        push(p, q, i0 / (path.length - 1) + j * 0.01, i0 / (path.length - 1) + (j + 1) * 0.01, s);
        p = q; dir.multiplyScalar(0.92);
      }
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('u', new THREE.Float32BufferAttribute(u, 1));
  g.setAttribute('seed', new THREE.Float32BufferAttribute(seed, 1));
  const uniforms = { uTime: U.time, uDim: U.dim, uSpeak: U.speak, uColor: { value: new THREE.Color(color) }, uPulse: { value: -1 }, uActive: { value: 0 } };
  const m = new THREE.ShaderMaterial({
    uniforms,
    vertexShader: `attribute float u; attribute float seed; varying float vU; varying float vS; uniform float uTime; uniform float uSpeak;
      void main(){ vU = u; vS = seed; vec3 p = position;
        // la rama se ondula como un axón: suave en reposo, viva cuando hay voz
        float w = sin(u * 18.0 - uTime * (1.2 + uSpeak * 6.0) + seed * 12.0) * sin(3.14159 * u);
        p += vec3(sin(seed * 7.1), cos(seed * 5.3), sin(seed * 3.7)) * w * (0.015 + uSpeak * 0.09);
        gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0); }`,
    fragmentShader: `varying float vU; varying float vS; uniform float uTime; uniform vec3 uColor; uniform float uPulse; uniform float uActive; uniform float uDim; uniform float uSpeak;
      void main(){
        float shimmer = 0.7 + 0.3 * sin(uTime * 0.35 + vS * 6.28);           // ambiental: lento, no viaja
        float fire = uSpeak * (0.5 + 0.5 * sin(vU * 30.0 - uTime * 9.0 + vS * 20.0));   // chispas mientras hay voz
        float base = (0.03 + 0.8 * uActive) * shimmer * (1.0 - 0.25 * vU) + fire * 0.55 * (0.15 + uActive);
        float d = vU - uPulse; float pulse = uPulse < 0.0 ? 0.0 : exp(-d * d * 260.0) * 2.4;   // impulso de un evento
        vec3 c = mix(uColor, vec3(1.0), clamp(pulse, 0.0, 1.0) * 0.7) * (base + pulse);
        gl_FragColor = vec4(c * uDim, 1.0); }`,
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
  });
  return { lines: new THREE.LineSegments(g, m), uniforms };
}

// ---------- astros (texturas pintadas por código) ----------
function planetTexture(id, color) {
  const c = document.createElement('canvas'); c.width = 512; c.height = 256;
  const g = c.getContext('2d');
  const base = new THREE.Color(color);
  const css = (col, a = 1) => `rgba(${Math.round(col.r * 255)},${Math.round(col.g * 255)},${Math.round(col.b * 255)},${a})`;
  g.fillStyle = css(base); g.fillRect(0, 0, 512, 256);
  const darker = base.clone().multiplyScalar(0.55), lighter = base.clone().lerp(new THREE.Color('#ffffff'), 0.45);
  if (id === 'jupiter' || id === 'saturno') {
    for (let y = 0; y < 256; y += 2) { const v = Math.sin(y * 0.11) + Math.sin(y * 0.031 + 1.3) * 0.8 + Math.sin(y * 0.4) * 0.2; g.fillStyle = css(v > 0 ? lighter : darker, Math.min(0.55, Math.abs(v) * 0.35)); g.fillRect(0, y, 512, 2); }
    if (id === 'jupiter') { g.fillStyle = css(new THREE.Color('#ffd6f0'), 0.5); g.beginPath(); g.ellipse(330, 160, 34, 16, 0, 0, 7); g.fill(); }
  } else if (id === 'luna' || id === 'mercurio') {
    for (let i = 0; i < 160; i++) { const r = rand(2, id === 'luna' ? 18 : 10); g.fillStyle = css(Math.random() < 0.5 ? darker : lighter, rand(0.15, 0.4)); g.beginPath(); g.arc(rand(0, 512), rand(0, 256), r, 0, 7); g.fill(); }
  } else if (id === 'marte') {
    for (let i = 0; i < 70; i++) { g.fillStyle = css(darker, rand(0.15, 0.4)); g.beginPath(); g.ellipse(rand(0, 512), rand(40, 216), rand(10, 50), rand(5, 18), rand(0, 3), 0, 7); g.fill(); }
    g.fillStyle = 'rgba(255,240,230,.75)'; g.fillRect(0, 0, 512, 14); g.fillRect(0, 244, 512, 12);
  } else if (id === 'venus') {
    for (let y = 0; y < 256; y += 3) for (let x = 0; x < 512; x += 6) { const v = Math.sin(x * 0.02 + Math.sin(y * 0.05) * 3) * Math.cos(y * 0.03); g.fillStyle = css(v > 0 ? lighter : darker, Math.abs(v) * 0.25); g.fillRect(x, y, 6, 3); }
  } else if (id === 'sol') {
    for (let i = 0; i < 2600; i++) { g.fillStyle = css(Math.random() < 0.5 ? new THREE.Color('#fff2b0') : new THREE.Color('#ff8a1a'), rand(0.1, 0.35)); g.beginPath(); g.arc(rand(0, 512), rand(0, 256), rand(1, 4), 0, 7); g.fill(); }
  }
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}

function makePlanet(a) {
  const group = new THREE.Group();
  const mat = planetMaterial(a, U, MIND_POS);
  const body = new THREE.Mesh(new THREE.SphereGeometry(a.size, 96, 64), mat);
  body.userData.agent = a.id;
  body.rotation.z = rand(-0.4, 0.4);
  group.add(body);
  const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: radialTexture([[0, new THREE.Color(a.real).getStyle().replace('rgb', 'rgba').replace(')', ',0.55)')], [0.35, new THREE.Color(a.real).getStyle().replace('rgb', 'rgba').replace(')', ',0.12)')], [1, 'rgba(0,0,0,0)']]), blending: THREE.AdditiveBlending, depthWrite: false, transparent: true }));
  glow.material.opacity = a.id === 'sol' ? 0.52 : 0.34;
  glow.scale.setScalar(a.size * (a.id === 'sol' ? 4.8 : 3.1)); group.add(glow);
  if (a.id === 'saturno') {
    const ring = new THREE.Mesh(new THREE.RingGeometry(0.58, 1.0, 192), ringMaterial(a.color));
    ring.scale.setScalar(a.size * 2.4);
    ring.rotation.x = Math.PI * 0.42; ring.rotation.y = 0.3; group.add(ring);
  }
  // anillo de estado (actividad real o permiso); oculto por defecto
  const halo = new THREE.Mesh(new THREE.RingGeometry(a.size * 1.55, a.size * 1.62, 96), new THREE.MeshBasicMaterial({ color: a.color, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false }));
  group.add(halo);
  return { group, body, glow, halo, flare: 0 };
}

// ---------- el zorro de luz (provisional) ----------
// Silueta propia dibujada en un lienzo y convertida en partículas. La cola son partículas de fuego.
function foxSilhouette() {
  const c = document.createElement('canvas'); c.width = c.height = 512;
  const g = c.getContext('2d');
  g.fillStyle = '#fff';
  const shape = (fn) => { g.beginPath(); fn(); g.closePath(); g.fill(); };
  shape(() => g.ellipse(256, 372, 92, 104, 0, 0, 7));                         // cuerpo sentado
  shape(() => { g.ellipse(178, 430, 52, 44, -0.3, 0, 7); });                 // ancas
  shape(() => { g.ellipse(334, 430, 52, 44, 0.3, 0, 7); });
  shape(() => { g.moveTo(216, 300); g.quadraticCurveTo(256, 250, 296, 300); g.lineTo(256, 352); });  // cuello
  shape(() => { g.moveTo(184, 178); g.quadraticCurveTo(194, 118, 256, 114); g.quadraticCurveTo(318, 118, 328, 178); g.quadraticCurveTo(322, 220, 256, 266); g.quadraticCurveTo(190, 220, 184, 178); });  // cabeza
  shape(() => { g.moveTo(184, 190); g.lineTo(156, 222); g.lineTo(196, 214); g.lineTo(182, 238); g.lineTo(226, 236); });   // mejillas
  shape(() => { g.moveTo(328, 190); g.lineTo(356, 222); g.lineTo(316, 214); g.lineTo(330, 238); g.lineTo(286, 236); });
  shape(() => { g.moveTo(194, 152); g.lineTo(170, 52); g.lineTo(240, 124); });   // orejas
  shape(() => { g.moveTo(318, 152); g.lineTo(342, 52); g.lineTo(272, 124); });
  shape(() => { g.rect(222, 390, 22, 86); g.rect(268, 390, 22, 86); });          // patas delanteras
  shape(() => { g.ellipse(232, 478, 20, 9, 0, 0, 7); }); shape(() => { g.ellipse(280, 478, 20, 9, 0, 0, 7); });
  // cola (canal rojo): curva amplia desde el anca derecha
  g.fillStyle = '#f00';
  shape(() => { g.moveTo(340, 462); g.bezierCurveTo(470, 480, 505, 360, 470, 270); g.bezierCurveTo(452, 220, 420, 214, 408, 240); g.bezierCurveTo(446, 300, 440, 412, 352, 432); });
  // ojos y nariz (canal verde / azul)
  g.fillStyle = '#0f0'; shape(() => g.ellipse(226, 186, 10, 6, 0.35, 0, 7)); shape(() => g.ellipse(286, 186, 10, 6, -0.35, 0, 7));
  g.fillStyle = '#00f'; shape(() => g.ellipse(256, 236, 9, 7, 0, 0, 7));
  return g.getImageData(0, 0, 512, 512).data;
}

function makeFox(q) {
  const data = foxSilhouette();
  const sample = (match, want) => {
    const out = []; let tries = 0;
    while (out.length < want && tries < want * 60) {
      tries++;
      const x = Math.floor(Math.random() * 512), y = Math.floor(Math.random() * 512);
      const i = (y * 512 + x) * 4;
      if (data[i + 3] > 0 && match(data[i], data[i + 1], data[i + 2])) out.push([x, y]);
    }
    return out;
  };
  const S = 2.65 / 512; // altura contenida para convivir con la órbita completa
  const toWorld = ([x, y], depth) => [(x - 256) * S, (512 - y) * S, depth];
  const group = new THREE.Group();
  // cuerpo y ojos
  const fur = sample((r, g, b) => r > 200 && g > 200 && b > 200, q.fox);
  const eyes = sample((r, g, b) => g > 200 && r < 50, 160);
  const nose = sample((r, g, b) => b > 200 && r < 50, 60);
  const all = [...fur.map((p) => [p, 0]), ...eyes.map((p) => [p, 1]), ...nose.map((p) => [p, 2])];
  const pos = new Float32Array(all.length * 3), kind = new Float32Array(all.length), seed = new Float32Array(all.length);
  all.forEach(([p, k], i) => {
    const dx = (p[0] - 256) / 110, dy = (p[1] - 360) / 140;
    const depth = Math.sqrt(Math.max(0, 1 - dx * dx * 0.6 - dy * dy * 0.3)) * 0.55 * (Math.random() * 2 - 1);
    pos.set(toWorld(p, k ? 0.3 : depth), i * 3); kind[i] = k; seed[i] = Math.random();
  });
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('kind', new THREE.BufferAttribute(kind, 1));
  g.setAttribute('seed', new THREE.BufferAttribute(seed, 1));
  const furU = { uTime: U.time, uDim: U.dim, uPR: U.pixelRatio, uAlert: { value: 0 } };
  const body = new THREE.Points(g, new THREE.ShaderMaterial({
    uniforms: furU,
    vertexShader: `attribute float kind; attribute float seed; varying float vK; varying float vA; uniform float uTime; uniform float uPR;
      void main(){ vK = kind; vec3 p = position;
        p.y *= 1.0 + 0.008 * sin(uTime * 1.3);                       // respiración
        p += 0.006 * vec3(sin(uTime * 0.8 + seed * 20.0), cos(uTime * 0.7 + seed * 17.0), 0.0);
        vec4 mv = modelViewMatrix * vec4(p, 1.0);
        vA = kind > 0.5 ? 1.0 : 0.55 + 0.45 * sin(uTime * (0.4 + seed) + seed * 30.0);
        gl_PointSize = (kind > 0.5 ? 3.4 : 1.5 + seed * 1.5) * uPR * (14.0 / -mv.z); gl_Position = projectionMatrix * mv; }`,
    fragmentShader: `varying float vK; varying float vA; uniform float uDim;
      void main(){ float d = length(gl_PointCoord - 0.5); float a = smoothstep(0.5, 0.0, d);
        vec3 c = vK > 1.5 ? vec3(0.05, 0.07, 0.12) : vK > 0.5 ? vec3(1.6, 0.95, 0.35) : vec3(0.92, 0.96, 1.08);
        gl_FragColor = vec4(c * a * vA * uDim * (vK > 1.5 ? 1.0 : 1.05), a); }`,
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
  }));
  group.add(body);
  // fuego vivo en la cola: cada partícula sube, tiembla y renace en el shader
  const tail = sample((r, g, b) => r > 200 && g < 50, q.fire);
  const fp = new Float32Array(tail.length * 3), fs = new Float32Array(tail.length);
  tail.forEach((p, i) => { fp.set(toWorld(p, rand(-0.25, 0.25)), i * 3); fs[i] = Math.random(); });
  const fg = new THREE.BufferGeometry();
  fg.setAttribute('position', new THREE.BufferAttribute(fp, 3));
  fg.setAttribute('seed', new THREE.BufferAttribute(fs, 1));
  const fireU = { uTime: U.time, uDim: U.dim, uPR: U.pixelRatio, uFire: { value: 0.7 } };
  const fire = new THREE.Points(fg, new THREE.ShaderMaterial({
    uniforms: fireU,
    vertexShader: `attribute float seed; varying float vLife; uniform float uTime; uniform float uPR; uniform float uFire;
      void main(){ float life = fract(uTime * (0.45 + seed * 0.5) + seed * 7.0); vLife = life;
        vec3 p = position;
        p.y += life * (0.25 + 0.45 * uFire) * (0.6 + seed);
        p.x += sin(uTime * 3.0 + seed * 40.0) * 0.035 * life + life * 0.08;
        vec4 mv = modelViewMatrix * vec4(p, 1.0);
        gl_PointSize = (3.5 + 7.0 * (1.0 - life)) * (0.6 + uFire * 0.6) * uPR * (14.0 / -mv.z); gl_Position = projectionMatrix * mv; }`,
    fragmentShader: `varying float vLife; uniform float uDim; uniform float uFire;
      void main(){ float d = length(gl_PointCoord - 0.5); float a = smoothstep(0.5, 0.0, d) * (1.0 - vLife) * uFire;
        vec3 c = mix(vec3(1.7, 0.95, 0.3), mix(vec3(1.8, 0.48, 0.08), vec3(0.9, 0.1, 0.02), smoothstep(0.45, 1.0, vLife)), smoothstep(0.0, 0.3, vLife));
        gl_FragColor = vec4(c * a * 0.42 * uDim, a); }`,
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
  }));
  group.add(fire);
  const warm = new THREE.Sprite(new THREE.SpriteMaterial({ map: radialTexture([[0, 'rgba(255,120,40,0.42)'], [1, 'rgba(0,0,0,0)']]), blending: THREE.AdditiveBlending, depthWrite: false, transparent: true }));
  warm.material.opacity = 0.38;
  warm.position.set(1.12, 0.78, -0.2); warm.scale.setScalar(2.45); group.add(warm);
  group.scale.setScalar(1.35);
  group.position.set(0, 0.7 - 1.45 * 1.35, 0.6);   // centrado en la mente de KRATOS
  return { group, furU, fireU };
}

// ---------- fondo precalculado ----------
// La nebulosa casi no cambia: se dibuja una vez en una textura y se reutiliza en cada fotograma.
let bgTarget = null;
function bakeBackground() {
  bgTarget?.dispose();
  const sc = new THREE.Scene(); sc.add(makeDeepSky(U));
  bgTarget = new THREE.WebGLRenderTarget(Math.round(innerWidth * 0.8), Math.round(innerHeight * 0.8), { type: THREE.HalfFloatType });
  const prevTime = U.time.value; U.time.value = 0;
  renderer.setRenderTarget(bgTarget); renderer.render(sc, new THREE.Camera()); renderer.setRenderTarget(null);
  U.time.value = prevTime;
  sc.traverse((o) => { o.geometry?.dispose(); o.material?.dispose(); });
  return bgTarget.texture;
}
function makeBackgroundQuad() {
  const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), new THREE.ShaderMaterial({
    uniforms: { uTex: { value: bakeBackground() }, uDim: U.dim },
    vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.9999, 1.0); }`,
    fragmentShader: `varying vec2 vUv; uniform sampler2D uTex; uniform float uDim; void main(){ gl_FragColor = vec4(texture2D(uTex, vUv).rgb * uDim, 1.0); }`,
    depthWrite: false, depthTest: false,
  }));
  quad.frustumCulled = false; quad.renderOrder = -10;
  return quad;
}

// ---------- órbitas de energía (filamentos dorados y azules con chispas) ----------
function makeOrbits(anchors) {
  const group = new THREE.Group(), mats = [];
  const center = MIND_POS;
  const specs = [[0.42, 0.62, 0.15, '#ffc56b'], [0.62, 0.8, -0.2, '#6fa8ff'], [0.82, 0.95, 0.1, '#ffd890'], [1.0, 1.0, -0.06, '#8fb8ff'], [1.12, 1.05, 0.22, '#ffb84d']];
  const rx = Math.max(...anchors.map((a) => Math.abs(a.x))), ry = Math.max(...anchors.map((a) => Math.abs(a.y - 0.45)));
  for (const [kx, ky, tilt, color] of specs) {
    const pts = [], u = [];
    for (let k = 0; k <= 360; k++) {
      const a = (k / 360) * Math.PI * 2;
      const x = Math.cos(a) * rx * kx, y = Math.sin(a) * ry * ky;
      pts.push(new THREE.Vector3(center.x + x * Math.cos(tilt) - y * Math.sin(tilt), center.y - 0.25 + x * Math.sin(tilt) + y * Math.cos(tilt), Math.sin(a) * 1.2 - 0.4));
      u.push(k / 360);
    }
    const g = new THREE.BufferGeometry().setFromPoints(pts);
    g.setAttribute('u', new THREE.Float32BufferAttribute(u, 1));
    const m = new THREE.ShaderMaterial({
      uniforms: { uTime: U.time, uDim: U.dim, uSpeak: U.speak, uColor: { value: new THREE.Color(color) }, uSeed: { value: Math.random() * 10 } },
      vertexShader: `attribute float u; varying float vU; void main(){ vU = u; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
      fragmentShader: `varying float vU; uniform float uTime; uniform float uDim; uniform float uSpeak; uniform vec3 uColor; uniform float uSeed;
        void main(){
          float sparks = 0.0;
          for (int i = 0; i < 4; i++) { float h = fract(uTime * (0.012 + float(i) * 0.004) + float(i) * 0.25 + uSeed); float d = abs(vU - h); d = min(d, 1.0 - d); sparks += exp(-d * d * 9000.0); }
          float a = 0.14 + 0.07 * sin(vU * 40.0 + uSeed) + sparks * 2.2 + uSpeak * 0.35;
          gl_FragColor = vec4(mix(uColor, vec3(1.0), sparks * 0.6) * a * uDim, 1.0); }`,
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    });
    group.add(new THREE.Line(g, m)); mats.push(m);
  }
  return group;
}

// ---------- estrellas fugaces ----------
const meteors = [];
let meteorGroup = null, nextMeteor = 4;
function updateMeteors(dt) {
  if (!meteorGroup) return;
  nextMeteor -= dt;
  if (nextMeteor <= 0 && meteors.length < 3) {
    nextMeteor = 3 + Math.random() * 7;
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array(6), 3));
    const line = new THREE.Line(g, new THREE.LineBasicMaterial({ color: 0xdfe8ff, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false }));
    const start = new THREE.Vector3(rand(-18, 18), rand(4, 11), -20), dir = new THREE.Vector3(rand(-1, -0.4) * (Math.random() < 0.5 ? -1 : 1), rand(-0.8, -0.4), 0).normalize();
    line.frustumCulled = false; meteorGroup.add(line); meteors.push({ line, pos: start, dir, life: 0, max: rand(0.7, 1.3), speed: rand(14, 22) });
  }
  for (let i = meteors.length - 1; i >= 0; i--) {
    const m = meteors[i]; m.life += dt;
    m.pos.addScaledVector(m.dir, m.speed * dt);
    const tail = m.pos.clone().addScaledVector(m.dir, -2.2);
    m.line.geometry.attributes.position.array.set([m.pos.x, m.pos.y, m.pos.z, tail.x, tail.y, tail.z]);
    m.line.geometry.attributes.position.needsUpdate = true;
    m.line.material.opacity = Math.sin(Math.PI * Math.min(1, m.life / m.max)) * 0.9 * U.dim.value;
    if (m.life > m.max) { meteorGroup.remove(m.line); m.line.geometry.dispose(); m.line.material.dispose(); meteors.splice(i, 1); }
  }
}

// ---------- constelaciones del fondo ----------
function makeConstellations(count) {
  const pts = [], col = [], size = [], seed = [], lines = [];
  for (let c = 0; c < count; c++) {
    const z = -rand(30, 55), spread = (-z + 14) * 0.62;
    let p = new THREE.Vector3(rand(-spread, spread) * 1.6, rand(-spread * 0.9, spread * 0.9), z);
    const n = Math.floor(rand(5, 10)), stars = [p.clone()];
    let dir = rand(0, Math.PI * 2);
    for (let i = 1; i < n; i++) {
      dir += rand(-1.1, 1.1);
      const step = rand(1.6, 3.4) * (-z / 40);
      const from = Math.random() < 0.25 ? stars[Math.floor(Math.random() * stars.length)] : stars[stars.length - 1];
      const q = from.clone().add(new THREE.Vector3(Math.cos(dir) * step, Math.sin(dir) * step, rand(-0.5, 0.5)));
      lines.push(from.x, from.y, from.z, q.x, q.y, q.z);
      stars.push(q);
    }
    for (const st of stars) { pts.push(st.x, st.y, st.z); const warm = Math.random() < 0.3; col.push(1, warm ? 0.85 : 0.95, warm ? 0.7 : 1); size.push(rand(3.0, 6.0)); seed.push(Math.random()); }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setAttribute('size', new THREE.Float32BufferAttribute(size, 1));
  g.setAttribute('seed', new THREE.Float32BufferAttribute(seed, 1));
  const starsObj = new THREE.Points(g, new THREE.ShaderMaterial({
    uniforms: { uTime: U.time, uDim: U.dim, uPR: U.pixelRatio },
    vertexShader: `attribute vec3 color; attribute float size; attribute float seed; varying vec3 vC; varying float vA; uniform float uTime; uniform float uPR;
      void main(){ vC = color; vA = 0.75 + 0.25 * sin(uTime * (0.7 + seed) + seed * 30.0);
        vec4 mv = modelViewMatrix * vec4(position, 1.0); gl_PointSize = size * uPR; gl_Position = projectionMatrix * mv; }`,
    fragmentShader: `varying vec3 vC; varying float vA; uniform float uDim;
      void main(){ float d = length(gl_PointCoord - 0.5); float a = pow(smoothstep(0.5, 0.0, d), 2.0);
        gl_FragColor = vec4(vC * a * vA * 1.6 * uDim, a); }`,
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
  }));
  const lg = new THREE.BufferGeometry(); lg.setAttribute('position', new THREE.Float32BufferAttribute(lines, 3));
  const linesObj = new THREE.LineSegments(lg, new THREE.LineBasicMaterial({ color: 0x8fa8ff, transparent: true, opacity: 0.16, blending: THREE.AdditiveBlending, depthWrite: false }));
  const group = new THREE.Group(); group.add(linesObj, starsObj);
  return group;
}

// ---------- campo neuronal: todo el universo como un pensamiento ----------
// Neuronas repartidas por el espacio, unidas a sus vecinas. En reposo laten despacio;
// con voz real (uSpeak) las sinapsis disparan y se ondulan.
function makeNeuralField(count) {
  const nodes = [];
  for (let i = 0; i < count; i++) {
    const r = 3.5 + Math.pow(Math.random(), 0.7) * 9;
    const v = new THREE.Vector3().randomDirection();
    nodes.push(new THREE.Vector3(v.x * r * 1.7, v.y * r * 0.95 + 0.4, -Math.abs(v.z) * r * 0.8 - 1.5));
  }
  const pos = [], seed = [], along = [];
  nodes.forEach((a, i) => {
    let links = 0;
    for (let j = i + 1; j < nodes.length && links < 3; j++) {
      const d = a.distanceTo(nodes[j]);
      if (d < 1.9 && Math.random() < 0.55) {
        // sinapsis curva en 6 tramos
        const b = nodes[j], mid = a.clone().lerp(b, 0.5).add(new THREE.Vector3().randomDirection().multiplyScalar(d * 0.18));
        const sd = Math.random();
        let prev = a;
        for (let k = 1; k <= 6; k++) {
          const t = k / 6, q = a.clone().multiplyScalar((1 - t) * (1 - t)).add(mid.clone().multiplyScalar(2 * t * (1 - t))).add(b.clone().multiplyScalar(t * t));
          pos.push(prev.x, prev.y, prev.z, q.x, q.y, q.z); seed.push(sd, sd); along.push((k - 1) / 6, t);
          prev = q;
        }
        links++;
      }
    }
  });
  const lg = new THREE.BufferGeometry();
  lg.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  lg.setAttribute('seed', new THREE.Float32BufferAttribute(seed, 1));
  lg.setAttribute('u', new THREE.Float32BufferAttribute(along, 1));
  const lines = new THREE.LineSegments(lg, new THREE.ShaderMaterial({
    uniforms: { uTime: U.time, uDim: U.dim, uSpeak: U.speak },
    vertexShader: `attribute float seed; attribute float u; varying float vS; varying float vU; uniform float uTime; uniform float uSpeak;
      void main(){ vS = seed; vU = u; vec3 p = position;
        p += vec3(sin(uTime * 0.5 + seed * 30.0), cos(uTime * 0.4 + seed * 22.0), 0.0) * (0.03 + uSpeak * 0.12) * sin(3.14159 * u);
        gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0); }`,
    fragmentShader: `varying float vS; varying float vU; uniform float uTime; uniform float uDim; uniform float uSpeak;
      void main(){
        float idle = 0.012 + 0.012 * sin(uTime * 0.3 + vS * 40.0);
        float wave = pow(max(0.0, sin(vU * 6.0 - uTime * (2.0 + uSpeak * 10.0) + vS * 60.0)), 8.0);   // disparo que recorre la sinapsis
        float a = idle + wave * (0.015 + uSpeak * 1.1);
        gl_FragColor = vec4(mix(vec3(0.45, 0.6, 1.0), vec3(0.85, 0.95, 1.0), wave) * a * uDim, 1.0); }`,
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
  }));
  const ng = new THREE.BufferGeometry();
  ng.setFromPoints(nodes);
  ng.setAttribute('seed', new THREE.Float32BufferAttribute(nodes.map(() => Math.random()), 1));
  const points = new THREE.Points(ng, new THREE.ShaderMaterial({
    uniforms: { uTime: U.time, uDim: U.dim, uSpeak: U.speak, uPR: U.pixelRatio },
    vertexShader: `attribute float seed; varying float vA; uniform float uTime; uniform float uSpeak; uniform float uPR;
      void main(){ vec4 mv = modelViewMatrix * vec4(position, 1.0);
        float fire = pow(max(0.0, sin(uTime * (0.8 + uSpeak * 6.0) + seed * 50.0)), 6.0);
        vA = 0.1 + fire * (0.12 + uSpeak * 1.6);
        gl_PointSize = (2.0 + fire * (2.0 + uSpeak * 5.0)) * uPR * (10.0 / -mv.z); gl_Position = projectionMatrix * mv; }`,
    fragmentShader: `varying float vA; uniform float uDim;
      void main(){ float d = length(gl_PointCoord - 0.5); float a = smoothstep(0.5, 0.0, d);
        gl_FragColor = vec4(vec3(0.7, 0.85, 1.0) * a * vA * uDim, a); }`,
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
  }));
  const group = new THREE.Group(); group.add(lines, points);
  return group;
}

// ---------- composición ----------
function layout() {
  camera.updateMatrixWorld();
  const h = 2 * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)) * camera.position.z;
  const w = h * camera.aspect;
  const th = (k) => Math.PI / 2 - (k * 2 * Math.PI) / AGENTS.length;
  const extent = (k) => AGENTS[k].size * (AGENTS[k].id === 'saturno' ? 2.4 : 1.15) * 1.3 + 0.2;   // anillo, halo y crecimiento al trabajar
  const at = (k, rx, ry) => new THREE.Vector3(Math.cos(th(k)) * rx, 0.3 + Math.sin(th(k)) * ry, Math.sin(k * 1.7) * 0.6);
  // ancho y alto se ajustan por separado: la órbita usa toda la pantalla sin que ningún astro se salga
  let rx = w * 0.42, ry = h * 0.4;
  for (let i = 0; i < 40; i++) {
    let outX = false, outY = false;
    AGENTS.forEach((a, k) => {
      const p = at(k, rx, ry), e = extent(k);
      const vx = Math.max(Math.abs(p.clone().add(new THREE.Vector3(e, 0, 0)).project(camera).x), Math.abs(p.clone().add(new THREE.Vector3(-e, 0, 0)).project(camera).x));
      const vy = Math.max(p.clone().add(new THREE.Vector3(0, e, 0)).project(camera).y, -p.clone().add(new THREE.Vector3(0, -e - 0.45, 0)).project(camera).y);
      if (vx > 0.93) outX = true;
      if (vy > 0.9) outY = true;
    });
    if (!outX && !outY) break;
    if (outX) rx *= 0.97;
    if (outY) ry *= 0.97;
  }
  return AGENTS.map((a, k) => at(k, rx, ry));
}

function build() {
  if (world) { scene.remove(world.root); world.root.traverse((o) => { o.geometry?.dispose(); o.material?.map?.dispose(); o.material?.dispose(); }); }
  const q = QUALITY[ui.quality];
  const root = new THREE.Group();
  const background = makeBackgroundQuad(); root.add(background);  // nebulosa precalculada
  const stars = makeStarfield(q.stars, U); root.add(stars);
  meteorGroup = new THREE.Group(); root.add(meteorGroup); meteors.length = 0;
  const bright = makeBrightStars(q.bright, U); root.add(bright);
  root.add(makeGalaxies(q.galaxies));
  root.add(makeConstellations(ui.quality === 'baja' ? 10 : ui.quality === 'media' ? 22 : 32));
  const field = makeNeuralField(q.field); root.add(field);
  const mind = makeMind(q); root.add(mind.group);
  // onda expansiva del «¡pum!»: un anillo luminoso que sale del núcleo
  const shock = new THREE.Mesh(new THREE.RingGeometry(0.96, 1.0, 96), new THREE.MeshBasicMaterial({ color: 0xbfe6ff, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }));
  shock.position.copy(mind.group.position); shock.t = 9; root.add(shock);
  const light = new THREE.PointLight(0xbfe6ff, 3.2, 18, 1.7); light.position.copy(mind.group.position); root.add(light);
  root.add(new THREE.AmbientLight(0x26334f, 0.16));
  const anchors = layout();
  const planets = AGENTS.map((a, i) => { const p = makePlanet(a); p.group.position.copy(anchors[i]); p.anchor = anchors[i].clone(); root.add(p.group); return p; });
  const links = AGENTS.map((a, i) => { const c = makeConnection(mind.group.position, anchors[i], a.color, q.strands); root.add(c.lines); return c; });
  // constelación entre astros vecinos
  const cpos = [];
  anchors.forEach((p, i) => { const n = anchors[(i + 1) % anchors.length]; for (let s = 0; s < 1; s += 0.08) { const a = p.clone().lerp(n, s), b = p.clone().lerp(n, s + 0.04); cpos.push(a.x, a.y, a.z, b.x, b.y, b.z); } });
  const cg = new THREE.BufferGeometry(); cg.setAttribute('position', new THREE.Float32BufferAttribute(cpos, 3));
  const constellation = new THREE.LineSegments(cg, new THREE.LineBasicMaterial({ color: 0x9fb4ff, transparent: true, opacity: 0.12, blending: THREE.AdditiveBlending, depthWrite: false }));
  root.add(constellation);
  root.add(makeOrbits(anchors));
  const fox = makeFox(q); fox.group.visible = false; root.add(fox.group);   // el centro es ahora el núcleo esférico
  const thought = makeConnection(new THREE.Vector3(0, fox.group.position.y + 2.55, fox.group.position.z), new THREE.Vector3(0, 0.15, 0.2), '#ffd9a8', 3);
  thought.lines.visible = false; // el zorro ya está dentro de la mente
  root.add(thought.lines);
  scene.add(root);
  world = { root, background, stars, bright, field, shock, mind, planets, links, fox, thought, light, constellation, active: new Map(), hover: null, selected: null };
  composer = new EffectComposer(renderer);
  composer.addPass(new RenderPass(scene, camera));
  bloom = new UnrealBloomPass(new THREE.Vector2(innerWidth, innerHeight), 0.75, 0.55, 0.55);
  bloom.enabled = q.bloom;
  { const full = bloom.setSize.bind(bloom); bloom.setSize = (w, h) => full(w * 0.5, h * 0.5); }
  composer.addPass(bloom);
  composer.addPass(new OutputPass());
  buildLabels();
  resize();
}

// ---------- etiquetas (símbolo + nombre: no dependen del color) ----------
const labelsEl = document.getElementById('labels');
let labelEls = [];
function buildLabels() {
  labelsEl.innerHTML = AGENTS.map((a) => `<div class="label" data-id="${a.id}"><b>${a.symbol}</b>${a.name}</div>`).join('') + '<div class="label kratos" data-id="kratos">KRATOS</div>';
  labelEls = [...labelsEl.children];
}
const tmp = new THREE.Vector3();
function placeLabels() {
  world.planets.forEach((p, i) => {
    tmp.copy(p.group.position); tmp.y -= AGENTS[i].size * 1.35; tmp.project(camera);
    const el = labelEls[i];
    el.style.left = `${(tmp.x * 0.5 + 0.5) * innerWidth}px`; el.style.top = `${(-tmp.y * 0.5 + 0.5) * innerHeight + 6}px`;
    el.classList.toggle('on', world.active.has(AGENTS[i].id));
  });
  tmp.set(0, world.mind.group.position.y - 1.5, 0.6).project(camera); // rótulo bajo el núcleo
  const k = labelEls[labelEls.length - 1];
  k.style.left = `${(tmp.x * 0.5 + 0.5) * innerWidth}px`; k.style.top = `${(-tmp.y * 0.5 + 0.5) * innerHeight}px`;
}

// ---------- estados y eventos ----------
const PRESET = {
  reposo: { tint: '#8fdcff', fire: 0.7, spin: 0.15, dim: 1 },
  escuchando: { tint: '#9fe8ff', fire: 0.9, spin: 0.2, dim: 1 },
  pensando: { tint: '#b6a4ff', fire: 0.85, spin: 0.55, dim: 1 },
  hablando: { tint: '#c9f0ff', fire: 0.95, spin: 0.25, dim: 1 },
  ejecutando: { tint: '#8fdcff', fire: 1.0, spin: 0.3, dim: 1 },
  esperando_permiso: { tint: '#ffcf86', fire: 0.7, spin: 0.15, dim: 0.95 },
  detenido: { tint: '#ff5a66', fire: 0.18, spin: 0.0, dim: 0.55 },
};
const logEl = document.getElementById('event-log');
function log(text) { const d = document.createElement('div'); d.textContent = text; logEl.append(d); setTimeout(() => d.remove(), 6200); while (logEl.children.length > 4) logEl.firstChild.remove(); }

// Impulso de delegación: solo por un evento. En este prototipo los eventos son SIMULADOS.
function delegate(id, simulated = true, persistent = false) {
  const i = AGENTS.findIndex((a) => a.id === id);
  if (i < 0 || ui.state === 'detenido') return;
  world.active.set(id, { start: clock.elapsedTime, until: persistent ? Infinity : clock.elapsedTime + 5, persistent });
  log(`${simulated ? 'SIMULADO · ' : ''}KRATOS → ${AGENTS[i].symbol} ${AGENTS[i].name}: delegación`);
}

function setState(s, simulated = true) {
  ui.state = s;
  document.getElementById('state-name').textContent = `${STATE_NAME[s]}${simulated && s !== 'reposo' ? ' · simulado' : ''}`;
}

// ---------- bucle ----------
const clock = new THREE.Clock();
let raf = 0, frames = 0, fpsAt = performance.now(), fps = 0, cpuMs = 0;
const mouse = { x: 0, y: 0 };

const fluid = { last: 0, avg: 16.7, lowSince: 0, highSince: 0, scale: 1 };
function governFluidity(now) {
  if (fluid.last) fluid.avg = fluid.avg * 0.92 + Math.min(100, now - fluid.last) * 0.08;
  fluid.last = now;
  const slow = fluid.avg > 21, fast = fluid.avg < 15.5;
  fluid.lowSince = slow ? fluid.lowSince || now : 0;
  fluid.highSince = fast ? fluid.highSince || now : 0;
  const apply = () => { fluid.resizing = true; resize(); fluid.resizing = false; };
  // Si ya está en la resolución mínima y sigue lenta (el Mac tiene otras apps pesadas), baja la calidad: sin brillo ni estrellas de más
  if (fluid.scale <= 0.6 && fluid.lowSince && now - fluid.lowSince > 5000 && ui.quality !== 'baja') {
    ui.quality = 'baja'; store('kratos.quality', 'baja'); fluid.lowSince = 0; fluid.scale = 1; build(); frame(); log('Calidad baja automática: el Mac está ocupado');
    return;
  }
  if (fluid.lowSince && now - fluid.lowSince > 1500 && fluid.scale > 0.6) { fluid.scale = Math.max(0.6, fluid.scale - 0.15); fluid.lowSince = 0; apply(); }
  else if (fluid.highSince && now - fluid.highSince > 8000 && fluid.scale < 1) { fluid.scale = Math.min(1, fluid.scale + 0.1); fluid.highSince = 0; apply(); }
}

window.addEventListener('error', (e) => fetch('/api/fallas', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ message: `universo: ${e.message}` }) }).catch(() => {}));
function tick(now) {
  raf = 0;
  if (now) governFluidity(now);
  // límite de 30 imágenes por segundo: menos trabajo para la gráfica y el procesador
  if (now && tick.last && now - tick.last < 33) { raf = requestAnimationFrame(tick); return; }
  if (now) tick.last = now;
  if (document.hidden || ui.paused) return;
  frame();
  if (!ui.reduced) raf = requestAnimationFrame(tick);
}
function start() { if (!raf && !document.hidden && !ui.paused) { fluid.last = 0; raf = requestAnimationFrame(tick); } }

function frame() {
  const t0 = performance.now();
  const dt = Math.min(0.05, clock.getDelta());
  const t = clock.elapsedTime;
  U.time.value = ui.reduced ? 12.0 : t;
  // estado efectivo: la voz manda mientras habla contigo; si no, el estado real del sistema
  if (!ui.stateSimulated) {
    const eff = real.state === 'detenido' ? 'detenido' : voiceState() ?? real.state;
    if (eff !== ui.state) setState(eff, false);
  }
  const p = PRESET[ui.state];
  const ease = 1 - Math.pow(0.03, dt || 0.016);
  U.dim.value += (p.dim - U.dim.value) * (ui.reduced ? 1 : ease);
  const mu = world.mind.uniforms;
  mu.uTint.value.lerp(new THREE.Color(p.tint), ui.reduced ? 1 : ease);
  mu.uSpin.value += (p.spin - mu.uSpin.value) * ease;
  // nivel real: micrófono al escuchar, una pulsación por palabra al hablar, latido lento al pensar
  voice.pulse *= Math.pow(0.02, dt); voice.level *= Math.pow(0.08, dt);
  const lvl = ui.state === 'escuchando' ? voice.level : ui.state === 'hablando' ? voice.pulse : 0;
  const speakTarget = Math.max(lvl, ui.state === 'pensando' ? 0.4 + 0.15 * Math.sin(t * 3.0) : 0, ui.state === 'hablando' ? 0.35 : 0, ui.state === 'escuchando' ? 0.25 : 0, ui.state === 'ejecutando' ? 0.2 : 0);
  U.speak.value += (speakTarget - U.speak.value) * Math.min(1, dt * 8);
  mu.uLevel.value += (lvl - mu.uLevel.value) * 0.3;
  const breathe = ui.state === 'pensando' ? 0.06 * Math.sin(t * 2.4) : 0.025 * Math.sin(t * 0.8);
  voice.burst *= Math.pow(0.12, dt);
  const b = ui.reduced ? 0 : voice.burst;
  world.mind.group.scale.setScalar(1 + breathe * 0.5 + U.speak.value * 0.85 + b * 0.7);   // el núcleo crece mientras habláis y da un «¡pum!»
  world.stars.scale.setScalar(1 + U.speak.value * 0.04 + b * 0.1);                       // el cielo se despliega hacia fuera
  world.bright.scale.setScalar(1 + U.speak.value * 0.05 + b * 0.13);
  world.field.scale.setScalar(1 + U.speak.value * 0.18 + b * 0.35);                      // la nube neuronal se abre
  if (bloom) bloom.strength = 0.75 + U.speak.value * 0.45 + b * 0.9;
  const sh = world.shock; sh.t += dt;
  sh.scale.setScalar(1.2 + sh.t * 9); sh.material.opacity = Math.max(0, 0.55 * (1 - sh.t / 1.1)) * U.dim.value; sh.lookAt(camera.position);
  world.mind.syn.rotation.y = U.time.value * mu.uSpin.value * 0.5;
  world.mind.synMat.opacity = 0.14 + 0.15 * (ui.state === 'pensando' ? 1 : 0) + U.speak.value * 0.45;
  world.fox.fireU.uFire.value += (p.fire - world.fox.fireU.uFire.value) * ease;
  world.light.color.copy(mu.uTint.value);
  // astros: deriva ambiental mínima alrededor de su ancla (nunca orbitan fuera de cuadro)
  world.planets.forEach((pl, i) => {
    const a = AGENTS[i];
    pl.group.position.set(pl.anchor.x + Math.sin(t * 0.21 + i) * 0.06, pl.anchor.y + Math.sin(t * 0.33 + i * 1.7) * 0.08, pl.anchor.z);
    pl.body.rotation.y = t * (0.05 + i * 0.012);
    const act = world.active.get(a.id);
    const realStatus = taskState(a.id);
    const waiting = realStatus === 'esperando_permiso' || (ui.state === 'esperando_permiso' && a.id === 'saturno');
    const link = world.links[i].uniforms;
    let target = ['pendiente', 'esperando_ia'].includes(realStatus) ? 0.06 : 0;   // en cola: apenas visible
    if (act) {
      const elapsed = act.persistent ? (t - act.start) % 3.6 : t - act.start;
      const k = elapsed / 1.4;                                // el impulso tarda 1,4 s en llegar
      link.uPulse.value = k <= 1.15 ? k : -1;
      if (k > 1 && pl.flare < 0.01 && k < 1.2) pl.flare = 1;
      target = 1;
      if (t > act.until) world.active.delete(a.id);
    } else link.uPulse.value = -1;
    if (waiting) target = 0.8;
    link.uActive.value += (target - link.uActive.value) * ease;
    pl.flare *= Math.pow(0.15, dt);
    pl.glow.material.opacity = (a.id === 'sol' ? 0.6 : 0.16) + 0.55 * link.uActive.value + pl.flare;
    pl.glow.scale.setScalar(a.size * (a.id === 'sol' ? 4.8 : 3.1) * (1 + 0.22 * pl.flare));
    pl.halo.material.opacity = (waiting ? 0.9 : link.uActive.value * 0.8) * U.dim.value;
    pl.halo.material.color.set(waiting ? '#ffb547' : a.color);
    pl.halo.lookAt(camera.position);
    const isHover = world.hover === a.id || world.selected === a.id;
    const mu2 = pl.body.material.uniforms;
    mu2.uHover.value += ((isHover ? 1 : 0) - mu2.uHover.value) * ease;
    mu2.uActive.value = link.uActive.value;
    pl.group.scale.setScalar(1 + 0.18 * mu2.uHover.value + 0.5 * link.uActive.value);   // crece cuando KRATOS le manda trabajo
  });
  world.bright.userData.twinkle(t);
  if (!ui.reduced) {
    world.stars.rotation.z = t * 0.004;                       // el cielo gira despacio
    world.stars.rotation.y = Math.sin(t * 0.03) * 0.02;
    world.bright.rotation.z = t * 0.003;
    updateMeteors(dt);
  }
  // hilo de pensamiento: se enciende al escuchar o hablar; al hablar, un impulso por frase (simulado aquí)
  const th = world.thought.uniforms;
  const talking = ui.state === 'hablando' || ui.state === 'escuchando';
  th.uActive.value += ((talking ? 1 : 0) - th.uActive.value) * ease;
  th.uPulse.value = voice.pulse > 0.3 ? (t * 1.1) % 1.2 : -1;
  // cámara: deriva lenta y paralaje leve con el ratón
  if (!ui.reduced) {
    camera.position.x += ((Math.sin(t * 0.05) * 0.35 + mouse.x * 0.35) - camera.position.x) * 0.02;
    camera.position.y += ((0.25 + Math.cos(t * 0.04) * 0.15 + mouse.y * 0.2) - camera.position.y) * 0.02;
  }
  camera.lookAt(0, 0.2, 0);
  renderer.info.reset();
  if (bloom.enabled) composer.render(); else renderer.render(scene, camera);
  placeLabels();
  cpuMs = cpuMs * 0.9 + (performance.now() - t0) * 0.1;
  frames++;
  const now = performance.now();
  if (now - fpsAt > 1000) { fps = frames; frames = 0; fpsAt = now; updateMetrics(); }
}

function resize() {
  const q = QUALITY[ui.quality];
  const pr = Math.min(devicePixelRatio || 1, q.dpr) * (typeof fluid === 'undefined' ? 1 : fluid.scale);
  U.pixelRatio.value = pr;
  renderer.setPixelRatio(pr);
  renderer.setSize(innerWidth, innerHeight, false);
  camera.aspect = innerWidth / innerHeight;
  camera.fov = camera.aspect < 1.2 ? 58 : 42;
  camera.updateProjectionMatrix();
  composer?.setPixelRatio(pr); composer?.setSize(innerWidth, innerHeight);
  if (world) { const anchors = layout(); world.planets.forEach((p, i) => p.anchor.copy(anchors[i])); if (!fluid.resizing) world.background.material.uniforms.uTex.value = bakeBackground(); }
  if (ui.reduced || ui.paused) frame();
}

// ---------- consumo ----------
const metricsEl = document.getElementById('metrics');
function updateMetrics() {
  if (metricsEl.hidden) return;
  const info = renderer.info;
  const mem = performance.memory ? `${(performance.memory.usedJSHeapSize / 1048576).toFixed(0)} MB JS` : 'memoria JS: n/d';
  metricsEl.innerHTML = `${fps} fps · ${cpuMs.toFixed(2)} ms CPU/fotograma<br>${info.render.calls} llamadas · ${(info.render.triangles / 1000).toFixed(0)} k triángulos · ${(info.render.points / 1000).toFixed(1)} k puntos<br>calidad ${ui.quality} · resolución ×${U.pixelRatio.value.toFixed(2)} (fluidez ${Math.round(fluid.scale * 100)} %) · ${fluid.avg.toFixed(1)} ms/fotograma · ${mem}`;
}

// ---------- controles discretos ----------
const dock = document.getElementById('dock');
let idleTimer = 0;
function wake() {
  dock.classList.add('show'); document.body.classList.remove('idle');
  clearTimeout(idleTimer);
  idleTimer = setTimeout(() => { if (!dock.matches(':focus-within')) dock.classList.remove('show'); document.body.classList.add('idle'); }, 2600);
}
// ---------- interacción con los astros ----------
const ray = new THREE.Raycaster(), ndc = new THREE.Vector2();
const card = document.getElementById('card');
function pick(e) {
  ndc.set((e.clientX / innerWidth) * 2 - 1, -(e.clientY / innerHeight) * 2 + 1);
  ray.setFromCamera(ndc, camera);
  const hit = ray.intersectObjects(world.planets.map((p) => p.body), false)[0];
  return hit?.object.userData.agent ?? null;
}
function showCard(id, e) {
  if (!id) { card.hidden = true; return; }
  const a = AGENTS.find((x) => x.id === id), data = agentData(id), task = data?.current_task;
  const last = data?.last_result;
  const lastSummary = last?.result?.deliverable || last?.result?.summary || '';
  card.innerHTML = `<div class="card-h"><b>${a.symbol}</b> ${esc(a.name)}</div><div>${esc(data?.purpose ?? a.role)}</div>
    <div class="card-m">Estado: ${task ? esc(task.status) : 'disponible'}<br>Tarea actual: ${task ? `#${task.id} ${esc(task.title)}` : 'ninguna'}<br>Último resultado: ${last ? `#${last.id} ${esc(last.title)}${lastSummary ? ` · ${esc(lastSummary.slice(0, 90))}` : ''}` : 'ninguno todavía'}</div>
    <div class="card-action">Haz clic para abrir este agente</div>`;
  card.hidden = false;
  const x = Math.min(innerWidth - 280, e.clientX + 18), y = Math.min(innerHeight - 140, e.clientY + 18);
  card.style.left = `${x}px`; card.style.top = `${y}px`;
}
addEventListener('mousemove', (e) => {
  mouse.x = e.clientX / innerWidth - 0.5; mouse.y = 0.5 - e.clientY / innerHeight; wake();
  if (!world) return;
  world.hover = pick(e);
  document.body.style.cursor = world.hover ? 'pointer' : '';
  showCard(world.hover ?? world.selected, e);
  if (ui.reduced) frame();
});
canvas.addEventListener('click', (e) => {
  const id = pick(e);
  world.selected = id === world.selected ? null : id;
  showCard(world.selected, e);
  if (world.selected) openMission(world.selected);
  if (ui.reduced) frame();
});

const mission = document.getElementById('mission');
const missionForm = document.getElementById('mission-form');
function openMission(id, focus = true) {
  const agent = AGENTS.find((item) => item.id === id);
  const data = agentData(id);
  if (!agent) return;
  document.getElementById('mission-agent').value = id;
  document.getElementById('mission-title').textContent = `${agent.symbol} ${agent.name}`;
  document.getElementById('mission-purpose').textContent = data?.purpose ?? agent.role;
  const select = document.getElementById('mission-business');
  select.innerHTML = real.businesses.map((business) => `<option value="${business.id}">${esc(business.name)}${business.is_demo ? ' · DEMO' : ''}</option>`).join('');
  const task = data?.current_task;
  const last = data?.last_result;
  document.getElementById('mission-status').textContent = task ? `Tarea #${task.id}: ${task.status} · ${task.title}` : last ? `Último resultado: #${last.id} ${last.title}` : real.connected ? 'Disponible para una misión.' : 'Conectando con KRATOS…';
  mission.hidden = false;
  if (focus) document.getElementById('mission-objective').focus();
}

document.getElementById('mission-close').addEventListener('click', () => { mission.hidden = true; });
missionForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  const submit = missionForm.querySelector('button[type="submit"]');
  const status = document.getElementById('mission-status');
  const form = new FormData(missionForm);
  submit.disabled = true;
  status.textContent = 'KRATOS está registrando la misión…';
  try {
    const result = await api('/api/agents/task', {
      agentId: form.get('agentId'), businessId: Number(form.get('businessId')),
      objective: form.get('objective'), priority: Number(form.get('priority')),
      requestId: crypto.randomUUID(),
    });
    status.textContent = result.aiActive ? `Misión #${result.task.id} creada. ${result.task.ownerFunction} entrará en ejecución.` : `Misión #${result.task.id} guardada. Espera conexión y presupuesto de IA.`;
    document.getElementById('mission-objective').value = '';
    await refreshReal();
  } catch (error) {
    status.textContent = error.message;
  } finally {
    submit.disabled = false;
  }
});

let lastServerQuality = null;
async function refreshReal() {
  try {
    const [agents, overview, businesses, ajustes] = await Promise.all([api('/api/agents'), api('/api/overview'), api('/api/businesses'), api('/api/ajustes').catch(() => null)]);
    // La calidad la puede cambiar el propietario o KRATOS por voz: se aplica cuando cambia en el servidor
    if (ajustes?.ui_quality && ajustes.ui_quality !== lastServerQuality) {
      lastServerQuality = ajustes.ui_quality;
      if (ajustes.ui_quality !== ui.quality) { ui.quality = ajustes.ui_quality; store('kratos.proto.quality', ui.quality); build(); frame(); }
    }
    real.agents = agents;
    real.overview = overview;
    real.businesses = businesses.businesses ?? [];
    real.connected = true;
    document.getElementById('proto-tag').textContent = overview.ai?.active ? 'UNIVERSO KRATOS · agentes reales disponibles' : 'UNIVERSO KRATOS · agentes conectados · IA pendiente de clave o presupuesto';
    for (const agent of AGENTS) {
      const running = taskState(agent.id) === 'en_ejecucion';
      const active = world.active.get(agent.id);
      if (running && !active?.persistent) delegate(agent.id, false, true);
      if (!running && active?.persistent) world.active.delete(agent.id);
    }
    if (overview.state?.emergency_stop) real.state = 'detenido';
    else if ((overview.running ?? []).length) real.state = 'ejecutando';
    else if (overview.pendingApprovals > 0 && Date.now() - new Date(overview.latestApprovalAt ?? 0).getTime() < 120000) real.state = 'esperando_permiso';
    else real.state = 'reposo';
    if (!document.getElementById('list').hidden) renderList();
    if (!mission.hidden && world.selected) openMission(world.selected, false);
  } catch (error) {
    real.connected = false;
    document.getElementById('proto-tag').textContent = 'UNIVERSO KRATOS · sin conexión con el sistema local';
  }
}

function act(a) {
  const btn = dock.querySelector(`[data-act="${a}"]`);
  if (a === 'mute') {
    ui.muted = !ui.muted; btn.setAttribute('aria-pressed', ui.muted);
    if (nativeBridge) nativeBridge.postMessage({ event: 'mute', muted: ui.muted });
    log(ui.muted ? 'Micrófono silenciado: KRATOS no escucha' : nativeBridge ? 'Micrófono activo: di «Hey Kratos»' : 'Micrófono: solo disponible en la app de Mac');
  }
  if (a === 'pause') { ui.paused = !ui.paused; btn.setAttribute('aria-pressed', ui.paused); if (!ui.paused) { clock.getDelta(); start(); } log(ui.paused ? 'Movimiento en pausa' : 'Movimiento reanudado'); }
  if (a === 'reduced') { ui.reduced = !ui.reduced; store('kratos.proto.reduced', ui.reduced ? '1' : '0'); btn.setAttribute('aria-pressed', ui.reduced); frame(); start(); log(ui.reduced ? 'Movimiento reducido: imagen fija' : 'Movimiento completo'); }
  if (a === 'quality') { const order = ['baja', 'media', 'alta']; ui.quality = order[(order.indexOf(ui.quality) + 1) % 3]; store('kratos.proto.quality', ui.quality); document.getElementById('q-label').textContent = ui.quality[0].toUpperCase() + ui.quality.slice(1); build(); frame(); log(`Calidad ${ui.quality}`); }
  if (a === 'list') { const l = document.getElementById('list'); l.hidden = !l.hidden; btn.setAttribute('aria-pressed', !l.hidden); renderList(); }
  if (a === 'metrics') { metricsEl.hidden = !metricsEl.hidden; btn.setAttribute('aria-pressed', !metricsEl.hidden); updateMetrics(); }
  if (a === 'exit') exitExperience();
}
dock.addEventListener('click', (e) => { const b = e.target.closest('button'); if (b) act(b.dataset.act); });

function exitExperience() {
  if (embedded) return;
  // En la app de Mac: minimiza la ventana inmersiva. En el navegador: vuelve al panel.
  if (window.webkit?.messageHandlers?.kratos) window.webkit.messageHandlers.kratos.postMessage({ event: 'exitImmersive' });
  else if (document.fullscreenElement) document.exitFullscreen();
  else location.href = '/';
}

function renderList() {
  document.getElementById('list-items').innerHTML = `<li><span class="sym">✦</span><span><b>KRATOS</b><br><span class="st">Conciencia coordinadora</span></span><span class="st">${STATE_NAME[ui.state]}</span></li>` +
    AGENTS.map((a) => { const status = taskState(a.id); return `<li><span class="sym" aria-hidden="true">${a.symbol}</span><span><b>${a.name}</b><br><span class="st">${a.role}</span></span><span class="st ${status === 'en_ejecucion' ? 'on' : ''}">${status ? esc(status.replaceAll('_', ' ')) : 'disponible'}</span></li>`; }).join('');
}

addEventListener('keydown', (e) => {
  wake();
  const k = e.key.toLowerCase();
  if (e.key === 'Escape') {
    const open = ['help', 'list'].map((id) => document.getElementById(id)).find((el) => !el.hidden);
    if (open) open.hidden = true; else exitExperience();
    return;
  }
  if (e.key === ' ') { e.preventDefault(); act('pause'); }
  if (k === 'm') act('mute');
  if (k === 'r') act('reduced');
  if (k === 'q') act('quality');
  if (k === 'l') act('list');
  if (k === 'i') act('metrics');
  if (k === 'h' || k === '?') { const h = document.getElementById('help'); h.hidden = !h.hidden; }
  if (k === 'f') { document.fullscreenElement ? document.exitFullscreen() : document.documentElement.requestFullscreen?.(); }
  if (k === 's') { const n = STATES[(STATES.indexOf(ui.state) + 1) % STATES.length]; ui.stateSimulated = n !== 'reposo'; setState(n); if (n === 'ejecutando') { delegate('marte'); delegate('saturno'); } frame(); }
  if (/^[1-7]$/.test(k)) { delegate(AGENTS[Number(k) - 1].id); if (ui.reduced) frame(); }
  if (!document.getElementById('list').hidden) renderList();
});
document.addEventListener('visibilitychange', () => { if (!document.hidden) { clock.getDelta(); start(); } });
addEventListener('resize', resize);

// API para pruebas automáticas (estado y métricas, sin efectos fuera de la página)
window.kratosProto = { setState, delegate, frame, metrics: () => ({ fps, cpuMs, calls: renderer.info.render.calls, points: renderer.info.render.points, quality: ui.quality }) };

document.getElementById('q-label').textContent = ui.quality[0].toUpperCase() + ui.quality.slice(1);
dock.querySelector('[data-act="reduced"]').setAttribute('aria-pressed', ui.reduced);
build();
setState('reposo', false);
frame();
start();
wake();
refreshReal();
setInterval(refreshReal, 2500);

// Reporte: al pedir «dame un reporte», un panel a la izquierda con dinero invertido y ganado, trabajo y decisiones.
const fmtUsd = (n) => (n === null || n === undefined ? 'desconocido' : `${Number(n).toLocaleString('es', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} USD`);
let reportTimer = null;
window.kratosReport = async () => {
  let r;
  try { r = await api('/api/report'); } catch { return; }
  let el = document.getElementById('reporte');
  if (!el) { el = document.createElement('aside'); el.id = 'reporte'; el.setAttribute('aria-label', 'Reporte'); document.body.append(el); }
  const pct = r.money.assignedUsd ? Math.min(100, (r.money.investedUsd / r.money.assignedUsd) * 100) : 0;
  el.innerHTML = `
    <header><span>Reporte</span><button type="button" data-close-report aria-label="Cerrar">×</button></header>
    <div class="rp-grid">
      <div class="rp-card"><small>Invertido</small><b>${fmtUsd(r.money.investedUsd)}</b><i style="--p:${pct}%"></i><small>de ${fmtUsd(r.money.assignedUsd)} asignados</small></div>
      <div class="rp-card ${r.money.earnedUsd ? 'up' : ''}"><small>Ganado</small><b>${r.money.earnedUsd === null ? 'Sin ventas aún' : fmtUsd(r.money.earnedUsd)}</b><small>meta: 250.000 USD / mes</small></div>
      <div class="rp-card"><small>Disponible</small><b>${fmtUsd(r.money.availableUsd)}</b><small>IA 30 días: ${fmtUsd(r.money.aiCost30dUsd)} · ${r.money.aiCalls30d} usos</small></div>
      <div class="rp-card"><small>Usuarios</small><b>${r.goal.users === null ? 'desconocido' : Number(r.goal.users).toLocaleString('es')}</b><small>hito 10.000 · meta 100.000</small></div>
    </div>
    <h4>Trabajo (7 días)</h4>
    <p>${r.work.done7} completadas · ${r.work.running} en curso · ${r.work.queued} en cola</p>
    <ul>${r.work.recent.map((t) => `<li><em>${esc(t.owner_function)}</em> ${esc(t.title)}</li>`).join('') || '<li>Sin tareas completadas esta semana.</li>'}</ul>
    ${r.apps.length ? `<h4>Apps en Apple</h4><ul>${r.apps.map((a) => `<li>${esc(a.name)} ${esc(a.version ?? '')} — ${esc(a.state ?? '')}</li>`).join('')}</ul>` : ''}
    <h4>Decisiones pendientes</h4>
    <ul>${r.approvals.map((a) => `<li>#${a.id} ${esc(a.description)}</li>`).join('') || '<li>Ninguna.</li>'}</ul>
    ${r.lessons.length ? `<h4>Aprendizajes</h4><ul>${r.lessons.map((l) => `<li><em>${l.kind === 'funciono' ? '✓' : l.kind === 'no_funciono' ? '✗' : '•'}</em> ${esc(l.content)}</li>`).join('')}</ul>` : ''}`;
  requestAnimationFrame(() => el.classList.add('open'));
  clearTimeout(reportTimer);
  reportTimer = setTimeout(() => el.classList.remove('open'), 90_000);
};
addEventListener('click', (e) => { if (e.target.closest?.('[data-close-report]')) document.getElementById('reporte')?.classList.remove('open'); });
