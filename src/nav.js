import { WALKABLE, SIGHT_BLOCK } from './levels.js';

const DIRS8 = [
  [1, 0], [-1, 0], [0, 1], [0, -1],
  [1, 1], [1, -1], [-1, 1], [-1, -1],
];

/** タイルマップの当たり判定・視線・経路探索 */
export class Grid {
  constructor(map) {
    this.map = map;
    this.h = map.length;
    this.w = map[0].length;
    const n = this.w * this.h;
    this.walk = new Uint8Array(n);
    this.sight = new Uint8Array(n);
    for (let y = 0; y < this.h; y++) {
      for (let x = 0; x < this.w; x++) {
        const c = map[y][x];
        this.walk[y * this.w + x] = WALKABLE.has(c) ? 1 : 0;
        this.sight[y * this.w + x] = SIGHT_BLOCK.has(c) ? 1 : 0;
      }
    }
    this.fields = new Map();
  }

  at(x, y) {
    if (x < 0 || y < 0 || x >= this.w || y >= this.h) return '#';
    return this.map[y][x];
  }
  isWalk(x, y) {
    return x >= 0 && y >= 0 && x < this.w && y < this.h && this.walk[y * this.w + x] === 1;
  }
  blocksSight(x, y) {
    return x < 0 || y < 0 || x >= this.w || y >= this.h || this.sight[y * this.w + x] === 1;
  }
  isWalkWorld(x, z) {
    return this.isWalk(Math.floor(x), Math.floor(z));
  }

  /** (tx,ty) からの歩行距離マップ（4近傍BFS）。キャッシュする */
  field(tx, ty) {
    const key = ty * this.w + tx;
    let f = this.fields.get(key);
    if (f) return f;
    f = new Int16Array(this.w * this.h).fill(-1);
    if (!this.isWalk(tx, ty)) return f;
    const q = new Int32Array(this.w * this.h);
    let head = 0;
    let tail = 0;
    q[tail++] = key;
    f[key] = 0;
    while (head < tail) {
      const i = q[head++];
      const x = i % this.w;
      const y = (i / this.w) | 0;
      for (let d = 0; d < 4; d++) {
        const nx = x + DIRS8[d][0];
        const ny = y + DIRS8[d][1];
        if (!this.isWalk(nx, ny)) continue;
        const j = ny * this.w + nx;
        if (f[j] !== -1) continue;
        f[j] = f[i] + 1;
        q[tail++] = j;
      }
    }
    if (this.fields.size > 64) this.fields.clear();
    this.fields.set(key, f);
    return f;
  }

  /** 距離マップを下る方向（ワールド座標の単位ベクトル）。到達済みなら null */
  flowDir(field, x, z, out) {
    const tx = Math.floor(x);
    const ty = Math.floor(z);
    const here = this.isWalk(tx, ty) ? field[ty * this.w + tx] : 9999;
    let best = here < 0 ? 9999 : here;
    let bx = -1;
    let by = -1;
    for (let d = 0; d < 8; d++) {
      const dx = DIRS8[d][0];
      const dy = DIRS8[d][1];
      const nx = tx + dx;
      const ny = ty + dy;
      if (!this.isWalk(nx, ny)) continue;
      if (dx !== 0 && dy !== 0 && (!this.isWalk(tx + dx, ty) || !this.isWalk(tx, ty + dy))) continue;
      const v = field[ny * this.w + nx];
      if (v < 0) continue;
      // 斜めはわずかに優先（なめらかに曲がる）
      const score = v - (dx !== 0 && dy !== 0 ? 0.4 : 0);
      if (score < best) {
        best = score;
        bx = nx;
        by = ny;
      }
    }
    if (bx < 0) {
      if (here === 0 || !this.isWalk(tx, ty)) {
        // タイル中央へ寄せる
        out.x = tx + 0.5 - x;
        out.z = ty + 0.5 - z;
        const l = Math.hypot(out.x, out.z);
        if (l < 0.05) return null;
        out.x /= l;
        out.z /= l;
        return out;
      }
      return null;
    }
    out.x = bx + 0.5 - x;
    out.z = by + 0.5 - z;
    const l = Math.hypot(out.x, out.z) || 1;
    out.x /= l;
    out.z /= l;
    return out;
  }

