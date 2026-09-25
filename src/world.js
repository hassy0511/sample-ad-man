import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { GeoBatch, M, mulM, mulberry32, pick, textTexture, disposeTree, clamp } from './util.js';
import { Grid } from './nav.js';
import { Character, SHARED } from './characters.js';
import { ENEMY_CODES } from './levels.js';
import { ITEM_CODES } from './items.js';
import { WORKER_HAIR, HAIR_COLORS, SKINS, WORKER_TOPS } from './cast.js';
import {
  screenAtlas, SCREEN_CELLS, floorTexture, cityTexture, gradientBackground, vendingTexture,
  whiteboardTexture, posterTexture, clockTexture, beamTexture,
} from './textures.js';

export const LIGHTING = {
  morning: {
    exposure: 1.0, hemiSky: '#d8e8ff', hemiGround: '#b8a78f', hemi: 1.1,
    sun: '#fff0d8', sunI: 2.9, sunDir: [0.65, 1.0, 0.6],
    bgTop: '#9fc6e8', bgBottom: '#e9eff5', fog: '#dfe8f1', env: 0.4,
    cityTop: '#7fb9ea', cityMid: '#c6e2f6', cityBottom: '#eaf2f8', cloud: 'rgba(255,255,255,0.85)',
    far: '#b3c7da', mid: '#98adc3', near: '#7f95ad', windows: 0.05, windowColor: 'rgba(255,255,255,0.7)',
    sunDisc: null, bloom: 0.1, tint: [1.0, 1.0, 1.035], sat: 1.1, vignette: 0.32, screenBoost: 1.15,
  },
  noon: {
    exposure: 1.0, hemiSky: '#eef5ff', hemiGround: '#cbbfa8', hemi: 1.2,
    sun: '#fffaf0', sunI: 3.1, sunDir: [0.25, 1.0, 0.4],
    bgTop: '#86c1ee', bgBottom: '#f1f5f8', fog: '#e8eef4', env: 0.45,
    cityTop: '#62aee8', cityMid: '#bfe0f7', cityBottom: '#eff6fa', cloud: 'rgba(255,255,255,0.95)',
    far: '#b9cbdc', mid: '#9db2c8', near: '#8298b0', windows: 0.03, windowColor: 'rgba(255,255,255,0.6)',
    sunDisc: null, bloom: 0.1, tint: [1.02, 1.01, 1.0], sat: 1.1, vignette: 0.3, screenBoost: 1.1,
  },
  evening: {
    exposure: 1.05, hemiSky: '#b4a9e6', hemiGround: '#f0a46e', hemi: 1.2,
    sun: '#ffab62', sunI: 3.8, sunDir: [-0.95, 0.66, 0.4],
    bgTop: '#4f4a8f', bgBottom: '#f3a877', fog: '#d99a86', env: 0.3,
    cityTop: '#4b4d99', cityMid: '#e4889a', cityBottom: '#ffc28a', cloud: 'rgba(255,190,170,0.6)',
    far: '#7a6aa0', mid: '#5b4f84', near: '#3e3764', windows: 0.35, windowColor: '#ffd98a',
    sunDisc: [1500, 470, 60, 'rgba(255,170,110,0.9)'], bloom: 0.42, tint: [1.06, 0.98, 0.95], sat: 1.12, vignette: 0.38, screenBoost: 1.6,
  },
  afternoon: {
    exposure: 1.02, hemiSky: '#f3eadb', hemiGround: '#c9ab88', hemi: 1.15,
    sun: '#ffe2b0', sunI: 3.0, sunDir: [-0.5, 0.9, 0.55],
    bgTop: '#93bfe3', bgBottom: '#f5ecdf', fog: '#efe6d9', env: 0.4,
    cityTop: '#7fb4e2', cityMid: '#d8e4ee', cityBottom: '#f6eadb', cloud: 'rgba(255,250,240,0.9)',
    far: '#bcc7d3', mid: '#a3b0c0', near: '#8997aa', windows: 0.04, windowColor: 'rgba(255,255,255,0.6)',
    sunDisc: null, bloom: 0.14, tint: [1.04, 1.01, 0.97], sat: 1.1, vignette: 0.32, screenBoost: 1.15,
  },
  rain: {
    exposure: 0.9, hemiSky: '#c3cedb', hemiGround: '#7f838b', hemi: 1.15,
    sun: '#dfe7f2', sunI: 1.3, sunDir: [0.3, 1.0, 0.5],
    bgTop: '#6f7c8c', bgBottom: '#c3cad3', fog: '#b4bdc8', env: 0.5,
    cityTop: '#6c7988', cityMid: '#a2adba', cityBottom: '#c9d0d8', cloud: 'rgba(150,160,175,0.95)',
    far: '#8c98a6', mid: '#788596', near: '#647284', windows: 0.3, windowColor: '#ffe9b0',
    sunDisc: null, bloom: 0.16, tint: [0.97, 1.0, 1.05], sat: 0.9, vignette: 0.4, screenBoost: 1.45,
  },
  night: {
    exposure: 1.15, hemiSky: '#4a5a9a', hemiGround: '#2a2438', hemi: 0.75,
    sun: '#a9bcff', sunI: 1.1, sunDir: [0.35, 1.0, -0.25],
    bgTop: '#05080f', bgBottom: '#18203a', fog: '#121a30', env: 0.14,
    cityTop: '#03060e', cityMid: '#0d1530', cityBottom: '#1d2748', cloud: 'rgba(90,100,150,0.18)',
    far: '#141a33', mid: '#0e1328', near: '#090c1c', windows: 0.42, windowColor: '#ffd98a',
    sunDisc: [520, 150, 34, 'rgba(200,215,255,0.35)'], bloom: 0.62, tint: [0.96, 0.98, 1.08], sat: 1.05, vignette: 0.5, screenBoost: 2.3,
    playerLight: true,
  },
};

const PAL = {
  wall: '#f0eee9', wallCap: '#6f7888', base: '#8b909a', frame: '#4c525d', desk: '#eeece7', deskLeg: '#9aa1ab',
  pedestal: '#cdd1d7', monitor: '#262a31', keyboard: '#e2e5e9', cabinet: '#d4d8de', cabTop: '#9aa1ab', pillar: '#ebe9e4',
};
const PANEL_COLORS = ['#5d8aa8', '#e3a857', '#7fae9b', '#d9735b', '#8f84c2'];
const CHAIR_COLORS = ['#3a4150', '#2e3441', '#454b59'];
const BINDER_COLORS = ['#2f5d8a', '#c0392b', '#e8b82e', '#3f8f5f', '#f2f2f2', '#2b2b2b', '#7a5ea8', '#2f5d8a'];
const LEAF = ['#4e8f4f', '#6aa84f', '#3f7d4a', '#7fb069', '#5a9a52'];
const POTS = ['#f2efe9', '#c96f4a', '#3b3f46', '#e6d8c3'];

const UNIT_BOX = new THREE.BoxGeometry(1, 1, 1);
const geoCache = new Map();
function cached(key, make) {
  if (!geoCache.has(key)) geoCache.set(key, make());
  return geoCache.get(key);
}
const rb = (w, h, d, r) => cached(`rb${w}_${h}_${d}_${r}`, () => new RoundedBoxGeometry(w, h, d, 1, r));
const cy = (rt, rbt, h, s) => cached(`cy${rt}_${rbt}_${h}_${s}`, () => new THREE.CylinderGeometry(rt, rbt, h, s));
const ic = (r, d) => cached(`ic${r}_${d}`, () => new THREE.IcosahedronGeometry(r, d));
const sp = (s) => cached(`sp${s}`, () => new THREE.SphereGeometry(1, s, Math.max(4, s * 0.75)));

