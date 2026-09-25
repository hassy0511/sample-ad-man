import * as THREE from 'three';
import { Character } from './characters.js';
import { WORKER_HAIR, HAIR_COLORS, SKINS } from './cast.js';
import { damp, mulberry32, pick, textTexture } from './util.js';

export const TRAIL = 128;
export const STEP = 0.12;
export const GAP = 6; // 1人ぶん = 6サンプル = 0.72m
const MAXM = 10; // メンバーの上限（元のメンバーを含む）
const MAXB = 12;
const RING = new THREE.RingGeometry(0.3, 0.4, 24).rotateX(-Math.PI / 2); // 全列で共有。dispose しない
const BADGES = new Map(); // `${color}|${n}` → テクスチャ（ステージをまたいで使い回す）
const _m = new THREE.Matrix4();
const _p = { x: 0, z: 0 };

function badgeTexture(color, n) {
  const key = `${color}|${n}`;
  if (!BADGES.has(key)) BADGES.set(key, textTexture(`×${n}`, { w: 160, h: 64, bg: color, color: '#ffffff', font: '800 40px "M PLUS Rounded 1c", sans-serif', radius: 14 }));
  return BADGES.get(key);
}

/** memberLook から、列のメンバー1人ぶんの見た目を作る */
function memberLook(ml, rng) {
  const top = pick(rng, ml.tops);
  const look = {
    skin: pick(rng, SKINS),
    hair: { style: pick(rng, WORKER_HAIR), color: pick(rng, HAIR_COLORS) },
    top,
    shirt: top.type === 'shirt' ? top.color : pick(rng, ['#ffffff', '#e8f0fb']),
    tie: top.type === 'suit' || ml.headband === 'tie' ? pick(rng, ['#3b5a86', '#2f8f5b', '#8a1f2b', '#e8b82e']) : null,
    bottom: { type: 'pants', color: pick(rng, ['#2d3240', '#4a4e57', '#1f2226']) },
    shoes: '#222222',
    glasses: rng() < 0.25 ? { color: '#2b2b2b' } : null,
    blush: !!ml.blush,
    headband: ml.headband || null,
    prop: ml.prop || {},
  };
  // 'tie' は自分のネクタイを頭に巻く
  if (look.headband === 'tie') {
    look.headband = look.tie;
    look.tie = null;
  }
  return look;
}

const pushAway = (p, q, r) => {
  const dx = p.x - q.x;
  const dz = p.z - q.z;
  const d = Math.hypot(dx, dz);
  if (d >= r || d < 1e-4) return;
  p.x = q.x + (dx / d) * r;
  p.z = q.z + (dz / d) * r;
};

/**
 * 肩をつないで歩く人の列。先頭は Enemy で、後ろのメンバー・通った跡・足元の輪・人数バッジをこのクラスが持つ。
 * メンバーは先頭の通った跡を 0.72m おきにたどる。巻き込んだ敵もメンバーとして並ぶ。
 */
export class Conga {
  constructor(game, leader, cfg, index) {
    this.game = game;
    this.leader = leader;
    this.cfg = cfg;
    this.index = index;
    this.trail = new Float32Array(TRAIL * 2);
    this.head = TRAIL - 1;
    this.rideCD = 0;
    this.missDash = -1;
    this.phoneNoteT = 0;
    this.phoneMark = -1;
    this.hit = 0;
    this.bounds = { x: 0, z: 0, r: 0 };
    const rng = mulberry32(game.stage.id * 131 + index * 17);
    this.members = [];
    for (let i = 0; i < cfg.members; i++) {
      const char = new Character(memberLook(leader.cfg.memberLook, rng), { outline: false, lite: true, legs: true });
      // 影は胴と頭だけ（描画回数を抑える）
      for (const x of char.meshes) x.castShadow = x === char.torso || x.parent === char.head;
      char.t = rng() * 10;
      game.scene.add(char.root);
      this.members.push({ char, pos: { x: 0, z: 0 }, enemy: null });
    }
    this.own = this.members.slice(); // dispose 用（巻き込んだ人のキャラは Enemy が捨てる）
    this.ringMat = new THREE.MeshBasicMaterial({ color: cfg.color, transparent: true, opacity: 0.85, depthWrite: false });
    this.rings = new THREE.InstancedMesh(RING, this.ringMat, MAXB);
    this.rings.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.rings.frustumCulled = false;
    this.rings.renderOrder = 1;
    this.shownN = cfg.members + 1;
    this.badgeMat = new THREE.SpriteMaterial({ map: badgeTexture(cfg.color, this.shownN), depthTest: false, transparent: true });
    this.badge = new THREE.Sprite(this.badgeMat);
    this.badge.scale.set(0.8, 0.32, 1);
    this.badge.renderOrder = 6;
    game.scene.add(this.rings, this.badge);
  }

