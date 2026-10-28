// Cielo profundo «de telescopio»: estrellas con color por temperatura y brillo en ley de potencias,
// franja galáctica con polvo, estrellas brillantes con difracción y galaxias lejanas. Todo procedural.
import * as THREE from 'three';

const rand = (a, b) => a + Math.random() * (b - a);
// Colores aproximados por tipo espectral (O/B azul … M rojo), ponderados por frecuencia aparente
const SPECTRAL = [[0.55, 0.7, 1.0, 0.16], [0.75, 0.85, 1.0, 0.24], [1.0, 1.0, 1.0, 0.2], [1.0, 0.92, 0.75, 0.18], [1.0, 0.78, 0.5, 0.14], [1.0, 0.6, 0.38, 0.08]];
function spectral() { let r = Math.random(); for (const c of SPECTRAL) { if ((r -= c[3]) <= 0) return c; } return SPECTRAL[2]; }

// Dirección de la franja galáctica en el plano del cielo
const BAND = new THREE.Vector2(Math.cos(-0.45), Math.sin(-0.45));

export function makeStarfield(count, U) {
  const g = new THREE.BufferGeometry();
  const pos = new Float32Array(count * 3), col = new Float32Array(count * 3), size = new Float32Array(count), seed = new Float32Array(count);
  for (let i = 0; i < count; i++) {
    const z = -rand(18, 110);
    const spread = (-z + 14) * 0.62;
    let x = rand(-spread, spread) * 1.7, y = rand(-spread, spread);
    // ~45 % de las estrellas se concentran en la franja galáctica
    if (Math.random() < 0.45) {
      const t = rand(-spread * 1.7, spread * 1.7), off = (Math.random() + Math.random() + Math.random() - 1.5) * spread * 0.16;
      x = BAND.x * t - BAND.y * off; y = BAND.y * t + BAND.x * off;
    }
    pos.set([x, y, z], i * 3);
    const c = spectral();
    col.set([c[0], c[1], c[2]], i * 3);
    size[i] = 0.5 + Math.pow(Math.random(), 7) * 3.2; // muchas débiles, pocas brillantes
    seed[i] = Math.random();
  }
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  g.setAttribute('size', new THREE.BufferAttribute(size, 1));
  g.setAttribute('seed', new THREE.BufferAttribute(seed, 1));
  return new THREE.Points(g, new THREE.ShaderMaterial({
    uniforms: { uTime: U.time, uDim: U.dim, uPR: U.pixelRatio },
    vertexShader: `attribute vec3 color; attribute float size; attribute float seed; varying vec3 vC; varying float vA; uniform float uTime; uniform float uPR;
      void main(){ vC = color; vA = (0.35 + 0.65 * smoothstep(0.5, 3.0, size)) * (0.8 + 0.2 * sin(uTime * (0.8 + seed * 2.0) + seed * 60.0));
        vec4 mv = modelViewMatrix * vec4(position, 1.0); gl_PointSize = size * uPR; gl_Position = projectionMatrix * mv; }`,
    fragmentShader: `varying vec3 vC; varying float vA; uniform float uDim;
      void main(){ float d = length(gl_PointCoord - 0.5); float core = smoothstep(0.5, 0.0, d); core *= core;
        gl_FragColor = vec4(vC * core * vA * 1.3 * uDim, core); }`,
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
  }));
}

