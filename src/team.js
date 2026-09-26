import * as THREE from 'three';
import { Character } from './characters.js';
import { TEAM, TEAM_PHONE_WAKE } from './cast.js';
import { clamp, pick } from './util.js';

export const TEAM_TUNE = {
  spacing: 0.9, // 列の間隔 m（ハチマキ中は 0.5）
  spacingTight: 0.5,
  maxSpeed: 6.2, // 仲間の最高速度。主人公が速いときは max(6.2, 主人公の速さ×1.25)
  snap: 6, // 目標点から 6m 以上離れたら瞬間移動
  catchR: 0.6, // 敵と仲間の接触距離
  wakeR: 1.2, wakeTime: 0.9, wakeDecay: 1.0, // 起こす：1.2m以内に0.9秒。離れると毎秒1.0で戻る
  phoneWakeR: 6,
  rejoinR: 1.0, groupR: 2.0,
  holdK: 0.5, holdMin: 4, holdMax: 9, // 話し込み時間 = clamp(敵の penalty × 0.5, 4, 9) 秒
  grace: 1.0, // 列に戻った直後の無敵
  dashInvul: 0.35, spinTime: 0.2,
  catchupR: 10, catchupSpeed: 4.2, // 信号で切れた仲間：青のとき 10m 以内なら小走りで追いつく
  wait: { left: 5, held: 5, catchup: 5, asleep: 15, stolen: 10 },
  hachimaki: 6,
};
const T = TEAM_TUNE;
// 仲間を捕まえない動き方（書類おじさん・ティッシュ配りは手渡すだけ、ライバルは引き抜くだけ）
const NO_GRAB = new Set(['shorui', 'handout', 'rival']);
const POSE = { asleep: 'down', line: 'idle', held: 'listen', catchup: 'idle', stolen: 'idle', stage: 'idle' };
const LABEL = { asleep: 'Zzz', held: '…', left: '+5', catchup: '+5', stolen: '引抜' };

// 全ステージで共有するので dispose しない
const RING = new THREE.RingGeometry(0.36, 0.44, 32);
const RING_MAT = new THREE.MeshBasicMaterial({ color: '#ff9f43', transparent: true, opacity: 0.8, depthWrite: false, depthTest: false });
const BAND = new THREE.TorusGeometry(0.305, 0.028, 6, 28);
const BAND_MAT = new THREE.MeshStandardMaterial({ color: '#e0402f', roughness: 0.6 });
const _t = { x: 0, z: 0, dx: 0, dz: 1, gap: 0 };
const _dir = { x: 0, z: 0 };

/**
 * 足あと（trail）の上を一列にたどる。i 番目の人は先頭から spacing*(i+1) 後ろ。
 * 各自の s を目標の s へ最高 maxSpeed で近づける（道すじの上しか歩かない）。ダッシュの途切れ目を通るとくるっと回る。
 * 仲間と勝田のチームで共用。list の各要素は { pos, s, cur, v, char, freezeT, spinT, invulnT }
 */
export function followTrail(trail, list, spacing, dt, maxSpeed) {
  const head = trail.headS;
  for (let i = 0; i < list.length; i++) {
    const m = list[i];
    const s0 = m.s;
    if (m.freezeT <= 0) {
      const d = head - spacing * (i + 1) - m.s;
      if (Math.abs(d) > T.snap) m.s += d;
      else m.s += clamp(d, -Math.min(maxSpeed, Math.abs(d) * 8) * dt, Math.min(maxSpeed, Math.abs(d) * 8) * dt);
      if (m.s > s0 && m.spinT <= 0 && trail.gapAhead(s0, m.s) >= 0) {
        m.spinT = T.spinTime;
        m.invulnT = Math.max(m.invulnT, T.dashInvul);
      }
    }
    trail.sample(m.s, m.cur, _t);
    m.v = dt > 0 ? Math.abs(m.s - s0) / dt : 0;
    if (m.v > 0.2) m.char.faceDir(Math.sign(m.s - s0) * _t.dx, Math.sign(m.s - s0) * _t.dz);
    m.pos.set(_t.x, 0, _t.z);
  }
}

