import * as THREE from 'three';
import {FleetCar} from './fleet-car';
import {getDriver, getTeam, type DriverId, type TeamId} from './team-catalog';
import {createStudioEnvironment} from './visual-finish';

export type RaceControlView = 'front' | 'side' | 'rear';

const viewAngles: Record<RaceControlView, number> = {
  front: -.59,
  side: -Math.PI / 2,
  rear: -2.59,
};
const easeOut = (t: number) => 1 - (1 - t) ** 3;
const easeInOut = (t: number) => t * t * (3 - 2 * t);
const clampProgress = (value: number) => THREE.MathUtils.clamp(value, 0, 1);

interface LightBank {
  wire: THREE.MeshBasicMaterial;
  glow: THREE.MeshBasicMaterial[];
}

/** A separate garage scene. The race keeps its own renderer and car. */
export class RaceControlStage {
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.PerspectiveCamera(37, 1, .04, 65);
  private readonly renderer: THREE.WebGLRenderer;
  private readonly car = new FleetCar();
  private readonly lightBanks: LightBank[] = [];
  private readonly accentMaterial = new THREE.MeshBasicMaterial({color: 0xe77f20, toneMapped: false});
  private readonly teamLight = new THREE.PointLight(0xe77f20, 2.8, 9);
  private readonly sweepLight = new THREE.PointLight(0x68ddff, 0, 9);
  private readonly shadowMaterial: THREE.MeshBasicMaterial;
  private readonly resizeObserver: ResizeObserver;
  private readonly motion = matchMedia('(prefers-reduced-motion: reduce)');
  private readonly accent = new THREE.Color(0xe77f20);
  private readonly previousAccent = new THREE.Color(0xe77f20);
  private readonly nextAccent = new THREE.Color(0xe77f20);
  private readonly lookAt = new THREE.Vector3(0, .78, 0);
  private readonly projection = new THREE.Vector3();
  private framePoints = makeFramePoints();
  private width = 1;
  private height = 1;
  private frameHandle: number | null = null;
  private frames = 0;
  private selection = 0;
  private disposed = false;
  private started = false;
  private view: RaceControlView = 'front';
  private introStart = -Infinity;
  private selectionStart = -Infinity;
  private viewStart = -Infinity;
  private previousAngle = viewAngles.front;

  constructor(private readonly host: HTMLElement, private entrancePending = false, private readonly entranceDurationScale = 1) {
    this.renderer = new THREE.WebGLRenderer({antialias: true, powerPreference: 'high-performance'});
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.09;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.renderer.domElement.setAttribute('aria-hidden', 'true');
    host.appendChild(this.renderer.domElement);
    this.scene.background = new THREE.Color(0x08121c);
    this.scene.fog = new THREE.Fog(0x08121c, 17, 44);
    this.scene.environment = createStudioEnvironment(this.renderer);
    this.scene.environmentIntensity = .48;

    const glowTexture = radialTexture();
    this.shadowMaterial = new THREE.MeshBasicMaterial({
      color: 0x020405, map: glowTexture, transparent: true, depthWrite: false, opacity: .78,
    });
    const contactShadow = new THREE.Mesh(new THREE.PlaneGeometry(4.4, 6.6), this.shadowMaterial);
    contactShadow.rotation.x = -Math.PI / 2;
    contactShadow.position.y = .007;
    this.scene.add(contactShadow);
    this.buildRoom(glowTexture);
    this.lightCar();

    this.car.group.rotation.y = viewAngles.front;
    this.car.group.visible = false;
    this.scene.add(this.car.group);
    this.resizeObserver = new ResizeObserver(this.resize);
    this.resizeObserver.observe(host);
    this.motion.addEventListener('change', this.queueRender);
    this.renderer.domElement.addEventListener('webglcontextrestored', this.queueRender);
    this.resize();
  }

  async setCar(team: TeamId, driver: DriverId): Promise<boolean> {
    if (this.disposed) return false;
    const request = ++this.selection;
    this.car.select(team, getDriver(driver));
    await this.car.load();
    if (this.disposed || request !== this.selection || this.car.status !== 'ready') return false;

    this.car.group.visible = true;
    this.previousAccent.copy(this.accent);
    this.nextAccent.set(getTeam(team).color);
    if (!this.started) {
      this.started = true;
      if (!this.entrancePending) this.introStart = performance.now();
      this.accent.copy(this.nextAccent);
      this.previousAccent.copy(this.nextAccent);
      this.framePoints = makeFramePoints(this.car.group);
    } else {
      this.selectionStart = performance.now();
    }
    this.queueRender();
    return true;
  }

