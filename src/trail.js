import * as THREE from 'three';
import { Character } from './characters.js';
import { DAISHA, SUCCESSOR } from './cast.js';
import { GeoBatch, M, clamp, dampAngle, pick } from './util.js';

const CAP = 1024; // 履歴の点の数（約200m）
const STEP = 0.2;
const PRINT_GAP = 0.6; // 足あとの間隔（s の 0.6 の倍数に固定して、足あとが滑らないようにする）
const MAXP = 40;
// 足あと1つ（楕円 0.08×0.15m を床に寝かせる。長い向きが +Z）。全ステージで共有するので dispose しない
const PRINT = new THREE.CircleGeometry(1, 10).scale(0.08, 0.15, 1).rotateX(-Math.PI / 2);
const _m = new THREE.Matrix4();
const _o = { x: 0, z: 0, dx: 0, dz: 1, gap: 0 };
const _b = { x: 0, z: 0, dx: 0, dz: 1, gap: 0 };
const _near = { s: 0, d: 0 };

/**
 * 主人公の歩いた道すじ（足あと）。台車・後任・お見送り隊は、この道すじだけを同じ順番でたどる。
 * 点は 0.2m おき。s は道すじに沿った累積距離。ダッシュ中に記録した点には途切れ印が付く。
 * たどる側は cur = { k, v } を持ち、sample() がそれを前後に動かして補間する（毎フレームの確保なし）。
 */
