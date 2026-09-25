import * as THREE from 'three';
import { mulberry32, roundRect } from './util.js';

const JP = '"M PLUS Rounded 1c", "Hiragino Maru Gothic ProN", sans-serif';
const DISPLAY = '"Dela Gothic One", "M PLUS Rounded 1c", sans-serif';

function canvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return [c, c.getContext('2d')];
}
function toTex(c, { srgb = true, repeat = false } = {}) {
  const t = new THREE.CanvasTexture(c);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 8;
  return t;
}

// ---------------------------------------------------------------------------
// モニター画面のアトラス（4x4 セル）
// ---------------------------------------------------------------------------
export const SCREEN_CELLS = 16;
export function screenAtlas() {
  const CW = 256;
  const CH = 160;
  const [c, g] = canvas(CW * 4, CH * 4);
  const rng = mulberry32(7);
  const draws = [
    sheet, slides, mail, code, call, design, chat, dash,
    cal, banner, saver, browser, sheet, design, cal, code,
  ];
  draws.forEach((fn, i) => {
    g.save();
    g.translate((i % 4) * CW, Math.floor(i / 4) * CH);
    g.beginPath();
    g.rect(0, 0, CW, CH);
    g.clip();
    fn(g, CW, CH, rng, i);
    g.restore();
  });
  return toTex(c);
}