/** 特命プロジェクト室のチーム（第9章）。仲間は主人公の足あと（game.trail）をたどる */
export class Team {
  constructor(game, spawns, cfg) {
    this.game = game;
    this.cfg = cfg;
    this.hachiT = 0;
    this.dirty = true;
    this.progOn = false;
    this.presenting = false;
    this.slots = 0; // 演台の横に並んだ人数
    this.members = cfg.order.map((key, i) => {
      const def = TEAM[key];
      const c = new Character(def.look, { outline: true });
      const ring = new THREE.Mesh(RING, RING_MAT);
      ring.rotation.x = -Math.PI / 2;
      ring.position.y = 0.035;
      ring.renderOrder = 1;
      c.root.add(ring);
      const band = new THREE.Mesh(BAND, BAND_MAT);
      band.position.set(0, 0.37, -0.02);
      band.rotation.x = Math.PI / 2 - 0.25;
      band.visible = false;
      c.head.add(band);
      game.scene.add(c.root);
      const sp = spawns[i] || spawns[spawns.length - 1];
      return {
        key, def, char: c, band, ring, name: def.name, pos: new THREE.Vector3(sp.x, 0, sp.z), home: sp,
        state: cfg.start === 'asleep' ? 'asleep' : 'line', s: 0, cur: { k: 0, v: -1 }, v: 0,
        freezeT: 0, spinT: 0, invulnT: 0, holdT: 0, holdE: null, wake: 0, lineT: 1 + i, reason: '', rival: null, slot: null,
      };
    });
    this.line = [];
    const tr = game.trail;
    const P = game.player.pos;
    if (cfg.start === 'line') {
      // P に近い順に並べ、いちばん遠い X から P まで足あとを張る
      this.line = [...this.members].sort((a, b) => Math.hypot(a.pos.x - P.x, a.pos.z - P.z) - Math.hypot(b.pos.x - P.x, b.pos.z - P.z));
      const far = this.line[this.line.length - 1].pos;
      tr.reset(far.x, far.z, P.x, P.z);
      this.line.forEach((m, i) => {
        m.s = tr.headS - T.spacing * (i + 1);
        tr.sample(m.s, m.cur, _t);
        m.pos.set(_t.x, 0, _t.z);
        m.char.setYaw(Math.atan2(P.x - _t.x, P.z - _t.z));
      });
    } else {
      tr.reset(P.x, P.z);
      for (const m of this.members) {
        m.char.setYaw(Math.random() * Math.PI * 2);
        m.char.pose = 'down';
      }
    }
    for (const m of this.members) m.char.root.position.copy(m.pos);
  }

  get spacing() {
    return this.hachiT > 0 ? T.spacingTight : T.spacing;
  }

  say(m, text, dur = 1.6) {
    this.game.ui.bubble(m, text, 'team', dur);
  }

  float(m, text, cls, y = 2.5) {
    this.game.ui.float(m.pos.x, y, m.pos.z, text, cls);
  }

  tail() {
    return this.line[this.line.length - 1] || null;
  }

  lineCount() {
    return this.line.length;
  }

  lineNames() {
    return this.line.map((m) => m.name);
  }

  /** 列の中で (x, z) から r 以内にいる、つかまえられる仲間 */
  lineNear(x, z, r) {
    if (this.hachiT > 0) return null;
    for (const m of this.line) if (m.invulnT <= 0 && Math.hypot(m.pos.x - x, m.pos.z - z) < r) return m;
    return null;
  }

  hasAsleep() {
    return this.members.some((m) => m.state === 'asleep');
  }

  nearestAsleep(x, z) {
    let best = null;
    let bd = Infinity;
    for (const m of this.members) {
      if (m.state !== 'asleep') continue;
      const d = Math.hypot(m.pos.x - x, m.pos.z - z);
      if (d < bd) {
        bd = d;
        best = m;
      }
    }
    return best;
  }