  /** 先頭を出現位置に戻し、メンバーを跡の上に並べ直す */
  reset() {
    const e = this.leader;
    e.pos.set(e.home.x, 0, e.home.z);
    e.vel.x = e.vel.z = 0;
    if (this.cfg.mode === 'route') {
      // 出現位置を含む区間の、次の頂点へ向かう（逆走しない）
      const R = e.patrol;
      const n = R.length;
      let seg = 0;
      for (let i = 0; i < n; i++) {
        const a = R[i];
        const b = R[(i + 1) % n];
        if (e.pos.x >= Math.min(a.x, b.x) - 0.01 && e.pos.x <= Math.max(a.x, b.x) + 0.01 && e.pos.z >= Math.min(a.z, b.z) - 0.01 && e.pos.z <= Math.max(a.z, b.z) + 0.01) {
          seg = i;
          break;
        }
      }
      e.pi = (seg + 1) % n;
      e.set('walk');
      e.char.setYaw(Math.atan2(R[e.pi].x - e.pos.x, R[e.pi].z - e.pos.z));
    } else {
      e.set('start');
      e.char.setYaw(e.homeYaw + Math.PI); // メンバーは homeYaw の側に並ぶので、先頭は反対を向く
    }
    e.char.spin = 0;
    e.char.root.position.copy(e.pos);
    this.prefill();
    for (let k = 1; k <= this.members.length; k++) {
      const m = this.members[k - 1];
      this.sample(k, _p);
      m.pos.x = _p.x;
      m.pos.z = _p.z;
      m.char.root.position.set(_p.x, 0, _p.z);
      m.char.setYaw(e.char.yaw);
    }
    this.fit();
  }

  /** 通った跡をまとめて埋める。route はルートを逆向きに、hunt は homeYaw の向きへまっすぐ */
  prefill() {
    const e = this.leader;
    const T = this.trail;
    const grid = this.game.world.grid;
    const R = this.cfg.mode === 'route' ? e.patrol : null;
    let vi = R ? (e.pi - 1 + R.length) % R.length : 0;
    const dx = Math.sin(e.homeYaw);
    const dz = Math.cos(e.homeYaw);
    let x = e.pos.x;
    let z = e.pos.z;
    for (let i = TRAIL - 1; i >= 0; i--) {
      T[i * 2] = x;
      T[i * 2 + 1] = z;
      if (R) {
        let rem = STEP;
        for (let g = 0; g < 8 && rem > 1e-6; g++) {
          const v = R[vi];
          const d = Math.hypot(v.x - x, v.z - z);
          if (d <= rem) {
            x = v.x;
            z = v.z;
            rem -= d;
            vi = (vi - 1 + R.length) % R.length;
          } else {
            x += ((v.x - x) / d) * rem;
            z += ((v.z - z) / d) * rem;
            rem = 0;
          }
        }
      } else if (grid.isWalkWorld(x + dx * STEP, z + dz * STEP)) {
        // 歩けないマスに当たったら、最後に歩けた点をくり返す
        x += dx * STEP;
        z += dz * STEP;
      }
    }
    this.head = TRAIL - 1;
  }

  push(x, z) {
    this.head = (this.head + 1) % TRAIL;
    this.trail[this.head * 2] = x;
    this.trail[this.head * 2 + 1] = z;
  }

  /** k 人目（先頭 = 0）の位置 */
  sample(k, out) {
    const i = (this.head - k * GAP + TRAIL * 4) % TRAIL;
    out.x = this.trail[i * 2];
    out.z = this.trail[i * 2 + 1];
    return out;
  }

  /** 毎フレーム1回（どの状態でも）。跡を伸ばし、メンバー・輪・バッジを動かす */
  update(dt) {
    const e = this.leader;
    const T = this.trail;
    this.rideCD = Math.max(0, this.rideCD - dt);
    this.phoneNoteT = Math.max(0, this.phoneNoteT - dt);
    // 1. 通った跡を伸ばす
    let lx = T[this.head * 2];
    let lz = T[this.head * 2 + 1];
    let dx = e.pos.x - lx;
    let dz = e.pos.z - lz;
    let d = Math.hypot(dx, dz);
    if (d > 3) this.prefill();
    else {
      while (d >= STEP) {
        lx += (dx / d) * STEP;
        lz += (dz / d) * STEP;
        this.push(lx, lz);
        dx = e.pos.x - lx;
        dz = e.pos.z - lz;
        d = Math.hypot(dx, dz);
      }
    }
    // 2. 並んでいる時間が終わった人は抜ける
    for (let i = this.members.length - 1; i >= 0; i--) {
      const o = this.members[i].enemy;
      if (o && o.inlineT <= 0) this.release(i);
    }
    // 3. メンバーを跡の上に並べる
    const s = e.state;
    const lspd = Math.hypot(e.vel.x, e.vel.z);
    _m.makeTranslation(e.pos.x, 0.04, e.pos.z);
    this.rings.setMatrixAt(0, _m);
    for (let k = 1; k <= this.members.length; k++) {
      const m = this.members[k - 1];
      this.sample(k, _p);
      const ox = m.pos.x;
      const oz = m.pos.z;
      m.pos.x = damp(ox, _p.x, 16, dt);
      m.pos.z = damp(oz, _p.z, 16, dt);
      const vx = dt > 0 ? (m.pos.x - ox) / dt : 0;
      const vz = dt > 0 ? (m.pos.z - oz) / dt : 0;
      const c = m.char;
      c.pose = s === 'bow' ? (Math.floor(e.t * 2.2 + k * 0.4) % 2 ? 'bow' : 'idle') : s === 'lured' ? 'dance' : s === 'tangle' ? 'shock' : 'conga';
      if (m.enemy) {
        // 巻き込んだ人：アニメーションは Enemy 側（idle）で進める
        m.enemy.vel.x = vx;
        m.enemy.vel.z = vz;
      } else {
        c.root.position.set(m.pos.x, 0, m.pos.z);
        c.speed = lspd;
        if (vx * vx + vz * vz > 0.04) c.faceDir(vx, vz);
        c.update(dt);
      }
      _m.makeTranslation(m.pos.x, 0.04, m.pos.z);
      this.rings.setMatrixAt(k, _m);
    }
    // 4. 輪とバッジ
    const n = this.count();
    this.rings.count = n;
    this.rings.instanceMatrix.needsUpdate = true;
    this.badge.position.set(e.pos.x, 3.4, e.pos.z); // 先頭の吹き出しに隠れない高さ
    if (n !== this.shownN) {
      this.shownN = n;
      this.badgeMat.map = badgeTexture(this.cfg.color, n);
    }
    this.fit();
  }