  setView(view: RaceControlView): void {
    if (view === this.view || this.disposed) return;
    this.previousAngle = this.car.group.rotation.y;
    this.view = view;
    this.viewStart = performance.now();
    this.queueRender();
  }

  playEntrance(): void {
    if (!this.entrancePending || this.disposed) return;
    this.entrancePending = false;
    this.introStart = performance.now();
    this.queueRender();
  }

  get summary() {
    return {
      view: this.view,
      car: this.car.summary,
      visible: this.car.group.visible,
      frames: this.frames,
      animating: this.frameHandle !== null,
      reducedMotion: this.motion.matches,
      lights: this.lightBanks.map(({wire}) => wire.color.getHexString()),
      camera: {distance: this.camera.position.z, aspect: this.camera.aspect},
    };
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    if (this.frameHandle !== null) cancelAnimationFrame(this.frameHandle);
    this.resizeObserver.disconnect();
    this.motion.removeEventListener('change', this.queueRender);
    this.renderer.domElement.removeEventListener('webglcontextrestored', this.queueRender);
    this.renderer.domElement.remove();
    this.scene.environment?.dispose();
    disposeMeshes(this.scene);
    if (this.car.status === 'loading') void this.car.load().then(() => disposeMeshes(this.car.group));
    this.renderer.dispose();
  }

