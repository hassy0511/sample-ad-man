import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { STAGES, CHAPTERS } from './levels.js';
import { CAST, BOSS, PLAYER_LOOK, GOAL_NPC, RALLY_REJECT, ALLY, COPIER } from './cast.js';
import { World } from './world.js';
import { Player } from './player.js';
import { Enemy } from './enemies.js';
import { Character, renderPortraits } from './characters.js';
import { FX } from './effects.js';
import { Input } from './input.js';
import { Audio } from './audio.js';
import { UI } from './ui.js';
import { Post } from './post.js';
import { setupPwa } from './pwa.js';
import { Ally } from './ally.js';
import { ITEMS, itemMesh } from './items.js';
import { Traffic } from './traffic.js';
import { Weather } from './rain.js';
import { clamp, damp, lerp, smooth, pick, textTexture } from './util.js';

const RANK_ORDER = ['C', 'B', 'A', 'S'];
const PITCH = 0.93;
const TEMPO = { 1: 108, 2: 116, 3: 124, 13: 112, 14: 120, 15: 128 };

class Game {
  constructor() {
    const canvas = document.getElementById('gl');
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.renderer.toneMapping = THREE.NeutralToneMapping;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(34, 1, 0.5, 140);
    const pmrem = new THREE.PMREMGenerator(this.renderer);
    this.scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    pmrem.dispose();

    this.input = new Input();
    this.audio = new Audio();
    this.ui = new UI(this);
    this.fx = new FX(this.scene);
    this.post = new Post(this.renderer, this.scene, this.camera);
    this.ui.setTouch(this.input.touch);
    this.ui.setMuted(this.audio.muted);

    this.state = 'loading';
    this.stageIndex = 0;
    this.enemies = [];
    this.cam = {
      target: new THREE.Vector3(10, 0, 10), goalTarget: new THREE.Vector3(),
      scale: 1, goalScale: 1, yaw: 0, goalYaw: 0, shake: 0, offset: new THREE.Vector3(),
    };
    this.time = 0;
    this.timeScale = 1;
    this.slowT = 0;
    this.auraLevel = 0;
    this.best = {};
    try {
      this.best = JSON.parse(localStorage.getItem('surusuru-best') || '{}') || {};
    } catch (e) {
      this.best = {};
    }
    this.stats = { met: {}, caught: {}, dodged: {} };
    try {
      const st = JSON.parse(localStorage.getItem('surusuru-stats') || 'null');
      if (st) this.stats = { met: st.met || {}, caught: st.caught || {}, dodged: st.dodged || {} };
    } catch (e) { /* 保存できない環境 */ }
    this.perf = { t: 0, frames: 0, level: this.input.touch ? 1 : 0 };

    this.bindUi();
    addEventListener('resize', () => this.resize());
    document.addEventListener('visibilitychange', () => {
      if (document.hidden && this.state === 'play') this.pause(true);
    });
    this.resize();
  }

