/** キーボード＋タッチ（バーチャルスティック）入力 */
export class Input {
  constructor() {
    this.keys = new Set();
    this.move = { x: 0, y: 0 };
    this.dashQueued = false;
    this.phoneQueued = false;
    this.stick = { active: false, id: null, ox: 0, oy: 0, x: 0, y: 0 };
    this.listeners = { confirm: [], pause: [] };
    this.touch = matchMedia('(pointer: coarse)').matches || 'ontouchstart' in window;

    addEventListener('keydown', (e) => {
      if (e.repeat && (e.code === 'Space' || e.code === 'Enter')) return;
      this.keys.add(e.code);
      if (e.code === 'Space' || e.code === 'ShiftLeft' || e.code === 'ShiftRight' || e.code === 'KeyJ') {
        this.dashQueued = true;
        e.preventDefault();
      }
      if (e.code === 'KeyE' || e.code === 'KeyQ' || e.code === 'KeyK') this.phoneQueued = true;
      if (e.code === 'Enter' || e.code === 'Space') this.emit('confirm', e);
      if (e.code === 'Escape' || e.code === 'KeyP') this.emit('pause', e);
      if (e.code.startsWith('Arrow')) e.preventDefault();
    });
    addEventListener('keyup', (e) => this.keys.delete(e.code));
    addEventListener('blur', () => {
      this.keys.clear();
      this.stick.active = false;
    });

    const zone = document.getElementById('stick-zone');
    const base = document.getElementById('stick-base');
    const knob = document.getElementById('stick-knob');
    const R = 52;
    zone.addEventListener('pointerdown', (e) => {
      if (this.stick.active) return;
      this.touch = true;
      this.stick.active = true;
      this.stick.id = e.pointerId;
      this.stick.ox = e.clientX;
      this.stick.oy = e.clientY;
      this.stick.x = this.stick.y = 0;
      zone.setPointerCapture(e.pointerId);
      base.style.left = `${e.clientX}px`;
      base.style.top = `${e.clientY}px`;
      base.classList.add('on');
      knob.style.transform = 'translate(-50%, -50%)';
    });
    zone.addEventListener('pointermove', (e) => {
      if (!this.stick.active || e.pointerId !== this.stick.id) return;
      let dx = e.clientX - this.stick.ox;
      let dy = e.clientY - this.stick.oy;
      const l = Math.hypot(dx, dy);
      if (l > R) {
        dx = (dx / l) * R;
        dy = (dy / l) * R;
      }
      this.stick.x = dx / R;
      this.stick.y = dy / R;
      knob.style.transform = `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px))`;
    });
    const end = (e) => {
      if (e.pointerId !== this.stick.id) return;
      this.stick.active = false;
      this.stick.x = this.stick.y = 0;
      base.classList.remove('on');
      knob.style.transform = 'translate(-50%, -50%)';
    };
    zone.addEventListener('pointerup', end);
    zone.addEventListener('pointercancel', end);
    document.getElementById('btn-dash').addEventListener('pointerdown', (e) => {
      e.preventDefault();
      this.dashQueued = true;
    });
    document.getElementById('btn-phone').addEventListener('pointerdown', (e) => {
      e.preventDefault();
      this.phoneQueued = true;
    });
  }

  on(name, fn) {
    this.listeners[name].push(fn);
  }
  emit(name, e) {
    for (const fn of this.listeners[name]) fn(e);
  }

  update() {
    let x = 0;
    let y = 0;
    const k = this.keys;
    if (k.has('KeyA') || k.has('ArrowLeft')) x -= 1;
    if (k.has('KeyD') || k.has('ArrowRight')) x += 1;
    if (k.has('KeyW') || k.has('ArrowUp')) y -= 1;
    if (k.has('KeyS') || k.has('ArrowDown')) y += 1;
    if (this.stick.active) {
      const l = Math.hypot(this.stick.x, this.stick.y);
      if (l > 0.18) {
        x = this.stick.x;
        y = this.stick.y;
        const n = Math.min(1, (l - 0.18) / 0.62) / l;
        x *= n;
        y *= n;
      }
    }
    const l = Math.hypot(x, y);
    if (l > 1) {
      x /= l;
      y /= l;
    }
    this.move.x = x;
    this.move.y = y;
  }

  takeDash() {
    const d = this.dashQueued;
    this.dashQueued = false;
    return d;
  }

  takePhone() {
    const p = this.phoneQueued;
    this.phoneQueued = false;
    return p;
  }

  reset() {
    this.dashQueued = false;
    this.phoneQueued = false;
    this.keys.clear();
  }
}
