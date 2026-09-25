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
};

export const ITEM_CODES = { E: 'energy', U: 'umbrella', O: 'omiyage' };
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
