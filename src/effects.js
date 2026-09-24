import * as THREE from 'three';
import { clamp } from './util.js';

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _e = new THREE.Euler();
const _p = new THREE.Vector3();
const _s = new THREE.Vector3();
const _c = new THREE.Color();

/** InstancedMesh ベースの簡易パーティクル */
class Pool {
  constructor(parent, geometry, material, max = 200) {
    this.mesh = new THREE.InstancedMesh(geometry, material, max);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.frustumCulled = false;
    this.mesh.count = 0;
    this.mesh.setColorAt(0, _c.set('#ffffff'));
    this.max = max;
    this.list = [];
    parent.add(this.mesh);
  }
  spawn(o) {
    if (this.list.length >= this.max) this.list.shift();
    this.list.push({
      x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, rx: 0, ry: 0, rz: 0, sx: 0, sy: 0, sz: 0,
      life: 1, age: 0, size: 0.1, gravity: 0, drag: 0, grow: 0, color: '#ffffff', flutter: 0,
      ...o,
    });
  }
  update(dt) {
    const L = this.list;
    let n = 0;
    for (let i = 0; i < L.length; i++) {
      const p = L[i];
      p.age += dt;
      if (p.age >= p.life) continue;
      p.vy -= p.gravity * dt;
      const dr = Math.exp(-p.drag * dt);
      p.vx *= dr;
      p.vz *= dr;
      if (p.flutter) {
        p.vx += Math.sin(p.age * 7 + p.rz) * p.flutter * dt;
        p.vz += Math.cos(p.age * 6 + p.rx) * p.flutter * dt;
        p.vy = Math.max(p.vy, -1.2);
      }
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.z += p.vz * dt;
      if (p.y < 0.02) {
        p.y = 0.02;
        p.vy = 0;
        p.vx *= 0.8;
        p.vz *= 0.8;
      }
      p.rx += p.sx * dt;
      p.ry += p.sy * dt;
      p.rz += p.sz * dt;
      const k = p.age / p.life;
      const sc = p.size * (1 + p.grow * k) * (k > 0.7 ? 1 - (k - 0.7) / 0.3 : 1);
      _e.set(p.rx, p.ry, p.rz);
      _q.setFromEuler(_e);
      _p.set(p.x, p.y, p.z);
      _s.setScalar(Math.max(sc, 0.0001));
      _m.compose(_p, _q, _s);
      this.mesh.setMatrixAt(n, _m);
      this.mesh.setColorAt(n, _c.set(p.color));
      L[n++] = p;
    }
    L.length = n;
    this.mesh.count = n;
    this.mesh.instanceMatrix.needsUpdate = true;
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
  }
}

export class FX {
  constructor(scene) {
    this.scene = scene;
    this.group = new THREE.Group();
    scene.add(this.group);
    const lit = (color, extra = {}) => new THREE.MeshStandardMaterial({ color, roughness: 0.9, ...extra });
    this.puff = new Pool(this.group, new THREE.IcosahedronGeometry(1, 0), lit('#ffffff', { flatShading: true }), 160);
    this.paper = new Pool(this.group, new THREE.PlaneGeometry(1, 1.35), lit('#ffffff', { side: THREE.DoubleSide, roughness: 0.7 }), 160);
    this.confetti = new Pool(this.group, new THREE.PlaneGeometry(1, 1.5), lit('#ffffff', { side: THREE.DoubleSide }), 240);
    this.spark = new Pool(this.group, new THREE.OctahedronGeometry(1, 0), new THREE.MeshBasicMaterial({ color: new THREE.Color(2.4, 2.1, 1.0) }), 120);
    this.rings = [];
    this.markers = [];
    this.projectiles = [];
    this.ringGeo = new THREE.RingGeometry(0.92, 1, 64);
    this.markerGeo = new THREE.RingGeometry(0.48, 0.6, 40, 1);
    this.markerFill = new THREE.CircleGeometry(0.48, 32);
    this.paperGeo = new THREE.BoxGeometry(0.3, 0.025, 0.38);
    this.paperMat = lit('#fbfbf8', { roughness: 0.6 });
  }

