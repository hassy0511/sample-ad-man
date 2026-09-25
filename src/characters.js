import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { GeoBatch, M, clamp, damp, dampAngle } from './util.js';

// ---------------------------------------------------------------------------
// 共有マテリアル・ジオメトリ
// ---------------------------------------------------------------------------
export const CHAR_MAT = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.6, metalness: 0 });
const EYE_MAT = new THREE.MeshStandardMaterial({ color: '#15151c', roughness: 0.25 });
const MOUTH_MAT = new THREE.MeshStandardMaterial({ color: '#5b2626', roughness: 0.5 });
const SWEAT_MAT = new THREE.MeshStandardMaterial({ color: '#8fd3ff', roughness: 0.1, transparent: true, opacity: 0.9 });
const STAR_MAT = new THREE.MeshBasicMaterial({ color: new THREE.Color(2.2, 1.9, 0.6) });
const PENLIGHT_MAT = new THREE.MeshBasicMaterial({ color: new THREE.Color(3.0, 0.9, 2.2) });

export const OUTLINE_MAT = new THREE.ShaderMaterial({
  uniforms: { color: { value: new THREE.Color('#1a2033') }, thickness: { value: 0.017 } },
  vertexShader: /* glsl */`
    uniform float thickness;
    void main() {
      vec3 p = position + normalize(normal) * thickness;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
    }`,
  fragmentShader: /* glsl */`
    uniform vec3 color;
    void main() {
      gl_FragColor = vec4(color, 1.0);
      #include <colorspace_fragment>
    }`,
  side: THREE.BackSide,
});

export const SHARED = new Set([CHAR_MAT, EYE_MAT, MOUTH_MAT, SWEAT_MAT, STAR_MAT, PENLIGHT_MAT, OUTLINE_MAT]);

const unitSphere = new THREE.SphereGeometry(1, 10, 8);
const sphereLo = new THREE.SphereGeometry(1, 7, 5);
// 背景の社員（lite）は頂点数を大きく減らす
let LITE = false;
const sph = () => (LITE ? sphereLo : unitSphere);
const unitBox = new THREE.BoxGeometry(1, 1, 1);
const G = {
  head: new THREE.SphereGeometry(0.3, 22, 16),
  headLite: new THREE.SphereGeometry(0.3, 13, 9),
  hand: new THREE.SphereGeometry(0.07, 10, 8),
  shoe: new RoundedBoxGeometry(0.14, 0.08, 0.22, 2, 0.035),
  star: new THREE.OctahedronGeometry(0.055, 0),
};
for (const g of [unitSphere, sphereLo, unitBox, G.star]) SHARED.add(g);
for (const g of Object.values(G)) SHARED.add(g);

const cache = new Map();
function geo(key, make) {
  if (!cache.has(key)) cache.set(key, make());
  return cache.get(key);
}
const capsule = (r, l) => (LITE
  ? geo(`capL${r}_${l}`, () => new THREE.CapsuleGeometry(r, l, 2, 7))
  : geo(`cap${r}_${l}`, () => new THREE.CapsuleGeometry(r, l, 3, 10)));
const rbox = (w, h, d, r) => geo(`rb${LITE}${w}_${h}_${d}_${r}`, () => new RoundedBoxGeometry(w, h, d, LITE ? 1 : 2, r));
const cyl = (rt, rb, h, s = 14) => geo(`cy${rt}_${rb}_${h}_${s}`, () => new THREE.CylinderGeometry(rt, rb, h, s));
const cap = (r, theta, phiStart = 0, phiLen = Math.PI * 2) =>
  geo(`hc${LITE}${r}_${theta}_${phiStart}_${phiLen}`, () => new THREE.SphereGeometry(r, LITE ? 12 : 22, LITE ? 6 : 11, phiStart, phiLen, 0, theta));
const torus = (r, t, rs, ts, arc = Math.PI * 2) => geo(`to${r}_${t}_${rs}_${ts}_${arc}`, () => new THREE.TorusGeometry(r, t, rs, ts, arc));
const cone = (r, h, s) => geo(`co${r}_${h}_${s}`, () => new THREE.ConeGeometry(r, h, s));

const _up = new THREE.Vector3(0, 1, 0);
function alignM(px, py, pz, dir, sx = 1, sy = 1, sz = 1) {
  const q = new THREE.Quaternion().setFromUnitVectors(_up, dir.clone().normalize());
  return new THREE.Matrix4().compose(new THREE.Vector3(px, py, pz), q, new THREE.Vector3(sx, sy, sz));
}

// ---------------------------------------------------------------------------
// 部位の組み立て
// ---------------------------------------------------------------------------
const HEAD_C = 0.27; // 頭の中心（首ピボットからの高さ）

