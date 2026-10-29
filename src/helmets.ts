import * as THREE from 'three';

export type HelmetId = 'leclerc-2024' | 'norris-2024';

/** The named designs are deliberately simplified, sponsor-free reference studies. */
export const helmetOptions: {
  id: HelmetId;
  label: string;
  description: string;
  reference: string;
}[] = [
  {
    id: 'leclerc-2024',
    label: '勒克莱尔 · 2024 摩纳哥站',
    description: '金属红与纯白几何分区、侧面 16、后部 MONACO；Q 版简化纹样。',
    reference: 'https://www.formula1.com/en/latest/article/six-wheelers-outrageous-trophies-and-a-pound-coin-8-museum-worthy-items-from-f1.1KdvUthwJkWEHXIA7bbaj3',
  },
  {
    id: 'norris-2024',
    label: '诺里斯 · 2024 赛季',
    description: '荧光柠檬黄底与标志性的黑色有机色块；Q 版简化纹样。',
    reference: 'https://landonorris.com/',
  },
];

function makeTexture(id: HelmetId): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 1024;
  canvas.height = 512;
  const ctx = canvas.getContext('2d')!;
  const w = canvas.width;
  const h = canvas.height;
  if (id === 'leclerc-2024') {
    ctx.fillStyle = '#e63f3e';
    ctx.fillRect(0, 0, w, h);
    // Angular white crown/side fields reflect the 2024 Monaco red-and-white split.
    ctx.fillStyle = '#fffaf1';
    ctx.beginPath();
    ctx.moveTo(0, 60);
    ctx.lineTo(170, 60);
    ctx.lineTo(244, 177);
    ctx.lineTo(350, 90);
    ctx.lineTo(496, 90);
    ctx.lineTo(606, 196);
    ctx.lineTo(737, 78);
    ctx.lineTo(w, 78);
    ctx.lineTo(w, 222);
    ctx.lineTo(800, 222);
    ctx.lineTo(744, 279);
    ctx.lineTo(596, 256);
    ctx.lineTo(500, 184);
    ctx.lineTo(357, 202);
    ctx.lineTo(247, 282);
    ctx.lineTo(140, 206);
    ctx.lineTo(0, 206);
    ctx.closePath();
    ctx.fill();
    ctx.fillRect(0, 343, w, 83);
    ctx.fillStyle = '#d42d38';
    ctx.beginPath();
    ctx.moveTo(0, 358);
    ctx.lineTo(165, 358);
    ctx.lineTo(216, 410);
    ctx.lineTo(352, 410);
    ctx.lineTo(412, 358);
    ctx.lineTo(604, 358);
    ctx.lineTo(671, 410);
    ctx.lineTo(842, 410);
    ctx.lineTo(911, 358);
    ctx.lineTo(w, 358);
    ctx.lineTo(w, 384);
    ctx.lineTo(923, 384);
    ctx.lineTo(855, 432);
    ctx.lineTo(652, 432);
    ctx.lineTo(594, 384);
    ctx.lineTo(423, 384);
    ctx.lineTo(365, 432);
    ctx.lineTo(203, 432);
    ctx.lineTo(151, 384);
    ctx.lineTo(0, 384);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = '#fffaf1';
    ctx.font = '900 79px Arial, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('16', 46, 322);
    ctx.fillText('16', 494, 322);
    ctx.font = '900 38px Arial, sans-serif';
    ctx.fillText('MONACO', 768, 317);
    ctx.fillStyle = '#f7d998';
    ctx.fillRect(0, 445, w, 5);
  } else {
    ctx.fillStyle = '#ddff2f';
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = '#20252a';
    // Continuous, round-edged blobs; not arbitrary racing stripes.
    const blobs = [
      [60, 120, 140, 100, 0.1],
      [315, 138, 125, 90, -0.4],
      [550, 85, 155, 103, 0.4],
      [835, 137, 150, 95, -0.2],
      [135, 388, 160, 72, -0.3],
      [455, 371, 145, 85, 0.2],
      [760, 395, 170, 82, -0.2],
      [1040, 366, 125, 90, 0.5],
    ];
    for (const [x, y, sx, sy, rot] of blobs) {
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(rot);
      ctx.scale(sx, sy);
      ctx.beginPath();
      ctx.moveTo(-1, -0.15);
      ctx.bezierCurveTo(-1.25, -0.8, -0.37, -1.06, -0.08, -0.66);
      ctx.bezierCurveTo(0.19, -0.28, 0.5, -0.9, 0.88, -0.48);
      ctx.bezierCurveTo(1.47, 0.21, 0.92, 0.86, 0.4, 0.62);
      ctx.bezierCurveTo(0.03, 0.44, 0.03, 1.12, -0.5, 0.84);
      ctx.bezierCurveTo(-0.85, 0.66, -0.59, 0.17, -1, -0.15);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
    }
    ctx.fillStyle = '#20252a';
    ctx.font = '900 italic 80px Arial, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('4', 768, 295);
    ctx.fillStyle = '#e7ff80';
    ctx.fillRect(0, 455, w, 8);
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;
  return texture;
}

