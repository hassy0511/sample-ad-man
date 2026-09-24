import * as THREE from 'three';
import { Character } from './characters.js';
import { ALLY } from './cast.js';
import { damp, pick } from './util.js';

/** 味方のエース新人。見つけるとついてきて、一度だけ身代わりになる */
export class Ally {
  constructor(game, spawn) {
    this.game = game;
    this.cfg = ALLY;
    this.char = new Character(ALLY.look, { outline: true });
    this.pos = new THREE.Vector3(spawn.x, 0, spawn.z);
    this.vel = { x: 0, z: 0 };
    this.state = 'wait';
    this.t = 0;
    this.lineT = 1.5;
    this.char.root.position.copy(this.pos);
    game.scene.add(this.char.root);

    this.ringMat = new THREE.MeshBasicMaterial({ color: '#2fb3c9', transparent: true, opacity: 0.7, depthWrite: false });
    this.ring = new THREE.Mesh(new THREE.RingGeometry(0.5, 0.62, 40), this.ringMat);
    this.ring.rotation.x = -Math.PI / 2;
    this.ring.position.set(spawn.x, 0.04, spawn.z);
    game.scene.add(this.ring);
  }

  get player() {
    return this.game.player;
  }

  say(text, dur = 1.8) {
    this.game.ui.bubble(this, text, 'ally', dur);
  }

  join() {
    this.state = 'follow';
    this.ring.visible = false;
    this.say(pick(Math.random, ALLY.join), 2);
    this.char.play('jump');
    this.char.setMood('happy');
    this.game.onAllyJoin(this);
  }

  /** 敵と主人公の間に割って入り、代わりに話を聞く */
  intercept(e) {
    const P = this.player;
    const dx = P.pos.x - e.pos.x;
    const dz = P.pos.z - e.pos.z;
    const d = Math.hypot(dx, dz) || 1;
    const x = e.pos.x + (dx / d) * 0.9;
    const z = e.pos.z + (dz / d) * 0.9;
    if (this.game.world.grid.isWalkWorld(x, z)) this.pos.set(x, 0, z);
    this.state = 'busy';
    this.t = 0;
    this.char.faceDir(e.pos.x - this.pos.x, e.pos.z - this.pos.z);
    this.char.setMood('normal');
    this.say(pick(Math.random, ALLY.intercept), 2.2);
    e.hold(7, this.pos);
    setTimeout(() => e.say(pick(Math.random, ALLY.reaction), '', 2), 700);
    this.game.fx.dust(this.pos.x, this.pos.z, 8, '#dff6fb', 1);
  }

  update(dt) {
    const c = this.char;
    const P = this.player;
    this.t += dt;
    let speed = 0;
    if (this.state === 'wait') {
      const d = Math.hypot(P.pos.x - this.pos.x, P.pos.z - this.pos.z);
      if (d < 7) c.faceDir(P.pos.x - this.pos.x, P.pos.z - this.pos.z);
      this.lineT -= dt;
      if (d < 7 && this.lineT < 0 && this.game.state === 'play') {
        this.lineT = 3.5;
        this.say(pick(Math.random, ALLY.waiting), 1.6);
      }
      this.ringMat.opacity = 0.45 + Math.sin(this.t * 4) * 0.25;
      c.pose = d < 7 ? 'cheer' : 'idle';
      if (d < 0.9 && this.game.state === 'play') this.join();
    } else if (this.state === 'follow') {
      // 主人公の少し後ろをついていく
      const fx = P.facing.x;
      const fz = P.facing.y;
      let tx = P.pos.x - fx * 1.1;
      let tz = P.pos.z - fz * 1.1;
      if (!this.game.world.grid.isWalkWorld(tx, tz)) {
        tx = P.pos.x;
        tz = P.pos.z;
      }
      const dx = tx - this.pos.x;
      const dz = tz - this.pos.z;
      const d = Math.hypot(dx, dz);
      if (d > 6) {
        // はぐれたら追いつく
        this.pos.set(tx, 0, tz);
      } else if (d > 0.15) {
        speed = Math.min(7.5, d * 4.5);
        this.vel.x = damp(this.vel.x, (dx / d) * speed, 12, dt);
        this.vel.z = damp(this.vel.z, (dz / d) * speed, 12, dt);
      } else {
        this.vel.x = damp(this.vel.x, 0, 12, dt);
        this.vel.z = damp(this.vel.z, 0, 12, dt);
      }
      this.pos.x += this.vel.x * dt;
      this.pos.z += this.vel.z * dt;
      this.game.world.grid.resolveCircle(this.pos, 0.28);
      c.pose = 'idle';
    } else if (this.state === 'busy') {
      c.pose = 'listen';
      if (this.t > 7) {
        this.state = 'done';
        c.setMood('happy');
        this.say('先輩、いってらっしゃい！', 1.8);
      }
    } else {
      c.pose = 'idle';
    }
    const spd = Math.hypot(this.vel.x, this.vel.z);
    c.speed = this.state === 'follow' ? spd : 0;
    if (this.state === 'follow' && spd > 0.3) c.faceDir(this.vel.x, this.vel.z);
    c.root.position.set(this.pos.x, 0, this.pos.z);
    c.update(dt);
  }

  dispose() {
    this.char.root.removeFromParent();
    for (const m of this.char.meshes) m.geometry.dispose();
    this.ring.removeFromParent();
    this.ring.geometry.dispose();
    this.ringMat.dispose();
  }
}
