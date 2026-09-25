import * as THREE from 'three';

const MOP_TIME = 12;
const MOP_MAX = 128;
const RIPPLE_MAX = 48;
const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _p = new THREE.Vector3();
const _s = new THREE.Vector3();
const _up = new THREE.Vector3(0, 1, 0);
const _c = new THREE.Color();

/**
 * 雨の日の床。水たまり（~）と、清掃員が拭いたあとの濡れた床は滑る。
 * 雨粒（屋外は全体、屋内は窓の外だけ）と水たまりの波紋も描く。
 */
export class Weather {
  constructor(game) {
    this.game = game;
    const world = game.world;
    const stage = game.stage;
    const g = world.grid;
    this.grid = g;
    this.group = new THREE.Group();
    world.group.add(this.group);
    this.own = [];
    this.wet = new Float32Array(g.w * g.h);
    this.mopTiles = [];
    this.ripples = [];
    this.rippleT = 0;

    // 水たまり
    const puddles = [];
    for (let y = 0; y < g.h; y++) {
      for (let x = 0; x < g.w; x++) {
        if (g.at(x, y) !== '~') continue;
        this.wet[y * g.w + x] = Infinity;
        puddles.push([x, y]);
      }
    }
    this.puddleList = puddles;
    const disc = new THREE.CircleGeometry(0.62, 20);
    disc.rotateX(-Math.PI / 2);
    this.own.push(disc);
    if (puddles.length) {
      // 屋外は深い水たまり、屋内は傘のしずくで濡れた床
      const out = !!stage.outdoor;
      const mat = new THREE.MeshStandardMaterial({ color: out ? '#5d7896' : '#9fb6cc', roughness: 0.04, metalness: out ? 0.55 : 0.4, transparent: true, opacity: out ? 0.7 : 0.45, depthWrite: false });
      this.own.push(mat);
      const mesh = new THREE.InstancedMesh(disc, mat, puddles.length);
      let seed = stage.id * 97;
      const rnd = () => {
        seed = (seed * 16807) % 2147483647;
        return seed / 2147483647;
      };
      puddles.forEach(([x, y], i) => {
        _q.setFromAxisAngle(_up, rnd() * Math.PI);
        _p.set(x + 0.5 + (rnd() - 0.5) * 0.2, 0.012 + i * 0.00002, y + 0.5 + (rnd() - 0.5) * 0.2);
        const k = out ? 1 : 0.72;
        _s.set((1 + rnd() * 0.35) * k, 1, (0.85 + rnd() * 0.3) * k);
        mesh.setMatrixAt(i, _m.compose(_p, _q, _s));
      });
      mesh.renderOrder = 1;
      this.group.add(mesh);
      this.puddleMesh = mesh;
    }

    // 拭いたばかりの床（あとから増える）
    const mopMat = new THREE.MeshStandardMaterial({ color: '#cfe8f7', roughness: 0.02, metalness: 0.3, transparent: true, opacity: 0.4, depthWrite: false });
    this.own.push(mopMat);
    this.mopMesh = new THREE.InstancedMesh(disc, mopMat, MOP_MAX);
    this.mopMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mopMesh.count = 0;
    this.mopMesh.renderOrder = 1;
    this.mopMesh.frustumCulled = false;
    this.group.add(this.mopMesh);

    // 波紋
    const ring = new THREE.RingGeometry(0.85, 1, 24);
    ring.rotateX(-Math.PI / 2);
    this.own.push(ring);
    const rippleMat = new THREE.MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0.55, depthWrite: false, blending: THREE.AdditiveBlending });
    this.own.push(rippleMat);
    this.rippleMesh = new THREE.InstancedMesh(ring, rippleMat, RIPPLE_MAX);
    this.rippleMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.rippleMesh.setColorAt(0, _c.set('#ffffff'));
    this.rippleMesh.count = 0;
    this.rippleMesh.renderOrder = 2;
    this.rippleMesh.frustumCulled = false;
    this.group.add(this.rippleMesh);

    // 雨粒
    this.mode = stage.rain ? 'full' : stage.rainOutside ? 'window' : null;
    if (this.mode) {
      const full = this.mode === 'full';
      this.area = full
        ? { x0: -3, x1: g.w + 3, z0: -3, z1: g.h + 3, top: 9 }
        : { x0: -6, x1: g.w + 6, z0: -3.8, z1: -0.6, top: 7 };
      const n = full ? 1100 : 420;
      this.drops = new Float32Array(n * 3);
      for (let i = 0; i < n; i++) this.resetDrop(i, true);
      this.linePos = new Float32Array(n * 6);
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(this.linePos, 3).setUsage(THREE.DynamicDrawUsage));
      const mat = new THREE.LineBasicMaterial({ color: full ? '#dbe7f5' : '#aebfe0', transparent: true, opacity: full ? 0.6 : 0.55, depthWrite: false });
      this.own.push(geo, mat);
      this.rain = new THREE.LineSegments(geo, mat);
      this.rain.frustumCulled = false;
      this.group.add(this.rain);
    }
  }

  resetDrop(i, anywhere = false) {
    const a = this.area;
    const d = this.drops;
    d[i * 3] = a.x0 + Math.random() * (a.x1 - a.x0);
    d[i * 3 + 1] = anywhere ? Math.random() * a.top : a.top + Math.random() * 2;
    d[i * 3 + 2] = a.z0 + Math.random() * (a.z1 - a.z0);
  }

  isWet(x, z) {
    const g = this.grid;
    const tx = Math.floor(x);
    const tz = Math.floor(z);
    if (tx < 0 || tz < 0 || tx >= g.w || tz >= g.h) return false;
    return this.wet[tz * g.w + tx] > 0;
  }

  isPuddle(x, z) {
    const g = this.grid;
    const tx = Math.floor(x);
    const tz = Math.floor(z);
    if (tx < 0 || tz < 0 || tx >= g.w || tz >= g.h) return false;
    return this.wet[tz * g.w + tx] === Infinity;
  }

  /** 清掃員が拭いたマスを濡らす */
  mop(x, z) {
    const g = this.grid;
    const tx = Math.floor(x);
    const tz = Math.floor(z);
    if (!g.isWalk(tx, tz)) return;
    const i = tz * g.w + tx;
    if (this.wet[i] === Infinity) return;
    if (this.wet[i] <= 0) {
      if (this.mopTiles.length >= MOP_MAX) return;
      this.mopTiles.push(i);
    }
    this.wet[i] = MOP_TIME;
  }

  ripple(x, z, size = 0.35) {
    if (this.ripples.length >= RIPPLE_MAX) this.ripples.shift();
    this.ripples.push({ x, z, age: 0, life: 0.7, size });
  }

  update(dt) {
    const g = this.grid;
    // 乾いていく床
    const M = this.mopMesh;
    let n = 0;
    for (let k = this.mopTiles.length - 1; k >= 0; k--) {
      const i = this.mopTiles[k];
      this.wet[i] -= dt;
      if (this.wet[i] <= 0) {
        this.wet[i] = 0;
        this.mopTiles.splice(k, 1);
      }
    }
    for (const i of this.mopTiles) {
      const f = Math.min(1, this.wet[i] / 2.5);
      _q.identity();
      _p.set((i % g.w) + 0.5, 0.013, Math.floor(i / g.w) + 0.5);
      _s.set(0.95 * f + 0.05, 1, 0.95 * f + 0.05);
      M.setMatrixAt(n++, _m.compose(_p, _q, _s));
    }
    M.count = n;
    M.instanceMatrix.needsUpdate = true;

    // 雨粒
    if (this.rain) {
      const d = this.drops;
      const L = this.linePos;
      const count = d.length / 3;
      const vy = 13;
      const vx = 1.6;
      for (let i = 0; i < count; i++) {
        d[i * 3] += vx * dt;
        d[i * 3 + 1] -= vy * dt;
        if (d[i * 3 + 1] < 0) {
          if (this.mode === 'full' && Math.random() < 0.08) {
            const x = d[i * 3];
            const z = d[i * 3 + 2];
            if (this.isPuddle(x, z)) this.ripple(x, z, 0.25 + Math.random() * 0.15);
          }
          this.resetDrop(i);
        }
        const x = d[i * 3];
        const y = d[i * 3 + 1];
        const z = d[i * 3 + 2];
        L[i * 6] = x;
        L[i * 6 + 1] = y;
        L[i * 6 + 2] = z;
        L[i * 6 + 3] = x - vx * 0.045;
        L[i * 6 + 4] = y + vy * 0.045;
        L[i * 6 + 5] = z;
      }
      this.rain.geometry.attributes.position.needsUpdate = true;
    }
    // 屋外では水たまりに雨粒の波紋
    if (this.mode === 'full' && this.puddleList.length) {
      this.rippleT -= dt;
      while (this.rippleT < 0) {
        this.rippleT += 0.05;
        const [x, y] = this.puddleList[Math.floor(Math.random() * this.puddleList.length)];
        this.ripple(x + 0.2 + Math.random() * 0.6, y + 0.2 + Math.random() * 0.6, 0.18 + Math.random() * 0.14);
      }
    }
    const R = this.rippleMesh;
    let r = 0;
    for (let k = this.ripples.length - 1; k >= 0; k--) {
      const p = this.ripples[k];
      p.age += dt;
      if (p.age >= p.life) this.ripples.splice(k, 1);
    }
    for (const p of this.ripples) {
      const t = p.age / p.life;
      _q.identity();
      _p.set(p.x, 0.02, p.z);
      _s.setScalar(p.size * (0.3 + t));
      R.setMatrixAt(r, _m.compose(_p, _q, _s));
      R.setColorAt(r, _c.setScalar(0.7 * (1 - t)));
      r++;
    }
    R.count = r;
    R.instanceMatrix.needsUpdate = true;
    if (R.instanceColor) R.instanceColor.needsUpdate = true;
  }

  dispose() {
    for (const o of this.own) o.dispose();
    this.puddleMesh?.dispose();
    this.mopMesh.dispose();
    this.rippleMesh.dispose();
    this.group.removeFromParent();
  }
}