  dust(x, z, n = 6, color = '#f3efe8', spread = 1) {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const s = (0.6 + Math.random() * 1.4) * spread;
      this.puff.spawn({
        x: x + Math.cos(a) * 0.15, y: 0.08, z: z + Math.sin(a) * 0.15,
        vx: Math.cos(a) * s, vy: 0.4 + Math.random() * 0.8, vz: Math.sin(a) * s,
        drag: 5, life: 0.45 + Math.random() * 0.3, size: 0.07 + Math.random() * 0.06, grow: 1.2, color,
        sx: 3, sy: 2,
      });
    }
  }

  papers(x, y, z, n = 8, power = 1) {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const s = (0.8 + Math.random() * 2.2) * power;
      this.paper.spawn({
        x, y, z, vx: Math.cos(a) * s, vy: 1.5 + Math.random() * 2.5 * power, vz: Math.sin(a) * s,
        gravity: 6, drag: 1.2, flutter: 3, life: 1.1 + Math.random() * 0.6, size: 0.17,
        rx: Math.random() * 6, ry: Math.random() * 6, rz: Math.random() * 6,
        sx: (Math.random() - 0.5) * 10, sy: (Math.random() - 0.5) * 8, sz: (Math.random() - 0.5) * 10,
        color: Math.random() < 0.15 ? '#fff3b0' : '#ffffff',
      });
    }
  }

  confettiBurst(x, z, n = 90) {
    const cols = ['#e0402f', '#ffd84d', '#2f6db5', '#3aa56c', '#ff7a59', '#ffffff'];
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const s = 1 + Math.random() * 3;
      this.confetti.spawn({
        x: x + (Math.random() - 0.5), y: 1.5 + Math.random(), z: z + (Math.random() - 0.5),
        vx: Math.cos(a) * s, vy: 3 + Math.random() * 4, vz: Math.sin(a) * s,
        gravity: 7, drag: 1.5, flutter: 4, life: 2 + Math.random(), size: 0.07,
        rx: Math.random() * 6, rz: Math.random() * 6, sx: (Math.random() - 0.5) * 16, sz: (Math.random() - 0.5) * 16,
        color: cols[i % cols.length],
      });
    }
  }

  sparkle(x, y, z, n = 10) {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const s = 1.5 + Math.random() * 2.5;
      this.spark.spawn({
        x, y, z, vx: Math.cos(a) * s, vy: (Math.random() - 0.2) * 3, vz: Math.sin(a) * s,
        drag: 4, life: 0.35 + Math.random() * 0.25, size: 0.05 + Math.random() * 0.04, sx: 8, sy: 8,
      });
    }
  }

  shred(x, z) {
    for (let i = 0; i < 26; i++) {
      const a = Math.random() * Math.PI * 2;
      this.paper.spawn({
        x: x + (Math.random() - 0.5) * 0.3, y: 0.9, z: z + (Math.random() - 0.5) * 0.3,
        vx: Math.cos(a) * 1.2, vy: 1 + Math.random() * 2, vz: Math.sin(a) * 1.2,
        gravity: 5, drag: 1, flutter: 2, life: 1 + Math.random() * 0.6, size: 0.06,
        rx: Math.random() * 6, rz: Math.random() * 6, sx: 10, sz: 8, color: '#ffffff',
      });
    }
  }

  /** 床に広がる輪（新人の叫び・発見の合図） */
  ring(x, z, color, maxR = 6, dur = 0.8, y = 0.05) {
    const mat = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.8, depthWrite: false, side: THREE.DoubleSide });
    const m = new THREE.Mesh(this.ringGeo, mat);
    m.rotation.x = -Math.PI / 2;
    m.position.set(x, y, z);
    this.group.add(m);
    this.rings.push({ m, age: 0, dur, maxR });
  }

  /** 書類の落下予告マーカー */
  marker(x, z) {
    const mat = new THREE.MeshBasicMaterial({ color: '#e0402f', transparent: true, opacity: 0.9, depthWrite: false });
    const fillMat = new THREE.MeshBasicMaterial({ color: '#e0402f', transparent: true, opacity: 0.18, depthWrite: false });
    const g = new THREE.Group();
    const ring = new THREE.Mesh(this.markerGeo, mat);
    const fill = new THREE.Mesh(this.markerFill, fillMat);
    ring.rotation.x = fill.rotation.x = -Math.PI / 2;
    g.add(ring, fill);
    g.position.set(x, 0.04, z);
    this.group.add(g);
    const h = { g, mat, fillMat, age: 0 };
    this.markers.push(h);
    return h;
  }

  removeMarker(h) {
    h.dead = true;
  }

  /** 書類の束を放物線で投げる */
  throwPaper(from, to, T, onLand) {
    const g = new THREE.Group();
    for (let i = 0; i < 3; i++) {
      const s = new THREE.Mesh(this.paperGeo, this.paperMat);
      s.position.y = i * 0.028;
      s.rotation.y = (i - 1) * 0.15;
      s.castShadow = true;
      g.add(s);
    }
    g.position.copy(from);
    g.scale.setScalar(1.35);
    this.group.add(g);
    const marker = this.marker(to.x, to.z);
    this.projectiles.push({ g, from: from.clone(), to: to.clone(), T, t: 0, onLand, marker, spin: (Math.random() - 0.5) * 12 });
  }

  update(dt) {
    this.puff.update(dt);
    this.paper.update(dt);
    this.confetti.update(dt);
    this.spark.update(dt);
    for (let i = this.rings.length - 1; i >= 0; i--) {
      const r = this.rings[i];
      r.age += dt;
      const k = r.age / r.dur;
      if (k >= 1) {
        r.m.removeFromParent();
        r.m.material.dispose();
        this.rings.splice(i, 1);
        continue;
      }
      const e = 1 - Math.pow(1 - k, 3);
      r.m.scale.setScalar(0.2 + e * r.maxR);
      r.m.material.opacity = 0.85 * (1 - k);
    }
    for (let i = this.projectiles.length - 1; i >= 0; i--) {
      const p = this.projectiles[i];
      p.t += dt;
      const k = clamp(p.t / p.T, 0, 1);
      const h = 1.6 + p.from.distanceTo(p.to) * 0.08;
      p.g.position.lerpVectors(p.from, p.to, k);
      p.g.position.y = p.from.y * (1 - k) + 0.05 * k + Math.sin(k * Math.PI) * h;
      p.g.rotation.y += p.spin * dt;
      p.g.rotation.z = Math.sin(p.t * 9) * 0.3;
      if (k >= 1) {
        p.g.removeFromParent();
        this.removeMarker(p.marker);
        this.projectiles.splice(i, 1);
        p.onLand?.(p.to);
      }
    }
    for (let i = this.markers.length - 1; i >= 0; i--) {
      const mk = this.markers[i];
      mk.age += dt;
      if (mk.dead) {
        mk.g.removeFromParent();
        mk.mat.dispose();
        mk.fillMat.dispose();
        this.markers.splice(i, 1);
        continue;
      }
      const pulse = 1 + Math.sin(mk.age * 18) * 0.06;
      mk.g.scale.setScalar(pulse * (0.6 + Math.min(1, mk.age * 3) * 0.4));
      mk.fillMat.opacity = 0.14 + Math.min(0.2, mk.age * 0.25);
    }
  }

  clear() {
    for (const r of this.rings) {
      r.m.removeFromParent();
      r.m.material.dispose();
    }
    this.rings = [];
    for (const p of this.projectiles) p.g.removeFromParent();
    this.projectiles = [];
    for (const m of this.markers) m.dead = true;
    this.update(0);
    for (const pool of [this.puff, this.paper, this.confetti, this.spark]) {
      pool.list.length = 0;
      pool.mesh.count = 0;
    }
  }
}

