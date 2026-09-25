import * as THREE from 'three';

const GREEN = 6;
const BLINK = 1.4;
const RED = 5;
const CYCLE = GREEN + BLINK + RED;
const CAR_COLORS = ['#e0402f', '#f2f2f2', '#2f6db5', '#1f1f24', '#ffd84d', '#6d737d', '#3aa56c'];

/**
 * 歩行者信号と車。横断歩道（z）は青信号のときだけ通れる。
 * 車は見た目だけ（青の間は横断歩道の手前で止まる）。
 */
export class Traffic {
  constructor(game) {
    this.game = game;
    const world = game.world;
    this.grid = world.grid;
    this.group = new THREE.Group();
    world.group.add(this.group);
    this.t = 0;
    this.walkable = true;
    this.clusters = [];
    this.cars = [];
    this.lanes = [];
    this.own = [];

    const g = this.grid;
    const seen = new Set();
    for (let y = 0; y < g.h; y++) {
      for (let x = 0; x < g.w; x++) {
        if (g.at(x, y) !== 'z' || seen.has(y * g.w + x)) continue;
        const tiles = [];
        const stack = [[x, y]];
        seen.add(y * g.w + x);
        while (stack.length) {
          const [px, py] = stack.pop();
          tiles.push([px, py]);
          for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
            const nx = px + dx;
            const ny = py + dy;
            if (g.at(nx, ny) === 'z' && !seen.has(ny * g.w + nx)) {
              seen.add(ny * g.w + nx);
              stack.push([nx, ny]);
            }
          }
        }
        const xs = tiles.map((t) => t[0]);
        const ys = tiles.map((t) => t[1]);
        this.clusters.push({ tiles, minX: Math.min(...xs), maxX: Math.max(...xs), minY: Math.min(...ys), maxY: Math.max(...ys) });
      }
    }

    // 赤信号のときに横断歩道を赤く見せる
    this.redMat = new THREE.MeshBasicMaterial({ color: '#ff3b2f', transparent: true, opacity: 0, depthWrite: false });
    this.lampMats = [];
    for (const c of this.clusters) {
      const w = c.maxX - c.minX + 1;
      const h = c.maxY - c.minY + 1;
      const plane = new THREE.Mesh(new THREE.PlaneGeometry(w, h), this.redMat);
      plane.rotation.x = -Math.PI / 2;
      plane.position.set(c.minX + w / 2, 0.03, c.minY + h / 2);
      this.group.add(plane);
      this.own.push(plane.geometry);
      // 両端に信号機
      for (const [sx, sz] of [[c.minX - 0.25, c.minY - 0.35], [c.maxX + 1.25, c.maxY + 1.35]]) this.signal(sx, sz);
    }

