import * as THREE from 'three';
import { Character } from './characters.js';
import { Ghosts } from './effects.js';
import { PLAYER_LOOK } from './cast.js';
import { damp } from './util.js';
import { ITEMS, BAG_SIZE, openUmbrella } from './items.js';

const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];

const ITEM_PROPS = {
  folder: { left: 'folder' },
  wallet: { right: 'wallet' },
  bag: { left: 'bag', right: 'penlight' },
  trip: { left: 'bag' }, // 右手はキャリーケースの持ち手
  bouquet: { left: 'bouquet' },
};

export const DASH_TIME = 0.2;
export const DASH_SPEED = 13.5;
export const DASH_COOLDOWN = 0.95;
export const PHONE_TIME = 3.5;
export const PHONE_COOLDOWN = 4;
export const PHONE_USES = 2;
export const BOOST_TIME = 6;
const _slot = { x: 0, z: 0 };

export class Player {
  constructor(game, item) {
    this.game = game;
    this.char = new Character({ ...PLAYER_LOOK, prop: ITEM_PROPS[item] || {} }, { outline: true });
    this.pos = new THREE.Vector3();
    this.vel = new THREE.Vector2();
    this.r = 0.3;
    this.baseSpeed = 4.6;
    this.papers = 0;
    this.totalPapers = 0;
    this.dashT = 0;
    this.dashCD = 0;
    this.dashDir = new THREE.Vector2(0, 1);
    this.ghostT = 0;
    this.invulnT = 0;
    this.slowT = 0;
    this.aura = 1;
    this.frozen = false;
    this.phoneT = 0;
    this.phoneCD = 0;
    this.phoneLeft = PHONE_USES;
    this.items = [];
    this.energyT = 0;
    this.umbrellaT = 0;
    this.boostT = 0;
    this.slipT = 0;
    this.noiseT = 0;
    this.onWet = false;
    this.bowing = false;
    this.attached = null; // 行列につながっている間 { line, mode: 'ride' | 'drag', presses, t }
    this.dashN = 0; // ダッシュした回数（行列のスルッ！を1回だけ数える）
    this.facing = new THREE.Vector2(0, -1);

    this.stack = new THREE.Group();
    this.stack.position.set(0, 0.62, 0);
    this.char.head.add(this.stack);
    this.stackMat = new THREE.MeshStandardMaterial({ color: '#fbfbf7', roughness: 0.65 });
    this.stackGeo = new THREE.BoxGeometry(0.34, 0.05, 0.42);
    this.phoneMesh = new THREE.Mesh(new THREE.BoxGeometry(0.065, 0.13, 0.018), new THREE.MeshStandardMaterial({ color: '#1b1d22', roughness: 0.3 }));
    this.phoneMesh.position.set(0, -0.36, 0.05);
    this.phoneMesh.visible = false;
    this.char.armR.add(this.phoneMesh);
    this.umbrella = openUmbrella();
    this.umbrella.position.set(0, 1.75, 0);
    this.umbrella.visible = false;
    this.char.root.add(this.umbrella);

    // 足元のリング（壁の陰でも見える）
    this.ringMat = new THREE.MeshBasicMaterial({ color: '#8fd3ff', transparent: true, opacity: 0.75, depthTest: false, depthWrite: false });
    this.ring = new THREE.Mesh(new THREE.RingGeometry(0.36, 0.44, 40), this.ringMat);
    this.ring.rotation.x = -Math.PI / 2;
    this.ring.renderOrder = 999;
    this.dot = new THREE.Mesh(new THREE.CircleGeometry(0.1, 16), this.ringMat);
    this.dot.rotation.x = -Math.PI / 2;
    this.dot.renderOrder = 999;
    game.scene.add(this.char.root, this.ring, this.dot);
    this.ghosts = new Ghosts(game.scene, this.char);
    this.char.turnRate = 16;
  }