  private readonly resize = () => {
    const {clientWidth, clientHeight} = this.host;
    this.width = Math.max(1, clientWidth);
    this.height = Math.max(1, clientHeight);
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5, 1500 / this.width));
    this.renderer.setSize(this.width, this.height, false);
    this.queueRender();
  };

  private readonly queueRender = () => {
    if (this.disposed || this.frameHandle !== null) return;
    this.frameHandle = requestAnimationFrame(this.draw);
  };

  private readonly draw = (now: number) => {
    this.frameHandle = null;
    const still = this.motion.matches;
    const introTime = still || this.entrancePending ? Infinity : (now - this.introStart) / this.entranceDurationScale;
    const selectionTime = still ? Infinity : now - this.selectionStart;
    const viewTime = still ? Infinity : now - this.viewStart;
    const intro = this.entrancePending && !still ? 0 : easeOut(clampProgress(introTime / 990));
    const selection = easeInOut(clampProgress(selectionTime / 570));
    const view = easeInOut(clampProgress(viewTime / 480));
    this.car.group.rotation.y = THREE.MathUtils.lerp(this.previousAngle, viewAngles[this.view], view);
    this.accent.copy(this.previousAccent).lerp(this.nextAccent, this.started ? selection : 0);
    this.accentMaterial.color.copy(this.accent);
    this.teamLight.color.copy(this.accent);
    this.teamLight.intensity = 2.4 + 2.8 * Math.sin(Math.PI * selection);
    this.sweepLight.position.x = THREE.MathUtils.lerp(-3.8, 3.8, selection);
    this.sweepLight.intensity = 10 * Math.sin(Math.PI * selection);

    this.lightBanks.forEach(({wire, glow}, index) => {
      const level = this.started && (!this.entrancePending || still)
        ? easeOut(clampProgress((introTime - index * 150) / 325)) : .13;
      wire.color.setHex(0x70f0ff).multiplyScalar(.14 + .86 * level);
      glow.forEach(material => material.opacity = .08 + .23 * level);
    });
    this.shadowMaterial.opacity = this.car.group.visible ? .77 : 0;
    this.frameCar(1 + .13 * (1 - intro) + .028 * Math.sin(Math.PI * selection));
    this.renderer.render(this.scene, this.camera);
    this.frames++;
    if (this.started && (introTime < 990 || selectionTime < 570 || viewTime < 480)) this.queueRender();
  };

  private frameCar(pullBack: number): void {
    this.camera.clearViewOffset();
    this.camera.aspect = this.width / this.height;
    this.camera.updateProjectionMatrix();
    const portrait = this.camera.aspect < 1;
    const intendedWidth = portrait ? .84 : .82;
    const intendedHeight = portrait ? .56 : .59;
    let distance = Math.max(6.1, 7.3 / this.camera.aspect);
    const yaw = this.car.group.rotation.y;
    let bounds = this.measureFrame(distance, yaw);
    for (let i = 0; i < 2; i++) {
      const fit = Math.max((bounds.right - bounds.left) / intendedWidth, (bounds.bottom - bounds.top) / intendedHeight);
      distance = Math.max(4.8, distance * fit);
      bounds = this.measureFrame(distance, yaw);
    }
    bounds = this.measureFrame(distance * pullBack, yaw);
    const centerX = (bounds.left + bounds.right) / 2;
    const centerY = (bounds.top + bounds.bottom) / 2;
    this.camera.setViewOffset(
      this.width, this.height, (centerX - .51) * this.width,
      (centerY - (portrait ? .55 : .60)) * this.height, this.width, this.height,
    );
  }

  private measureFrame(distance: number, yaw: number) {
    this.camera.position.set(0, .49 + distance * .35, distance);
    this.camera.lookAt(this.lookAt);
    this.camera.updateMatrixWorld();
    const cos = Math.cos(yaw), sin = Math.sin(yaw);
    let left = Infinity, right = -Infinity, top = Infinity, bottom = -Infinity;
    for (const {x, y, z} of this.framePoints) {
      const point = this.projection.set(x * cos + z * sin, y, z * cos - x * sin).project(this.camera);
      const px = .5 + point.x * .5, py = .5 - point.y * .5;
      left = Math.min(left, px); right = Math.max(right, px);
      top = Math.min(top, py); bottom = Math.max(bottom, py);
    }
    return {left, right, top, bottom};
  }

  private lightCar(): void {
    this.scene.add(new THREE.HemisphereLight(0xe0f2ff, 0x25303b, 1.37));
    const key = new THREE.DirectionalLight(0xfff6e8, 2.35);
    key.position.set(-3, 7, 4);
    key.castShadow = true;
    key.shadow.mapSize.set(1024, 1024);
    Object.assign(key.shadow.camera, {left: -4.6, right: 4.6, top: 4.6, bottom: -4.6, near: .2, far: 18});
    key.shadow.normalBias = .024;
    key.shadow.bias = -.00035;
    const fill = new THREE.DirectionalLight(0xbaddff, .74);
    fill.position.set(5, 2.5, 4);
    const rim = new THREE.DirectionalLight(0x6ccaff, 1.44);
    rim.position.set(3.5, 4, -5);
    this.teamLight.position.set(-2.5, 1.45, -.5);
    this.sweepLight.position.set(0, 1.12, .75);
    this.scene.add(key, fill, rim, this.teamLight, this.sweepLight);
  }

  private buildRoom(glowTexture: THREE.Texture): void {
    const floor = new THREE.Mesh(
      new THREE.PlaneGeometry(40, 47),
      new THREE.MeshStandardMaterial({color: 0x202d38, map: floorTexture(), roughness: .49, metalness: .25, envMapIntensity: .42}),
    );
    floor.rotation.x = -Math.PI / 2;
    floor.position.set(0, -.018, -4);
    floor.receiveShadow = true;
    this.scene.add(floor);

    const wall = new THREE.MeshStandardMaterial({color: 0x172430, roughness: .75, metalness: .3});
    const frames = new THREE.MeshStandardMaterial({color: 0x293b49, roughness: .69, metalness: .37});
    const recess = new THREE.MeshStandardMaterial({color: 0x101820, roughness: .84});
    const paint = new THREE.MeshStandardMaterial({color: 0x7893a1, roughness: .7, metalness: .16});
    const white = new THREE.MeshBasicMaterial({color: 0xcceeff, toneMapped: false});
    const box = (w: number, h: number, d: number, x: number, y: number, z: number, material: THREE.Material) => {
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), material);
      mesh.position.set(x, y, z);
      this.scene.add(mesh);
      return mesh;
    };

    box(15.6, 4.4, .35, 0, 2.2, -18.7, wall);
    box(7.4, 2.88, .16, 0, 1.44, -18.47, recess);
    for (let i = 0; i < 6; i++) box(7.15, .028, .035, 0, .41 + i * .38, -18.36, frames);
    for (const side of [-1, 1]) {
      box(.38, 4.4, 33, side * 7.95, 2.2, -4, wall);
      box(.48, .42, 33, side * 7.72, .23, -4, recess);
      box(.38, .055, 11.9, side * 7.49, .46, -6.9, this.accentMaterial);
      for (const z of [-13.8, -7.7, -1.8, 3.8]) {
        box(.28, 2.75, 3.85, side * 7.68, 2.02, z, recess);
        box(.29, .05, 3.78, side * 7.48, 3.41, z, frames);
        box(.62, 1.05, 1.6, side * 7.25, .52, z + 1, frames);
        box(.64, .035, 1.4, side * 7.18, .88, z + 1, this.accentMaterial);
      }
      for (const z of [-2.85, 2.85]) {
        box(.57, .008, .055, side * 1.97, -.008, z, paint);
        box(.055, .008, .42, side * 2.22, -.008, z + (z < 0 ? .21 : -.21), paint);
      }
    }
    box(15.7, .36, 34, 0, 4.37, -5, wall);
    box(4.8, .045, .31, 0, 4.16, -14.4, frames);
    box(4.6, .027, .22, 0, 4.13, -14.4, white);

    for (const z of [-15.6, -9.4, -3.45]) {
      const wire = new THREE.MeshBasicMaterial({color: 0x1e5463, toneMapped: false});
      const glow: THREE.MeshBasicMaterial[] = [];
      const arch = [
        [-7.2, .1], [-7.2, 2.63], [-6.28, 3.45], [6.28, 3.45], [7.2, 2.63], [7.2, .1],
      ];
      for (let i = 1; i < arch.length; i++) {
        const [ax, ay] = arch[i - 1], [bx, by] = arch[i];
        const length = Math.hypot(bx - ax, by - ay);
        const angle = Math.atan2(by - ay, bx - ax);
        box(length + .06, .27, .29, (ax + bx) / 2, (ay + by) / 2, z, frames).rotation.z = angle;
        box(length + .022, .056, .045, (ax + bx) / 2, (ay + by) / 2, z + .156, wire).rotation.z = angle;
      }
      for (const side of [-1, 1]) {
        box(.048, .012, 5.12, side * 3.35, -.005, z + 2.85, wire);
        const material = new THREE.MeshBasicMaterial({
          color: 0x23b6e6, map: glowTexture, transparent: true, opacity: .12,
          depthWrite: false, blending: THREE.AdditiveBlending,
        });
        const reflection = new THREE.Mesh(new THREE.PlaneGeometry(1.8, 6.1), material);
        reflection.rotation.x = -Math.PI / 2;
        reflection.position.set(side * 3.35, -.004, z + 2.85);
        this.scene.add(reflection);
        glow.push(material);
      }
      this.lightBanks.push({wire, glow});
    }
  }
}

