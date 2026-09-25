import * as THREE from 'three';
import { GeoBatch, M, damp } from './util.js';

// キャリーケースの音（半径は m）。調整はここだけで済むようにまとめる
export const NOISE = { step: 1.4, walk: 2.6, dashLoud: 6.0, dashQuiet: 3.0, voice: 3.0, voiceEvery: 0.8 };
// ケースがガラガラ鳴る床（石・板張り・歩道・横断歩道）。じゅうたんは静か
export const LOUD = new Set([':', ',', '_', 'z']);

const RING_STYLE = {
  walk: { color: new THREE.Color('#ff9f1c'), opacity: 0.35, dur: 0.45 },
  dash: { color: new THREE.Color('#ff7a00'), opacity: 0.75, dur: 0.7 },
  voice: { color: new THREE.Color('#a05fb5'), opacity: 0.5, dur: 0.6 },
};
const RING_POOL = 6;
const MELODY_TEXT = '♪ 発車メロディ ♪　いまなら音がかき消される';

/**
 * 主人公のうしろをついてくるキャリーケース。うるさい床を歩く・ダッシュすると音を出し、
 * 音の輪に入った人が振り向く（game.noise）。発車メロディの間は音がかき消される。
 */
export class Suitcase {
  constructor(game) {
    this.game = game;
    this.carrier = null; // null なら主人公。エース新人が持つと無音になる
    this.stepAcc = 0;
    this.voiceT = 0;
    this.mt = 0;
    this.melodyOn = false;

    const b = new GeoBatch();
    const box = new THREE.BoxGeometry(1, 1, 1);
    const wheel = new THREE.CylinderGeometry(0.035, 0.035, 0.03, 10);
    const rod = new THREE.CylinderGeometry(0.011, 0.011, 0.34, 6);
    b.add(box, '#f08a24', M(0, 0.32, 0, 0, 0, 0, 0.36, 0.5, 0.22));
    b.add(box, '#d9731a', M(0, 0.32, 0, 0, 0, 0, 0.37, 0.03, 0.23));
    for (const sx of [-0.09, 0.09]) b.add(box, '#1b2340', M(sx, 0.32, 0, 0, 0, 0, 0.04, 0.51, 0.235));
    for (const sx of [-0.14, 0.14]) {
      for (const sz of [-0.08, 0.08]) b.add(wheel, '#2a2a2e', M(sx, 0.035, sz, 0, 0, Math.PI / 2));
      b.add(rod, '#8a919c', M(sx * 0.6, 0.72, 0.09));
    }
    b.add(box, '#1b2340', M(0, 0.89, 0.09, 0, 0, 0, 0.2, 0.035, 0.04));
    for (const g of [box, wheel, rod]) g.dispose();
    this.mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.45 });
    this.mesh = new THREE.Mesh(b.build(), this.mat);
    this.mesh.castShadow = true;
    this.group = new THREE.Group();
    this.group.add(this.mesh);
    game.scene.add(this.group);
    const P = game.player;
    this.pos = new THREE.Vector3(P.pos.x - P.facing.x * 0.7, 0, P.pos.z - P.facing.y * 0.7);
    if (!game.world.grid.isWalkWorld(this.pos.x, this.pos.z)) this.pos.copy(P.pos);
    this.group.position.copy(this.pos);

    // 音の輪（プール。ジオメトリは共有）
    this.ringGeo = new THREE.RingGeometry(0.9, 1, 48);
    this.rings = [];
    for (let i = 0; i < RING_POOL; i++) {
      const m = new THREE.Mesh(this.ringGeo, new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false, side: THREE.DoubleSide }));
      m.rotation.x = -Math.PI / 2;
      m.renderOrder = 3;
      m.visible = false;
      game.scene.add(m);
      this.rings.push({ m, age: 0, dur: 1, r: 1, op: 0 });
    }
  }

  floorAt(x, z) {
    const w = this.game.world;
    return w.floorType[Math.floor(z) * w.W + Math.floor(x)];
  }

  get muted() {
    const P = this.game.player;
    return this.melodyOn || this.carrier?.state === 'follow' || P.frozen || P.slipT > 0;
  }

  ring(x, z, r, src) {
    const st = RING_STYLE[src] || RING_STYLE.walk;
    let it = this.rings[0];
    for (const o of this.rings) {
      if (!o.m.visible) {
        it = o;
        break;
      }
      if (o.age > it.age) it = o;
    }
    Object.assign(it, { age: 0, dur: st.dur, r, op: st.opacity });
    it.m.material.color.copy(st.color);
    it.m.material.opacity = st.opacity;
    it.m.position.set(x, 0.05, z);
    it.m.scale.setScalar(0.15);
    it.m.visible = true;
  }

  /** ダッシュの瞬間（うるさい床なら大きな音） */
  onDash() {
    const g = this.game;
    const P = g.player;
    if (g.state !== 'play' || this.muted || g.belts?.isBelt(P.pos.x, P.pos.z)) return;
    const loud = LOUD.has(this.floorAt(P.pos.x, P.pos.z));
    g.noise(P.pos.x, P.pos.z, loud ? NOISE.dashLoud : NOISE.dashQuiet, 'dash');
    g.audio.rattle(true);
    if (loud) g.ui.float(P.pos.x, 2.5, P.pos.z, 'ガラガラッ！', 'minus');
  }

  updateMelody(dt) {
    const m = this.game.stage.melody;
    if (!m) return;
    this.mt += dt;
    const k = this.mt - m.first;
    const on = k >= 0 && k % m.every < m.dur;
    if (on === this.melodyOn) return;
    this.melodyOn = on;
    this.game.ui.banner(on ? MELODY_TEXT : null);
    if (on) this.game.audio.melody(m.dur);
  }

  /** 会話・一時停止に入ったら、メロディの無音時間はそこで打ち切る（曲は待たずに鳴り終わるため） */
  endMelody() {
    const m = this.game.stage.melody;
    this.mt = m.first + Math.floor((this.mt - m.first) / m.every) * m.every + m.dur;
    this.melodyOn = false;
    this.game.ui.banner(null);
  }

  update(dt) {
    const g = this.game;
    const P = g.player;
    if (!P) return;
    this.follow(dt);
    if (g.state !== 'play' && this.melodyOn) this.endMelody();
    if (g.state === 'play') {
      this.updateMelody(dt);
      // 歩きの音：自分の足で 1.4m 進むたび（歩道に運ばれた分は数えない）
      if (!this.muted && !P.dashing && !g.belts?.isBelt(P.pos.x, P.pos.z)) {
        this.stepAcc += Math.hypot(P.vel.x, P.vel.y) * dt;
        if (this.stepAcc >= NOISE.step) {
          this.stepAcc = 0;
          if (LOUD.has(this.floorAt(P.pos.x, P.pos.z))) {
            g.noise(P.pos.x, P.pos.z, NOISE.walk, 'walk');
            g.audio.rattle(false);
          }
        }
      }
      // 電話中のふりの声（本田さんだけが聞きつける）
      if (P.phoneT > 0 && !this.melodyOn) {
        this.voiceT -= dt;
        if (this.voiceT <= 0) {
          this.voiceT = NOISE.voiceEvery;
          g.noise(P.pos.x, P.pos.z, NOISE.voice, 'voice');
        }
      } else {
        this.voiceT = 0;
      }
    }
    for (const r of this.rings) {
      if (!r.m.visible) continue;
      r.age += dt;
      const k = r.age / r.dur;
      if (k >= 1) {
        r.m.visible = false;
        continue;
      }
      r.m.scale.setScalar(0.15 + (1 - (1 - k) ** 3) * (r.r - 0.15));
      r.m.material.opacity = r.op * (1 - k * k);
    }
  }

  /** 持ち主のうしろについていく */
  follow(dt) {
    const c = this.carrier || this.game.player;
    const grid = this.game.world.grid;
    const back = this.carrier ? 0.5 : 0.7;
    let tx = c.pos.x - Math.sin(c.char.yaw) * back;
    let tz = c.pos.z - Math.cos(c.char.yaw) * back;
    if (!grid.isWalkWorld(tx, tz)) {
      tx = c.pos.x;
      tz = c.pos.z;
    }
    const p = this.pos;
    const ox = p.x;
    const oz = p.z;
    if (Math.hypot(tx - p.x, tz - p.z) > 4) p.set(tx, 0, tz);
    p.x = damp(p.x, tx, 10, dt);
    p.z = damp(p.z, tz, 10, dt);
    grid.resolveCircle(p, 0.18);
    const spd = dt > 0 ? Math.hypot(p.x - ox, p.z - oz) / dt : 0;
    const dx = c.pos.x - p.x;
    const dz = c.pos.z - p.z;
    if (Math.abs(dx) + Math.abs(dz) > 0.05) this.group.rotation.y = Math.atan2(dx, dz);
    this.mesh.rotation.x = damp(this.mesh.rotation.x, spd > 0.4 ? 0.35 : 0, 10, dt);
    this.group.position.copy(p);
  }

  dispose() {
    this.group.removeFromParent();
    this.mesh.geometry.dispose();
    this.mat.dispose();
    for (const r of this.rings) {
      r.m.removeFromParent();
      r.m.material.dispose();
    }
    this.ringGeo.dispose();
  }
}