export function createHelmet(id: HelmetId): THREE.Group {
  const group = new THREE.Group();
  group.name = `helmet-${id}`;
  group.userData.reference = helmetOptions.find((option) => option.id === id);
  const shell = new THREE.Mesh(
    new THREE.SphereGeometry(0.365, 40, 28),
    new THREE.MeshStandardMaterial({
      map: makeTexture(id),
      roughness: 0.29,
      metalness: id === 'leclerc-2024' ? 0.23 : 0.07,
    }),
  );
  shell.scale.set(1, 1.07, 1.03);
  group.add(shell);
  const visor = new THREE.Mesh(
    new THREE.SphereGeometry(0.373, 32, 12, Math.PI * 0.10, Math.PI * 0.80, Math.PI * 0.385, Math.PI * 0.175),
    new THREE.MeshStandardMaterial({ color: '#173d45', metalness: 0.7, roughness: 0.2 }),
  );
  visor.scale.copy(shell.scale);
  group.add(visor);
  // A fine bright brow makes the visor readable at follow-camera distance.
  const browCurve = new THREE.CatmullRomCurve3([
    new THREE.Vector3(-0.3, 0.13, 0.18),
    new THREE.Vector3(-0.2, 0.145, 0.29),
    new THREE.Vector3(0, 0.15, 0.352),
    new THREE.Vector3(0.2, 0.145, 0.29),
    new THREE.Vector3(0.3, 0.13, 0.18),
  ]);
  group.add(new THREE.Mesh(
    new THREE.TubeGeometry(browCurve, 20, 0.011, 5, false),
    new THREE.MeshStandardMaterial({ color: id === 'norris-2024' ? '#efff91' : '#fff8e9', roughness: 0.3 }),
  ));
  const trim = new THREE.Mesh(
    new THREE.TorusGeometry(0.267, 0.017, 6, 36),
    new THREE.MeshStandardMaterial({ color: '#283e40', roughness: 0.68 }),
  );
  trim.rotation.x = Math.PI / 2;
  trim.position.y = -0.285;
  group.add(trim);
  const pinMaterial = new THREE.MeshStandardMaterial({ color: '#bed1cb', metalness: 0.7, roughness: 0.3 });
  for (const side of [-1, 1]) {
    const pin = new THREE.Mesh(new THREE.SphereGeometry(0.022, 8, 6), pinMaterial);
    pin.position.set(side * 0.355, 0.025, 0.07);
    group.add(pin);
  }
  group.traverse((object) => {
    if (object instanceof THREE.Mesh) {
      object.castShadow = true;
      object.receiveShadow = true;
    }
  });
  return group;
}