  place(x, z, yaw = Math.PI) {
    this.pos.set(x, 0, z);
    this.vel.set(0, 0);
    this.char.root.position.set(x, 0, z);
    this.char.setYaw(yaw);
    this.facing.set(Math.sin(yaw), Math.cos(yaw));
  }

  get dashing() {
    return this.dashT > 0;
  }
  get invulnerable() {
    return this.invulnT > 0 || this.dashT > 0;
  }
  get dashReady() {
    return this.dashCD <= 0;
  }

  speedFactor() {
    const paper = Math.max(0.5, 1 - this.papers * 0.085);
    return paper * this.aura * (this.slowT > 0 ? 0.55 : 1) * (this.boostT > 0 ? 1.3 : 1) * (this.phoneT > 0 ? 0.8 : 1) * (this.energyT > 0 ? 1.35 : 1) * (this.umbrellaT > 0 ? 0.85 : 1);
  }

  addPapers(n) {
    for (let i = 0; i < n; i++) {
      this.papers++;
      this.totalPapers++;
      if (this.stack.children.length < 9) {
        const m = new THREE.Mesh(this.stackGeo, this.stackMat);
        const k = this.stack.children.length;
        m.position.set((Math.random() - 0.5) * 0.06, k * 0.055, (Math.random() - 0.5) * 0.06);
        m.rotation.y = (Math.random() - 0.5) * 0.6;
        m.castShadow = true;
        this.stack.add(m);
      }
    }
    this.char.play('stagger');
    this.slowT = 0.35;
  }

  clearPapers() {
    const n = this.papers;
    this.papers = 0;
    while (this.stack.children.length) this.stack.remove(this.stack.children[0]);
    return n;
  }

  startDash(dir) {
    this.dashDir.copy(dir).normalize();
    this.dashT = DASH_TIME;
    this.dashCD = DASH_COOLDOWN;
    this.dashN++;
    this.invulnT = Math.max(this.invulnT, 0.12);
    this.ghostT = 0;
    this.game.fx.dust(this.pos.x, this.pos.z, 8, '#f1f4f8', 1.2);
    this.game.audio.dash();
    this.game.onPlayerDash?.();
  }

  /** カバンに入れる。いっぱいなら false */
  addItem(id) {
    if (this.items.length >= BAG_SIZE) return false;
    this.items.push(id);
    return true;
  }

  hasItem(id) {
    return this.items.includes(id);
  }

  takeItem(id) {
    const i = this.items.indexOf(id);
    if (i < 0) return false;
    this.items.splice(i, 1);
    return true;
  }

  /** 使えるアイテムを先頭から1つ使う */
  useItem() {
    const id = this.items.find((k) => !ITEMS[k].passive);
    if (!id) {
      this.game.ui.float(this.pos.x, 2.3, this.pos.z, this.items.length ? `${ITEMS[this.items[0]].short}は持っているだけで効く` : 'カバンは空っぽ', 'info');
      return;
    }
    // 段ボールは置ける場所がなければ使わない
    if (id === 'box' && !this.game.placeBox()) return;
    this.takeItem(id);
    if (id === 'energy') {
      this.energyT = 8;
      this.dashCD = 0;
      this.game.ui.bubble(this, 'ゴクッ…！ みなぎってきた！', 'player', 1.6);
    } else if (id === 'umbrella') {
      this.umbrellaT = 5;
      this.game.ui.bubble(this, '（傘で顔を隠す）', 'player', 1.4);
    } else if (id === 'baramaki') {
      this.game.scatterGifts();
    } else if (id === 'karaoke') {
      this.game.dropLure(this.pos.x, this.pos.z);
    }
    this.game.audio.sparkle();
    this.game.onItemsChanged();
  }

  /** 濡れた床でダッシュして転ぶ */
  slip() {
    this.slipT = 0.95;
    this.dashT = 0;
    this.char.spin = 0;
    this.char.squash = 0;
    this.char.play('trip');
    this.char.setMood('dizzy');
    this.game.onPlayerSlip?.();
  }

