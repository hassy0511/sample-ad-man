import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

export const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
export const lerp = (a, b, t) => a + (b - a) * t;
export const damp = (a, b, lambda, dt) => lerp(a, b, 1 - Math.exp(-lambda * dt));
export const smooth = (t) => t * t * (3 - 2 * t);

export function wrapAngle(a) {
  a = (a + Math.PI) % (Math.PI * 2);
  if (a < 0) a += Math.PI * 2;
  return a - Math.PI;
}
export const dampAngle = (a, b, lambda, dt) => a + wrapAngle(b - a) * (1 - Math.exp(-lambda * dt));

export function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
export const pick = (rng, arr) => arr[Math.floor(rng() * arr.length) % arr.length];

export function fmtClock(min) {
  const m = Math.floor(min);
  return `${Math.floor(m / 60)}:${String(m % 60).padStart(2, '0')}`;
}

const _q = new THREE.Quaternion();
const _e = new THREE.Euler();
const _p = new THREE.Vector3();
const _s = new THREE.Vector3();
/** 位置・回転・拡大から行列を作る（毎回新しい Matrix4 を返す） */
export function M(x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0, sx = 1, sy = 1, sz = 1) {
  _e.set(rx, ry, rz, 'YXZ');
  _q.setFromEuler(_e);
  _p.set(x, y, z);
  _s.set(sx, sy, sz);
  return new THREE.Matrix4().compose(_p, _q, _s);
}
export const mulM = (a, b) => new THREE.Matrix4().multiplyMatrices(a, b);

/**
 * 頂点カラー付きでジオメトリをまとめる。静的な家具やキャラクターの部位を
 * 1メッシュに統合してドローコールを減らすために使う。
 */
export class GeoBatch {
  constructor({ uv = false } = {}) {
    this.parts = [];
    this.uv = uv;
  }
  add(geo, color, matrix) {
    const g = geo.index ? geo.toNonIndexed() : geo.clone();
    if (matrix) g.applyMatrix4(matrix);
    for (const name of Object.keys(g.attributes)) {
      if (name === 'position' || name === 'normal') continue;
      if (name === 'uv' && this.uv) continue;
      g.deleteAttribute(name);
    }
    const n = g.attributes.position.count;
    const c = new THREE.Color(color);
    const arr = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      arr[i * 3] = c.r;
      arr[i * 3 + 1] = c.g;
      arr[i * 3 + 2] = c.b;
    }
    g.setAttribute('color', new THREE.BufferAttribute(arr, 3));
    this.parts.push(g);
    return this;
  }
  get empty() {
    return this.parts.length === 0;
  }
  build() {
    if (!this.parts.length) return null;
    const merged = mergeGeometries(this.parts, false);
    for (const p of this.parts) p.dispose();
    this.parts = [];
    merged.computeBoundingSphere();
    return merged;
  }
}

/** Canvas に日本語テキストを描いてテクスチャにする */
export function textTexture(text, {
  w = 512, h = 128, font = '800 64px "M PLUS Rounded 1c", sans-serif', color = '#1b2340',
  bg = '#ffffff', radius = 18, border = null, borderW = 8, padX = 0,
} = {}) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const g = c.getContext('2d');
  if (bg) {
    g.fillStyle = bg;
    roundRect(g, 0, 0, w, h, radius);
    g.fill();
  }
  if (border) {
    g.strokeStyle = border;
    g.lineWidth = borderW;
    roundRect(g, borderW / 2, borderW / 2, w - borderW, h - borderW, radius);
    g.stroke();
  }
  g.fillStyle = color;
  g.font = font;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText(text, w / 2 + padX, h / 2 + 4, w - 24);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

export function roundRect(g, x, y, w, h, r) {
  g.beginPath();
  g.moveTo(x + r, y);
  g.arcTo(x + w, y, x + w, y + h, r);
  g.arcTo(x + w, y + h, x, y + h, r);
  g.arcTo(x, y + h, x, y, r);
  g.arcTo(x, y, x + w, y, r);
  g.closePath();
}

export function disposeTree(obj, keep = new Set()) {
  obj.traverse((o) => {
    if (o.geometry && !keep.has(o.geometry)) o.geometry.dispose();
    const mats = Array.isArray(o.material) ? o.material : o.material ? [o.material] : [];
    for (const m of mats) {
      if (keep.has(m)) continue;
      for (const k of ['map', 'emissiveMap', 'alphaMap']) if (m[k] && !keep.has(m[k])) m[k].dispose();
      m.dispose();
    }
  });
}
