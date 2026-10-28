// Superficies de los siete astros con ruido 3D en el shader (sin texturas de terceros):
// iluminación desde la mente de KRATOS, terminador suave, atmósfera y movimiento lento.
import * as THREE from 'three';

const TYPES = { sol: 0, mercurio: 1, venus: 2, marte: 3, jupiter: 4, saturno: 5, luna: 6 };

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
  return new THREE.ShaderMaterial({
    uniforms: {
      uTime: U.time, uDim: U.dim, uType: { value: TYPES[a.id] },
      uColor: { value: new THREE.Color(a.color) }, uLight: { value: lightPos.clone() }, uHover: { value: 0 }, uActive: { value: 0 },
    },
    vertexShader: `varying vec3 vObj; varying vec3 vN; varying vec3 vW; varying vec3 vV;
      void main(){ vObj = normalize(position); vN = normalize(mat3(modelMatrix) * normal);
        vec4 w = modelMatrix * vec4(position, 1.0); vW = w.xyz; vV = normalize(cameraPosition - w.xyz);
        gl_Position = projectionMatrix * viewMatrix * w; }`,
    fragmentShader: `${NOISE}
      varying vec3 vObj; varying vec3 vN; varying vec3 vW; varying vec3 vV;
      uniform float uTime; uniform float uDim; uniform int uType; uniform vec3 uColor; uniform vec3 uLight; uniform float uHover; uniform float uActive;
      void main(){
        vec3 p = vObj; float t = uTime;
        vec3 L = normalize(uLight - vW);
        float lambert = dot(vN, L);
        float lit = smoothstep(-0.25, 0.6, lambert);
        float fres = pow(1.0 - max(dot(vN, vV), 0.0), 3.0);
        vec3 c;
        if (uType == 0) {                                            // Sol: granulación viva y oscurecimiento del limbo
          float g = fbm(p * 7.0 + vec3(0.0, t * 0.08, t * 0.05));
          float spots = smoothstep(0.72, 0.8, fbm(p * 3.0 - t * 0.01));
          c = mix(vec3(1.0, 0.55, 0.12), vec3(1.0, 0.92, 0.6), g) * (1.0 - spots * 0.5);
          c *= mix(1.0, 0.55, pow(1.0 - max(dot(vN, vV), 0.0), 1.5));
          c *= 1.15; lit = 1.0;
        } else if (uType == 1) {                                     // Mercurio: roca con cráteres y brillo cian
          float cr = craters(p * 6.0); float rim = smoothstep(0.02, 0.06, cr) - smoothstep(0.06, 0.12, cr);
          c = mix(vec3(0.32, 0.38, 0.42), vec3(0.62, 0.7, 0.74), fbm(p * 8.0)) * (0.75 + 0.25 * smoothstep(0.0, 0.05, cr)) + rim * 0.15;
          c = mix(c, uColor, 0.18);
        } else if (uType == 2) {                                     // Venus: nubes densas que giran
          vec3 q = p + vec3(fbm(p * 2.0 + t * 0.03), fbm(p * 2.0 - t * 0.02), 0.0);
          float sw = fbm(vec3(q.x * 3.0, q.y * 9.0, q.z * 3.0));
          c = mix(vec3(0.75, 0.42, 0.32), vec3(1.0, 0.82, 0.66), sw);
        } else if (uType == 3) {                                     // Marte: óxido, mares oscuros, casquetes polares
          float h = fbm(p * 4.5);
          c = mix(vec3(0.55, 0.16, 0.07), vec3(0.85, 0.38, 0.18), h);
          c = mix(c, vec3(0.25, 0.08, 0.05), smoothstep(0.55, 0.7, fbm(p * 2.2 + 4.0)));
          c = mix(c, vec3(1.0, 0.95, 0.92), smoothstep(0.82, 0.9, abs(p.y)));
        } else if (uType == 4) {                                     // Júpiter: bandas con turbulencia y gran mancha
          float lat = p.y + 0.08 * fbm(p * 5.0 + vec3(t * 0.02, 0.0, 0.0));
          float bands = sin(lat * 22.0) * 0.5 + 0.5;
          c = mix(vec3(0.36, 0.24, 0.62), vec3(0.86, 0.8, 1.0), bands * 0.8 + fbm(p * 12.0) * 0.2);
          float spot = smoothstep(0.22, 0.0, length(vec2(atan(p.z, p.x) - 1.2 - t * 0.01, (p.y + 0.3) * 2.6)));
          c = mix(c, vec3(1.0, 0.7, 0.85), spot * 0.8);
        } else if (uType == 5) {                                     // Saturno: bandas suaves índigo
          float bands = sin(p.y * 16.0 + fbm(p * 4.0) * 1.5) * 0.5 + 0.5;
          c = mix(vec3(0.24, 0.27, 0.62), vec3(0.72, 0.76, 1.0), bands * 0.7);
        } else {                                                     // Luna: mares y cráteres plateados
          float cr = craters(p * 5.0);
          float maria = smoothstep(0.5, 0.62, fbm(p * 1.8 + 7.0));
          c = mix(vec3(0.82, 0.86, 0.94), vec3(0.42, 0.46, 0.55), maria) * (0.7 + 0.3 * smoothstep(0.0, 0.07, cr));
        }
        c = mix(vec3(dot(c, vec3(0.299, 0.587, 0.114))), c, 1.55);   // más color: el tono ACES y el resplandor desaturan
        vec3 night = c * 0.035;
        vec3 col = mix(night, c * (0.12 + 0.62 * lit), lit);
        col += uColor * fres * (0.28 + 0.6 * uActive + 0.45 * uHover) * (uType == 0 ? 0.3 : 1.0);   // atmósfera
        gl_FragColor = vec4(col * uDim * (1.0 + 0.25 * uHover), 1.0);
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
        gl_FragColor = vec4(mix(uColor, vec3(0.95, 0.92, 1.0), bands * 0.5) * a * 0.9, a); }`,
    transparent: true, side: THREE.DoubleSide, depthWrite: false,
  });
}