  startPhone() {
    this.phoneLeft--;
    this.phoneT = PHONE_TIME;
    this.phoneCD = PHONE_COOLDOWN;
    this.game.audio.phone?.();
    this.game.ui.bubble(this, pick(['あ、もしもし！お世話になっております！', 'はい、はい、ただいま向かっております！', 'もしもし〜！はい、その件ですね！']), 'player', 2.2);
  }

  update(dt, input) {
    const c = this.char;
    this.dashCD = Math.max(0, this.dashCD - dt);
    this.invulnT = Math.max(0, this.invulnT - dt);
    this.slowT = Math.max(0, this.slowT - dt);
    this.phoneCD = Math.max(0, this.phoneCD - dt);
    if (!this.frozen) {
      this.energyT = Math.max(0, this.energyT - dt);
      this.umbrellaT = Math.max(0, this.umbrellaT - dt);
      if (this.energyT > 0) this.dashCD = Math.max(0, this.dashCD - dt * 2);
      this.phoneT = Math.max(0, this.phoneT - dt);
      this.boostT = Math.max(0, this.boostT - dt);
    }
    if (!this.frozen && !this.attached && input.takeItem?.()) this.useItem();
    if (!this.frozen && !this.attached && input.takePhone?.() && this.phoneCD <= 0 && this.phoneT <= 0) {
      if (this.phoneLeft > 0) this.startPhone();
      else {
        this.phoneCD = 1.5;
        this.game.ui.float(this.pos.x, 2.3, this.pos.z, 'もう電話のふりはできない', 'info');
      }
    }
    if ((this.boostT > 0 || this.energyT > 0) && !this.frozen && Math.hypot(this.vel.x, this.vel.y) > 2) {
      this.trailT = (this.trailT || 0) - dt;
      if (this.trailT <= 0) {
        this.trailT = 0.06;
        this.game.fx.dust(this.pos.x, this.pos.z, 1, '#ffd98a', 0.4);
      }
    }

    const wet = !this.frozen && !this.hasItem('shoecover') && !!this.game.weather?.isWet(this.pos.x, this.pos.z);
    this.onWet = wet;
    if (this.frozen) {
      this.vel.set(0, 0);
      c.speed = 0;
    } else if (this.attached) {
      // 行列の最後尾について歩く（ほかの敵・書類は受けない。電話とアイテムは使えない）
      const A = this.attached;
      A.t += dt;
      this.invulnT = Math.max(this.invulnT, 0.1);
      input.takePhone?.();
      input.takeItem?.();
      A.line.sample(A.line.members.length + 1, _slot);
      const px = this.pos.x;
      const pz = this.pos.z;
      this.pos.x = damp(px, _slot.x, 12, dt);
      this.pos.z = damp(pz, _slot.z, 12, dt);
      if (dt > 0) this.vel.set((this.pos.x - px) / dt, (this.pos.z - pz) / dt);
      if (input.takeDashPress()) this.game.onAttachedDash();
    } else if (this.slipT > 0) {
      // 転んで滑っていく
      this.slipT -= dt;
      this.vel.x = damp(this.vel.x, 0, 2.2, dt);
      this.vel.y = damp(this.vel.y, 0, 2.2, dt);
      input.takeDash();
      if (this.slipT <= 0) {
        c.pose = 'idle';
        c.setMood('normal');
      }
    } else {
      const mv = input.move;
      const mlen = Math.hypot(mv.x, mv.y);
      if (mlen > 0.1) this.facing.set(mv.x / mlen, mv.y / mlen);
      if (input.takeDash() && this.dashReady) this.startDash(mlen > 0.1 ? new THREE.Vector2(mv.x, mv.y) : this.facing);

      if (this.dashT > 0 && wet) this.slip();
      if (this.dashT > 0) {
        this.dashT -= dt;
        this.vel.set(this.dashDir.x * DASH_SPEED, this.dashDir.y * DASH_SPEED);
        this.ghostT -= dt;
        if (this.ghostT <= 0) {
          this.ghosts.spawn();
          this.ghostT = 0.035;
        }
        const k = 1 - Math.max(0, this.dashT) / DASH_TIME;
        c.spin = k * Math.PI * 2;
        c.squash = -0.12 * Math.sin(k * Math.PI);
        if (this.dashT <= 0) {
          c.spin = 0;
          c.squash = 0;
          this.vel.multiplyScalar(0.35);
        }
      } else {
        const sp = this.baseSpeed * this.speedFactor();
        const tx = mv.x * sp;
        const tz = mv.y * sp;
        // 濡れた床ではブレーキもハンドルも効きにくい
        const lam = wet ? 2.4 : mlen > 0.1 ? 14 : 18;
        this.vel.x = damp(this.vel.x, tx, lam, dt);
        this.vel.y = damp(this.vel.y, tz, lam, dt);
      }
    }

    if (!this.frozen && !this.attached) {
      this.pos.x += this.vel.x * dt;
      this.pos.z += this.vel.y * dt;
      // 動く歩道に運ばれる
      const bv = this.game.belts?.vx(this.pos.x, this.pos.z);
      if (bv) this.pos.x += bv * dt;
      this.game.world.grid.resolveCircle(this.pos, this.r);
    }
    c.root.position.set(this.pos.x, 0, this.pos.z);
    const spd = Math.hypot(this.vel.x, this.vel.y);
    c.speed = this.dashT > 0 || this.slipT > 0 ? 0 : spd;
    if (spd > 0.3) c.faceDir(this.vel.x, this.vel.y);
    if (this.slipT > 0) c.pose = 'down';
    else if (!this.frozen) c.pose = this.attached ? 'conga' : this.phoneT > 0 ? 'phone' : this.bowing && Math.hypot(this.vel.x, this.vel.y) < 0.9 ? 'bow' : 'idle';
    this.phoneMesh.visible = this.phoneT > 0;
    this.umbrella.visible = this.umbrellaT > 0;
    if (this.umbrella.visible) this.umbrella.rotation.y += dt * 1.5;
    c.sweat.visible = this.papers >= 4 || this.aura < 1;
    c.update(dt);

    // 頭上の書類がゆらゆら
    const wob = Math.min(0.25, spd * 0.02 + this.papers * 0.01);
    this.stack.rotation.z = Math.sin(c.t * 7) * wob * 0.5;
    this.stack.rotation.x = Math.cos(c.t * 5.3) * wob * 0.4;

    this.ghosts.update(dt);
    this.ring.visible = this.dot.visible = !this.frozen;
    this.ring.position.set(this.pos.x, 0.04, this.pos.z);
    this.dot.position.set(this.pos.x, 0.04, this.pos.z);
    const ready = this.dashReady;
    // キャリーケースが音を立てた瞬間はオレンジ
    this.noiseT = Math.max(0, this.noiseT - dt);
    this.ringMat.color.set(this.noiseT > 0 ? '#ff9f1c' : ready ? '#8fd3ff' : '#9aa3b2');
    this.ringMat.opacity = this.noiseT > 0 ? 0.9 : ready ? 0.8 : 0.35;
    this.ring.scale.setScalar(this.dashT > 0 ? 1.3 : 1);
    // 無敵中は点滅
    c.root.visible = this.frozen || !(this.invulnT > 0.12 && this.dashT <= 0 && Math.floor(this.invulnT * 16) % 2 === 0);
    this.aura = 1;
  }

  dispose() {
    this.char.root.removeFromParent();
    this.ring.removeFromParent();
    this.dot.removeFromParent();
    this.ghosts.dispose();
    this.ring.geometry.dispose();
    this.dot.geometry.dispose();
    this.ringMat.dispose();
    this.stackMat.dispose();
    this.stackGeo.dispose();
    for (const m of this.char.meshes) m.geometry.dispose();
  }
}