function addHair(b, hair, C) {
  const col = hair.color;
  const s = hair.style;
  const capM = (rx, r = 0.318) => M(0, C, 0, rx, 0, 0);
  switch (s) {
    case 'neat':
      b.add(cap(0.318, Math.PI * 0.52), col, capM(-0.32));
      b.add(sph(), col, M(0.05, C + 0.2, 0.19, 0, 0, -0.4, 0.17, 0.07, 0.12));
      b.add(sph(), col, M(-0.12, C + 0.16, 0.2, 0, 0, 0.3, 0.1, 0.06, 0.09));
      break;
    case 'side':
      b.add(cap(0.318, Math.PI * 0.5), col, capM(-0.36));
      b.add(sph(), col, M(-0.07, C + 0.2, 0.17, 0, 0, 0.45, 0.2, 0.08, 0.15));
      break;
    case 'short':
      b.add(cap(0.318, Math.PI * 0.49), col, capM(-0.3));
      b.add(sph(), col, M(0, C + 0.21, 0.17, 0, 0, 0, 0.18, 0.06, 0.1));
      break;
    case 'slick':
      b.add(cap(0.316, Math.PI * 0.47), col, capM(-0.46));
      b.add(sph(), col, M(0, C + 0.25, 0.12, -0.3, 0, 0, 0.19, 0.08, 0.14));
      break;
    case 'spiky': {
      b.add(cap(0.318, Math.PI * 0.5), col, capM(-0.3));
      const dirs = [[0, 1, 0.25], [0.45, 0.9, 0.25], [-0.45, 0.9, 0.25], [0.2, 0.8, 0.7], [-0.2, 0.8, 0.7], [0, 0.7, -0.6], [0.6, 0.6, -0.3], [-0.6, 0.6, -0.3]];
      for (const d of dirs) {
        const v = new THREE.Vector3(...d).normalize();
        b.add(cone(0.075, 0.17, 5), col, alignM(v.x * 0.29, C + v.y * 0.29, v.z * 0.29, v));
      }
      break;
    }
    case 'bun':
      b.add(cap(0.318, Math.PI * 0.52), col, capM(-0.26));
      b.add(sph(), col, M(0, C + 0.2, -0.22, 0, 0, 0, 0.12, 0.12, 0.12));
      b.add(torus(0.07, 0.018, 6, 16), '#c0302a', M(0, C + 0.14, -0.19, 0.9, 0, 0));
      break;
    case 'bob':
    case 'long': {
      const gap = 1.8;
      b.add(cap(0.328, Math.PI * 0.64, Math.PI / 2 + gap / 2, Math.PI * 2 - gap), col, M(0, C, 0));
      b.add(cap(0.323, Math.PI * 0.31), col, M(0, C, 0, -0.08, 0, 0));
      if (s === 'long') b.add(rbox(0.46, 0.36, 0.12, 0.05), col, M(0, C - 0.2, -0.18));
      break;
    }
    case 'pony':
      b.add(cap(0.318, Math.PI * 0.5), col, capM(-0.3));
      b.add(capsule(0.07, 0.16), col, M(0, C - 0.02, -0.34, 0.45, 0, 0));
      break;
    case 'bald':
      b.add(torus(0.283, 0.058, 8, 24, Math.PI * 1.2), col, M(0, C - 0.01, 0, -Math.PI / 2, -Math.PI * 0.1, 0, 1, 1, 0.9));
      break;
    default:
      break;
  }
}

