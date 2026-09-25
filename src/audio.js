// WebAudio で合成する効果音と BGM（音声ファイルなし）

const NOTE = (n) => 440 * Math.pow(2, (n - 69) / 12);

const PROG = [
  { root: 48, tones: [60, 64, 67, 71] }, // Cmaj7
  { root: 45, tones: [57, 60, 64, 67] }, // Am7
  { root: 50, tones: [62, 65, 69, 72] }, // Dm7
  { root: 43, tones: [55, 59, 62, 65] }, // G7
  { root: 53, tones: [60, 65, 69, 72] }, // Fmaj7
  { root: 52, tones: [59, 64, 67, 71] }, // Em7
  { root: 50, tones: [60, 62, 65, 69] }, // Dm7
  { root: 43, tones: [59, 62, 65, 67] }, // G7
];
const MELODY = [72, 74, 76, 79, 81, 79, 76, 74];

export class Audio {
  constructor() {
    this.ctx = null;
    this.muted = false;
    try {
      this.muted = localStorage.getItem('surusuru-muted') === '1';
    } catch (e) { /* 保存できない環境 */ }
    this.music = null;
    this.tension = false;
  }

  unlock() {
    if (!this.ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      this.ctx = new AC();
      const c = this.ctx;
      this.master = c.createGain();
      this.master.gain.value = this.muted ? 0 : 1;
      const comp = c.createDynamicsCompressor();
      comp.threshold.value = -14;
      comp.ratio.value = 4;
      this.master.connect(comp);
      comp.connect(c.destination);
      this.sfx = c.createGain();
      this.sfx.gain.value = 0.55;
      this.sfx.connect(this.master);
      this.bus = c.createGain();
      this.bus.gain.value = 0.7;
      this.bus.connect(this.master);
      const len = c.sampleRate;
      this.noiseBuf = c.createBuffer(1, len, c.sampleRate);
      const d = this.noiseBuf.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
      this.timer = setInterval(() => this.schedule(), 25);
    }
    if (this.ctx.state !== 'running') this.ctx.resume().catch(() => {});
    if (!this.primed) {
      this.primed = true;
      // iOS：マナースイッチがオンでも鳴るように再生用セッションにする
      try {
        if (navigator.audioSession) navigator.audioSession.type = 'playback';
      } catch (e) { /* 未対応 */ }
      // iOS：タップ中に無音を1回鳴らしてオーディオを解放する
      const b = this.ctx.createBuffer(1, 1, 22050);
      const src = this.ctx.createBufferSource();
      src.buffer = b;
      src.connect(this.ctx.destination);
      src.start(0);
    }
    if (this.pending) {
      const p = this.pending;
      this.pending = null;
      this.startMusic(p.style, p.tempo);
    }
  }

  setMuted(m) {
    this.muted = m;
    try {
      localStorage.setItem('surusuru-muted', m ? '1' : '0');
    } catch (e) { /* noop */ }
    if (this.master) this.master.gain.setTargetAtTime(m ? 0 : 1, this.ctx.currentTime, 0.05);
  }

  get now() {
    return this.ctx ? this.ctx.currentTime : 0;
  }

  tone(freq, dur, o = {}) {
    const c = this.ctx;
    if (!c) return;
    const t0 = (o.at ?? c.currentTime) + (o.delay || 0);
    const osc = c.createOscillator();
    osc.type = o.type || 'sine';
    osc.frequency.setValueAtTime(freq, t0);
    if (o.slideTo) osc.frequency.exponentialRampToValueAtTime(o.slideTo, t0 + (o.slideT || dur));
    if (o.vibrato) {
      const lfo = c.createOscillator();
      const lg = c.createGain();
      lfo.frequency.value = o.vibrato;
      lg.gain.value = freq * 0.02;
      lfo.connect(lg);
      lg.connect(osc.frequency);
      lfo.start(t0);
      lfo.stop(t0 + dur + 0.05);
    }
    const g = c.createGain();
    const v = o.vol ?? 0.2;
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(v, t0 + (o.attack ?? 0.006));
    if (o.hold) g.gain.setValueAtTime(v, t0 + o.hold);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    let node = osc;
    if (o.filter) {
      const f = c.createBiquadFilter();
      f.type = 'lowpass';
      f.frequency.value = o.filter;
      osc.connect(f);
      node = f;
    }
    node.connect(g);
    g.connect(o.bus || this.sfx);
    osc.start(t0);
    osc.stop(t0 + dur + 0.05);
  }