function spikeTexture() {
  const s = 256, c = document.createElement('canvas'); c.width = c.height = s;
  const g = c.getContext('2d');
  const r = g.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
  r.addColorStop(0, 'rgba(255,255,255,1)'); r.addColorStop(0.06, 'rgba(255,255,255,.65)'); r.addColorStop(0.2, 'rgba(180,200,255,.12)'); r.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = r; g.fillRect(0, 0, s, s);
  g.globalCompositeOperation = 'lighter';
  // Picos de difracción inspirados en Webb: seis principales (cada 60°) y dos horizontales tenues
  const spike = (angle, w, a, len) => {
    const lg = g.createLinearGradient(0, 0, s * len, 0);
    lg.addColorStop(0, 'rgba(255,255,255,0)'); lg.addColorStop(0.5, `rgba(255,255,255,${a})`); lg.addColorStop(1, 'rgba(255,255,255,0)');
    g.save(); g.translate(s / 2, s / 2); g.rotate(angle); g.fillStyle = lg; g.fillRect(-s * len / 2, -w / 2, s * len, w); g.restore();
  };
  for (const ang of [Math.PI / 2, Math.PI / 2 + Math.PI / 3, Math.PI / 2 - Math.PI / 3]) { spike(ang, 2.6, 0.5, 1); spike(ang, 1, 0.9, 0.9); }
  spike(0, 1.4, 0.35, 0.55);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}

function galaxyTexture(kind) {
  const s = 128, c = document.createElement('canvas'); c.width = c.height = s;
  const g = c.getContext('2d');
  g.translate(s / 2, s / 2);
  if (kind === 'espiral') {
    for (let i = 0; i < 900; i++) {
      const arm = i % 2, t = Math.random() * 3.2, r = t * 16 + rand(-3, 3);
      const a = t * 1.9 + arm * Math.PI + rand(-0.25, 0.25);
      g.fillStyle = `rgba(${200 + rand(0, 55)},${190 + rand(0, 50)},255,${0.25 * (1 - t / 3.4)})`;
      g.fillRect(Math.cos(a) * r, Math.sin(a) * r * 0.45, 1.5, 1.5);
    }
  }
  const core = g.createRadialGradient(0, 0, 0, 0, 0, kind === 'espiral' ? 22 : 40);
  core.addColorStop(0, 'rgba(255,240,215,.9)'); core.addColorStop(0.3, 'rgba(255,220,190,.3)'); core.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = core; g.scale(1, kind === 'espiral' ? 0.45 : 0.6); g.beginPath(); g.arc(0, 0, 60, 0, 7); g.fill();
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}

export function makeBrightStars(count, U) {
  const group = new THREE.Group();
  const tex = spikeTexture();
  for (let i = 0; i < count; i++) {
    const c = spectral();
    const m = new THREE.SpriteMaterial({ map: tex, color: new THREE.Color(c[0], c[1], c[2]), blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, opacity: rand(0.35, 0.9) });
    const sp = new THREE.Sprite(m);
    const z = -rand(25, 80), spread = (-z + 14) * 0.58;
    sp.position.set(rand(-spread, spread) * 1.7, rand(-spread, spread), z);
    sp.scale.setScalar(rand(0.8, 2.6) * (-z / 40));
    sp.userData.base = m.opacity; sp.userData.seed = Math.random() * 50;
    group.add(sp);
  }
  group.userData.twinkle = (t) => group.children.forEach((sp) => { sp.material.opacity = sp.userData.base * U.dim.value * (0.85 + 0.15 * Math.sin(t * 1.3 + sp.userData.seed)); });
  return group;
}

export function makeGalaxies(count) {
  const group = new THREE.Group();
  const tex = { espiral: galaxyTexture('espiral'), eliptica: galaxyTexture('eliptica') };
  for (let i = 0; i < count; i++) {
    const kind = Math.random() < 0.6 ? 'espiral' : 'eliptica';
    const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex[kind], blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, opacity: rand(0.25, 0.6), rotation: rand(0, Math.PI) }));
    const z = -rand(60, 120), spread = (-z + 14) * 0.55;
    sp.position.set(rand(-spread, spread) * 1.7, rand(-spread, spread), z);
    sp.scale.setScalar(rand(2, 5.5));
    group.add(sp);
  }
  return group;
}