function buildHead(look, lite) {
  const b = new GeoBatch();
  const C = HEAD_C;
  b.add(lite ? G.headLite : G.head, look.skin, M(0, C, 0));
  if (!lite) for (const sx of [1, -1]) b.add(sph(), look.skin, M(sx * 0.29, C - 0.02, 0, 0, 0, 0, 0.045, 0.065, 0.05));
  if (look.cheeks !== false && !lite) {
    const blush = look.blush ? '#f07f78' : '#f4a79c';
    for (const sx of [1, -1]) b.add(sph(), blush, M(sx * 0.165, C - 0.06, 0.244, 0, sx * 0.55, 0, 0.05, 0.028, 0.02));
  }
  addHair(b, look.hair, C);
  if (look.mustache) {
    b.add(sph(), look.mustache, M(0.045, C - 0.085, 0.282, 0, 0.2, 0.25, 0.06, 0.025, 0.03));
    b.add(sph(), look.mustache, M(-0.045, C - 0.085, 0.282, 0, -0.2, -0.25, 0.06, 0.025, 0.03));
  }
  if (look.glasses) {
    const g = look.glasses;
    for (const sx of [1, -1]) {
      if (g.square) b.add(torus(0.07, 0.012, 4, 4), g.color, M(sx * 0.105, C + 0.005, 0.3, 0, 0, Math.PI / 4, 1.15, 0.8, 1));
      else b.add(torus(0.062, 0.011, 6, 18), g.color, M(sx * 0.105, C + 0.005, 0.3));
    }
    b.add(unitBox, g.color, M(0, C + 0.015, 0.31, 0, 0, 0, 0.07, 0.012, 0.012));
  }
  if (look.headband) {
    b.add(torus(0.305, 0.028, 6, 28), look.headband, M(0, C + 0.1, -0.02, Math.PI / 2 - 0.25, 0, 0.12));
    b.add(unitBox, look.headband, M(0.26, C + 0.2, -0.2, 0.3, 0.4, 0.9, 0.04, 0.16, 0.02));
    b.add(unitBox, look.headband, M(0.3, C + 0.16, -0.18, 0.1, 0.3, 1.3, 0.04, 0.14, 0.02));
  }
  if (look.hat) {
    // 制帽・作業帽
    const h = look.hat;
    b.add(cyl(0.3, 0.315, 0.13, 20), h.color, M(0, C + 0.21, -0.01, -0.12, 0, 0));
    b.add(cyl(0.325, 0.3, 0.05, 20), h.color, M(0, C + 0.29, -0.02, -0.12, 0, 0));
    b.add(unitBox, h.visor || '#15151c', M(0, C + 0.15, 0.3, 0.25, 0, 0, 0.34, 0.025, 0.17));
    if (h.band) b.add(cyl(0.306, 0.316, 0.035, 20), h.band, M(0, C + 0.17, -0.005, -0.12, 0, 0));
  }
  if (lite) {
    for (const sx of [1, -1]) b.add(sph(), '#15151c', M(sx * 0.1, C + 0.005, 0.272, 0, 0, 0, 0.032, 0.046, 0.028));
  }
  return b.build();
}

function buildTorso(look) {
  const b = new GeoBatch();
  const w = 0.44 * (look.width || 1);
  const t = look.top;
  if (t.type === 'vest') {
    b.add(rbox(w, 0.44, 0.29, 0.1), look.shirt, M(0, 0.57, 0));
    b.add(rbox(w + 0.02, 0.3, 0.305, 0.08), t.color, M(0, 0.51, 0));
    b.add(cyl(0.11, 0.001, 0.14, 3), t.color, M(0, 0.69, 0.14, 0, 0, Math.PI, 1, 1, 0.2));
  } else {
    b.add(rbox(w, 0.44, 0.3, 0.1), t.color, M(0, 0.57, 0));
  }
  if (t.type === 'suit' || t.type === 'cardigan') {
    b.add(cyl(0.1, 0.001, 0.22, 3), look.shirt, M(0, 0.68, 0.142, 0, 0, Math.PI, 1, 1, 0.2));
    for (const y of t.type === 'cardigan' ? [0.54, 0.47, 0.4] : [0.5]) b.add(sph(), t.type === 'cardigan' ? '#e9dcc4' : '#1b1b1f', M(0, y, 0.152, 0, 0, 0, 0.018, 0.018, 0.01));
  }
  if (t.type === 'yukata') {
    // 浴衣：衿の合わせと帯
    for (const sx of [1, -1]) b.add(unitBox, look.shirt, M(sx * 0.045, 0.64, 0.152, 0, 0, -sx * 0.5, 0.035, 0.26, 0.012));
    b.add(rbox(w + 0.02, 0.08, 0.31, 0.03), '#2b3a67', M(0, 0.45, 0));
  }
  if (t.type === 'shirt') {
    b.add(unitBox, '#ffffff', M(0.1 * (look.width || 1), 0.64, 0.151, 0, 0, 0, 0.08, 0.07, 0.01));
    b.add(cyl(0.07, 0.001, 0.08, 3), look.shirt, M(0, 0.76, 0.14, 0, 0, Math.PI, 1, 1, 0.25));
  }
  if (look.tie) {
    b.add(unitBox, look.tie, M(0, 0.63, 0.158, 0, 0, 0, 0.055, 0.2, 0.018));
    b.add(cyl(0.028, 0.001, 0.05, 4), look.tie, M(0, 0.52, 0.158, 0, Math.PI / 4, Math.PI, 1, 1, 0.3));
    b.add(unitBox, look.tie, M(0, 0.745, 0.16, 0, 0, 0, 0.065, 0.045, 0.024));
  }
  if (look.ribbon) {
    for (const sx of [1, -1]) b.add(sph(), look.ribbon, M(sx * 0.04, 0.76, 0.155, 0, 0, sx * 0.4, 0.045, 0.028, 0.02));
    b.add(sph(), look.ribbon, M(0, 0.76, 0.16, 0, 0, 0, 0.02, 0.022, 0.02));
  }
  if (look.suspenders) {
    const sw = 0.1 * (look.width || 1);
    for (const sx of [1, -1]) {
      b.add(unitBox, look.suspenders, M(sx * sw, 0.57, 0.152, 0, 0, 0, 0.03, 0.44, 0.01));
      b.add(unitBox, look.suspenders, M(sx * sw, 0.57, -0.152, 0, 0, 0, 0.03, 0.44, 0.01));
    }
  }
  if (look.badge === 'wakaba') {
    b.add(unitBox, '#f4d23c', M(0.1, 0.66, 0.154, 0, 0, 0.32, 0.045, 0.1, 0.012));
    b.add(unitBox, '#2f9a58', M(0.135, 0.66, 0.154, 0, 0, -0.32, 0.045, 0.1, 0.012));
  }
  const bottom = look.bottom;
  if (bottom.type === 'skirt') {
    b.add(cyl(0.2 * (look.width || 1), 0.27 * (look.width || 1), 0.22, 18), bottom.color, M(0, 0.3, 0));
  } else {
    b.add(rbox(w * 0.94, 0.14, 0.28, 0.06), bottom.color, M(0, 0.37, 0));
    b.add(unitBox, '#2a2a2e', M(0, 0.425, 0, 0, 0, 0, w * 0.95, 0.03, 0.285));
  }
  return b.build();
}