  /** 外接円（離れた相手との距離計算を省くため） */
  fit() {
    const e = this.leader;
    let minX = e.pos.x;
    let maxX = minX;
    let minZ = e.pos.z;
    let maxZ = minZ;
    for (const m of this.members) {
      minX = Math.min(minX, m.pos.x);
      maxX = Math.max(maxX, m.pos.x);
      minZ = Math.min(minZ, m.pos.z);
      maxZ = Math.max(maxZ, m.pos.z);
    }
    this.bounds.x = (minX + maxX) / 2;
    this.bounds.z = (minZ + maxZ) / 2;
    this.bounds.r = Math.hypot(maxX - minX, maxZ - minZ) / 2;
  }

  /** 先頭とメンバーまでの最短距離。どの体かを hit に入れる（0 = 先頭）。外接円から cut 以上離れていれば 99 */
  nearest(x, z, cut = 2) {
    const b = this.bounds;
    if (Math.hypot(x - b.x, z - b.z) > b.r + cut) return 99;
    const e = this.leader;
    let best = Math.hypot(x - e.pos.x, z - e.pos.z);
    this.hit = 0;
    for (let i = 0; i < this.members.length; i++) {
      const p = this.members[i].pos;
      const d = Math.hypot(x - p.x, z - p.z);
      if (d < best) {
        best = d;
        this.hit = i + 1;
      }
    }
    return best;
  }

  /** 人数（プレイヤーは数えない） */
  count() {
    return 1 + this.members.length;
  }

  /** 先頭が自分の列の3人目以降に近づいたか（絡まる） */
  selfHit(r) {
    const e = this.leader.pos;
    for (let i = 1; i < this.members.length; i++) {
      const p = this.members[i].pos;
      if (Math.hypot(p.x - e.x, p.z - e.z) < r) return true;
    }
    return false;
  }

  /** p を各体から r まで押し出す（壁との判定は呼び出し側） */
  pushOut(p, r) {
    pushAway(p, this.leader.pos, r);
    for (const m of this.members) pushAway(p, m.pos, r);
  }

  memberSay(text) {
    if (!this.members.length) {
      this.leader.say(text, '', 1.3);
      return;
    }
    this.game.ui.bubble(this.members[Math.floor(Math.random() * this.members.length)], text, this.leader.cfg.bubble, 1.3);
  }

  /** 追ってきた人を最後尾に巻き込む */
  absorb(e) {
    if (this.members.length >= MAXM) return false;
    e.set('inline');
    e.inlineT = this.leader.tune.absorbT;
    e.inLine = this;
    e.vel.x = e.vel.z = 0;
    e.wantsCatch = false;
    e.ring?.update(e.pos.x, e.pos.z, 0);
    if (e.cone) e.cone.visible = false;
    e.char.setMood('surprised');
    this.members.push({ char: e.char, pos: e.pos, enemy: e });
    const A = this.leader.cfg.absorb;
    this.leader.say(pick(Math.random, A.leader), '', 1.6);
    e.say(pick(Math.random, A.member), '', 1.6);
    this.game.onAbsorb(e);
    return true;
  }

  /** 列から抜ける（i はメンバーの番号） */
  release(i) {
    const e = this.members[i].enemy;
    this.members.splice(i, 1);
    e.inLine = null;
    e.recover();
    if (e.patrol) e.pi = e.nearestWaypoint();
    e.cool = this.leader.tune.absorbCool;
    e.say('…あれ、なんで並んでたんだ？', '', 1.8);
  }

  dispose() {
    for (const m of this.own) {
      m.char.root.removeFromParent();
      for (const x of m.char.meshes) x.geometry.dispose();
    }
    for (const m of this.members) if (m.enemy) m.enemy.inLine = null;
    this.rings.removeFromParent();
    this.rings.dispose();
    this.ringMat.dispose();
    this.badge.removeFromParent();
    this.badgeMat.dispose();
  }
}
