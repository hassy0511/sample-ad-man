import * as THREE from 'three';
import { GeoBatch, M } from './util.js';
import { beltTexture } from './textures.js';

export const BELT_SPEED = 3.0;

/** 動く歩道（> 東向き、< 西向き）。乗っている人を流れの向きに運ぶ */
export class Belts {
  constructor(game) {
    const g = game.world.grid;
    this.w = g.w;
    this.h = g.h;
    this.dir = g.flow; // 向きは経路探索と共有する（東 +1 / 西 -1）
    this.tex = beltTexture();
    const batch = new GeoBatch({ uv: true });
    for (let y = 0; y < g.h; y++) {
      for (let x = 0; x < g.w; x++) {
        const c = g.at(x, y);
        if ((c !== '<' && c !== '>') || g.at(x - 1, y) === c) continue;
        // 横の連なりを1枚の板にする
        let len = 1;
        while (g.at(x + len, y) === c) len++;
        const plate = new THREE.PlaneGeometry(len, 0.94);
        const uv = plate.attributes.uv;
        for (let i = 0; i < uv.count; i++) uv.setX(i, c === '>' ? uv.getX(i) * len : len - uv.getX(i) * len);
        batch.add(plate, '#ffffff', M(x + len / 2, 0.035, y + 0.5, -Math.PI / 2));
        plate.dispose();
      }
    }
    this.mat = new THREE.MeshStandardMaterial({ map: this.tex, roughness: 0.55, metalness: 0.2 });
    this.mesh = new THREE.Mesh(batch.build(), this.mat);
    this.mesh.receiveShadow = true;
    game.world.group.add(this.mesh);
  }

  /** (x, z) での流れの速さ（東が正）。歩道の外は 0 */
  vx(x, z) {
    const tx = Math.floor(x);
    const tz = Math.floor(z);
    return tx < 0 || tz < 0 || tx >= this.w || tz >= this.h ? 0 : this.dir[tz * this.w + tx] * BELT_SPEED;
  }

  isBelt(x, z) {
    return this.vx(x, z) !== 0;
  }

  update(dt) {
    this.tex.offset.x = (this.tex.offset.x - dt * BELT_SPEED) % 1;
  }

  dispose() {
    this.mesh.removeFromParent();
    this.mesh.geometry.dispose();
    this.mat.dispose();
    this.tex.dispose();
  }
}
