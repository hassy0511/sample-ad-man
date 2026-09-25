import * as THREE from 'three';

// 拾ってカバンに入れておき、好きなときに使うアイテム
export const ITEMS = {
  energy: {
    name: 'エナジードリンク',
    short: 'エナドリ',
    desc: '8秒間、足が速くなり、ダッシュもすぐ回復する。',
    color: '#2f6db5',
  },
  umbrella: {
    name: '折りたたみ傘',
    short: '傘',
    desc: '5秒間、傘で顔を隠して誰にも気づかれない（少し遅くなる）。',
    color: '#e0402f',
  },
  omiyage: {
    name: '菓子折り',
    short: '菓子折り',
    desc: '持っているだけでOK。次に捕まったとき「お、気が利くね」で話が半分で済む。',
    color: '#c9a227',
    passive: true,
  },
  shoecover: {
    name: '防水シューズカバー',
    short: '靴カバー',
    desc: '持っているだけでOK。濡れた床でも滑らず、ダッシュしても転ばない。',
    color: '#3aa0d8',
    passive: true,
  },
  baramaki: {
    name: 'ばらまき土産',
    short: 'ばらまき',
    desc: '使うと、まわりの人にお土産を配る。受け取った人は10秒間話しかけてこない（音にも気づかない）。',
    color: '#e87fa5',
  },
  karaoke: {
    name: 'カラオケ割引券',
    short: '割引券',
    desc: '使うと足元に置く。8秒間、近く（9m）の宴会好き（二次会電車・飲み会幹事・接待好き）が券に群がって、誰も捕まえてこない。',
    hint: '使うと、宴会好きが群がる！', // 拾ったあとに出る使い方のヒント
    color: '#e84d8a',
  },
};

export const ITEM_CODES = { E: 'energy', U: 'umbrella', O: 'omiyage', S: 'shoecover', F: 'baramaki', '@': 'karaoke' };
export const BAG_SIZE = 2;

/** 床に置くアイテムの見た目 */
export function itemMesh(id) {
  const g = new THREE.Group();
  const std = (color, extra = {}) => new THREE.MeshStandardMaterial({ color, roughness: 0.4, ...extra });
  if (id === 'energy') {
    const can = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.1, 0.36, 16), std('#1f4fb8', { metalness: 0.5 }));
    const band = new THREE.Mesh(new THREE.CylinderGeometry(0.102, 0.102, 0.12, 16), std('#b9f23a', { emissive: '#6fa010', emissiveIntensity: 0.4 }));
    band.position.y = 0.03;
    g.add(can, band);
  } else if (id === 'umbrella') {
    const body = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.1, 0.42, 8), std('#e0402f'));
    const strap = new THREE.Mesh(new THREE.TorusGeometry(0.075, 0.015, 6, 12), std('#1b2340'));
    const handle = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.14, 8), std('#1b2340'));
    strap.rotation.x = Math.PI / 2;
    handle.position.y = -0.28;
    g.add(body, strap, handle);
    g.rotation.z = 0.5;
  } else if (id === 'shoecover') {
    // 靴の形をした透明ブルーのカバー
    const mat = std('#3aa0d8', { transparent: true, opacity: 0.85, roughness: 0.15 });
    for (const sx of [-0.1, 0.1]) {
      const toe = new THREE.Mesh(new THREE.SphereGeometry(0.09, 12, 8), mat);
      toe.scale.set(0.9, 0.6, 1.5);
      toe.position.set(sx, -0.02, 0.05);
      const heel = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.085, 0.14, 12), mat);
      heel.position.set(sx, 0.02, -0.07);
      g.add(toe, heel);
    }
  } else if (id === 'baramaki') {
    // 個包装のお菓子の箱（上に小箱3つ）
    const box = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.2, 0.3), std('#e87fa5'));
    const band = new THREE.Mesh(new THREE.BoxGeometry(0.43, 0.21, 0.07), std('#ffffff'));
    g.add(box, band);
    for (let i = 0; i < 3; i++) {
      const s = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.06, 0.08), std(i === 1 ? '#ffffff' : '#f6c1d4'));
      s.position.set((i - 1) * 0.13, 0.13, (i % 2) * 0.05 - 0.02);
      s.rotation.y = (i - 1) * 0.3;
      g.add(s);
    }
  } else if (id === 'karaoke') {
    // ピンクの割引券と小さなマイク
    const ticket = new THREE.Mesh(new THREE.BoxGeometry(0.36, 0.03, 0.22), std('#e84d8a'));
    const band = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.032, 0.222), std('#ffffff'));
    band.position.x = 0.1;
    const grip = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.024, 0.16, 8), std('#1b1d22'));
    grip.rotation.z = Math.PI / 2 - 0.3;
    grip.position.set(-0.04, 0.07, 0);
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.04, 10, 8), std('#c9ccd1', { metalness: 0.6 }));
    head.position.set(-0.12, 0.1, 0);
    const tilt = new THREE.Group(); // 足元の輪は傾けない
    tilt.add(ticket, band, grip, head);
    tilt.rotation.x = 0.5;
    g.add(tilt);
  } else {
    const box = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.18, 0.3), std('#f3ead8'));
    const wrap = new THREE.Mesh(new THREE.BoxGeometry(0.43, 0.19, 0.08), std('#c0392b'));
    const wrap2 = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.19, 0.31), std('#c0392b'));
    const bow = new THREE.Mesh(new THREE.TorusGeometry(0.05, 0.02, 6, 12), std('#c0392b'));
    bow.position.y = 0.11;
    bow.rotation.x = Math.PI / 2;
    g.add(box, wrap, wrap2, bow);
  }
  g.traverse((o) => {
    if (o.isMesh) o.castShadow = true;
  });
  const ring = new THREE.Mesh(new THREE.RingGeometry(0.36, 0.44, 32), new THREE.MeshBasicMaterial({ color: ITEMS[id].color, transparent: true, opacity: 0.8, depthWrite: false }));
  ring.rotation.x = -Math.PI / 2;
  ring.position.y = -0.62;
  g.add(ring);
  return g;
}

/** 開いた傘（主人公の頭上） */
export function openUmbrella() {
  const g = new THREE.Group();
  const canopy = new THREE.Mesh(
    new THREE.ConeGeometry(0.62, 0.32, 10, 1, true),
    new THREE.MeshStandardMaterial({ color: '#e0402f', roughness: 0.5, side: THREE.DoubleSide }),
  );
  canopy.position.y = 0.16;
  const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.015, 0.015, 0.7, 6), new THREE.MeshStandardMaterial({ color: '#1b2340' }));
  pole.position.y = -0.2;
  canopy.castShadow = true;
  g.add(canopy, pole);
  return g;
}