  noise(dur, o = {}) {
    const c = this.ctx;
    if (!c) return;
    const t0 = (o.at ?? c.currentTime) + (o.delay || 0);
    const src = c.createBufferSource();
    src.buffer = this.noiseBuf;
    const f = c.createBiquadFilter();
    f.type = o.ftype || 'bandpass';
    f.frequency.setValueAtTime(o.freq || 2000, t0);
    if (o.slideTo) f.frequency.exponentialRampToValueAtTime(o.slideTo, t0 + dur);
    f.Q.value = o.q ?? 1;
    const g = c.createGain();
    const v = o.vol ?? 0.2;
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(v, t0 + (o.attack ?? 0.004));
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    src.connect(f);
    f.connect(g);
    g.connect(o.bus || this.sfx);
    src.start(t0, Math.random() * 0.5);
    src.stop(t0 + dur + 0.05);
  }

  // --- 効果音 ---------------------------------------------------------------
  click() { this.tone(900, 0.06, { type: 'triangle', vol: 0.12 }); }
  dash() {
    this.noise(0.22, { freq: 3200, slideTo: 700, q: 1.2, vol: 0.35 });
    this.tone(520, 0.16, { type: 'sine', slideTo: 1100, vol: 0.08 });
  }
  notice(freq = 300) {
    this.tone(freq * 3, 0.09, { type: 'square', vol: 0.07, filter: 3000 });
    this.tone(freq * 4.5, 0.12, { type: 'square', vol: 0.07, filter: 3000, delay: 0.08 });
  }
  alarm() {
    for (let i = 0; i < 3; i++) {
      this.tone(1180, 0.08, { type: 'square', vol: 0.09, filter: 2600, delay: i * 0.11 });
      this.tone(880, 0.08, { type: 'square', vol: 0.09, filter: 2600, delay: i * 0.11 + 0.055 });
    }
    this.tone(70, 0.5, { type: 'sawtooth', vol: 0.14, filter: 300 });
  }
  shout() {
    this.tone(660, 0.12, { type: 'triangle', vol: 0.1, slideTo: 990 });
    this.tone(990, 0.18, { type: 'triangle', vol: 0.08, delay: 0.1, slideTo: 700 });
  }
  whoosh() { this.noise(0.25, { freq: 900, slideTo: 2400, q: 0.8, vol: 0.12 }); }
  paperHit() {
    this.noise(0.18, { freq: 2500, q: 0.6, vol: 0.3 });
    this.tone(180, 0.18, { type: 'triangle', vol: 0.15, slideTo: 90 });
  }
  paperMiss() { this.noise(0.14, { freq: 3500, q: 0.7, vol: 0.12 }); }
  shred() {
    this.noise(0.6, { freq: 900, q: 3, vol: 0.2, ftype: 'bandpass' });
    this.tone(95, 0.6, { type: 'sawtooth', vol: 0.08, filter: 500 });
  }
  caught() {
    this.tone(660, 0.14, { type: 'square', vol: 0.09, filter: 2000 });
    this.tone(440, 0.4, { type: 'square', vol: 0.09, filter: 1800, delay: 0.12, slideTo: 330 });
  }
  voice(freq = 300, type = 'triangle') {
    const f = freq * (0.9 + Math.random() * 0.25);
    this.tone(f, 0.055, { type, vol: 0.06, filter: 2400 });
  }
  stamp() {
    this.tone(120, 0.22, { type: 'sine', vol: 0.5, slideTo: 50 });
    this.noise(0.08, { freq: 600, q: 0.6, vol: 0.25 });
  }
  tick() { this.tone(2200, 0.03, { type: 'square', vol: 0.03, filter: 5000 }); }
  sparkle() {
    [1320, 1760, 2640].forEach((f, i) => this.tone(f, 0.18, { type: 'sine', vol: 0.07, delay: i * 0.05 }));
  }
  trip() {
    this.tone(500, 0.3, { type: 'triangle', vol: 0.12, slideTo: 150 });
    this.noise(0.2, { freq: 400, q: 0.8, vol: 0.2, delay: 0.2 });
  }
  ding() {
    this.tone(1568, 1.4, { type: 'sine', vol: 0.18 });
    this.tone(1175, 1.8, { type: 'sine', vol: 0.16, delay: 0.35 });
  }
  clear() {
    const seq = [72, 76, 79, 84, 79, 84, 88];
    seq.forEach((n, i) => this.tone(NOTE(n), i === seq.length - 1 ? 0.8 : 0.16, { type: 'triangle', vol: 0.14, delay: i * 0.1 }));
    [60, 64, 67, 72].forEach((n) => this.tone(NOTE(n), 1.2, { type: 'sine', vol: 0.06, delay: 0.6 }));
  }
  fail() {
    [70, 69, 68, 67].forEach((n, i) => this.tone(NOTE(n - 12), i === 3 ? 1.0 : 0.32, { type: 'sawtooth', vol: 0.1, filter: 900, delay: i * 0.34, vibrato: i === 3 ? 6 : 0 }));
  }
  phone() {
    [0, 0.14].forEach((d) => {
      this.tone(1320, 0.08, { type: 'square', vol: 0.05, filter: 3000, delay: d });
      this.tone(1760, 0.08, { type: 'square', vol: 0.05, filter: 3000, delay: d + 0.04 });
    });
  }
  countdown(last) { this.tone(last ? 1320 : 880, last ? 0.4 : 0.12, { type: 'square', vol: 0.08, filter: 3000 }); }
  /** キャリーケースのガラガラ（big はダッシュ） */
  rattle(big) {
    for (let i = 0; i < (big ? 3 : 2); i++) this.noise(0.07, { freq: 320 + Math.random() * 80, q: 2.5, vol: big ? 0.18 : 0.05, delay: i * 0.08 });
  }
  /** ほかのホームの発車メロディ */
  melody(dur = 3.5) {
    const seq = [76, 79, 84, 83, 79, 76];
    const reps = Math.max(1, Math.floor(dur / (seq.length * 0.28)));
    for (let r = 0; r < reps; r++) seq.forEach((n, i) => this.tone(NOTE(n), 0.26, { type: 'triangle', vol: 0.07, delay: (r * seq.length + i) * 0.28 }));
  }
  door() {
    this.noise(0.12, { freq: 1400, q: 3, vol: 0.18 });
    this.tone(220, 0.1, { type: 'square', vol: 0.06, filter: 1600, delay: 0.05 });
  }