// Fondo: nebulosa con franja galáctica, polvo oscuro y nubes de color
export function makeNebula(U) {
  const m = new THREE.ShaderMaterial({
    uniforms: { uTime: U.time, uDim: U.dim, uBand: { value: BAND } },
    vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.9999, 1.0); }`,
    fragmentShader: `
      varying vec2 vUv; uniform float uTime; uniform float uDim; uniform vec2 uBand;
      float h(vec2 p){ return fract(sin(dot(p, vec2(127.1,311.7))) * 43758.5453); }
      float n(vec2 p){ vec2 i=floor(p), f=fract(p); f=f*f*(3.0-2.0*f);
        return mix(mix(h(i),h(i+vec2(1,0)),f.x), mix(h(i+vec2(0,1)),h(i+vec2(1,1)),f.x), f.y); }
      float fbm(vec2 p){ float v=0.0, a=0.5; for(int i=0;i<7;i++){ v+=a*n(p); p=p*2.03+vec2(1.7,9.2); a*=0.5; } return v; }
      void main(){
        vec2 p = (vUv - 0.5) * vec2(1.78, 1.0);
        float t = uTime * 0.003;
        float along = dot(p, uBand), across = dot(p, vec2(-uBand.y, uBand.x));
        float band = exp(-across * across * 16.0);
        float glow = fbm(vec2(along * 3.0, across * 9.0) + t);
        float grain = pow(n(p * 900.0), 18.0) * 2.0 + pow(n(p * 520.0 + 3.1), 22.0) * 1.5;   // estrellas no resueltas
        // cielo: azul profundo con bruma azul (luz dispersada)
        vec3 col = mix(vec3(0.004, 0.01, 0.03), vec3(0.01, 0.035, 0.09), vUv.y);
        float haze = fbm(p * 2.4 + vec2(t, -t * 0.6));
        col += vec3(0.04, 0.12, 0.30) * pow(haze, 2.6) * 0.9;
        col += vec3(0.10, 0.14, 0.26) * band * glow * 0.45;
        col += vec3(0.85, 0.9, 1.0) * grain * (0.25 + band * 0.35);
        // acantilados de polvo: cresta irregular en la parte baja, borde iluminado, interior texturizado
        float x = p.x;
        float ridge = -0.34 + 0.06 * fbm(vec2(x * 2.2, 1.3)) + 0.05 * sin(x * 3.1 + 0.6) + 0.03 * fbm(vec2(x * 9.0, 4.2));
        float below = ridge - p.y;
        float mask = smoothstep(-0.015, 0.03, below);
        float dustTex = fbm(vec2(x * 7.0, p.y * 9.0) + vec2(t * 0.5, 0.0));
        float deep = fbm(vec2(x * 3.0, p.y * 4.0) + 5.0);
        vec3 amber = mix(vec3(0.42, 0.17, 0.05), vec3(0.95, 0.58, 0.22), dustTex);
        amber = mix(amber, vec3(0.16, 0.06, 0.03), smoothstep(0.08, 0.32, below) * (0.6 + 0.4 * deep));
        float rim = exp(-below * below * 900.0) * smoothstep(-0.02, 0.0, below + 0.02);
        vec3 cliff = (amber * (0.55 + 0.6 * dustTex)) * 0.30 + vec3(1.0, 0.7, 0.4) * rim * 0.32;
        // jirones de polvo por encima de la cresta
        float wisps = smoothstep(0.55, 0.9, fbm(vec2(x * 4.0, p.y * 7.0) - vec2(t, 0.0))) * smoothstep(0.25, 0.0, -below);
        col += vec3(0.75, 0.42, 0.16) * wisps * 0.12;
        col = mix(col, cliff, mask * 0.96);
        col += vec3(0.03, 0.045, 0.11) * smoothstep(0.9, 0.0, length(p - vec2(0.0, 0.05))) * 0.3;   // luz de la mente
        gl_FragColor = vec4(col * uDim, 1.0);
      }`,
    depthWrite: false, depthTest: false,
  });
  const q = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), m);
  q.frustumCulled = false; q.renderOrder = -10;
  return q;
}
