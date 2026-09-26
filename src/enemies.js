import * as THREE from 'three';
import { Character } from './characters.js';
import { CAST } from './cast.js';
import { VisionCone, RangeRing } from './effects.js';
import { clamp, damp, pick, wrapAngle } from './util.js';
import { NOISE } from './suitcase.js';
import { Conga } from './conga.js';
import { Trail } from './trail.js';
import { followTrail } from './team.js';

const TUNING = {
  senpai: { notice: 3.0, chase: 3.25, chaseMax: 4.2, lose: 8, cooldown: 9 },
  keiri: { fov: 1.45, range: 6.8, patrol: 1.5, chase: 4.4, chaseMax: 10, lose: 13, losLost: 2.3, aura: 2.7, auraSlow: 0.7, cooldown: 8 },
  mtg: { fov: 1.2, range: 5.6, patrol: 1.85, chase: 3.8, chaseMax: 5.5, lose: 9, losLost: 1.5, cooldown: 8 },
  shorui: { range: 8.5, interval: 1.9, cooldown: 3 },
  shinjin: { notice: 3.4, follow: 11, shoutEvery: 2.6, shoutR: 7.5, cooldown: 10 },
  kanji: { speed: 3.5, sense: 10, cooldown: 3.5 },
  shacho: { fov: 1.9, range: 7.2, patrol: 1.15, still: 0.9, cooldown: 12 },
  handout: { reach: 1.4, cooldown: 5 },
  zandaka: { speed: 3.0, sense: 99, cooldown: 3 },
  warikomi: { notice: 2.6, printNotice: 9, chase: 3.7, chaseMax: 5, lose: 10, cooldown: 9 },
  doki: { notice: 4.6, fov: 2.4, wander: 1.4, rush: 5.3, rushMax: 1.9, lose: 9, cooldown: 7 },
  golf: { wander: 0.9, notice: 5.5, range: 2.0, fov: 2.2, windup: 0.8, every: 2.4, cooldown: 7 },
  cleaner: { speed: 1.25 },
  mimi: { ear: 2.0, walk: 3.0, search: 1.6, spot: 2.8, chase: 4.4, chaseMax: 1.8, lose: 7, cooldown: 8 },
  // 行列（第7章）。速さや触れたときの動きは cfg.conga
  conga: {
    cooldown: 4, absorbR: 0.6, absorbHeadR: 0.8, absorbT: 14, absorbCool: 6, bowR: 1.6, bowT: 3.5, bowCD: 12,
    yieldMax: 6, tangleR: 0.5, tangleT: 3.5, tangleCD: 8, rideCD: 1.2, lureR: 9,
  },
  // お見送り隊（第8章）：主人公の足あとを嗅ぎつけて追う。速さは base + per × 追っている人数（max まで）
  okuri: {
    join: 2.2, run: 5.0, joinMax: 2.0, base: 3.8, per: 0.2, max: 4.8, hypeAt: 5, space: 0.8,
    gap: 0.9, reacquire: 3.0, lostT: 1.2, lose: 14, back: 6, cooldown: 10,
  },
  // 第9章：ちゃぶ台返し局長（列の最後尾をねらう）と、ライバル勝田（チームを連れて周回し、仲間を引き抜く）
  yappari: { patrol: 1.3, notice: 6.5, chase: 3.7, chaseMax: 5.5, lose: 10, freeze: 0.6, cooldown: 10 },
  rival: { walk: 2.2, spacing: 0.9, stealR: 1.2, stealCD: 8, pushR: 0.55, pause: 0.6, cooldown: 10 },
};

// 濡れた床を走ると転ぶ速さ
const SLIP_SPEED = 3.5;

// 電話中のふりをすると話しかけてこない人たち
const PHONE_RESPECT = new Set(['senpai', 'mtg', 'shinjin', 'kanji', 'doki', 'warikomi', 'okuri']);
// 近づくと話しかけてくるタイプ
const TALKERS = new Set(['senpai', 'warikomi']);

const _dir = { x: 0, z: 0 };
const _tp = { x: 0, z: 0, dx: 0, dz: 1, gap: 0 };

export class Enemy {
  constructor(game, spawn, patrol) {
    this.game = game;
    this.type = spawn.type;
    // セリフ・見た目は CAST → 出現順の variants → ステージごとの lines の順に重ねる
    const base = CAST[this.type];
    const n = base.variants?.length || 0;
    const vi = n ? spawn.index % n : 0;
    const v = n ? base.variants[vi] : null;
    this.cfg = { ...base, ...(v || {}), look: v?.look ? { ...base.look, ...v.look } : base.look, ...(game.stage.lines?.[this.type] || {}) };
    this.face = v?.name ? `${this.type}_${vi}` : this.type; // 顔アイコンのキー
    // 見た目・セリフは type、動き方は kind（別キャラが既存の動きを使い回せる）
    this.kind = this.cfg.behavior || this.type;
    this.tune = { ...TUNING[this.kind], ...(this.cfg.tune || {}) };
    this.char = new Character(this.cfg.look, { outline: true });
    this.pos = new THREE.Vector3(spawn.x, 0, spawn.z);
    this.home = { x: spawn.x, z: spawn.z };
    this.vel = { x: 0, z: 0 };
    this.r = 0.3;
    this.t = 0;
    this.cool = 0;
    this.greetT = 0; // 後任の淀川さんに、もうあいさつされた（秒）
    this.slyT = 0; // ダッシュで横をすり抜けられて、気づきそこねている（秒）
    this.lineT = 1 + Math.random() * 2;
    this.lostT = 0;
    this.nearMissed = false;
    this.patrol = patrol ? patrol.map(([x, z]) => ({ x: x + 0.5, z: z + 0.5 })) : null;
    this.pi = 0;
    this.pdir = 1;
    this.bubble = null;
    this.game.scene.add(this.char.root);

    const grid = game.world.grid;
    // 通路側を向いて立つ
    let best = 0;
    let bestD = -1;
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2;
      const d = grid.sightDistance(spawn.x, spawn.z, Math.sin(a), Math.cos(a), 6);
      if (d > bestD + 0.01) {
        bestD = d;
        best = a;
      }
    }
    this.homeYaw = best;
    this.char.setYaw(best);