/** ダッシュの残像 */
export class Ghosts {
  constructor(scene, character, count = 7) {
    this.char = character;
    this.items = [];
    this.next = 0;
    for (let i = 0; i < count; i++) {
      const mat = new THREE.MeshBasicMaterial({ color: '#8fd3ff', transparent: true, opacity: 0, depthWrite: false });
      const g = new THREE.Group();
      const parts = character.meshes.map((src) => {
        const m = new THREE.Mesh(src.geometry, mat);
        m.matrixAutoUpdate = false;
        g.add(m);
        return m;
      });
      g.visible = false;
      scene.add(g);
      this.items.push({ g, mat, parts, age: 0, life: 0.3 });
    }
  }
  spawn() {
    const it = this.items[this.next];
    this.next = (this.next + 1) % this.items.length;
    this.char.root.updateMatrixWorld(true);
    it.parts.forEach((m, i) => m.matrix.copy(this.char.meshes[i].matrixWorld));
    it.age = 0;
    it.g.visible = true;
  }
  update(dt) {
    for (const it of this.items) {
      if (!it.g.visible) continue;
      it.age += dt;
      const k = it.age / it.life;
      if (k >= 1) {
        it.g.visible = false;
        continue;
      }
      it.mat.opacity = 0.42 * (1 - k);
    }
  }
  dispose() {
    for (const it of this.items) {
      it.g.removeFromParent();
      it.mat.dispose();
    }
  }
}