  /** ゴールで払う待ち時間（分） */
  waitOf(m) {
    return m.state === 'line' || m.state === 'stage' ? 0 : T.wait[m.state] ?? T.wait.left;
  }

  missingMinutes() {
    let n = 0;
    for (const m of this.members) n += this.waitOf(m);
    return n;
  }

  /** 列の最後尾に入れる（足あとの上の、いまいる場所の近くから歩きだす） */
  toLine(m) {
    if (this.presenting) {
      this.toStage(m);
      return;
    }
    const tr = this.game.trail;
    m.cur.v = -1;
    m.s = tr.nearestS(m.pos.x, m.pos.z, 6).s;
    m.state = 'line';
    m.rival = null;
    m.invulnT = T.grace;
    m.freezeT = 0;
    this.line.push(m);
    this.dirty = true;
  }

  /** 列から外す（後ろの人は詰める） */
  fromLine(m) {
    const i = this.line.indexOf(m);
    if (i >= 0) this.line.splice(i, 1);
    this.dirty = true;
  }

  wakeUp(m, lines = m.def.wake) {
    this.say(m, pick(Math.random, lines), 1.8);
    this.float(m, `${m.name}が起きた！`, 'good');
    m.char.pose = 'idle';
    m.char.play('jump');
    m.char.setMood('surprised');
    this.game.audio.sparkle();
    this.toLine(m);
  }

  /** 電話の着信音で、近くの寝ている仲間が飛び起きる */
  onPhone(x, z) {
    for (const m of this.members) {
      if (m.state === 'asleep' && Math.hypot(m.pos.x - x, m.pos.z - z) <= T.phoneWakeR) this.wakeUp(m, TEAM_PHONE_WAKE);
    }
  }

  /** 列の仲間 m が敵 e に捕まる（早瀬くんが同行中なら、代わりに話を聞いてくれる） */
  catchMember(e, m) {
    const g = this.game;
    if (g.ally?.state === 'follow') {
      g.ally.intercept(e);
      g.ui.setAlly(false);
      g.ui.float(m.pos.x, 2.5, m.pos.z, '早瀬くんが身代わりに！', 'good');
      g.audio.sparkle();
      m.invulnT = 1.5;
      return;
    }
    this.fromLine(m);
    m.state = 'held';
    m.holdT = clamp(e.cfg.penalty * T.holdK, T.holdMin, T.holdMax);
    m.holdE = e;
    m.v = 0;
    m.char.faceDir(e.pos.x - m.pos.x, e.pos.z - m.pos.z);
    m.char.setMood('worried');
    e.hold(m.holdT, m.pos);
    e.char.faceDir(m.pos.x - e.pos.x, m.pos.z - e.pos.z);
    e.say(pick(Math.random, e.cfg.memberLines || e.cfg.notice), '', 1.8);
    if (e.kind === 'yappari') {
      e.char.play('throw');
      g.fx.papers(m.pos.x, 1.4, m.pos.z, 8, 0.8);
    }
    // 仲間の返事は、相手のひとことが読めるよう少し遅らせる（update の held）
    m.lineT = 0.8;
    this.float(m, `${m.name}、つかまった！`, 'minus', 3.3);
    g.audio.caught();
  }

  /** 話し込み中の仲間を連れ戻す（相手はすぐこちらに気づく） */
  rescue(m) {
    const e = m.holdE;
    m.holdE = null;
    if (e && e.state === 'held') {
      e.afterTalk();
      // プレゼン本番中は気づかない（無力化のまま）
      if (this.presenting) e.cool = 999;
      else {
        e.cool = 0;
        // 局長は帰りかけ（return）でも主人公に気づく
        if (e.kind === 'yappari') e.yappariNotice(null);
        else e.alert();
      }
      // 気づかれた瞬間に捕まらないよう、逃げる間だけ少し猶予
      this.game.player.invulnT = Math.max(this.game.player.invulnT, 0.8);
    }
    this.rejoin(m);
  }