    // 車線：ほぼ全部が車道の行
    for (let y = 0; y < g.h; y++) {
      let n = 0;
      for (let x = 0; x < g.w; x++) if ('=z'.includes(g.at(x, y))) n++;
      if (n > g.w * 0.6) this.lanes.push({ z: y + 0.5, dir: this.lanes.length % 2 === 0 ? 1 : -1, next: Math.random() * 2 });
    }
  }

  signal(x, z) {
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.05, 2.2, 8), new THREE.MeshStandardMaterial({ color: '#6d737d', metalness: 0.5, roughness: 0.4 }));
    pole.position.set(x, 1.1, z);
    const head = new THREE.Mesh(new THREE.BoxGeometry(0.26, 0.5, 0.2), new THREE.MeshStandardMaterial({ color: '#2b2f36', roughness: 0.5 }));
    head.position.set(x, 2.05, z);
    const red = new THREE.MeshBasicMaterial({ color: '#3a1512' });
    const green = new THREE.MeshBasicMaterial({ color: '#0f2a1a' });
    const lampR = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.18, 0.04), red);
    const lampG = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.18, 0.04), green);
    lampR.position.set(x, 2.17, z + 0.11);
    lampG.position.set(x, 1.93, z + 0.11);
    pole.castShadow = head.castShadow = true;
    this.group.add(pole, head, lampR, lampG);
    this.own.push(pole.geometry, head.geometry, lampR.geometry, lampG.geometry, pole.material, head.material, red, green);
    this.lampMats.push({ red, green });
  }

  makeCar() {
    const g = new THREE.Group();
    const col = CAR_COLORS[Math.floor(Math.random() * CAR_COLORS.length)];
    const bodyMat = new THREE.MeshStandardMaterial({ color: col, roughness: 0.3, metalness: 0.3 });
    const body = new THREE.Mesh(new THREE.BoxGeometry(1.7, 0.42, 0.82), bodyMat);
    body.position.y = 0.36;
    const cabin = new THREE.Mesh(new THREE.BoxGeometry(0.95, 0.34, 0.74), new THREE.MeshStandardMaterial({ color: '#28323f', roughness: 0.15, metalness: 0.4 }));
    cabin.position.set(-0.1, 0.72, 0);
    g.add(body, cabin);
    for (const [wx, wz] of [[-0.55, 0.4], [0.55, 0.4], [-0.55, -0.4], [0.55, -0.4]]) {
      const w = new THREE.Mesh(new THREE.CylinderGeometry(0.17, 0.17, 0.12, 10), new THREE.MeshStandardMaterial({ color: '#1b1b1f' }));
      w.rotation.x = Math.PI / 2;
      w.position.set(wx, 0.17, wz);
      g.add(w);
    }
    g.traverse((o) => {
      if (o.isMesh) o.castShadow = true;
    });
    return g;
  }

  /** 横断歩道の通行可否を切り替える（歩いている人がいるマスは残す） */
  setWalkable(on) {
    this.walkable = on;
    const g = this.grid;
    const occupied = new Set();
    const mark = (p) => occupied.add(Math.floor(p.z) * g.w + Math.floor(p.x));
    if (this.game.player) mark(this.game.player.pos);
    for (const e of this.game.enemies) mark(e.pos);
    for (const c of this.clusters) {
      for (const [x, y] of c.tiles) {
        const i = y * g.w + x;
        g.walk[i] = on || occupied.has(i) ? 1 : 0;
      }
    }
    g.fields.clear();
    this.game.lastTile = -1;
  }

  get phase() {
    const k = this.t % CYCLE;
    if (k < GREEN) return 'green';
    if (k < GREEN + BLINK) return 'blink';
    return 'red';
  }

  update(dt, active) {
    if (active) this.t += dt;
    const ph = this.phase;
    const walk = ph !== 'red';
    if (walk !== this.walkable) this.setWalkable(walk);
    const on = Math.floor(this.t * 4) % 2 === 0;
    for (const m of this.lampMats) {
      m.green.color.set(ph === 'green' || (ph === 'blink' && on) ? '#3dff8a' : '#0f2a1a');
      m.red.color.set(ph === 'red' ? '#ff4b3a' : '#3a1512');
    }
    this.redMat.opacity = ph === 'red' ? 0.22 : ph === 'blink' && on ? 0.1 : 0;

    // 車
    const W = this.grid.w;
    for (const lane of this.lanes) {
      lane.next -= dt;
      if (lane.next <= 0 && ph === 'red') {
        lane.next = 1.6 + Math.random() * 1.8;
        const car = this.makeCar();
        const x = lane.dir > 0 ? -1.5 : W + 1.5;
        car.position.set(x, 0, lane.z);
        car.rotation.y = lane.dir > 0 ? 0 : Math.PI;
        this.group.add(car);
        this.cars.push({ g: car, lane, speed: 7 + Math.random() * 2, v: 0 });
      }
    }
    for (let i = this.cars.length - 1; i >= 0; i--) {
      const c = this.cars[i];
      const x = c.g.position.x;
      let stop = false;
      if (ph !== 'red') {
        // 横断歩道の手前で止まる（渡り始めていたら行ってしまう）
        for (const cl of this.clusters) {
          if (c.lane.z < cl.minY || c.lane.z > cl.maxY + 1) continue;
          const edge = c.lane.dir > 0 ? cl.minX - 1.1 : cl.maxX + 2.1;
          const ahead = (edge - x) * c.lane.dir;
          if (ahead > 0 && ahead < 1.2) stop = true;
        }
        for (const o of this.cars) {
          if (o === c || o.lane !== c.lane) continue;
          const gap = (o.g.position.x - x) * c.lane.dir;
          if (gap > 0 && gap < 2.1) stop = true;
        }
      }
      c.v += ((stop ? 0 : c.speed) - c.v) * Math.min(1, dt * (stop ? 8 : 2));
      c.g.position.x += c.v * c.lane.dir * dt;
      if (c.g.position.x < -3 || c.g.position.x > W + 3) {
        this.disposeCar(c.g);
        this.cars.splice(i, 1);
      }
    }
  }

  disposeCar(g) {
    g.removeFromParent();
    g.traverse((o) => {
      if (o.isMesh) {
        o.geometry.dispose();
        o.material.dispose();
      }
    });
  }

  dispose() {
    for (const c of this.cars) this.disposeCar(c.g);
    this.cars = [];
    for (const o of this.own) o.dispose();
    this.redMat.dispose();
    this.group.removeFromParent();
  }
}
