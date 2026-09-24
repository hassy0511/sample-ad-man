import * as THREE from 'three';
import { Character } from './characters.js';
import { Ghosts } from './effects.js';
import { PLAYER_LOOK } from './cast.js';
import { damp } from './util.js';

const ITEM_PROPS = {
  folder: { left: 'folder' },
  wallet: { right: 'wallet' },
  bag: { left: 'bag', right: 'penlight' },
};

export const DASH_TIME = 0.2;
export const DASH_SPEED = 13.5;
export const DASH_COOLDOWN = 0.95;

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
    this.facing = new THREE.Vector2(0, -1);

    this.stack = new THREE.Group();
    this.stack.position.set(0, 0.62, 0);
    this.char.head.add(this.stack);
    this.stackMat = new THREE.MeshStandardMaterial({ color: '#fbfbf7', roughness: 0.65 });
    this.stackGeo = new THREE.BoxGeometry(0.34, 0.05, 0.42);

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
    return paper * this.aura * (this.slowT > 0 ? 0.55 : 1);
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
    this.invulnT = Math.max(this.invulnT, 0.12);
    this.ghostT = 0;
    this.game.fx.dust(this.pos.x, this.pos.z, 8, '#f1f4f8', 1.2);
    this.game.audio.dash();
  }

  update(dt, input) {
    const c = this.char;
    this.dashCD = Math.max(0, this.dashCD - dt);
    this.invulnT = Math.max(0, this.invulnT - dt);
    this.slowT = Math.max(0, this.slowT - dt);

    if (this.frozen) {
      this.vel.set(0, 0);
      c.speed = 0;
    } else {
      const mv = input.move;
      const mlen = Math.hypot(mv.x, mv.y);
      if (mlen > 0.1) this.facing.set(mv.x / mlen, mv.y / mlen);
      if (input.takeDash() && this.dashReady) this.startDash(mlen > 0.1 ? new THREE.Vector2(mv.x, mv.y) : this.facing);

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
        const lam = mlen > 0.1 ? 14 : 18;
        this.vel.x = damp(this.vel.x, tx, lam, dt);
        this.vel.y = damp(this.vel.y, tz, lam, dt);
      }
    }

    if (!this.frozen) {
      this.pos.x += this.vel.x * dt;
      this.pos.z += this.vel.y * dt;
      this.game.world.grid.resolveCircle(this.pos, this.r);
    }
    c.root.position.set(this.pos.x, 0, this.pos.z);
    const spd = Math.hypot(this.vel.x, this.vel.y);
    c.speed = this.dashT > 0 ? 0 : spd;
    if (spd > 0.3) c.faceDir(this.vel.x, this.vel.y);
    if (!this.frozen) c.pose = 'idle';
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
    this.ringMat.color.set(ready ? '#8fd3ff' : '#9aa3b2');
    this.ringMat.opacity = ready ? 0.8 : 0.35;
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