export class Trail {
  constructor(game, color) {
    this.game = game;
    this.xs = new Float32Array(CAP);
    this.zs = new Float32Array(CAP);
    this.ss = new Float64Array(CAP);
    this.gs = new Uint8Array(CAP);
    this.n = 0; // 記録した点の総数（k 番目の点は k % CAP に入る）
    this.version = 0;
    this.gapFrom = 0;
    this.printT = 0;
    this.pcur = { k: 0, v: -1 };
    this.bcur = { k: 0, v: -1 };
    if (color) {
      this.mat = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.55, depthWrite: false });
      this.prints = new THREE.InstancedMesh(PRINT, this.mat, MAXP);
      this.prints.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      this.prints.frustumCulled = false;
      this.prints.renderOrder = 1;
      this.prints.count = 0;
      game.scene.add(this.prints);
    }
  }

  get first() {
    return Math.max(0, this.n - CAP);
  }
  get headS() {
    return this.ss[(this.n - 1) % CAP];
  }
  get tailS() {
    return this.ss[this.first % CAP];
  }

  push(x, z, s, g) {
    const i = this.n % CAP;
    this.xs[i] = x;
    this.zs[i] = z;
    this.ss[i] = s;
    this.gs[i] = g;
    this.n++;
  }

  /** 2点（b は省略可）で張り直す。たどる側のカーソルは先頭に戻る */
  reset(ax, az, bx, bz) {
    this.n = 0;
    this.version++;
    this.push(ax, az, 0, 0);
    if (bx !== undefined) this.record(bx, bz);
  }

  /** 最後の点から STEP 以上離れたら、STEP 刻みで点を足す（満杯なら最古を捨てる） */
  record(x, z, dash = false) {
    const h = (this.n - 1) % CAP;
    let lx = this.xs[h];
    let lz = this.zs[h];
    let s = this.ss[h];
    let dx = x - lx;
    let dz = z - lz;
    let d = Math.hypot(dx, dz);
    // 瞬間移動したら、1区間の途切れとして記録する（たどる側の s はそのまま使える）
    if (d > 6) {
      this.push(x, z, s + d, 1);
      return;
    }
    const g = dash ? 1 : 0;
    while (d >= STEP) {
      lx += (dx / d) * STEP;
      lz += (dz / d) * STEP;
      s += STEP;
      this.push(lx, lz, s, g);
      dx = x - lx;
      dz = z - lz;
      d = Math.hypot(dx, dz);
    }
  }

  /** s の位置と向き。s は [tailS, headS] に丸める。out.gap はその区間がダッシュ中なら 1 */
  sample(s, cur, out) {
    const f = this.first;
    const h = this.n - 1;
    const S = this.ss;
    if (cur.v !== this.version || cur.k < f || cur.k > h) {
      cur.k = f;
      cur.v = this.version;
    }
    if (h <= f) {
      out.x = this.xs[f % CAP];
      out.z = this.zs[f % CAP];
      out.dx = 0;
      out.dz = 1;
      out.gap = 0;
      return out;
    }
    s = clamp(s, S[f % CAP], S[h % CAP]);
    let k = Math.min(cur.k, h - 1);
    while (k < h - 1 && S[(k + 1) % CAP] < s) k++;
    while (k > f && S[k % CAP] > s) k--;
    cur.k = k;
    const i = k % CAP;
    const j = (k + 1) % CAP;
    const len = S[j] - S[i];
    const t = len > 1e-6 ? (s - S[i]) / len : 0;
    const dx = this.xs[j] - this.xs[i];
    const dz = this.zs[j] - this.zs[i];
    const l = Math.hypot(dx, dz) || 1;
    out.x = this.xs[i] + dx * t;
    out.z = this.zs[i] + dz * t;
    out.dx = dx / l;
    out.dz = dz / l;
    out.gap = this.gs[j];
    return out;
  }

  /** s をこえる最初の点の番号（二分探索） */
  after(s) {
    let lo = this.first;
    let hi = this.n - 1;
    if (this.ss[hi % CAP] <= s) return this.n;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (this.ss[mid % CAP] > s) hi = mid;
      else lo = mid + 1;
    }
    return lo;
  }

  /** (s0, s1] に途切れ印の区間があれば、その区間の終わりの s を返す（始まりは gapFrom）。なければ -1 */
  gapAhead(s0, s1) {
    const h = this.n - 1;
    for (let k = this.after(s0); k <= h && this.ss[k % CAP] <= s1; k++) {
      if (!this.gs[k % CAP]) continue;
      let a = k;
      while (a - 1 > this.first && this.gs[(a - 1) % CAP]) a--;
      this.gapFrom = this.ss[Math.max(this.first, a - 1) % CAP];
      while (k <= h && this.gs[k % CAP]) k++;
      return this.ss[Math.min(k, h) % CAP];
    }
    return -1;
  }

  /** 先頭から back m 以内で (x, z) にいちばん近い点の s と距離（{ s, d } を使い回す） */
  nearestS(x, z, back) {
    const lim = this.headS - back;
    _near.s = this.headS;
    _near.d = Infinity;
    for (let k = this.n - 1; k >= this.first; k--) {
      const i = k % CAP;
      if (this.ss[i] < lim) break;
      const d = Math.hypot(this.xs[i] - x, this.zs[i] - z);
      if (d < _near.d) {
        _near.d = d;
        _near.s = this.ss[i];
      }
    }
    return _near;
  }

  /** s の位置のマスが歩けない（段ボールが置かれた）なら true */
  blockedAt(s) {
    this.sample(s, this.bcur, _b);
    return !this.game.world.grid.isWalkWorld(_b.x, _b.z);
  }

  /** fromS〜headS に足あとを並べる（0.1秒ごと）。ダッシュ中の区間には描かない */
  updatePrints(dt, fromS) {
    if (!this.prints) return;
    this.printT -= dt;
    if (this.printT > 0) return;
    this.printT = 0.1;
    const head = this.headS;
    let n = 0;
    for (let k = Math.ceil(Math.max(fromS, head - PRINT_GAP * MAXP, this.tailS) / PRINT_GAP); k * PRINT_GAP < head && n < MAXP; k++) {
      this.sample(k * PRINT_GAP, this.pcur, _o);
      if (_o.gap) continue;
      const side = k % 2 ? 0.1 : -0.1; // 左右交互
      _m.makeRotationY(Math.atan2(_o.dx, _o.dz));
      _m.setPosition(_o.x - _o.dz * side, 0.015, _o.z + _o.dx * side);
      this.prints.setMatrixAt(n++, _m);
    }
    this.prints.count = n;
    this.prints.instanceMatrix.needsUpdate = true;
  }

  dispose() {
    if (!this.prints) return;
    this.prints.removeFromParent();
    this.prints.dispose();
    this.mat.dispose();
  }
}