/** 視界コーン（壁で遮られる扇形） */
export class VisionCone {
  constructor(parent, color, segments = 30) {
    this.n = segments;
    const vcount = 1 + (segments + 1) * 2;
    this.pos = new Float32Array(vcount * 3);
    this.col = new Float32Array(vcount * 4);
    const idx = [];
    for (let i = 0; i < segments; i++) {
      const a = 1 + i * 2;
      const b = 1 + (i + 1) * 2;
      idx.push(0, a, b);
      idx.push(a, a + 1, b + 1, a, b + 1, b);
    }
    this.geo = new THREE.BufferGeometry();
    this.geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    this.geo.setAttribute('color', new THREE.BufferAttribute(this.col, 4));
    this.geo.setIndex(idx);
    this.mat = new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, depthWrite: false, side: THREE.DoubleSide });
    this.mesh = new THREE.Mesh(this.geo, this.mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 1;
    this.color = new THREE.Color(color);
    parent.add(this.mesh);
  }
  update(grid, x, z, yaw, fov, range, intensity = 1, color = null) {
    const c = color || this.color;
    const P = this.pos;
    const C = this.col;
    const y = 0.035;
    P[0] = x;
    P[1] = y;
    P[2] = z;
    C[0] = c.r;
    C[1] = c.g;
    C[2] = c.b;
    C[3] = 0.32 * intensity;
    for (let i = 0; i <= this.n; i++) {
      const a = yaw - fov / 2 + (fov * i) / this.n;
      const dx = Math.sin(a);
      const dz = Math.cos(a);
      const d = grid.sightDistance(x, z, dx, dz, range);
      const inner = 1 + i * 2;
      const outer = inner + 1;
      const di = Math.max(0.05, d - 0.35);
      P[inner * 3] = x + dx * di;
      P[inner * 3 + 1] = y;
      P[inner * 3 + 2] = z + dz * di;
      P[outer * 3] = x + dx * d;
      P[outer * 3 + 1] = y;
      P[outer * 3 + 2] = z + dz * d;
      for (const [v, al] of [[inner, 0.12], [outer, 0.42]]) {
        C[v * 4] = c.r;
        C[v * 4 + 1] = c.g;
        C[v * 4 + 2] = c.b;
        C[v * 4 + 3] = al * intensity;
      }
    }
    this.geo.attributes.position.needsUpdate = true;
    this.geo.attributes.color.needsUpdate = true;
  }
  set visible(v) {
    this.mesh.visible = v;
  }
  dispose() {
    this.mesh.removeFromParent();
    this.geo.dispose();
    this.mat.dispose();
  }
}

/** 足元の円（気づかれる範囲の目安） */
export class RangeRing {
  constructor(parent, color, r) {
    this.mat = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0, depthWrite: false });
    this.mesh = new THREE.Mesh(new THREE.RingGeometry(r - 0.06, r, 64), this.mat);
    this.mesh.rotation.x = -Math.PI / 2;
    this.mesh.position.y = 0.03;
    this.fill = new THREE.Mesh(new THREE.CircleGeometry(r - 0.06, 48), new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0, depthWrite: false }));
    this.fill.rotation.x = -Math.PI / 2;
    this.fill.position.y = 0.025;
    parent.add(this.mesh, this.fill);
  }
  update(x, z, opacity) {
    this.mesh.position.x = this.fill.position.x = x;
    this.mesh.position.z = this.fill.position.z = z;
    this.mat.opacity = opacity;
    this.fill.material.opacity = opacity * 0.18;
    this.mesh.visible = this.fill.visible = opacity > 0.01;
  }
  dispose() {
    this.mesh.removeFromParent();
    this.fill.removeFromParent();
    this.mesh.geometry.dispose();
    this.fill.geometry.dispose();
    this.mat.dispose();
    this.fill.material.dispose();
  }
}