function sheet(g, w, h, rng) {
  g.fillStyle = '#ffffff';
  g.fillRect(0, 0, w, h);
  g.fillStyle = '#1f7a4d';
  g.fillRect(0, 0, w, 18);
  g.fillStyle = '#e8f3ec';
  g.fillRect(0, 18, w, 12);
  for (let y = 30; y < h; y += 12) {
    for (let x = 0; x < w; x += 32) {
      const r = rng();
      if (r < 0.12) {
        g.fillStyle = r < 0.05 ? '#ffe28a' : '#cfeedd';
        g.fillRect(x, y, 32, 12);
      }
      if (r > 0.35) {
        g.fillStyle = '#6b7380';
        g.fillRect(x + 4, y + 4, 8 + r * 18, 4);
      }
    }
  }
  g.strokeStyle = '#d9dee4';
  g.lineWidth = 1;
  for (let x = 0; x < w; x += 32) { g.beginPath(); g.moveTo(x + 0.5, 18); g.lineTo(x + 0.5, h); g.stroke(); }
  for (let y = 30; y < h; y += 12) { g.beginPath(); g.moveTo(0, y + 0.5); g.lineTo(w, y + 0.5); g.stroke(); }
}
function slides(g, w, h, rng) {
  g.fillStyle = '#f3ede6';
  g.fillRect(0, 0, w, h);
  g.fillStyle = '#c85a2a';
  g.fillRect(0, 0, w, 16);
  for (let i = 0; i < 4; i++) {
    g.fillStyle = i === 1 ? '#f2a36b' : '#ffffff';
    g.fillRect(6, 24 + i * 32, 44, 26);
  }
  g.fillStyle = '#ffffff';
  g.fillRect(60, 24, 186, 126);
  g.fillStyle = '#1b2340';
  g.fillRect(72, 34, 110, 10);
  const bars = [30, 52, 44, 78, 96];
  bars.forEach((b, i) => {
    g.fillStyle = i === 4 ? '#e0402f' : '#8fa6c9';
    g.fillRect(80 + i * 30, 140 - b, 18, b);
  });
}
function mail(g, w, h, rng) {
  g.fillStyle = '#ffffff';
  g.fillRect(0, 0, w, h);
  g.fillStyle = '#2f6db5';
  g.fillRect(0, 0, 54, h);
  g.fillStyle = '#e9eef6';
  g.fillRect(54, 0, w, 16);
  for (let y = 22; y < h; y += 17) {
    g.fillStyle = rng() < 0.3 ? '#1b2340' : '#8a93a3';
    g.fillRect(62, y, 40 + rng() * 30, 5);
    g.fillStyle = '#b8c0cc';
    g.fillRect(62, y + 8, 120 + rng() * 60, 3);
  }
}
function code(g, w, h, rng) {
  g.fillStyle = '#1d2230';
  g.fillRect(0, 0, w, h);
  const cols = ['#7fd1b9', '#f7b267', '#8fb8ff', '#e98aa7', '#d6dbe6'];
  for (let y = 8; y < h; y += 9) {
    let x = 10 + Math.floor(rng() * 4) * 10;
    const n = 1 + Math.floor(rng() * 4);
    for (let i = 0; i < n; i++) {
      const l = 12 + rng() * 40;
      g.fillStyle = cols[Math.floor(rng() * cols.length)];
      g.fillRect(x, y, l, 4);
      x += l + 6;
    }
  }
}
function call(g, w, h) {
  g.fillStyle = '#202124';
  g.fillRect(0, 0, w, h);
  const cols = ['#4e6e9e', '#9e6e4e', '#5e8e6e', '#8e5e8e'];
  for (let i = 0; i < 4; i++) {
    const x = 8 + (i % 2) * 122;
    const y = 8 + Math.floor(i / 2) * 72;
    g.fillStyle = '#3a3c42';
    g.fillRect(x, y, 116, 66);
    g.fillStyle = cols[i];
    g.beginPath();
    g.arc(x + 58, y + 30, 16, 0, Math.PI * 2);
    g.fill();
    g.fillRect(x + 38, y + 48, 40, 18);
  }
}
function design(g, w, h) {
  g.fillStyle = '#2a2b2f';
  g.fillRect(0, 0, w, h);
  g.fillStyle = '#ffffff';
  g.fillRect(40, 14, 176, 132);
  const grd = g.createLinearGradient(40, 14, 216, 146);
  grd.addColorStop(0, '#ffd84d');
  grd.addColorStop(1, '#ff7a59');
  g.fillStyle = grd;
  g.fillRect(48, 22, 160, 80);
  g.fillStyle = '#1b2340';
  g.font = `900 30px ${DISPLAY}`;
  g.fillText('SALE', 70, 74);
  g.fillStyle = '#e0402f';
  g.beginPath();
  g.arc(180, 120, 16, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = '#3d4250';
  g.fillRect(56, 112, 90, 6);
  g.fillRect(56, 124, 60, 6);
}
function chat(g, w, h, rng) {
  g.fillStyle = '#ffffff';
  g.fillRect(0, 0, w, h);
  g.fillStyle = '#4a2f5e';
  g.fillRect(0, 0, 58, h);
  for (let y = 14, i = 0; y < h - 10; y += 26, i++) {
    const mine = i % 3 === 2;
    g.fillStyle = mine ? '#d7ecff' : '#f0f1f4';
    roundRect(g, mine ? 130 : 66, y, 100 + rng() * 20, 18, 8);
    g.fill();
  }
}
function dash(g, w, h) {
  g.fillStyle = '#f4f6fa';
  g.fillRect(0, 0, w, h);
  for (let i = 0; i < 3; i++) {
    g.fillStyle = '#ffffff';
    g.fillRect(8 + i * 82, 8, 74, 34);
    g.fillStyle = ['#2f6db5', '#1f7a4d', '#e0402f'][i];
    g.fillRect(14 + i * 82, 26, 40, 8);
  }
  g.fillStyle = '#ffffff';
  g.fillRect(8, 50, 240, 102);
  g.strokeStyle = '#2f6db5';
  g.lineWidth = 3;
  g.beginPath();
  const pts = [140, 128, 132, 110, 116, 96, 100, 74, 80, 62];
  pts.forEach((p, i) => (i ? g.lineTo(18 + i * 24, p) : g.moveTo(18, p)));
  g.stroke();
}
function cal(g, w, h, rng) {
  g.fillStyle = '#ffffff';
  g.fillRect(0, 0, w, h);
  g.fillStyle = '#e9eef6';
  g.fillRect(0, 0, w, 16);
  g.strokeStyle = '#e1e5eb';
  for (let x = 30; x < w; x += 45) { g.beginPath(); g.moveTo(x + 0.5, 16); g.lineTo(x + 0.5, h); g.stroke(); }
  const cols = ['#8fb8ff', '#ffd84d', '#f7a1a1', '#9fd9b8'];
  for (let d = 0; d < 5; d++) {
    let y = 20;
    while (y < h - 12) {
      const hh = 14 + Math.floor(rng() * 3) * 10;
      g.fillStyle = cols[Math.floor(rng() * cols.length)];
      g.fillRect(33 + d * 45, y, 40, hh - 2);
      y += hh;
    }
  }
}
function banner(g, w, h) {
  const grd = g.createLinearGradient(0, 0, w, h);
  grd.addColorStop(0, '#1b2340');
  grd.addColorStop(1, '#2f6db5');
  g.fillStyle = grd;
  g.fillRect(0, 0, w, h);
  g.fillStyle = '#ffd84d';
  g.font = `900 46px ${DISPLAY}`;
  g.fillText('50%', 24, 92);
  g.fillStyle = '#ffffff';
  g.font = `800 20px ${JP}`;
  g.fillText('夏のキャンペーン', 26, 128);
}
function saver(g, w, h) {
  const grd = g.createLinearGradient(0, 0, w, h);
  grd.addColorStop(0, '#6a5acd');
  grd.addColorStop(1, '#2fb3c9');
  g.fillStyle = grd;
  g.fillRect(0, 0, w, h);
  g.fillStyle = 'rgba(255,255,255,0.9)';
  g.font = `800 40px ${JP}`;
  g.fillText('12:00', 70, 92);
}
function browser(g, w, h, rng) {
  g.fillStyle = '#ffffff';
  g.fillRect(0, 0, w, h);
  g.fillStyle = '#dfe3e8';
  g.fillRect(0, 0, w, 18);
  g.fillStyle = '#ffffff';
  roundRect(g, 40, 30, 176, 18, 9);
  g.fill();
  g.strokeStyle = '#c5ccd6';
  g.stroke();
  for (let y = 62; y < h; y += 20) {
    g.fillStyle = '#2f6db5';
    g.fillRect(20, y, 90 + rng() * 60, 5);
    g.fillStyle = '#a4acb8';
    g.fillRect(20, y + 9, 170 + rng() * 40, 3);
  }
}

// ---------------------------------------------------------------------------
// 床（カーペットタイル・フローリング・石）＋壁際の擬似AO
// ---------------------------------------------------------------------------
export const FLOOR_STYLES = {
  '.': { base: [129, 141, 158], kind: 'carpet' },
  ';': { base: [146, 152, 130], kind: 'carpet' },
  ',': { base: [201, 161, 118], kind: 'wood' },
  ':': { base: [216, 210, 200], kind: 'stone' },
  '_': { base: [196, 190, 180], kind: 'paver' },
  '=': { base: [74, 78, 88], kind: 'road' },
  'z': { base: [74, 78, 88], kind: 'cross' },
};

export function floorTexture(grid, floorType, aoTiles) {
  const S = 48;
  const [c, g] = canvas(grid.w * S, grid.h * S);
  const rng = mulberry32(99 + grid.w * 7 + grid.h);
  for (let y = 0; y < grid.h; y++) {
    for (let x = 0; x < grid.w; x++) {
      const type = floorType[y * grid.w + x];
      const st = FLOOR_STYLES[type] || FLOOR_STYLES['.'];
      const px = x * S;
      const py = y * S;
      const j = (rng() - 0.5) * 10;
      const [r, gg, b] = st.base;
      if (st.kind === 'carpet') {
        g.fillStyle = `rgb(${r + j},${gg + j},${b + j})`;
        g.fillRect(px, py, S, S);
        // タイルカーペットの市松（毛並みの向き違い）
        const vertical = (x + y) % 2 === 0;
        for (let i = 2; i < S; i += 4) {
          g.fillStyle = `rgba(255,255,255,${0.035 + rng() * 0.03})`;
          if (vertical) g.fillRect(px + i, py, 1.5, S);
          else g.fillRect(px, py + i, S, 1.5);
        }
        for (let i = 0; i < 26; i++) {
          g.fillStyle = `rgba(${rng() < 0.5 ? '0,0,0' : '255,255,255'},0.06)`;
          g.fillRect(px + rng() * S, py + rng() * S, 2, 2);
        }
        g.strokeStyle = 'rgba(0,0,0,0.07)';
        g.lineWidth = 1;
        g.strokeRect(px + 0.5, py + 0.5, S - 1, S - 1);
      } else if (st.kind === 'paver') {
        // 歩道のインターロッキング
        const q = S / 4;
        for (let k = 0; k < 16; k++) {
          const v = (rng() - 0.5) * 18;
          const tone = (k + y) % 3 === 0 ? -14 : 0;
          g.fillStyle = `rgb(${r + v + tone},${gg + v + tone},${b + v + tone})`;
          g.fillRect(px + (k % 4) * q, py + Math.floor(k / 4) * q, q, q);
        }
        g.strokeStyle = 'rgba(90,85,78,0.35)';
        g.lineWidth = 1;
        for (let k = 0; k <= 4; k++) {
          g.beginPath(); g.moveTo(px + k * q, py); g.lineTo(px + k * q, py + S); g.stroke();
          g.beginPath(); g.moveTo(px, py + k * q); g.lineTo(px + S, py + k * q); g.stroke();
        }
      } else if (st.kind === 'road' || st.kind === 'cross') {
        g.fillStyle = `rgb(${r + j * 0.5},${gg + j * 0.5},${b + j * 0.5})`;
        g.fillRect(px, py, S, S);
        for (let i = 0; i < 40; i++) {
          g.fillStyle = `rgba(${rng() < 0.5 ? '0,0,0' : '255,255,255'},0.07)`;
          g.fillRect(px + rng() * S, py + rng() * S, 2, 2);
        }
        const roadAt = (dx, dy) => '=z'.includes(grid.at(x + dx, y + dy));
        if (st.kind === 'cross') {
          g.fillStyle = 'rgba(245,245,240,0.92)';
          if (roadAt(-1, 0) || roadAt(1, 0)) for (let k = 0; k < 2; k++) g.fillRect(px + 4 + k * (S / 2), py + 2, S / 2 - 8, S - 4);
          else for (let k = 0; k < 2; k++) g.fillRect(px + 2, py + 4 + k * (S / 2), S - 4, S / 2 - 8);
        } else if (roadAt(0, -1) && !roadAt(0, 1)) {
          // 車線の区切り（破線）
          g.fillStyle = 'rgba(240,240,235,0.85)';
          if (x % 2 === 0) g.fillRect(px + 6, py + S - 3, S - 12, 3);
        } else if (!roadAt(0, -1) || !roadAt(0, 1)) {
          g.fillStyle = 'rgba(240,240,235,0.6)';
          g.fillRect(px, roadAt(0, -1) ? py + S - 6 : py + 3, S, 2);
        }
      } else if (st.kind === 'wood') {
        const plank = S / 4;
        for (let k = 0; k < 4; k++) {
          const v = (rng() - 0.5) * 22;
          g.fillStyle = `rgb(${r + v},${gg + v * 0.8},${b + v * 0.6})`;
          g.fillRect(px, py + k * plank, S, plank);
          g.fillStyle = 'rgba(80,45,20,0.10)';
          for (let q = 0; q < 3; q++) g.fillRect(px, py + k * plank + 2 + rng() * (plank - 4), S, 1);
          g.fillStyle = 'rgba(60,35,15,0.35)';
          g.fillRect(px, py + k * plank, S, 1);
          if (rng() < 0.4) g.fillRect(px + Math.floor(rng() * S), py + k * plank, 1, plank);
        }
      } else {
        const half = S / 2;
        for (let k = 0; k < 4; k++) {
          const v = (rng() - 0.5) * 12;
          g.fillStyle = `rgb(${r + v},${gg + v},${b + v})`;
          g.fillRect(px + (k % 2) * half, py + Math.floor(k / 2) * half, half, half);
          g.fillStyle = 'rgba(255,255,255,0.25)';
          g.fillRect(px + (k % 2) * half + 3, py + Math.floor(k / 2) * half + 3, half * 0.4, 1);
        }
        g.strokeStyle = 'rgba(120,112,100,0.45)';
        g.lineWidth = 1.5;
        g.beginPath();
        g.moveTo(px, py + half); g.lineTo(px + S, py + half);
        g.moveTo(px + half, py); g.lineTo(px + half, py + S);
        g.stroke();
      }
    }
  }
  // 壁際を少し暗くする
  const R = S * 0.42;
  for (let y = 0; y < grid.h; y++) {
    for (let x = 0; x < grid.w; x++) {
      if (!aoTiles(x, y)) continue;
      const px = x * S;
      const py = y * S;
      const sides = [
        [0, -1, px, py - R, px, py, 0, 1],
        [0, 1, px, py + S + R, px, py + S, 0, -1],
        [-1, 0, px - R, py, px, py, 1, 0],
        [1, 0, px + S + R, py, px + S, py, -1, 0],
      ];
      for (const [dx, dy, x0, y0, x1, y1] of sides) {
        if (!grid.isWalk(x + dx, y + dy)) continue;
        const grd = g.createLinearGradient(x1, y1, x0, y0);
        grd.addColorStop(0, 'rgba(10,15,30,0.34)');
        grd.addColorStop(1, 'rgba(10,15,30,0)');
        g.fillStyle = grd;
        if (dx === 0) g.fillRect(px, Math.min(y0, y1), S, R);
        else g.fillRect(Math.min(x0, x1), py, R, S);
      }
    }
  }
  return toTex(c);
}

// ---------------------------------------------------------------------------
// 窓の外（空と街並み）
// ---------------------------------------------------------------------------
export function cityTexture(preset) {
  const [c, g] = canvas(2048, 768);
  const sky = g.createLinearGradient(0, 0, 0, 768);
  sky.addColorStop(0, preset.cityTop);
  sky.addColorStop(0.55, preset.cityMid);
  sky.addColorStop(1, preset.cityBottom);
  g.fillStyle = sky;
  g.fillRect(0, 0, 2048, 768);
  const rng = mulberry32(5);
  if (preset.sunDisc) {
    const [sx, sy, sr, col] = preset.sunDisc;
    const glow = g.createRadialGradient(sx, sy, 0, sx, sy, sr * 5);
    glow.addColorStop(0, col);
    glow.addColorStop(1, 'rgba(255,200,150,0)');
    g.fillStyle = glow;
    g.fillRect(0, 0, 2048, 768);
    g.fillStyle = '#fff4df';
    g.beginPath();
    g.arc(sx, sy, sr, 0, Math.PI * 2);
    g.fill();
  }
  // 雲
  for (let i = 0; i < 9; i++) {
    g.fillStyle = preset.cloud;
    const x = rng() * 2048;
    const y = 60 + rng() * 180;
    for (let k = 0; k < 5; k++) {
      g.beginPath();
      g.ellipse(x + k * 34, y + Math.sin(k) * 8, 60, 22, 0, 0, Math.PI * 2);
      g.fill();
    }
  }
  const layers = [
    { col: preset.far, top: 330, h: [60, 200], win: 0.0 },
    { col: preset.mid, top: 400, h: [80, 260], win: preset.windows * 0.6 },
    { col: preset.near, top: 470, h: [120, 300], win: preset.windows },
  ];
  for (const L of layers) {
    let x = -20;
    while (x < 2048) {
      const bw = 60 + rng() * 130;
      const bh = L.h[0] + rng() * (L.h[1] - L.h[0]);
      const top = L.top + 200 - bh;
      g.fillStyle = L.col;
      g.fillRect(x, top, bw, 768 - top);
      if (rng() < 0.3) g.fillRect(x + bw * 0.4, top - 30, 6, 30);
      if (L.win > 0) {
        for (let wy = top + 12; wy < 768; wy += 18) {
          for (let wx = x + 8; wx < x + bw - 10; wx += 14) {
            if (rng() < L.win) {
              g.fillStyle = preset.windowColor;
              g.fillRect(wx, wy, 7, 9);
            }
          }
        }
      }
      x += bw + 4 + rng() * 16;
    }
  }
  return toTex(c);
}

export function gradientBackground(top, bottom) {
  const [c, g] = canvas(4, 256);
  const grd = g.createLinearGradient(0, 0, 0, 256);
  grd.addColorStop(0, top);
  grd.addColorStop(1, bottom);
  g.fillStyle = grd;
  g.fillRect(0, 0, 4, 256);
  return toTex(c);
}

// ---------------------------------------------------------------------------
// 小物テクスチャ
// ---------------------------------------------------------------------------
export function vendingTexture(kind = 0) {
  const [c, g] = canvas(256, 512);
  g.fillStyle = kind ? '#2f6db5' : '#d8423a';
  g.fillRect(0, 0, 256, 512);
  g.fillStyle = '#ffffff';
  g.font = `900 30px ${DISPLAY}`;
  g.textAlign = 'center';
  g.fillText(kind ? 'COFFEE' : 'DRINK', 128, 44);
  g.fillStyle = '#f4f7fb';
  roundRect(g, 18, 62, 220, 250, 10);
  g.fill();
  const cols = ['#e0402f', '#2f6db5', '#ffd84d', '#3aa56c', '#8a5a3a', '#f28ab2', '#ffffff', '#1b2340'];
  const rng = mulberry32(kind + 3);
  for (let r = 0; r < 4; r++) {
    for (let k = 0; k < 5; k++) {
      const x = 30 + k * 42;
      const y = 74 + r * 60;
      g.fillStyle = cols[Math.floor(rng() * cols.length)];
      roundRect(g, x, y, 28, 42, 6);
      g.fill();
      g.fillStyle = 'rgba(255,255,255,0.5)';
      g.fillRect(x + 5, y + 5, 4, 30);
      g.fillStyle = '#c9ced6';
      g.fillRect(x + 4, y + 48, 20, 4);
    }
  }
  g.fillStyle = '#1b1f2a';
  roundRect(g, 150, 330, 80, 60, 6);
  g.fill();
  g.fillStyle = '#7ef0b0';
  g.font = `700 20px ${JP}`;
  g.fillText('¥130', 190, 368);
  g.fillStyle = '#12151c';
  roundRect(g, 30, 420, 196, 60, 8);
  g.fill();
  return toTex(c);
}

export function whiteboardTexture(seed = 1) {
  const [c, g] = canvas(512, 256);
  g.fillStyle = '#fbfcfd';
  g.fillRect(0, 0, 512, 256);
  g.strokeStyle = '#2458a6';
  g.fillStyle = '#2458a6';
  g.lineWidth = 3;
  g.font = `800 30px ${JP}`;
  g.fillText(seed % 2 ? 'ブレスト！夏キャンペーン' : '今期KPI  売上↑ 認知↑', 22, 44);
  g.lineCap = 'round';
  g.beginPath();
  g.moveTo(22, 58); g.lineTo(330, 60);
  g.stroke();
  g.strokeStyle = '#d13b30';
  g.beginPath();
  g.ellipse(390, 130, 70, 40, -0.1, 0, Math.PI * 2);
  g.stroke();
  g.fillStyle = '#d13b30';
  g.font = `800 26px ${JP}`;
  g.fillText('バズ', 360, 140);
  g.strokeStyle = '#1b1b1b';
  g.lineWidth = 2.5;
  for (let i = 0; i < 4; i++) {
    g.beginPath();
    g.moveTo(34, 92 + i * 34);
    g.lineTo(60 + ((i * 53) % 140) + 110, 92 + i * 34);
    g.stroke();
  }
  g.beginPath();
  g.moveTo(250, 170); g.lineTo(318, 140); g.lineTo(306, 158); g.moveTo(318, 140); g.lineTo(298, 138);
  g.stroke();
  const notes = ['#ffe26a', '#ffb3c7', '#b8e4ff', '#ffe26a'];
  notes.forEach((col, i) => {
    g.fillStyle = col;
    g.fillRect(40 + i * 62, 196, 50, 46);
    g.fillStyle = 'rgba(0,0,0,0.35)';
    g.fillRect(46 + i * 62, 208, 36, 3);
    g.fillRect(46 + i * 62, 218, 28, 3);
  });
  return toTex(c);
}

export function posterTexture(kind) {
  const [c, g] = canvas(256, 360);
  g.textAlign = 'center';
  if (kind === 0) {
    g.fillStyle = '#16181f';
    g.fillRect(0, 0, 256, 360);
    g.strokeStyle = '#d4af37';
    g.lineWidth = 4;
    g.strokeRect(14, 14, 228, 332);
    g.fillStyle = '#d4af37';
    g.font = `900 34px ${DISPLAY}`;
    g.fillText('GOLD', 128, 150);
    g.font = `700 20px ${JP}`;
    g.fillText('広告賞 2026', 128, 190);
    g.beginPath();
    g.arc(128, 262, 34, 0, Math.PI * 2);
    g.fill();
  } else if (kind === 1) {
    const grd = g.createLinearGradient(0, 0, 0, 360);
    grd.addColorStop(0, '#5bc0eb');
    grd.addColorStop(1, '#2f6db5');
    g.fillStyle = grd;
    g.fillRect(0, 0, 256, 360);
    g.fillStyle = '#ffffff';
    g.font = `900 38px ${DISPLAY}`;
    g.fillText('夏を、', 128, 90);
    g.fillText('飲みほせ。', 128, 136);
    g.fillStyle = '#ffd84d';
    roundRect(g, 104, 170, 48, 150, 18);
    g.fill();
  } else if (kind === 2) {
    g.fillStyle = '#ffd84d';
    g.fillRect(0, 0, 256, 360);
    g.fillStyle = '#1b2340';
    g.font = `900 40px ${DISPLAY}`;
    g.fillText('〆切は、', 128, 150);
    g.fillText('守るもの。', 128, 200);
    g.font = `700 16px ${JP}`;
    g.fillText('社内標語 第12回 最優秀', 128, 300);
  } else {
    g.fillStyle = '#f4efe9';
    g.fillRect(0, 0, 256, 360);
    g.fillStyle = '#e0402f';
    g.beginPath();
    g.arc(128, 150, 80, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = '#1b2340';
    g.font = `900 30px ${DISPLAY}`;
    g.fillText('THINK', 128, 290);
    g.fillText('BIG.', 128, 326);
  }
  return toTex(c);
}

export function clockTexture() {
  const [c, g] = canvas(256, 256);
  g.fillStyle = '#ffffff';
  g.beginPath();
  g.arc(128, 128, 124, 0, Math.PI * 2);
  g.fill();
  g.lineWidth = 10;
  g.strokeStyle = '#1b2340';
  g.stroke();
  g.fillStyle = '#1b2340';
  g.font = `800 30px ${JP}`;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  for (let i = 1; i <= 12; i++) {
    const a = (i / 12) * Math.PI * 2;
    g.fillText(String(i), 128 + Math.sin(a) * 92, 128 - Math.cos(a) * 92);
  }
  for (let i = 0; i < 60; i++) {
    const a = (i / 60) * Math.PI * 2;
    const r0 = i % 5 === 0 ? 108 : 113;
    g.lineWidth = i % 5 === 0 ? 4 : 2;
    g.beginPath();
    g.moveTo(128 + Math.sin(a) * r0, 128 - Math.cos(a) * r0);
    g.lineTo(128 + Math.sin(a) * 118, 128 - Math.cos(a) * 118);
    g.stroke();
  }
  return toTex(c);
}

/** 動く歩道の踏み板（1m で1模様。offset を動かして流す） */
export function beltTexture() {
  const [c, g] = canvas(64, 64);
  g.fillStyle = '#3a3e46';
  g.fillRect(0, 0, 64, 64);
  g.fillStyle = 'rgba(0,0,0,0.35)';
  for (let y = 4; y < 64; y += 6) g.fillRect(0, y, 64, 2);
  g.fillStyle = 'rgba(255,255,255,0.08)';
  for (let y = 6; y < 64; y += 6) g.fillRect(0, y, 64, 1);
  g.fillStyle = 'rgba(0,0,0,0.45)';
  g.fillRect(62, 0, 2, 64);
  g.strokeStyle = '#e8edf3';
  g.lineWidth = 7;
  g.lineCap = 'round';
  g.lineJoin = 'round';
  g.beginPath();
  g.moveTo(22, 16);
  g.lineTo(40, 32);
  g.lineTo(22, 48);
  g.stroke();
  return toTex(c, { repeat: true });
}

export function beamTexture() {
  const [c, g] = canvas(4, 128);
  const grd = g.createLinearGradient(0, 0, 0, 128);
  grd.addColorStop(0, 'rgba(255,255,255,0)');
  grd.addColorStop(0.7, 'rgba(255,255,255,0.35)');
  grd.addColorStop(1, 'rgba(255,255,255,0.9)');
  g.fillStyle = grd;
  g.fillRect(0, 0, 4, 128);
  return toTex(c, { srgb: false });
}

export function softDisc() {
  const [c, g] = canvas(64, 64);
  const grd = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grd.addColorStop(0, 'rgba(0,0,0,0.55)');
  grd.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = grd;
  g.fillRect(0, 0, 64, 64);
  return toTex(c, { srgb: false });
}