function makeFramePoints(car?: THREE.Group): THREE.Vector3[] {
  const result: THREE.Vector3[] = [];
  const pushBox = (box: THREE.Box3, transform?: THREE.Matrix4) => {
    for (const x of [box.min.x, box.max.x]) for (const y of [box.min.y, box.max.y]) {
      for (const z of [box.min.z, box.max.z]) {
        const corner = new THREE.Vector3(x, y, z);
        result.push(transform ? corner.applyMatrix4(transform) : corner);
      }
    }
  };
  if (!car) {
    pushBox(new THREE.Box3(new THREE.Vector3(-1.3, 0, -2.25), new THREE.Vector3(1.3, 1.8, 2.25)));
    return result;
  }
  car.updateMatrixWorld(true);
  const inverse = car.matrixWorld.clone().invert();
  car.traverse(object => {
    if (!(object instanceof THREE.Mesh)) return;
    object.geometry.computeBoundingBox();
    const box = object.geometry.boundingBox;
    if (box && !box.isEmpty()) pushBox(box, inverse.clone().multiply(object.matrixWorld));
  });
  return result;
}

function radialTexture(): THREE.DataTexture {
  const size = 64;
  const data = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const index = (y * size + x) * 4;
    const radius = Math.hypot((x + .5) * 2 / size - 1, (y + .5) * 2 / size - 1);
    data[index] = data[index + 1] = data[index + 2] = 255;
    data[index + 3] = Math.round(255 * Math.max(0, 1 - radius * radius) ** 2);
  }
  const texture = new THREE.DataTexture(data, size, size);
  texture.magFilter = texture.minFilter = THREE.LinearFilter;
  texture.needsUpdate = true;
  return texture;
}

function floorTexture(): THREE.DataTexture {
  const size = 128;
  const data = new Uint8Array(size * size * 4);
  let seed = 7129;
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const index = (y * size + x) * 4;
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    const seam = x === 0 || y === 0 ? 19 : 0;
    const weave = (x % 4 < 2) === (y % 4 < 2) ? 6 : 0;
    data[index] = data[index + 1] = data[index + 2] = 214 + (seed >>> 28) + weave - seam;
    data[index + 3] = 255;
  }
  const texture = new THREE.DataTexture(data, size, size);
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(12, 14);
  texture.generateMipmaps = true;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.anisotropy = 4;
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.needsUpdate = true;
  return texture;
}

function disposeMeshes(root: THREE.Object3D): void {
  const geometries = new Set<THREE.BufferGeometry>();
  const materials = new Set<THREE.Material>();
  const textures = new Set<THREE.Texture>();
  root.traverse(object => {
    if (object instanceof THREE.Mesh) {
      geometries.add(object.geometry);
      (Array.isArray(object.material) ? object.material : [object.material]).forEach(material => materials.add(material));
    }
  });
  for (const material of materials) {
    for (const value of Object.values(material)) if (value instanceof THREE.Texture) textures.add(value);
    material.dispose();
  }
  geometries.forEach(geometry => geometry.dispose());
  textures.forEach(texture => texture.dispose());
}