class Builder {
  constructor(buckets) {
    this.b = buckets;
    this.base = new THREE.Matrix4();
  }
  at(x, z, yaw = 0) {
    this.base = M(x, 0, z, 0, yaw, 0);
    return this;
  }
  add(bucket, geo, color, local) {
    this.b[bucket].add(geo, color, mulM(this.base, local));
  }
  box(bucket, color, x, y, z, w, h, d, rx = 0, ry = 0, rz = 0) {
    this.add(bucket, UNIT_BOX, color, M(x, y, z, rx, ry, rz, w, h, d));
  }
  rbox(bucket, color, x, y, z, w, h, d, r = 0.03, rx = 0, ry = 0, rz = 0) {
    this.add(bucket, rb(w, h, d, r), color, M(x, y, z, rx, ry, rz));
  }
  cyl(bucket, color, x, y, z, rt, rbt, h, s = 12, rx = 0, ry = 0, rz = 0) {
    this.add(bucket, cy(rt, rbt, h, s), color, M(x, y, z, rx, ry, rz));
  }
  ico(bucket, color, x, y, z, r, d = 0, sx = 1, sy = 1, sz = 1) {
    this.add(bucket, ic(r, d), color, M(x, y, z, 0, 0, 0, sx, sy, sz));
  }
  ball(bucket, color, x, y, z, sx, sy, sz, s = 10) {
    this.add(bucket, sp(s), color, M(x, y, z, 0, 0, 0, sx, sy, sz));
  }
  screen(cell, x, y, z, w, h, rx = 0, ry = 0) {
    const g = new THREE.PlaneGeometry(w, h);
    const uv = g.attributes.uv;
    const col = cell % 4;
    const row = Math.floor(cell / 4);
    for (let i = 0; i < uv.count; i++) {
      const u = uv.getX(i);
      const v = uv.getY(i);
      uv.setXY(i, (col + 0.02 + u * 0.96) / 4, 1 - (row + 0.02 + (1 - v) * 0.96) / 4);
    }
    this.b.screen.add(g, '#ffffff', mulM(this.base, M(x, y, z, rx, ry, 0)));
    g.dispose();
  }
}

const WALLISH = new Set(['#', '|', 'k', 'x', 'e', 'D', 'g']);

export class World {
  constructor(stage, renderer) {
    this.stage = stage;
    this.grid = new Grid(stage.map);
    this.preset = LIGHTING[stage.lighting];
    this.group = new THREE.Group();
    this.rng = mulberry32(stage.id * 1013 + 17);
    this.own = new Set();
    this.workers = [];
    this.elevators = [];
    this.exitDoors = [];
    this.shredders = [];
    this.spawns = { player: null, goal: null, enemies: [], boss: null, pickups: [], desks: [] };
    this.W = this.grid.w;
    this.H = this.grid.h;
    this.maxAniso = renderer.capabilities.getMaxAnisotropy();

    this.parse();
    this.buildFloor();
    this.buildStatic();
    this.buildLights();
    this.buildBackdrop();
    this.buildGoal();
  }

  track(o) {
    this.own.add(o);
    return o;
  }

  // -------------------------------------------------------------------------
  parse() {
    const { grid } = this;
    const order = {};
    for (let y = 0; y < this.H; y++) {
      for (let x = 0; x < this.W; x++) {
        const c = grid.at(x, y);
        if (c === 'P') this.spawns.player = { x: x + 0.5, z: y + 0.5 };
        else if (c === 'G') this.spawns.goal = { x: x + 0.5, z: y + 0.5 };
        else if (c === 'C') this.spawns.pickups.push({ x: x + 0.5, z: y + 0.5 });
        else if (c === 'A') this.spawns.ally = { x: x + 0.5, z: y + 0.5 };
        else if (c === 'K') this.spawns.fetch = { x: x + 0.5, z: y + 0.5 };
        else if (c === '0') (this.spawns.rooms ||= []).push({ x: x + 0.5, z: y + 0.5 });
        else if (ITEM_CODES[c]) (this.spawns.items ||= []).push({ id: ITEM_CODES[c], x: x + 0.5, z: y + 0.5 });
        else if (ENEMY_CODES[c]) {
          order[c] = order[c] || 0;
          this.spawns.enemies.push({ code: c, type: ENEMY_CODES[c], x: x + 0.5, z: y + 0.5, index: order[c]++ });
        }
      }
    }
    // ゴールが決まっていない（空き会議室が変わる）ステージ
    if (!this.spawns.goal) this.spawns.goal = { ...(this.spawns.rooms?.[0] || this.spawns.fetch || this.spawns.player) };
    // 床の種類（家具タイルは近くの床から推定）
    const ft = new Array(this.W * this.H).fill('.');
    const isFloor = (c) => '.;,:_=z'.includes(c);
    for (let y = 0; y < this.H; y++) {
      for (let x = 0; x < this.W; x++) {
        const c = grid.at(x, y);
        if (isFloor(c)) {
          ft[y * this.W + x] = c;
          continue;
        }
        let found = '.';
        search: for (let r = 1; r < 4; r++) {
          for (const [dx, dy] of [[-1, 0], [0, -1], [1, 0], [0, 1]]) {
            const n = grid.at(x + dx * r, y + dy * r);
            if (isFloor(n)) {
              found = n;
              break search;
            }
          }
        }
        ft[y * this.W + x] = found;
      }
    }
    this.floorType = ft;
  }

  buildFloor() {
    const aoSet = new Set(['#', 'k', 'x', 'v', 'c', 'e', 'D', 'h', 'g', 's', 'w']);
    const tex = this.track(floorTexture(this.grid, this.floorType, (x, y) => aoSet.has(this.grid.at(x, y))));
    tex.anisotropy = this.maxAniso;
    const mat = this.track(new THREE.MeshStandardMaterial({ map: tex, roughness: 0.88, metalness: 0 }));
    const geo = this.track(new THREE.PlaneGeometry(this.W, this.H));
    const floor = new THREE.Mesh(geo, mat);
    floor.rotation.x = -Math.PI / 2;
    floor.position.set(this.W / 2, 0, this.H / 2);
    floor.receiveShadow = true;
    this.group.add(floor);

    // ジオラマの台座
    const slabMat = this.track(new THREE.MeshStandardMaterial({ color: '#c9ced6', roughness: 0.9 }));
    const slab = new THREE.Mesh(this.track(new THREE.BoxGeometry(this.W + 0.6, 0.7, this.H + 0.6)), slabMat);
    slab.position.set(this.W / 2, -0.351, this.H / 2);
    slab.receiveShadow = true;
    this.group.add(slab);
    const edge = new THREE.Mesh(this.track(new THREE.BoxGeometry(this.W + 0.64, 0.06, this.H + 0.64)),
      this.track(new THREE.MeshStandardMaterial({ color: '#e0402f', roughness: 0.6 })));
    edge.position.set(this.W / 2, -0.07, this.H / 2);
    this.group.add(edge);
  }