// ---------------------------------------------------------------------------
// 同行者：台車（押尾さん）と後任の淀川さん
// ---------------------------------------------------------------------------
const GAP = { daisha: 2.4, successor: 2.0 };
const POSE = { follow: 'idle', greet: 'bow', memo: 'scroll', orient: 'listen', done: 'bow' };
let CART = null; // 台車のジオメトリ（全ステージで共有するので dispose しない）

/** 段ボールを積んだ台車（進行方向が +Z、取っ手は後ろ） */
function cartGeometry() {
  if (CART) return CART;
  const b = new GeoBatch();
  const box = new THREE.BoxGeometry(1, 1, 1);
  const wheel = new THREE.CylinderGeometry(0.07, 0.07, 0.05, 10);
  const add = (color, x, y, z, w, h, d, ry = 0) => b.add(box, color, M(x, y, z, 0, ry, 0, w, h, d));
  add('#3b6ea8', 0, 0.16, 0, 0.6, 0.08, 0.9);
  for (const sx of [-0.26, 0.26]) {
    for (const sz of [-0.36, 0.36]) b.add(wheel, '#1b1b1f', M(sx, 0.07, sz, 0, 0, Math.PI / 2));
    add('#8a919c', sx, 0.55, -0.44, 0.04, 0.8, 0.04);
  }
  add('#8a919c', 0, 0.94, -0.44, 0.56, 0.04, 0.04);
  // 段ボール3箱（少しずつ回す）とガムテープ
  const boxes = [[0, 0.4, -0.2, 0.08], [0, 0.4, 0.22, -0.06], [0.02, 0.8, 0, 0.14]];
  for (const [x, y, z, ry] of boxes) {
    add('#c8a165', x, y, z, 0.55, 0.4, 0.45 * (y > 0.5 ? 1 : 0.92), ry);
    add('#e8d9b0', x, y + 0.204, z, 0.1, 0.01, 0.46, ry);
  }
  box.dispose();
  wheel.dispose();
  CART = b.build();
  return CART;
}

