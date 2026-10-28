// Superficies de los siete astros con ruido 3D en el shader (sin texturas de terceros):
// iluminación desde la mente de KRATOS, terminador suave, atmósfera y movimiento lento.
import * as THREE from 'three';

const TYPES = { sol: 0, mercurio: 1, venus: 2, marte: 3, jupiter: 4, saturno: 5, luna: 6 };
const MAPS = {
  mercurio: '/prototipo/textures/mercury.webp',
  venus: '/prototipo/textures/venus.webp',
  marte: '/prototipo/textures/mars.webp',
  jupiter: '/prototipo/textures/jupiter.webp',
  saturno: '/prototipo/textures/saturn.webp',
  luna: '/prototipo/textures/moon.webp',
};
const textureLoader = new THREE.TextureLoader();
const textureCache = new Map();
function planetMap(id) {
  if (!MAPS[id]) return null;
  if (!textureCache.has(id)) {
    const texture = textureLoader.load(MAPS[id]);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.wrapS = THREE.RepeatWrapping;
    textureCache.set(id, texture);
  }
  return textureCache.get(id);
}

const NOISE = `
  vec3 hash3(vec3 p){ p = vec3(dot(p,vec3(127.1,311.7,74.7)), dot(p,vec3(269.5,183.3,246.1)), dot(p,vec3(113.5,271.9,124.6))); return fract(sin(p)*43758.5453); }
  float vnoise(vec3 p){ vec3 i=floor(p), f=fract(p); f=f*f*(3.0-2.0*f);
    float n000=hash3(i).x, n100=hash3(i+vec3(1,0,0)).x, n010=hash3(i+vec3(0,1,0)).x, n110=hash3(i+vec3(1,1,0)).x;
    float n001=hash3(i+vec3(0,0,1)).x, n101=hash3(i+vec3(1,0,1)).x, n011=hash3(i+vec3(0,1,1)).x, n111=hash3(i+vec3(1,1,1)).x;
    return mix(mix(mix(n000,n100,f.x),mix(n010,n110,f.x),f.y), mix(mix(n001,n101,f.x),mix(n011,n111,f.x),f.y), f.z); }
  float fbm(vec3 p){ float v=0.0, a=0.5; for(int i=0;i<6;i++){ v+=a*vnoise(p); p=p*2.02+vec3(3.1,1.7,5.3); a*=0.5; } return v; }
  float craters(vec3 p){ vec3 i=floor(p), f=fract(p); float m=1.0;
    for(int x=-1;x<=1;x++) for(int y=-1;y<=1;y++) for(int z=-1;z<=1;z++){ vec3 o=vec3(x,y,z); vec3 r=o+hash3(i+o)-f; m=min(m, dot(r,r)); }
    return m; }
`;