function addProp(b, name, side) {
  const hx = 0;
  const hy = -0.34;
  switch (name) {
    case 'mug':
      b.add(cyl(0.056, 0.05, 0.11, 14), '#fdfdfb', M(hx, hy - 0.03, 0.07));
      b.add(cyl(0.048, 0.048, 0.005, 12), '#4a2c1a', M(hx, hy + 0.024, 0.07));
      b.add(torus(0.03, 0.01, 6, 10), '#fdfdfb', M(hx + side * 0.06, hy - 0.03, 0.07, 0, Math.PI / 2, 0));
      break;
    case 'redpen':
      b.add(cyl(0.013, 0.013, 0.17, 8), '#d8342a', M(hx, hy - 0.02, 0.07, 1.25, 0, 0));
      break;
    case 'clipboard':
    case 'list': {
      const board = name === 'list' ? '#e8b82e' : '#a8713d';
      b.add(unitBox, board, M(hx, hy - 0.02, 0.11, -0.25, 0, 0, 0.21, 0.28, 0.015));
      b.add(unitBox, '#fbfbf7', M(hx, hy - 0.035, 0.12, -0.25, 0, 0, 0.18, 0.21, 0.006));
      b.add(unitBox, '#c9ccd1', M(hx, hy + 0.1, 0.085, -0.25, 0, 0, 0.08, 0.03, 0.025));
      break;
    }
    case 'papers':
      for (let i = 0; i < 4; i++) b.add(unitBox, i % 2 ? '#ffffff' : '#eef1f5', M(hx + (i % 2) * 0.01, hy + 0.02 + i * 0.035, 0.12, 0, (i - 1.5) * 0.08, 0, 0.26, 0.032, 0.3));
      break;
    case 'laptop':
      b.add(unitBox, '#c7cbd1', M(hx + side * -0.02, hy + 0.12, 0.02, 0, 0, 0, 0.03, 0.22, 0.3));
      break;
    case 'notebook':
      b.add(unitBox, '#3aa56c', M(hx, hy - 0.03, 0.08, -0.5, 0, 0, 0.13, 0.17, 0.02));
      b.add(unitBox, '#ffffff', M(hx, hy - 0.03, 0.093, -0.5, 0, 0, 0.11, 0.15, 0.004));
      break;
    case 'folder':
      b.add(unitBox, '#2f6db5', M(hx + side * -0.03, hy + 0.06, 0.03, 0, 0, 0, 0.026, 0.3, 0.24));
      b.add(unitBox, '#ffffff', M(hx + side * -0.045, hy + 0.12, 0.03, 0, 0, 0, 0.004, 0.06, 0.14));
      break;
    case 'phone':
      b.add(rbox(0.065, 0.12, 0.016, 0.008), '#1b1d22', M(hx, hy - 0.02, 0.07, -0.6, 0, 0));
      b.add(unitBox, '#7fc8ff', M(hx, hy - 0.016, 0.081, -0.6, 0, 0, 0.05, 0.095, 0.002));
      break;
    case 'wallet':
      b.add(rbox(0.1, 0.07, 0.03, 0.01), '#8a5a3a', M(hx, hy - 0.04, 0.05));
      break;
    case 'kasa':
      // 閉じた長傘（ゴルフクラブのように持つ）
      b.add(torus(0.035, 0.011, 6, 10, Math.PI), '#6b3b1f', M(hx, hy + 0.02, 0.03, 0, Math.PI / 2, 0));
      b.add(cyl(0.012, 0.012, 0.8, 6), '#8a919c', M(hx, hy - 0.4, 0.03));
      b.add(cyl(0.045, 0.012, 0.5, 8), '#1f4f7a', M(hx, hy - 0.5, 0.03));
      break;
    case 'mop':
      b.add(cyl(0.014, 0.014, 1.1, 6), '#c9ccd1', M(hx, hy - 0.2, 0.05));
      b.add(unitBox, '#5dade2', M(hx, hy - 0.73, 0.05, 0, 0, 0, 0.1, 0.05, 0.08));
      b.add(unitBox, '#eceae3', M(hx, hy - 0.78, 0.05, 0, 0, 0, 0.36, 0.06, 0.14));
      break;
    case 'can':
      // 缶ビール
      b.add(cyl(0.04, 0.04, 0.12, 12), '#d9dde2', M(hx, hy - 0.03, 0.06));
      b.add(cyl(0.041, 0.041, 0.04, 12), '#e0b030', M(hx, hy - 0.03, 0.06));
      break;
    case 'bag':
      b.add(rbox(0.09, 0.24, 0.34, 0.03), '#3b2a22', M(hx, hy - 0.16, 0));
      b.add(torus(0.05, 0.012, 6, 12, Math.PI), '#2a1d17', M(hx, hy - 0.03, 0, 0, Math.PI / 2, 0));
      break;
    default:
      break;
  }
}