  bindUi() {
    // 最初のタップ／キー入力で音を解放する（ブラウザの自動再生制限対策）
    const unlock = () => this.audio.unlock();
    addEventListener('pointerdown', unlock, true);
    addEventListener('keydown', unlock, true);
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden && this.audio.ctx) this.audio.unlock();
    });
    const soundToggle = () => {
      this.audio.unlock();
      this.audio.setMuted(!this.audio.muted);
      this.ui.setMuted(this.audio.muted);
    };
    document.getElementById('btn-sound').addEventListener('click', soundToggle);
    document.getElementById('btn-sound-title').addEventListener('click', soundToggle);
    document.getElementById('btn-pause').addEventListener('click', () => this.pause(true));
    document.getElementById('btn-book').addEventListener('click', () => {
      this.audio.unlock();
      this.audio.click();
      this.ui.book(this.stats, () => this.ui.show('screen-title'));
    });
    document.getElementById('btn-resume').addEventListener('click', () => this.pause(false));
    document.getElementById('btn-pause-retry').addEventListener('click', () => {
      this.ui.show(null);
      this.toIntro(this.stageIndex);
    });
    document.getElementById('btn-pause-title').addEventListener('click', () => this.toTitle());
    document.getElementById('dialogue').addEventListener('pointerdown', (e) => {
      e.preventDefault();
      this.advanceTalk();
    });
    this.input.on('confirm', (e) => {
      if (this.talk) {
        e.preventDefault();
        this.advanceTalk();
      } else if (this.state === 'intro' && e.code === 'Enter') {
        e.preventDefault();
        this.startStage();
      }
    });
    this.input.on('pause', () => {
      if (this.state === 'play') this.pause(true);
      else if (this.state === 'paused') this.pause(false);
    });
  }

  resize() {
    const w = innerWidth;
    const h = innerHeight;
    const cap = [2, 1.5, 1.1][this.perf.level] ?? 1;
    const pr = Math.min(devicePixelRatio || 1, cap);
    this.renderer.setPixelRatio(pr);
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.post.setSize(w, h, pr);
  }

  async boot() {
    const sample = '部長大河原営業課経理部会議室エレベーター出口シュレッダー至急ブレスト夏キャンペーン今期売上認知バズ広告賞〆切は守るもの社内標語第回最優秀を飲みほせ';
    const fonts = Promise.all([
      document.fonts.load('800 40px "M PLUS Rounded 1c"', sample),
      document.fonts.load('40px "Dela Gothic One"', 'SALEGOLD〆切夏を飲みほせTHINKBIG50%'),
    ]).catch(() => {});
    await Promise.race([fonts, new Promise((r) => setTimeout(r, 3500))]);

    const looks = Object.fromEntries(Object.entries(CAST).map(([k, v]) => [k, v.look]));
    looks.boss = BOSS.look;
    looks.kacho = GOAL_NPC.kacho.look;
    looks.ally = ALLY.look;
    looks.judge = GOAL_NPC.judge.look;
    looks.jomu = GOAL_NPC.jomu.look;
    looks.player = PLAYER_LOOK;
    try {
      this.ui.portraits = renderPortraits(looks);
    } catch (e) {
      this.ui.portraits = {};
    }
    this.toTitle();
    this.ui.loaded();
    this.last = performance.now();
    this.renderer.setAnimationLoop((t) => this.frame(t));
  }

  // -------------------------------------------------------------------------
  // ステージの読み込み
  // -------------------------------------------------------------------------
  loadStage(i, { demo = false } = {}) {
    this.clearStage();
    const stage = STAGES[i];
    this.stageIndex = i;
    this.stage = stage;
    this.world = new World(stage, this.renderer);
    this.scene.add(this.world.group);
    const p = this.world.preset;
    this.scene.background = this.world.background;
    this.scene.fog = new THREE.Fog(p.fog, 38, 80);
    this.scene.environmentIntensity = p.env;
    this.renderer.toneMappingExposure = p.exposure;
    this.post.setPreset(p);

    this.player = new Player(this, stage.item);
    const sp = this.world.spawns.player;
    this.player.place(sp.x, sp.z, this.initialYaw(sp));

    const count = {};
    this.enemies = this.world.spawns.enemies.map((s) => {
      count[s.code] = count[s.code] || 0;
      const route = stage.patrols?.[s.code]?.[count[s.code]++];
      return new Enemy(this, s, route);
    });

    this.boss = null;
    if ((stage.goalType === 'boss' || stage.goalType === 'desk') && this.world.spawns.boss) {
      this.goalNpc = GOAL_NPC[stage.goalNpc || 'boss'];
      const b = new Character(this.goalNpc.look, { outline: true });
      const bp = this.world.spawns.boss;
      b.root.position.set(bp.x, 0.06, bp.z);
      b.setYaw(0);
      b.pose = 'sit';
      this.scene.add(b.root);
      this.boss = b;
    }

    // 信号と車（屋外ステージ）
    this.traffic = stage.outdoor ? new Traffic(this) : null;

    // 雨と濡れた床
    const wetStage = stage.rain || stage.rainOutside || stage.map.some((r) => r.includes('~')) || this.world.spawns.enemies.some((e) => e.type === 'cleaner');
    this.weather = wetStage ? new Weather(this) : null;
    this.splashCD = 0;

    // 空き会議室さがし
    this.rooms = null;
    if (stage.goalType === 'rooms' && this.world.spawns.rooms?.length) {
      const list = this.world.spawns.rooms.map((r, i) => {
        const name = stage.rooms?.[i] || `会議室${i + 1}`;
        const opt = (bg) => ({ w: 384, h: 96, bg, color: '#ffffff', font: '800 40px "M PLUS Rounded 1c", sans-serif', radius: 16 });
        const tex = { free: textTexture(`${name} 空き`, opt('#2e9e5b')), busy: textTexture(`${name} 使用中`, opt('#c0392b')) };
        const sign = new THREE.Mesh(new THREE.PlaneGeometry(1.6, 0.4), new THREE.MeshBasicMaterial({ map: tex.busy, depthTest: false, transparent: true }));
        sign.position.set(r.x, 2.3, r.z);
        sign.renderOrder = 5;
        this.scene.add(sign);
        return { ...r, pos: { x: r.x, z: r.z }, name, tex, sign };
      });
      const sp0 = this.world.spawns.player;
      const far = list.map((r, i) => i).filter((i) => Math.hypot(list[i].x - sp0.x, list[i].z - sp0.z) > 14);
      const pool = far.length ? far : list.map((r, i) => i);
      this.rooms = { list, free: pool[Math.floor(Math.random() * pool.length)], t: 0, period: 8, noteT: 0 };
      this.setRoomSigns();
      Object.assign(this.world.spawns.goal, { x: list[this.rooms.free].x, z: list[this.rooms.free].z });
      this.world.goalFx.group.position.set(list[this.rooms.free].x, 0, list[this.rooms.free].z);
    }

    // 置き傘を取ってから帰る
    this.fetch = null;
    if (stage.goalType === 'fetch' && this.world.spawns.fetch) {
      const f = this.world.spawns.fetch;
      this.fetch = { phase: 'find', progress: 0, noteT: 0, tick: 0, pos: { x: f.x, z: f.z } };
      this.world.goalFx.group.position.set(f.x, 0, f.z);
    }

    // 味方のエース新人
    this.ally = this.world.spawns.ally && !demo ? new Ally(this, this.world.spawns.ally) : null;

    // コピー機探し
    this.print = null;
    this.printing = false;
    if (stage.goalType === 'print' && this.world.copiers?.length) {
      const sp0 = this.world.spawns.player;
      const far = this.world.copiers.map((c, i) => i).filter((i) => {
        const c = this.world.copiers[i];
        return Math.hypot(c.x - sp0.x, c.z - sp0.z) > 12;
      });
      const pickFrom = far.length ? far : this.world.copiers.map((c, i) => i);
      const working = demo ? -1 : pickFrom[Math.floor(Math.random() * pickFrom.length)];
      this.print = {
        copiers: this.world.copiers.map((c, i) => ({ ...c, pos: { x: c.x, z: c.z }, working: i === working, checked: false })),
        phase: 'find',
        progress: 0,
        noteT: 0,
      };
    }

    // ハンコラリーの決裁者
    this.rally = null;
    if (stage.goalType === 'rally') {
      this.rally = stage.rally.map((r) => {
        const d = this.world.spawns.desks[r.desk];
        const npc = GOAL_NPC[r.npc];
        const c = new Character(npc.look, { outline: true });
        c.root.position.set(d.x, 0.06, d.z);
        c.setYaw(0);
        c.pose = 'sit';
        this.scene.add(c.root);
        return { ...r, d, npc, char: c, pos: { x: d.x, z: d.z }, done: false };
      });
      this.rallyIdx = 0;
      this.rallyNoteT = 0;
      const f = this.rally[0].d.front;
      this.world.goalFx.group.position.set(f.x, 0, f.z);
    }

    // シュレッダーの目印
    this.shredMarks = this.world.shredders.map((s) => {
      const m = new THREE.Mesh(new THREE.RingGeometry(0.75, 0.9, 40), new THREE.MeshBasicMaterial({ color: '#ffd84d', transparent: true, opacity: 0, depthWrite: false }));
      m.rotation.x = -Math.PI / 2;
      m.position.set(s.x + Math.sin(s.yaw) * 0.9, 0.04, s.z + Math.cos(s.yaw) * 0.9);
      this.scene.add(m);
      return m;
    });

    // カバンに入るアイテム
    this.itemPicks = (this.world.spawns.items || []).map((it) => {
      const g = itemMesh(it.id);
      g.position.set(it.x, 0.65, it.z);
      this.scene.add(g);
      return { ...it, g, taken: false, noteT: 0 };
    });

    // 缶コーヒー
    this.pickups = this.world.spawns.pickups.map((p) => {
      const g = new THREE.Group();
      const can = new THREE.Mesh(new THREE.CylinderGeometry(0.11, 0.11, 0.3, 16), new THREE.MeshStandardMaterial({ color: '#7a3b1f', roughness: 0.35, metalness: 0.4 }));
      const band = new THREE.Mesh(new THREE.CylinderGeometry(0.112, 0.112, 0.1, 16), new THREE.MeshStandardMaterial({ color: '#f2d27a', roughness: 0.4, metalness: 0.3 }));
      const ring = new THREE.Mesh(new THREE.RingGeometry(0.34, 0.42, 32), new THREE.MeshBasicMaterial({ color: '#ffd98a', transparent: true, opacity: 0.8, depthWrite: false }));
      can.castShadow = true;
      ring.rotation.x = -Math.PI / 2;
      ring.position.y = -0.62;
      g.add(can, band, ring);
      g.position.set(p.x, 0.65, p.z);
      this.scene.add(g);
      return { g, x: p.x, z: p.z, taken: false };
    });

    this.demo = demo;
    this.clock = stage.start;
    this.caught = 0;
    this.dodges = 0;
    this.penaltyAnim = 0;
    this.talk = null;
    this.script = null;
    this.goalReached = false;
    this.auraLevel = 0;
    this.lastTile = -1;
    this.playerField = null;
    this.cam.target.set(sp.x, 0, sp.z);
    this.updatePlayerField();
  }

  initialYaw(sp) {
    const g = this.world.grid;
    let best = Math.PI;
    let bd = -1;
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2;
      const d = g.sightDistance(sp.x, sp.z, Math.sin(a), Math.cos(a), 8);
      if (d > bd + 0.2) {
        bd = d;
        best = a;
      }
    }
    return best;
  }

  clearStage() {
    for (const e of this.enemies) e.dispose();
    this.enemies = [];
    this.player?.dispose();
    this.player = null;
    this.ally?.dispose();
    this.ally = null;
    this.traffic?.dispose();
    this.traffic = null;
    this.weather?.dispose();
    this.weather = null;
    for (const r of this.rooms?.list || []) {
      r.sign.removeFromParent();
      r.sign.geometry.dispose();
      r.sign.material.dispose();
      r.tex.free.dispose();
      r.tex.busy.dispose();
    }
    this.rooms = null;
    this.fetch = null;
    for (const c of this.print?.copiers || []) {
      if (c.sign) {
        c.sign.removeFromParent();
        c.sign.geometry.dispose();
        c.sign.material.map.dispose();
        c.sign.material.dispose();
      }
    }
    this.print = null;
    this.printing = false;
    this.ui.setProgress(null);
    for (const r of this.rally || []) {
      r.char.root.removeFromParent();
      for (const m of r.char.meshes) m.geometry.dispose();
    }
    this.rally = null;
    if (this.boss) {
      this.boss.root.removeFromParent();
      for (const m of this.boss.meshes) m.geometry.dispose();
      this.boss = null;
    }
    for (const p of [...(this.pickups || []), ...(this.itemPicks || [])]) {
      p.g.removeFromParent();
      p.g.traverse((o) => {
        if (o.isMesh) {
          o.geometry.dispose();
          o.material.dispose();
        }
      });
    }
    this.pickups = [];
    this.itemPicks = [];
    for (const m of this.shredMarks || []) {
      m.removeFromParent();
      m.geometry.dispose();
      m.material.dispose();
    }
    this.shredMarks = [];
    this.world?.dispose();
    this.world = null;
    this.fx.clear();
    this.ui.clearWorld();
    this.ui.closeDialogue();
    this.ui.aura(0);
  }

  // -------------------------------------------------------------------------
  // 画面遷移
  // -------------------------------------------------------------------------
  toTitle(ending = false) {
    this.state = 'title';
    this.ui.hud(false);
    this.ui.closeDialogue();
    this.ui.loading(true);
    requestAnimationFrame(() => {
      const ch = this.chapter || 1;
      const bg = ending ? STAGES.findLastIndex((st) => st.chapter === ch) : STAGES.findIndex((st) => st.chapter === ch);
      this.loadStage(Math.max(0, bg), { demo: true });
      this.ui.loading(false);
      this.ui.title(STAGES, CHAPTERS, ch, this.best, (c) => {
        this.chapter = c;
      }, (i) => {
        this.audio.unlock();
        this.audio.click();
        this.toIntro(i);
      });
      if (ending) {
        this.ui.toast(CHAPTERS.find((c) => c.id === ch)?.ending || '本日の業務、完了！');
        this.fx.confettiBurst(this.player.pos.x, this.player.pos.z, 140);
        this.audio.clear();
      }
      this.audio.startMusic('title', 96);
    });
  }

  toIntro(i) {
    this.chapter = STAGES[i].chapter;
    this.ui.hud(false);
    this.ui.closeDialogue();
    const go = () => {
      this.loadStage(i);
      this.state = 'intro';
      this.introT = 0;
      const types = [...new Set(this.world.spawns.enemies.map((e) => e.type))]
        .sort((a, b) => CAST[b].power - CAST[a].power);
      this.ui.intro(STAGES[i], types, () => this.startStage(), () => this.toTitle(), !!this.world.spawns.ally);
      this.audio.startMusic('title', 96);
    };
    this.ui.loading(true);
    requestAnimationFrame(() => {
      go();
      this.ui.loading(false);
    });
  }

  startStage() {
    if (this.state !== 'intro') return;
    this.audio.unlock();
    this.audio.click();
    this.ui.show(null);
    this.ui.hud(true, this.stage);
    this.ui.setAlly(false);
    this.onItemsChanged();
    for (const e of this.enemies) this.record('met', e.type);
    if (this.rally) this.ui.setRally(this.rally, 0, `${this.rally[0].label}席`);
    if (this.print) this.ui.setGoalLabel('動くコピー機');
    if (this.rooms) this.ui.setGoalLabel(this.rooms.list[this.rooms.free].name);
    if (this.fetch) this.ui.setGoalLabel(this.stage.fetchLabel);
    this.state = 'flyover';
    this.flyT = 0;
    this.input.reset();
    const g = this.flyGoal();
    this.ui.float(g.x, 2.6, g.z, this.fetch ? `まずは：${this.stage.fetchLabel}` : this.rooms ? `いま空いている：${this.rooms.list[this.rooms.free].name}` : `ゴール：${this.stage.goalLabel}`, 'good');
    this.audio.startMusic('play', TEMPO[this.stage.id]);
    this.audio.setTension(false);
  }

  pause(on) {
    if (on && this.state === 'play') {
      this.state = 'paused';
      this.ui.show('screen-pause');
      this.audio.stopMusic();
    } else if (!on && this.state === 'paused') {
      this.state = 'play';
      this.ui.show(null);
      this.input.reset();
      this.audio.startMusic('play', TEMPO[this.stage.id]);
    }
  }

  // -------------------------------------------------------------------------
  // ループ
  // -------------------------------------------------------------------------
  frame(now) {
    let dt = Math.min(0.05, (now - this.last) / 1000);
    this.last = now;
    if (this.slowT > 0) {
      this.slowT -= dt;
      dt *= 0.35;
    }
    this.time += dt;
    this.input.update();
    this.update(dt);
    this.ui.update(dt, this.camera);
    this.post.render(dt);
    this.trackPerf(dt);
  }

  trackPerf(dt) {
    if (this.state !== 'play' || this.perf.level >= 2) return;
    this.perf.t += dt;
    this.perf.frames++;
    if (this.perf.t > 4) {
      const fps = this.perf.frames / this.perf.t;
      this.perf.t = 0;
      this.perf.frames = 0;
      if (fps < 40) {
        this.perf.level++;
        if (this.perf.level >= 1) this.post.enabled = false;
        if (this.perf.level >= 2) {
          this.world.sun.shadow.mapSize.set(1024, 1024);
          this.world.sun.shadow.map?.dispose();
          this.world.sun.shadow.map = null;
        }
        this.resize();
      }
    }
  }

  update(dt) {
    if (!this.world) return;
    const st = this.state;
    const P = this.player;

    if (st === 'play') this.updatePlay(dt);
    else if (st === 'talk') this.updateTalk(dt);
    else if (st === 'goalSeq') this.updateGoalSeq(dt);
    else if (st === 'flyover') this.updateFlyover(dt);
    else if (st === 'paused') {
      this.renderCamera(0);
      return;
    } else {
      // タイトル・説明・結果：背景として動かす
      for (const e of this.enemies) {
        if (this.demo || st === 'intro') e.demoUpdate(dt);
        else e.idle(dt);
      }
      P.frozen = true;
      P.update(dt, this.input);
      this.boss?.update(dt);
    }

    this.world.update(dt, this.time, this.clock, P ? P.pos : null);
    if (this.world.playerLight && P) this.world.playerLight.position.set(P.pos.x, 2.6, P.pos.z + 0.4);
    for (const r of this.rally || []) r.char.update(dt);
    this.ally?.update(dt);
    this.traffic?.update(dt, this.state === 'play' || this.state === 'title' || this.state === 'intro');
    this.weather?.update(dt);
    for (const r of this.rooms?.list || []) r.sign.quaternion.copy(this.camera.quaternion);
    for (const c of this.print?.copiers || []) if (c.sign) c.sign.quaternion.copy(this.camera.quaternion);
    this.fx.update(dt);
    this.updateCamera(dt);
  }

  // --- 通常プレイ -----------------------------------------------------------
  updatePlay(dt) {
    const P = this.player;
    const stage = this.stage;
    this.clock += dt * stage.rate;
    // 傘で顔を隠している間は、敵の判定より先に「見えない」ことにする
    this.playerHidden = P.umbrellaT > 0;
    this.auraLevel = 0;
    this.updatePlayerField();

    for (const e of this.enemies) e.update(dt);
    P.frozen = false;
    P.update(dt, this.input);
    this.boss?.update(dt);
    this.separate();

    // 社長に呼び止められる
    for (const e of this.enemies) {
      if (e.wantsCatch) {
        e.wantsCatch = false;
        this.startTalk(e, true);
        return;
      }
    }
    P.bowing = this.enemies.some((e) => e.kind === 'shacho' && e.seesPlayer);

    // 缶コーヒー
    for (const p of this.pickups) {
      if (p.taken) continue;
      p.g.rotation.y += dt * 2.5;
      p.g.position.y = 0.65 + Math.sin(this.time * 3 + p.x) * 0.08;
      if (Math.hypot(p.x - P.pos.x, p.z - P.pos.z) < 0.7) {
        p.taken = true;
        p.g.visible = false;
        P.boostT = 6;
        this.fx.sparkle(p.x, 0.8, p.z, 14);
        this.audio.sparkle();
        this.ui.float(P.pos.x, 2.3, P.pos.z, '缶コーヒー！ スピードUP', 'good');
      }
    }

    // アイテムを拾う
    for (const it of this.itemPicks) {
      if (it.taken) continue;
      it.noteT = Math.max(0, it.noteT - dt);
      it.g.rotation.y += dt * 2;
      it.g.position.y = 0.65 + Math.sin(this.time * 3 + it.x) * 0.08;
      if (Math.hypot(it.x - P.pos.x, it.z - P.pos.z) < 0.7) {
        if (P.addItem(it.id)) {
          it.taken = true;
          it.g.visible = false;
          this.fx.sparkle(it.x, 0.8, it.z, 14);
          this.audio.sparkle();
          this.ui.float(P.pos.x, 2.3, P.pos.z, `${ITEMS[it.id].name}をカバンに入れた`, 'good');
          this.onItemsChanged();
        } else if (it.noteT <= 0) {
          it.noteT = 3;
          this.ui.float(P.pos.x, 2.3, P.pos.z, 'カバンがいっぱい', 'info');
        }
      }
    }
    if (P.umbrellaT > 0) this.playerHidden = true;

    // つかまる・すれ違う
    for (const e of this.enemies) {
      const d = Math.hypot(e.pos.x - P.pos.x, e.pos.z - P.pos.z);
      if (e.kind === 'shorui' || e.kind === 'handout') {
        const reach = e.kind === 'handout' ? e.tune.reach : 0.75;
        if (d < reach && e.cool <= 0 && !P.invulnerable && P.umbrellaT <= 0) this.handoff(e);
        continue;
      }
      if (P.umbrellaT > 0) continue;
      if (e.canCatch && d < e.r + P.r + 0.1) {
        if (P.invulnerable) {
          if (P.dashing && !e.nearMissed) this.nearMiss(e);
        } else {
          this.startTalk(e);
          return;
        }
      } else if (P.dashing && e.chasing && !e.nearMissed && d < 1.5) {
        this.nearMiss(e);
      }
    }

    // シュレッダー
    for (let i = 0; i < this.world.shredders.length; i++) {
      const s = this.world.shredders[i];
      const d = Math.hypot(s.x - P.pos.x, s.z - P.pos.z);
      this.shredMarks[i].material.opacity = P.papers > 0 ? 0.55 + Math.sin(this.time * 6) * 0.25 : 0;
      if (P.papers > 0 && d < 1.35) {
        const n = P.clearPapers();
        this.fx.shred(s.x, s.z);
        this.audio.shred();
        this.ui.float(P.pos.x, 2.2, P.pos.z, `シュレッダー！ 書類${n}束 処分`, 'good');
      }
    }

    this.ui.aura(this.auraLevel * 0.9);
    const left = stage.deadline - this.clock;
    this.audio.setTension(left <= 10);
    this.ui.updateHud(this.clock, stage, P.papers, P.dashCD / 0.95, false);
    this.phoneBtn ??= document.getElementById('btn-phone');
    this.phoneBtn.style.setProperty('--cd', P.phoneLeft > 0 ? (P.phoneCD / 4).toFixed(3) : '1');
    if (this.phoneLeftShown !== P.phoneLeft) {
      this.phoneLeftShown = P.phoneLeft;
      this.phoneBtn.querySelector('b').textContent = `残り${P.phoneLeft}`;
      document.getElementById('hint-phone-n').textContent = P.phoneLeft;
    }
    this.phoneBtn.classList.toggle('on', P.phoneT > 0);
    // 印刷中・傘さがし中は目印を出さない（進み具合の表示と重なるため）
    const busy = this.printing || (this.fetch?.phase === 'find' && this.fetch.progress > 0 && Math.hypot(this.fetch.pos.x - P.pos.x, this.fetch.pos.z - P.pos.z) < 1.2);
    this.ui.goalPointer(this.camera, this.currentGoal(), !busy);

    if (this.clock >= stage.deadline) {
      this.fail();
      return;
    }
    if (this.traffic && this.weather) this.updateSplash(dt);
    if (this.rally) {
      if (this.updateRally(dt)) return;
    } else if (this.print) {
      this.updatePrint(dt);
    } else if (this.rooms) {
      this.updateRooms(dt);
    } else if (this.fetch) {
      this.updateFetch(dt);
    } else {
      const g = this.world.spawns.goal;
      if (Math.hypot(g.x - P.pos.x, g.z - P.pos.z) < 0.85) this.reachGoal();
    }

    this.cam.goalTarget.set(P.pos.x + P.vel.x * 0.28, 0, P.pos.z + P.vel.y * 0.28);
    this.cam.goalScale = 1;
    this.cam.goalYaw = 0;
  }

  updatePlayerField() {
    const P = this.player;
    if (!P) return;
    const g = this.world.grid;
    const tx = Math.floor(P.pos.x);
    const tz = Math.floor(P.pos.z);
    const key = tz * g.w + tx;
    if (key !== this.lastTile && g.isWalk(tx, tz)) {
      this.lastTile = key;
      this.playerField = g.field(tx, tz);
    }
  }

  separate() {
    const E = this.enemies;
    for (let i = 0; i < E.length; i++) {
      for (let j = i + 1; j < E.length; j++) {
        const a = E[i].pos;
        const b = E[j].pos;
        const dx = b.x - a.x;
        const dz = b.z - a.z;
        const d = Math.hypot(dx, dz);
        if (d > 0.001 && d < 0.62) {
          const push = (0.62 - d) / 2;
          a.x -= (dx / d) * push;
          a.z -= (dz / d) * push;
          b.x += (dx / d) * push;
          b.z += (dz / d) * push;
        }
      }
    }
  }

  /** 社長の視界に入っているか（ほかの社員が大人しくなる判定） */
  shachoSees(x, z) {
    for (const e of this.enemies) if (e.kind === 'shacho' && e.viewContains(x, z)) return true;
    return false;
  }

  onShachoPass() {
    this.record('dodged', 'shacho');
    const P = this.player;
    this.dodges++;
    this.ui.float(P.pos.x, 2.3, P.pos.z, 'お辞儀でセーフ', 'good');
  }

  record(kind, type) {
    if (!type) return;
    this.stats[kind][type] = kind === 'met' ? true : (this.stats[kind][type] || 0) + 1;
    try {
      localStorage.setItem('surusuru-stats', JSON.stringify(this.stats));
    } catch (err) { /* 保存できない環境 */ }
  }

  nearMiss(e) {
    this.record('dodged', e.type);
    e.nearMissed = true;
    this.dodges++;
    const P = this.player;
    this.ui.float(P.pos.x, 2.3, P.pos.z, 'スルッ！', 'good');
    this.fx.sparkle(P.pos.x, 1, P.pos.z, 12);
    this.audio.sparkle();
    this.slowT = 0.12;
  }

  onItemsChanged() {
    this.ui.setItems(this.player.items, (this.world.spawns.items || []).length > 0);
  }

  onAllyJoin() {
    const P = this.player;
    this.ui.float(P.pos.x, 2.4, P.pos.z, 'エース新人が仲間になった！', 'good');
    this.fx.sparkle(this.ally.pos.x, 1, this.ally.pos.z, 16);
    this.audio.sparkle();
    this.ui.setAlly(true, this.ui.portraits.ally);
  }

  onShinjinTrip(e) {
    this.record('dodged', 'shinjin');
    this.dodges++;
    this.ui.float(e.pos.x, 2.2, e.pos.z, '振り切った！', 'good');
  }

  alertAround(x, z, r, source) {
    for (const e of this.enemies) {
      if (e === source) continue;
      const d = Math.hypot(e.pos.x - x, e.pos.z - z);
      if (d > r) continue;
      const before = e.state;
      e.alert();
      if (e.state !== before) this.ui.emote(e, '？');
    }
  }

  handoff(e) {
    const P = this.player;
    e.cool = e.tune.cooldown || 3.5;
    e.facePlayer();
    e.char.play('throw');
    e.say(pick(Math.random, e.cfg.talks[0]), e.kind === 'handout' ? 'mtg' : 'shorui', 1.8);
    P.addPapers(1);
    this.record('caught', e.type);
    this.clock += e.cfg.penalty;
    this.fx.papers(P.pos.x, 1.6, P.pos.z, 5, 0.6);
    this.audio.paperHit();
    this.ui.float(P.pos.x, 2.3, P.pos.z, `-${e.cfg.penalty}分　${e.kind === 'handout' ? 'チラシ' : '書類'}+1`, 'minus');
  }

  paperLanded(to, enemy) {
    const P = this.player;
    if (!P || this.state !== 'play') {
      this.fx.papers(to.x, 0.2, to.z, 5, 0.5);
      return;
    }
    const d = Math.hypot(to.x - P.pos.x, to.z - P.pos.z);
    if (d < 0.72 && !P.invulnerable) {
      P.addPapers(1);
      this.record('caught', 'shorui');
      this.clock += enemy.cfg.penalty;
      this.fx.papers(P.pos.x, 1.5, P.pos.z, 10, 1);
      this.audio.paperHit();
      this.shake(0.12);
      this.ui.float(P.pos.x, 2.3, P.pos.z, `-${enemy.cfg.penalty}分　書類+1`, 'minus');
    } else {
      this.fx.papers(to.x, 0.2, to.z, 7, 0.7);
      this.audio.paperMiss();
      if (P.dashing && d < 1.6) {
        this.dodges++;
        this.record('dodged', 'shorui');
        this.ui.float(P.pos.x, 2.3, P.pos.z, 'スルッ！', 'good');
        this.fx.sparkle(P.pos.x, 1, P.pos.z, 10);
        this.audio.sparkle();
      }
    }
  }

  shake(amount) {
    this.cam.shake = Math.max(this.cam.shake, amount);
  }

  // --- 会話 -----------------------------------------------------------------
  startTalk(e, called = false) {
    // エース新人が一度だけ身代わりになる
    if (this.ally?.state === 'follow') {
      const P = this.player;
      this.ally.intercept(e);
      P.invulnT = 2;
      this.dodges++;
      this.record('dodged', e.type);
      this.ui.float(P.pos.x, 2.4, P.pos.z, 'エース新人が身代わりに！', 'good');
      this.fx.sparkle(P.pos.x, 1, P.pos.z, 14);
      this.audio.sparkle();
      this.ui.setAlly(false);
      return;
    }
    this.record('caught', e.type);
    const P = this.player;
    P.slipT = 0;
    this.state = 'talk';
    this.caught++;
    P.frozen = true;
    P.vel.set(0, 0);
    e.vel.x = e.vel.z = 0;
    // 向かい合って話せる距離まで離す
    {
      const dx = e.pos.x - P.pos.x;
      const dz = e.pos.z - P.pos.z;
      const d = Math.hypot(dx, dz) || 1;
      const grid = this.world.grid;
      const ex = P.pos.x + (dx / d) * 0.95;
      const ez = P.pos.z + (dz / d) * 0.95;
      if (called) {
        // 社長に呼ばれたら、こちらから駆け寄る
        const px = e.pos.x - (dx / d) * 0.95;
        const pz = e.pos.z - (dz / d) * 0.95;
        if (grid.isWalkWorld(px, pz)) P.pos.set(px, 0, pz);
        else if (grid.isWalkWorld(ex, ez)) {
          e.pos.x = ex;
          e.pos.z = ez;
        }
      } else if (grid.isWalkWorld(ex, ez)) {
        e.pos.x = ex;
        e.pos.z = ez;
      } else {
        const px = e.pos.x - (dx / d) * 0.95;
        const pz = e.pos.z - (dz / d) * 0.95;
        if (grid.isWalkWorld(px, pz)) P.pos.set(px, 0, pz);
      }
      e.char.root.position.set(e.pos.x, 0, e.pos.z);
    }
    e.facePlayer();
    P.char.faceDir(e.pos.x - P.pos.x, e.pos.z - P.pos.z);
    P.char.pose = 'listen';
    P.char.setMood('worried');
    e.char.pose = 'talk';
    e.char.setMood(e.kind === 'keiri' ? 'angry' : 'happy');
    e.cone && (e.cone.visible = false);
    this.ui.clearWorld();
    this.ui.aura(0);
    this.audio.caught();
    this.shake(e.kind === 'keiri' ? 0.3 : 0.15);
    let lines = pick(Math.random, e.cfg.talks);
    let penalty = e.cfg.penalty;
    let stampSmall = `<br>${e.cfg.stamp}`;
    if (P.takeItem('omiyage')) {
      lines = [lines[0], '（菓子折りを差し出す）', 'お、気が利くね！…じゃあ手短に。'];
      penalty = Math.ceil(penalty / 2);
      stampSmall = '<br>菓子折り効果';
      this.onItemsChanged();
    }
    this.openTalk({
      who: e.cfg,
      portrait: this.ui.portraits[e.type],
      tint: e.cfg.tint,
      lines,
      voice: e.cfg.voice,
      penalty,
      stamp: [`-${penalty}分`, stampSmall],
      focus: e,
      onDone: () => {
        e.afterTalk();
        P.frozen = false;
        P.invulnT = 1.7;
        P.char.pose = 'idle';
        P.char.setMood('normal');
        if (e.cfg.papers) {
          P.addPapers(e.cfg.papers);
          this.fx.papers(P.pos.x, 1.6, P.pos.z, 8, 0.8);
          this.ui.float(P.pos.x, 2.3, P.pos.z, `書類+${e.cfg.papers}`, 'minus');
        }
        this.input.reset();
        if (this.clock >= this.stage.deadline) this.fail();
        else this.state = 'play';
      },
    });
  }

  openTalk(o) {
    this.ui.openDialogue(o.who, o.portrait, o.tint);
    this.talk = { ...o, idx: 0, chars: 0, hold: 0, applied: 0, voiceT: 0 };
    this.showLine();
  }

  showLine() {
    const t = this.talk;
    t.chars = 0;
    t.hold = 0;
    t.lineDone = false;
    this.ui.dialogueText('');
    if (t.idx === t.lines.length - 1 && t.stamp) {
      setTimeout(() => {
        if (this.talk !== t) return;
        this.ui.dialogueStamp(t.stamp[0], t.stamp[1]);
        this.audio.stamp();
        this.shake(0.12);
      }, 250);
    }
  }

  advanceTalk() {
    const t = this.talk;
    if (!t) return;
    const line = t.lines[t.idx];
    if (!t.lineDone) {
      t.chars = line.length;
      return;
    }
    if (t.hold < 0.2) return;
    t.idx++;
    if (t.idx >= t.lines.length) this.endTalk();
    else this.showLine();
  }

  endTalk() {
    const t = this.talk;
    if (!t) return;
    if (t.penalty) this.clock += t.penalty - t.applied;
    this.talk = null;
    this.ui.closeDialogue();
    t.onDone?.();
  }

  updateTalk(dt) {
    const t = this.talk;
    const P = this.player;
    if (t) {
      const line = t.lines[t.idx];
      if (!t.lineDone) {
        const before = Math.floor(t.chars);
        t.chars = Math.min(line.length, t.chars + dt * 26);
        if (Math.floor(t.chars) !== before && Math.floor(t.chars) % 2 === 0 && line[Math.floor(t.chars)] !== '（') {
          this.audio.voice(t.voice?.freq, t.voice?.type);
        }
        this.ui.dialogueText(line.slice(0, Math.floor(t.chars)));
        if (t.chars >= line.length) t.lineDone = true;
      } else {
        t.hold += dt;
        if (t.hold > (t.idx === t.lines.length - 1 ? 2.2 : 1.6)) this.advanceTalk();
      }
      // 時計を早回し
      if (t.penalty) {
        const target = (t.penalty * (t.idx + (t.lineDone ? 1 : t.chars / Math.max(1, line.length)))) / t.lines.length;
        const step = Math.min(target - t.applied, dt * t.penalty * 0.9);
        if (step > 0) {
          t.applied += step;
          this.clock += step;
          if (Math.floor(this.clock) !== Math.floor(this.clock - step)) this.audio.tick();
        }
      }
      const f = t.focus;
      if (f) {
        this.cam.goalTarget.set((f.pos.x + P.pos.x) / 2, 0.4, (f.pos.z + P.pos.z) / 2);
      } else if (this.boss) {
        this.cam.goalTarget.set((this.boss.root.position.x + P.pos.x) / 2, 0.4, (this.boss.root.position.z + P.pos.z) / 2);
      }
      this.cam.goalScale = 0.6;
    }
    for (const e of this.enemies) e.idle(dt);
    P.frozen = true;
    P.update(dt, this.input);
    this.boss?.update(dt);
    if (this.stage) this.ui.updateHud(this.clock, this.stage, P.papers, 0, !!t?.penalty);
    this.ui.goalPointer(this.camera, this.world.spawns.goal, false);
  }

  // --- 開始演出 -------------------------------------------------------------
  updateFlyover(dt) {
    this.flyT += dt;
    const P = this.player;
    const g = this.flyGoal();
    const D = 2.4;
    const k = smooth(clamp((this.flyT - 0.5) / (D - 0.9), 0, 1));
    this.cam.goalTarget.set(lerp(g.x, P.pos.x, k), 0, lerp(g.z, P.pos.z, k));
    this.cam.goalScale = lerp(1.2, 1, k);
    if (this.flyT < 0.05) {
      this.cam.target.copy(this.cam.goalTarget);
      this.cam.scale = 1.2;
    }
    for (const e of this.enemies) e.demoUpdate(dt);
    P.frozen = true;
    P.update(dt, this.input);
    this.boss?.update(dt);
    this.ui.updateHud(this.clock, this.stage, P.papers, 0, false);
    this.ui.goalPointer(this.camera, g, false);
    if (this.flyT > D) {
      this.state = 'play';
      this.ui.toast('スタート！');
      this.audio.countdown(true);
      this.input.reset();
      for (const e of this.enemies) {
        e.pos.set(e.home.x, 0, e.home.z);
        if (e.patrol) e.pi = e.nearestWaypoint();
      }
    }
  }

  // --- ゴール -----------------------------------------------------------------
  // --- ハンコラリー -----------------------------------------------------------
  /** 開始演出でカメラが最初に映す場所 */
  flyGoal() {
    return this.fetch || this.rooms ? this.currentGoal() : this.world.spawns.goal;
  }

  currentGoal() {
    if (this.rooms) return this.rooms.list[this.rooms.free];
    if (this.fetch) return this.fetch.phase === 'find' ? this.fetch.pos : this.world.spawns.goal;
    if (this.print) {
      const pr = this.print;
      const P = this.player;
      if (pr.phase === 'deliver') return this.world.spawns.goal;
      if (pr.phase === 'printing') return pr.copiers.find((c) => c.working).front;
      let best = null;
      let bd = Infinity;
      for (const c of pr.copiers) {
        if (c.checked) continue;
        const d = Math.hypot(c.front.x - P.pos.x, c.front.z - P.pos.z);
        if (d < bd) {
          bd = d;
          best = c;
        }
      }
      return best ? best.front : this.world.spawns.goal;
    }
    if (!this.rally || this.rallyIdx >= this.rally.length) return this.world.spawns.goal;
    return this.rally[this.rallyIdx].d.front;
  }

  updateRally(dt) {
    const P = this.player;
    this.rallyNoteT = Math.max(0, this.rallyNoteT - dt);
    const fx = this.world.goalFx.group;
    const tgt = this.currentGoal();
    fx.position.set(tgt.x, 0, tgt.z);
    for (let i = 0; i < this.rally.length; i++) {
      const r = this.rally[i];
      const f = r.d.front;
      if (Math.hypot(f.x - P.pos.x, f.z - P.pos.z) > 0.85) continue;
      if (i === this.rallyIdx) {
        this.rallyTalk(r, true);
        return true;
      }
      if (!r.done && this.rallyNoteT <= 0) {
        this.rallyTalk(r, false);
        return true;
      }
      if (r.done && this.rallyNoteT <= 0) {
        this.rallyNoteT = 3;
        this.ui.bubble(r, pick(Math.random, RALLY_REJECT.kacho), 'mtg', 1.5);
      }
    }
    const g = this.world.spawns.goal;
    if (Math.hypot(g.x - P.pos.x, g.z - P.pos.z) < 0.85) {
      if (this.rallyIdx >= this.rally.length) this.reachGoal();
      else if (this.rallyNoteT <= 0) {
        this.rallyNoteT = 3;
        this.ui.float(P.pos.x, 2.3, P.pos.z, `ハンコがまだ${this.rally.length - this.rallyIdx}つ足りない`, 'info');
      }
    }
    return false;
  }

  // --- コピー機探し -----------------------------------------------------------
  updatePrint(dt) {
    const P = this.player;
    const pr = this.print;
    pr.noteT = Math.max(0, pr.noteT - dt);
    const tgt = this.currentGoal();
    this.world.goalFx.group.position.set(tgt.x, 0, tgt.z);
    this.world.goalFx.group.visible = pr.phase !== 'printing';
    this.printing = false;
    if (pr.phase === 'find') {
      for (const c of pr.copiers) {
        if (c.checked || Math.hypot(c.front.x - P.pos.x, c.front.z - P.pos.z) > 0.9) continue;
        if (c.working) {
          pr.phase = 'printing';
          this.ui.bubble(c, COPIER.start, 'player', 1.8);
          this.audio.ding();
          this.ui.setGoalLabel('印刷中のコピー機');
        } else {
          c.checked = true;
          this.clock += 2;
          this.ui.bubble(c, pick(Math.random, COPIER.jammed), 'keiri', 1.8);
          this.ui.float(P.pos.x, 2.3, P.pos.z, 'はずれ！ -2分', 'minus');
          this.audio.caught();
          this.markJammed(c);
          this.ui.setGoalLabel('動くコピー機');
        }
        break;
      }
    } else if (pr.phase === 'printing') {
      const c = pr.copiers.find((k) => k.working);
      const near = Math.hypot(c.front.x - P.pos.x, c.front.z - P.pos.z) < 1.5;
      if (near) {
        this.printing = true;
        pr.progress = Math.min(1, pr.progress + dt / 4.5);
        pr.tick = (pr.tick || 0) - dt;
        if (pr.tick <= 0) {
          pr.tick = 0.35;
          this.audio.noise(0.07, { freq: 700, q: 1.5, vol: 0.12 });
        }
      } else if (pr.noteT <= 0) {
        pr.noteT = 3;
        this.ui.float(P.pos.x, 2.3, P.pos.z, '離れると印刷が止まる！', 'info');
      }
      this.ui.setProgress(c, pr.progress, near ? '印刷中' : '一時停止');
      if (pr.progress >= 1) {
        pr.phase = 'deliver';
        this.ui.setProgress(null);
        this.ui.bubble(c, COPIER.done, 'player', 2);
        this.ui.float(P.pos.x, 2.3, P.pos.z, '印刷完了！', 'good');
        this.fx.papers(c.x, 1.2, c.z, 6, 0.6);
        this.audio.stamp();
        this.ui.setGoalLabel(this.stage.goalLabel);
      }
    } else {
      const g = this.world.spawns.goal;
      if (Math.hypot(g.x - P.pos.x, g.z - P.pos.z) < 0.85) this.reachGoal();
    }
  }

  // --- 空き会議室さがし -------------------------------------------------------
  setRoomSigns() {
    const R = this.rooms;
    R.list.forEach((r, i) => {
      r.sign.material.map = i === R.free ? r.tex.free : r.tex.busy;
      r.sign.material.needsUpdate = true;
      r.sign.visible = true;
    });
  }

  updateRooms(dt) {
    const R = this.rooms;
    const P = this.player;
    R.t += dt;
    R.noteT = Math.max(0, R.noteT - dt);
    const cur = R.list[R.free];
    const near = Math.hypot(cur.x - P.pos.x, cur.z - P.pos.z) < 3.5;
    // もうすぐ予約が入る：札が点滅
    cur.sign.visible = near || R.t < R.period - 3 || Math.floor(this.time * 6) % 2 === 0;
    if (R.t > R.period && !near) {
      const others = R.list.map((r, i) => i).filter((i) => i !== R.free);
      const next = others[Math.floor(Math.random() * others.length)];
      const old = cur;
      R.free = next;
      R.t = 0;
      this.setRoomSigns();
      const nr = R.list[next];
      this.ui.setGoalLabel(nr.name);
      this.ui.bubble(old, '（予約が入りました）', 'mtg', 1.6);
      this.ui.float(P.pos.x, 2.4, P.pos.z, `${nr.name}が空いた！`, 'good');
      this.fx.ring(nr.x, nr.z, '#2e9e5b', 2.2, 0.8);
      this.audio.ding();
    }
    const tgt = R.list[R.free];
    this.world.goalFx.group.position.set(tgt.x, 0, tgt.z);
    for (let i = 0; i < R.list.length; i++) {
      const r = R.list[i];
      if (Math.hypot(r.x - P.pos.x, r.z - P.pos.z) > 0.8) continue;
      if (i === R.free) {
        this.world.spawns.goal.x = r.x;
        this.world.spawns.goal.z = r.z;
        this.reachGoal();
        return;
      }
      if (R.noteT <= 0) {
        R.noteT = 2.5;
        this.clock += 1;
        this.ui.bubble(r, pick(Math.random, ['（中から）使ってまーす！', '（中から）あと5分だけ延長で！', '（ノックしたら全員こっちを見た）']), 'mtg', 1.6);
        this.ui.float(P.pos.x, 2.3, P.pos.z, '使用中！ -1分', 'minus');
        this.audio.caught();
      }
    }
  }

  // --- 置き傘さがし -----------------------------------------------------------
  updateFetch(dt) {
    const F = this.fetch;
    const P = this.player;
    F.noteT = Math.max(0, F.noteT - dt);
    const tgt = this.currentGoal();
    this.world.goalFx.group.position.set(tgt.x, 0, tgt.z);
    if (F.phase === 'find') {
      const near = Math.hypot(F.pos.x - P.pos.x, F.pos.z - P.pos.z) < 1.2;
      this.world.goalFx.group.visible = !near;
      if (near) {
        F.progress = Math.min(1, F.progress + dt / 2.4);
        F.tick -= dt;
        if (F.tick <= 0) {
          F.tick = 0.3;
          this.audio.noise(0.05, { freq: 1500, q: 2, vol: 0.08 });
        }
        this.ui.setProgress(F, F.progress, 'どれが自分の傘…？');
      } else if (F.progress > 0) {
        this.ui.setProgress(F, F.progress, '探索中断');
      }
      if (F.progress >= 1) {
        F.phase = 'deliver';
        this.world.goalFx.group.visible = true;
        this.ui.setProgress(null);
        this.ui.bubble(P, 'あった！…たぶんこれ！', 'player', 1.8);
        this.ui.float(P.pos.x, 2.4, P.pos.z, this.stage.fetchDone, 'good');
        this.fx.sparkle(P.pos.x, 1.2, P.pos.z, 14);
        this.audio.stamp();
        this.ui.setGoalLabel(this.stage.goalLabel);
      }
    } else {
      const g = this.world.spawns.goal;
      if (Math.hypot(g.x - P.pos.x, g.z - P.pos.z) < 0.85) this.reachGoal();
    }
  }

  // --- 車の水はね ------------------------------------------------------------
  updateSplash(dt) {
    const P = this.player;
    this.splashCD = Math.max(0, this.splashCD - dt);
    if (this.splashCD > 0 || !this.weather.isPuddle(P.pos.x, P.pos.z)) return;
    for (const c of this.traffic.cars) {
      if (c.v < 3 || Math.abs(c.lane.z - P.pos.z) > 1.6 || Math.abs(c.g.position.x - P.pos.x) > 1.0) continue;
      this.splashCD = 1.5;
      this.fx.dust(P.pos.x, (P.pos.z + c.lane.z) / 2, 14, '#bcd6f0', 1.6);
      this.audio.noise(0.3, { freq: 1300, q: 0.6, vol: 0.3 });
      if (P.umbrellaT > 0) {
        this.ui.float(P.pos.x, 2.3, P.pos.z, '傘でガード！', 'good');
        return;
      }
      if (P.invulnerable) {
        this.dodges++;
        this.ui.float(P.pos.x, 2.3, P.pos.z, 'スルッ！', 'good');
        return;
      }
      P.slowT = 0.8;
      P.char.play('stagger');
      this.clock += 2;
      this.shake(0.12);
      this.ui.float(P.pos.x, 2.3, P.pos.z, 'ビシャッ！ 水はね -2分', 'minus');
      return;
    }
  }

  onPlayerSlip() {
    const P = this.player;
    this.ui.float(P.pos.x, 2.3, P.pos.z, 'ツルッ！', 'minus');
    this.fx.dust(P.pos.x, P.pos.z, 10, '#bcd6f0', 1.2);
    this.audio.noise(0.2, { freq: 600, q: 1, vol: 0.25 });
    this.shake(0.1);
  }

  onEnemySlip(e) {
    if (this.state !== 'play') return;
    this.dodges++;
    this.record('dodged', e.type);
    this.ui.float(e.pos.x, 2.2, e.pos.z, 'ツルッ！ 振り切った！', 'good');
    this.fx.dust(e.pos.x, e.pos.z, 10, '#bcd6f0', 1.2);
    this.audio.noise(0.2, { freq: 600, q: 1, vol: 0.2 });
  }

  markJammed(c) {
    const tex = textTexture('紙詰まり中', { w: 256, h: 72, bg: '#e0402f', color: '#ffffff', font: '800 38px "M PLUS Rounded 1c", sans-serif', radius: 12 });
    const m = new THREE.Mesh(new THREE.PlaneGeometry(1.5, 0.42), new THREE.MeshBasicMaterial({ map: tex, depthTest: false }));
    m.position.set(c.x, 1.7, c.z);
    m.renderOrder = 5;
    this.scene.add(m);
    c.sign = m;
  }

  rallyTalk(r, ok) {
    const P = this.player;
    this.state = 'talk';
    P.frozen = true;
    P.vel.set(0, 0);
    P.char.faceDir(r.d.x - P.pos.x, r.d.z - P.pos.z);
    P.char.pose = 'bow';
    r.char.pose = 'talk';
    this.ui.clearWorld();
    this.ui.aura(0);
    const penalty = ok ? 3 : 5;
    this.world.goalFx.group.visible = false;
    this.openTalk({
      who: { nick: r.npc.nick, role: r.npc.role, name: r.npc.name },
      portrait: this.ui.portraits[r.npc === GOAL_NPC.boss ? 'boss' : r.npc === GOAL_NPC.kacho ? 'kacho' : 'jomu'],
      tint: r.npc.tint === '#1b2340' ? '#ffd84d' : r.npc.tint,
      lines: ok ? (r.npc.rallyLines || r.npc.lines) : RALLY_REJECT[r.npc === GOAL_NPC.boss ? 'boss' : 'jomu'],
      voice: r.npc.voice,
      penalty,
      stamp: ok ? [r.npc.stamp, `<br>-${penalty}分`] : ['差し戻し', `<br>-${penalty}分`],
      focus: r,
      onDone: () => {
        r.char.pose = 'sit';
        this.world.goalFx.group.visible = true;
        P.frozen = false;
        P.char.pose = 'idle';
        P.invulnT = 1.5;
        if (ok) {
          this.rallyNoteT = 3;
          r.done = true;
          r.char.setMood('happy');
          this.rallyIdx++;
          this.audio.stamp();
          this.fx.sparkle(P.pos.x, 1.2, P.pos.z, 12);
          const next = this.rally[this.rallyIdx];
          this.ui.setRally(this.rally, this.rallyIdx, next ? `${next.label}席` : this.stage.goalLabel);
        } else {
          // 一歩下がる
          const z = P.pos.z + 1;
          if (this.world.grid.isWalkWorld(P.pos.x, z)) P.pos.z = z;
          this.rallyNoteT = 2;
        }
        this.input.reset();
        if (this.clock >= this.stage.deadline) this.fail();
        else this.state = 'play';
      },
    });
  }

  reachGoal() {
    if (this.goalReached) return;
    this.goalReached = true;
    this.state = 'goalSeq';
    this.goalT = 0;
    this.arrive = this.clock;
    const P = this.player;
    P.frozen = true;
    P.invulnT = 99;
    this.playerHidden = true;
    this.world.goalFx.group.visible = false;
    this.ui.goalPointer(this.camera, null, false);
    this.ui.aura(0);
    this.audio.setTension(false);
    const type = this.stage.goalType;
    if (type === 'boss' || type === 'desk') {
      const b = this.boss;
      const npc = this.goalNpc;
      P.char.faceDir(b.root.position.x - P.pos.x, b.root.position.z - P.pos.z);
      P.char.pose = 'bow';
      b.pose = 'talk';
      this.openTalk({
        who: { nick: npc.nick, role: npc.role, name: npc.name },
        portrait: this.ui.portraits[this.stage.goalNpc || 'boss'],
        tint: npc.tint === '#1b2340' ? '#ffd84d' : npc.tint,
        lines: npc.lines,
        voice: npc.voice,
        penalty: 0,
        stamp: [npc.stamp, ''],
        onDone: () => {
          b.pose = 'sit';
          b.setMood('happy');
          this.celebrate();
        },
      });
    } else if (type === 'spot' || type === 'rally' || type === 'print' || type === 'rooms') {
      P.char.faceDir(0, -1);
      P.char.pose = 'bow';
      this.audio.ding();
      setTimeout(() => this.celebrate(1.2), 500);
    } else if (type === 'elevator') {
      const e = this.world.nearestElevator(P.pos.x, P.pos.z);
      e.target = 1;
      this.audio.ding();
      this.script = {
        steps: [
          { x: e.x, z: e.z, speed: 3 },
          { x: e.cx, z: e.z, speed: 2.4 },
        ],
        onDone: () => {
          P.char.faceDir(e.inward, 0);
          P.char.pose = 'cheer';
          setTimeout(() => {
            e.target = 0;
          }, 900);
          this.celebrate(1.6);
        },
      };
    } else {
      for (const d of this.world.exitDoors) d.target = 1;
      this.audio.ding();
      const dz = this.world.exitDoors.reduce((s, d) => s + d.baseZ, 0) / Math.max(1, this.world.exitDoors.length);
      this.script = {
        steps: [
          { x: 1.6, z: dz, speed: 3.2 },
          { x: 0.3, z: dz, speed: 3.2 },
        ],
        onDone: () => {
          P.char.pose = 'cheer';
          P.char.faceDir(1, 0);
          this.celebrate(1.4);
        },
      };
    }
  }

  celebrate(delay = 1.2) {
    const P = this.player;
    P.char.pose = 'cheer';
    P.char.setMood('happy');
    this.fx.confettiBurst(P.pos.x, P.pos.z);
    this.ui.toast(this.stage.goalDone, 'stamp-toast');
    this.audio.clear();
    this.audio.stopMusic();
    this.celebrating = true;
    setTimeout(() => this.finish(true), delay * 1000 + 500);
  }

  updateGoalSeq(dt) {
    const P = this.player;
    this.goalT += dt;
    if (this.talk) {
      this.updateTalk(dt);
      this.state = 'goalSeq';
      return;
    }
    const s = this.script;
    if (s && s.steps.length) {
      const st = s.steps[0];
      const dx = st.x - P.pos.x;
      const dz = st.z - P.pos.z;
      const d = Math.hypot(dx, dz);
      if (d < 0.08) {
        s.steps.shift();
        if (!s.steps.length) {
          P.vel.set(0, 0);
          s.onDone();
        }
      } else {
        const sp = Math.min(st.speed, d * 5);
        P.vel.set((dx / d) * sp, (dz / d) * sp);
        P.pos.x += P.vel.x * dt;
        P.pos.z += P.vel.y * dt;
      }
      P.char.root.position.set(P.pos.x, 0, P.pos.z);
      P.char.speed = Math.hypot(P.vel.x, P.vel.y);
      if (P.char.speed > 0.2) P.char.faceDir(P.vel.x, P.vel.y);
      P.char.update(dt);
      P.ring.visible = P.dot.visible = false;
      P.char.root.visible = true;
    } else {
      P.vel.set(0, 0);
      P.char.speed = 0;
      P.char.root.visible = true;
      P.char.update(dt);
    }
    for (const e of this.enemies) e.idle(dt);
    this.boss?.update(dt);
    this.cam.goalTarget.set(P.pos.x, 0.3, P.pos.z);
    this.cam.goalScale = 0.72;
  }

  finish(success) {
    if (this.state === 'result') return;
    this.state = 'result';
    this.ui.hud(false);
    const stage = this.stage;
    const left = Math.max(0, Math.floor(stage.deadline - this.arrive));
    let rank = 'C';
    let comment = '';
    for (const r of stage.results) {
      if (left >= r.min) {
        rank = r.rank;
        comment = r.text;
        break;
      }
    }
    if (success) {
      const prev = this.best[stage.id];
      if (!prev || RANK_ORDER.indexOf(rank) > RANK_ORDER.indexOf(prev)) {
        this.best[stage.id] = rank;
        try {
          localStorage.setItem('surusuru-best', JSON.stringify(this.best));
        } catch (e) { /* 保存できない環境 */ }
      }
    }
    const last = !STAGES[this.stageIndex + 1] || STAGES[this.stageIndex + 1].chapter !== stage.chapter;
    this.ui.result({
      stage, success, arrive: this.arrive, left, caught: this.caught,
      papers: this.player.totalPapers, dodges: this.dodges, rank, comment, last,
    }, {
      next: () => {
        this.audio.click();
        if (last) this.toTitle(true);
        else this.toIntro(this.stageIndex + 1);
      },
      retry: () => {
        this.audio.click();
        this.toIntro(this.stageIndex);
      },
      title: () => {
        this.audio.click();
        this.toTitle();
      },
    });
    this.cam.goalScale = 0.8;
  }

  fail() {
    if (this.state === 'result' || this.state === 'failSeq') return;
    this.state = 'failSeq';
    this.arrive = this.stage.deadline;
    this.clock = this.stage.deadline;
    const P = this.player;
    P.frozen = true;
    P.char.pose = 'shock';
    P.char.setMood('surprised');
    this.ui.toast('時間切れ', 'stamp-toast');
    this.ui.aura(0);
    this.audio.stopMusic();
    this.audio.fail();
    this.shake(0.25);
    setTimeout(() => {
      P.char.play('trip');
      this.finish(false);
    }, 1500);
  }

  // --- カメラ ---------------------------------------------------------------
  updateCamera(dt) {
    const c = this.cam;
    const st = this.state;
    const W = this.world.W;
    const H = this.world.H;
    if (st === 'title') {
      const t = this.time;
      c.goalTarget.set(W / 2 + Math.sin(t * 0.06) * W * 0.28, 0, H / 2 + Math.sin(t * 0.043 + 1) * H * 0.22);
      c.goalScale = 1.15;
      c.goalYaw = Math.sin(t * 0.05) * 0.32;
    } else if (st === 'intro') {
      const P = this.player;
      c.goalTarget.set(P.pos.x, 0, P.pos.z);
      c.goalScale = 0.85;
      c.goalYaw = Math.sin(this.time * 0.2) * 0.4;
    } else if (st === 'result' || st === 'failSeq') {
      const P = this.player;
      c.goalTarget.set(P.pos.x, 0.3, P.pos.z);
      c.goalYaw = Math.sin(this.time * 0.25) * 0.35;
    } else if (st !== 'paused') {
      c.goalYaw = 0;
    }
    // マップ外が映りすぎないよう制限
    if (st === 'play' || st === 'flyover') {
      const halfW = this.viewDist() * Math.tan(this.hHalf()) * 0.95;
      const mx = Math.min(W / 2, Math.max(1.5, halfW - 1.5));
      c.goalTarget.x = clamp(c.goalTarget.x, mx, W - mx);
      c.goalTarget.z = clamp(c.goalTarget.z, 3.5, H - 6);
    }
    const lam = st === 'play' ? 6 : 3.2;
    c.target.x = damp(c.target.x, c.goalTarget.x, lam, dt);
    c.target.y = damp(c.target.y, c.goalTarget.y, lam, dt);
    c.target.z = damp(c.target.z, c.goalTarget.z, lam, dt);
    c.scale = damp(c.scale, c.goalScale, 3, dt);
    c.yaw = damp(c.yaw, c.goalYaw, 2, dt);
    c.shake = Math.max(0, c.shake - dt * 1.2);
    this.renderCamera(dt);
    this.world.updateShadow(c.target);
  }

  hHalf() {
    const vf = (this.camera.fov * Math.PI) / 180;
    return Math.atan(Math.tan(vf / 2) * this.camera.aspect);
  }

  viewDist() {
    const base = 18.5;
    const need = 7.5 / Math.tan(this.hHalf());
    // 縦長画面は引きすぎるとキャラが小さくなるので上限を下げる
    const cap = this.camera.aspect < 0.8 ? 1.4 : 2.1;
    return clamp(Math.max(base, need), base, base * cap);
  }

  renderCamera() {
    const c = this.cam;
    const dist = this.viewDist() * c.scale;
    const s = c.shake * c.shake * 1.2;
    const ox = (Math.random() - 0.5) * s;
    const oz = (Math.random() - 0.5) * s;
    this.camera.position.set(
      c.target.x + Math.sin(c.yaw) * Math.cos(PITCH) * dist + ox,
      c.target.y + Math.sin(PITCH) * dist,
      c.target.z + Math.cos(c.yaw) * Math.cos(PITCH) * dist + oz,
    );
    this.camera.lookAt(c.target.x + ox * 0.5, c.target.y, c.target.z + oz * 0.5);
  }
}

// デバッグ用：描画せずに時間を進める（コンソールから __game.step(2) など）
Game.prototype.step = function step(seconds, dt = 1 / 30) {
  for (let t = 0; t < seconds; t += dt) {
    this.time += dt;
    this.input.update();
    this.update(dt);
    this.ui.update(dt, this.camera);
  }
};

setupPwa();
const game = new Game();
window.__game = game;
game.boot();