export function planetMaterial(a, U, lightPos) {
  const map = planetMap(a.id);
  return new THREE.ShaderMaterial({
    uniforms: {
      uTime: U.time, uDim: U.dim, uType: { value: TYPES[a.id] },
      uColor: { value: new THREE.Color(a.color) }, uLight: { value: lightPos.clone() }, uHover: { value: 0 }, uActive: { value: 0 },
      uMap: { value: map }, uHasMap: { value: map ? 1 : 0 },
    },
    vertexShader: `varying vec2 vUv; varying vec3 vObj; varying vec3 vN; varying vec3 vW; varying vec3 vV;
      void main(){ vUv = uv; vObj = normalize(position); vN = normalize(mat3(modelMatrix) * normal);
        vec4 w = modelMatrix * vec4(position, 1.0); vW = w.xyz; vV = normalize(cameraPosition - w.xyz);
        gl_Position = projectionMatrix * viewMatrix * w; }`,
    fragmentShader: `${NOISE}
      varying vec2 vUv; varying vec3 vObj; varying vec3 vN; varying vec3 vW; varying vec3 vV;
      uniform float uTime; uniform float uDim; uniform int uType; uniform vec3 uColor; uniform vec3 uLight; uniform float uHover; uniform float uActive; uniform sampler2D uMap; uniform float uHasMap;
      void main(){
        vec3 p = vObj; float t = uTime;
        vec3 L = normalize(uLight - vW);
        float lambert = dot(vN, L);
        float lit = smoothstep(-0.75, 0.55, lambert);   // casi todo iluminado, con sombra suave en el borde
        float fres = pow(1.0 - max(dot(vN, vV), 0.0), 3.0);
        vec3 c;
        vec3 atmo = vec3(0.0); float atmoK = 0.0;
        if (uType == 0) {                                            // Sol: blanco amarillento, granulación, manchas, limbo oscuro
          float g = fbm(p * 9.0 + vec3(0.0, t * 0.06, t * 0.04));
          float spots = smoothstep(0.74, 0.8, fbm(p * 3.0 - t * 0.008));
          c = mix(vec3(1.0, 0.72, 0.32), vec3(1.0, 0.97, 0.86), g) * (1.0 - spots * 0.6);
          c *= mix(1.0, 0.6, pow(1.0 - max(dot(vN, vV), 0.0), 1.4));
          c *= 1.15; lit = 1.0;
        } else if (uType == 1) {                                     // Mercurio: gris parduzco con cráteres
          float cr = craters(p * 7.0); float rim = smoothstep(0.02, 0.05, cr) - smoothstep(0.05, 0.1, cr);
          c = mix(vec3(0.36, 0.33, 0.30), vec3(0.62, 0.58, 0.54), fbm(p * 9.0)) * (0.72 + 0.28 * smoothstep(0.0, 0.05, cr)) + rim * 0.12;
        } else if (uType == 2) {                                     // Venus: nubes amarillo pálido muy densas
          vec3 q = p + vec3(fbm(p * 2.0 + t * 0.02), fbm(p * 2.0 - t * 0.015), 0.0);
          float sw = fbm(vec3(q.x * 2.5, q.y * 7.0, q.z * 2.5));
          c = mix(vec3(0.82, 0.68, 0.42), vec3(0.98, 0.92, 0.74), sw);
          atmo = vec3(1.0, 0.9, 0.65); atmoK = 0.5;
        } else if (uType == 3) {                                     // Marte: óxido, regiones oscuras, casquetes polares
          float h = fbm(p * 5.0);
          c = mix(vec3(0.62, 0.24, 0.10), vec3(0.86, 0.47, 0.24), h);
          c = mix(c, vec3(0.30, 0.13, 0.08), smoothstep(0.55, 0.7, fbm(p * 2.2 + 4.0)) * 0.85);
          c = mix(c, vec3(0.97, 0.95, 0.93), smoothstep(0.84, 0.9, abs(p.y)));
          atmo = vec3(0.95, 0.6, 0.4); atmoK = 0.18;
        } else if (uType == 4) {                                     // Júpiter: zonas crema, cinturones marrones, Gran Mancha Roja
          float lat = p.y + 0.06 * fbm(p * 6.0 + vec3(t * 0.015, 0.0, 0.0));
          float b1 = sin(lat * 20.0) * 0.5 + 0.5, b2 = sin(lat * 47.0 + 1.3) * 0.5 + 0.5;
          c = mix(vec3(0.55, 0.38, 0.25), vec3(0.93, 0.86, 0.74), b1 * 0.75 + b2 * 0.15 + fbm(p * 14.0) * 0.12);
          c = mix(c, vec3(0.42, 0.27, 0.18), smoothstep(0.75, 0.95, sin(lat * 9.0)) * 0.5);
          float lon = atan(p.z, p.x) - 1.1 - t * 0.008;
          float spot = smoothstep(0.24, 0.0, length(vec2(lon, (p.y + 0.36) * 2.4)));
          c = mix(c, vec3(0.78, 0.36, 0.22), spot * 0.85);
          atmo = vec3(0.95, 0.85, 0.7); atmoK = 0.25;
        } else if (uType == 5) {                                     // Saturno: dorado pálido, bandas suaves
          float bands = sin(p.y * 18.0 + fbm(p * 4.0) * 1.2) * 0.5 + 0.5;
          c = mix(vec3(0.76, 0.64, 0.42), vec3(0.95, 0.88, 0.68), bands * 0.7 + fbm(p * 10.0) * 0.1);
          atmo = vec3(0.95, 0.85, 0.6); atmoK = 0.2;
        } else {                                                     // Luna: gris con mares oscuros y cráteres
          float cr = craters(p * 6.0);
          float maria = smoothstep(0.5, 0.62, fbm(p * 1.8 + 7.0));
          c = mix(vec3(0.72, 0.71, 0.69), vec3(0.34, 0.34, 0.35), maria) * (0.7 + 0.3 * smoothstep(0.0, 0.07, cr));
        }
        c = mix(vec3(dot(c, vec3(0.299, 0.587, 0.114))), c, 1.35);    // compensa la desaturación del tono ACES
        vec3 night = c * 0.12;
        vec3 col = mix(night, c * (0.1 + 0.55 * lit), lit);
        col += atmo * fres * atmoK;                                                  // atmósfera real (si la tiene)
        col += uColor * fres * (0.6 * uActive + 0.35 * uHover);                     // color simbólico solo al trabajar o al señalarlo
        gl_FragColor = vec4(col * uDim * (0.82 + 0.18 * uHover), 1.0);
      }`,
  });
}

// Anillos de Saturno con la división de Cassini, sombreados por ruido radial
export function ringMaterial(color) {
  return new THREE.ShaderMaterial({
    uniforms: { uColor: { value: new THREE.Color(color) } },
    vertexShader: `varying vec2 vP; void main(){ vP = position.xy; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
    fragmentShader: `varying vec2 vP; uniform vec3 uColor;
      float h(float x){ return fract(sin(x * 91.7) * 4375.5); }
      void main(){ float r = length(vP); float k = r * 60.0; float bands = mix(h(floor(k)), h(floor(k) + 1.0), fract(k));
        float cassini = smoothstep(0.012, 0.0, abs(r - 0.78 * 0.92)); float edge = smoothstep(0.55, 0.6, r) * (1.0 - smoothstep(0.98, 1.0, r));
        float a = edge * (0.25 + 0.55 * bands) * (1.0 - cassini * 0.9);
        gl_FragColor = vec4(mix(vec3(0.62, 0.52, 0.38), vec3(0.96, 0.9, 0.78), bands) * a * 0.85, a); }`,
    transparent: true, side: THREE.DoubleSide, depthWrite: false,
  });
}