  // -------------------------------------------------------------------------
  buildStatic() {
    const buckets = {
      matte: new GeoBatch(),
      gloss: new GeoBatch(),
      metal: new GeoBatch(),
      screen: new GeoBatch({ uv: true }),
      glass: new GeoBatch(),
      frost: new GeoBatch(),
      glow: new GeoBatch(),
    };
    const B = new Builder(buckets);
    this.B = B;
    const { grid } = this;
    const visited = new Uint8Array(this.W * this.H);

    for (let y = 0; y < this.H; y++) {
      for (let x = 0; x < this.W; x++) {
        const c = grid.at(x, y);
        const cx = x + 0.5;
        const cz = y + 0.5;
        switch (c) {
          case '#':
            this.wall(B, x, y);
            break;
          case '|':
            this.glassWall(B, x, y);
            break;
          case 'd':
            this.desk(B, x, y);
            break;
          case 'k':
            this.cabinet(B, x, y);
            break;
          case 'x':
            B.at(cx, cz);
            B.box('matte', PAL.pillar, 0, 0.7, 0, 0.84, 1.4, 0.84);
            B.box('matte', PAL.wallCap, 0, 1.415, 0, 0.86, 0.03, 0.86);
            B.box('matte', PAL.base, 0, 0.04, 0, 0.87, 0.08, 0.87);
            break;
          case 'p':
            this.plant(B, cx, cz);
            break;
          case 't':
            this.tree(B, cx, cz);
            break;
          case 'n':
            this.bench(B, x, y);
            break;
          case 'c':
            this.copier(B, x, y);
            break;
          case 's':
            this.shredder(B, x, y);
            break;
          case 'v':
            this.vending(B, x, y);
            break;
          case 'w':
            this.water(B, x, y);
            break;
          case 'e':
            this.elevator(B, x, y);
            break;
          case 'D':
            this.exitDoor(B, x, y);
            break;
          case 'g':
            this.gate(B, x, y);
            break;
          case 'm':
          case 'B':
          case 'h':
            if (!visited[y * this.W + x]) {
              const box = this.flood(x, y, c, visited);
              if (c === 'm') this.meetingTable(B, box);
              else if (c === 'B') this.bossDesk(B, box);
              else this.whiteboard(B, box);
            }
            break;
          default:
            break;
        }
      }
    }
    this.signs(B);
    this.clock();
    this.posters();

    const mats = {
      matte: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.84, metalness: 0 }),
      gloss: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.3, metalness: 0.02 }),
      metal: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.32, metalness: 0.8 }),
      screen: new THREE.MeshBasicMaterial({ map: this.track(screenAtlas()), color: new THREE.Color().setScalar(this.preset.screenBoost) }),
      glass: new THREE.MeshStandardMaterial({ color: '#d7eef8', roughness: 0.05, metalness: 0.2, transparent: true, opacity: 0.2, depthWrite: false }),
      frost: new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.9, transparent: true, opacity: 0.55, depthWrite: false }),
      glow: new THREE.MeshBasicMaterial({ vertexColors: true, color: new THREE.Color(1.8, 1.8, 1.8) }),
    };
    for (const [k, batch] of Object.entries(buckets)) {
      const geo = batch.build();
      if (!geo) continue;
      const mesh = new THREE.Mesh(this.track(geo), this.track(mats[k]));
      const solid = k === 'matte' || k === 'gloss' || k === 'metal';
      mesh.castShadow = solid;
      mesh.receiveShadow = solid || k === 'screen';
      if (k === 'glass' || k === 'frost') mesh.renderOrder = 2;
      this.group.add(mesh);
    }
    for (const m of Object.values(mats)) this.track(m);
  }

  flood(x, y, c, visited) {
    let minX = x;
    let maxX = x;
    let minY = y;
    let maxY = y;
    const stack = [[x, y]];
    visited[y * this.W + x] = 1;
    while (stack.length) {
      const [px, py] = stack.pop();
      minX = Math.min(minX, px);
      maxX = Math.max(maxX, px);
      minY = Math.min(minY, py);
      maxY = Math.max(maxY, py);
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = px + dx;
        const ny = py + dy;
        if (this.grid.at(nx, ny) !== c || visited[ny * this.W + nx]) continue;
        visited[ny * this.W + nx] = 1;
        stack.push([nx, ny]);
      }
    }
    return { minX, maxX: maxX + 1, minY, maxY: maxY + 1 };
  }

  /** 家具の正面を通路側に向ける yaw（ローカル+Z が通路方向） */
  facing(x, y) {
    const g = this.grid;
    if (g.isWalk(x, y + 1)) return 0;
    if (g.isWalk(x + 1, y)) return Math.PI / 2;
    if (g.isWalk(x - 1, y)) return -Math.PI / 2;
    return Math.PI;
  }

  // -------------------------------------------------------------------------
  wall(B, x, y) {
    const cx = x + 0.5;
    const cz = y + 0.5;
    if (this.stage.outdoor && y < this.H - 1) {
      this.building(B, x, y);
      return;
    }
    const outer = x === 0 || y === 0 || x === this.W - 1 || y === this.H - 1;
    B.at(cx, cz);
    if (y === 0 && x > 0 && x < this.W - 1) {
      this.windowWall(B, x);
      return;
    }
    if (y === this.H - 1) {
      B.box('matte', PAL.wall, 0, 0.18, 0, 1, 0.36, 1);
      B.box('matte', PAL.wallCap, 0, 0.375, 0, 1.0, 0.03, 1.0);
      return;
    }
    if (outer) {
      B.box('matte', PAL.wall, 0, 1.3, 0, 1, 2.6, 1);
      B.box('matte', PAL.wallCap, 0, 2.615, 0, 1, 0.03, 1);
      B.box('matte', PAL.base, x === 0 ? 0.5 : -0.5, 0.05, 0, 0.04, 0.1, 1);
      return;
    }
    B.box('matte', PAL.wall, 0, 0.5, 0, 1, 1.0, 1);
    B.box('matte', PAL.wallCap, 0, 1.015, 0, 1.0, 0.03, 1.0);
    B.box('matte', PAL.base, 0, 0.045, 0, 1.03, 0.09, 1.03);
  }

  /** 屋外：ビル（外周は高く、内側は低層で屋上が見える） */
  building(B, x, y) {
    const edge = x === 0 || y === 0 || x === this.W - 1;
    const hash = ((x * 73856093) ^ (y * 19349663)) >>> 0;
    const block = ((Math.floor(x / 5) * 31 + Math.floor(y / 4) * 17) >>> 0) % 4;
    const colors = ['#d9d2c4', '#c7ccd4', '#b98a6e', '#e6e1d8'];
    const col = colors[block];
    const h = edge ? 3.2 + (hash % 5) * 0.25 : 1.35;
    B.at(x + 0.5, y + 0.5);
    B.box('matte', col, 0, h / 2, 0, 1, h, 1);
    const roofs = ['#bdb4a4', '#a7aeb8', '#a07a64', '#cbc4b8'];
    B.box('matte', edge ? '#8a919c' : roofs[block], 0, h + 0.03, 0, 1, 0.06, 1);
    if (!edge) {
      // 屋上のふち
      if (!this.grid.at(x, y - 1).match(/#/)) B.box('matte', '#8a919c', 0, h + 0.12, -0.46, 1, 0.14, 0.08);
      if (!this.grid.at(x, y + 1).match(/#/)) B.box('matte', '#8a919c', 0, h + 0.12, 0.46, 1, 0.14, 0.08);
      if (!this.grid.at(x - 1, y).match(/#/)) B.box('matte', '#8a919c', -0.46, h + 0.12, 0, 0.08, 0.14, 1);
      if (!this.grid.at(x + 1, y).match(/#/)) B.box('matte', '#8a919c', 0.46, h + 0.12, 0, 0.08, 0.14, 1);
    }
    // 窓
    for (let wy = 0.55; wy < h - 0.3; wy += 0.75) {
      if (this.grid.isWalk(x, y + 1) || y === 0) B.box('gloss', '#3d5570', 0, wy + 0.2, 0.505, 0.62, 0.38, 0.02);
      if (this.grid.isWalk(x + 1, y)) B.box('gloss', '#3d5570', 0.505, wy + 0.2, 0, 0.02, 0.38, 0.62);
      if (this.grid.isWalk(x - 1, y)) B.box('gloss', '#3d5570', -0.505, wy + 0.2, 0, 0.02, 0.38, 0.62);
    }
    if (!edge && hash % 7 === 0) B.box('matte', '#aab2bd', 0.15, h + 0.2, -0.1, 0.35, 0.3, 0.3);
    if (!edge && hash % 11 === 0) B.cyl('matte', '#9aa1ab', -0.2, h + 0.25, 0.15, 0.12, 0.12, 0.4, 10);
  }

  tree(B, cx, cz) {
    const { rng } = this;
    B.at(cx, cz);
    B.box('matte', '#5a5f68', 0, 0.02, 0, 0.9, 0.04, 0.9);
    B.cyl('matte', '#6b4a33', 0, 0.8, 0, 0.08, 0.12, 1.6, 7);
    for (let i = 0; i < 4; i++) {
      B.ico('matte', pick(rng, LEAF), (rng() - 0.5) * 0.4, 1.7 + i * 0.18, (rng() - 0.5) * 0.4, 0.34 + rng() * 0.12, 0);
    }
  }

  bench(B, x, y) {
    const g = this.grid;
    const alongX = g.isWalk(x, y - 1) || g.isWalk(x, y + 1);
    B.at(x + 0.5, y + 0.5, alongX ? 0 : Math.PI / 2);
    B.box('gloss', '#a0673f', 0, 0.42, 0, 0.9, 0.05, 0.38);
    B.box('gloss', '#a0673f', 0, 0.68, -0.17, 0.9, 0.22, 0.04);
    for (const sx of [-0.38, 0.38]) B.box('metal', '#4a4f58', sx, 0.21, 0, 0.05, 0.42, 0.34);
  }

  windowWall(B, x) {
    const { rng } = this;
    B.box('matte', PAL.wall, 0, 0.28, 0.3, 1, 0.56, 0.4);
    B.box('gloss', '#dcd9d2', 0, 0.575, 0.3, 1, 0.03, 0.46);
    B.box('matte', PAL.wall, 0, 2.43, 0.3, 1, 0.34, 0.4);
    B.box('matte', PAL.wallCap, 0, 2.615, 0.3, 1, 0.03, 0.4);
    B.box('metal', '#5b6270', -0.5, 1.42, 0.35, 0.06, 1.7, 0.08);
    if (x === this.W - 2) B.box('metal', '#5b6270', 0.5, 1.42, 0.35, 0.06, 1.7, 0.08);
    B.box('glass', '#ffffff', 0, 1.42, 0.36, 1, 1.7, 0.02);
    B.box('matte', PAL.base, 0, 0.05, 0.5, 1, 0.1, 0.04);
    // ブラインド
    if (rng() < 0.45) {
      const n = 4 + Math.floor(rng() * 6);
      for (let i = 0; i < n; i++) B.box('matte', '#f5f5f2', 0, 2.2 - i * 0.085, 0.42, 0.96, 0.012, 0.07, 0.35);
      B.box('matte', '#e6e6e2', 0, 2.24, 0.42, 0.98, 0.05, 0.08);
    }
  }

  glassWall(B, x, y) {
    const g = this.grid;
    const wl = (dx, dy) => WALLISH.has(g.at(x + dx, y + dy));
    const horiz = wl(-1, 0) || wl(1, 0);
    const vert = wl(0, -1) || wl(0, 1);
    B.at(x + 0.5, y + 0.5);
    const seg = (yaw, len, off) => {
      const saved = B.base;
      B.base = mulM(saved, M(0, 0, 0, 0, yaw, 0));
      B.box('metal', '#5a616d', off, 0.04, 0, len, 0.08, 0.1);
      B.box('metal', '#5a616d', off, 2.2, 0, len, 0.06, 0.1);
      B.box('glass', '#ffffff', off, 1.12, 0, len, 2.1, 0.03);
      B.box('frost', '#ffffff', off, 1.15, 0, len, 0.26, 0.036);
      B.base = saved;
    };
    if (horiz || !vert) {
      seg(0, 1, 0);
      B.box('metal', '#5a616d', -0.5, 1.12, 0, 0.05, 2.2, 0.08);
    }
    if (vert) {
      seg(Math.PI / 2, 1, 0);
      B.box('metal', '#5a616d', 0, 1.12, -0.5, 0.08, 2.2, 0.05);
    }
  }

  desk(B, x, y) {
    const { grid, rng } = this;
    const topRow = grid.at(x, y + 1) === 'd';
    const yaw = topRow ? 0 : Math.PI;
    B.at(x + 0.5, y + 0.5, yaw);
    // 島ごとの色
    const islandKey = Math.floor(x / 6) * 31 + Math.floor(y / 4) * 7 + this.stage.id;
    const panel = PANEL_COLORS[islandKey % PANEL_COLORS.length];
    const chairCol = CHAIR_COLORS[islandKey % CHAIR_COLORS.length];

    B.box('gloss', PAL.desk, 0, 0.62, 0.2, 0.98, 0.04, 0.58);
    B.box('matte', PAL.deskLeg, 0.465, 0.3, 0.2, 0.03, 0.6, 0.5);
    B.box('matte', PAL.deskLeg, -0.465, 0.3, 0.2, 0.03, 0.6, 0.5);
    if (topRow || grid.at(x, y - 1) !== 'd') B.box('matte', panel, 0, 0.79, 0.5, 0.98, 0.3, 0.035);
    const side = rng() < 0.5 ? 1 : -1;
    B.box('matte', PAL.pedestal, side * 0.27, 0.27, 0.22, 0.32, 0.5, 0.44);
    for (const hy of [0.4, 0.24]) B.box('matte', '#b7bcc4', side * 0.27, hy, -0.005, 0.3, 0.012, 0.012);

    const occupied = rng() < (this.stage.occupancy ?? 0.4);
    // モニター
    const kind = rng();
    const cell = occupied ? Math.floor(rng() * SCREEN_CELLS) : rng() < 0.6 ? 10 : Math.floor(rng() * SCREEN_CELLS);
    if (kind < 0.62) {
      const mx = (rng() - 0.5) * 0.1;
      B.box('matte', '#30343c', mx, 0.646, 0.38, 0.18, 0.012, 0.13);
      B.box('matte', '#30343c', mx, 0.74, 0.4, 0.035, 0.18, 0.03);
      B.rbox('gloss', PAL.monitor, mx, 0.87, 0.385, 0.52, 0.32, 0.03, 0.012);
      B.screen(cell, mx, 0.87, 0.368, 0.48, 0.28, 0, Math.PI);
      const notes = Math.floor(rng() * 3);
      for (let i = 0; i < notes; i++) {
        const nx = mx + (i % 2 ? 0.23 : -0.23);
        B.box('matte', rng() < 0.5 ? '#ffe26a' : '#ffb3c7', nx, 0.97 - i * 0.07, 0.366, 0.05, 0.05, 0.004, 0, 0, (rng() - 0.5) * 0.4);
      }
    } else if (kind < 0.8) {
      for (const sx of [-1, 1]) {
        const mx = sx * 0.24;
        B.box('matte', '#30343c', mx, 0.646, 0.38, 0.14, 0.012, 0.11);
        B.box('matte', '#30343c', mx, 0.73, 0.4, 0.03, 0.16, 0.03);
        B.rbox('gloss', PAL.monitor, mx, 0.84, 0.385, 0.44, 0.27, 0.03, 0.012, 0, sx * -0.18);
        B.screen(sx < 0 ? cell : (cell + 5) % SCREEN_CELLS, mx, 0.84, 0.368, 0.4, 0.23, 0, Math.PI - sx * 0.18);
      }
    } else {
      B.box('metal', '#c3c8cf', 0, 0.648, 0.2, 0.36, 0.014, 0.25);
      B.rbox('metal', '#c3c8cf', 0, 0.77, 0.34, 0.36, 0.24, 0.014, 0.006, 0.28);
      B.screen(cell, 0, 0.77, 0.332, 0.32, 0.2, 0.28, Math.PI);
    }
    B.box('matte', PAL.keyboard, 0, 0.648, 0.1, 0.36, 0.018, 0.12);
    B.rbox('matte', '#d9dce0', 0.27, 0.65, 0.1, 0.05, 0.022, 0.08, 0.01);
    // 小物
    const items = Math.floor(rng() * 4);
    const spots = [[-0.37, 0.05], [0.38, 0.27], [-0.38, 0.3], [0.36, 0.02]];
    for (let i = 0; i < items; i++) {
      const [ix, iz] = spots[(i + Math.floor(rng() * 4)) % 4];
      const r = rng();
      if (r < 0.25) {
        const col = pick(rng, ['#ffffff', '#e0402f', '#2f6db5', '#ffd84d', '#3aa56c']);
        B.cyl('gloss', col, ix, 0.69, iz, 0.042, 0.038, 0.1, 10);
        B.cyl('matte', '#3a2416', ix, 0.738, iz, 0.036, 0.036, 0.004, 10);
      } else if (r < 0.5) {
        const n = 1 + Math.floor(rng() * 4);
        for (let k = 0; k < n; k++) B.box('matte', k % 2 ? '#ffffff' : '#f1f3f6', ix, 0.65 + k * 0.022, iz, 0.2, 0.02, 0.27, 0, (rng() - 0.5) * 0.3);
      } else if (r < 0.65) {
        B.cyl('matte', '#3b3f46', ix, 0.68, iz, 0.035, 0.035, 0.08, 8);
        for (let k = 0; k < 3; k++) B.cyl('matte', pick(rng, ['#e0402f', '#2f6db5', '#1b1b1b', '#3aa56c']), ix + (k - 1) * 0.012, 0.74, iz, 0.006, 0.006, 0.1, 5, (k - 1) * 0.2);
      } else if (r < 0.78) {
        B.cyl('matte', '#c96f4a', ix, 0.675, iz, 0.04, 0.032, 0.07, 8);
        B.ico('matte', '#4e8f4f', ix, 0.74, iz, 0.05, 0);
      } else if (r < 0.9) {
        B.rbox('matte', '#2d3139', ix, 0.665, iz, 0.18, 0.05, 0.15, 0.015);
        B.box('matte', '#1b1e24', ix - 0.03, 0.7, iz, 0.06, 0.02, 0.13);
      } else {
        B.box('matte', pick(rng, BINDER_COLORS), ix, 0.75, iz, 0.05, 0.22, 0.28);
      }
    }
    // 椅子
    const jz = -0.2 + (occupied ? 0.02 : -rng() * 0.08);
    const jyaw = occupied ? 0 : (rng() - 0.5) * 0.8;
    this.chair(B, (rng() - 0.5) * 0.08, jz, jyaw, chairCol);
    if (occupied) {
      const look = this.randomWorker();
      const w = new Character(look, { outline: false, lite: true, shadow: true });
      w.pose = 'type';
      const wx = x + 0.5;
      const wz = y + 0.5 + (topRow ? -0.2 : 0.2);
      w.root.position.set(wx, 0.08, wz);
      w.setYaw(topRow ? 0 : Math.PI);
      w.baseYaw = w.yaw;
      w.t = rng() * 10;
      this.group.add(w.root);
      this.workers.push(w);
    }
  }

  chair(B, lx, lz, lyaw, col) {
    const saved = B.base;
    B.base = mulM(saved, M(lx, 0, lz, 0, lyaw, 0));
    B.rbox('matte', col, 0, 0.43, 0, 0.44, 0.07, 0.42, 0.03);
    B.box('matte', col, 0, 0.72, -0.2, 0.42, 0.44, 0.06, -0.08);
    B.cyl('metal', '#6d737d', 0, 0.25, 0, 0.025, 0.025, 0.3, 6);
    for (let i = 0; i < 5; i++) B.box('metal', '#4a4f58', 0, 0.06, 0, 0.04, 0.03, 0.5, 0, (i / 5) * Math.PI * 2);
    for (const sx of [-1, 1]) B.box('matte', '#2b2f38', sx * 0.23, 0.58, -0.02, 0.04, 0.03, 0.26);
    B.base = saved;
  }

  randomWorker() {
    const { rng } = this;
    const hair = pick(rng, WORKER_HAIR);
    const top = pick(rng, WORKER_TOPS);
    return {
      skin: pick(rng, SKINS),
      hair: { style: hair, color: pick(rng, HAIR_COLORS) },
      top,
      shirt: top.type === 'shirt' ? top.color : pick(rng, ['#ffffff', '#e8f0fb', '#fbeff2']),
      tie: top.type === 'suit' && rng() < 0.6 ? pick(rng, ['#2f6db5', '#8a1f2b', '#3f8f5f', '#e8b82e']) : null,
      bottom: { type: 'pants', color: pick(rng, ['#2d3240', '#4a4e57', '#6b5e50']) },
      shoes: '#222222',
      glasses: rng() < 0.25 ? { color: '#2b2b2b' } : null,
      cheeks: rng() < 0.5,
    };
  }

  cabinet(B, x, y) {
    const g = this.grid;
    const { rng } = this;
    const k = (dx, dy) => WALLISH.has(g.at(x + dx, y + dy));
    const vertical = (k(0, -1) || k(0, 1)) && !(k(-1, 0) || k(1, 0));
    B.at(x + 0.5, y + 0.5, vertical ? Math.PI / 2 : 0);
    B.box('matte', PAL.cabinet, 0, 0.575, 0, 0.98, 1.15, 0.52);
    B.box('matte', PAL.cabTop, 0, 1.165, 0, 1.0, 0.03, 0.54);
    B.box('matte', PAL.base, 0, 0.04, 0, 1.0, 0.08, 0.54);
    for (const face of vertical ? [1, -1] : [1]) {
      for (let s = 0; s < 2; s++) {
        let bx = -0.44;
        const y0 = 0.13 + s * 0.5;
        B.box('matte', '#b9bec6', 0, y0 - 0.02, face * 0.255, 0.94, 0.02, 0.02);
        while (bx < 0.42) {
          const w = 0.06 + rng() * 0.05;
          const h = 0.34 + rng() * 0.07;
          if (rng() < 0.9) {
            const col = pick(rng, BINDER_COLORS);
            B.box('matte', col, bx + w / 2, y0 + h / 2, face * 0.25, w - 0.008, h, 0.03);
            B.box('matte', '#ffffff', bx + w / 2, y0 + h * 0.7, face * 0.267, w * 0.6, 0.06, 0.004);
          }
          bx += w;
        }
      }
    }
    const r = rng();
    if (r < 0.12) {
      B.ball('gloss', '#d8342a', 0.2, 1.3, 0, 0.12, 0.13, 0.12, 12);
      B.ball('gloss', '#fff4e6', 0.2, 1.32, 0.09, 0.07, 0.06, 0.04, 10);
    } else if (r < 0.3) {
      B.cyl('matte', '#c96f4a', -0.25, 1.24, 0, 0.08, 0.06, 0.12, 8);
      B.ico('matte', '#5a9a52', -0.25, 1.36, 0, 0.1, 0);
    } else if (r < 0.45) {
      B.box('matte', '#c8a57a', 0.1, 1.28, 0, 0.36, 0.2, 0.3);
    } else if (r < 0.52) {
      B.cyl('metal', '#d4af37', -0.1, 1.23, 0, 0.06, 0.07, 0.1, 10);
      B.cyl('metal', '#d4af37', -0.1, 1.33, 0, 0.012, 0.012, 0.12, 6);
      B.ico('metal', '#d4af37', -0.1, 1.42, 0, 0.06, 0);
    }
  }

  plant(B, cx, cz) {
    const { rng } = this;
    B.at(cx, cz);
    const pot = pick(rng, POTS);
    B.cyl('matte', pot, 0, 0.22, 0, 0.25, 0.19, 0.44, 12);
    B.cyl('matte', '#4a3525', 0, 0.44, 0, 0.23, 0.23, 0.01, 12);
    if (rng() < 0.3) {
      for (let i = 0; i < 7; i++) {
        const a = (i / 7) * Math.PI * 2 + rng();
        const h = 0.6 + rng() * 0.5;
        B.add('matte', cy(0.001, 0.05, h, 4), i % 2 ? '#3f7d4a' : '#5f9d55', M(Math.cos(a) * 0.08, 0.44 + h / 2, Math.sin(a) * 0.08, Math.sin(a) * 0.18, 0, -Math.cos(a) * 0.18));
      }
    } else {
      const n = 5 + Math.floor(rng() * 3);
      for (let i = 0; i < n; i++) {
        const r = 0.17 + rng() * 0.14;
        B.ico('matte', pick(rng, LEAF), (rng() - 0.5) * 0.32, 0.62 + i * 0.12 + rng() * 0.1, (rng() - 0.5) * 0.32, r, 0);
      }
      B.cyl('matte', '#6b4a33', 0, 0.6, 0, 0.02, 0.03, 0.4, 5);
    }
  }

  copier(B, x, y) {
    const yaw = this.facing(x, y);
    (this.copiers ||= []).push({ x: x + 0.5, z: y + 0.5, yaw, front: { x: x + 0.5 + Math.sin(yaw) * 1.05, z: y + 0.5 + Math.cos(yaw) * 1.05 } });
    B.at(x + 0.5, y + 0.5, yaw);
    B.rbox('matte', '#e7e7e2', 0, 0.4, 0, 0.86, 0.8, 0.68, 0.04);
    B.rbox('matte', '#cfd2d6', 0, 0.86, -0.02, 0.86, 0.12, 0.64, 0.03);
    B.box('matte', '#3b404b', 0.2, 0.93, 0.26, 0.34, 0.03, 0.14, -0.3);
    B.box('glow', '#7cc8ff', 0.2, 0.945, 0.265, 0.16, 0.01, 0.07, -0.3);
    for (let i = 0; i < 3; i++) B.box('matte', '#b3b8c0', 0, 0.16 + i * 0.16, 0.345, 0.78, 0.012, 0.012);
    B.box('matte', '#d9dcdf', -0.52, 0.62, 0, 0.2, 0.02, 0.38);
    B.box('matte', '#ffffff', -0.5, 0.64, 0, 0.16, 0.02, 0.3);
    B.box('glow', '#ff9a3c', -0.3, 0.93, 0.3, 0.03, 0.02, 0.03);
  }

  shredder(B, x, y) {
    const yaw = this.facing(x, y);
    B.at(x + 0.5, y + 0.5, yaw);
    B.rbox('matte', '#3d4148', 0, 0.37, 0, 0.5, 0.74, 0.42, 0.03);
    B.box('matte', '#15171b', 0, 0.745, 0.02, 0.34, 0.012, 0.04);
    B.box('matte', '#262a30', 0, 0.3, 0.212, 0.36, 0.36, 0.01);
    for (let i = 0; i < 9; i++) B.box('matte', '#f4f4f0', -0.14 + i * 0.035, 0.24 + (i % 3) * 0.03, 0.214, 0.012, 0.18, 0.004);
    B.box('glow', '#7dff9e', 0.17, 0.66, 0.212, 0.03, 0.03, 0.01);
    const label = new THREE.Mesh(this.track(new THREE.PlaneGeometry(0.4, 0.1)),
      this.track(new THREE.MeshBasicMaterial({ map: this.track(textTexture('シュレッダー', { w: 256, h: 64, font: '800 34px "M PLUS Rounded 1c", sans-serif', bg: '#ffd84d', radius: 10 })) })));
    label.position.set(0, 0.6, 0.216).applyMatrix4(B.base);
    label.rotation.y = yaw;
    this.group.add(label);
    this.shredders.push({ x: x + 0.5, z: y + 0.5, yaw });
  }

  vending(B, x, y) {
    const yaw = this.facing(x, y);
    const kind = (x + y) % 2;
    B.at(x + 0.5, y + 0.5, yaw);
    B.rbox('gloss', kind ? '#2f6db5' : '#d8423a', 0, 0.92, -0.02, 0.9, 1.84, 0.66, 0.05);
    const front = new THREE.Mesh(this.track(new THREE.PlaneGeometry(0.78, 1.56)),
      this.track(new THREE.MeshBasicMaterial({ map: this.track(vendingTexture(kind)), color: new THREE.Color(1.15, 1.15, 1.15) })));
    front.position.set(0, 0.98, 0.315).applyMatrix4(B.base);
    front.rotation.y = yaw;
    this.group.add(front);
  }

  water(B, x, y) {
    const yaw = this.facing(x, y);
    B.at(x + 0.5, y + 0.5, yaw);
    B.rbox('matte', '#f4f5f6', 0, 0.48, 0, 0.4, 0.96, 0.4, 0.04);
    B.cyl('gloss', '#8fc9f0', 0, 1.14, 0, 0.15, 0.15, 0.36, 14);
    B.cyl('gloss', '#8fc9f0', 0, 1.36, 0, 0.06, 0.13, 0.08, 14);
    B.box('matte', '#d8342a', -0.07, 0.72, 0.205, 0.04, 0.05, 0.03);
    B.box('matte', '#2f6db5', 0.07, 0.72, 0.205, 0.04, 0.05, 0.03);
    B.box('matte', '#c9ccd1', 0, 0.56, 0.18, 0.3, 0.02, 0.12);
    B.cyl('matte', '#ffffff', 0.26, 0.7, 0.05, 0.035, 0.035, 0.3, 10);
  }

  gate(B, x, y) {
    B.at(x + 0.5, y + 0.5);
    B.rbox('metal', '#c9ced6', 0, 0.5, 0, 0.28, 1.0, 0.86, 0.04);
    B.box('matte', '#1b2340', 0, 1.005, 0, 0.3, 0.02, 0.88);
    B.box('glow', '#58e6a0', 0, 1.02, 0.2, 0.18, 0.012, 0.18);
    B.box('glow', '#58e6a0', 0, 1.02, -0.2, 0.18, 0.012, 0.18);
    for (const dz of [-1, 1]) {
      if (this.grid.isWalk(x, y + dz)) B.box('glass', '#ffffff', 0, 0.7, dz * 0.62, 0.03, 0.5, 0.36);
    }
  }

  elevator(B, x, y) {
    const inward = x === 0 ? 1 : -1;
    const yaw = inward > 0 ? Math.PI / 2 : -Math.PI / 2;
    const faceX = x === 0 ? 1 : this.W - 1;
    B.at(x + 0.5, y + 0.5);
    B.box('matte', PAL.wall, 0, 2.4, 0, 1, 0.4, 1);
    B.box('matte', PAL.wallCap, 0, 2.615, 0, 1, 0.03, 1);
    B.at(faceX, y + 0.5, yaw);
    // かご（扉が開くと見える）
    B.box('glow', '#ffe9c2', 0, 1.1, -0.92, 1.0, 2.2, 0.02);
    B.box('metal', '#9aa3ae', -0.49, 1.1, -0.46, 0.02, 2.2, 0.92);
    B.box('metal', '#9aa3ae', 0.49, 1.1, -0.46, 0.02, 2.2, 0.92);
    B.box('matte', '#7d838d', 0, 0.01, -0.46, 1.0, 0.02, 0.92);
    B.box('metal', '#d8dde3', 0, 0.9, -0.88, 0.8, 0.04, 0.04);
    B.box('metal', '#aab2bd', -0.56, 1.1, 0.03, 0.1, 2.2, 0.08);
    B.box('metal', '#aab2bd', 0.56, 1.1, 0.03, 0.1, 2.2, 0.08);
    B.box('metal', '#aab2bd', 0, 2.25, 0.03, 1.22, 0.12, 0.08);
    B.box('matte', '#2b2f36', 0.78, 1.1, 0.025, 0.12, 0.3, 0.03);
    B.box('glow', '#ffb347', 0.78, 1.16, 0.045, 0.05, 0.05, 0.01);
    B.box('glow', '#ffb347', 0.78, 1.04, 0.045, 0.05, 0.05, 0.01);
    // 表示パネル
    const ind = new THREE.Mesh(this.track(new THREE.PlaneGeometry(0.5, 0.16)),
      this.track(new THREE.MeshBasicMaterial({ map: this.track(textTexture('▼ 12F', { w: 256, h: 80, bg: '#141821', color: '#ffb347', font: '800 48px "M PLUS Rounded 1c", sans-serif', radius: 8 })), color: new THREE.Color(1.4, 1.4, 1.4) })));
    ind.position.set(faceX + inward * 0.075, 2.44, y + 0.5);
    ind.rotation.y = yaw;
    this.group.add(ind);
    // 扉（動く）
    const doorMat = this.track(new THREE.MeshStandardMaterial({ color: '#b9c1cb', metalness: 0.85, roughness: 0.28 }));
    const doorGeo = this.track(new THREE.BoxGeometry(0.5, 2.12, 0.04));
    doorGeo.translate(0.25, 0, 0);
    const doors = [];
    for (const s of [-1, 1]) {
      const pivot = new THREE.Group();
      pivot.position.set(faceX + inward * 0.03, 1.06, y + 0.5);
      pivot.rotation.y = yaw;
      const door = new THREE.Mesh(doorGeo, doorMat);
      door.position.x = s < 0 ? -0.5 : 0.5;
      door.scale.x = s < 0 ? 1 : -1;
      door.castShadow = true;
      pivot.add(door);
      this.group.add(pivot);
      doors.push(door);
    }
    this.elevators.push({ x: faceX + inward * 0.5, z: y + 0.5, cx: faceX - inward * 0.45, inward, doors, open: 0, target: 0 });
  }

  exitDoor(B, x, y) {
    B.at(x + 0.5, y + 0.5);
    B.box('matte', PAL.wall, 0, 2.43, 0, 1, 0.34, 1);
    B.box('matte', PAL.wallCap, 0, 2.615, 0, 1, 0.03, 1);
    B.box('metal', '#3b404b', 0.45, 2.2, 0, 0.1, 0.12, 1);
    B.box('glow', '#fff3d6', -0.1, 1.1, 0, 0.02, 2.2, 1);
    if (this.grid.at(x, y - 1) !== 'D') {
      B.box('metal', '#3b404b', 0.45, 1.1, -0.5, 0.12, 2.3, 0.08);
      const sign = new THREE.Mesh(this.track(new THREE.PlaneGeometry(1.2, 0.34)),
        this.track(new THREE.MeshBasicMaterial({ map: this.track(textTexture('出口  EXIT', { w: 512, h: 144, bg: '#1f9d55', color: '#ffffff', font: '800 64px "M PLUS Rounded 1c", sans-serif', radius: 16 })), color: new THREE.Color(1.5, 1.5, 1.5) })));
      sign.position.set(x + 1.02, 2.5, y + 1);
      sign.rotation.y = Math.PI / 2;
      this.group.add(sign);
    } else {
      B.box('metal', '#3b404b', 0.45, 1.1, 0.5, 0.12, 2.3, 0.08);
    }
    const glassMat = this.track(new THREE.MeshStandardMaterial({ color: '#cfe9f5', transparent: true, opacity: 0.35, roughness: 0.05, metalness: 0.2 }));
    const panel = new THREE.Mesh(this.track(new THREE.BoxGeometry(0.04, 2.1, 0.96)), glassMat);
    panel.position.set(x + 0.9, 1.08, y + 0.5);
    panel.renderOrder = 2;
    this.group.add(panel);
    const frame = new THREE.Mesh(this.track(new THREE.BoxGeometry(0.06, 2.12, 0.04)), this.track(new THREE.MeshStandardMaterial({ color: '#3b404b', roughness: 0.4 })));
    frame.position.set(0, 0, this.grid.at(x, y - 1) === 'D' ? -0.48 : 0.48);
    panel.add(frame);
    this.exitDoors.push({ mesh: panel, baseZ: y + 0.5, dir: this.grid.at(x, y - 1) === 'D' ? 1 : -1, open: 0, target: 0 });
  }

  meetingTable(B, box) {
    const { rng } = this;
    const w = box.maxX - box.minX;
    const d = box.maxY - box.minY;
    const cx = (box.minX + box.maxX) / 2;
    const cz = (box.minY + box.maxY) / 2;
    B.at(cx, cz);
    const tw = w - 0.5;
    const td = d - 0.7;
    B.rbox('gloss', '#c9a57c', 0, 0.64, 0, tw, 0.05, td, 0.02);
    B.box('matte', '#6d737d', -tw / 2 + 0.3, 0.32, 0, 0.08, 0.62, td * 0.6);
    B.box('matte', '#6d737d', tw / 2 - 0.3, 0.32, 0, 0.08, 0.62, td * 0.6);
    const n = Math.max(1, Math.round(tw / 0.8));
    for (let i = 0; i < n; i++) {
      const px = -tw / 2 + (i + 0.5) * (tw / n);
      for (const side of [-1, 1]) {
        const saved = B.base;
        B.base = mulM(saved, M(px, 0, side * (td / 2 + 0.12), 0, side > 0 ? Math.PI : 0, 0));
        B.rbox('matte', '#e3e0da', 0, 0.44, 0, 0.4, 0.06, 0.38, 0.02);
        B.rbox('matte', '#e3e0da', 0, 0.7, -0.18, 0.4, 0.4, 0.05, 0.02);
        B.cyl('metal', '#9aa1ab', 0, 0.22, 0, 0.02, 0.02, 0.42, 6);
        B.base = saved;
        if (rng() < 0.6) B.box('metal', '#c3c8cf', px, 0.675, side * (td / 2 - 0.22), 0.3, 0.012, 0.22);
        if (rng() < 0.4) B.cyl('gloss', '#ffffff', px + 0.2, 0.71, side * (td / 2 - 0.2), 0.035, 0.03, 0.08, 8);
      }
    }
    B.cyl('matte', '#2d3139', 0, 0.68, 0, 0.12, 0.14, 0.03, 3);
  }

  bossDesk(B, box) {
    const w = box.maxX - box.minX;
    const cx = (box.minX + box.maxX) / 2;
    const cz = (box.minY + box.maxY) / 2;
    B.at(cx, cz);
    B.rbox('gloss', '#6d4b35', 0, 0.74, 0, w - 0.06, 0.07, 0.86, 0.02);
    B.box('matte', '#5a3c2a', 0, 0.37, 0.36, w - 0.2, 0.7, 0.05);
    B.box('matte', '#5a3c2a', -w / 2 + 0.12, 0.37, 0, 0.08, 0.72, 0.8);
    B.box('matte', '#5a3c2a', w / 2 - 0.12, 0.37, 0, 0.08, 0.72, 0.8);
    B.box('matte', '#d4af37', 0, 0.55, 0.39, w - 0.5, 0.02, 0.01);
    // 机上
    B.rbox('gloss', PAL.monitor, -0.5, 0.98, -0.2, 0.56, 0.34, 0.03, 0.012, 0, 0.2);
    B.screen(7, -0.5, 0.98, -0.182, 0.5, 0.3, 0, 0.2);
    B.box('matte', '#30343c', -0.5, 0.8, -0.24, 0.04, 0.12, 0.04);
    B.box('matte', '#a38a6a', 0.55, 0.8, 0.05, 0.36, 0.06, 0.28);
    B.box('matte', '#a38a6a', 0.55, 0.88, 0.05, 0.36, 0.06, 0.28);
    for (let i = 0; i < 4; i++) B.box('matte', '#ffffff', 0.55, 0.795 + i * 0.012, 0.05, 0.3, 0.008, 0.24);
    B.ball('gloss', '#d8342a', 0.05, 0.92, -0.25, 0.14, 0.16, 0.14, 14);
    B.ball('gloss', '#fff4e6', 0.05, 0.95, -0.14, 0.09, 0.08, 0.04, 12);
    B.ball('matte', '#111111', 0.02, 0.97, -0.105, 0.015, 0.02, 0.01, 6);
    B.cyl('metal', '#d4af37', -0.05, 0.8, 0.25, 0.05, 0.05, 0.04, 10);
    // 椅子（背の高い革張り）
    B.rbox('gloss', '#1d1f24', 0, 0.48, -0.95, 0.62, 0.12, 0.56, 0.05);
    B.rbox('gloss', '#1d1f24', 0, 0.98, -1.2, 0.64, 0.9, 0.14, 0.06, -0.1);
    B.cyl('metal', '#6d737d', 0, 0.27, -0.95, 0.03, 0.03, 0.34, 6);
    // 名札
    const plate = new THREE.Mesh(this.track(new THREE.PlaneGeometry(0.6, 0.15)),
      this.track(new THREE.MeshStandardMaterial({ map: this.track(textTexture(this.stage.deskNames?.[this.spawns.desks.length] || this.stage.deskName || '部長  大河原', { w: 384, h: 96, bg: '#2a1c14', color: '#e8c872', font: '800 44px "M PLUS Rounded 1c", sans-serif', radius: 6 })), roughness: 0.4 })));
    plate.position.set(cx, 0.86, cz + 0.33);
    plate.rotation.x = -0.35;
    this.group.add(plate);
    const desk = { x: cx, z: cz - 0.95, front: { x: cx, z: cz + 1.1 } };
    this.spawns.desks.push(desk);
    this.spawns.boss ??= desk;
  }

  whiteboard(B, box) {
    const w = box.maxX - box.minX;
    const cx = (box.minX + box.maxX) / 2;
    const cz = (box.minY + box.maxY) / 2;
    B.at(cx, cz);
    B.box('metal', '#aab2bd', 0, 1.3, 0, w - 0.1, 0.96, 0.05);
    B.box('metal', '#9aa1ab', 0, 0.8, 0.06, w - 0.2, 0.03, 0.1);
    for (const sx of [-1, 1]) {
      B.box('metal', '#9aa1ab', sx * (w / 2 - 0.15), 0.45, 0, 0.04, 0.9, 0.04);
      B.box('metal', '#9aa1ab', sx * (w / 2 - 0.15), 0.02, 0, 0.06, 0.04, 0.5);
    }
    const board = new THREE.Mesh(this.track(new THREE.PlaneGeometry(w - 0.2, 0.86)),
      this.track(new THREE.MeshStandardMaterial({ map: this.track(whiteboardTexture(box.minX)), roughness: 0.3 })));
    board.position.set(cx, 1.3, cz + 0.03);
    this.group.add(board);
  }

  signs(B) {
    for (const s of this.stage.signs || []) {
      const tex = this.track(textTexture(s.text, {
        w: 512, h: 140, radius: 22,
        bg: s.accent ? '#e0402f' : '#ffffff',
        color: s.accent ? '#ffffff' : '#1b2340',
        border: s.accent ? null : '#1b2340', borderW: 8,
        font: '800 70px "M PLUS Rounded 1c", sans-serif',
      }));
      const mat = this.track(new THREE.MeshStandardMaterial({ map: tex, roughness: 0.6, side: THREE.DoubleSide }));
      const plate = new THREE.Mesh(this.track(new THREE.PlaneGeometry(1.7, 0.465)), mat);
      plate.position.set(s.x, 2.8, s.y);
      plate.castShadow = true;
      this.group.add(plate);
      B.at(s.x, s.y);
      for (const sx of [-0.7, 0.7]) B.box('metal', '#8a919c', sx, 3.55, 0, 0.012, 1.0, 0.012);
    }
  }

  clock() {
    const x = (this.stage.clockX ?? 20) + 0.5;
    const group = new THREE.Group();
    group.position.set(x, 2.55, 1.35);
    const face = new THREE.Mesh(this.track(new THREE.CircleGeometry(0.36, 40)),
      this.track(new THREE.MeshStandardMaterial({ map: this.track(clockTexture()), roughness: 0.4 })));
    face.position.z = 0.035;
    const rim = new THREE.Mesh(this.track(new THREE.CylinderGeometry(0.39, 0.39, 0.07, 40)), this.track(new THREE.MeshStandardMaterial({ color: '#1b2340', roughness: 0.4 })));
    rim.rotation.x = Math.PI / 2;
    const handMat = this.track(new THREE.MeshStandardMaterial({ color: '#1b2340' }));
    const mk = (len, w) => {
      const g = this.track(new THREE.BoxGeometry(w, len, 0.012));
      g.translate(0, len / 2 - 0.03, 0);
      const m = new THREE.Mesh(g, handMat);
      m.position.z = 0.05;
      return m;
    };
    const hour = mk(0.2, 0.035);
    const minute = mk(0.29, 0.022);
    const rod = new THREE.Mesh(this.track(new THREE.BoxGeometry(0.02, 0.6, 0.02)), handMat);
    rod.position.y = 0.66;
    group.add(rim, face, hour, minute, rod);
    group.traverse((o) => { if (o.isMesh) o.castShadow = true; });
    this.group.add(group);
    this.clockHands = { hour, minute };
  }

  posters() {
    const { rng } = this;
    for (let y = 3; y < this.H - 3; y += 7) {
      for (const x of [0, this.W - 1]) {
        if (this.grid.at(x, y) !== '#' || !this.grid.isWalk(x === 0 ? 1 : x - 1, y)) continue;
        if (rng() < 0.3) continue;
        const kind = Math.floor(rng() * 4);
        const mat = this.track(new THREE.MeshStandardMaterial({ map: this.track(posterTexture(kind)), roughness: 0.5 }));
        const p = new THREE.Mesh(this.track(new THREE.PlaneGeometry(0.7, 0.98)), mat);
        p.position.set(x === 0 ? 1.01 : x - 0.01, 1.55, y + 0.5);
        p.rotation.y = x === 0 ? Math.PI / 2 : -Math.PI / 2;
        this.group.add(p);
        const f = new THREE.Mesh(this.track(new THREE.BoxGeometry(0.03, 1.06, 0.78)), this.track(new THREE.MeshStandardMaterial({ color: '#23262d' })));
        f.position.set(x === 0 ? 1.0 : x, 1.55, y + 0.5);
        this.group.add(f);
      }
    }
  }

  // -------------------------------------------------------------------------
  buildLights() {
    const p = this.preset;
    this.hemi = new THREE.HemisphereLight(p.hemiSky, p.hemiGround, p.hemi);
    this.group.add(this.hemi);
    const sun = new THREE.DirectionalLight(p.sun, p.sunI);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    const S = 15;
    Object.assign(sun.shadow.camera, { left: -S, right: S, top: S, bottom: -S, near: 1, far: 80 });
    sun.shadow.bias = -0.0004;
    sun.shadow.normalBias = 0.03;
    sun.shadow.radius = 3;
    this.sunDir = new THREE.Vector3(...p.sunDir).normalize();
    this.group.add(sun, sun.target);
    this.sun = sun;
    if (p.playerLight) {
      // 夜は主人公のまわりだけ、デスクライトのように明るくする
      this.playerLight = new THREE.PointLight('#ffd9a0', 9, 9, 1.6);
      this.playerLight.position.set(0, 3, 0);
      this.group.add(this.playerLight);
    }
    this.shadowSpan = S;
    // 影カメラの基底（テクセルスナップ用）
    const fwd = this.sunDir.clone().negate();
    this.lsRight = new THREE.Vector3().crossVectors(fwd, new THREE.Vector3(0, 1, 0)).normalize();
    this.lsUp = new THREE.Vector3().crossVectors(this.lsRight, fwd).normalize();
    this.updateShadow(new THREE.Vector3(this.W / 2, 0, this.H / 2));
  }

  updateShadow(target) {
    const texel = (this.shadowSpan * 2) / 2048;
    const r = target.dot(this.lsRight);
    const u = target.dot(this.lsUp);
    const f = target.dot(this.sunDir);
    const rs = Math.round(r / texel) * texel;
    const us = Math.round(u / texel) * texel;
    const snapped = new THREE.Vector3()
      .addScaledVector(this.lsRight, rs)
      .addScaledVector(this.lsUp, us)
      .addScaledVector(this.sunDir, f);
    this.sun.target.position.copy(snapped);
    this.sun.position.copy(snapped).addScaledVector(this.sunDir, 30);
    this.sun.target.updateMatrixWorld();
  }

  buildBackdrop() {
    const p = this.preset;
    const tex = this.track(cityTexture(p));
    const mat = this.track(new THREE.MeshBasicMaterial({ map: tex, fog: false }));
    const plane = new THREE.Mesh(this.track(new THREE.PlaneGeometry(this.W + 40, 30)), mat);
    plane.position.set(this.W / 2, 1, -4);
    this.group.add(plane);
    this.background = this.track(gradientBackground(p.bgTop, p.bgBottom));
  }

  buildGoal() {
    const g = this.spawns.goal;
    const group = new THREE.Group();
    group.position.set(g.x, 0, g.z);
    const ringMat = this.track(new THREE.MeshBasicMaterial({ color: new THREE.Color('#ffd84d').multiplyScalar(1.6), transparent: true, opacity: 0.9, depthWrite: false }));
    const ring = new THREE.Mesh(this.track(new THREE.RingGeometry(0.5, 0.64, 48)), ringMat);
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = 0.02;
    const disc = new THREE.Mesh(this.track(new THREE.CircleGeometry(0.5, 40)),
      this.track(new THREE.MeshBasicMaterial({ color: '#ffd84d', transparent: true, opacity: 0.25, depthWrite: false })));
    disc.rotation.x = -Math.PI / 2;
    disc.position.y = 0.015;
    const beam = new THREE.Mesh(this.track(new THREE.CylinderGeometry(0.55, 0.62, 3.2, 32, 1, true)),
      this.track(new THREE.MeshBasicMaterial({ color: '#ffe59a', alphaMap: this.track(beamTexture()), transparent: true, opacity: 0.55, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide })));
    beam.position.y = 1.6;
    const arrow = new THREE.Group();
    const cone = new THREE.Mesh(this.track(new THREE.ConeGeometry(0.22, 0.4, 4)), this.track(new THREE.MeshStandardMaterial({ color: '#ffd84d', emissive: '#ff9f1c', emissiveIntensity: 0.6, roughness: 0.4 })));
    cone.rotation.x = Math.PI;
    arrow.add(cone);
    arrow.position.y = 2.1;
    group.add(disc, ring, beam, arrow);
    this.group.add(group);
    this.goalFx = { group, ring, beam, arrow };
  }

  // -------------------------------------------------------------------------
  update(dt, t, clockMin, player) {
    if (this.goalFx) {
      const s = 1 + Math.sin(t * 4) * 0.08;
      this.goalFx.ring.scale.set(s, s, s);
      this.goalFx.arrow.position.y = 2.1 + Math.sin(t * 3) * 0.12;
      this.goalFx.arrow.rotation.y = t * 1.5;
    }
    if (this.clockHands && clockMin != null) {
      const m = clockMin % 60;
      const h = (clockMin / 60) % 12;
      this.clockHands.minute.rotation.z = -(m / 60) * Math.PI * 2;
      this.clockHands.hour.rotation.z = -(h / 12) * Math.PI * 2;
    }
    for (const w of this.workers) {
      if (player) {
        const dx = player.x - w.root.position.x;
        const dz = player.z - w.root.position.z;
        const d2 = dx * dx + dz * dz;
        if (d2 < 7) {
          const rel = Math.atan2(dx, dz) - w.yaw;
          const a = Math.atan2(Math.sin(rel), Math.cos(rel));
          w.headYaw = clamp(a, -1.1, 1.1);
          w.pose = 'sit';
        } else {
          w.headYaw = 0;
          w.pose = 'type';
        }
      }
      w.update(dt);
    }
    for (const e of this.elevators) {
      e.open += (e.target - e.open) * Math.min(1, dt * 3);
      const sc = 1 - e.open * 0.92;
      e.doors[0].scale.x = sc;
      e.doors[1].scale.x = -sc;
    }
    for (const d of this.exitDoors) {
      d.open += (d.target - d.open) * Math.min(1, dt * 3);
      d.mesh.position.z = d.baseZ + d.dir * d.open * 0.85;
    }
  }

  nearestElevator(x, z) {
    let best = null;
    let bd = Infinity;
    for (const e of this.elevators) {
      const d = Math.hypot(e.x - x, e.z - z);
      if (d < bd) {
        bd = d;
        best = e;
      }
    }
    return best;
  }

  dispose() {
    for (const w of this.workers) disposeTree(w.root, SHARED);
    this.group.traverse((o) => {
      if (o.geometry && this.own.has(o.geometry)) o.geometry.dispose();
    });
    for (const o of this.own) if (o.dispose && !o.isBufferGeometry) o.dispose();
    this.group.removeFromParent();
  }
}