  rejoin(m) {
    this.say(m, pick(Math.random, m.def.back), 1.4);
    this.float(m, `${m.name}が合流！`, 'good');
    m.char.setMood('happy');
    this.game.audio.sparkle();
    this.toLine(m);
  }

  steal(m, rival) {
    this.fromLine(m);
    m.state = 'stolen';
    m.rival = rival;
    m.cur.v = -1;
    m.s = rival.trail.nearestS(m.pos.x, m.pos.z, 8).s;
    rival.crew.push(m);
    this.say(m, pick(Math.random, m.def.stolen), 1.8);
    this.float(m, `${m.name}を引き抜かれた！`, 'minus', 3.3);
    this.game.audio.caught();
  }

  unsteal(m, rival) {
    const i = rival.crew.indexOf(m);
    if (i >= 0) rival.crew.splice(i, 1);
    this.say(m, pick(Math.random, m.def.unstolen), 1.8);
    this.float(m, `${m.name}を取り返した！`, 'good');
    this.game.audio.sparkle();
    this.toLine(m);
  }

  setHachimaki(t) {
    const g = this.game;
    const P = g.player;
    if (!this.line.length) {
      P.boostT = 4;
      g.ui.bubble(P, '（自分に巻いた。気合いだけは入った）', 'player', 1.6);
      return;
    }
    this.hachiT = t;
    for (const m of this.line) {
      m.band.visible = true;
      this.say(m, '必勝！', 1.2);
    }
    g.ui.float(P.pos.x, 2.6, P.pos.z, 'チーム全員、必勝！', 'good');
    g.fx.sparkle(P.pos.x, 1.2, P.pos.z, 14);
  }

  /** ゴールに着いたとき：列にいない人の待ち時間を足す。締切を過ぎたら false */
  settle() {
    const g = this.game;
    const P = g.player;
    let k = 0;
    for (const m of this.members) {
      const w = this.waitOf(m);
      if (!w) continue;
      g.clock += w;
      g.ui.float(P.pos.x, 2.4 + k * 0.45, P.pos.z, `${m.name}待ち +${w}分`, 'minus');
      k++;
    }
    if (k) g.audio.caught();
    if (g.clock >= g.stage.deadline) {
      g.fail();
      return false;
    }
    return true;
  }

  /** プレゼン開始：列の仲間を演台の横（G から x±1.3／±2.3、z+0.8）へ歩かせる */
  startPresent(cx, cz) {
    this.presenting = true;
    this.cx = cx;
    this.cz = cz;
    for (const m of [...this.line]) this.toStage(m);
    const A = this.game.ally;
    if (A?.state === 'follow') {
      A.state = 'stage';
      A.slot = this.slotPos(this.slots++);
    }
  }

  slotPos(i) {
    const dx = [-1.3, 1.3, -2.3, 2.3, -3.3][i] ?? 0;
    return { x: this.cx + dx, z: this.cz + 0.8 };
  }

  toStage(m) {
    this.fromLine(m);
    m.state = 'stage';
    m.slot = this.slotPos(this.slots++);
    m.hachi = false;
    this.dirty = true;
  }