  /** グリッド上の線分走査（Amanatides & Woo）。cb が true を返したら打ち切り */
  traverse(ax, az, bx, bz, cb) {
    let x = Math.floor(ax);
    let y = Math.floor(az);
    const ex = Math.floor(bx);
    const ey = Math.floor(bz);
    const dx = bx - ax;
    const dz = bz - az;
    const sx = dx > 0 ? 1 : -1;
    const sy = dz > 0 ? 1 : -1;
    const tdx = dx !== 0 ? Math.abs(1 / dx) : Infinity;
    const tdy = dz !== 0 ? Math.abs(1 / dz) : Infinity;
    let tmx = dx !== 0 ? (dx > 0 ? x + 1 - ax : ax - x) * tdx : Infinity;
    let tmy = dz !== 0 ? (dz > 0 ? y + 1 - az : az - y) * tdy : Infinity;
    let t = 0;
    for (let i = 0; i < 256; i++) {
      if (cb(x, y, t)) return true;
      if (x === ex && y === ey) return false;
      if (tmx < tmy) {
        t = tmx;
        tmx += tdx;
        x += sx;
      } else {
        t = tmy;
        tmy += tdy;
        y += sy;
      }
      if (t > 1) return false;
    }
    return false;
  }

  los(ax, az, bx, bz) {
    return !this.traverse(ax, az, bx, bz, (x, y) => this.blocksSight(x, y));
  }

  /** 半径 r の円が a→b を真っすぐ移動できるか */
  clearPath(ax, az, bx, bz, r = 0.3) {
    const len = Math.hypot(bx - ax, bz - az);
    const n = Math.max(1, Math.ceil(len / 0.3));
    for (let i = 0; i <= n; i++) {
      const t = i / n;
      const x = ax + (bx - ax) * t;
      const z = az + (bz - az) * t;
      if (!this.isWalkWorld(x - r, z - r) || !this.isWalkWorld(x + r, z - r) ||
          !this.isWalkWorld(x - r, z + r) || !this.isWalkWorld(x + r, z + r)) return false;
    }
    return true;
  }

  /** 視線レイの到達距離（視界コーン描画用） */
  sightDistance(ax, az, dirX, dirZ, max) {
    let hit = max;
    this.traverse(ax, az, ax + dirX * max, az + dirZ * max, (x, y, t) => {
      if (this.blocksSight(x, y)) {
        hit = Math.max(0.2, t * max);
        return true;
      }
      return false;
    });
    return hit;
  }

  /** 円をブロックタイルの外へ押し出す */
  resolveCircle(p, r) {
    for (let iter = 0; iter < 2; iter++) {
      const minX = Math.floor(p.x - r);
      const maxX = Math.floor(p.x + r);
      const minY = Math.floor(p.z - r);
      const maxY = Math.floor(p.z + r);
      for (let ty = minY; ty <= maxY; ty++) {
        for (let tx = minX; tx <= maxX; tx++) {
          if (this.isWalk(tx, ty)) continue;
          const cx = Math.max(tx, Math.min(p.x, tx + 1));
          const cz = Math.max(ty, Math.min(p.z, ty + 1));
          let dx = p.x - cx;
          let dz = p.z - cz;
          const d2 = dx * dx + dz * dz;
          if (d2 >= r * r) continue;
          if (d2 > 1e-9) {
            const d = Math.sqrt(d2);
            p.x += (dx / d) * (r - d);
            p.z += (dz / d) * (r - d);
          } else {
            // 中心がタイル内：最短の辺から押し出す
            const l = p.x - tx;
            const rr = tx + 1 - p.x;
            const u = p.z - ty;
            const dd = ty + 1 - p.z;
            const m = Math.min(l, rr, u, dd);
            if (m === l) p.x = tx - r;
            else if (m === rr) p.x = tx + 1 + r;
            else if (m === u) p.z = ty - r;
            else p.z = ty + 1 + r;
          }
        }
      }
    }
    return p;
  }
}
