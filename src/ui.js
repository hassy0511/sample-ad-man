import * as THREE from 'three';
import { CAST } from './cast.js';
import { fmtClock } from './util.js';

const $ = (id) => document.getElementById(id);
const _v = new THREE.Vector3();

/** DOM の画面・HUD・吹き出しを管理する */
export class UI {
  constructor(game) {
    this.game = game;
    this.layer = $('world-ui');
    this.anchored = [];
    this.portraits = {};
    this.dialogueOpen = false;
    this.buildDial();
  }

  buildDial() {
    const g = $('dial-ticks');
    let s = '';
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * Math.PI * 2;
      const r0 = i % 3 === 0 ? 22 : 24.5;
      s += `<line x1="${32 + Math.sin(a) * r0}" y1="${32 - Math.cos(a) * r0}" x2="${32 + Math.sin(a) * 27}" y2="${32 - Math.cos(a) * 27}"/>`;
    }
    g.innerHTML = s;
  }

  show(id) {
    for (const s of ['screen-title', 'screen-intro', 'screen-result', 'screen-pause', 'screen-book']) $(s).hidden = s !== id;
  }

  setTouch(on) {
    document.documentElement.classList.toggle('is-touch', on);
  }

  setMuted(m) {
    document.documentElement.classList.toggle('muted', m);
  }

  loaded() {
    $('loading').classList.add('done');
  }
  loading(on) {
    $('loading').classList.toggle('done', !on);
  }

  // --- タイトル -------------------------------------------------------------
  title(stages, chapters, current, best, onChapter, onPick) {
    const tabs = $('chapter-tabs');
    const wrap = $('stage-notes');
    const render = (ch) => {
      tabs.innerHTML = '';
      for (const c of chapters) {
        const t = document.createElement('button');
        t.type = 'button';
        t.className = `chapter-tab${c.id === ch ? ' on' : ''}`;
        t.setAttribute('role', 'tab');
        t.setAttribute('aria-selected', String(c.id === ch));
        t.innerHTML = `<small>第${c.id}章</small>${c.title}`;
        t.addEventListener('click', () => {
          if (c.id === ch) return;
          this.game.audio.click();
          onChapter(c.id);
          render(c.id);
        });
        tabs.appendChild(t);
      }
      wrap.innerHTML = '';
      stages.forEach((st, i) => {
        if (st.chapter !== ch) return;
        const b = document.createElement('button');
        b.className = 'note';
        b.type = 'button';
        b.id = `stage-note-${st.id}`;
        b.innerHTML = `
          <span class="note-time">${fmtClock(st.start)}</span>
          <span class="note-period">${st.label}・${st.period}</span>
          <span class="note-title">${st.title}</span>
          <span class="note-meta">締切 ${fmtClock(st.deadline)}</span>
          ${best[st.id] ? `<span class="note-rank stamp">${best[st.id]}</span>` : ''}`;
        b.addEventListener('click', () => onPick(i));
        wrap.appendChild(b);
      });
    };
    render(current);
    const list = $('suspect-list');
    list.innerHTML = '';
    for (const [key, c] of Object.entries(CAST)) {
      const li = document.createElement('li');
      const known = !!this.game.stats?.met[key];
      li.innerHTML = known
        ? `<img src="${this.portraits[key] || ''}" alt="" style="--c:${c.tint}33"><span>${c.nick}</span>`
        : `<img src="${this.portraits[key] || ''}" alt="" class="silhouette"><span>？？？</span>`;
      list.appendChild(li);
    }
    this.show('screen-title');
    setTimeout(() => wrap.querySelector('.note')?.focus({ preventScroll: true }), 50);
  }

  // --- 社員名簿 -------------------------------------------------------------
  book(stats, onClose) {
    const ul = $('book-list');
    ul.innerHTML = '';
    const entries = Object.entries(CAST);
    let met = 0;
    for (const [key, c] of entries) {
      const known = !!stats.met[key];
      if (known) met++;
      const li = document.createElement('li');
      li.className = `book-card${known ? '' : ' unknown'}`;
      const dots = Array.from({ length: 5 }, (_, i) => `<i class="${i < c.power ? 'on' : ''}"></i>`).join('');
      li.innerHTML = known ? `
        <img src="${this.portraits[key] || ''}" alt="" style="--c:${c.tint}33">
        <div class="bk-main">
          <b>${c.nick}</b>
          <small>${c.role}　${c.name}</small>
          <span class="danger" aria-label="危険度${c.power}">${dots}</span>
        </div>
        <p>${c.trait}</p>
        <dl class="bk-stats">
          <div><dt>捕まった</dt><dd>${stats.caught[key] || 0}回</dd></div>
          <div><dt>かわした</dt><dd>${stats.dodged[key] || 0}回</dd></div>
        </dl>` : `
        <img src="${this.portraits[key] || ''}" alt="" class="silhouette">
        <div class="bk-main"><b>？？？</b><small>まだ会っていない</small></div>
        <p>どこかのフロアにいるらしい。</p>`;
      ul.appendChild(li);
    }
    $('book-progress').textContent = `${entries.length}人中 ${met}人と遭遇`;
    $('btn-book-close').onclick = onClose;
    this.show('screen-book');
    setTimeout(() => $('btn-book-close').focus({ preventScroll: true }), 50);
  }

  // --- ステージ説明 ---------------------------------------------------------
  intro(stage, types, onGo, onBack) {
    $('intro-stage').textContent = `${stage.label} ・ ${stage.period} ${fmtClock(stage.start)}`;
    $('intro-title').textContent = stage.title;
    $('intro-brief').textContent = stage.brief;
    $('intro-story').textContent = stage.story || '';
    $('intro-story').hidden = !stage.story;
    $('intro-deadline').textContent = fmtClock(stage.deadline);
    $('intro-goal').textContent = stage.goalLabel;
    $('intro-budget').textContent = `${stage.deadline - stage.start}分`;
    const ul = $('intro-cast');
    ul.innerHTML = '';
    for (const t of types) {
      const c = CAST[t];
      const li = document.createElement('li');
      li.className = `cast-card${t === 'keiri' ? ' boss-card' : ''}`;
      const dots = Array.from({ length: 5 }, (_, i) => `<i class="${i < c.power ? 'on' : ''}"></i>`).join('');
      li.innerHTML = `
        <img src="${this.portraits[t] || ''}" alt="" style="--c:${c.tint}33">
        <b>${c.nick}</b>
        <small>${c.role}　${c.name}</small>
        <span class="danger" aria-label="危険度${c.power}">${dots}</span>
        <p>${c.trait}</p>`;
      ul.appendChild(li);
    }
    $('btn-go').onclick = onGo;
    $('btn-intro-back').onclick = onBack;
    this.show('screen-intro');
    setTimeout(() => $('btn-go').focus({ preventScroll: true }), 50);
  }

  // --- HUD -----------------------------------------------------------------
  hud(on, stage) {
    $('hud').hidden = !on;
    $('touch-ui').hidden = !(on && this.game.input.touch);
    if (stage) {
      $('hud-label').textContent = `${stage.label}・${stage.period}`;
      $('hud-title').textContent = stage.title;
      $('hud-deadline').textContent = fmtClock(stage.deadline);
      $('gp-label').textContent = stage.goalLabel;
      $('hud-rally').hidden = !stage.rally;
      const a = ((stage.deadline % 60) / 60) * Math.PI * 2;
      $('dial-deadline').setAttribute('cx', 32 + Math.sin(a) * 25);
      $('dial-deadline').setAttribute('cy', 32 - Math.cos(a) * 25);
      $('dash-hint').classList.remove('fade');
      clearTimeout(this.hintTimer);
      this.hintTimer = setTimeout(() => $('dash-hint').classList.add('fade'), 7000);
    }
  }

  updateHud(clock, stage, papers, dashCd, penalty) {
    $('hud-now').textContent = fmtClock(Math.min(clock, stage.deadline));
    const total = stage.deadline - stage.start;
    const left = Math.max(0, stage.deadline - clock);
    $('hud-bar').style.width = `${(left / total) * 100}%`;
    const clockEl = $('hud-clock');
    clockEl.classList.toggle('low', left <= 10);
    clockEl.classList.toggle('penalty', !!penalty);
    const m = clock % 60;
    const h = (clock / 60) % 12;
    const setHand = (id, frac, len) => {
      const a = frac * Math.PI * 2;
      const el = $(id);
      el.setAttribute('x2', 32 + Math.sin(a) * len);
      el.setAttribute('y2', 32 - Math.cos(a) * len);
    };
    setHand('dial-min', m / 60, 22);
    setHand('dial-hour', h / 12, 14);
    if (this.lastPapers !== papers) {
      const chip = $('hud-papers');
      $('hud-papers-n').textContent = papers;
      chip.classList.toggle('heavy', papers >= 3);
      chip.classList.remove('bump');
      void chip.offsetWidth;
      chip.classList.add('bump');
      this.lastPapers = papers;
    }
    $('btn-dash').style.setProperty('--cd', dashCd.toFixed(3));
  }

  setRally(rally, idx, label) {
    const el = $('hud-rally');
    el.innerHTML = rally.map((r, i) => `<span class="rs${i < idx ? ' on' : ''}${i === idx ? ' next' : ''}"><i>${i < idx ? '印' : ''}</i>${r.label}</span>`).join('');
    $('gp-label').textContent = label;
  }

  goalPointer(camera, goal, show) {
    const el = $('goal-pointer');
    if (!show) {
      el.style.display = 'none';
      return;
    }
    _v.set(goal.x, 1.6, goal.z).project(camera);
    const W = innerWidth;
    const H = innerHeight;
    let x = ((_v.x + 1) / 2) * W;
    let y = ((1 - _v.y) / 2) * H;
    const behind = _v.z > 1;
    const margin = 70;
    const on = !behind && x > margin && x < W - margin && y > margin + 60 && y < H - margin;
    el.style.display = 'flex';
    if (on) {
      el.style.transform = `translate(${x}px, ${y - 40}px) translate(-50%, -100%)`;
      el.querySelector('.gp-arrow').style.transform = 'rotate(90deg)';
    } else {
      const cx = W / 2;
      const cy = H / 2;
      let dx = x - cx;
      let dy = y - cy;
      if (behind) {
        dx = -dx;
        dy = -dy;
      }
      const sx = (W / 2 - margin) / Math.abs(dx || 1);
      const sy = (H / 2 - margin - 30) / Math.abs(dy || 1);
      const s = Math.min(sx, sy);
      x = cx + dx * s;
      y = cy + dy * s + 15;
      el.style.transform = `translate(${x}px, ${y}px) translate(-50%, -50%)`;
      el.querySelector('.gp-arrow').style.transform = `rotate(${Math.atan2(dy, dx)}rad)`;
    }
  }

  // --- ワールド上の吹き出し ------------------------------------------------
  bubble(entity, text, style = '', dur = 1.6) {
    const old = this.anchored.find((a) => a.entity === entity && a.kind === 'bubble');
    if (old) this.remove(old);
    const el = document.createElement('div');
    el.className = `bubble ${style}`;
    el.innerHTML = `<span class="in"></span>`;
    el.firstChild.textContent = text;
    this.layer.appendChild(el);
    this.anchored.push({ el, entity, kind: 'bubble', t: 0, dur, y: 2.05 });
  }

  emote(entity, text) {
    const el = document.createElement('div');
    el.className = 'emote';
    el.innerHTML = `<span class="in"></span>`;
    el.firstChild.textContent = text;
    this.layer.appendChild(el);
    this.anchored.push({ el, entity, kind: 'emote', t: 0, dur: 0.9, y: 2.9 });
  }

  float(x, y, z, text, cls = '') {
    const el = document.createElement('div');
    el.className = `float ${cls}`;
    el.textContent = text;
    this.layer.appendChild(el);
    this.anchored.push({ el, pos: new THREE.Vector3(x, y, z), kind: 'float', t: 0, dur: 1.2 });
  }

  toast(text, cls = '') {
    const el = $('toast');
    el.className = cls;
    el.textContent = text;
    void el.offsetWidth;
    el.classList.add('show');
  }

  flash(color) {
    const el = $('flash');
    el.style.background = color;
    el.classList.remove('go');
    void el.offsetWidth;
    el.classList.add('go');
  }

  aura(level) {
    $('aura').style.opacity = level.toFixed(3);
  }

  remove(a) {
    a.el.remove();
    a.dead = true;
  }

  clearWorld() {
    for (const a of this.anchored) a.el.remove();
    this.anchored = [];
  }

  update(dt, camera) {
    const W = innerWidth;
    const H = innerHeight;
    for (const a of this.anchored) {
      if (a.dead) continue;
      a.t += dt;
      if (a.t > a.dur) {
        this.remove(a);
        continue;
      }
      let yOff = 0;
      if (a.entity) {
        const p = a.entity.pos;
        const extra = a.entity.char?.stack ? a.entity.char.stack.children.length * 0.05 : 0;
        _v.set(p.x, a.y + extra, p.z);
      } else {
        _v.copy(a.pos);
        yOff = -a.t * 50;
      }
      _v.project(camera);
      if (_v.z > 1) {
        a.el.style.display = 'none';
        continue;
      }
      a.el.style.display = '';
      const x = ((_v.x + 1) / 2) * W;
      const y = ((1 - _v.y) / 2) * H + yOff;
      const fade = a.kind === 'float' ? Math.min(1, (a.dur - a.t) / 0.4) : Math.min(1, (a.dur - a.t) / 0.25);
      a.el.style.opacity = fade.toFixed(2);
      const base = a.kind === 'float' ? 'translate(-50%, -50%)' : 'translate(-50%, -100%)';
      a.el.style.transform = `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px) ${base}`;
    }
    this.anchored = this.anchored.filter((a) => !a.dead);
  }

  // --- 会話 -----------------------------------------------------------------
  openDialogue(who, portrait, tint) {
    const d = $('dialogue');
    d.hidden = false;
    d.querySelector('.dlg-card').style.setProperty('--c', tint);
    $('dlg-img').src = portrait || '';
    $('dlg-img').style.setProperty('--c', `${tint}40`);
    $('dlg-nick').textContent = who.nick || who.role;
    $('dlg-name').textContent = `${who.role}　${who.name}`;
    $('dlg-text').textContent = '';
    $('dlg-stamp').className = 'stamp';
    $('dlg-stamp').innerHTML = '';
    this.dialogueOpen = true;
    // カードを作り直してアニメーションを再生
    const card = d.querySelector('.dlg-card');
    card.style.animation = 'none';
    void card.offsetWidth;
    card.style.animation = '';
  }

  dialogueText(text) {
    $('dlg-text').textContent = text;
  }

  dialogueStamp(big, small) {
    const s = $('dlg-stamp');
    s.innerHTML = `<span><big>${big}</big>${small || ''}</span>`;
    s.className = 'stamp';
    void s.offsetWidth;
    s.classList.add('on');
  }

  closeDialogue() {
    $('dialogue').hidden = true;
    this.dialogueOpen = false;
  }

  // --- 結果 -----------------------------------------------------------------
  result(data, handlers) {
    const { stage, success } = data;
    $('rp-stage').textContent = `${stage.label}・${stage.period}　${stage.title}`;
    $('rp-title').textContent = success ? stage.goalDone : stage.failTitle;
    $('rp-arrive-label').textContent = success ? '到着時刻' : '時刻';
    $('rp-arrive').textContent = fmtClock(data.arrive);
    $('rp-left-label').textContent = stage.id === 2 ? 'ランチの時間' : '残り時間';
    $('rp-left').textContent = success ? `${data.left}分` : '0分';
    $('rp-caught').textContent = `${data.caught}回`;
    $('rp-papers').textContent = `${data.papers}束`;
    $('rp-dodge').textContent = `${data.dodges}回`;
    $('rp-comment').textContent = success ? data.comment : stage.failText;
    const rank = $('rp-rank');
    rank.className = `rank-stamp${success ? '' : ' fail'}`;
    rank.innerHTML = success ? `${data.rank}<small>スルー力</small>` : '時間切れ';
    rank.style.visibility = 'hidden';
    const hk = [$('hk1'), $('hk2'), $('hk3')];
    const texts = success ? ['滑川', data.rank === 'C' ? '渋々' : '確認', data.rank === 'S' ? '絶賛' : '承認'] : ['滑川', '', ''];
    hk.forEach((h) => {
      h.className = '';
      h.removeAttribute('data-t');
    });
    const seq = [];
    hk.forEach((h, i) => {
      if (!texts[i]) return;
      seq.push(() => {
        h.dataset.t = texts[i];
        h.className = 'on';
        this.game.audio.stamp();
      });
    });
    seq.push(() => {
      rank.style.visibility = 'visible';
      rank.style.animation = 'none';
      void rank.offsetWidth;
      rank.style.animation = '';
      this.game.audio.stamp();
    });
    seq.forEach((fn, i) => setTimeout(fn, 450 + i * 330));

    const next = $('btn-next');
    next.hidden = !success;
    next.textContent = data.last ? 'エンディングへ' : '次の業務へ';
    next.onclick = handlers.next;
    $('btn-retry').onclick = handlers.retry;
    $('btn-title').onclick = handlers.title;
    this.show('screen-result');
    setTimeout(() => (success ? next : $('btn-retry')).focus({ preventScroll: true }), 60);
  }
}