function buildArm(look, side, prop) {
  const b = new GeoBatch();
  const t = look.top.type;
  const sleeve = t === 'shirt' || t === 'vest' ? look.shirt : look.top.color;
  b.add(capsule(0.064, 0.19), sleeve, M(0, -0.16, 0));
  if (t === 'suit' || t === 'cardigan') b.add(cyl(0.067, 0.067, 0.035, 12), look.shirt, M(0, -0.285, 0));
  b.add(LITE ? sphereLo : G.hand, look.skin, LITE ? M(0, -0.34, 0, 0, 0, 0, 0.07, 0.07, 0.07) : M(0, -0.34, 0));
  if (prop) addProp(b, prop, side);
  return b.build();
}

function buildLeg(look) {
  const b = new GeoBatch();
  const skirt = look.bottom.type === 'skirt';
  const r = skirt ? 0.056 : 0.075;
  b.add(capsule(r, 0.17), skirt ? look.legs || look.skin : look.bottom.color, M(0, -0.16, 0));
  b.add(G.shoe, look.shoes, M(0, -0.32, 0.03));
  return b.build();
}

// ---------------------------------------------------------------------------
// Character
// ---------------------------------------------------------------------------
export class Character {
  constructor(look, { outline = true, lite = false, shadow = true } = {}) {
    this.look = look;
    this.lite = lite;
    this.root = new THREE.Group();
    this.rig = new THREE.Group();
    this.body = new THREE.Group();
    this.root.add(this.rig);
    this.rig.add(this.body);
    this.body.scale.setScalar(look.scale || 1);
    this.meshes = [];
    LITE = lite;

    const add = (geometry, parent, { cast = shadow, out = outline } = {}) => {
      const m = new THREE.Mesh(geometry, CHAR_MAT);
      m.castShadow = cast;
      m.receiveShadow = !lite;
      parent.add(m);
      this.meshes.push(m);
      if (out) {
        const o = new THREE.Mesh(geometry, OUTLINE_MAT);
        o.raycast = () => {};
        m.add(o);
      }
      return m;
    };

    const w = look.width || 1;
    this.legL = new THREE.Group();
    this.legR = new THREE.Group();
    this.legL.position.set(0.1 * w, 0.36, 0);
    this.legR.position.set(-0.1 * w, 0.36, 0);
    this.body.add(this.legL, this.legR);
    if (!lite) {
      const legGeo = buildLeg(look);
      add(legGeo, this.legL);
      add(legGeo, this.legR);
    }

    this.torso = add(buildTorso(look), this.body);

    this.armL = new THREE.Group();
    this.armR = new THREE.Group();
    this.armL.position.set(0.265 * w, 0.74, 0);
    this.armR.position.set(-0.265 * w, 0.74, 0);
    this.body.add(this.armL, this.armR);
    const prop = look.prop || {};
    add(buildArm(look, 1, prop.left), this.armL);
    add(buildArm(look, -1, prop.right), this.armR);
    this.propL = prop.left;
    this.propR = prop.right;
    if (prop.right === 'penlight') {
      const pl = new THREE.Mesh(cyl(0.022, 0.018, 0.26, 10), PENLIGHT_MAT);
      pl.position.set(0, -0.36, 0.1);
      pl.rotation.x = 1.1;
      this.armR.add(pl);
    }

    this.head = new THREE.Group();
    this.head.position.set(0, 0.79, 0);
    this.body.add(this.head);
    add(buildHead(look, lite), this.head);
    LITE = false;

    if (!lite) {
      const C = HEAD_C;
      this.eyes = [1, -1].map((sx) => {
        const e = new THREE.Mesh(unitSphere, EYE_MAT);
        e.position.set(sx * 0.1, C + 0.005, 0.272);
        e.scale.set(0.034, 0.05, 0.03);
        this.head.add(e);
        return e;
      });
      this.brows = [1, -1].map((sx) => {
        const br = new THREE.Mesh(unitBox, EYE_MAT);
        br.position.set(sx * 0.1, C + 0.088, 0.268);
        br.scale.set(0.085, 0.018, 0.02);
        br.userData.sx = sx;
        this.head.add(br);
        return br;
      });
      this.mouth = new THREE.Mesh(unitSphere, MOUTH_MAT);
      this.mouth.position.set(0, C - 0.098, 0.282);
      this.head.add(this.mouth);
      this.sweat = new THREE.Mesh(unitSphere, SWEAT_MAT);
      this.sweat.position.set(-0.26, C + 0.16, 0.12);
      this.sweat.scale.set(0.035, 0.05, 0.035);
      this.sweat.visible = false;
      this.head.add(this.sweat);
      this.stars = new THREE.Group();
      this.stars.position.set(0, C + 0.4, 0);
      for (let i = 0; i < 3; i++) {
        const s = new THREE.Mesh(G.star, STAR_MAT);
        this.stars.add(s);
      }
      this.stars.visible = false;
      this.head.add(this.stars);
    }

    this.speed = 0;
    this.yaw = 0;
    this.targetYaw = 0;
    this.turnRate = 14;
    this.phase = Math.random() * 6;
    this.amp = 0;
    this.t = Math.random() * 10;
    this.pose = 'idle';
    this.mood = 'normal';
    this.action = null;
    this.actionT = 0;
    this.blinkT = 1 + Math.random() * 3;
    this.headYaw = 0;
    this.spin = 0;
    this.squash = 0;
    this.lift = 0;
    this.setMood(look.brows === 'angry' ? 'angry' : 'normal');
  }

