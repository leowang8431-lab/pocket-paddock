import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { createHelmet, type HelmetId } from './helmets';
import { batchStaticChildren } from './render-batches';

export type { HelmetId } from './helmets';
export type Livery = 'coral' | 'teal' | 'ivory';

const liveries: Record<Livery, { body: string; accent: string; dark: string }> = {
  coral: { body: '#ef584d', accent: '#fff2d3', dark: '#334b49' },
  teal: { body: '#32aa9e', accent: '#ebffa9', dark: '#214a48' },
  ivory: { body: '#fff0ce', accent: '#e97053', dark: '#294e4b' },
};

function labelTexture(text: string, color: string, background = 'transparent'): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 128;
  const ctx = canvas.getContext('2d')!;
  if (background !== 'transparent') {
    ctx.fillStyle = background;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  }
  ctx.fillStyle = color;
  ctx.font = '900 84px Arial, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, 256, 68);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

function tyreTexture(): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 256;
  const ctx = canvas.getContext('2d')!;
  ctx.strokeStyle = '#e8c557';
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.arc(128, 128, 106, 0, Math.PI * 2);
  ctx.stroke();
  ctx.fillStyle = '#e8c557';
  ctx.font = 'bold 25px Arial, sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText('POCKET', 128, 51);
  ctx.font = 'bold 20px Arial, sans-serif';
  ctx.fillText('RACING', 128, 218);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

/** A self-contained, +Z-facing toy formula car. Its origin sits at ground level. */
export class Car {
  readonly group = new THREE.Group();
  private readonly body = new THREE.MeshStandardMaterial({ roughness: 0.35, metalness: 0.16 });
  private readonly accent = new THREE.MeshStandardMaterial({ roughness: 0.4, metalness: 0.05 });
  private readonly dark = new THREE.MeshStandardMaterial({ color: '#243d3c', roughness: 0.54, metalness: 0.14 });
  private readonly rubber = new THREE.MeshStandardMaterial({ color: '#252b2b', roughness: 0.86 });
  private readonly silver = new THREE.MeshStandardMaterial({ color: '#98aaa6', roughness: 0.35, metalness: 0.72 });
  private readonly black = new THREE.MeshStandardMaterial({ color: '#172e2e', roughness: 0.7 });
  private readonly wheelPivots: THREE.Group[] = [];
  private readonly wheelSpins: THREE.Group[] = [];
  private helmet: THREE.Group;
  private readonly helmetMount = new THREE.Group();
  private elapsed = 0;

