import { pick } from './util.js';

// 時差ボケ（第10章）の吹き出し
const WAKE = ['はっ！', 'はっ！ 寝てない寝てない', 'はっ！（目が覚めた）'];
const DOZE = ['Zzz…（船をこいでいる）', 'Zzz…すし…', 'Zzz…ガット・ア・ミニット…'];
const AFTER = ['……はっ！ 寝てた！', '……よだれ、出てた？', '……はっ！ ここどこ！？'];

/**
 * 時差ボケ。every 秒ごとに「うとうと…」の予告（warn 秒）が来て、その間にダッシュすれば目が覚める。
 * 間に合わなければ doze 秒、その場で居眠り（入力は効かない。無敵でもない）。
 * 電話中のふりをしている間は眠くならない。会話中・ゴール演出中は updatePlay が呼ばれないので進まない。
 */
export class Jetlag {
  constructor(game, cfg) {
    this.game = game;
    this.cfg = cfg;
    this.phase = 'awake';
    this.t = this.interval();
    this.first = true;
    this.shown = -1;
  }

  interval() {
    const [a, b] = this.cfg.every;
    return a + Math.random() * (b - a);
  }

  get dozing() {
    return this.phase === 'doze';
  }

  update(dt) {
    if (this.game.player.phoneT > 0) return;
    this.t -= dt;
    if (this.phase === 'awake') {
      if (this.t <= 0) this.warn();
    } else if (this.phase === 'warn') {
      // 予告の間、画面の周りがだんだん暗くなる
      this.level(0.35 + 0.35 * (1 - Math.max(0, this.t) / this.cfg.warn));
      if (this.t <= 0) this.doze();
    } else if (this.t <= 0) {
      this.wake(false);
    }
  }

  warn() {
    const g = this.game;
    this.phase = 'warn';
    this.t = this.cfg.warn;
    g.ui.bubble(g.player, 'Zzz…', 'zzz', this.cfg.warn);
    if (this.first) {
      this.first = false;
      g.ui.toast('うとうと…　ダッシュで目を覚ませ！', 'announce');
    }
  }

  doze() {
    const g = this.game;
    const P = g.player;
    this.phase = 'doze';
    this.t = this.cfg.doze;
    P.vel.set(0, 0);
    P.char.setMood('dizzy');
    g.ui.bubble(P, pick(Math.random, DOZE), 'zzz', this.cfg.doze);
    this.level(0.85);
  }

  /** 目が覚める（dash = ダッシュで起きた） */
  wake(dash) {
    const g = this.game;
    const P = g.player;
    this.phase = 'awake';
    this.t = this.interval();
    this.level(0);
    P.char.setMood('normal');
    if (P.char.pose === 'doze') P.char.pose = 'idle';
    g.ui.bubble(P, pick(Math.random, dash ? WAKE : AFTER), 'player', 1.1);
    if (dash) {
      g.fx.sparkle(P.pos.x, 1.6, P.pos.z, 8);
      g.audio.sparkle();
    }
  }

  onDash() {
    if (this.phase === 'warn') this.wake(true);
  }

  /** 缶コーヒー：次のうとうとまでの時間がのびる（うとうと中なら目も覚める） */
  onCoffee() {
    if (this.phase !== 'awake') this.wake(true);
    this.t += 8;
  }

  /** 捕まったときなど：何も言わずに起きる */
  reset() {
    if (this.phase === 'awake') return;
    this.phase = 'awake';
    this.t = this.interval();
    this.level(0); // 表情とポーズは呼んだ側（会話・ゴール・時間切れ）が決める
  }

  level(v) {
    const q = Math.round(v * 20);
    if (q === this.shown) return;
    this.shown = q;
    this.game.ui.doze(q / 20);
  }

  dispose() {
    this.shown = -1;
    this.game.ui.doze(0);
  }
}