  setYaw(y) {
    this.yaw = this.targetYaw = y;
    this.root.rotation.y = y;
  }

  faceDir(dx, dz) {
    if (Math.abs(dx) + Math.abs(dz) > 1e-4) this.targetYaw = Math.atan2(dx, dz);
  }

  play(action) {
    this.action = action;
    this.actionT = 0;
  }

  setMood(mood) {
    this.mood = mood;
    if (this.lite || !this.brows) return;
    const base = this.look.brows;
    let tilt = base === 'angry' ? 0.38 : base === 'worried' ? -0.3 : 0;
    let lift = base === 'happy' ? 0.012 : 0;
    let mouth = [0.042, 0.015, 0.02];
    let eyeY = 0.05;
    switch (mood) {
      case 'angry':
        tilt = 0.45;
        mouth = [0.05, 0.022, 0.02];
        break;
      case 'shout':
        mouth = [0.05, 0.05, 0.03];
        tilt = base === 'angry' ? 0.5 : tilt;
        break;
      case 'happy':
        mouth = [0.06, 0.03, 0.025];
        eyeY = 0.016;
        lift = 0.012;
        tilt = 0;
        break;
      case 'worried':
        tilt = -0.35;
        mouth = [0.03, 0.02, 0.02];
        break;
      case 'surprised':
        mouth = [0.035, 0.04, 0.03];
        eyeY = 0.06;
        lift = 0.02;
        break;
      case 'dizzy':
        eyeY = 0.02;
        mouth = [0.04, 0.03, 0.02];
        tilt = -0.2;
        break;
      default:
        break;
    }
    for (const br of this.brows) {
      br.rotation.z = br.userData.sx * tilt;
      br.position.y = HEAD_C + 0.088 + lift;
    }
    this.mouth.scale.set(...mouth);
    this.eyeY = eyeY;
    for (const e of this.eyes) e.scale.y = eyeY;
  }