    if (this.kind === 'shacho') {
      this.cone = new VisionCone(game.scene, '#ffc933');
      this.state = this.patrol ? 'patrol' : 'stand';
      if (this.patrol) this.pi = this.nearestWaypoint();
      this.passT = 0;
    } else if (this.kind === 'doki') {
      this.state = 'wander';
    } else if (this.kind === 'golf') {
      this.cone = new VisionCone(game.scene, '#ff4b3a');
      this.cone.visible = false;
      this.state = 'wander';
      this.swingT = 1 + Math.random() * 2;
    } else if (this.kind === 'cleaner') {
      this.state = 'work';
    } else if (this.kind === 'mimi') {
      // 紫の輪：この中なら歩く音も聞こえる
      this.ring = new RangeRing(game.scene, '#a05fb5', this.tune.ear * NOISE.walk);
      this.state = 'listen';
      this.goTo = { x: spawn.x, z: spawn.z };
    } else if (this.kind === 'keiri' || this.kind === 'mtg') {
      this.cone = new VisionCone(game.scene, this.cfg.cone || (this.kind === 'keiri' ? '#ff4b3a' : '#ffd23f'));
      this.state = this.patrol ? 'patrol' : 'stand';
      if (this.patrol) this.pi = this.nearestWaypoint();
      this.heardAt = { x: 0, z: 0 };
    } else if (TALKERS.has(this.kind) || this.kind === 'shinjin') {
      this.ring = new RangeRing(game.scene, { senpai: '#f0a23b', warikomi: '#8e6cc7', shinjin: '#3aa56c' }[this.kind], this.tune.notice);
      this.state = 'idle';
    } else if (this.kind === 'kanji' || this.kind === 'zandaka') {
      this.state = 'guard';
      this.guard = game.stage.guard || { axis: 'z', min: spawn.z - 3, max: spawn.z + 3 };
    } else if (this.kind === 'okuri') {
      this.ring = new RangeRing(game.scene, '#ff5c7a', this.tune.join);
      this.state = 'stand';
      this.id = spawn.index;
      this.s = 0;
      this.cur = { k: 0, v: -1 };
    } else if (this.kind === 'yappari') {
      this.ring = new RangeRing(game.scene, '#c0392b', this.tune.notice);
      this.state = this.patrol ? 'patrol' : 'idle';
      if (this.patrol) this.pi = this.nearestWaypoint();
      this.target = null;
    } else if (this.kind === 'rival') {
      this.ring = new RangeRing(game.scene, '#d4af37', this.tune.stealR);
      this.trail = new Trail(game, null);
      this.crew = this.cfg.crew.map((look) => {
        const c = new Character(look, { outline: false });
        game.scene.add(c.root);
        return { char: c, pos: new THREE.Vector3(spawn.x, 0, spawn.z), s: 0, cur: { k: 0, v: -1 }, v: 0, freezeT: 0, spinT: 0, invulnT: 0 };
      });
      this.rivalReset();
    } else if (this.kind === 'conga') {
      this.bowCD = 0;
      this.tangleCD = 0;
      this.conga = new Conga(game, this, this.cfg.conga, spawn.index);
      this.conga.reset();
    } else {
      this.state = 'idle';
      this.throwT = 0.5 + Math.random();
    }
    // 客室のドアの中に隠れている人（物音で出てくる）
    if (spawn.door != null) {
      this.door = spawn.door;
      this.state = 'lurk';
      this.rearm = 0;
      this.char.root.visible = false;
      this.ring?.update(this.pos.x, this.pos.z, 0);
    }
    this.char.root.position.copy(this.pos);
  }

  get player() {
    return this.game.player;
  }

  nearestWaypoint() {
    let bi = 0;
    let bd = Infinity;
    // 動く歩道の上では、流れの上手にある地点は選ばない（戻れないので）
    const bv = this.game.belts?.vx(this.pos.x, this.pos.z) || 0;
    for (let i = 0; i < this.patrol.length; i++) {
      const p = this.patrol[i];
      if (bv * (p.x - this.pos.x) < 0) continue;
      const d = Math.hypot(p.x - this.pos.x, p.z - this.pos.z);
      if (d < bd) {
        bd = d;
        bi = i;
      }
    }
    return bi;
  }

  set(state) {
    this.state = state;
    this.t = 0;
  }

  say(text, style = '', dur = 1.6) {
    this.game.ui.bubble(this, text, style || this.cfg.bubble || this.kind, dur);
  }

  distToPlayer() {
    return Math.hypot(this.player.pos.x - this.pos.x, this.player.pos.z - this.pos.z);
  }

  sees(range, fov, yaw) {
    const p = this.player;
    const dx = p.pos.x - this.pos.x;
    const dz = p.pos.z - this.pos.z;
    const d = Math.hypot(dx, dz);
    if (d > range) return false;
    if (fov < Math.PI * 2) {
      const a = Math.atan2(dx, dz);
      if (Math.abs(wrapAngle(a - yaw)) > fov / 2 && d > 1.2) return false;
    }
    return this.game.world.grid.los(this.pos.x, this.pos.z, p.pos.x, p.pos.z);
  }

  /** 目標地点へ移動（見通せれば直進、だめなら距離マップを下る） */
  moveTo(tx, tz, speed, dt, field = null) {
    const grid = this.game.world.grid;
    let dx = tx - this.pos.x;
    let dz = tz - this.pos.z;
    const d = Math.hypot(dx, dz);
    let wantX = 0;
    let wantZ = 0;
    if (d > 0.05) {
      if (grid.clearPath(this.pos.x, this.pos.z, tx, tz, this.r * 0.9)) {
        wantX = dx / d;
        wantZ = dz / d;
      } else {
        const f = field || grid.field(Math.floor(tx), Math.floor(tz));
        const dir = grid.flowDir(f, this.pos.x, this.pos.z, _dir);
        if (dir) {
          wantX = dir.x;
          wantZ = dir.z;
        } else {
          wantX = dx / d;
          wantZ = dz / d;
        }
      }
    }
    const sp = Math.min(speed, d * 6);
    // 濡れた床ではブレーキが効かない（清掃員と行列は別）
    const lam = this.kind !== 'cleaner' && this.kind !== 'conga' && this.game.weather?.isWet(this.pos.x, this.pos.z) ? 3 : 10;
    this.vel.x = damp(this.vel.x, wantX * sp, lam, dt);
    this.vel.z = damp(this.vel.z, wantZ * sp, lam, dt);
    this.pos.x += this.vel.x * dt;
    this.pos.z += this.vel.z * dt;
    grid.resolveCircle(this.pos, this.r);
    return d;
  }

  stop(dt) {
    this.vel.x = damp(this.vel.x, 0, 12, dt);
    this.vel.z = damp(this.vel.z, 0, 12, dt);
    this.pos.x += this.vel.x * dt;
    this.pos.z += this.vel.z * dt;
    this.game.world.grid.resolveCircle(this.pos, this.r);
  }

  facePlayer() {
    this.char.faceDir(this.player.pos.x - this.pos.x, this.player.pos.z - this.pos.z);
  }

  /** つかまえられる状態か */
  get onPhone() {
    return this.game.player?.phoneT > 0 && PHONE_RESPECT.has(this.kind) && !this.cfg.ignorePhone;
  }

  giveupLine() {
    return this.onPhone ? pick(Math.random, ['…あ、電話中か', '電話中だった…', 'あとでいっか']) : pick(Math.random, this.cfg.giveup);
  }

  get canCatch() {
    if (this.cool > 0 || this.behaving || this.onPhone) return false;
    switch (this.kind) {
      case 'doki': return ['wander', 'notice', 'rush'].includes(this.state);
      case 'shacho': return false;
      case 'senpai':
      case 'warikomi': return ['idle', 'notice', 'chase', 'return'].includes(this.state);
      case 'keiri':
      case 'mtg': return ['patrol', 'stand', 'spotted', 'chase', 'resume', 'heard'].includes(this.state);
      case 'mimi': return ['listen', 'go', 'search', 'notice', 'chase', 'return'].includes(this.state);
      case 'kanji':
      case 'zandaka': return this.state === 'guard';
      case 'okuri': return this.state === 'walk'; // 足あとへ駆け寄る途中（join）は捕まえない
      case 'yappari': return ['patrol', 'idle', 'notice', 'chase', 'return'].includes(this.state);
      case 'rival': return this.state === 'walk' || this.state === 'idle';
      default: return false;
    }
  }

  get chasing() {
    return this.state === 'chase' || this.state === 'rush' || (this.kind === 'kanji' && this.state === 'guard' && this.distToPlayer() < 5);
  }

  alert() {
    if (this.cool > 0) return;
    if (TALKERS.has(this.kind) && (this.state === 'idle' || this.state === 'return')) this.notice();
    else if ((this.kind === 'keiri' || this.kind === 'mtg') && ['patrol', 'stand', 'resume'].includes(this.state)) this.spot();
    else if (this.kind === 'shorui' && this.state === 'idle') this.throwT = 0;
    else if (this.kind === 'doki' && this.state === 'wander') this.dokiNotice();
    else if (this.kind === 'yappari' && (this.state === 'patrol' || this.state === 'idle')) this.yappariNotice(null);
    else if (this.kind === 'okuri' && this.state === 'stand' && this.game.trail) {
      // 新人くんの「せんぱ〜い！」で、近くの足あとを嗅ぎつける
      const n = this.game.trail.nearestS(this.pos.x, this.pos.z, this.tune.back);
      if (n.d <= 6) this.okuriJoin(n.s);
    }
  }

  notice(mark = '！') {
    this.set('notice');
    this.say(pick(Math.random, this.cfg.notice), '', 1.5);
    this.game.ui.emote(this, mark);
    this.game.audio.notice(this.cfg.voice.freq);
    this.char.play('hop');
    this.char.setMood('surprised');
  }

  spot() {
    this.set('spotted');
    const keiri = this.kind === 'keiri';
    this.say(pick(Math.random, this.cfg.notice), keiri ? 'keiri shout' : 'mtg', 1.6);
    this.game.ui.emote(this, keiri ? '！！' : '！');
    this.char.play('jump');
    this.char.setMood(keiri ? 'shout' : 'surprised');
    if (keiri) {
      this.game.shake(0.35);
      this.game.ui.flash('rgba(224,64,47,0.28)');
      this.game.audio.alarm();
      this.game.fx.ring(this.pos.x, this.pos.z, '#ff4b3a', 3.5, 0.5);
    } else {
      this.game.audio.notice(this.cfg.voice.freq);
    }
  }

  /** エース新人に引き止められる */
  hold(seconds, withPos) {
    this.set('held');
    this.holdT = seconds;
    this.holdWith = withPos;
    this.vel.x = this.vel.z = 0;
    this.wantsCatch = false;
    this.char.spin = 0;
  }

  /** 濡れた床で転ぶ（台車にはね飛ばされたときも。lines・text で吹き出しと表示を差し替える） */
  slip(lines, text) {
    this.set('slipped');
    this.char.play('trip');
    this.char.setMood('dizzy');
    this.say(pick(Math.random, lines || ['うわっ！', 'ツルッ！？', 'あいたたた…']), '', 1.3);
    this.ring?.update(this.pos.x, this.pos.z, 0);
    if (this.cone) this.cone.visible = false;
    this.game.onEnemySlip?.(this, text);
  }

  /** 起き上がったあと、ふだんの動きに戻る */
  recover() {
    this.char.pose = 'idle';
    this.char.setMood('normal');
    this.cool = Math.max(this.cool, 2.5);
    if (TALKERS.has(this.kind)) this.set('return');
    else if (this.kind === 'keiri' || this.kind === 'mtg') this.set(this.patrol ? 'resume' : 'stand');
    else if (this.kind === 'doki' || this.kind === 'golf') this.set('wander');
    else if (this.kind === 'kanji' || this.kind === 'zandaka') this.set('guard');
    else if (this.kind === 'shinjin' || this.kind === 'mimi') this.set('return');
    else if (this.kind === 'okuri') this.scatter();
    else if (this.kind === 'yappari') this.set('return');
    else if (this.kind === 'rival') this.set(this.patrol ? 'walk' : 'idle');
    else this.set('idle');
  }

  /** 会話が終わったあと */
  afterTalk() {
    this.cool = this.tune.cooldown || 6;
    this.char.setMood('happy');
    if (this.cfg.after) this.say(pick(Math.random, this.cfg.after), '', 1.8);
    this.char.pose = this.kind === 'kanji' ? 'dance' : 'idle';
    if (this.kind === 'conga') this.set(this.cfg.conga.mode === 'route' ? 'walk' : 'rest');
    else if (this.kind === 'okuri') this.scatter();
    else if (TALKERS.has(this.kind) || this.kind === 'mimi') this.set('return');
    else if (this.kind === 'keiri' || this.kind === 'mtg') this.set(this.patrol ? 'resume' : 'stand');
    else if (this.kind === 'kanji') this.set('guard');
    else if (this.kind === 'doki' || this.kind === 'golf') this.set('wander');
    else if (this.kind === 'shacho') this.set(this.patrol ? 'patrol' : 'stand');
    else if (this.kind === 'yappari') this.set('return');
    else if (this.kind === 'rival') this.set(this.patrol ? 'walk' : 'idle');
    this.nearMissed = false;
  }

  /** 物音を聞いたとき（壁越しにも届く）。反応したら true */
  hear(x, z, r, src) {
    if (this.cool > 0 || this.behaving || this.state === 'lurk') return false;
    const d = Math.hypot(this.pos.x - x, this.pos.z - z);
    if (this.kind === 'mimi') return d <= r * this.tune.ear && this.investigate(x, z, src);
    if (src === 'voice' || d > r) return false;
    const s = this.state;
    if (TALKERS.has(this.kind) && (s === 'idle' || s === 'return')) {
      this.notice('？');
      if (this.cfg.heardLines) this.say(pick(Math.random, this.cfg.heardLines), '', 1.5);
    } else if (this.kind === 'doki' && s === 'wander') {
      this.dokiNotice('？');
    } else if (this.kind === 'shinjin' && s === 'idle') {
      this.shinjinNotice('？');
    } else if (this.kind === 'shorui' && s === 'idle') {
      this.throwT = 0; // 投げるには見通しが必要なまま
      this.game.ui.emote(this, '？');
    } else if ((this.kind === 'mtg' || this.kind === 'keiri') && ['patrol', 'stand', 'look', 'resume'].includes(s)) {
      this.set('heard');
      this.heardAt.x = x;
      this.heardAt.z = z;
      this.game.ui.emote(this, '？');
    } else {
      return false;
    }
    return true;
  }

  /** 地獄耳の総務：音のした場所まで確かめに行く */
  investigate(x, z, src) {
    const s = this.state;
    if (s !== 'listen' && s !== 'go' && s !== 'search' && s !== 'return') return false;
    this.goTo.x = x;
    this.goTo.z = z;
    if (s !== 'go') {
      this.say(pick(Math.random, src === 'voice' ? this.cfg.voiceLines : this.cfg.heardLines), 'mimi', 1.5);
      this.game.ui.emote(this, '？');
    }
    this.set('go');
    return true;
  }

  /** 部屋のドアから顔を出す（まだ捕まえない） */
  peek() {
    const P = this.player;
    this.set('peek');
    this.pos.set(this.home.x, 0, this.home.z);
    this.vel.x = this.vel.z = 0;
    this.char.root.position.copy(this.pos);
    this.char.root.visible = true;
    this.char.setYaw(Math.atan2(P.pos.x - this.pos.x, P.pos.z - this.pos.z));
    this.char.setMood('surprised');
    this.say(pick(Math.random, this.cfg.doorLines || this.cfg.notice), '', 1.4);
  }

  /** 部屋に戻ってドアを閉める */
  hide() {
    this.set('lurk');
    this.rearm = 6;
    this.vel.x = this.vel.z = 0;
    this.char.root.visible = false;
    this.ring?.update(this.pos.x, this.pos.z, 0);
    this.game.world.closeDoor(this.door);
  }

  /** ばらまき土産を受け取って、しばらく大人しくなる */
  calm(sec) {
    this.cool = Math.max(this.cool, sec);
    this.char.setMood('happy');
    const s = this.state;
    if (s === 'held' || s === 'slipped' || s === 'trip') return;
    if (TALKERS.has(this.kind) || this.kind === 'shinjin' || this.kind === 'mimi') {
      if (s !== 'idle' && s !== 'listen') this.set('return');
    } else if (this.kind === 'keiri' || this.kind === 'mtg') {
      if (s === 'spotted' || s === 'chase' || s === 'heard') {
        this.set(this.patrol ? 'resume' : 'stand');
        if (this.patrol) this.pi = this.nearestWaypoint();
      }
    } else if (this.kind === 'doki') {
      this.set('wander');
    }
  }

  update(dt) {
    const c = this.char;
    this.t += dt;
    this.cool = Math.max(0, this.cool - dt);
    this.greetT = Math.max(0, this.greetT - dt);
    this.slyT = Math.max(0, this.slyT - dt);
    // 部屋に隠れている間は何もしない（見えない・捕まえない・音も聞かない）
    if (this.state === 'lurk') {
      this.rearm = Math.max(0, this.rearm - dt);
      return;
    }
    // 行列に巻き込まれている間は、列が位置を決める
    if (this.state === 'inline') {
      this.inlineT -= dt;
      this.idle(dt);
      return;
    }
    if (this.cool <= 0 && c.mood === 'happy' && this.kind !== 'kanji') c.setMood('normal');
    const hidden = this.game.playerHidden || this.onPhone;
    const dist = this.distToPlayer();
    let pose = 'idle';
    // 電話中のふりが効かない人は、ひとこと言う（電話1回につき1回）
    if (this.cfg.phoneLine && this.state === 'chase' && this.player.phoneT > 0 && this.phoneSaid !== this.player.phoneLeft) {
      this.phoneSaid = this.player.phoneLeft;
      this.say(pick(Math.random, this.cfg.phoneLine), '', 1.6);
    }

    // 社長に見られている間は、みんな大人しくなる
    this.behaving = this.kind !== 'shacho' && this.game.shachoSees(this.pos.x, this.pos.z);
    if (this.behaving) {
      if (!this.wasBehaving) {
        this.game.ui.emote(this, '…');
        if (this.state === 'chase' || this.state === 'rush' || this.state === 'follow') {
          this.set(this.patrol ? 'resume' : this.kind === 'doki' ? 'wander' : this.kind === 'shinjin' ? 'return' : 'return');
          this.cool = Math.max(this.cool, 1.5);
        }
      }
      this.wasBehaving = true;
      this.stop(dt);
      this.ring?.update(this.pos.x, this.pos.z, 0);
      if (this.cone) this.cone.visible = false;
      c.pose = 'bow';
      this.idle(dt);
      return;
    }
    this.wasBehaving = false;

    // エース新人が相手をしている間はその場で話し込む
    if (this.state === 'held') {
      this.stop(dt);
      if (this.holdWith) c.faceDir(this.holdWith.x - this.pos.x, this.holdWith.z - this.pos.z);
      if (this.cone) this.cone.visible = false;
      this.ring?.update(this.pos.x, this.pos.z, 0);
      c.pose = 'talk';
      this.idle(dt);
      if (this.t > this.holdT) this.afterTalk();
      return;
    }

    // 濡れた床を走って転ぶ
    if ((this.state === 'chase' || this.state === 'rush') && Math.hypot(this.vel.x, this.vel.z) > SLIP_SPEED && this.game.weather?.isWet(this.pos.x, this.pos.z)) {
      this.slip();
    }
    if (this.state === 'slipped') {
      this.vel.x = damp(this.vel.x, 0, 2.5, dt);
      this.vel.z = damp(this.vel.z, 0, 2.5, dt);
      this.pos.x += this.vel.x * dt;
      this.pos.z += this.vel.z * dt;
      this.game.world.grid.resolveCircle(this.pos, this.r);
      c.root.position.set(this.pos.x, 0, this.pos.z);
      c.speed = 0;
      if (this.t > 0.3) c.pose = 'down';
      c.update(dt);
      if (this.t > 1.6) this.recover();
      return;
    }

    // カラオケ割引券に群がっている間は、ふだんの動きをしない
    const lp = this.lureStep(dt);
    if (lp) pose = lp;
    else switch (this.kind) {
      case 'golf':
        pose = this.updateGolf(dt, dist, hidden);
        break;
      case 'cleaner':
        pose = this.updateCleaner(dt, dist);
        break;
      case 'senpai':
      case 'warikomi':
        pose = this.updateSenpai(dt, dist, hidden);
        break;
      case 'keiri':
      case 'mtg':
        pose = this.updatePatroller(dt, dist, hidden);
        break;
      case 'shorui':
        pose = this.updateShorui(dt, dist, hidden);
        break;
      case 'shinjin':
        pose = this.updateShinjin(dt, dist, hidden);
        break;
      case 'kanji':
      case 'zandaka':
        pose = this.updateKanji(dt, dist, hidden);
        break;
      case 'handout':
        pose = this.updateHandout(dt, dist, hidden);
        break;
      case 'shacho':
        pose = this.updateShacho(dt, dist);
        break;
      case 'doki':
        pose = this.updateDoki(dt, dist, hidden);
        break;
      case 'mimi':
        pose = this.updateMimi(dt, dist, hidden);
        break;
      case 'conga':
        pose = this.updateConga(dt, dist, hidden);
        break;
      case 'okuri':
        pose = this.updateOkuri(dt, dist, hidden);
        break;
      case 'yappari':
        pose = this.updateYappari(dt, dist, hidden);
        break;
      case 'rival':
        pose = this.updateRival(dt, dist);
        break;
      default:
        break;
    }
    if (this.state !== 'chase') this.nearMissed = false;
    // 動く歩道に運ばれる
    const bv = this.game.belts?.vx(this.pos.x, this.pos.z);
    if (bv) {
      this.pos.x += bv * dt;
      this.game.world.grid.resolveCircle(this.pos, this.r);
    }

    if (c.pose !== 'down') c.pose = pose;
    c.root.position.set(this.pos.x, 0, this.pos.z);
    const spd = Math.hypot(this.vel.x, this.vel.z);
    c.speed = spd;
    if (spd > 0.25 && this.state !== 'notice' && this.state !== 'spotted' && this.state !== 'heard') c.faceDir(this.vel.x, this.vel.z);
    c.update(dt);
  }

  // --- ちょっといい先輩 -------------------------------------------------------
  updateSenpai(dt, dist, hidden) {
    const T = this.tune;
    const c = this.char;
    switch (this.state) {
      case 'idle': {
        this.stop(dt);
        c.headYaw = Math.sin(this.t * 0.8) * 0.5;
        c.targetYaw = this.homeYaw;
        // 割り込み係長は、印刷中の人なら遠くからでも気づく
        const range = this.kind === 'warikomi' && this.game.printing ? T.printNotice : T.notice;
        if (!hidden && this.cool <= 0 && this.slyT <= 0 && this.sees(range, Math.PI * 2, 0)) {
          // 淀川さんのステージでは、ダッシュで横をすり抜けると気づかれない（後から来る淀川さんがあいさつしてしまう）
          if (this.game.successor && this.player.dashing) this.slyT = 1.2;
          else this.notice();
        }
        this.ring?.update(this.pos.x, this.pos.z, this.cool > 0 ? 0 : clamp(1 - (dist - T.notice) / 4, 0, 1) * 0.55);
        return 'idle';
      }
      case 'notice':
        this.stop(dt);
        this.facePlayer();
        this.ring?.update(this.pos.x, this.pos.z, 0.6);
        if (this.t > 0.35) {
          this.set('chase');
          c.setMood('happy');
        }
        return 'shock';
      case 'chase': {
        this.ring?.update(this.pos.x, this.pos.z, 0);
        this.moveTo(this.player.pos.x, this.player.pos.z, T.chase, dt, this.game.playerField);
        c.headYaw = 0;
        if (hidden || this.t > T.chaseMax || dist > T.lose) {
          this.say(this.giveupLine(), '', 1.6);
          c.setMood('normal');
          this.cool = 2.5;
          this.set('return');
        }
        return 'reach';
      }
      case 'return': {
        this.ring?.update(this.pos.x, this.pos.z, 0);
        const d = this.moveTo(this.home.x, this.home.z, 1.7, dt);
        if (d < 0.15) {
          if (this.door != null) this.hide();
          else this.set('idle');
        }
        return 'idle';
      }
      case 'peek':
        // ドアから顔を出したところ。隠れていればあきらめて部屋に戻る
        this.stop(dt);
        this.facePlayer();
        if (this.t > 0.45) {
          if (hidden) this.set('return');
          else this.notice();
        }
        return 'look';
      default:
        return 'idle';
    }
  }

  // --- 経理の鬼 / MTG課長（巡回＋視界コーン） ----------------------------------
  updatePatroller(dt, dist, hidden) {
    const T = this.tune;
    const c = this.char;
    const keiri = this.kind === 'keiri';
    let pose = 'idle';
    let coneOn = true;
    let intensity = this.cool > 0 ? 0.35 : 1;
    switch (this.state) {
      case 'stand':
        this.stop(dt);
        c.headYaw = Math.sin(this.t * 0.9) * 0.7;
        c.targetYaw = this.homeYaw;
        break;
      case 'patrol': {
        const wp = this.patrol[this.pi];
        const d = this.moveTo(wp.x, wp.z, T.patrol, dt);
        c.headYaw = Math.sin(this.t * 1.3) * 0.55;
        if (d < 0.2) {
          if (this.patrol.length === 2) {
            this.pi = this.pi === 0 ? 1 : 0;
          } else {
            this.pi = (this.pi + 1) % this.patrol.length;
          }
          this.set('look');
        }
        break;
      }
      case 'look':
        this.stop(dt);
        c.headYaw = Math.sin(this.t * 3) * 0.9;
        if (this.t > 0.8) this.set('patrol');
        break;
      case 'spotted':
        this.stop(dt);
        this.facePlayer();
        c.headYaw = 0;
        intensity = 1.5;
        pose = 'shock';
        if (this.t > (keiri ? 0.4 : 0.45)) {
          this.set('chase');
          this.lostT = 0;
        }
        break;
      case 'chase': {
        coneOn = false;
        c.headYaw = 0;
        this.moveTo(this.player.pos.x, this.player.pos.z, T.chase, dt, this.game.playerField);
        const seen = !hidden && this.game.world.grid.los(this.pos.x, this.pos.z, this.player.pos.x, this.player.pos.z);
        this.lostT = seen ? 0 : this.lostT + dt;
        if (keiri) {
          c.setMood('shout');
          if (!hidden && dist < T.aura) {
            this.player.aura = Math.min(this.player.aura, T.auraSlow);
            this.game.auraLevel = Math.max(this.game.auraLevel, 1 - dist / T.aura);
          }
          this.lineT -= dt;
          if (this.lineT < 0) {
            this.lineT = 1.6 + Math.random();
            this.say(pick(Math.random, ['待ちなさい！！', '領収書！！', '今日締めです！！', 'ちょっと！！']), 'keiri shout', 1.1);
          }
        }
        if (hidden || this.t > T.chaseMax || dist > T.lose || this.lostT > T.losLost) {
          this.say(this.giveupLine(), '', 1.8);
          c.setMood(keiri ? 'angry' : 'normal');
          this.cool = 2.5;
          this.set(this.patrol ? 'resume' : 'stand');
          if (this.patrol) this.pi = this.nearestWaypoint();
        }
        pose = 'reach';
        break;
      }
      case 'resume': {
        const wp = this.patrol ? this.patrol[this.pi] : this.home;
        const d = this.moveTo(wp.x, wp.z, T.patrol * 1.1, dt);
        c.headYaw = 0;
        if (d < 0.25) this.set(this.patrol ? 'patrol' : 'stand');
        break;
      }
      case 'heard':
        // 物音のした方を振り向く（視界も一緒に回る）
        this.stop(dt);
        c.targetYaw = Math.atan2(this.heardAt.x - this.pos.x, this.heardAt.z - this.pos.z);
        c.headYaw = 0;
        intensity = 1.2;
        if (this.t > 1.0) this.set(this.patrol ? 'resume' : 'stand');
        break;
      default:
        break;
    }
    if (!hidden && this.cool <= 0 && ['patrol', 'stand', 'look', 'resume', 'heard'].includes(this.state)) {
      const yaw = this.char.yaw + c.head.rotation.y;
      if (this.sees(T.range, T.fov, yaw) || dist < 1.0) this.spot();
    }
    if (this.cone) {
      this.cone.visible = coneOn;
      if (coneOn) this.cone.update(this.game.world.grid, this.pos.x, this.pos.z, this.char.yaw + c.head.rotation.y, T.fov, T.range, intensity);
    }
    return pose;
  }

  // --- 書類おじさん ---------------------------------------------------------
  updateShorui(dt, dist, hidden) {
    const T = this.tune;
    const c = this.char;
    this.stop(dt);
    if (this.state === 'idle') {
      c.targetYaw = this.homeYaw;
      c.headYaw = Math.sin(this.t * 0.7) * 0.4;
      this.throwT -= dt;
      if (!hidden && this.cool <= 0 && this.throwT <= 0 && dist < T.range && this.sees(T.range, Math.PI * 2, 0)) {
        this.set('aim');
        this.say(pick(Math.random, this.cfg.throwLines), '', 1.3);
        c.setMood('happy');
      }
      return 'idle';
    }
    if (this.state === 'aim') {
      this.facePlayer();
      c.headYaw = 0;
      if (this.t > 0.42) {
        this.throwAt();
        this.set('idle');
        this.throwT = T.interval + Math.random() * 0.6;
        c.setMood('normal');
      }
      return 'idle';
    }
    return 'idle';
  }

  throwAt() {
    const p = this.player;
    const dist = this.distToPlayer();
    const T = 0.55 + dist * 0.06;
    const lead = 0.85;
    let tx = p.pos.x + p.vel.x * T * lead + (Math.random() - 0.5) * 0.5;
    let tz = p.pos.z + p.vel.y * T * lead + (Math.random() - 0.5) * 0.5;
    const grid = this.game.world.grid;
    tx = clamp(tx, 1, grid.w - 1);
    tz = clamp(tz, 1, grid.h - 1);
    this.char.play('throw');
    const from = new THREE.Vector3(this.pos.x, 1.2, this.pos.z);
    this.game.audio.whoosh();
    setTimeout(() => {
      if (!this.game.world) return;
      this.game.fx.throwPaper(from, new THREE.Vector3(tx, 0.05, tz), T, (to) => this.game.paperLanded(to, this));
    }, 160);
  }

  // --- 新人くん -------------------------------------------------------------
  shinjinNotice(mark = '！') {
    this.set('notice');
    this.say(pick(Math.random, this.cfg.notice), 'shinjin', 1.4);
    this.game.ui.emote(this, mark);
    this.game.audio.notice(this.cfg.voice.freq);
    this.char.play('jump');
    this.char.setMood('happy');
  }

  updateShinjin(dt, dist, hidden) {
    const T = this.tune;
    const c = this.char;
    const p = this.player;
    switch (this.state) {
      case 'idle':
        this.stop(dt);
        c.targetYaw = this.homeYaw;
        this.ring?.update(this.pos.x, this.pos.z, this.cool > 0 ? 0 : clamp(1 - (dist - T.notice) / 4, 0, 1) * 0.5);
        if (!hidden && this.cool <= 0 && this.sees(T.notice, Math.PI * 2, 0)) this.shinjinNotice();
        return 'idle';
      case 'notice':
        this.stop(dt);
        this.facePlayer();
        this.ring?.update(this.pos.x, this.pos.z, 0);
        if (this.t > 0.35) {
          this.set('follow');
          this.shoutT = 0.9;
        }
        return 'cheer';
      case 'follow': {
        const dx = p.pos.x - this.pos.x;
        const dz = p.pos.z - this.pos.z;
        const d = Math.hypot(dx, dz) || 1;
        const tx = p.pos.x - (dx / d) * 1.3;
        const tz = p.pos.z - (dz / d) * 1.3;
        const speed = d > 2.2 ? 6.2 : d > 1.5 ? 4.8 : 2;
        this.moveTo(tx, tz, speed, dt, d > 3 ? this.game.playerField : null);
        this.shoutT -= dt;
        if (this.shoutT <= 0 && !hidden) {
          this.shoutT = T.shoutEvery;
          this.say(pick(Math.random, this.cfg.shouts), 'shinjin shout', 1.3);
          this.game.fx.ring(this.pos.x, this.pos.z, '#3aa56c', T.shoutR, 0.9);
          this.game.audio.shout();
          this.game.alertAround(this.pos.x, this.pos.z, T.shoutR, this);
        }
        if (p.dashing && d < 4.5) {
          this.set('trip');
          this.tripDir = { x: dx / d, z: dz / d };
          return 'reach';
        }
        if (this.t > T.follow || hidden || d > 12) {
          this.say(this.giveupLine(), 'shinjin', 1.5);
          this.cool = T.cooldown;
          this.set('return');
        }
        return 'reach';
      }
      case 'trip': {
        if (this.t < 0.22) {
          this.vel.x = this.tripDir.x * 7;
          this.vel.z = this.tripDir.z * 7;
          this.pos.x += this.vel.x * dt;
          this.pos.z += this.vel.z * dt;
          this.game.world.grid.resolveCircle(this.pos, this.r);
          return 'reach';
        }
        if (!this.tripped) {
          this.tripped = true;
          c.play('trip');
          c.setMood('dizzy');
          c.stars.visible = true;
          this.say(pick(Math.random, this.cfg.trip), 'shinjin', 1.4);
          this.game.fx.dust(this.pos.x, this.pos.z, 10);
          this.game.fx.papers(this.pos.x, 0.5, this.pos.z, 4, 0.6);
          this.game.audio.trip();
          this.game.onShinjinTrip(this);
        }
        this.stop(dt);
        if (this.t > 3) {
          this.tripped = false;
          c.pose = 'idle';
          c.stars.visible = false;
          c.setMood('normal');
          this.cool = T.cooldown;
          this.set('return');
        }
        return 'down';
      }
      case 'return': {
        const d = this.moveTo(this.home.x, this.home.z, 2.2, dt);
        if (d < 0.15) this.set('idle');
        return 'idle';
      }
      default:
        return 'idle';
    }
  }

  // --- 飲み会幹事 -----------------------------------------------------------
  updateKanji(dt, dist, hidden) {
    const T = this.tune;
    const c = this.char;
    const p = this.player;
    const g = this.guard;
    let active = !hidden && this.cool <= 0 && dist < T.sense;
    let tz = this.home.z;
    let tx = this.home.x;
    if (this.kind === 'zandaka') {
      // 気まぐれにレーンを移る
      this.laneT = (this.laneT ?? Math.random()) - dt;
      if (this.laneT <= 0 || this.lane == null) {
        this.laneT = 1.3 + Math.random() * 2.2;
        this.lane = g.min + Math.floor(Math.random() * (g.max - g.min + 1)) + 0.5;
      }
      if (g.axis === 'x') tx = this.lane;
      else tz = this.lane;
      active = this.cool <= 0;
    } else if (active && g.axis === 'x') {
      tx = clamp(p.pos.x + p.vel.x * 0.2, g.min + 0.5, g.max + 0.5);
      tz = this.home.z + clamp((p.pos.z - this.home.z) * 0.15, -0.6, 0.6);
    } else if (active) {
      tz = clamp(p.pos.z + p.vel.y * 0.2, g.min + 0.5, g.max + 0.5);
      tx = this.home.x + clamp((p.pos.x - this.home.x) * 0.15, -0.6, 0.6);
    }
    const dz = tz - this.pos.z;
    const dx = tx - this.pos.x;
    const want = Math.hypot(dx, dz);
    const sp = active ? T.speed : 1.2;
    const k = Math.min(1, want / 0.4);
    this.vel.x = damp(this.vel.x, (dx / (want || 1)) * sp * k, 9, dt);
    this.vel.z = damp(this.vel.z, (dz / (want || 1)) * sp * k, 9, dt);
    this.pos.x += this.vel.x * dt;
    this.pos.z += this.vel.z * dt;
    this.game.world.grid.resolveCircle(this.pos, this.r);
    this.facePlayer();
    if (active) {
      this.lineT -= dt;
      if (this.lineT < 0) {
        this.lineT = 2.2 + Math.random() * 1.2;
        this.say(pick(Math.random, this.cfg.guardLines), 'kanji', 1.4);
      }
    }
    c.setMood('happy');
    return active && dist < 4.5 ? 'block' : 'dance';
  }

  // --- 抜き打ち巡回の社長 -----------------------------------------------------
  updateShacho(dt, dist) {
    const T = this.tune;
    const c = this.char;
    const P = this.player;
    this.passT = Math.max(0, this.passT - dt);
    let intensity = this.cool > 0 ? 0.35 : 1;
    if (this.state === 'patrol' || this.state === 'look') {
      if (this.state === 'patrol') {
        const wp = this.patrol[this.pi];
        const d = this.moveTo(wp.x, wp.z, T.patrol, dt);
        c.headYaw = Math.sin(this.t * 0.9) * 0.45;
        if (d < 0.2) {
          this.pi = (this.pi + 1) % this.patrol.length;
          this.set('look');
        }
      } else {
        this.stop(dt);
        c.headYaw = Math.sin(this.t * 2.2) * 0.8;
        if (this.t > 1.2) this.set('patrol');
      }
    } else if (this.state === 'stand') {
      this.stop(dt);
      c.headYaw = Math.sin(this.t * 0.9) * 0.7;
    } else if (this.state === 'spotted') {
      this.stop(dt);
      this.facePlayer();
      c.headYaw = 0;
      intensity = 1.6;
      if (this.t > 0.5) {
        this.wantsCatch = true;
        this.set(this.patrol ? 'patrol' : 'stand');
      }
      if (this.cone) this.cone.update(this.game.world.grid, this.pos.x, this.pos.z, this.char.yaw, T.fov, T.range, intensity, this.cone.color);
      return 'idle';
    }
    const yaw = this.char.yaw + c.head.rotation.y;
    this.viewYaw = yaw;
    const sees = !this.game.playerHidden && this.cool <= 0 && this.sees(T.range, T.fov, yaw);
    this.seesPlayer = sees;
    if (sees) {
      const moving = Math.hypot(P.vel.x, P.vel.y) > T.still || P.dashing;
      if (moving) {
        this.set('spotted');
        this.say(pick(Math.random, this.cfg.notice), 'shacho', 1.4);
        this.game.ui.emote(this, '！');
        this.game.audio.notice(this.cfg.voice.freq);
        this.char.play('hop');
      } else if (this.passT <= 0) {
        this.passT = 4;
        this.say(pick(Math.random, this.cfg.pass), 'shacho', 1.5);
        this.game.onShachoPass(this);
      }
    }
    if (this.cone) {
      this.cone.visible = true;
      this.cone.update(this.game.world.grid, this.pos.x, this.pos.z, yaw, T.fov, T.range, intensity);
    }
    return 'idle';
  }

  /** 社長の視界に (x, z) が入っているか */
  viewContains(x, z) {
    if (this.kind !== 'shacho' || this.cool > 0 || this.state === 'spotted') return false;
    const T = this.tune;
    const dx = x - this.pos.x;
    const dz = z - this.pos.z;
    const d = Math.hypot(dx, dz);
    if (d > T.range || d < 0.01) return false;
    if (Math.abs(wrapAngle(Math.atan2(dx, dz) - (this.viewYaw ?? this.char.yaw))) > T.fov / 2) return false;
    return this.game.world.grid.los(this.pos.x, this.pos.z, x, z);
  }

  // --- 充電器の同期 -----------------------------------------------------------
  dokiNotice(mark = '！') {
    this.set('notice');
    this.say(pick(Math.random, this.cfg.notice), 'doki', 1.5);
    this.game.ui.emote(this, mark);
    this.game.audio.notice(this.cfg.voice.freq);
    this.char.play('hop');
    this.char.setMood('surprised');
  }

  updateDoki(dt, dist, hidden) {
    const T = this.tune;
    const c = this.char;
    const grid = this.game.world.grid;
    switch (this.state) {
      case 'wander': {
        if (!this.wanderTo || this.t > 5) {
          for (let i = 0; i < 12; i++) {
            const tx = Math.floor(this.home.x + (Math.random() - 0.5) * 12);
            const tz = Math.floor(this.home.z + (Math.random() - 0.5) * 8);
            if (grid.isWalk(tx, tz)) {
              this.wanderTo = { x: tx + 0.5, z: tz + 0.5 };
              break;
            }
          }
          this.t = 0;
        }
        if (this.wanderTo && this.moveTo(this.wanderTo.x, this.wanderTo.z, T.wander, dt) < 0.3) this.wanderTo = null;
        c.headYaw = 0;
        c.head.rotation.x = 0.35;
        if (!hidden && this.cool <= 0 && this.sees(T.notice, T.fov, this.char.yaw)) this.dokiNotice();
        return 'idle';
      }
      case 'notice':
        this.stop(dt);
        this.facePlayer();
        if (this.t > 0.3) this.set('rush');
        return 'shock';
      case 'rush':
        this.moveTo(this.player.pos.x, this.player.pos.z, T.rush, dt, this.game.playerField);
        if (hidden || this.t > T.rushMax || dist > T.lose) {
          this.say(this.giveupLine(), 'doki', 1.5);
          this.cool = 3;
          c.setMood('worried');
          this.set('tired');
        }
        return 'reach';
      case 'tired':
        this.stop(dt);
        if (this.t > 1.4) {
          c.setMood('normal');
          this.set('wander');
        }
        return 'idle';
      default:
        return 'idle';
    }
  }

  // --- 地獄耳の総務 -----------------------------------------------------------
  mimiSpot() {
    this.set('notice');
    this.say(pick(Math.random, this.cfg.notice), 'mimi', 1.5);
    this.game.ui.emote(this, '！');
    this.game.audio.notice(this.cfg.voice.freq);
    this.char.play('hop');
    this.char.setMood('surprised');
  }

  updateMimi(dt, dist, hidden) {
    const T = this.tune;
    const c = this.char;
    this.ring.update(this.pos.x, this.pos.z, dist < 9 && this.cool <= 0 && (this.state === 'listen' || this.state === 'search') ? 0.3 : 0);
    switch (this.state) {
      case 'listen':
        // スマホに目を落としたまま（目では気づかない）
        this.stop(dt);
        c.targetYaw = this.homeYaw;
        c.headYaw = 0;
        return 'scroll';
      case 'go': {
        const d = this.moveTo(this.goTo.x, this.goTo.z, T.walk, dt);
        c.headYaw = Math.sin(this.t * 4) * 0.3;
        if (!hidden && this.sees(T.spot, Math.PI * 2, 0)) this.mimiSpot();
        else if (d < 0.35 || this.t > 4) this.set('search');
        return 'idle';
      }
      case 'search':
        this.stop(dt);
        c.headYaw = Math.sin(this.t * 3) * 1.0;
        if (!hidden && this.sees(T.spot, Math.PI * 2, 0)) this.mimiSpot();
        else if (this.t > T.search) {
          this.say(pick(Math.random, this.cfg.lostLines), 'mimi', 1.4);
          this.set('return');
        }
        return 'look';
      case 'notice':
        // 驚きながらも、そのまま詰め寄ってくる（すれ違いざまにつかまる）
        this.moveTo(this.player.pos.x, this.player.pos.z, T.chase, dt);
        this.facePlayer();
        if (this.t > 0.3) {
          this.set('chase');
          c.setMood('happy');
        }
        return 'shock';
      case 'chase':
        this.moveTo(this.player.pos.x, this.player.pos.z, T.chase, dt, this.game.playerField);
        c.headYaw = 0;
        if (hidden || this.t > T.chaseMax || dist > T.lose) {
          this.say(this.giveupLine(), 'mimi', 1.6);
          c.setMood('normal');
          this.cool = 2.5;
          this.set('return');
        }
        return 'reach';
      case 'return': {
        const d = this.moveTo(this.home.x, this.home.z, 2.0, dt);
        c.headYaw = 0;
        if (d < 0.15) this.set('listen');
        return 'idle';
      }
      default:
        return 'idle';
    }
  }

  // --- カラオケ割引券 ---------------------------------------------------------
  /** 宴会好き（cfg.party）は券に群がる。群がっている間のポーズを返す（関係なければ null） */
  lureStep(dt) {
    const L = this.game.lure;
    const s = this.state;
    if (!this.cfg.party || s === 'held' || s === 'inline' || s === 'haul') return null;
    if (s === 'lured') {
      if (!L) {
        this.set(this.kind === 'conga' ? 'hunt' : 'guard');
        return null;
      }
      // 券のまわり 0.8m の、人ごとに決まった角度の位置へ
      const a = this.home.x * 1.7 + this.home.z * 2.9;
      const d = this.moveTo(L.x + Math.sin(a) * 0.8, L.z + Math.cos(a) * 0.8, 3.4, dt);
      this.char.setMood('happy');
      if (d > 0.3) return 'reach';
      this.char.faceDir(L.x - this.pos.x, L.z - this.pos.z);
      return 'dance';
    }
    if (!L || Math.hypot(this.pos.x - L.x, this.pos.z - L.z) > TUNING.conga.lureR) return null;
    this.set('lured');
    this.char.spin = 0;
    this.ring?.update(this.pos.x, this.pos.z, 0);
    this.say(pick(Math.random, this.cfg.lureLines || ['カラオケ！？']), '', 1.4);
    this.game.ui.emote(this, '♪');
    return 'reach';
  }

  // --- 行列（ご挨拶ご一行・大掃除隊・二次会電車） --------------------------------
  /** 捕まえられる状態か（汎用の canCatch は使わない） */
  get congaCatching() {
    if (this.cool > 0) return false;
    const s = this.state;
    return this.cfg.conga.mode === 'route' ? s === 'walk' || s === 'bow' || s === 'yield' : s === 'hunt' || s === 'tangle';
  }

  /** 進む先 0.9m に、ほかの列の体があるか */
  blockedBy(r = 0.7) {
    const wp = this.patrol[this.pi];
    const dx = wp.x - this.pos.x;
    const dz = wp.z - this.pos.z;
    const d = Math.hypot(dx, dz) || 1;
    const x = this.pos.x + (dx / d) * 0.9;
    const z = this.pos.z + (dz / d) * 0.9;
    for (const L of this.game.congas) if (L !== this.conga && L.nearest(x, z) < r) return true;
    return false;
  }

  startBow(other) {
    this.set('bow');
    this.bowWith = other;
    this.char.setMood('happy');
  }

  /** 列のおしゃべり（先頭の notice か、メンバーの memberLines） */
  chatter(dt, dist) {
    this.lineT -= dt;
    if (dist > 9 || this.lineT > 0) return;
    this.lineT = 3.5 + Math.random() * 1.5;
    if (Math.random() < 0.5 || !this.cfg.memberLines) this.say(pick(Math.random, this.cfg.notice), '', 1.5);
    else this.conga.memberSay(pick(Math.random, this.cfg.memberLines));
  }

  updateConga(dt, dist, hidden) {
    const T = this.tune;
    const K = this.cfg.conga;
    const c = this.char;
    const P = this.player;
    this.bowCD = Math.max(0, this.bowCD - dt);
    this.tangleCD = Math.max(0, this.tangleCD - dt);
    this.graceT = Math.max(0, (this.graceT || 0) - dt);
    c.headYaw = 0;
    if (this.state !== 'tangle') c.spin = 0;
    switch (this.state) {
      case 'walk': {
        const wp = this.patrol[this.pi];
        if (this.moveTo(wp.x, wp.z, K.speed, dt) < 0.2) this.pi = (this.pi + 1) % this.patrol.length;
        this.chatter(dt, dist);
        // ご一行どうしが出会うとお辞儀合戦
        if (K.bow && this.bowCD <= 0) {
          for (const L of this.game.congas) {
            const o = L.leader;
            if (o === this || !L.cfg.bow || o.bowCD > 0 || (o.state !== 'walk' && o.state !== 'yield')) continue;
            if (Math.hypot(o.pos.x - this.pos.x, o.pos.z - this.pos.z) > T.bowR) continue;
            this.startBow(o);
            o.startBow(this);
            this.game.ui.float((this.pos.x + o.pos.x) / 2, 3.9, (this.pos.z + o.pos.z) / 2, 'お辞儀合戦！', 'info');
            return 'bow';
          }
        }
        if (this.graceT <= 0 && this.blockedBy()) this.set('yield');
        return 'idle';
      }
      case 'yield':
        // ほかの列が通り過ぎるのを待つ（待ちきれなければ、しばらく譲らずに進む）
        this.stop(dt);
        if ((this.t > 0.3 && !this.blockedBy()) || this.t > T.yieldMax) {
          if (this.t > T.yieldMax) this.graceT = 2;
          this.set('walk');
        }
        return 'idle';
      case 'bow': {
        const o = this.bowWith;
        this.stop(dt);
        c.faceDir(o.pos.x - this.pos.x, o.pos.z - this.pos.z);
        const k = Math.floor(this.t / 0.85);
        if (k !== this.bowK) {
          this.bowK = k;
          if ((k % 2 === 0) === (this.conga.index < o.conga.index)) this.say(this.cfg.meetLines[k % this.cfg.meetLines.length], '', 0.9);
        }
        if (this.t > T.bowT) {
          this.bowCD = T.bowCD;
          this.bowK = -1;
          this.set(this.conga.index < o.conga.index ? 'walk' : 'yield');
        }
        return Math.floor(this.t * 2.2) % 2 ? 'bow' : 'idle';
      }
      case 'start':
        this.stop(dt);
        if (this.t > 0.5) {
          this.say(this.cfg.notice[0], '', 1.6);
          this.game.ui.emote(this, '！');
          this.game.audio.notice(this.cfg.voice.freq);
          c.setMood('happy');
          this.set('hunt');
        }
        return 'cheer';
      case 'hunt':
        this.moveTo(P.pos.x, P.pos.z, Math.max(K.minSpeed, K.speed - K.slowPerMember * this.conga.members.length), dt, this.game.playerField);
        this.chatter(dt, dist);
        if (hidden) {
          this.say(pick(Math.random, this.cfg.millLines), '', 1.5);
          this.set('mill');
        } else if (K.tangle && this.tangleCD <= 0 && this.conga.selfHit(T.tangleR)) {
          this.say(pick(Math.random, this.cfg.tangleLines), '', 1.5);
          this.game.ui.emote(this, '？');
          this.set('tangle');
        }
        return 'reach';
      case 'mill':
        // 見失って、その場で見回す
        this.stop(dt);
        c.headYaw = Math.sin(this.t * 3) * 0.9;
        if (!hidden && this.t > 1) this.set('hunt');
        return 'look';
      case 'haul': {
        // 最後尾に組み込んだまま、カラオケ個室へ
        const [hx, hz] = this.game.stage.congaDest;
        this.haulField ??= this.game.world.grid.field(hx, hz);
        const d = this.moveTo(hx + 0.5, hz + 0.5, K.haulSpeed, dt, this.haulField);
        if (d < 0.8) this.game.congaArrive(this);
        return 'cheer';
      }
      case 'tangle':
        this.stop(dt);
        c.spin += dt * 9;
        if (this.t > T.tangleT) {
          c.spin = 0;
          this.tangleCD = T.tangleCD;
          this.set('hunt');
        }
        return 'shock';
      case 'rest':
        this.stop(dt);
        if (this.t > K.rest && this.cool <= 0) this.set('hunt');
        return 'idle';
      default:
        return 'idle';
    }
  }

  // --- お見送り隊（足あとを嗅ぎつけて追う） -----------------------------------
  /** 足あとの s の点へ向かい、着いたらたどりはじめる（主人公の 1m 後ろより前には割り込まない） */
  okuriJoin(s) {
    const tr = this.game.trail;
    if (this.state !== 'lost') s = Math.min(s, tr.headS - 1);
    tr.sample(s, this.cur, _tp);
    this.joinS = s;
    this.joinX = _tp.x;
    this.joinZ = _tp.z;
    if (this.state === 'lost') {
      this.set('join');
      this.say('こっちだ〜！', '', 1.3);
      return;
    }
    this.set('join');
    this.say(pick(Math.random, this.cfg.notice), '', 1.4);
    this.game.ui.emote(this, '♪');
    this.game.audio.notice(this.cfg.voice.freq);
    this.char.setMood('happy');
  }

  /** 持ち場へ戻る（会話・傘・見失ったとき） */
  scatter() {
    this.set('scatter');
    this.cool = this.tune.cooldown;
    this.char.setMood('normal');
  }

  updateOkuri(dt, dist, hidden) {
    const T = this.tune;
    const c = this.char;
    const P = this.player;
    const tr = this.game.trail;
    c.headYaw = 0;
    switch (this.state) {
      case 'stand':
        // 拍手で待ちかまえる。歩いて近くを通ると気づく（ダッシュ中・電話中・傘の間は気づかない）
        this.stop(dt);
        if (dist < 6) this.facePlayer();
        else c.targetYaw = this.homeYaw;
        this.ring.update(this.pos.x, this.pos.z, this.cool > 0 ? 0 : clamp(1 - (dist - T.join) / 4, 0, 1) * 0.5);
        if (!this.game.playerHidden && this.cool <= 0 && !P.dashing && P.phoneT <= 0 && this.sees(T.join, Math.PI * 2, 0)) {
          this.okuriJoin(tr.nearestS(this.pos.x, this.pos.z, T.back).s);
        }
        return 'cheer';
      case 'join': {
        this.ring.update(this.pos.x, this.pos.z, 0);
        if (this.moveTo(this.joinX, this.joinZ, T.run, dt) < 0.5) {
          this.s = this.joinS;
          this.set('walk');
        } else if (this.t > T.joinMax) {
          this.scatter();
        }
        return 'reach';
      }
      case 'walk': {
        // 途切れ目（ダッシュの区間）で見失う・引き離されたらあきらめる
        const ge = tr.gapAhead(this.s, this.s + 0.4);
        if (ge >= 0 && ge - tr.gapFrom >= T.gap) {
          this.gapEnd = ge;
          this.vel.x = this.vel.z = 0;
          this.set('lost');
          this.game.ui.emote(this, '？');
          return 'look';
        }
        if (tr.headS - this.s > T.lose) {
          this.say(pick(Math.random, this.cfg.giveup), '', 1.5);
          this.scatter();
          return 'idle';
        }
        // 前の追っ手に詰めすぎない。主人公の 0.3m 手前まで
        let cap = tr.headS - 0.3;
        for (const o of this.game.enemies) {
          if (o === this || o.kind !== 'okuri' || o.state !== 'walk') continue;
          if (o.s > this.s || (o.s === this.s && o.id < this.id)) cap = Math.min(cap, o.s - T.space);
        }
        let ds = clamp(cap - this.s, 0, Math.min(T.max, T.base + T.per * this.game.okuriN) * dt);
        if (P.phoneT > 0 || (ds > 0 && tr.blockedAt(this.s + 0.4))) ds = 0; // 電話中・段ボールの前では止まる
        this.s += ds;
        tr.sample(this.s, this.cur, _tp);
        this.vel.x = dt > 0 ? (_tp.x - this.pos.x) / dt : 0;
        this.vel.z = dt > 0 ? (_tp.z - this.pos.z) / dt : 0;
        this.pos.x = _tp.x;
        this.pos.z = _tp.z;
        return ds > 0 ? 'reach' : 'cheer';
      }
      case 'lost':
        // 見回して、近くに主役が見えれば途切れ目の先から追い直す
        this.stop(dt);
        c.headYaw = Math.sin(this.t * 3) * 0.9;
        if (!hidden && dist < T.reacquire && this.game.world.grid.los(this.pos.x, this.pos.z, P.pos.x, P.pos.z)) this.okuriJoin(this.gapEnd);
        else if (this.t > T.lostT) {
          this.say(this.cfg.giveup[0], '', 1.5);
          this.scatter();
        }
        return 'look';
      case 'scatter': {
        this.ring.update(this.pos.x, this.pos.z, 0);
        if (this.moveTo(this.home.x, this.home.z, 2.2, dt) < 0.15) {
          this.set('stand');
          this.cool = T.cooldown;
        }
        return 'idle';
      }
      default:
        return 'idle';
    }
  }

  // --- ちゃぶ台返し局長（列の最後尾をねらう） -----------------------------------
  /** 目標（仲間 m か、null なら主人公）に気づく */
  yappariNotice(m) {
    this.target = m;
    this.set('notice');
    this.say(pick(Math.random, this.cfg.notice), 'keiri shout', 1.5);
    this.game.ui.emote(this, '！');
    this.game.audio.notice(this.cfg.voice.freq);
    this.char.play('hop');
    this.char.setMood('surprised');
    if (m) {
      m.freezeT = this.tune.freeze;
      this.game.team.say(m, '…はい？', 1.2);
    }
  }

  updateYappari(dt, dist, hidden) {
    const T = this.tune;
    const c = this.char;
    const team = this.game.team;
    const grid = this.game.world.grid;
    const tail = team?.tail();
    const td = tail ? Math.hypot(tail.pos.x - this.pos.x, tail.pos.z - this.pos.z) : Infinity;
    c.headYaw = 0;
    switch (this.state) {
      case 'patrol':
      case 'idle': {
        if (this.state === 'patrol') {
          const wp = this.patrol[this.pi];
          if (this.moveTo(wp.x, wp.z, T.patrol, dt) < 0.2) {
            this.pi = this.patrol.length === 2 ? 1 - this.pi : (this.pi + 1) % this.patrol.length;
          }
          c.headYaw = Math.sin(this.t * 1.1) * 0.5;
        } else {
          this.stop(dt);
          c.targetYaw = this.homeYaw;
        }
        // 主人公より先に、列の最後尾を見つける（傘は主人公だけを隠す）
        const near = Math.min(td, hidden ? Infinity : dist);
        this.ring.update(this.pos.x, this.pos.z, this.cool > 0 ? 0 : clamp(1 - (near - T.notice) / 4, 0, 1) * 0.55);
        if (this.cool <= 0) {
          if (td <= T.notice && grid.los(this.pos.x, this.pos.z, tail.pos.x, tail.pos.z)) this.yappariNotice(tail);
          else if (!hidden && this.sees(T.notice, Math.PI * 2, 0)) this.yappariNotice(null);
        }
        return 'idle';
      }
      case 'notice': {
        this.stop(dt);
        const tg = this.target || this.player;
        c.faceDir(tg.pos.x - this.pos.x, tg.pos.z - this.pos.z);
        this.ring.update(this.pos.x, this.pos.z, 0.6);
        if (this.t > 0.5) this.set('chase');
        return 'shock';
      }
      case 'chase': {
        this.ring.update(this.pos.x, this.pos.z, 0);
        // 目標の仲間が列からいなくなったら、新しい最後尾か主人公に切り替える
        if (this.target && this.target.state !== 'line') this.target = tail;
        const tg = this.target || this.player;
        const d = this.target ? td : dist;
        this.moveTo(tg.pos.x, tg.pos.z, T.chase, dt, this.target ? null : this.game.playerField);
        if (this.t > T.chaseMax || d > T.lose || (!this.target && hidden)) {
          this.say(this.giveupLine(), '', 1.6);
          c.setMood('normal');
          this.cool = 2.5;
          this.set('return');
        }
        return 'reach';
      }
      case 'return': {
        this.ring.update(this.pos.x, this.pos.z, 0);
        if (this.patrol) this.pi = this.nearestWaypoint();
        const wp = this.patrol ? this.patrol[this.pi] : this.home;
        if (this.moveTo(wp.x, wp.z, 1.7, dt) < 0.25) this.set(this.patrol ? 'patrol' : 'idle');
        return 'idle';
      }
      default:
        return 'idle';
    }
  }

  // --- ライバル勝田（チームを連れて周回し、すれ違いざまに仲間を引き抜く） ---------------
  /** 巡回ルートの上の、いまいる区間から歩きだす。足あとを張り直してチームを後ろに並べる */
  rivalReset() {
    const P = this.patrol;
    let prev = null;
    if (P) {
      this.pi = this.nearestWaypoint();
      for (let i = 0; i < P.length; i++) {
        const a = P[i];
        const b = P[(i + 1) % P.length];
        const l = Math.hypot(b.x - a.x, b.z - a.z) || 1;
        const k = clamp(((this.pos.x - a.x) * (b.x - a.x) + (this.pos.z - a.z) * (b.z - a.z)) / (l * l), 0, 1);
        if (Math.hypot(a.x + (b.x - a.x) * k - this.pos.x, a.z + (b.z - a.z) * k - this.pos.z) < 0.6) {
          this.pi = (i + 1) % P.length;
          prev = a;
          break;
        }
      }
    }
    if (prev) this.trail.reset(prev.x, prev.z, this.pos.x, this.pos.z);
    else this.trail.reset(this.pos.x, this.pos.z);
    this.state = P ? 'walk' : 'idle';
    this.stealCD = 2;
    this.pauseT = 0;
    this.quipped = false;
    this.quipT = 0;
    this.crew.forEach((m, i) => {
      m.s = this.trail.headS - this.tune.spacing * (i + 1);
      m.cur.v = -1;
    });
    followTrail(this.trail, this.crew, this.tune.spacing, 0, this.tune.walk * 1.5);
    for (const m of this.crew) {
      this.trail.sample(m.s, m.cur, _tp);
      m.char.faceDir(_tp.dx, _tp.dz);
    }
    this.crewPlace(0);
  }

  updateRival(dt, dist) {
    const T = this.tune;
    const g = this.game;
    const P = this.player;
    const team = g.team;
    this.stealCD -= dt;
    this.pauseT -= dt;
    if (this.quipT > 0) {
      this.quipT -= dt;
      if (this.quipT <= 0) this.say(this.cfg.unstealLine, '', 1.8);
    }
    if (this.state === 'walk' && this.pauseT <= 0) {
      const wp = this.patrol[this.pi];
      if (this.moveTo(wp.x, wp.z, T.walk, dt) < 0.2) this.pi = (this.pi + 1) % this.patrol.length;
    } else {
      this.stop(dt);
    }
    this.trail.record(this.pos.x, this.pos.z);
    followTrail(this.trail, this.crew, T.spacing, dt, T.walk * 1.5);
    this.crewPlace(dt);
    this.lineT -= dt;
    if (dist < 5 && this.lineT <= 0 && this.cool <= 0) {
      this.lineT = 3;
      this.say(pick(Math.random, this.cfg.notice), '', 1.4);
    }
    // 引き抜き
    let ring = 0;
    if (team && this.cool <= 0) {
      if (team.lineNear(this.pos.x, this.pos.z, 4)) ring = 0.35;
      const m = this.stealCD <= 0 && team.lineNear(this.pos.x, this.pos.z, T.stealR);
      if (m) {
        team.steal(m, this);
        this.say(this.cfg.stealLine.replace('{name}', m.name), '', 2);
        this.stealCD = T.stealCD;
        this.pauseT = 0.8;
        const A = g.ally;
        if (!this.quipped && A?.state === 'follow' && Math.hypot(A.pos.x - this.pos.x, A.pos.z - this.pos.z) < 3) {
          this.quipped = true;
          A.say('僕は滑川先輩についていくと決めてるので！', 2);
          this.quipT = 1.4;
        }
      }
    }
    this.ring.update(this.pos.x, this.pos.z, ring);
    // 勝田のチームは主人公を押しのける（時間は減らない）
    if (g.state === 'play') {
      for (const m of this.crew) {
        if (m.key) continue;
        const dx = P.pos.x - m.pos.x;
        const dz = P.pos.z - m.pos.z;
        const d = Math.hypot(dx, dz);
        if (d < T.pushR && d > 0.001) {
          P.pos.x = m.pos.x + (dx / d) * T.pushR;
          P.pos.z = m.pos.z + (dz / d) * T.pushR;
          g.world.grid.resolveCircle(P.pos, P.r);
        }
      }
    }
    this.char.setMood(this.cool > 0 ? 'happy' : 'angry');
    return 'idle';
  }

  /** 勝田のチーム（引き抜いた仲間は Team が描く）の位置とアニメーション */
  crewPlace(dt) {
    for (const m of this.crew) {
      if (m.key) continue;
      const c = m.char;
      c.speed = m.v;
      c.pose = 'idle';
      c.root.position.set(m.pos.x, 0, m.pos.z);
      if (dt === 0) c.setYaw(c.targetYaw);
      c.update(dt);
    }
  }

  /** タイトル画面の背景用：巡回だけする */
  demoUpdate(dt) {
    const c = this.char;
    if (this.state === 'lurk') return;
    if (this.patrol && (this.kind === 'keiri' || this.kind === 'mtg' || this.kind === 'shacho' || this.kind === 'conga' || this.kind === 'yappari' || this.kind === 'rival')) {
      // 行列はルートを歩くだけ（お辞儀も譲り合いもしない）
      const wp = this.patrol[this.pi];
      const d = this.moveTo(wp.x, wp.z, this.conga ? this.cfg.conga.speed : this.tune.patrol || this.tune.walk, dt);
      if (d < 0.2) this.pi = (this.pi + 1) % this.patrol.length;
      c.headYaw = this.conga ? 0 : Math.sin(c.t * 1.3) * 0.55;
    } else {
      this.stop(dt);
      c.headYaw = Math.sin(c.t * 0.6 + this.home.x) * 0.5;
    }
    if (this.cone) this.cone.visible = false;
    this.ring?.update(this.pos.x, this.pos.z, 0);
    c.pose = this.kind === 'kanji' ? 'dance' : this.kind === 'mimi' ? 'scroll' : (this.conga && !this.patrol) || this.kind === 'okuri' ? 'cheer' : 'idle';
    if (this.crew) {
      this.trail.record(this.pos.x, this.pos.z);
      followTrail(this.trail, this.crew, this.tune.spacing, dt, this.tune.walk * 1.5);
    }
    this.idle(dt, true);
  }

  /** 位置の反映とアニメーションだけ（会話中など。crewMoving なら勝田のチームは歩いたまま） */
  idle(dt, crewMoving = false) {
    if (this.state === 'lurk') return;
    const c = this.char;
    c.root.position.set(this.pos.x, 0, this.pos.z);
    const spd = Math.hypot(this.vel.x, this.vel.z);
    c.speed = spd;
    if (spd > 0.25) c.faceDir(this.vel.x, this.vel.z);
    c.update(dt);
    if (this.crew) {
      // 会話中などは勝田のチームも止まる
      if (!crewMoving) for (const m of this.crew) m.v = 0;
      this.crewPlace(dt);
    }
  }

  // --- 傘ゴルフおじさん -------------------------------------------------------
  updateGolf(dt, dist, hidden) {
    const T = this.tune;
    const c = this.char;
    const grid = this.game.world.grid;
    const P = this.player;
    switch (this.state) {
      case 'wander': {
        this.cone.visible = false;
        if (!this.wanderTo || this.t > 4) {
          for (let i = 0; i < 10; i++) {
            const tx = Math.floor(this.home.x + (Math.random() - 0.5) * 6);
            const tz = Math.floor(this.home.z + (Math.random() - 0.5) * 4);
            if (grid.isWalk(tx, tz)) {
              this.wanderTo = { x: tx + 0.5, z: tz + 0.5 };
              break;
            }
          }
          this.t = 0;
        }
        if (this.wanderTo && this.moveTo(this.wanderTo.x, this.wanderTo.z, T.wander, dt) < 0.3) this.wanderTo = null;
        this.swingT -= dt * (dist < T.notice ? 1.6 : 1);
        if (this.swingT <= 0 && this.cool <= 0) {
          // 近くに人がいればそちらへ、いなければ気まぐれな方向へ構える
          const aim = dist < T.notice && !hidden
            ? Math.atan2(P.pos.x - this.pos.x, P.pos.z - this.pos.z)
            : Math.random() * Math.PI * 2;
          this.aim = aim;
          this.set('address');
          this.wanderTo = null;
        }
        return 'idle';
      }
      case 'address': {
        this.stop(dt);
        c.targetYaw = this.aim;
        const k = Math.min(1, this.t / T.windup);
        this.cone.visible = true;
        this.cone.update(grid, this.pos.x, this.pos.z, this.aim, T.fov, T.range, 0.35 + k * 0.65 + Math.sin(this.t * 30) * 0.12 * k);
        if (this.t > T.windup) {
          c.play('swing');
          this.say(pick(Math.random, this.cfg.swingLines), 'golf', 1.1);
          this.game.audio.noise?.(0.18, { freq: 900, q: 0.8, vol: 0.2 });
          this.hitDone = false;
          this.set('swing');
        }
        return 'address';
      }
      case 'swing': {
        this.stop(dt);
        this.cone.update(grid, this.pos.x, this.pos.z, this.aim, T.fov, T.range, Math.max(0, 1 - this.t * 2.5));
        if (!this.hitDone && this.t > 0.1 && this.t < 0.3) {
          const dx = P.pos.x - this.pos.x;
          const dz = P.pos.z - this.pos.z;
          const d = Math.hypot(dx, dz);
          const inArc = d < T.range + P.r && (d < 0.5 || Math.abs(wrapAngle(Math.atan2(dx, dz) - this.aim)) < T.fov / 2);
          if (inArc && !this.game.playerHidden && this.game.state === 'play') {
            this.hitDone = true;
            if (P.invulnerable) this.game.nearMiss?.(this);
            else this.wantsCatch = true;
          }
        }
        if (this.t > 0.2 && this.t < 0.3) this.game.fx.dust(this.pos.x + Math.sin(this.aim) * 1.2, this.pos.z + Math.cos(this.aim) * 1.2, 1, '#e8eef5', 0.6);
        if (this.t > 0.75) {
          this.cone.visible = false;
          this.swingT = T.every + Math.random() * 1.4;
          this.set('wander');
        }
        return 'address';
      }
      default:
        return 'idle';
    }
  }

  // --- 清掃員 -----------------------------------------------------------------
  updateCleaner(dt, dist) {
    const T = this.tune;
    const c = this.char;
    if (this.patrol) {
      const wp = this.patrol[this.pi];
      if (this.moveTo(wp.x, wp.z, T.speed, dt) < 0.2) {
        if (this.pi + this.pdir >= this.patrol.length || this.pi + this.pdir < 0) this.pdir *= -1;
        this.pi += this.pdir;
      }
    } else {
      if (!this.wanderTo || this.t > 6) {
        const grid = this.game.world.grid;
        for (let i = 0; i < 10; i++) {
          const tx = Math.floor(this.home.x + (Math.random() - 0.5) * 10);
          const tz = Math.floor(this.home.z + (Math.random() - 0.5) * 6);
          if (grid.isWalk(tx, tz)) {
            this.wanderTo = { x: tx + 0.5, z: tz + 0.5 };
            break;
          }
        }
        this.t = 0;
      }
      if (this.wanderTo && this.moveTo(this.wanderTo.x, this.wanderTo.z, T.speed, dt) < 0.3) this.wanderTo = null;
    }
    // 通ったあとを拭いていく（少し後ろのマスも）
    const w = this.game.weather;
    if (w) {
      w.mop(this.pos.x, this.pos.z);
      const sp = Math.hypot(this.vel.x, this.vel.z) || 1;
      w.mop(this.pos.x - (this.vel.x / sp) * 0.9, this.pos.z - (this.vel.z / sp) * 0.9);
    }
    this.lineT -= dt;
    if (dist < 3.2 && this.lineT < 0) {
      this.lineT = 3 + Math.random() * 2;
      this.say(pick(Math.random, this.cfg.notice), 'cleaner', 1.4);
    }
    return 'mop';
  }

  // --- ティッシュ配り ---------------------------------------------------------
  updateHandout(dt, dist, hidden) {
    const c = this.char;
    this.stop(dt);
    if (dist < 6 && !hidden) this.facePlayer();
    else c.targetYaw = this.homeYaw;
    this.lineT -= dt;
    if (dist < 5 && this.lineT < 0 && !hidden) {
      this.lineT = 2.5 + Math.random() * 1.5;
      this.say(pick(Math.random, this.cfg.notice), '', 1.2);
    }
    return dist < 3 && !hidden ? 'talk' : 'idle';
  }

  dispose() {
    this.char.root.removeFromParent();
    for (const m of this.char.meshes) m.geometry.dispose();
    this.cone?.dispose();
    this.ring?.dispose();
    this.conga?.dispose();
    this.trail?.dispose();
    for (const m of this.crew || []) {
      if (m.key) continue;
      m.char.root.removeFromParent();
      for (const x of m.char.meshes) x.geometry.dispose();
    }
  }
}