  update(dt) {
    const g = this.game;
    const P = g.player;
    const tr = g.trail;
    const grid = g.world.grid;
    this.hachiT = Math.max(0, this.hachiT - dt);
    // ① 列にいる人：足あとをたどる
    const walk = P.baseSpeed * P.speedFactor();
    followTrail(tr, this.line, this.spacing, dt, Math.max(T.maxSpeed, walk * 1.25));
    // ② 赤信号：目標点が横断歩道で、自分はまだ渡っていなければ、そこから後ろが取り残される
    if (g.traffic && !g.traffic.walkable) {
      const sp = this.spacing;
      for (let i = 0; i < this.line.length; i++) {
        const m = this.line[i];
        tr.sample(tr.headS - sp * (i + 1), m.cur, _t);
        if (grid.at(Math.floor(_t.x), Math.floor(_t.z)) !== 'z' || grid.at(Math.floor(m.pos.x), Math.floor(m.pos.z)) === 'z') continue;
        tr.sample(m.s, m.cur, _t); // カーソルを元の位置に戻す
        const cut = this.line.splice(i);
        for (const c of cut) {
          c.state = 'left';
          c.reason = 'signal';
          c.lineT = 1.2;
          c.v = 0;
        }
        this.say(cut[0], pick(Math.random, cut[0].def.left), 1.8);
        g.ui.float(cut[0].pos.x, 2.5, cut[0].pos.z, '列が切れた！', 'minus');
        this.dirty = true;
        break;
      }
    }
    let prog = null;
    for (const m of this.members) {
      m.invulnT = Math.max(0, m.invulnT - dt);
      m.freezeT = Math.max(0, m.freezeT - dt);
      m.lineT -= dt;
      if (m.spinT > 0) {
        m.spinT -= dt;
        m.char.spin = m.spinT > 0 ? (1 - m.spinT / T.spinTime) * Math.PI * 2 : 0;
      }
      if (m.band.visible !== (this.hachiT > 0 && m.state === 'line')) m.band.visible = this.hachiT > 0 && m.state === 'line';
      const d = Math.hypot(P.pos.x - m.pos.x, P.pos.z - m.pos.z);
      switch (m.state) {
        case 'asleep':
          // ③ そばで少し立ち止まると起きる
          if (d < T.wakeR) {
            m.wake += dt;
            prog = m;
            if (m.wake >= T.wakeTime) {
              prog = null;
              this.wakeUp(m);
            }
          } else {
            m.wake = Math.max(0, m.wake - T.wakeDecay * dt);
            if (d < 7 && m.lineT <= 0) {
              m.lineT = 3 + Math.random();
              this.say(m, pick(Math.random, m.def.sleep), 1.6);
              g.ui.emote(m, 'Zzz');
            }
          }
          break;
        case 'held':
          // ④ 話し込み中：触れれば救出。時間が経つとその場で待つ
          m.holdT -= dt;
          if (m.lineT <= 0 && m.lineT + dt > 0) this.say(m, pick(Math.random, m.def.caught), 1.6);
          if (m.holdE) m.char.faceDir(m.holdE.pos.x - m.pos.x, m.holdE.pos.z - m.pos.z);
          if (d < T.rejoinR) this.rescue(m);
          else if (m.holdT <= 0) {
            m.state = 'left';
            m.reason = 'held';
            m.holdE = null;
            m.lineT = 0;
            this.dirty = true;
          }
          break;
        case 'left':
          m.char.faceDir(P.pos.x - m.pos.x, P.pos.z - m.pos.z);
          if (d < T.rejoinR) {
            // 近くで待っている人もまとめて戻る
            this.rejoin(m);
            for (const o of this.members) if (o !== m && o.state === 'left' && Math.hypot(o.pos.x - m.pos.x, o.pos.z - m.pos.z) < T.groupR) this.toLine(o);
          } else if (m.reason === 'signal' && g.traffic?.walkable && d < T.catchupR) {
            m.state = 'catchup';
            this.dirty = true;
          } else if (d < 12 && m.lineT <= 0) {
            m.lineT = 3.5;
            this.say(m, pick(Math.random, m.def.left), 1.6);
          }
          break;
        case 'catchup': {
          // ⑤ 列の最後尾の位置へ小走り
          tr.sample(tr.headS - this.spacing * (this.line.length + 1), m.cur, _t);
          const dx = _t.x - m.pos.x;
          const dz = _t.z - m.pos.z;
          const l = Math.hypot(dx, dz);
          if (l < 1.2) {
            this.toLine(m);
            break;
          }
          let wx = dx / l;
          let wz = dz / l;
          if (!grid.clearPath(m.pos.x, m.pos.z, _t.x, _t.z, 0.25)) {
            const dir = grid.flowDir(grid.field(Math.floor(_t.x), Math.floor(_t.z)), m.pos.x, m.pos.z, _dir);
            if (dir) {
              wx = dir.x;
              wz = dir.z;
            }
          }
          m.pos.x += wx * T.catchupSpeed * dt;
          m.pos.z += wz * T.catchupSpeed * dt;
          grid.resolveCircle(m.pos, 0.28);
          m.v = T.catchupSpeed;
          m.char.faceDir(wx, wz);
          break;
        }
        case 'stolen':
          if (d < 0.9 && m.rival) {
            const r = m.rival;
            this.unsteal(m, r);
            r.say(r.cfg.unstealLine, '', 1.8);
          }
          break;
        case 'stage':
          this.walkTo(m, m.slot, dt);
          break;
        default:
          break;
      }
    }
    // 早瀬くんも演台の横へ
    const A = g.ally;
    if (A?.state === 'stage') this.walkTo(A, A.slot, dt);
    // 起こしている進み具合
    if (prog) {
      g.ui.setProgress(prog, prog.wake / T.wakeTime, '起こしています…', false);
      this.progOn = true;
    } else if (this.progOn) {
      this.progOn = false;
      g.ui.setProgress(null);
    }
    // ⑥ 列の仲間の捕獲判定
    if (g.state === 'play' && this.hachiT <= 0) {
      for (const m of this.line) {
        if (m.invulnT > 0) continue;
        const e = this.grabber(m);
        if (e) {
          this.catchMember(e, m);
          break;
        }
      }
    }
    if (this.dirty) this.refreshHud();
  }