/** 足あとをたどる同行者。update() はプレイ中だけ、animate() は毎フレームアニメーションだけ進める */
export class Follower {
  constructor(game, kind) {
    this.game = game;
    this.kind = kind;
    this.cfg = kind === 'daisha' ? DAISHA : SUCCESSOR;
    this.char = new Character(this.cfg.look, { outline: true });
    this.pos = new THREE.Vector3(); // 吹き出しの位置（台車なら押尾さん）
    this.s = 0;
    this.v = 0;
    this.cur = { k: 0, v: -1 };
    this.state = 'follow';
    this.t = 0;
    this.dur = 0;
    this.lineT = 5;
    this.lookAt = null;
    this.closeIn = false;
    game.scene.add(this.char.root);
    if (kind === 'daisha') {
      this.mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.8 });
      this.cart = new THREE.Mesh(cartGeometry(), this.mat);
      this.cart.castShadow = true;
      this.cartPos = new THREE.Vector3();
      this.yaw = 0;
      this.dirX = 0;
      this.dirZ = 1;
      this.hitCD = 0;
      this.blockNoted = false;
      this.cue = null; // 次に言うセリフ（はね飛ばしたあと）
      this.ocur = { k: 0, v: -1 };
      game.scene.add(this.cart);
    }
    this.place(true);
  }

  say(text, dur = 1.6) {
    this.game.ui.bubble(this, text, this.kind === 'daisha' ? 'daisha' : 'kounin', dur);
  }

  /** 状態を変える（dur 秒で follow に戻る。lookAt はその間に向く相手） */
  set(state, dur = 0, lookAt = null) {
    this.state = state;
    this.t = 0;
    this.dur = dur;
    this.lookAt = lookAt;
    this.v = 0;
    if (lookAt) this.char.faceDir(lookAt.pos.x - this.pos.x, lookAt.pos.z - this.pos.z);
  }

  update(dt) {
    const tr = this.game.trail;
    this.t += dt;
    this.lineT -= dt;
    let ds = 0;
    if (this.kind === 'daisha') {
      this.hitCD = Math.max(0, this.hitCD - dt);
      ds = clamp(tr.headS - GAP.daisha - this.s, 0, 5.2 * dt);
      // 段ボールでふさがれたら進まない
      if (ds > 0 && tr.blockedAt(this.s + ds + 0.5)) {
        ds = 0;
        if (!this.blockNoted) {
          this.blockNoted = true;
          this.say(this.cfg.blocked[0], 1.8);
        }
      }
      if (ds > 0 && this.lineT <= 0) {
        this.lineT = 4 + Math.random() * 2;
        this.say(this.cue || pick(Math.random, this.cfg.move), 1.4);
        this.cue = null;
      }
    } else if (this.state === 'follow') {
      // 遅れが 1m を超えたら小走り。目標（2m 後ろ。主人公が★の上で待っていれば、すぐそば）は追い越さない
      const lag = tr.headS - (this.closeIn ? 0.5 : GAP.successor) - this.s;
      ds = clamp(lag, 0, (lag > 1 ? 6.0 : 4.6) * dt);
      if (this.lineT <= 0) {
        const far = tr.headS - this.s > 5;
        this.lineT = far ? 4 : 8 + Math.random() * 4;
        this.say(pick(Math.random, far ? this.cfg.lag : this.cfg.idle), 1.8);
      }
    } else if (this.dur && this.t > this.dur) {
      this.set('follow');
    }
    this.s += ds;
    this.v = dt > 0 ? ds / dt : 0;
    this.place(false, dt);
  }

  /** 足あとの上に置く（台車は s、押尾さんは s-0.9。足あとより後ろは最初の区間を延ばす） */
  place(snap, dt = 0) {
    const tr = this.game.trail;
    const c = this.char;
    tr.sample(this.s, this.cur, _o);
    if (this.kind === 'daisha') {
      this.cartPos.set(_o.x, 0, _o.z);
      if (this.v > 0.05 || snap) {
        this.dirX = _o.dx;
        this.dirZ = _o.dz;
      }
      const a = Math.atan2(this.dirX, this.dirZ);
      this.yaw = snap ? a : dampAngle(this.yaw, a, 10, dt);
      const back = this.s - 0.9;
      tr.sample(back, this.ocur, _o);
      const over = tr.tailS - back;
      if (over > 0 && this.game.world.grid.isWalkWorld(_o.x - _o.dx * over, _o.z - _o.dz * over)) {
        _o.x -= _o.dx * over;
        _o.z -= _o.dz * over;
      }
      this.pos.set(_o.x, 0, _o.z);
      c.faceDir(this.cartPos.x - _o.x, this.cartPos.z - _o.z);
    } else {
      this.pos.set(_o.x, 0, _o.z);
      const P = this.game.player;
      const L = this.lookAt;
      if (L) c.faceDir(L.pos.x - _o.x, L.pos.z - _o.z);
      else if (this.v > 0.2) c.faceDir(_o.dx, _o.dz);
      else if (P) c.faceDir(P.pos.x - _o.x, P.pos.z - _o.z);
    }
    if (snap) c.setYaw(c.targetYaw);
  }

  animate(dt) {
    const c = this.char;
    const play = this.game.state === 'play';
    c.speed = play ? this.v : 0;
    // 主人公が捕まって話している間は、近くでお辞儀して待つ
    c.pose = this.kind === 'daisha' ? 'reach' : this.game.state === 'talk' ? 'bow' : POSE[this.state];
    c.root.position.set(this.pos.x, 0, this.pos.z);
    c.update(dt);
    if (this.cart) {
      this.cart.position.set(this.cartPos.x, 0, this.cartPos.z);
      this.cart.rotation.y = this.yaw;
    }
  }

  dispose() {
    this.char.root.removeFromParent();
    for (const m of this.char.meshes) m.geometry.dispose();
    if (this.cart) {
      this.cart.removeFromParent();
      this.mat.dispose();
    }
  }
}