  // --- BGM -----------------------------------------------------------------
  startMusic(style = 'play', tempo = 112) {
    // まだ音を出せない（タップ前）なら、解放されたときに始める
    if (!this.ctx || this.ctx.state !== 'running') this.pending = { style, tempo };
    if (!this.ctx) return;
    this.music = { style, tempo, step: 0, next: this.ctx.currentTime + 0.1 };
  }
  stopMusic() {
    this.music = null;
    this.pending = null;
  }
  setTension(on) {
    this.tension = on;
  }

  schedule() {
    const m = this.music;
    if (!m || !this.ctx) return;
    const c = this.ctx;
    if (m.next < c.currentTime - 0.2) m.next = c.currentTime + 0.05;
    const tempo = m.tempo * (this.tension ? 1.14 : 1);
    const stepDur = 60 / tempo / 4;
    while (m.next < c.currentTime + 0.12) {
      this.playStep(m, m.step, m.next, stepDur);
      m.next += stepDur;
      m.step++;
    }
  }

  playStep(m, step, t, sd) {
    const bar = Math.floor(step / 16);
    const s = step % 16;
    const ch = PROG[bar % PROG.length];
    const B = this.bus;
    const title = m.style === 'title';
    // ベース
    if (s === 0 || s === 8 || (s === 14 && !title)) {
      const n = s === 8 ? ch.root + 7 : s === 14 ? ch.root + 5 : ch.root;
      this.tone(NOTE(n + 12), sd * 3.2, { at: t, type: 'triangle', vol: 0.34, filter: 1400, bus: B });
    }
    // エレピのコード（裏拍）
    if (s === 6 || s === 14 || (title && s === 2)) {
      for (const n of ch.tones) this.tone(NOTE(n), sd * 3, { at: t, type: 'triangle', vol: 0.1, attack: 0.01, filter: 2600, bus: B });
    }
    // マリンバ風アルペジオ
    if (!title && (s % 4 === 0 || s % 4 === 3) && (step * 7) % 5 !== 0) {
      const n = ch.tones[(step * 3 + bar) % 4] + 12;
      this.tone(NOTE(n), sd * 1.6, { at: t, type: 'triangle', vol: 0.16, attack: 0.002, filter: 3200, bus: B });
    }
    if (title && s % 4 === 0 && bar % 2 === 1) {
      this.tone(NOTE(MELODY[(step / 4 + bar) % MELODY.length]), sd * 3, { at: t, type: 'triangle', vol: 0.16, bus: B });
    }
    // リズム
    if (!title) {
      if (s % 2 === 0) this.noise(0.03, { at: t, freq: 8000, ftype: 'highpass', vol: s % 4 === 2 ? 0.12 : 0.06, bus: B });
      if (s === 0 || s === 10) this.tone(110, 0.12, { at: t, type: 'sine', vol: 0.55, slideTo: 45, bus: B });
      if (s === 4 || s === 12) this.noise(0.08, { at: t, freq: 1800, q: 0.9, vol: 0.2, bus: B });
      if (this.tension && s % 4 === 0) this.tone(2400, 0.025, { at: t, type: 'square', vol: 0.05, bus: B });
    } else if (s % 4 === 2) {
      this.noise(0.02, { at: t, freq: 9000, ftype: 'highpass', vol: 0.05, bus: B });
    }
  }
}
