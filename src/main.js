import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { STAGES, CHAPTERS } from './levels.js';
import { CAST, BOSS, PLAYER_LOOK, GOAL_NPC, RALLY_REJECT, ALLY, COPIER, SUCCESSOR, DAISHA, KOUNIN_REACT, TEAM } from './cast.js';
import { World, boxPileGeometry } from './world.js';
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
import { Suitcase } from './suitcase.js';
import { Belts } from './belts.js';
import { Trail, Follower } from './trail.js';
import { Team, TEAM_TUNE } from './team.js';
import { RangeRing } from './effects.js';
import { clamp, damp, lerp, smooth, pick, textTexture } from './util.js';

const RANK_ORDER = ['C', 'B', 'A', 'S'];
const PITCH = 0.93;
const TEMPO = { 1: 108, 2: 116, 3: 124, 13: 112, 14: 120, 15: 128, 16: 120, 17: 128, 18: 108, 19: 120, 20: 112, 21: 130, 22: 112, 23: 118, 24: 128, 25: 118, 26: 126, 27: 136 };
// 行列に巻き込める人の動き方（社長・書類おじさん・清掃員・ティッシュ配りなどは巻き込めない）
const ABSORB = new Set(['senpai', 'warikomi', 'doki', 'shinjin', 'kanji', 'mtg', 'keiri']);
const _dashDir = new THREE.Vector2();
// 第8章：淀川さんがあいさつする人（動き方と、そのときの状態）。深川さんはオリエンテーション
const GREETABLE = new Set(['senpai', 'warikomi', 'mtg', 'keiri', 'shorui', 'doki', 'shinjin']);
const CALM = new Set(['idle', 'patrol', 'stand', 'look', 'wander']);
const ORIENT_FROM = new Set(['idle', 'notice', 'chase', 'return']);
// 台車ではね飛ばせない人（社長・通せんぼ・清掃員・ティッシュ配り・お見送り隊・行列）
const KNOCK_SKIP = new Set(['shacho', 'kanji', 'zandaka', 'cleaner', 'handout', 'okuri', 'conga']);
const FOLLOW_TEXT = { follow: '淀川さん 同行中', greet: 'あいさつ中…', memo: 'メモ中…', orient: 'オリエンテーション中…', done: '淀川さん 同行中' };
const NUMS = '①②③④⑤';
const BOX_LINES = ['ドサッ！（中身：3年分の割り箸）', 'ドサッ！（中身：謎のトロフィー）', 'ドサッ！（中身：3年前のカレンダー）', 'ドサッ！（中身：大量のノベルティ）'];
const _tp = { x: 0, z: 0, dx: 0, dz: 1, gap: 0 };
const PRESENT_OPEN = '……では、スルスル広告さん。どうぞ。';

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
    this.congas = [];
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
    const sample = '部長大河原営業課経理部会議室エレベーター出口シュレッダー至急ブレスト夏キャンペーン今期売上認知バズ広告賞〆切は守るもの社内標語第回最優秀を飲みほせ特命プロジェクト室人事部総務経営企画引継済給湯室祝栄転寄せ書き花道熱海棚ファイルコピー機取引先①②③・ご5階（）第1会議室制作部本社受付控室大会議室審査員席演台必勝様';
    const fonts = Promise.all([
      document.fonts.load('800 40px "M PLUS Rounded 1c"', sample),
      document.fonts.load('40px "Dela Gothic One"', 'SALEGOLD〆切夏を飲みほせTHINKBIG50%'),
    ]).catch(() => {});
    await Promise.race([fonts, new Promise((r) => setTimeout(r, 3500))]);

    const looks = Object.fromEntries(Object.entries(CAST).map(([k, v]) => [k, v.look]));
    // 名前つきの見た目違い（variants）は顔アイコンを別に作る
    for (const [k, c] of Object.entries(CAST)) (c.variants || []).forEach((vv, i) => { if (vv.name) looks[`${k}_${i}`] = vv.look ? { ...c.look, ...vv.look } : c.look; });
    looks.boss = BOSS.look;
    looks.kacho = GOAL_NPC.kacho.look;
    looks.ally = ALLY.look;
    looks.judge = GOAL_NPC.judge.look;
    looks.jomu = GOAL_NPC.jomu.look;
    for (const [k, v] of Object.entries(GOAL_NPC)) looks[k] ??= v.look;
    looks.successor = SUCCESSOR.look;
    looks.daisha = DAISHA.look;
    looks.team_mamiya = TEAM.mamiya.look;
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
    // 年末進行で締切が変わるので、ステージはコピーを使う（STAGES は書き換えない）
    const stage = { ...STAGES[i] };
    this.stageIndex = i;
    this.stage = stage;
    this.world = new World(stage, this.renderer);
    this.scene.add(this.world.group);
    this.belts = stage.map.some((r) => /[<>]/.test(r)) ? new Belts(this) : null;
    const p = this.world.preset;
    this.scene.background = this.world.background;
    this.scene.fog = new THREE.Fog(p.fog, 38, 80);
    this.scene.environmentIntensity = p.env;
    this.renderer.toneMappingExposure = p.exposure;
    this.post.setPreset(p);

    this.player = new Player(this, stage.item);
    const sp = this.world.spawns.player;
    this.player.place(sp.x, sp.z, this.initialYaw(sp));

    // 足あと（第8章）：同行者か、足あとを追うお見送り隊がいるステージ
    this.trail = null;
    this.cart = null;
    this.successor = null;
    const T0 = this.world.spawns.follower;
    if (!demo && (stage.follower || this.world.spawns.enemies.some((e) => e.type === 'okuri'))) {
      this.trail = new Trail(this, stage.trailColor);
      if (T0) this.trail.reset(T0.x, T0.z, sp.x, sp.z);
      else this.trail.reset(sp.x, sp.z);
      if (stage.follower === 'daisha') this.cart = new Follower(this, 'daisha');
      else if (stage.follower === 'successor') this.successor = new Follower(this, 'successor');
    }
    // チーム（第9章）：仲間は主人公の足あとをたどる
    this.team = null;
    if (stage.team && !demo && this.world.spawns.team?.length) {
      this.trail ??= new Trail(this, null);
      this.team = new Team(this, this.world.spawns.team, stage.team);
    }
    this.greetQ = [];
    this.okuriN = 0;
    this.okuriShown = 0;
    this.okuriHype = false;
    this.okuriShoutT = 1;
    this.okuriPhone = -1;

    const count = {};
    this.enemies = this.world.spawns.enemies.map((s) => {
      count[s.code] = count[s.code] || 0;
      const route = stage.patrols?.[s.code]?.[count[s.code]++];
      return new Enemy(this, s, route);
    });
    // 行列（先頭は Enemy、列の本体は Conga）
    this.congas = this.enemies.filter((e) => e.conga).map((e) => e.conga);
    this.okuriTune = this.enemies.find((e) => e.kind === 'okuri')?.tune || null;
    this.lure = null;
    this.squeezed = false;
    this.congaHinted = false;

    this.boss = null;
    if ((stage.goalType === 'boss' || stage.goalType === 'desk' || stage.goalType === 'handover' || stage.goalType === 'present') && this.world.spawns.boss) {
      this.goalNpc = GOAL_NPC[stage.goalNpc || 'boss'];
      const b = new Character(this.goalNpc.look, { outline: true });
      const bp = this.world.spawns.boss;
      b.root.position.set(bp.x, 0.06, bp.z);
      b.setYaw(0);
      b.pose = 'sit';
      this.scene.add(b.root);
      this.boss = b;
    }

    // プレゼン本番（第9章）：トラブルの札・赤い輪・人物は最初に作り、表示を切り替えるだけ
    this.present = null;
    if (stage.goalType === 'present' && this.world.spawns.troubles?.length) {
      const cfg = stage.present;
      const opt = { w: 384, h: 96, bg: '#e0402f', color: '#ffffff', font: '800 40px "M PLUS Rounded 1c", sans-serif', radius: 16 };
      const troubles = this.world.spawns.troubles.map((p, i) => {
        const t = cfg.troubles[i];
        const tex = textTexture(`${t.label}！`, opt);
        const sign = new THREE.Mesh(new THREE.PlaneGeometry(1.6, 0.4), new THREE.MeshBasicMaterial({ map: tex, depthTest: false, transparent: true }));
        sign.position.set(p.x, 2.5, p.z);
        sign.renderOrder = 5;
        sign.visible = false;
        this.scene.add(sign);
        const ring = new RangeRing(this.scene, '#e0402f', cfg.fixR);
        ring.update(p.x, p.z, 0);
        let npc = null;
        if (t.npc) {
          const c = new Character(CAST[t.npc].look, { outline: true });
          c.root.position.set(p.x, 0, p.z);
          c.setYaw(Math.atan2(this.world.spawns.goal.x - p.x, this.world.spawns.goal.z - 1 - p.z));
          this.scene.add(c.root);
          npc = { char: c, pos: c.root.position, cfg: CAST[t.npc] };
        }
        return { ...t, i, pos: { x: p.x, z: p.z }, tex, sign, ring, npc, on: false, done: false, alarmT: 0, replyT: 0 };
      });
      const g = this.world.spawns.goal;
      this.present = { cfg, phase: 'approach', progress: 0, ev: 0, deck: [], troubles, active: 0, podium: { pos: { x: g.x, z: g.z - 1 } }, bossEnt: this.boss ? { pos: this.boss.root.position } : null };
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

    // 引き継ぎポイント（後任の淀川さんに踏ませる）
    this.handover = null;
    if (stage.goalType === 'handover' && this.world.spawns.handover?.length) {
      const ringGeo = new THREE.RingGeometry(0.42, 0.5, 4, 1, Math.PI / 4); // 四角い枠
      const mats = ['#2f6db5', '#2e9e5b'].map((color) => new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.9, depthWrite: false }));
      const opt = (bg) => ({ w: 384, h: 96, bg, color: '#ffffff', font: '800 40px "M PLUS Rounded 1c", sans-serif', radius: 16 });
      const points = this.world.spawns.handover.map((w, i) => {
        const h = stage.handover[i];
        const tex = { todo: textTexture(`引継${NUMS[i]} ${h.label}`, opt('#2f6db5')), done: textTexture(`済 ${h.label}`, opt('#2e9e5b')) };
        const sign = new THREE.Mesh(new THREE.PlaneGeometry(1.6, 0.4), new THREE.MeshBasicMaterial({ map: tex.todo, depthTest: false, transparent: true }));
        sign.position.set(w.x, 2.3, w.z);
        sign.renderOrder = 5;
        const ring = new THREE.Mesh(ringGeo, mats[0]);
        ring.rotation.x = -Math.PI / 2;
        ring.position.set(w.x, 0.03, w.z);
        this.scene.add(sign, ring);
        return { ...h, i, star: `★${h.label}`, pos: { x: w.x, z: w.z }, tile: Math.floor(w.z) * this.world.W + Math.floor(w.x), done: false, trod: false, trodS: 0, tex, sign, ring };
      });
      this.handover = { points, ringGeo, mats, noteT: 0, greetT: 0, orient: null, label: '' };
      const f = this.handoverTarget();
      this.world.goalFx.group.position.set(f.pos.x, 0, f.pos.z);
    }

    // 空き段ボールの山（置けるのは同時に2個まで。同じメッシュを使い回す）
    this.boxes = [];
    if (this.world.spawns.items?.some((it) => it.id === 'box')) {
      this.boxGeo = boxPileGeometry();
      this.boxMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.84 });
      for (let i = 0; i < 2; i++) {
        const mesh = new THREE.Mesh(this.boxGeo, this.boxMat);
        mesh.castShadow = true;
        mesh.visible = false;
        this.scene.add(mesh);
        this.boxes.push({ mesh, on: false, t: 0, i: -1, walk: 0, sight: 0 });
      }
    }
    this.boxCur = { k: 0, v: -1 };

    // 味方のエース新人
    this.ally = this.world.spawns.ally && !demo ? new Ally(this, this.world.spawns.ally) : null;

    // 出張のキャリーケース（音を出す）
    this.suitcase = stage.suitcase ? new Suitcase(this) : null;
    this.noiseTip = false;
    this.beltTip = false;
    this.hurryShown = false;
    this.tipQueue = [];
    this.tipT = 0;

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
    this.suitcase?.dispose();
    this.suitcase = null;
    this.belts?.dispose();
    this.belts = null;
    this.congas = [];
    this.trail?.dispose();
    this.trail = null;
    this.cart?.dispose();
    this.cart = null;
    this.successor?.dispose();
    this.successor = null;
    this.team?.dispose();
    this.team = null;
    for (const t of this.present?.troubles || []) {
      t.sign.removeFromParent();
      t.sign.geometry.dispose();
      t.sign.material.dispose();
      t.tex.dispose();
      t.ring.dispose();
      if (t.npc) {
        t.npc.char.root.removeFromParent();
        for (const m of t.npc.char.meshes) m.geometry.dispose();
      }
    }
    this.present = null;
    for (const w of this.handover?.points || []) {
      w.sign.removeFromParent();
      w.sign.geometry.dispose();
      w.sign.material.dispose();
      w.tex.todo.dispose();
      w.tex.done.dispose();
      w.ring.removeFromParent();
    }
    if (this.handover) {
      this.handover.ringGeo.dispose();
      for (const m of this.handover.mats) m.dispose();
      this.handover = null;
    }
    for (const b of this.boxes || []) b.mesh.removeFromParent();
    this.boxes = [];
    this.boxGeo?.dispose();
    this.boxMat?.dispose();
    this.boxGeo = this.boxMat = null;
    this.greetQ = [];
    this.ui.setFollow(null);
    if (this.lureMesh) {
      this.lureMesh.removeFromParent();
      this.lureMesh.traverse((o) => {
        if (o.isMesh) {
          o.geometry.dispose();
          o.material.dispose();
        }
      });
      this.lureMesh = null;
    }
    this.lure = null;
    this.ui.banner(null);
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
      this.ui.intro(STAGES[i], types, () => this.startStage(), () => this.toTitle(), !!this.world.spawns.ally, STAGES[i].follower, STAGES[i].team);
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
    if (this.handover) this.ui.setRally(this.handover.points, -1, '引き継ぎ（あと3か所）');
    if (this.cart) this.ui.setFollow('台車 同行中');
    if (this.successor) this.ui.setFollow(FOLLOW_TEXT.follow);
    if (this.team) this.team.refreshHud();
    this.teamLabel = '';
    if (this.team?.hasAsleep()) this.ui.setGoalLabel(`起こす：${this.team.nearestAsleep(this.player.pos.x, this.player.pos.z).name}`);
    this.state = 'flyover';
    this.flyT = 0;
    this.input.reset();
    const g = this.flyGoal();
    this.ui.float(g.x, 2.6, g.z, this.fetch ? `まずは：${this.stage.fetchLabel}` : this.rooms ? `いま空いている：${this.rooms.list[this.rooms.free].name}` : this.handover ? 'まずは：引き継ぎポイント（★）3か所' : `ゴール：${this.stage.goalLabel}${this.team ? '（チーム全員で）' : ''}`, 'good');
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
    for (const L of this.congas) L.update(dt);

    this.world.update(dt, this.time, this.clock, P ? P.pos : null);
    if (this.world.playerLight && P) this.world.playerLight.position.set(P.pos.x, 2.6, P.pos.z + 0.4);
    for (const r of this.rally || []) r.char.update(dt);
    this.ally?.update(dt);
    this.team?.animate(dt);
    this.cart?.animate(dt);
    this.successor?.animate(dt);
    this.belts?.update(dt);
    this.suitcase?.update(dt);
    this.traffic?.update(dt, this.state === 'play' || this.state === 'title' || this.state === 'intro');
    this.weather?.update(dt);
    for (const r of this.rooms?.list || []) r.sign.quaternion.copy(this.camera.quaternion);
    for (const c of this.print?.copiers || []) if (c.sign) c.sign.quaternion.copy(this.camera.quaternion);
    for (const w of this.handover?.points || []) w.sign.quaternion.copy(this.camera.quaternion);
    for (const t of this.present?.troubles || []) if (t.on) t.sign.quaternion.copy(this.camera.quaternion);
    for (const t of this.present?.troubles || []) t.npc?.char.update(dt);
    this.fx.update(dt);
    this.updateCamera(dt);
  }

  // --- 通常プレイ -----------------------------------------------------------
  updatePlay(dt) {
    const P = this.player;
    const stage = this.stage;
    this.clock += dt * stage.rate;
    // 連行中は時計が速く進む
    if (P.attached?.mode === 'drag') this.clock += dt * stage.rate * (P.attached.line.cfg.dragClock - 1);
    // 傘で顔を隠している間・大掃除隊にまぎれている間は、敵の判定より先に「見えない」ことにする
    this.playerHidden = P.umbrellaT > 0 || P.attached?.mode === 'ride';
    this.auraLevel = 0;
    this.updatePlayerField();
    // 年末進行：締切が1回だけ前倒しになる
    const sq = stage.squeeze;
    if (sq && !this.squeezed && this.clock >= sq.at) {
      this.squeezed = true;
      stage.deadline = sq.to;
      this.ui.setDeadline(sq.to);
      this.ui.toast(sq.text, 'announce');
      this.ui.flash('rgba(224,64,47,0.28)');
      this.audio.alarm();
      this.shake(0.2);
    }
    // 床に置いたカラオケ割引券
    if (this.lure) {
      this.lure.t -= dt;
      this.lureMesh.rotation.y += dt * 2;
      if (this.lure.t <= 0) {
        this.lure = null;
        this.lureMesh.visible = false;
      }
    }

    for (const e of this.enemies) e.update(dt);
    // 敵の処理の中で会話が始まった（二次会電車がカラオケに着いた）
    if (this.state !== 'play') return;
    P.frozen = false;
    P.update(dt, this.input);
    this.boss?.update(dt);
    // 足あと：記録 → 同行者 → 床の足あと（いちばん後ろのたどり手から）
    if (this.trail) {
      this.trail.record(P.pos.x, P.pos.z, P.dashing);
      this.cart?.update(dt);
      this.successor?.update(dt);
      this.trail.updatePrints(dt, this.trailFrom());
      this.team?.update(dt);
    }
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
          // 使い方のヒントは、拾ったときの表示が消えてから出す
          if (ITEMS[it.id].hint) {
            this.tipQueue.push(ITEMS[it.id].hint);
            if (this.tipQueue.length === 1) this.tipT = 1.3;
          }
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
    if (this.updateCongas()) return;
    if (this.cart) this.updateCart();
    if (this.okuriTune) this.updateOkuriGroup(dt);
    if (this.boxes.length) this.updateBoxes(dt);

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
    this.ui.updateHud(this.clock, stage, P.papers, P.dashCD / 0.95, P.attached?.mode === 'drag' ? 'drag' : this.present?.active > 0);
    if (P.attached?.mode === 'drag') this.ui.setProgress(P, P.attached.presses / P.attached.line.cfg.presses, 'ダッシュ連打でふりほどけ！', false);
    this.phoneBtn ??= document.getElementById('btn-phone');
    this.phoneBtn.style.setProperty('--cd', P.phoneLeft > 0 ? (P.phoneCD / 4).toFixed(3) : '1');
    if (this.phoneLeftShown !== P.phoneLeft) {
      this.phoneLeftShown = P.phoneLeft;
      this.phoneBtn.querySelector('b').textContent = `残り${P.phoneLeft}`;
      document.getElementById('hint-phone-n').textContent = P.phoneLeft;
    }
    this.phoneBtn.classList.toggle('on', P.phoneT > 0);
    // 印刷中・傘さがし中は目印を出さない（進み具合の表示と重なるため）
    const busy = this.printing || P.presenting || this.team?.progOn || (this.fetch?.phase === 'find' && this.fetch.progress > 0 && Math.hypot(this.fetch.pos.x - P.pos.x, this.fetch.pos.z - P.pos.z) < 1.2);
    this.ui.goalPointer(this.camera, this.currentGoal(), !busy);

    if (this.clock >= stage.deadline) {
      this.fail();
      return;
    }
    if (this.traffic && this.weather) this.updateSplash(dt);
    // ステージの説明を順に出す・初めて歩道に乗ったとき・締切が近いとき
    if (this.tipQueue.length && !this.team?.progOn) {
      this.tipT -= dt;
      if (this.tipT <= 0) {
        this.tipT = 2.6;
        this.ui.float(P.pos.x, 2.7, P.pos.z, this.tipQueue.shift(), 'info');
      }
    }
    if (this.belts && !this.beltTip && this.belts.isBelt(P.pos.x, P.pos.z)) {
      // 乗るとすぐ流されるので、その場に浮かべず画面の真ん中に出す
      this.beltTip = true;
      this.ui.toast('動く歩道：速くて静か。途中で降りられない', 'announce');
    }
    if (stage.hurry && !this.hurryShown && stage.deadline - this.clock <= stage.hurry.left) {
      this.hurryShown = true;
      this.ui.toast(stage.hurry.text, 'announce');
    }
    if (this.rally) {
      if (this.updateRally(dt)) return;
    } else if (this.print) {
      this.updatePrint(dt);
    } else if (this.rooms) {
      this.updateRooms(dt);
    } else if (this.fetch) {
      this.updateFetch(dt);
    } else if (this.handover) {
      if (this.updateHandover(dt)) return;
    } else if (this.present) {
      if (this.updatePresent(dt)) return;
    } else {
      const g = this.world.spawns.goal;
      if (this.team) this.updateTeamGoal();
      if (Math.hypot(g.x - P.pos.x, g.z - P.pos.z) < 0.85) {
        // 置いてきた仲間の待ち時間を払ってからゴール
        if (this.team && !this.team.settle()) return;
        this.reachGoal();
      }
    }

    this.cam.goalTarget.set(P.pos.x + P.vel.x * 0.28, 0, P.pos.z + P.vel.y * 0.28);
    this.cam.goalScale = 1;
    // プレゼン中は少し引いて、審査員席（北）まで映す
    if (this.present?.phase === 'talk') {
      this.cam.goalTarget.z -= 4.5;
      this.cam.goalScale = 1.15;
    }
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
      this.playerField = g.field(tx, tz, true); // 追いかける人は動く歩道を逆走してでも来る
    }
  }

  separate() {
    const E = this.enemies;
    for (let i = 0; i < E.length; i++) {
      if (E[i].state === 'lurk' || E[i].state === 'inline') continue;
      for (let j = i + 1; j < E.length; j++) {
        if (E[j].state === 'lurk' || E[j].state === 'inline') continue;
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
    // 出張ではケースを持ってくれる（その間は無音）
    if (this.suitcase) {
      this.suitcase.carrier = this.ally;
      this.ally.say('先輩、お荷物お持ちします！', 2);
    }
  }

  onPlayerDash() {
    this.suitcase?.onDash();
  }

  /** キャリーケースなどの物音。半径 r に入った人が振り向き、近くの客室のドアが開く */
  noise(x, z, r, src = 'walk') {
    if (!this.suitcase || this.state !== 'play' || r <= 0) return;
    this.suitcase.ring(x, z, r, src);
    if (src !== 'voice') this.player.noiseT = 0.18;
    let heard = 0;
    for (const e of this.enemies) if (e.hear(x, z, r, src)) heard++;
    if (src !== 'voice' && this.world.doors.length) {
      let opened = 0;
      for (const e of this.enemies) {
        if (opened >= 2) break;
        if (e.door == null || e.state !== 'lurk' || e.rearm > 0 || e.cool > 0) continue;
        const d = this.world.doors[e.door];
        if (Math.hypot(d.x - x, d.z - z) > r + 0.4) continue;
        opened++;
        heard++;
        this.world.openDoor(e.door);
        this.audio.door();
        e.peek();
      }
    }
    if (heard && !this.noiseTip) {
      this.noiseTip = true;
      this.ui.float(this.player.pos.x, 3.3, this.player.pos.z, '音で気づかれた！', 'minus');
    }
  }

  /** ばらまき土産：まわりの人にお土産を配って、しばらく大人しくさせる */
  scatterGifts() {
    const P = this.player;
    let n = 0;
    for (const e of this.enemies) {
      if (e.state === 'lurk' || !e.char.root.visible) continue;
      if (Math.hypot(e.pos.x - P.pos.x, e.pos.z - P.pos.z) > 4.5) continue;
      if (e.kind === 'keiri' || e.kind === 'shacho') {
        e.say('…これ、経費で落としてないでしょうね？', '', 1.8);
        continue;
      }
      e.calm(10);
      e.say(pick(Math.random, ['あ、どうもどうも！', 'お、名物だ！', '気が利くね〜！', 'わざわざすみません〜！']), '', 1.6);
      this.ui.emote(e, '♪');
      n++;
    }
    this.ui.bubble(P, n ? 'みなさん、どうぞどうぞ！' : '（だれもいない…自分で1個食べた）', 'player', 1.6);
    this.ui.float(P.pos.x, 3.2, P.pos.z, n ? `ばらまき！ ${n}人おとなしく` : 'ばらまき空振り', n ? 'good' : 'info');
    this.fx.sparkle(P.pos.x, 1.2, P.pos.z, 10);
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

  // --- 行列（第7章） -----------------------------------------------------------
  /** 行列ごとの巻き込み・触れたとき・くぐったときの処理。会話が始まったら true */
  updateCongas() {
    const P = this.player;
    for (const L of this.congas) {
      const e = L.leader;
      const K = L.cfg;
      const T = e.tune;
      // 追ってくる人が列にぶつかると、その人も並ぶ（幹事は宴会好きの先頭に近づいただけで）
      if (e.state !== 'lured' && e.state !== 'held') {
        for (const o of this.enemies) {
          if (!ABSORB.has(o.kind) || o.inLine || o.state === 'lured' || o.state === 'held') continue;
          const chasing = o.state === 'chase' || o.state === 'rush' || o.state === 'follow';
          if ((chasing && L.nearest(o.pos.x, o.pos.z) < T.absorbR) ||
              (o.kind === 'kanji' && e.cfg.party && o.cool <= 0 && Math.hypot(o.pos.x - e.pos.x, o.pos.z - e.pos.z) < T.absorbHeadR)) L.absorb(o);
        }
      }
      if (P.attached) continue;
      // ヒントは 7m 以内で出すので、それまでは遠くまで距離を測る
      const d = L.nearest(P.pos.x, P.pos.z, this.congaHinted ? 2 : 7);
      if (!this.congaHinted && d < 7 && this.stage.congaHint) {
        this.congaHinted = true;
        this.ui.toast(this.stage.congaHint, 'announce');
      }
      if (d > 1.2 || P.umbrellaT > 0) continue;
      // ダッシュでくぐる（ダッシュ1回につき1回だけ数える）
      if (P.dashing) {
        if (K.touch !== 'ride' && e.congaCatching && d < 0.95 && L.missDash !== P.dashN) {
          L.missDash = P.dashN;
          this.nearMiss(e);
        }
        continue;
      }
      const phonePass = K.phone && P.phoneT > 0;
      if (d < 0.7 && !P.invulnerable && e.congaCatching) {
        if (K.touch === 'talk') {
          if (!phonePass) {
            this.startTalk(e);
            return true;
          }
          // 電話中は会釈して通してくれる
          if (L.phoneNoteT <= 0) {
            L.phoneNoteT = 3;
            L.memberSay(pick(Math.random, e.cfg.phoneLines));
          }
          if (L.phoneMark !== P.phoneLeft) {
            L.phoneMark = P.phoneLeft;
            this.dodges++;
            this.record('dodged', e.type);
            this.ui.float(P.pos.x, 2.3, P.pos.z, 'スルッ！（会釈）', 'good');
          }
          continue;
        }
        if (K.touch === 'ride') {
          // 先頭の隊長に正面からぶつかったときだけ掃除を頼まれる
          const wp = e.patrol[e.pi];
          const fx = wp.x - e.pos.x;
          const fz = wp.z - e.pos.z;
          const px = P.pos.x - e.pos.x;
          const pz = P.pos.z - e.pos.z;
          if (L.hit === 0 && (fx * px + fz * pz) / ((Math.hypot(fx, fz) || 1) * (Math.hypot(px, pz) || 1)) > 0.3) {
            this.startTalk(e);
            return true;
          }
          if (L.rideCD <= 0) this.attach(L, 'ride');
          continue;
        }
        // drag：エース新人 → 菓子折り → 連行 の順
        if (this.tryAlly(e)) continue;
        if (P.takeItem('omiyage')) {
          e.say(e.cfg.omiyageLines[0], '', 1.8);
          L.memberSay(e.cfg.omiyageLines[1]);
          e.set('rest');
          e.cool = 4;
          P.invulnT = 1.5;
          this.dodges++;
          this.record('dodged', e.type);
          this.ui.float(P.pos.x, 2.4, P.pos.z, '菓子折りでセーフ！', 'good');
          this.onItemsChanged();
          continue;
        }
        if (P.phoneT > 0) e.say(pick(Math.random, e.cfg.phoneLines), '', 1.6);
        this.attach(L, 'drag');
        continue;
      }
      // 列は壁のように押し返す（大掃除隊と、電話中に会釈してくれる列は通れる）
      if (d < 0.62 && K.touch !== 'ride' && !phonePass) {
        L.pushOut(P.pos, 0.62);
        this.world.grid.resolveCircle(P.pos, P.r);
      }
    }
    return false;
  }

  /** 行列の最後尾につながる（ride：まぎれこむ／drag：連行される） */
  attach(L, mode) {
    const P = this.player;
    const e = L.leader;
    P.attached = { line: L, mode, presses: 0, t: 0 };
    P.vel.set(0, 0);
    P.slipT = 0;
    P.phoneT = 0;
    if (mode === 'ride') {
      this.ui.float(P.pos.x, 2.4, P.pos.z, '大掃除隊にまぎれこんだ！', 'good');
      e.say(pick(Math.random, e.cfg.joinLines), '', 1.6);
      this.audio.sparkle();
    } else {
      this.record('caught', e.type);
      this.caught++;
      e.set('haul');
      e.say(pick(Math.random, e.cfg.dragLines), '', 1.6);
      this.audio.caught();
      this.shake(0.15);
      this.ui.float(P.pos.x, 3.9, P.pos.z, '連行！ ダッシュ連打でふりほどけ！', 'minus'); // 連打のゲージより上に出す
    }
  }

  /** つながっている間のダッシュ：ride は降りる、drag は連打でふりほどく */
  onAttachedDash() {
    const P = this.player;
    const A = P.attached;
    const L = A.line;
    const e = L.leader;
    const K = L.cfg;
    if (A.mode === 'drag') {
      if (A.t < K.lockT) return;
      A.presses++;
      P.char.play('stagger');
      if (A.presses < K.presses) {
        this.ui.float(P.pos.x, 3.9, P.pos.z, 'ジタバタ！', 'info');
        return;
      }
    }
    // 抜ける向きはスティックの向き。入力がなければ列の進行方向の右（壁なら左）
    const mv = this.input.move;
    if (Math.hypot(mv.x, mv.y) > 0.1) _dashDir.set(mv.x, mv.y);
    else {
      const l = Math.hypot(e.vel.x, e.vel.z) || 1;
      _dashDir.set(-e.vel.z / l, e.vel.x / l);
      if (_dashDir.lengthSq() < 0.01) _dashDir.set(1, 0);
      if (!this.world.grid.isWalkWorld(P.pos.x + _dashDir.x * 1.2, P.pos.z + _dashDir.y * 1.2)) _dashDir.negate();
    }
    P.attached = null;
    P.startDash(_dashDir);
    if (A.mode === 'ride') {
      P.invulnT = 0.6;
      L.rideCD = e.tune.rideCD;
      e.say(pick(Math.random, e.cfg.leaveLines), '', 1.4);
    } else {
      P.invulnT = 1.2;
      e.set('rest');
      e.say(pick(Math.random, e.cfg.escapeLines), '', 1.6);
      this.dodges++;
      this.record('dodged', e.type);
      this.ui.float(P.pos.x, 2.6, P.pos.z, 'ふりほどいた！', 'good');
      this.ui.setProgress(null);
      this.fx.sparkle(P.pos.x, 1, P.pos.z, 12);
      this.audio.sparkle();
    }
  }

  /** 二次会電車が連行先（カラオケ個室）に着いた */
  congaArrive(e) {
    const P = this.player;
    if (P.attached?.line !== e.conga) {
      e.set('rest');
      return;
    }
    P.attached = null;
    this.ui.setProgress(null);
    this.startTalk(e, false, { noRecord: true }); // 捕まった回数は連行のときに数えた
  }

  onAbsorb(e) {
    this.dodges++;
    this.record('dodged', e.type);
    this.ui.float(e.pos.x, 2.6, e.pos.z, '列に巻き込んだ！', 'good');
    this.ui.emote(e, '？');
  }

  /** カラオケ割引券を足元に置く（置けるのは1枚。2枚目は置き直し） */
  dropLure(x, z) {
    const P = this.player;
    this.lure = { x, z, t: 8 };
    if (!this.lureMesh) {
      this.lureMesh = itemMesh('karaoke');
      this.scene.add(this.lureMesh);
    }
    this.lureMesh.position.set(x, 0.65, z);
    this.lureMesh.visible = true;
    this.fx.ring(x, z, ITEMS.karaoke.color, 3, 0.8);
    this.ui.bubble(P, '（割引券をそっと置く）', 'player', 1.4);
  }

  // --- 足あと（第8章） ---------------------------------------------------------
  /** 床に足あとを並べはじめる s（いちばん後ろのたどり手。いなければ直近 6m） */
  trailFrom() {
    let s = Infinity;
    if (this.cart) s = this.cart.s;
    if (this.successor) s = Math.min(s, this.successor.s);
    for (const e of this.enemies) if (e.kind === 'okuri' && e.state === 'walk') s = Math.min(s, e.s);
    return s === Infinity ? this.trail.headS - 6 : s;
  }

  /** エース新人が同行者のさらに後ろを歩くときの距離（足あとの上で、主人公から何 m 後ろか） */
  allyTrailBack() {
    if (this.team) return (this.team.lineCount() + 1) * this.team.spacing;
    return this.cart ? 4.2 : this.successor ? 3.0 : null; // 台車は押尾さん（3.3m後ろ）と重ならないよう 4.2
  }

  /** 台車：後ろから追ってきた人をはね飛ばす・来た道を引き返した主人公をひく */
  updateCart() {
    const C = this.cart;
    const P = this.player;
    const cp = C.cartPos;
    for (const e of this.enemies) {
      if (KNOCK_SKIP.has(e.kind) || e.state === 'slipped' || e.state === 'held' || e.state === 'lurk' || e.state === 'inline') continue;
      if (Math.hypot(e.pos.x - cp.x, e.pos.z - cp.z) >= 0.8 || (C.v < 1 && !e.chasing)) continue;
      e.slip(DAISHA.hit, '台車でドーン！ 振り切った！');
      C.cue = DAISHA.move[0]; // 吹き出しが重ならないよう、少し間をおいて言う
      C.lineT = 0.7;
      this.audio.trip();
    }
    const dx = P.pos.x - cp.x;
    const dz = P.pos.z - cp.z;
    if (C.hitCD > 0 || C.v < 1 || Math.hypot(dx, dz) >= 0.75 || dx * C.dirX + dz * C.dirZ <= 0) return;
    C.hitCD = 1.5;
    if (P.invulnerable) {
      this.dodges++;
      this.ui.float(P.pos.x, 2.3, P.pos.z, 'スルッ！', 'good');
      this.audio.sparkle();
      return;
    }
    this.clock += 1;
    P.slowT = 0.5;
    P.char.play('stagger');
    // 進行方向の横（主人公がいる側。歩けなければ反対側）へ押し出す
    let side = dx * -C.dirZ + dz * C.dirX >= 0 ? 1 : -1;
    for (let k = 0; k < 2; k++, side = -side) {
      const nx = P.pos.x - C.dirZ * 0.6 * side;
      const nz = P.pos.z + C.dirX * 0.6 * side;
      if (this.world.grid.isWalkWorld(nx, nz)) {
        P.pos.x = nx;
        P.pos.z = nz;
        break;
      }
    }
    this.world.grid.resolveCircle(P.pos, P.r);
    this.shake(0.12);
    this.audio.paperHit();
    this.ui.float(P.pos.x, 2.3, P.pos.z, 'ゴツン！ 台車 -1分', 'minus');
    C.say(DAISHA.bump[1], 1.4);
  }

  /** お見送り隊：人数と盛り上がり、傘での解散、叫び声、追従者チップ */
  updateOkuriGroup(dt) {
    const P = this.player;
    let n = 0;
    for (const e of this.enemies) if (e.kind === 'okuri' && (e.state === 'walk' || e.state === 'join')) n++;
    if (n && P.umbrellaT > 0) {
      this.okuriSay('主役が消えた！', n);
      this.scatterOkuri();
      n = 0;
    }
    this.okuriN = n;
    this.okuriShoutT -= dt;
    if (n) {
      if (n >= this.okuriTune.hypeAt && !this.okuriHype) {
        this.okuriHype = true;
        this.ui.toast('盛り上がってまいりました！（追っ手が速くなった）', 'announce');
        this.okuriSay('ヒューヒュー！', n);
      } else if (P.phoneT > 0 && this.okuriPhone !== P.phoneLeft) {
        this.okuriPhone = P.phoneLeft;
        this.okuriSay('シーッ、主役が電話中！', n);
      } else if (this.okuriShoutT <= 0) {
        this.okuriShoutT = 2.2;
        this.okuriSay(null, n);
      }
    }
    if (n !== this.okuriShown) {
      this.okuriShown = n;
      this.ui.setFollow(n ? `お見送り ×${n}` : null, 'okuri');
    }
  }

  /** 追っているお見送り隊の誰か1人がしゃべる（text が null なら shouts から） */
  okuriSay(text, n) {
    let r = Math.floor(Math.random() * n);
    for (const e of this.enemies) {
      if (e.kind !== 'okuri' || (e.state !== 'walk' && e.state !== 'join') || r-- > 0) continue;
      e.say(text || pick(Math.random, e.cfg.shouts), 'okuri', 1.4);
      return;
    }
  }

  scatterOkuri() {
    for (const e of this.enemies) if (e.kind === 'okuri' && (e.state === 'walk' || e.state === 'join' || e.state === 'lost')) e.scatter();
    if (this.okuriShown) {
      this.okuriShown = 0;
      this.ui.setFollow(null);
    }
  }

  // --- 引き継ぎ（STAGE 23） ----------------------------------------------------
  /** まだ済んでいない・主人公もまだ踏んでいない引き継ぎポイントのうち、いちばん近いもの */
  handoverTarget() {
    const P = this.player;
    let best = null;
    let bd = Infinity;
    for (const w of this.handover.points) {
      if (w.done || w.trod) continue;
      const d = Math.hypot(w.pos.x - P.pos.x, w.pos.z - P.pos.z);
      if (d < bd) {
        bd = d;
        best = w;
      }
    }
    return best;
  }

  /** 淀川さんが踏んだ判定・あいさつ・オリエンテーション・ゴール。ゴールしたら true */
  updateHandover(dt) {
    const H = this.handover;
    const P = this.player;
    const S = this.successor;
    const W = this.world.W;
    H.noteT = Math.max(0, H.noteT - dt);
    const ptile = Math.floor(P.pos.z) * W + Math.floor(P.pos.x);
    const stile = Math.floor(S.pos.z) * W + Math.floor(S.pos.x);
    let left = 0;
    S.closeIn = false;
    for (const w of H.points) {
      if (w.done) continue;
      if (S.state === 'follow' && (stile === w.tile || Math.hypot(S.pos.x - w.pos.x, S.pos.z - w.pos.z) < 0.75)) {
        w.done = true;
        S.set('memo', 1.5);
        S.say(w.memo, 1.8);
        w.sign.material.map = w.tex.done;
        w.sign.material.needsUpdate = true;
        w.ring.material = H.mats[1];
        // スマホでは短く。吹き出し（メモ・「ここです！」）と重ならないよう高めに出す
        this.ui.dropBubble(P);
        this.ui.float(P.pos.x, 3.0, P.pos.z, this.input.touch ? `引き継ぎ${NUMS[w.i]} 完了！` : `引き継ぎ${NUMS[w.i]}『${w.name}』完了！`, 'good');
        this.fx.sparkle(S.pos.x, 1.2, S.pos.z, 12);
        this.audio.stamp();
        H.label = '';
        continue;
      }
      left++;
      if (ptile === w.tile) S.closeIn = true; // ★の上で待てば、淀川さんがそばまで来て踏む
      if (!w.trod && ptile === w.tile) {
        w.trod = true;
        w.trodS = this.trail.headS;
        this.ui.bubble(P, '淀川さん、ここです！', 'player', 1.4);
      } else if (w.trod && S.s > w.trodS + 1.5) {
        w.trod = false; // 淀川さんが踏みそこねたら、もう一度案内する
      }
    }
    // 目標の表示（変わったときだけ書き換える）
    const tgt = this.handoverTarget();
    const g = this.world.spawns.goal;
    this.world.goalFx.group.position.set(tgt ? tgt.pos.x : g.x, 0, tgt ? tgt.pos.z : g.z);
    const label = tgt ? tgt.star : this.stage.goalLabel;
    if (label !== H.label) {
      H.label = label;
      this.ui.setRally(H.points, -1, label);
    }
    this.ui.setFollow(FOLLOW_TEXT[S.state], S.state === 'follow' || S.state === 'done' ? '' : 'busy');
    // あいさつされた人は 0.5 秒後に気づく
    for (let i = this.greetQ.length - 1; i >= 0; i--) {
      const q = this.greetQ[i];
      q.t -= dt;
      if (q.t > 0) continue;
      this.greetQ.splice(i, 1);
      this.greetAlert(q.e);
    }
    // オリエンテーション中のやりとり（深川さんと淀川さんが交互に）
    const o = H.orient;
    if (o) {
      o.t -= dt;
      if (o.t <= 0 && o.e.state === 'held' && o.i < 6) {
        o.t = 0.75;
        if (o.i % 2 === 0) o.e.say(o.e.cfg.orientLines[(o.i / 2) % o.e.cfg.orientLines.length], '', 1.4);
        else S.say(SUCCESSOR.orient[((o.i - 1) / 2) % SUCCESSOR.orient.length], 1.4);
        o.i++;
      } else if (o.e.state !== 'held') H.orient = null;
    }
    H.greetT -= dt;
    if (S.state === 'follow' && H.greetT <= 0) {
      H.greetT = 0.1;
      this.greetCheck(S);
    }
    // 部長席：3か所が済んで、淀川さんがそばにいればクリア
    if (Math.hypot(g.x - P.pos.x, g.z - P.pos.z) < 0.85) {
      if (!left && Math.hypot(S.pos.x - P.pos.x, S.pos.z - P.pos.z) <= 2.5) {
        this.reachGoal();
        return true;
      }
      if (H.noteT <= 0) {
        H.noteT = 3;
        this.ui.float(P.pos.x, 2.3, P.pos.z, left ? `引き継ぎがまだ${left}か所` : '淀川さんを連れてこないと！', 'info');
      }
    }
    return false;
  }

  /** 淀川さんのそばの人：律儀にあいさつする（電話・傘の間は会釈だけ）。深川さんはオリエンテーション */
  greetCheck(S) {
    const P = this.player;
    const grid = this.world.grid;
    for (const e of this.enemies) {
      if (e.cool > 0 || e.behaving || Math.hypot(e.pos.x - S.pos.x, e.pos.z - S.pos.z) >= 1.6) continue;
      if (e.cfg.orientation) {
        if (!ORIENT_FROM.has(e.state)) continue;
        e.hold(e.cfg.orientation, S.pos);
        S.set('orient', e.cfg.orientation, e);
        this.handover.orient = { e, t: 0, i: 0 };
        this.ui.emote(e, '！');
        this.ui.float(S.pos.x, 2.6, S.pos.z, `新任者オリエンテーション（${e.cfg.orientation}秒）`, 'info');
        return;
      }
      if (e.greetT > 0 || !GREETABLE.has(e.kind) || !CALM.has(e.state) || !grid.los(S.pos.x, S.pos.z, e.pos.x, e.pos.z)) continue;
      e.greetT = 15;
      if (P.phoneT > 0 || P.umbrellaT > 0) {
        S.say(pick(Math.random, SUCCESSOR.quiet), 1.4);
        continue;
      }
      S.set('greet', 0.8, e);
      S.say(pick(Math.random, SUCCESSOR.greet), 1.6);
      e.say(pick(Math.random, e.cfg.kouninLines || KOUNIN_REACT), '', 1.8);
      this.ui.emote(e, '？');
      this.greetQ.push({ e, t: 0.5 });
      return;
    }
  }

  /** あいさつされた人が、滑川に気づく */
  greetAlert(e) {
    if (e.kind === 'shinjin' && e.state === 'idle') e.shinjinNotice();
    else if ((e.kind === 'mtg' || e.kind === 'keiri') && e.state === 'look' && e.cool <= 0) e.spot();
    else e.alert();
  }

  // --- 空き段ボール -----------------------------------------------------------
  /** すぐ後ろの足あとの上に段ボールの山を置く。置けなければ false（アイテムは減らさない） */
  placeBox() {
    const P = this.player;
    const grid = this.world.grid;
    const tr = this.trail;
    for (const d of [1.2, 1.8, 0.8]) {
      if (tr) tr.sample(tr.headS - d, this.boxCur, _tp);
      else {
        _tp.x = P.pos.x - P.facing.x * d;
        _tp.z = P.pos.z - P.facing.y * d;
      }
      const tx = Math.floor(_tp.x);
      const tz = Math.floor(_tp.z);
      if (!this.canBox(tx, tz)) continue;
      let b = this.boxes.find((o) => !o.on);
      if (!b) {
        b = this.boxes[0].t > this.boxes[1].t ? this.boxes[0] : this.boxes[1];
        this.removeBox(b, false);
      }
      const i = tz * grid.w + tx;
      b.i = i;
      b.walk = grid.walk[i];
      b.sight = grid.sight[i];
      grid.walk[i] = 0;
      grid.sight[i] = 1; // 後ろの追っ手から見えなくなる
      grid.fields.clear();
      this.lastTile = -1;
      b.on = true;
      b.t = 0;
      b.mesh.position.set(tx + 0.5, 0, tz + 0.5);
      b.mesh.rotation.y = (Math.random() - 0.5) * 0.6;
      b.mesh.scale.setScalar(0.01);
      b.mesh.visible = true;
      this.fx.dust(tx + 0.5, tz + 0.5, 12, '#e8d9b0', 1.2);
      this.audio.noise(0.25, { freq: 260, q: 0.8, vol: 0.3 });
      this.shake(0.06);
      this.ui.float(P.pos.x, 2.4, P.pos.z, pick(Math.random, BOX_LINES), 'good');
      return true;
    }
    this.ui.float(P.pos.x, 2.3, P.pos.z, 'ここには置けない', 'info');
    return false;
  }

  /** 段ボールを置けるマスか（歩けるマス・自分のマスでない・ゴールや★やエレベーターの隣でない・人がいない） */
  canBox(tx, tz) {
    const grid = this.world.grid;
    const P = this.player;
    if (!grid.isWalk(tx, tz) || (Math.floor(P.pos.x) === tx && Math.floor(P.pos.z) === tz)) return false;
    for (let y = tz - 1; y <= tz + 1; y++) for (let x = tx - 1; x <= tx + 1; x++) if ('GWe'.includes(grid.at(x, y))) return false;
    const near = (p) => Math.hypot(Math.max(tx - p.x, 0, p.x - tx - 1), Math.max(tz - p.z, 0, p.z - tz - 1)) < 0.5;
    for (const e of this.enemies) if (e.char.root.visible && near(e.pos)) return false;
    if (this.cart && (near(this.cart.pos) || near(this.cart.cartPos))) return false;
    if (this.successor && near(this.successor.pos)) return false;
    return !(this.ally && near(this.ally.pos));
  }

  removeBox(b, note) {
    const grid = this.world.grid;
    grid.walk[b.i] = b.walk;
    grid.sight[b.i] = b.sight;
    grid.fields.clear();
    this.lastTile = -1;
    b.on = false;
    b.mesh.visible = false;
    if (note) this.ui.float(b.mesh.position.x, 2.2, b.mesh.position.z, '段ボール、回収されていった', 'info');
  }

  /** 置いた山は 0.15 秒で大きくなって現れ、8 秒で縮んで消える */
  updateBoxes(dt) {
    for (const b of this.boxes) {
      if (!b.on) continue;
      b.t += dt;
      b.mesh.scale.setScalar(clamp(Math.min(b.t, 8 - b.t) / 0.15, 0.01, 1));
      if (b.t >= 8) this.removeBox(b, true);
    }
  }

  // --- 会話 -----------------------------------------------------------------
  /** エース新人が一度だけ身代わりになる。なったら true */
  tryAlly(e) {
    if (this.ally?.state !== 'follow') return false;
    const P = this.player;
    this.ally.intercept(e);
    P.invulnT = 2;
    this.dodges++;
    this.record('dodged', e.type);
    this.ui.float(P.pos.x, 2.4, P.pos.z, 'エース新人が身代わりに！', 'good');
    this.fx.sparkle(P.pos.x, 1, P.pos.z, 14);
    this.audio.sparkle();
    this.ui.setAlly(false);
    if (this.suitcase?.carrier) {
      this.suitcase.carrier = null;
      this.ui.float(P.pos.x, 3.0, P.pos.z, 'ケースが戻ってきた', 'info');
    }
    return true;
  }

  startTalk(e, called = false, opt = {}) {
    // お見送り隊は、会話が始まったら（身代わりのときも）満足して解散する
    this.scatterOkuri();
    if (!opt.skipAlly && this.tryAlly(e)) return;
    const P = this.player;
    if (!opt.noRecord) {
      this.record('caught', e.type);
      this.caught++;
    }
    P.attached = null;
    P.slipT = 0;
    this.state = 'talk';
    P.frozen = true;
    P.vel.set(0, 0);
    e.vel.x = e.vel.z = 0;
    // 向かい合って話せる距離まで離す（行列の先頭は動かさない：瞬間移動すると跡が壁を貫く）
    if (!e.conga) {
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
    // 人数ぶんの名刺交換（ご挨拶ご一行）
    const n = e.conga ? e.conga.count() : 1;
    if (e.cfg.conga?.perMember) {
      penalty = e.cfg.penalty + e.cfg.conga.perMember * n;
      stampSmall = `<br>${e.cfg.stamp}×${n}`;
    }
    // 人数分の入館チェック（会場係）：列の仲間と、同行中の早瀬くんのぶん
    if (e.cfg.perMember) {
      const names = this.team ? this.team.lineNames() : [];
      if (this.ally?.state === 'follow') names.push(ALLY.name);
      penalty = e.cfg.penalty + e.cfg.perMember * names.length;
      lines = [lines[0], e.cfg.checkSelf, ...names.slice(0, 4).map((nm) => e.cfg.checkMember.replace('{name}', nm)), lines[lines.length - 1]];
      stampSmall = `<br>${e.cfg.stamp}×${names.length + 1}`;
    }
    if (P.takeItem('omiyage')) {
      lines = [lines[0], '（菓子折りを差し出す）', 'お、気が利くね！…じゃあ手短に。'];
      penalty = Math.ceil(penalty / 2);
      stampSmall = '<br>菓子折り効果';
      this.onItemsChanged();
    }
    lines = lines.map((l) => l.replace('{n}', n).replace('{m}', penalty).replace('{N}', penalty));
    this.openTalk({
      who: e.cfg,
      portrait: this.ui.portraits[e.face || e.type],
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
          this.ui.float(P.pos.x, 2.3, P.pos.z, `${e.cfg.papersLabel || '書類'}+${e.cfg.papers}`, 'minus');
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
      this.tipQueue = [...(this.stage.tips || [])];
      this.tipT = 0.8;
      this.ui.toast('スタート！');
      this.audio.countdown(true);
      const F = this.cart || this.successor;
      F?.say(F.cfg.hello[0], 2.2);
      this.input.reset();
      for (const e of this.enemies) {
        e.pos.set(e.home.x, 0, e.home.z);
        if (e.patrol) e.pi = e.nearestWaypoint();
        if (e.crew) e.rivalReset(); // 勝田のチームは、いまいる区間から歩きだす
        e.conga?.reset(); // 一番近い頂点を選ぶと列が逆走することがあるので、出現時の向きに戻す
      }
    }
  }

  // --- ゴール -----------------------------------------------------------------
  // --- ハンコラリー -----------------------------------------------------------
  /** 開始演出でカメラが最初に映す場所 */
  flyGoal() {
    return this.fetch || this.rooms || this.handover ? this.currentGoal() : this.world.spawns.goal;
  }

  currentGoal() {
    if (this.present?.phase === 'talk') return this.presentTarget()?.pos || this.world.spawns.goal;
    if (this.team?.hasAsleep()) return this.team.nearestAsleep(this.player.pos.x, this.player.pos.z).pos;
    if (this.handover) return this.handoverTarget()?.pos || this.world.spawns.goal;
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
        this.ui.setProgress(F, F.progress, this.stage.fetchProgress || 'どれが自分の傘…？');
      } else if (F.progress > 0) {
        this.ui.setProgress(F, F.progress, this.stage.fetchPause || '探索中断');
      }
      if (F.progress >= 1) {
        F.phase = 'deliver';
        this.world.goalFx.group.visible = true;
        this.ui.setProgress(null);
        this.ui.bubble(P, this.stage.fetchLine || 'あった！…たぶんこれ！', 'player', 1.8);
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

  // --- チーム（第9章） -----------------------------------------------------------
  /** 寝ている仲間がいる間は、いちばん近い人に目印を出す */
  updateTeamGoal() {
    const P = this.player;
    const m = this.team.nearestAsleep(P.pos.x, P.pos.z);
    const tgt = m ? m.pos : this.world.spawns.goal;
    this.world.goalFx.group.position.set(tgt.x, 0, tgt.z);
    const label = m ? `起こす：${m.name}` : this.stage.goalLabel;
    if (label !== this.teamLabel) {
      this.teamLabel = label;
      this.ui.setGoalLabel(label);
    }
  }

  onHachimaki() {
    const P = this.player;
    if (this.team) this.team.setHachimaki(TEAM_TUNE.hachimaki);
    else {
      P.boostT = 4;
      this.ui.bubble(P, '（自分に巻いた。気合いだけは入った）', 'player', 1.6);
    }
  }

  // --- プレゼン本番（STAGE 27） --------------------------------------------------
  /** 起きているトラブルのうち、いちばん近いもの */
  presentTarget() {
    const P = this.player;
    let best = null;
    let bd = Infinity;
    for (const t of this.present.troubles) {
      if (!t.on) continue;
      const d = Math.hypot(t.pos.x - P.pos.x, t.pos.z - P.pos.z);
      if (d < bd) {
        bd = d;
        best = t;
      }
    }
    return best;
  }

  /** 演台に向かう → 話す（トラブルが起きたら直しに走る）。ゴールしたら true */
  updatePresent(dt) {
    const pr = this.present;
    const C = pr.cfg;
    const P = this.player;
    const g = this.world.spawns.goal;
    const dG = Math.hypot(g.x - P.pos.x, g.z - P.pos.z);
    if (pr.phase === 'approach') return dG < 0.85 && this.startPresent();
    // 話し込みが終わった人（afterTalk）も、本番中はずっと無力化しておく
    for (const e of this.enemies) if (e.cool < 999) e.cool = 999;
    let active = 0;
    const pulse = 0.35 + 0.35 * Math.abs(Math.sin(this.time * 6));
    for (const t of pr.troubles) {
      if (t.replyT > 0 && (t.replyT -= dt) <= 0) this.ui.bubble(t.npc, t.reply, '', 1.8);
      if (!t.on) continue;
      if (Math.hypot(t.pos.x - P.pos.x, t.pos.z - P.pos.z) < C.fixR) {
        this.fixTrouble(t);
        continue;
      }
      active++;
      t.ring.update(t.pos.x, t.pos.z, pulse);
      t.alarmT -= dt;
      if (t.alarmT <= 0) {
        t.alarmT = C.alarmEvery;
        this.ui.bubble(t.who === 'boss' && pr.bossEnt ? pr.bossEnt : t.npc || t, t.alarm, 'keiri', 1.8);
      }
    }
    pr.active = active;
    // 気まずい沈黙：トラブル1件につき毎秒 +0.3分
    this.clock += C.burn * active * dt;
    P.presenting = dG < C.near && !active;
    if (P.presenting) pr.progress = Math.min(1, pr.progress + dt / C.talkTime);
    while (pr.ev < C.events.length && pr.progress >= C.events[pr.ev]) this.spawnTroubles(C.counts[pr.ev++]);
    const n = Math.min(C.slides, 1 + Math.floor(pr.progress * C.slides));
    this.ui.setProgress(pr.podium, pr.progress, P.presenting ? `スライド ${n}/${C.slides}` : active ? 'トラブル発生！' : '中断中（先方が待っている）', !P.presenting);
    // 人が立っているトラブルは、光の柱で隠さない（赤い輪だけ）
    const tt = this.presentTarget();
    const tgt = tt ? tt.pos : g;
    this.world.goalFx.group.position.set(tgt.x, 0, tgt.z);
    this.world.goalFx.group.visible = !P.presenting && !tt?.npc;
    if (pr.progress >= 1) {
      this.reachGoal();
      return true;
    }
    return false;
  }

  /** 演台に着いた：待ち時間を精算し、仲間を演台の横へ。本番中はだれも話しかけてこない */
  startPresent() {
    const pr = this.present;
    const g = this.world.spawns.goal;
    if (this.team && !this.team.settle()) return true;
    pr.phase = 'talk';
    // トラブルの山札（開始時にシャッフルして上から引く）
    pr.deck = pr.troubles.map((t, i) => i);
    for (let i = pr.deck.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [pr.deck[i], pr.deck[j]] = [pr.deck[j], pr.deck[i]];
    }
    this.team?.startPresent(g.x, g.z);
    for (const e of this.enemies) {
      if (e.chasing) e.recover();
      e.cool = 999;
    }
    this.ui.toast('プレゼン開始！');
    if (pr.bossEnt) this.ui.bubble(pr.bossEnt, PRESENT_OPEN, 'mtg', 2.4);
    this.ui.setGoalLabel('トラブル（赤い輪）');
    this.player.char.faceDir(0, -1);
    this.audio.ding();
    return false;
  }

  /** トラブルを n 件起こす（主人公から近い地点は、できれば飛ばす） */
  spawnTroubles(n) {
    const pr = this.present;
    const P = this.player;
    for (let k = 0; k < n && pr.deck.length; k++) {
      let j = pr.deck.findIndex((i) => Math.hypot(pr.troubles[i].pos.x - P.pos.x, pr.troubles[i].pos.z - P.pos.z) >= pr.cfg.minSpawnDist);
      if (j < 0) j = 0;
      const t = pr.troubles[pr.deck.splice(j, 1)[0]];
      t.on = true;
      t.alarmT = 0;
      t.sign.visible = true;
      if (t.npc) {
        t.npc.char.pose = 'talk';
        t.npc.char.play('hop');
      }
      this.fx.ring(t.pos.x, t.pos.z, '#e0402f', 2.2, 0.6);
    }
    P.presenting = false;
    this.audio.alarm();
    this.shake(0.12);
    this.ui.float(P.pos.x, 2.6, P.pos.z, n > 1 ? `トラブル${n}件、同時発生！` : 'トラブル発生！', 'minus');
  }

  fixTrouble(t) {
    const pr = this.present;
    const P = this.player;
    t.on = false;
    t.done = true;
    t.sign.visible = false;
    t.ring.update(t.pos.x, t.pos.z, 0);
    const who = t.who === 'boss' && pr.bossEnt ? pr.bossEnt : P;
    this.ui.bubble(who, t.fix, who === P ? 'player' : 'mtg', 1.8);
    this.ui.float(P.pos.x, 2.4, P.pos.z, '解決！', 'good');
    this.fx.sparkle(t.pos.x, 1.2, t.pos.z, 12);
    this.audio.ding();
    if (t.npc) {
      t.npc.char.pose = 'idle';
      t.replyT = 0.9;
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

  onEnemySlip(e, text) {
    if (this.state !== 'play') return;
    this.dodges++;
    this.record('dodged', e.type);
    // 台車のときは、はね飛ばされた人の吹き出しより上に出す
    this.ui.float(e.pos.x, text ? 2.9 : 2.2, e.pos.z, text || 'ツルッ！ 振り切った！', 'good');
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
    P.attached = null;
    P.presenting = false;
    this.ui.setProgress(null);
    P.frozen = true;
    P.invulnT = 99;
    this.playerHidden = true;
    this.world.goalFx.group.visible = false;
    this.ui.goalPointer(this.camera, null, false);
    this.ui.aura(0);
    this.ui.banner(null);
    this.audio.setTension(false);
    // goalEnd で演出だけ差し替えられる（客室がゴールの fetch など）
    const type = this.stage.goalEnd || this.stage.goalType;
    if (type === 'boss' || type === 'desk' || type === 'handover' || type === 'present') {
      const b = this.boss;
      const npc = this.goalNpc;
      if (this.successor) {
        this.successor.set('done', 0, { pos: b.root.position });
        this.successor.say(SUCCESSOR.goal[0], 2);
      }
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
    P.attached = null;
    this.ui.setProgress(null);
    P.frozen = true;
    P.char.pose = 'shock';
    P.char.setMood('surprised');
    this.ui.toast('時間切れ', 'stamp-toast');
    this.ui.aura(0);
    this.ui.banner(null);
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