  grabber(m) {
    for (const e of this.game.enemies) {
      if (NO_GRAB.has(e.kind) || !e.canCatch) continue;
      if (Math.hypot(e.pos.x - m.pos.x, e.pos.z - m.pos.z) < T.catchR) return e;
    }
    return null;
  }

  /** 演台の横まで 3m/s で歩き、着いたら北（審査員）を向く */
  walkTo(m, p, dt) {
    const dx = p.x - m.pos.x;
    const dz = p.z - m.pos.z;
    const l = Math.hypot(dx, dz);
    if (l > 0.05) {
      const k = Math.min(l, 3 * dt) / l;
      m.pos.x += dx * k;
      m.pos.z += dz * k;
      m.char.faceDir(dx, dz);
      if (m.vel) m.vel.x = m.vel.z = 0;
      m.v = 3;
    } else {
      m.v = 0;
      m.char.faceDir(0, -1);
    }
  }

  refreshHud() {
    this.dirty = false;
    const P = this.game.ui.portraits || {};
    this.game.ui.setTeam(this.members.map((m) => ({
      img: P[m.def.portrait] || '', name: m.name, state: m.state === 'catchup' ? 'left' : m.state, label: LABEL[m.state] || '',
    })), this.missingMinutes());
  }

  /** 位置の反映とアニメーション（毎フレーム）。会話中は一緒に頭を下げ、ゴール演出中は喜ぶ */
  animate(dt) {
    const st = this.game.state;
    const over = st === 'talk' ? 'bow' : st === 'goalSeq' || st === 'result' ? 'cheer' : null;
    const P = this.game.player;
    for (const m of this.members) {
      const c = m.char;
      const d = P ? Math.hypot(P.pos.x - m.pos.x, P.pos.z - m.pos.z) : 99;
      let pose = m.state === 'left' ? (d < 12 ? 'cheer' : 'idle') : POSE[m.state];
      if (over && (m.state === 'line' || m.state === 'stage')) pose = over;
      c.pose = pose;
      m.ring.visible = m.state !== 'stolen' && m.state !== 'stage';
      c.speed = st === 'play' && m.state !== 'asleep' ? m.v : 0;
      c.root.position.set(m.pos.x, 0, m.pos.z);
      c.update(dt);
    }
  }

  dispose() {
    for (const m of this.members) {
      m.char.root.removeFromParent();
      for (const x of m.char.meshes) x.geometry.dispose();
    }
    this.members = [];
    this.line = [];
    this.game.ui.setTeam(null);
  }
}