  update(dt) {
    this.t += dt;
    const t = this.t;
    const moving = this.speed > 0.15;
    const ampT = moving ? clamp(this.speed / 4.2, 0.3, 1.2) : 0;
    this.amp = damp(this.amp, ampT, 12, dt);
    if (moving) this.phase += dt * (5.2 + this.speed * 2.0);
    const a = this.amp;
    const sw = Math.sin(this.phase);

    let legL = sw * 0.8 * a;
    let legR = -legL;
    let armL = -legL * 0.8;
    let armR = -legR * 0.8;
    let armLz = 0.08;
    let armRz = -0.08;
    let bob = Math.abs(Math.cos(this.phase)) * 0.05 * a;
    let lean = 0.1 * a;
    let headX = 0;
    let headZ = 0;
    let rigRotX = 0;
    let rigY = 0;
    let swingY = 0;
    const breathe = 1 + Math.sin(t * 2.4) * 0.012 * (1 - a);

    // 持ち物による腕の基本姿勢
    const carryL = { papers: -0.9, notebook: -0.75, clipboard: -0.7, list: -0.7, folder: 0.05, laptop: 0.05, bag: 0 }[this.propL];
    const carryR = { mug: -0.55, redpen: -0.45, wallet: -0.3, penlight: -0.5, phone: -0.95, kasa: -0.15, mop: -0.45, can: -0.55 }[this.propR];
    if (carryL !== undefined) {
      armL = carryL + armL * 0.25;
      if (this.propL === 'folder' || this.propL === 'laptop') armLz = 0.02;
    }
    if (carryR !== undefined) armR = carryR + armR * 0.35;

    switch (this.pose) {
      case 'reach':
        armL = -1.45 + Math.sin(t * 17) * 0.15;
        armR = -1.45 - Math.sin(t * 17) * 0.15;
        armLz = 0.2;
        armRz = -0.2;
        break;
      case 'sit':
      case 'type':
        legL = legR = -1.45;
        armL = -1.05 + (this.pose === 'type' ? Math.max(0, Math.sin(t * 14)) * 0.12 : 0);
        armR = -1.05 + (this.pose === 'type' ? Math.max(0, Math.sin(t * 14 + 1.7)) * 0.12 : 0);
        armLz = 0.25;
        armRz = -0.25;
        bob = 0;
        lean = 0.08;
        headX = 0.12 + Math.sin(t * 0.7) * 0.05;
        break;
      case 'talk':
        armR = -0.95 + Math.sin(t * 7) * 0.4;
        armL = (carryL ?? -0.2) + Math.sin(t * 5) * 0.1;
        headX = Math.sin(t * 9) * 0.06;
        break;
      case 'listen':
        armL = armR = 0.15;
        armLz = 0.05;
        armRz = -0.05;
        headX = 0.15 + Math.sin(t * 3) * 0.04;
        break;
      case 'dance':
        armL = -2.7 + Math.sin(t * 8) * 0.35;
        armR = -2.7 - Math.sin(t * 8) * 0.35;
        armLz = 0.35;
        armRz = -0.35;
        bob = Math.abs(Math.sin(t * 8)) * 0.07;
        headZ = Math.sin(t * 8) * 0.12;
        break;
      case 'block':
        armL = -0.3;
        armR = -0.3;
        armLz = 1.25 + Math.sin(t * 10) * 0.12;
        armRz = -1.25 - Math.sin(t * 10) * 0.12;
        break;
      case 'cheer':
        armL = -2.9 + Math.sin(t * 10) * 0.2;
        armR = -2.9 - Math.sin(t * 10) * 0.2;
        armLz = 0.3;
        armRz = -0.3;
        bob = Math.abs(Math.sin(t * 10)) * 0.12;
        break;
      case 'shock':
        armL = armR = -2.5;
        armLz = 0.6;
        armRz = -0.6;
        break;
      case 'down':
        rigRotX = 1.35;
        rigY = -0.05;
        armL = armR = -2.8;
        legL = 0.2;
        legR = -0.1;
        break;
      case 'phone':
        armR = -2.75;
        armRz = 0.55;
        headZ = -0.12;
        break;
      case 'bow':
        rigRotX = 0.5;
        armL = armR = 0.1;
        break;
      case 'look':
        headZ = Math.sin(t * 1.3) * 0.08;
        break;
      case 'address':
        // ゴルフの構え（両手で傘を握る）
        armL = armR = -0.45;
        armLz = 0.42;
        armRz = -0.42;
        lean = 0.32;
        headX = 0.35;
        legL = 0.12;
        legR = -0.12;
        break;
      case 'scroll':
        // スマホに目を落としたまま
        armR = -1.15;
        armRz = -0.1;
        headX = 0.38;
        break;
      case 'mop':
        armR = -0.5 + Math.sin(t * 6) * 0.35;
        armL = -0.7 + Math.sin(t * 6) * 0.35;
        armLz = 0.45;
        armRz = -0.15;
        lean = 0.2;
        headX = 0.25;
        break;
      default:
        break;
    }

    // 単発アクション
    if (this.action) {
      this.actionT += dt;
      const k = this.actionT;
      if (this.action === 'throw') {
        if (k < 0.16) armR = lerpN(0, 1.3, k / 0.16);
        else if (k < 0.32) armR = lerpN(1.3, -2.3, (k - 0.16) / 0.16);
        else if (k < 0.6) armR = lerpN(-2.3, armR, (k - 0.32) / 0.28);
        else this.action = null;
      } else if (this.action === 'trip') {
        const p = Math.min(1, k / 0.22);
        rigRotX = 1.35 * p;
        rigY = -0.05 * p;
        armL = armR = -2.8 * p;
        if (k > 0.3) {
          this.action = null;
          this.pose = 'down';
        }
      } else if (this.action === 'jump') {
        rigY = Math.sin(Math.min(1, k / 0.35) * Math.PI) * 0.35;
        if (k > 0.35) this.action = null;
      } else if (this.action === 'swing') {
        // 振りかぶって、振り抜く
        if (k < 0.12) armL = armR = lerpN(-0.45, 1.6, k / 0.12);
        else if (k < 0.26) armL = armR = lerpN(1.6, -2.6, (k - 0.12) / 0.14);
        else if (k < 0.7) armL = armR = -2.6;
        else this.action = null;
        armLz = 0.42;
        armRz = -0.42;
        swingY = k < 0.12 ? lerpN(0, 0.9, k / 0.12) : k < 0.26 ? lerpN(0.9, -1.2, (k - 0.12) / 0.14) : k < 0.7 ? -1.2 : 0;
      } else if (this.action === 'hop') {
        rigY = Math.sin(Math.min(1, k / 0.22) * Math.PI) * 0.15;
        if (k > 0.22) this.action = null;
      } else if (this.action === 'stagger') {
        rigRotX = -Math.sin(Math.min(1, k / 0.35) * Math.PI) * 0.35;
        if (k > 0.35) this.action = null;
      }
    }

    this.legL.rotation.x = legL;
    this.legR.rotation.x = legR;
    this.armL.rotation.x = damp(this.armL.rotation.x, armL, 18, dt);
    this.armR.rotation.x = this.action === 'throw' || this.action === 'swing' ? armR : damp(this.armR.rotation.x, armR, 18, dt);
    if (this.action === 'swing') this.armL.rotation.x = armL;
    this.armL.rotation.z = damp(this.armL.rotation.z, armLz, 14, dt);
    this.armR.rotation.z = damp(this.armR.rotation.z, armRz, 14, dt);
    this.torso.scale.y = breathe;

    this.head.rotation.x = damp(this.head.rotation.x, headX, 10, dt);
    this.head.rotation.z = damp(this.head.rotation.z, headZ, 10, dt);
    this.head.rotation.y = damp(this.head.rotation.y, this.headYaw, 8, dt);

    this.rig.position.y = bob + rigY + this.lift;
    this.rig.rotation.x = damp(this.rig.rotation.x, rigRotX || lean, 14, dt);
    this.rig.rotation.y = this.spin + swingY;
    const sq = this.squash;
    this.rig.scale.set(1 + sq, 1 - sq, 1 + sq);

    this.yaw = dampAngle(this.yaw, this.targetYaw, this.turnRate, dt);
    this.root.rotation.y = this.yaw;

    if (!this.lite) {
      this.blinkT -= dt;
      const blinking = this.blinkT < 0.09 && this.mood !== 'happy';
      for (const e of this.eyes) e.scale.y = blinking ? 0.008 : this.eyeY;
      if (this.blinkT < 0) this.blinkT = 2 + Math.random() * 3.5;
      if (this.stars.visible) {
        this.stars.rotation.y += dt * 6;
        this.stars.children.forEach((s, i) => {
          const ang = (i / 3) * Math.PI * 2;
          s.position.set(Math.cos(ang) * 0.2, Math.sin(t * 8 + i) * 0.03, Math.sin(ang) * 0.2);
          s.rotation.y = t * 5;
        });
      }
      if (this.sweat.visible) this.sweat.position.y = HEAD_C + 0.16 - ((t * 0.6) % 0.3);
    }
  }
}