  constructor(livery: Livery = 'coral', helmet: HelmetId = 'leclerc-2024') {
    this.group.name = 'pocket-formula-car';
    this.setLivery(livery);

    const box = (width: number, height: number, depth: number, material: THREE.Material, x: number, y: number, z: number, radius = 0.06) => {
      const mesh = new THREE.Mesh(new RoundedBoxGeometry(width, height, depth, radius>.08?2:1, radius), material);
      mesh.position.set(x, y, z);
      this.group.add(mesh);
      return mesh;
    };
    const rod = (a: THREE.Vector3, b: THREE.Vector3, radius: number, material: THREE.Material) => {
      const direction = b.clone().sub(a);
      const mesh = new THREE.Mesh(new THREE.CylinderGeometry(radius, radius, direction.length(), 8), material);
      mesh.position.copy(a).add(b).multiplyScalar(0.5);
      mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), direction.normalize());
      this.group.add(mesh);
      return mesh;
    };
    const tube = (points: number[][], radius: number, material: THREE.Material) => {
      const curve = new THREE.CatmullRomCurve3(points.map(([x, y, z]) => new THREE.Vector3(x, y, z)));
      const mesh = new THREE.Mesh(new THREE.TubeGeometry(curve, 28, radius, 7, false), material);
      this.group.add(mesh);
      return mesh;
    };

    // Flat undertray, shortened monocoque, and an unmistakable tapered nose.
    box(1.83, 0.15, 3.34, this.dark, 0, 0.28, -0.12, 0.045);
    box(0.85, 0.55, 2.20, this.body, 0, 0.63, -0.11, 0.19);
    const noseShape = new THREE.Shape();
    noseShape.moveTo(-0.38, -0.45);
    noseShape.lineTo(0.38, -0.45);
    noseShape.lineTo(0.23, -1.82);
    noseShape.quadraticCurveTo(0.19, -2.04, 0, -2.04);
    noseShape.quadraticCurveTo(-0.19, -2.04, -0.23, -1.82);
    noseShape.closePath();
    const noseGeometry = new THREE.ExtrudeGeometry(noseShape, { depth: 0.28, bevelEnabled: true, bevelSegments: 3, steps: 1, bevelSize: 0.065, bevelThickness: 0.065, curveSegments: 8 });
    noseGeometry.rotateX(-Math.PI / 2);
    const nose = new THREE.Mesh(noseGeometry, this.body);
    nose.position.y = 0.39;
    this.group.add(nose);
    for (const side of [-1, 1]) {
      box(0.62, 0.48, 1.77, this.body, side * 0.65, 0.59, -0.39, 0.17);
      box(0.52, 0.085, 1.38, this.accent, side * 0.65, 0.825, -0.48, 0.035);
      // Dark radiator mouths and paired cooling slats.
      box(0.44, 0.24, 0.065, this.black, side * 0.65, 0.63, 0.51, 0.025);
      for (let i = 0; i < 4; i++) {
        const vent = box(0.30, 0.024, 0.045, this.dark, side * 0.66, 0.88, -0.31 - i * 0.15, 0.009);
        vent.rotation.y = side * 0.13;
      }
    }

    // Engine cover and a raised airbox behind the driver's head.
    box(0.53, 0.61, 1.08, this.body, 0, 0.84, -1.01, 0.15);
    box(0.34, 0.46, 0.32, this.body, 0, 1.17, -0.66, 0.08);
    box(0.22, 0.17, 0.035, this.black, 0, 1.25, -0.485, 0.045);
    const fin = box(0.075, 0.35, 0.79, this.accent, 0, 1.075, -1.20, 0.025);
    fin.rotation.x = -0.06;

    // Open cockpit, driver shoulders, and a helmet scaled for the gameplay camera.
    const cockpit = new THREE.Mesh(new THREE.SphereGeometry(0.44, 28, 16), this.black);
    cockpit.scale.set(1, 0.2, 1.34);
    cockpit.position.set(0, 0.955, 0.02);
    this.group.add(cockpit);
    const rim = new THREE.Mesh(new THREE.TorusGeometry(0.41, 0.055, 7, 40), this.body);
    rim.rotation.x = Math.PI / 2;
    rim.scale.set(1, 1.32, 1);
    rim.position.set(0, 1.0, 0.02);
    this.group.add(rim);
    const shoulders = new THREE.Mesh(new THREE.SphereGeometry(0.30, 20, 12), this.accent);
    shoulders.position.set(0, 1.055, -0.06);
    shoulders.scale.set(1.12, 0.53, 0.88);
    this.group.add(shoulders);
    this.helmetMount.position.set(0, 1.405, 0.035);
    this.group.add(this.helmetMount);
    this.helmet = createHelmet(helmet);
    batchStaticChildren(this.helmet);
    this.helmetMount.add(this.helmet);

    // A real three-point Halo outline: rear mounts, oval forward arch, central pillar.
    tube([[-0.43, 1.01, -0.48], [-0.49, 1.33, -0.40], [-0.46, 1.43, 0.08], [-0.29, 1.40, 0.58], [0, 1.38, 0.72], [0.29, 1.40, 0.58], [0.46, 1.43, 0.08], [0.49, 1.33, -0.40], [0.43, 1.01, -0.48]], 0.049, this.dark);
    tube([[0, 1.38, 0.72], [0, 1.13, 0.64], [0, 0.84, 0.59]], 0.049, this.dark);
    const steeringWheel = new THREE.Mesh(new THREE.TorusGeometry(0.16, 0.035, 6, 16), this.dark);
    steeringWheel.position.set(0, 1.09, 0.35);
    steeringWheel.rotation.x = -0.5;
    steeringWheel.scale.y = 0.65;
    this.group.add(steeringWheel);

    // Front wing with two separate foils and tall toy-like endplates.
    box(2.32, 0.12, 0.46, this.dark, 0, 0.30, 1.99, 0.065);
    box(2.10, 0.09, 0.22, this.accent, 0, 0.43, 1.88, 0.035);
    for (const side of [-1, 1]) {
      box(0.11, 0.39, 0.57, this.body, side * 1.12, 0.40, 1.96, 0.04);
      rod(new THREE.Vector3(side * 0.17, 0.49, 1.65), new THREE.Vector3(side * 0.26, 0.33, 1.98), 0.035, this.dark);
    }

    // High rear wing, dual pylons, endplates, diffuser, exhaust, and rain light.
    box(2.13, 0.13, 0.44, this.body, 0, 1.29, -1.99, 0.055);
    const rearFlap = box(1.97, 0.09, 0.22, this.accent, 0, 1.43, -1.96, 0.03);
    rearFlap.rotation.x = 0.15;
    for (const side of [-1, 1]) {
      box(0.11, 0.58, 0.58, this.dark, side * 1.06, 1.22, -1.98, 0.04);
      box(0.095, 0.65, 0.16, this.dark, side * 0.32, 0.91, -1.92, 0.025);
    }
    box(1.13, 0.18, 0.42, this.dark, 0, 0.29, -1.77, 0.025);
    for (let i = -2; i <= 2; i++) box(0.04, 0.22, 0.41, this.black, i * 0.23, 0.28, -1.85, 0.008);
    const exhaust = new THREE.Mesh(new THREE.CylinderGeometry(0.095, 0.095, 0.23, 12), this.silver);
    exhaust.rotation.x = Math.PI / 2;
    exhaust.position.set(0, 0.78, -1.67);
    this.group.add(exhaust);
    const exhaustHole = new THREE.Mesh(new THREE.CircleGeometry(0.073, 12), this.black);
    exhaustHole.position.set(0, 0.78, -1.792);
    exhaustHole.rotation.y = Math.PI;
    this.group.add(exhaustHole);
    const rainLight = new THREE.Mesh(new RoundedBoxGeometry(0.17, 0.10, 0.05, 1, 0.02), new THREE.MeshStandardMaterial({ color: '#ff5b48', emissive: '#bf2e21', emissiveIntensity: 0.6, roughness: 0.4 }));
    rainLight.position.set(0, 0.49, -1.99);
    this.group.add(rainLight);

    // Exposed suspension wishbones keep the silhouette recognisably Formula 1.
    for (const side of [-1, 1]) {
      for (const z of [1.18, -1.28]) {
        for (const mountZ of [z - 0.32, z + 0.30]) {
          rod(new THREE.Vector3(side * 0.34, 0.48, mountZ), new THREE.Vector3(side * 1.01, 0.46, z), 0.031, this.dark);
          rod(new THREE.Vector3(side * 0.36, 0.69, mountZ), new THREE.Vector3(side * 1.01, 0.56, z), 0.024, this.dark);
        }
        rod(new THREE.Vector3(side * 0.35, 0.79, z - 0.15), new THREE.Vector3(side * 0.96, 0.44, z), 0.023, this.silver);
      }
    }

    const tyreMark = tyreTexture();
    const markingMaterial = new THREE.MeshBasicMaterial({ map: tyreMark, transparent: true, depthWrite: false, side: THREE.DoubleSide });
    const tyreGeometry = new THREE.CylinderGeometry(0.455, 0.455, 0.44, 32);
    tyreGeometry.rotateZ(Math.PI / 2);
    const rimGeometry = new THREE.CylinderGeometry(0.246, 0.246, 0.451, 24);
    rimGeometry.rotateZ(Math.PI / 2);
    for (const z of [1.18, -1.28]) {
      for (const side of [-1, 1]) {
        const pivot = new THREE.Group();
        pivot.position.set(side * 1.025, 0.455, z);
        const spin = new THREE.Group();
        pivot.add(spin);
        spin.add(new THREE.Mesh(tyreGeometry, this.rubber));
        spin.add(new THREE.Mesh(rimGeometry, this.dark));
        const ring = new THREE.Mesh(new THREE.TorusGeometry(0.335, 0.014, 5, 32), this.accent);
        ring.rotation.y = Math.PI / 2;
        ring.position.x = side * 0.228;
        spin.add(ring);
        const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.072, 0.072, 0.47, 12), this.silver);
        hub.rotation.z = Math.PI / 2;
        spin.add(hub);
        for (let spoke = 0; spoke < 6; spoke++) {
          const mesh = new THREE.Mesh(new THREE.BoxGeometry(0.024, 0.37, 0.033), this.silver);
          mesh.position.x = side * 0.232;
          mesh.rotation.x = spoke * Math.PI / 3;
          spin.add(mesh);
        }
        const mark = new THREE.Mesh(new THREE.CircleGeometry(0.445, 40), markingMaterial);
        mark.rotation.y = side * Math.PI / 2;
        mark.position.x = side * 0.236;
        spin.add(mark);
        this.wheelPivots.push(pivot);
        this.wheelSpins.push(spin);
        this.group.add(pivot);
      }
    }

    const decalMaterial = new THREE.MeshBasicMaterial({ map: labelTexture('POCKET', '#fff9e9'), transparent: true, depthWrite: false });
    const rearDecal = new THREE.Mesh(new THREE.PlaneGeometry(1.24, 0.31), decalMaterial);
    rearDecal.position.set(0, 1.285, -2.222);
    rearDecal.rotation.y = Math.PI;
    this.group.add(rearDecal);
    const number = new THREE.Mesh(
      new THREE.PlaneGeometry(0.42, 0.24),
      new THREE.MeshBasicMaterial({ map: labelTexture('01', '#fff9e9'), transparent: true, depthWrite: false }),
    );
    number.position.set(0, 0.746, 1.23);
    number.rotation.x = -Math.PI / 2;
    this.group.add(number);
    for (const side of [-1, 1]) {
      const mirror = box(0.22, 0.12, 0.16, this.body, side * 0.65, 1.03, 0.43, 0.045);
      rod(new THREE.Vector3(side * 0.38, 0.89, 0.30), mirror.position, 0.024, this.dark);
      box(0.13, 0.065, 0.016, this.silver, side * 0.65, 1.04, 0.344, 0.008);
    }

    this.group.traverse((object) => {
      if (object instanceof THREE.Mesh) {
        object.castShadow = true;
        object.receiveShadow = true;
      }
    });
    let before=0;this.group.traverse(object=>{if(object instanceof THREE.Mesh)before++;});
    for(const spin of this.wheelSpins)batchStaticChildren(spin);
    batchStaticChildren(this.group);
    let after=0;this.group.traverse(object=>{if(object instanceof THREE.Mesh)after++;});
    this.group.userData.renderMeshes={before,after};
    this.group.userData.dimensions = { width: 2.53, length: 4.47, height: 1.80 };
  }

  setLivery(id: Livery): void {
    const colors = liveries[id];
    this.body.color.set(colors.body);
    this.accent.color.set(colors.accent);
    this.dark.color.set(colors.dark);
    this.group.userData.livery = id;
  }

  setHelmet(id: HelmetId): void {
    this.helmetMount.remove(this.helmet);
    this.helmet.traverse((object) => {
      if (object instanceof THREE.Mesh) {
        object.geometry.dispose();
        const materials = Array.isArray(object.material) ? object.material : [object.material];
        for (const material of materials) {
          if (material instanceof THREE.MeshStandardMaterial) material.map?.dispose();
          material.dispose();
        }
      }
    });
    this.helmet = createHelmet(id);
    batchStaticChildren(this.helmet);
    this.helmetMount.add(this.helmet);
    this.group.userData.helmet = id;
  }

  update(speed: number, steering: number, dt: number): void {
    this.elapsed += dt;
    for (const spin of this.wheelSpins) spin.rotation.x += speed * dt / 0.455;
    // The first pair are the front wheels; match positive yaw to left steering.
    for (let i = 0; i < 2; i++) {
      this.wheelPivots[i].rotation.y = THREE.MathUtils.damp(this.wheelPivots[i].rotation.y, steering * 0.38, 12, dt);
    }
    this.helmetMount.rotation.z = THREE.MathUtils.damp(this.helmetMount.rotation.z, steering * Math.min(Math.abs(speed) / 80, 0.075), 6, dt);
    this.helmetMount.rotation.x = Math.sin(this.elapsed * 8) * Math.min(Math.abs(speed) / 4000, 0.012);
  }
}