const lerpN = (a, b, t) => a + (b - a) * clamp(t, 0, 1);

/** 立ち絵（顔アップ）を dataURL で書き出す */
export function renderPortraits(entries, size = 256) {
  const out = {};
  let renderer;
  try {
    renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
  } catch (e) {
    return out;
  }
  renderer.setSize(size, size, false);
  renderer.setPixelRatio(1);
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.1;
  const scene = new THREE.Scene();
  scene.add(new THREE.HemisphereLight('#ffffff', '#b8a794', 2.2));
  const key = new THREE.DirectionalLight('#fff4e6', 2.4);
  key.position.set(1.2, 2, 2.5);
  scene.add(key);
  const rim = new THREE.DirectionalLight('#9cc7ff', 1.4);
  rim.position.set(-2, 1.5, -1.5);
  scene.add(rim);
  const cam = new THREE.PerspectiveCamera(26, 1, 0.1, 20);
  for (const [id, look] of Object.entries(entries)) {
    const c = new Character(look, { outline: true, shadow: false });
    c.setMood(look.brows === 'angry' ? 'angry' : look.brows === 'happy' ? 'happy' : 'normal');
    c.update(0.016);
    c.root.rotation.y = -0.35;
    scene.add(c.root);
    const s = look.scale || 1;
    cam.position.set(0.55, 1.08 * s, 2.25);
    cam.lookAt(0, 0.92 * s, 0);
    renderer.render(scene, cam);
    out[id] = renderer.domElement.toDataURL('image/png');
    scene.remove(c.root);
  }
  renderer.dispose();
  renderer.forceContextLoss?.();
  return out;
}
