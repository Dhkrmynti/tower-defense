/* The 3D view: the same world, built from low-poly primitives in Three.js. The sim never knows. */
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { fortressStage } from '../components/bastion/lore';
import { H, W, laneAt, laneDistance, type MapDef } from './maps';
import type { Enemy, Sim, WorldInput } from './sim';
import type { Targeting } from './render';
import { ABILITIES, AIRSTRIKE, BARRICADE, EXPERIMENTAL_LEVEL, TURRETS, type AbilityKind, type EnemyKind, type TurretKind } from './world';

/* world (x 0..960, y 0..540) → scene (x, 0, z) centred on the origin */
const OX = W / 2;
const OZ = H / 2;
const toScene = (x: number, y: number) => new THREE.Vector3(x - OX, 0, y - OZ);

const COL = {
  ground: 0x15241b,
  groundHi: 0x22382b,
  lane: 0x33302a,
  laneEdge: 0x4a4a3c,
  steel: 0x4c5e6e,
  steelLight: 0x8aa0b4,
  stone: 0xb8b0a2,
  stoneDark: 0x6f685e,
  brass: 0xf2b31f,
  brassHot: 0xffd96a,
  shield: 0x38e8ff,
  enemy: 0xff3b3b,
  enemyDeep: 0xa8121f,
  orange: 0xff6b4a,
  lime: 0x9cff57,
  ink: 0x070b08,
  moss: 0x243a2f,
  wood: 0x5a4632,
  ember: 0xff9f1c,
};
const ENEMY_COLOR: Record<EnemyKind, number> = { grunt: COL.enemy, runner: COL.orange, brute: COL.enemyDeep, healer: COL.enemy, armored: COL.enemy, swarm: COL.enemy, boss: COL.enemyDeep };

function hash(x: number, y: number) {
  const n = Math.sin(x * 127.1 + y * 311.7) * 43758.5453;
  return n - Math.floor(n);
}
function noise(x: number, y: number) {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const fx = x - xi;
  const fy = y - yi;
  const a = hash(xi, yi);
  const b = hash(xi + 1, yi);
  const c = hash(xi, yi + 1);
  const d = hash(xi + 1, yi + 1);
  const u = fx * fx * (3 - 2 * fx);
  const v = fy * fy * (3 - 2 * fy);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}

const std = (color: number, extra: Partial<THREE.MeshStandardMaterialParameters> = {}) => new THREE.MeshStandardMaterial({ color, flatShading: true, roughness: 0.9, metalness: 0.05, ...extra });
const basic = (color: number | string, extra: Partial<THREE.MeshBasicMaterialParameters> = {}) => new THREE.MeshBasicMaterial({ color: new THREE.Color(color), ...extra });

interface TurretObj {
  group: THREE.Group;
  barrel: THREE.Group;
  cap: THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>;
  flash: THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>;
  ring: THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>;
  /** gatling drum, spins while firing */
  drum: THREE.Object3D | null;
  /** experimental stage: a floating energy ring */
  halo: THREE.Mesh | null;
  kind: TurretKind;
  level: number;
}
interface EnemyObj {
  group: THREE.Group;
  body: THREE.Mesh<THREE.BufferGeometry, THREE.MeshStandardMaterial>;
  bar: THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>;
  barBg: THREE.Mesh;
  kind: EnemyKind;
  r: number;
}

/** Free the GPU side of a subtree; shared geometries are kept. */
function disposeTree(obj: THREE.Object3D, keep: Set<THREE.BufferGeometry>) {
  obj.traverse((o) => {
    const m = o as THREE.Mesh;
    if (m.geometry && !keep.has(m.geometry)) m.geometry.dispose();
    const mats = Array.isArray(m.material) ? m.material : m.material ? [m.material] : [];
    for (const mat of mats) {
      const t = (mat as THREE.MeshBasicMaterial).map;
      if (t) t.dispose();
      mat.dispose();
    }
  });
}

export class Scene3D {
  renderer: THREE.WebGLRenderer;
  scene = new THREE.Scene();
  camera: THREE.PerspectiveCamera;
  controls: OrbitControls;
  composer: EffectComposer;
  bloom: UnrealBloomPass;
  private width = 1;
  private height = 1;
  private mapId = -1;
  private mapGroup = new THREE.Group();
  private mounts: { disc: THREE.Mesh; ring: THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>; range: THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial> }[] = [];
  private fort = new THREE.Group();
  private fortLevel = -1;
  private keepMat: THREE.MeshStandardMaterial | null = null;
  private beacon: THREE.PointLight | null = null;
  private shieldSegs: THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>[] = [];
  private dome: THREE.Mesh | null = null;
  private flags: { mesh: THREE.Mesh; base: Float32Array; w: number }[] = [];
  private cracks: THREE.Mesh[] = [];
  private fires: { mesh: THREE.Mesh; base: number; always: boolean }[] = [];
  private windows: THREE.Mesh[] = [];
  private smoke: THREE.Mesh[] = [];
  private smokeIndex = 0;
  private smokeAt = 0;
  private torches: { light: THREE.PointLight; x: number }[] = [];
  private turrets = new Map<number, TurretObj>();
  private enemies = new Map<number, EnemyObj>();
  private shots: THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>[] = [];
  private bolts: THREE.Line<THREE.BufferGeometry, THREE.LineBasicMaterial>[] = [];
  private waves: THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>[] = [];
  private floats: THREE.Sprite[] = [];
  private floatTex = new Map<string, THREE.CanvasTexture>();
  private barricades: THREE.Group[] = [];
  private drones: THREE.Group[] = [];
  private strikes: THREE.Group[] = [];
  private particles: THREE.Points;
  private partPos: Float32Array;
  private partCol: Float32Array;
  private tintPlane: THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>;
  private flashPlane: THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>;
  private dimPlane: THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>;
  private targetRing: THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>;
  private targetWall: THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>;
  private sky = new THREE.Group();
  private stars: THREE.Points | null = null;
  private starMat: THREE.PointsMaterial | null = null;
  private meteors: { head: THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>; trail: THREE.Line<THREE.BufferGeometry, THREE.LineBasicMaterial>; pos: THREE.Vector3; vel: THREE.Vector3; life: number; max: number; comet: boolean }[] = [];
  private meteorAt = 2;
  private cinematic = false;
  private portraitFit = false;
  private planetRing: THREE.Mesh | null = null;
  private raycaster = new THREE.Raycaster();
  private groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  private geo = {
    sphere: new THREE.SphereGeometry(1, 8, 6),
    cone: new THREE.ConeGeometry(1, 2.2, 6),
    dodeca: new THREE.DodecahedronGeometry(1, 0),
    ico: new THREE.IcosahedronGeometry(1, 0),
    box: new THREE.BoxGeometry(1, 1, 1),
    shot: new THREE.SphereGeometry(3, 6, 4),
    ring: new THREE.RingGeometry(0.92, 1, 40),
    disc: new THREE.CylinderGeometry(26, 26, 3, 24),
    rangeRing: new THREE.RingGeometry(0.97, 1, 64),
    cyl: new THREE.CylinderGeometry(1, 1, 1, 10),
  };
  private readonly MAX_PARTS = 2500;
  private keep = new Set<THREE.BufferGeometry>();

  private lowEnd: boolean;
  private sun: THREE.DirectionalLight;
  constructor(canvas: HTMLCanvasElement, opts: { lowEnd?: boolean } = {}) {
    this.lowEnd = Boolean(opts.lowEnd);
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: !this.lowEnd, powerPreference: 'high-performance' });
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.25;
    this.scene.background = new THREE.Color(0x05070d);
    this.scene.fog = new THREE.FogExp2(0x0a1210, 0.00042);

    this.camera = new THREE.PerspectiveCamera(42, 1, 1, 4000);
    this.camera.position.set(-40, 560, 400);
    this.scene.add(this.camera);
    this.controls = new OrbitControls(this.camera, canvas);
    this.controls.enablePan = false;
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.08;
    this.controls.minDistance = 280;
    this.controls.maxDistance = 900;
    this.controls.minPolarAngle = 0.25;
    this.controls.maxPolarAngle = 1.15;
    this.controls.target.set(0, 0, -10);
    this.controls.update();

    // light: a cold moon, a warm fill from the keep, soft sky
    const hemi = new THREE.HemisphereLight(0xb9c9b0, 0x1a2a20, 1.1);
    this.scene.add(hemi);
    const sun = new THREE.DirectionalLight(0xdbe9ff, 2.4);
    sun.position.set(-300, 500, 200);
    sun.castShadow = true;
    sun.shadow.mapSize.set(this.lowEnd ? 1024 : 2048, this.lowEnd ? 1024 : 2048);
    sun.shadow.camera.left = -620;
    sun.shadow.camera.right = 620;
    sun.shadow.camera.top = 420;
    sun.shadow.camera.bottom = -420;
    sun.shadow.camera.near = 50;
    sun.shadow.camera.far = 1400;
    sun.shadow.bias = -0.0008;
    this.scene.add(sun);

    this.scene.add(this.mapGroup);
    this.scene.add(this.fort);

    this.keep = new Set(Object.values(this.geo));

    // particles
    this.partPos = new Float32Array(this.MAX_PARTS * 3);
    this.partCol = new Float32Array(this.MAX_PARTS * 3);
    const pg = new THREE.BufferGeometry();
    pg.setAttribute('position', new THREE.BufferAttribute(this.partPos, 3));
    pg.setAttribute('color', new THREE.BufferAttribute(this.partCol, 3));
    this.particles = new THREE.Points(pg, new THREE.PointsMaterial({ size: 5, vertexColors: true, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }));
    this.particles.frustumCulled = false;
    this.scene.add(this.particles);

    // full-screen planes on the camera for tint, flash and dim
    const planeGeo = new THREE.PlaneGeometry(2, 2);
    const mkPlane = (color: number) => {
      const m = new THREE.Mesh(planeGeo, basic(color, { transparent: true, opacity: 0, depthTest: false, depthWrite: false }));
      m.renderOrder = 999;
      m.position.set(0, 0, -1.5);
      this.camera.add(m);
      return m;
    };
    this.tintPlane = mkPlane(0xff3b3b);
    this.flashPlane = mkPlane(0xffebc8);
    this.dimPlane = mkPlane(0x070b08);

    this.targetRing = new THREE.Mesh(this.geo.ring, basic(COL.ember, { transparent: true, opacity: 0.8, side: THREE.DoubleSide }));
    this.targetRing.rotation.x = -Math.PI / 2;
    this.targetRing.visible = false;
    this.scene.add(this.targetRing);
    this.targetWall = new THREE.Mesh(this.geo.box, basic(COL.stone, { transparent: true, opacity: 0.6 }));
    this.targetWall.visible = false;
    this.scene.add(this.targetWall);

    this.buildSky();

    this.composer = new EffectComposer(this.renderer);
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    this.bloom = new UnrealBloomPass(new THREE.Vector2(1, 1), this.lowEnd ? 0.35 : 0.55, 0.5, 0.72);
    this.composer.addPass(this.bloom);
    this.sun = sun;
  }

  /* ───────── the sky: stars, nebulae, a ringed planet, a moon, and the meteors ───────── */
  private buildSky() {
    this.scene.add(this.sky);
    // stars on a far dome, in three sizes and warm/cold tints
    const n = 2200;
    const pos = new Float32Array(n * 3);
    const col = new Float32Array(n * 3);
    const tmp = new THREE.Color();
    for (let i = 0; i < n; i++) {
      const u = Math.random();
      const v = Math.random();
      const theta = u * Math.PI * 2;
      const phi = Math.acos(1 - v * 1.15); // mostly above the horizon
      const r = 2600;
      pos[i * 3] = r * Math.sin(phi) * Math.cos(theta);
      pos[i * 3 + 1] = Math.abs(r * Math.cos(phi)) - 200;
      pos[i * 3 + 2] = r * Math.sin(phi) * Math.sin(theta);
      const k = Math.random();
      tmp.set(k < 0.12 ? 0xffd9a0 : k < 0.3 ? 0x9fd6ff : 0xffffff).multiplyScalar(0.45 + Math.random() * 0.75);
      col[i * 3] = tmp.r;
      col[i * 3 + 1] = tmp.g;
      col[i * 3 + 2] = tmp.b;
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    this.starMat = new THREE.PointsMaterial({ size: 6, vertexColors: true, transparent: true, opacity: 0.95, sizeAttenuation: true, fog: false, depthWrite: false });
    this.stars = new THREE.Points(g, this.starMat);
    this.stars.frustumCulled = false;
    this.sky.add(this.stars);

    // nebulae: big soft sprites, additive
    const nebula = (color: string, x: number, y: number, z: number, size: number, alpha: number) => {
      const c = document.createElement('canvas');
      c.width = c.height = 256;
      const x2 = c.getContext('2d')!;
      const grad = x2.createRadialGradient(128, 128, 10, 128, 128, 128);
      grad.addColorStop(0, color);
      grad.addColorStop(0.5, color.replace(')', ',0.35)').replace('rgb(', 'rgba('));
      grad.addColorStop(1, 'rgba(0,0,0,0)');
      x2.fillStyle = grad;
      x2.fillRect(0, 0, 256, 256);
      const tex = new THREE.CanvasTexture(c);
      tex.colorSpace = THREE.SRGBColorSpace;
      const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, opacity: alpha, blending: THREE.AdditiveBlending, depthWrite: false, fog: false }));
      sp.position.set(x, y, z);
      sp.scale.set(size, size, 1);
      this.sky.add(sp);
    };
    nebula('rgb(70,40,120)', -1500, 700, -1800, 2200, 0.5);
    nebula('rgb(20,110,120)', 1700, 500, -1400, 1800, 0.4);
    nebula('rgb(120,30,50)', 600, 900, 1900, 1600, 0.3);

    // a ringed planet low over the horizon, and a small moon
    const planet = new THREE.Mesh(new THREE.SphereGeometry(190, 24, 18), new THREE.MeshStandardMaterial({ color: 0x8a4b3a, emissive: 0x2a0f12, emissiveIntensity: 0.6, roughness: 1, fog: false }));
    planet.position.set(-1500, 520, -1900);
    this.sky.add(planet);
    this.planetRing = new THREE.Mesh(new THREE.RingGeometry(240, 380, 48), new THREE.MeshBasicMaterial({ color: 0xc9a27a, transparent: true, opacity: 0.45, side: THREE.DoubleSide, fog: false }));
    this.planetRing.position.copy(planet.position);
    this.planetRing.rotation.set(1.25, 0.2, 0.3);
    this.sky.add(this.planetRing);
    const moon = new THREE.Mesh(new THREE.SphereGeometry(70, 16, 12), new THREE.MeshStandardMaterial({ color: 0xd8d2c4, emissive: 0x4a4640, emissiveIntensity: 0.5, roughness: 1, fog: false }));
    moon.position.set(1400, 900, -1200);
    this.sky.add(moon);
    const glow = new THREE.PointLight(0xdbe9ff, 0, 0);
    this.sky.add(glow);
  }

  private spawnMeteor(comet: boolean) {
    const head = new THREE.Mesh(this.geo.sphere, new THREE.MeshBasicMaterial({ color: comet ? 0xbfefff : 0xfff3d6, transparent: true, fog: false }));
    head.scale.setScalar(comet ? 9 : 4);
    const tg = new THREE.BufferGeometry();
    tg.setAttribute('position', new THREE.BufferAttribute(new Float32Array(6), 3));
    const trail = new THREE.Line(tg, new THREE.LineBasicMaterial({ color: comet ? 0x8fe3ff : 0xffd9a0, transparent: true, opacity: 0.9, fog: false }));
    const a = Math.random() * Math.PI * 2;
    const pos = new THREE.Vector3(Math.cos(a) * 1900, 900 + Math.random() * 700, Math.sin(a) * 1900);
    const dir = new THREE.Vector3(-Math.cos(a) + (Math.random() - 0.5), -0.45 - Math.random() * 0.4, -Math.sin(a) + (Math.random() - 0.5)).normalize();
    const vel = dir.multiplyScalar(comet ? 320 : 1500 + Math.random() * 900);
    this.sky.add(head);
    this.sky.add(trail);
    this.meteors.push({ head, trail, pos, vel, life: 0, max: comet ? 14 : 1.4 + Math.random() * 0.8, comet });
  }

  private updateSky(dt: number, time: number) {
    if (this.stars && this.starMat) {
      this.stars.rotation.y = time * 0.004;
      this.starMat.opacity = 0.8 + 0.15 * Math.sin(time * 1.7);
    }
    if (this.planetRing) this.planetRing.rotation.z += dt * 0.02;
    this.meteorAt -= dt;
    if (this.meteorAt <= 0) {
      const comet = Math.random() < 0.12 && !this.meteors.some((m) => m.comet);
      this.spawnMeteor(comet);
      this.meteorAt = 1.5 + Math.random() * 4;
    }
    for (let i = this.meteors.length - 1; i >= 0; i--) {
      const m = this.meteors[i];
      m.life += dt;
      m.pos.addScaledVector(m.vel, dt);
      m.head.position.copy(m.pos);
      const k = 1 - m.life / m.max;
      m.head.material.opacity = Math.min(1, k * 2);
      const tail = m.pos.clone().addScaledVector(m.vel, m.comet ? -1.6 : -0.22);
      const arr = m.trail.geometry.attributes.position as THREE.BufferAttribute;
      arr.setXYZ(0, m.pos.x, m.pos.y, m.pos.z);
      arr.setXYZ(1, tail.x, tail.y, tail.z);
      arr.needsUpdate = true;
      m.trail.material.opacity = Math.min(1, k * 2) * 0.9;
      if (m.life >= m.max || m.pos.y < -300) {
        this.sky.remove(m.head);
        this.sky.remove(m.trail);
        m.head.material.dispose();
        m.trail.geometry.dispose();
        m.trail.material.dispose();
        this.meteors.splice(i, 1);
      }
    }
  }

  setSize(w: number, h: number, dpr: number) {
    this.width = Math.max(1, w);
    this.height = Math.max(1, h);
    this.renderer.setPixelRatio(this.lowEnd ? 1 : Math.min(1.5, dpr));
    this.renderer.setSize(this.width, this.height, false);
    this.composer.setSize(this.width, this.height);
    this.bloom.setSize(this.lowEnd ? this.width / 2 : this.width, this.lowEnd ? this.height / 2 : this.height);
    this.camera.aspect = this.width / this.height;
    this.camera.updateProjectionMatrix();
    // a tall screen needs the camera further back to keep the whole field in view
    const portrait = this.camera.aspect < 1;
    if (portrait !== this.portraitFit) {
      this.portraitFit = portrait;
      const dir = this.camera.position.clone().sub(this.controls.target).normalize();
      const dist = portrait ? 980 : 700;
      this.controls.maxDistance = portrait ? 1300 : 900;
      this.camera.position.copy(this.controls.target).addScaledVector(dir, dist);
    }
    // the overlay planes must cover the frustum at z = -1.5
    const hh = Math.tan((this.camera.fov * Math.PI) / 360) * 1.5;
    for (const pl of [this.tintPlane, this.flashPlane, this.dimPlane]) pl.scale.set(hh * this.camera.aspect * 1.05, hh * 1.05, 1);
  }

  /** Screen (css px inside the canvas) → world, on the ground plane. */
  pick(px: number, py: number): [number, number] | null {
    const ndc = new THREE.Vector2((px / this.width) * 2 - 1, -(py / this.height) * 2 + 1);
    this.raycaster.setFromCamera(ndc, this.camera);
    const hit = new THREE.Vector3();
    if (!this.raycaster.ray.intersectPlane(this.groundPlane, hit)) return null;
    return [hit.x + OX, hit.z + OZ];
  }
  /** World → screen css px inside the canvas. */
  toScreen(x: number, y: number): [number, number] {
    const v = toScene(x, y).project(this.camera);
    return [((v.x + 1) / 2) * this.width, ((1 - v.y) / 2) * this.height];
  }

  /* ───────── the static map ───────── */
  private buildMap(m: MapDef) {
    this.mapId = m.id;
    disposeTree(this.mapGroup, this.keep);
    this.mapGroup.clear();
    this.mounts = [];
    for (const t of this.torches) this.scene.remove(t.light);
    this.torches = [];

    // terrain: a big plane with noise, flattened under the lanes, the mounts and the keep
    const size = 1800;
    const seg = 90;
    const g = new THREE.PlaneGeometry(size, size * 0.7, seg, Math.round(seg * 0.7));
    g.rotateX(-Math.PI / 2);
    const pos = g.attributes.position as THREE.BufferAttribute;
    const colors = new Float32Array(pos.count * 3);
    const c1 = new THREE.Color(COL.ground);
    const c2 = new THREE.Color(COL.groundHi);
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i);
      const z = pos.getZ(i);
      const wx = x + OX;
      const wy = z + OZ;
      let h = (noise(wx * 0.012, wy * 0.012) - 0.5) * 36 + (noise(wx * 0.05, wy * 0.05) - 0.5) * 8;
      // flat inside the playfield, rolling hills beyond it
      const inside = wx > -20 && wx < W + 20 && wy > -20 && wy < H + 20;
      const edge = Math.max(0, Math.max(-wx, wx - W, -wy, wy - H));
      const t = Math.min(1, edge / 260);
      const lift = inside ? 0 : t * 34 * noise(wx * 0.006, wy * 0.006) - Math.max(0, edge - 300) * 0.9;
      let flat = 1;
      if (inside) {
        const dl = laneDistance(m, wx, wy);
        flat = Math.min(flat, THREE.MathUtils.smoothstep(dl, 30, 90));
        const df = Math.hypot(wx - m.fort.x, wy - m.fort.y);
        flat = Math.min(flat, THREE.MathUtils.smoothstep(df, 100, 150));
        for (const [sx, sy] of m.slots) flat = Math.min(flat, THREE.MathUtils.smoothstep(Math.hypot(wx - sx, wy - sy), 34, 70));
        h *= flat * 0.35;
      }
      pos.setY(i, h + lift - 1);
      const k = THREE.MathUtils.clamp(0.5 + (h + lift) / 60 + (noise(wx * 0.09, wy * 0.09) - 0.5) * 0.3, 0, 1);
      const col = c1.clone().lerp(c2, k);
      colors[i * 3] = col.r;
      colors[i * 3 + 1] = col.g;
      colors[i * 3 + 2] = col.b;
    }
    g.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    g.computeVertexNormals();
    const ground = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 1 }));
    ground.receiveShadow = true;
    this.mapGroup.add(ground);

    // lanes: packed earth ribbons
    const laneMat = std(COL.lane);
    const edgeMat = std(COL.laneEdge);
    for (const l of m.lanes) {
      for (const s of l.segs) {
        const len = s.len + 40;
        const mid = toScene((s.x0 + s.x1) / 2, (s.y0 + s.y1) / 2);
        const edge = new THREE.Mesh(new THREE.BoxGeometry(len, 2.5, 46), edgeMat);
        edge.position.copy(mid).setY(0.4);
        edge.rotation.y = -s.angle;
        edge.receiveShadow = true;
        this.mapGroup.add(edge);
        const lane = new THREE.Mesh(new THREE.BoxGeometry(len, 3, 36), laneMat);
        lane.position.copy(mid).setY(0.9);
        lane.rotation.y = -s.angle;
        lane.receiveShadow = true;
        this.mapGroup.add(lane);
      }
      // breach marker at the start of the lane
      const [bx, by] = laneAt(l, 10);
      const post = new THREE.Mesh(new THREE.BoxGeometry(6, 44, 6), std(COL.enemyDeep, { emissive: COL.enemyDeep, emissiveIntensity: 0.5 }));
      post.position.copy(toScene(bx, by)).setY(22);
      this.mapGroup.add(post);
    }

    // mounts
    for (const [sx, sy] of m.slots) {
      const disc = new THREE.Mesh(this.geo.disc, std(0x132019));
      disc.position.copy(toScene(sx, sy)).setY(1.5);
      disc.receiveShadow = true;
      this.mapGroup.add(disc);
      const ring = new THREE.Mesh(this.geo.ring, basic(COL.brass, { transparent: true, opacity: 0.25, side: THREE.DoubleSide }));
      ring.rotation.x = -Math.PI / 2;
      ring.position.copy(toScene(sx, sy)).setY(3.4);
      ring.scale.setScalar(28);
      this.mapGroup.add(ring);
      const cross = new THREE.Mesh(new THREE.BoxGeometry(14, 1, 3), basic(0x2a3f33));
      cross.position.copy(toScene(sx, sy)).setY(3.4);
      this.mapGroup.add(cross);
      const cross2 = cross.clone();
      cross2.rotation.y = Math.PI / 2;
      this.mapGroup.add(cross2);
      const range = new THREE.Mesh(this.geo.rangeRing, basic(COL.brass, { transparent: true, opacity: 0.45, side: THREE.DoubleSide }));
      range.rotation.x = -Math.PI / 2;
      range.position.copy(toScene(sx, sy)).setY(3.2);
      range.visible = false;
      this.mapGroup.add(range);
      this.mounts.push({ disc, ring, range });
    }

    // courtyard
    const yard = new THREE.Mesh(new THREE.CylinderGeometry(92, 96, 3, 36), std(0x121c17));
    yard.position.copy(toScene(m.fort.x, m.fort.y)).setY(1);
    yard.receiveShadow = true;
    this.mapGroup.add(yard);

    // decor
    const rockMat = std(COL.stoneDark);
    const bushMat = std(COL.moss);
    for (const d of m.decor) {
      const p = toScene(d.x, d.y);
      if (d.kind === 'rock' || d.kind === 'rock2' || d.kind === 'rubble') {
        const r = d.kind === 'rock' ? 9 : d.kind === 'rock2' ? 6 : 4;
        const rock = new THREE.Mesh(this.geo.dodeca, rockMat);
        rock.position.copy(p).setY(r * 0.6);
        rock.scale.set(r * (1 + hash(d.x, d.y) * 0.6), r * 0.8, r);
        rock.rotation.y = hash(d.y, d.x) * 3;
        rock.castShadow = true;
        this.mapGroup.add(rock);
      } else if (d.kind === 'bush') {
        const b = new THREE.Mesh(this.geo.ico, bushMat);
        b.position.copy(p).setY(5);
        b.scale.set(8, 6, 8);
        b.castShadow = true;
        this.mapGroup.add(b);
      } else if (d.kind === 'crater') {
        const c = new THREE.Mesh(new THREE.RingGeometry(8, 13, 12), std(0x0a120d, { side: THREE.DoubleSide }));
        c.rotation.x = -Math.PI / 2;
        c.position.copy(p).setY(0.6);
        this.mapGroup.add(c);
      } else if (d.kind === 'flag') {
        const pole = new THREE.Mesh(new THREE.BoxGeometry(1.5, 30, 1.5), std(COL.ink));
        pole.position.copy(p).setY(15);
        this.mapGroup.add(pole);
        const flag = new THREE.Mesh(new THREE.BoxGeometry(10, 7, 0.6), std(COL.enemy, { emissive: COL.enemyDeep, emissiveIntensity: 0.4 }));
        flag.position.copy(p).add(new THREE.Vector3(5.5, 25, 0));
        this.mapGroup.add(flag);
      } else if (d.kind === 'torch') {
        const pole = new THREE.Mesh(new THREE.BoxGeometry(2, 18, 2), std(COL.wood));
        pole.position.copy(p).setY(9);
        this.mapGroup.add(pole);
        const fire = new THREE.Mesh(new THREE.ConeGeometry(3, 7, 6), basic(COL.ember));
        fire.position.copy(p).setY(21);
        this.mapGroup.add(fire);
        const light = new THREE.PointLight(COL.ember, 900, 140, 1.8);
        light.position.copy(p).setY(24);
        this.scene.add(light);
        this.torches.push({ light, x: d.x });
      } else if (d.kind === 'bones') {
        const sk = new THREE.Mesh(this.geo.sphere, std(0xe8e2d6));
        sk.position.copy(p).setY(3);
        sk.scale.set(3.5, 3, 3);
        this.mapGroup.add(sk);
      }
    }
    this.fortLevel = -1;
  }

  /* ───────── the fortress: a castle that grows through five stages ───────── */
  private buildFortress(m: MapDef, level: number) {
    this.fortLevel = level;
    disposeTree(this.fort, this.keep);
    this.fort.clear();
    if (this.beacon) {
      this.scene.remove(this.beacon);
      this.beacon = null;
    }
    this.fort.position.copy(toScene(m.fort.x, m.fort.y));
    this.flags = [];
    this.cracks = [];
    this.fires = [];
    this.windows = [];
    const stone = std(COL.stone);
    const stoneDark = std(COL.stoneDark);
    const wood = std(COL.wood);
    const woodDark = std(0x3a2c1e);
    const iron = std(0x3b4a56, { metalness: 0.5, roughness: 0.45 });
    const ironLight = std(COL.steelLight, { metalness: 0.45, roughness: 0.5 });
    const brass = std(COL.brass, { metalness: 0.5, roughness: 0.4, emissive: COL.brass, emissiveIntensity: 0.15 });
    const roofRed = std(COL.enemyDeep);
    this.keepMat = stone;
    const F = this.fort;
    const add = (mesh: THREE.Mesh, x: number, y: number, z: number, ry = 0) => {
      mesh.position.set(x, y, z);
      mesh.rotation.y = ry;
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      F.add(mesh);
      return mesh;
    };
    const box = (w: number, h: number, d: number, mat: THREE.Material, x: number, y: number, z: number, ry = 0) => add(new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat), x, y, z, ry);
    const cyl = (r: number, h: number, mat: THREE.Material, x: number, y: number, z: number, seg = 10, rTop = r) => add(new THREE.Mesh(new THREE.CylinderGeometry(rTop, r, h, seg), mat), x, y, z);
    const cone = (r: number, h: number, mat: THREE.Material, x: number, y: number, z: number, seg = 10) => add(new THREE.Mesh(new THREE.ConeGeometry(r, h, seg), mat), x, y, z);
    /** merlons along a wall segment from (x0,z0) to (x1,z1) */
    const battlement = (x0: number, z0: number, x1: number, z1: number, y: number, mat: THREE.Material, size = 4) => {
      const len = Math.hypot(x1 - x0, z1 - z0);
      const n = Math.floor(len / (size * 2));
      for (let i = 0; i <= n; i++) {
        const t = n === 0 ? 0 : i / n;
        box(size, size, size, mat, x0 + (x1 - x0) * t, y + size / 2, z0 + (z1 - z0) * t);
      }
    };
    const flag = (x: number, y: number, z: number, color: number, w = 14, h = 9) => {
      const pole = box(1.2, 28, 1.2, std(COL.ink), x, y + 14, z);
      pole.castShadow = false;
      const geo = new THREE.PlaneGeometry(w, h, 8, 3);
      const mesh = new THREE.Mesh(geo, std(color, { side: THREE.DoubleSide, emissive: color, emissiveIntensity: 0.25 }));
      mesh.position.set(x + w / 2 + 0.6, y + 24, z);
      mesh.castShadow = true;
      F.add(mesh);
      this.flags.push({ mesh, base: (geo.attributes.position as THREE.BufferAttribute).array.slice() as Float32Array, w });
    };
    const windowLight = (x: number, y: number, z: number, ry: number) => {
      const wnd = box(1.2, 4, 2.4, basic(0xffb347), x, y, z, ry);
      wnd.castShadow = false;
      this.windows.push(wnd);
    };
    const torch = (x: number, y: number, z: number) => {
      const fire = cone(2.2, 5, basic(COL.ember), x, y + 3, z, 6);
      fire.castShadow = false;
      this.fires.push({ mesh: fire, base: 1, always: true });
      box(1.4, 8, 1.4, woodDark, x, y - 3, z);
    };
    /** cracks that show once the gate is hurt; hidden until then */
    const crack = (x: number, y: number, z: number, ry: number, len = 10) => {
      const c = box(0.8, len, 0.8, std(COL.ink), x, y, z, ry);
      c.rotation.z = 0.45;
      c.castShadow = false;
      c.visible = false;
      this.cracks.push(c);
    };
    /** smoke and fire at the gatehouse, shown only when the gate is nearly down */
    const damageFire = (x: number, y: number, z: number) => {
      const fire = cone(4, 10, basic(COL.ember), x, y + 5, z, 6);
      fire.castShadow = false;
      fire.visible = false;
      this.fires.push({ mesh: fire, base: 1.3, always: false });
    };

    const gateX = -50; // the lane comes from -x
    if (level === 1) {
      // palisade: sharpened posts, a wooden keep with a plank roof, torches at the gap
      for (let i = 0; i < 26; i++) {
        const a = (i / 26) * Math.PI * 2;
        if (Math.abs(a - Math.PI) < 0.22) continue; // the gap faces the lane
        const x = Math.cos(a) * 52;
        const z = Math.sin(a) * 52;
        box(5, 18 + hash(i, 3) * 4, 5, wood, x, 9, z, -a);
        cone(3.4, 6, woodDark, x, 21 + hash(i, 3) * 4, z, 4);
      }
      box(30, 26, 30, wood, 0, 13, 0);
      cone(24, 14, woodDark, 0, 33, 0, 4).rotation.y = Math.PI / 4;
      windowLight(-15.2, 14, 0, 0);
      windowLight(0, 14, 15.2, Math.PI / 2);
      torch(-50, 20, -14);
      torch(-50, 20, 14);
      crack(-14, 10, 6, 0, 8);
      damageFire(-16, 2, 0);
      flag(12, 40, 12, COL.enemy, 10, 7);
    } else {
      const half = 50;
      const wallH = 18;
      const wallT = 6;
      const wallMat = level >= 3 ? ironLight : stone;
      // four walls with a gate opening on the lane side
      box(half * 2, wallH, wallT, wallMat, 0, wallH / 2, -half);
      box(half * 2, wallH, wallT, wallMat, 0, wallH / 2, half);
      box(wallT, wallH, half * 2, wallMat, half, wallH / 2, 0);
      box(wallT, wallH, half - 14, wallMat, gateX, wallH / 2, -half + (half - 14) / 2);
      box(wallT, wallH, half - 14, wallMat, gateX, wallH / 2, half - (half - 14) / 2);
      battlement(-half, -half, half, -half, wallH, stoneDark);
      battlement(-half, half, half, half, wallH, stoneDark);
      battlement(half, -half, half, half, wallH, stoneDark);
      // gatehouse: two round towers, an arch, a portcullis
      for (const z of [-14, 14]) {
        cyl(9, 32, stone, gateX, 16, z);
        cone(11, 10, level >= 4 ? brass : roofRed, gateX, 37, z);
        torch(gateX - 9, 20, z);
      }
      box(8, 6, 20, stoneDark, gateX, wallH + 3, 0);
      for (let i = -3; i <= 3; i++) {
        const bar = box(1, 16, 1, iron, gateX - 2, 8, i * 2.6);
        bar.castShadow = false;
      }
      crack(gateX - 3.5, 10, -22, 0, 12);
      crack(gateX - 3.5, 12, 24, 0, 10);
      crack(0, 9, -half - 3.5, 0, 12);
      damageFire(gateX - 8, 2, 0);
      damageFire(-20, 2, -30);
      // iron plating from stage 3
      if (level >= 3) {
        for (let i = -3; i <= 3; i++) {
          box(12, 10, 1.2, iron, i * 14, 7, -half - wallT / 2 - 0.3);
          box(12, 10, 1.2, iron, i * 14, 7, half + wallT / 2 + 0.3);
          box(1.2, 10, 12, iron, half + wallT / 2 + 0.3, 7, i * 14);
        }
      }
      // corner towers: two on stage 2, four from stage 3, with cannons from stage 3
      const corners: [number, number][] = level >= 3 ? [[-half, -half], [half, -half], [-half, half], [half, half]] : [[half, -half], [half, half]];
      for (const [cx, cz] of corners) {
        cyl(10, 34, level >= 3 ? ironLight : stone, cx, 17, cz, 10);
        cone(12.5, 12, level >= 4 ? brass : level >= 3 ? iron : roofRed, cx, 40, cz, 10);
        if (level >= 3) {
          const cannon = box(14, 3.5, 3.5, iron, cx + (cx < 0 ? -4 : 4), 36, cz);
          cannon.rotation.y = Math.atan2(-cz, -cx) + Math.PI;
          cannon.rotation.z = 0.15;
        }
        if (level >= 4) {
          const lamp = add(new THREE.Mesh(this.geo.sphere, basic(0xffd27a)), cx, 47, cz);
          lamp.scale.setScalar(2.2);
          lamp.castShadow = false;
        }
      }
      // the keep: taller than the walls, tiered on stage 4+
      const kw = 40;
      const kh = level >= 4 ? 40 : level >= 3 ? 36 : 32;
      box(kw, kh, kw, stone, 4, kh / 2, 0);
      battlement(4 - kw / 2, -kw / 2, 4 + kw / 2, -kw / 2, kh, stoneDark, 3.5);
      battlement(4 - kw / 2, kw / 2, 4 + kw / 2, kw / 2, kh, stoneDark, 3.5);
      battlement(4 - kw / 2, -kw / 2, 4 - kw / 2, kw / 2, kh, stoneDark, 3.5);
      battlement(4 + kw / 2, -kw / 2, 4 + kw / 2, kw / 2, kh, stoneDark, 3.5);
      if (level >= 3) box(kw + 1, 3, kw + 1, iron, 4, kh * 0.55, 0);
      windowLight(4 - kw / 2 - 0.3, kh * 0.5, -8, 0);
      windowLight(4 - kw / 2 - 0.3, kh * 0.5, 8, 0);
      windowLight(4, kh * 0.5, kw / 2 + 0.3, Math.PI / 2);
      windowLight(4, kh * 0.5, -kw / 2 - 0.3, Math.PI / 2);
      crack(4 - kw / 2 - 0.6, kh * 0.4, 4, 0, 14);
      if (level >= 4) {
        box(26, 22, 26, stone, 4, kh + 11, 0);
        battlement(-9, -13, 17, -13, kh + 22, stoneDark, 3);
        battlement(-9, 13, 17, 13, kh + 22, stoneDark, 3);
        cyl(7, 46, ironLight, 4, kh + 22 + 10, 0, 10);
        cone(9.5, 16, brass, 4, kh + 22 + 33 + 8, 0, 10);
        windowLight(4 - 13.3, kh + 12, 0, 0);
        for (const [bx, bz] of [[-30, -half - 4], [30, -half - 4], [-30, half + 4], [30, half + 4]]) {
          const banner = box(6, 14, 0.6, brass, bx, wallH - 2, bz);
          banner.castShadow = false;
        }
        flag(half - 6, wallH + 4, -half + 6, COL.brass);
        flag(4 + 6, kh + 22 + 40, 6, COL.brassHot, 12, 8);
      } else {
        cone(14, 12, roofRed, 4, kh + 6, 0, 4).rotation.y = Math.PI / 4;
        flag(half - 6, wallH + 4, -half + 6, COL.enemy);
        flag(4 + 8, kh + 10, 8, level >= 3 ? COL.brass : COL.enemy, 12, 8);
      }
      if (level >= 5) {
        const orb = add(new THREE.Mesh(this.geo.sphere, basic(COL.brassHot)), 4, kh + 22 + 33 + 20, 0);
        orb.scale.setScalar(6);
        orb.castShadow = false;
        this.beacon = new THREE.PointLight(COL.brassHot, 4000, 360, 1.6);
        this.beacon.position.copy(this.fort.position).setY(kh + 90);
        this.scene.add(this.beacon);
      }
    }
    // courtyard paving and a ditch ring
    const ditch = new THREE.Mesh(new THREE.RingGeometry(78, 90, 40), std(0x0a120d, { side: THREE.DoubleSide }));
    ditch.rotation.x = -Math.PI / 2;
    ditch.position.y = 0.6;
    F.add(ditch);

    // the shield: 28 arcs at the foot of a dome that fills with the war chest
    for (const s of this.shieldSegs) {
      this.scene.remove(s);
      disposeTree(s, this.keep);
    }
    this.shieldSegs = [];
    const segs = 28;
    for (let i = 0; i < segs; i++) {
      const a0 = (i / segs) * Math.PI * 2;
      const arc = new THREE.Mesh(new THREE.TorusGeometry(100, 2.2, 6, 6, (Math.PI * 2 * 0.72) / segs), basic(COL.shield, { transparent: true, opacity: 0.3 }));
      arc.rotation.x = Math.PI / 2;
      arc.rotation.z = -a0;
      arc.position.copy(this.fort.position).setY(6);
      this.scene.add(arc);
      this.shieldSegs.push(arc);
    }
    if (this.dome) {
      this.scene.remove(this.dome);
      disposeTree(this.dome, this.keep);
    }
    this.dome = new THREE.Mesh(new THREE.SphereGeometry(100, 28, 14, 0, Math.PI * 2, 0, Math.PI / 2), new THREE.MeshBasicMaterial({ color: COL.shield, transparent: true, opacity: 0.08, side: THREE.DoubleSide, depthWrite: false, blending: THREE.AdditiveBlending }));
    this.dome.position.copy(this.fort.position).setY(2);
    this.scene.add(this.dome);
  }

  /** Per-frame life of the castle: flags in the wind, windows, torches, cracks and fire by gate HP, the dome by the chest. */
  private animateFortress(sim: Sim, input: WorldInput, dt: number) {
    const s = sim.s;
    const t = s.time;
    for (const f of this.flags) {
      const pos = f.mesh.geometry.attributes.position as THREE.BufferAttribute;
      for (let i = 0; i < pos.count; i++) {
        const x = f.base[i * 3];
        const k = (x + f.w / 2) / f.w; // 0 at the pole, 1 at the tip
        pos.setZ(i, Math.sin(t * 6 + k * 5) * 2.2 * k);
        pos.setY(i, f.base[i * 3 + 1] + Math.sin(t * 4 + k * 3) * 0.8 * k);
      }
      pos.needsUpdate = true;
      f.mesh.geometry.computeVertexNormals();
    }
    const hp = s.maxHp > 0 ? s.hp / s.maxHp : 1;
    const playing = sim.playing || s.status === 'over';
    for (const c of this.cracks) c.visible = playing && hp < 0.6;
    for (const f of this.fires) {
      const burning = f.always || (playing && hp < 0.35);
      f.mesh.visible = burning;
      if (burning) {
        const k = 0.8 + 0.35 * Math.sin(t * 17 + f.mesh.position.x) + 0.15 * Math.sin(t * 29 + f.mesh.position.z);
        f.mesh.scale.set(f.base * k, f.base * (1.2 + 0.4 * Math.sin(t * 13 + f.mesh.position.z)), f.base * k);
      }
    }
    // smoke drifts up from each damage fire
    if (playing && hp < 0.35) {
      this.smokeAt -= dt;
      if (this.smokeAt <= 0) {
        this.smokeAt = 0.12;
        for (const f of this.fires) {
          if (f.always) continue;
          const puff = this.pooled(this.smoke, this.smokeIndex++ % 60, () => {
            const m = new THREE.Mesh(this.geo.sphere, basic(0x2a2d2c, { transparent: true, opacity: 0.5 }));
            m.castShadow = false;
            return m;
          });
          puff.visible = true;
          puff.position.copy(this.fort.position).add(f.mesh.position).add(new THREE.Vector3((Math.random() - 0.5) * 6, 6, (Math.random() - 0.5) * 6));
          puff.scale.setScalar(3);
          puff.userData.life = 0;
        }
      }
    }
    for (const puff of this.smoke) {
      if (!puff.visible) continue;
      puff.userData.life = (puff.userData.life ?? 0) + dt;
      const life = puff.userData.life as number;
      puff.position.y += dt * 22;
      puff.position.x += Math.sin(t * 2 + puff.position.z) * dt * 4;
      puff.scale.setScalar(3 + life * 7);
      (puff.material as THREE.MeshBasicMaterial).opacity = Math.max(0, 0.45 - life * 0.2);
      if (life > 2.2) puff.visible = false;
    }
    for (const w of this.windows) (w.material as THREE.MeshBasicMaterial).color.setHex(0.5 + 0.5 * Math.sin(t * 3 + w.position.x + w.position.z) > 0.8 ? 0xffd27a : 0xffb347);
    if (this.dome) {
      const full = input.fill >= 0.999;
      const mat = this.dome.material as THREE.MeshBasicMaterial;
      mat.color.setHex(full ? COL.brassHot : COL.shield);
      mat.opacity = 0.02 + input.fill * 0.16 + (full ? 0.05 * Math.sin(t * 5) : 0) + s.shieldFlicker * 0.25;
      this.dome.scale.setScalar(1 + s.shieldFlicker * 0.04);
      this.dome.rotation.y = t * 0.1;
    }
  }

  /* ───────── dynamic objects ───────── */
  /** A gun's body for its kind and level: every upgrade changes the shape, not just a colour. */
  private turretObj(t: Sim['s']['turrets'][number], m: MapDef): TurretObj {
    let o = this.turrets.get(t.slot);
    if (o && o.kind === t.kind && o.level === t.level) return o;
    if (o) {
      this.scene.remove(o.group);
      disposeTree(o.group, this.keep);
    }
    const def = TURRETS[t.kind];
    const L = t.level;
    const exp = L >= EXPERIMENTAL_LEVEL;
    const group = new THREE.Group();
    const [sx, sy] = m.slots[t.slot];
    group.position.copy(toScene(sx, sy));
    const steel = std(COL.steel);
    const light = std(COL.steelLight);
    const brass = std(COL.brass, { metalness: 0.4, roughness: 0.5 });
    const dark = std(0x2b3640);

    // base grows with the level: bolts at 2, armour plates at 3, a floating halo at 4
    const br = 14 + L * 1.5;
    const base = new THREE.Mesh(new THREE.CylinderGeometry(br, br + 2, 8 + L, 10), steel);
    base.position.y = (8 + L) / 2 + 2;
    base.castShadow = true;
    group.add(base);
    if (L >= 2) {
      for (let i = 0; i < 6; i++) {
        const a = (i / 6) * Math.PI * 2;
        const bolt = new THREE.Mesh(this.geo.cyl, brass);
        bolt.scale.set(1.6, 2, 1.6);
        bolt.position.set(Math.cos(a) * (br - 2), 8 + L + 2.5, Math.sin(a) * (br - 2));
        group.add(bolt);
      }
    }
    if (L >= 3) {
      for (let i = 0; i < 4; i++) {
        const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
        const plate = new THREE.Mesh(new THREE.BoxGeometry(12, 10, 3), dark);
        plate.position.set(Math.cos(a) * (br + 1), 7, Math.sin(a) * (br + 1));
        plate.rotation.y = -a + Math.PI / 2;
        group.add(plate);
      }
    }
    const ringColor = exp ? 0xffffff : L === 3 ? COL.brassHot : L === 2 ? COL.brass : COL.steelLight;
    const ring = new THREE.Mesh(new THREE.TorusGeometry(br + 1, 1.6, 6, 16), basic(ringColor));
    ring.rotation.x = Math.PI / 2;
    ring.position.y = 8 + L + 2.5;
    group.add(ring);
    let halo: THREE.Mesh | null = null;
    if (exp) {
      halo = new THREE.Mesh(new THREE.TorusGeometry(br + 8, 1.2, 6, 24), basic(0xffffff, { transparent: true, opacity: 0.8 }));
      halo.rotation.x = Math.PI / 2;
      halo.position.y = 26;
      group.add(halo);
      const core = new THREE.Mesh(this.geo.sphere, basic(0xffffff));
      core.scale.setScalar(3.5);
      core.position.y = 24;
      group.add(core);
    }

    // the gun itself
    const barrel = new THREE.Group();
    barrel.position.y = 12 + L;
    let drum: THREE.Object3D | null = null;
    const box = (w: number, h: number, d: number, mat: THREE.Material, x: number, y = 0, z = 0) => {
      const b = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
      b.position.set(x, y, z);
      b.castShadow = true;
      barrel.add(b);
      return b;
    };
    if (t.kind === 'sentry') {
      if (L === 1) box(22, 6, 7, light, 10);
      else if (L === 2) {
        box(28, 6, 7, light, 13);
        box(5, 9, 10, dark, 26);
      } else {
        box(30, 5, 5, light, 14, 0, -4);
        box(30, 5, 5, light, 14, 0, 4);
        box(10, 8, 14, dark, 4);
        if (exp) box(8, 4, 4, basic(0xffffff), 30);
      }
    } else if (t.kind === 'gatling') {
      if (L === 1) {
        box(24, 4, 4, light, 12, 0, -3.5);
        box(24, 4, 4, light, 12, 0, 3.5);
      } else if (L === 2) {
        for (let i = 0; i < 3; i++) {
          const a = (i / 3) * Math.PI * 2;
          box(26, 3.5, 3.5, light, 13, Math.cos(a) * 4, Math.sin(a) * 4);
        }
        box(6, 10, 10, dark, 2);
      } else {
        drum = new THREE.Group();
        drum.position.x = 14;
        for (let i = 0; i < 6; i++) {
          const a = (i / 6) * Math.PI * 2;
          const rod = new THREE.Mesh(new THREE.BoxGeometry(30, 3, 3), light);
          rod.position.set(0, Math.cos(a) * 5.5, Math.sin(a) * 5.5);
          drum.add(rod);
        }
        const hub = new THREE.Mesh(new THREE.CylinderGeometry(7, 7, 8, 8), dark);
        hub.rotation.z = Math.PI / 2;
        hub.position.x = -8;
        drum.add(hub);
        barrel.add(drum);
        box(8, 12, 9, brass, -6, 4, 6); // ammo box
        if (exp) box(6, 5, 5, basic(0xffffff), 30);
      }
    } else if (t.kind === 'tesla') {
      box(10 + L * 2, 4, 5, light, 5 + L);
      const orb = new THREE.Mesh(this.geo.sphere, basic(COL.shield));
      orb.scale.setScalar(5 + L * 1.5);
      orb.position.x = 14 + L * 2;
      barrel.add(orb);
      if (L >= 2) {
        for (const z of [-5, 5]) {
          const prong = new THREE.Mesh(new THREE.BoxGeometry(12, 2, 2), brass);
          prong.position.set(18 + L, 2, z);
          barrel.add(prong);
        }
      }
      if (L >= 3) {
        for (let i = 0; i < 3; i++) {
          const coil = new THREE.Mesh(new THREE.TorusGeometry(5, 1, 6, 12), brass);
          coil.rotation.y = Math.PI / 2;
          coil.position.x = 2 + i * 4;
          barrel.add(coil);
        }
      }
      if (exp) orb.material = basic(0xffffff);
    } else if (t.kind === 'rail') {
      if (L === 1) {
        box(36, 6, 7, light, 16);
        box(8, 4, 4, brass, 32);
      } else {
        box(42 + L * 2, 3, 3, light, 20, 2.5);
        box(42 + L * 2, 3, 3, light, 20, -2.5);
        box(12, 8, 8, dark, 2);
        box(6, 4, 7, brass, 40 + L);
        if (L >= 3) {
          for (const z of [-7, 7]) {
            const cap = new THREE.Mesh(new THREE.CylinderGeometry(3.5, 3.5, 12, 8), exp ? basic(0xffffff) : brass);
            cap.rotation.z = Math.PI / 2;
            cap.position.set(10, 0, z);
            barrel.add(cap);
          }
        }
      }
    } else {
      const cone = new THREE.Mesh(new THREE.ConeGeometry(5 + L, 24 + L * 3, 6), std(COL.lime));
      cone.rotation.z = -Math.PI / 2;
      cone.position.x = 12 + L;
      barrel.add(cone);
      if (L >= 2) {
        const dish = new THREE.Mesh(new THREE.CylinderGeometry(8 + L * 2, 6, 3, 12), light);
        dish.rotation.z = Math.PI / 2;
        dish.position.x = -2;
        barrel.add(dish);
      }
      if (L >= 3) {
        for (const z of [-9, 9]) {
          box(2, 16, 2, brass, -4, 8, z);
        }
      }
      if (exp) cone.material = std(0xffffff, { emissive: 0xffffff, emissiveIntensity: 0.6 });
    }
    group.add(barrel);

    const cap = new THREE.Mesh(this.geo.box, basic(def.color));
    cap.scale.setScalar(6 + L);
    cap.position.y = 13 + L;
    group.add(cap);
    const flash = new THREE.Mesh(this.geo.sphere, basic(COL.brassHot, { transparent: true, opacity: 0.9 }));
    flash.visible = false;
    group.add(flash);
    this.scene.add(group);
    o = { group, barrel, cap, flash, ring, drum, halo, kind: t.kind, level: t.level };
    this.turrets.set(t.slot, o);
    return o;
  }

  private enemyObj(e: Enemy): EnemyObj {
    let o = this.enemies.get(e.id);
    if (o) return o;
    const group = new THREE.Group();
    const mat = std(ENEMY_COLOR[e.kind], { emissive: ENEMY_COLOR[e.kind], emissiveIntensity: 0.15 });
    let body: THREE.Mesh<THREE.BufferGeometry, THREE.MeshStandardMaterial>;
    if (e.kind === 'runner') {
      body = new THREE.Mesh(this.geo.cone, mat);
      body.rotation.z = -Math.PI / 2;
    } else if (e.kind === 'brute') body = new THREE.Mesh(this.geo.dodeca, mat);
    else if (e.kind === 'boss') body = new THREE.Mesh(this.geo.ico, mat);
    else body = new THREE.Mesh(this.geo.sphere, mat);
    body.scale.setScalar(e.r);
    body.castShadow = true;
    group.add(body);
    // eyes
    const eye = new THREE.Mesh(this.geo.box, basic(e.kind === 'brute' || e.kind === 'boss' ? COL.brassHot : COL.ink));
    eye.scale.setScalar(e.r * 0.22);
    eye.position.set(e.r * 0.8, e.r * 0.25, e.r * 0.35);
    group.add(eye);
    const eye2 = eye.clone();
    eye2.position.z = -e.r * 0.35;
    group.add(eye2);
    if (e.kind === 'healer') {
      const c1 = new THREE.Mesh(this.geo.box, basic(COL.lime));
      c1.scale.set(e.r * 0.3, e.r * 1.1, e.r * 0.3);
      c1.position.y = e.r * 0.9;
      group.add(c1);
      const c2 = c1.clone();
      c2.scale.set(e.r * 1.1, e.r * 0.3, e.r * 0.3);
      group.add(c2);
    }
    if (e.kind === 'armored') {
      const band = new THREE.Mesh(new THREE.TorusGeometry(e.r * 1.02, e.r * 0.22, 6, 12), std(COL.steelLight, { metalness: 0.5, roughness: 0.4 }));
      band.rotation.x = Math.PI / 2;
      group.add(band);
    }
    if (e.kind === 'boss') {
      for (let i = 0; i < 8; i++) {
        const a = (i / 8) * Math.PI * 2;
        const spike = new THREE.Mesh(new THREE.ConeGeometry(e.r * 0.22, e.r * 0.8, 5), std(COL.enemy));
        spike.position.set(Math.cos(a) * e.r * 0.95, 0, Math.sin(a) * e.r * 0.95);
        spike.lookAt(new THREE.Vector3(Math.cos(a) * e.r * 3, 0, Math.sin(a) * e.r * 3));
        spike.rotateX(Math.PI / 2);
        group.add(spike);
      }
    }
    const barBg = new THREE.Mesh(this.geo.box, basic(COL.ink));
    barBg.scale.set(e.kind === 'boss' ? 60 : e.kind === 'swarm' ? 12 : 22, 3, 1);
    barBg.position.y = e.r * 2 + 10;
    barBg.visible = false;
    group.add(barBg);
    const bar = new THREE.Mesh(this.geo.box, basic(e.kind === 'boss' ? COL.enemy : COL.brassHot));
    bar.position.y = e.r * 2 + 10;
    bar.visible = false;
    group.add(bar);
    this.scene.add(group);
    o = { group, body, bar, barBg, kind: e.kind, r: e.r };
    this.enemies.set(e.id, o);
    return o;
  }

  private floatTexture(text: string, color: string): THREE.CanvasTexture {
    const key = `${text}|${color}`;
    let t = this.floatTex.get(key);
    if (t) return t;
    const c = document.createElement('canvas');
    c.width = 160;
    c.height = 48;
    const x = c.getContext('2d')!;
    x.font = '700 26px "Chakra Petch", sans-serif';
    x.textAlign = 'center';
    x.textBaseline = 'middle';
    x.fillStyle = '#070b08';
    x.fillText(text, 82, 26);
    x.fillStyle = color;
    x.fillText(text, 80, 24);
    t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    if (this.floatTex.size >= 96) {
      const oldest = this.floatTex.keys().next().value as string;
      this.floatTex.get(oldest)?.dispose();
      this.floatTex.delete(oldest);
    }
    this.floatTex.set(key, t);
    return t;
  }

  private pooled<T extends THREE.Object3D>(pool: T[], i: number, make: () => T): T {
    while (pool.length <= i) {
      const o = make();
      this.scene.add(o);
      pool.push(o);
    }
    return pool[i];
  }

  /* ───────── the frame ───────── */
  render(sim: Sim, input: WorldInput, hover: number | null, selected: number | null, targeting: Targeting | null, dt: number) {
    const s = sim.s;
    const m = sim.map;
    if (m.id !== this.mapId) this.buildMap(m);
    const level = fortressStage(input.burnedPct).level;
    if (level !== this.fortLevel) this.buildFortress(m, level);
    const camYaw = Math.atan2(this.camera.position.x - this.controls.target.x, this.camera.position.z - this.controls.target.z);
    this.updateSky(dt, s.time);

    // keep: hit shake and flash
    const hit = s.fortHit > 0 ? Math.sin(s.fortHit * 40) * 3 : 0;
    this.fort.position.copy(toScene(m.fort.x + hit, m.fort.y));
    if (this.keepMat) this.keepMat.emissive.setRGB(s.fortHit * 0.8, 0, 0);
    this.animateFortress(sim, input, dt);
    // shield arcs
    const lit = Math.round(Math.max(0, Math.min(1, input.fill)) * this.shieldSegs.length);
    const full = input.fill >= 0.999;
    this.shieldSegs.forEach((seg, i) => {
      const on = i < lit;
      seg.material.color.set(on ? (full ? COL.brassHot : COL.shield) : 0x1f3129);
      seg.material.opacity = Math.min(1, (on ? 0.7 + 0.3 * Math.sin(s.time * 4 + i * 0.4) : 0.3) + s.shieldFlicker);
      seg.scale.setScalar(1 + s.shieldFlicker * 0.3);
    });
    // torches flicker
    for (const t of this.torches) t.light.intensity = 700 + 300 * Math.sin(s.time * 9 + t.x);

    // mounts
    const bySlot = new Map<number, Sim['s']['turrets'][number]>();
    for (const t of s.turrets) bySlot.set(t.slot, t);
    this.mounts.forEach((mo, i) => {
      const t = bySlot.get(i);
      const hot = i === hover || i === selected;
      mo.ring.material.opacity = hot ? 0.95 : t ? 0.15 : 0.3;
      mo.ring.material.color.set(i === selected ? COL.brassHot : COL.brass);
      if (i === selected && t) {
        const def = TURRETS[t.kind];
        mo.range.visible = true;
        mo.range.scale.setScalar(def.range * (1 + (t.level - 1) * 0.12));
      } else mo.range.visible = false;
    });

    // turrets
    const alive = new Set<number>();
    for (const t of s.turrets) {
      alive.add(t.slot);
      const o = this.turretObj(t, m);
      o.barrel.rotation.y = -t.angle;
      o.barrel.position.x = -Math.cos(t.angle) * t.recoil * 5;
      o.barrel.position.z = -Math.sin(t.angle) * t.recoil * 5;
      if (o.drum) o.drum.rotation.x += (t.recoil > 0 ? 18 : 1.5) * dt;
      if (o.halo) {
        o.halo.rotation.z = s.time * 1.4;
        o.halo.position.y = 26 + Math.sin(s.time * 3 + t.slot) * 2;
      }
      const over = s.overcharge > 0 && Math.sin(s.time * 20) > 0;
      o.cap.material.color.set(over ? COL.brassHot : t.level >= EXPERIMENTAL_LEVEL ? 0xffffff : (TURRETS[t.kind].color as string));
      if (t.flash > 0) {
        const mx = t.kind === 'rail' ? 36 : 28;
        o.flash.visible = true;
        o.flash.position.set(Math.cos(t.angle) * (mx + t.level * 2), 12 + t.level, Math.sin(t.angle) * (mx + t.level * 2));
        o.flash.scale.setScalar(t.flash > 0.1 ? 10 : 6);
        o.flash.material.opacity = Math.min(1, t.flash / 0.09);
      } else o.flash.visible = false;
    }
    for (const [slot, o] of this.turrets) {
      if (!alive.has(slot)) {
        this.scene.remove(o.group);
        disposeTree(o.group, this.keep);
        this.turrets.delete(slot);
      }
    }

    // enemies
    const aliveE = new Set<number>();
    for (const e of s.enemies) {
      aliveE.add(e.id);
      const o = this.enemyObj(e);
      const [x, y, heading] = sim.pos(e);
      const step = Math.sin(e.wobble);
      o.group.position.copy(toScene(x, y)).setY(e.r + Math.abs(step) * 2 + 1);
      o.group.rotation.y = -heading;
      if (e.kind !== 'boss') o.body.scale.set(e.r * (1 + step * 0.06), e.r * (1 - step * 0.06), e.r);
      else o.group.rotation.y += s.time * 0.8;
      o.body.material.emissiveIntensity = e.hit > 0 ? 2.5 : 0.15;
      o.body.material.emissive.set(e.hit > 0 ? 0xffffff : ENEMY_COLOR[e.kind]);
      const show = e.hp < e.maxHp;
      o.bar.visible = show;
      o.barBg.visible = show;
      if (show) {
        const w = o.barBg.scale.x;
        o.bar.scale.set((w * e.hp) / e.maxHp, 2, 1.2);
        o.bar.position.x = -(w - o.bar.scale.x) / 2;
        // face the camera
        o.bar.rotation.y = camYaw + heading;
        o.barBg.rotation.y = camYaw + heading;
        o.bar.position.y = e.r * 2 + 10;
      }
    }
    for (const [id, o] of this.enemies) {
      if (!aliveE.has(id)) {
        this.scene.remove(o.group);
        disposeTree(o.group, this.keep);
        this.enemies.delete(id);
      }
    }

    // barricades
    s.barricades.forEach((b, i) => {
      const g = this.pooled(this.barricades, i, () => {
        const grp = new THREE.Group();
        const wall = new THREE.Mesh(new THREE.BoxGeometry(10, 14, 40), std(COL.stone));
        wall.position.y = 7;
        wall.castShadow = true;
        grp.add(wall);
        const bar = new THREE.Mesh(this.geo.box, basic(COL.stone));
        bar.name = 'bar';
        bar.position.y = 22;
        grp.add(bar);
        return grp;
      });
      g.visible = true;
      g.position.copy(toScene(b.x, b.y));
      const [, , a] = laneAt(m.lanes[b.lane] ?? m.lanes[0], b.s);
      g.rotation.y = -a;
      const bar = g.getObjectByName('bar') as THREE.Mesh;
      bar.scale.set(2, 2, (30 * b.hp) / b.maxHp);
    });
    for (let i = s.barricades.length; i < this.barricades.length; i++) this.barricades[i].visible = false;

    // drones
    s.drones.forEach((d, i) => {
      const g = this.pooled(this.drones, i, () => {
        const grp = new THREE.Group();
        const body = new THREE.Mesh(new THREE.BoxGeometry(16, 6, 10), std(COL.steelLight));
        grp.add(body);
        const eye = new THREE.Mesh(this.geo.sphere, basic(COL.shield));
        eye.scale.setScalar(3);
        eye.position.x = 8;
        grp.add(eye);
        for (const z of [-7, 7]) {
          const rotor = new THREE.Mesh(new THREE.CylinderGeometry(6, 6, 0.6, 8), basic(COL.shield, { transparent: true, opacity: 0.5 }));
          rotor.position.set(0, 4, z);
          grp.add(rotor);
        }
        return grp;
      });
      g.visible = true;
      g.position.copy(toScene(d.x, d.y)).setY(44 + Math.sin(s.time * 6) * 3);
      g.rotation.y = -d.angle;
    });
    for (let i = s.drones.length; i < this.drones.length; i++) this.drones[i].visible = false;

    // airstrikes: reticles and falling bombs
    let si = 0;
    for (const st of s.strikes) {
      const k = st.t / AIRSTRIKE.delay;
      for (const [dx, dy] of st.bombs) {
        const g = this.pooled(this.strikes, si++, () => {
          const grp = new THREE.Group();
          const ring = new THREE.Mesh(this.geo.ring, basic(COL.ember, { transparent: true, opacity: 0.6, side: THREE.DoubleSide }));
          ring.rotation.x = -Math.PI / 2;
          ring.scale.setScalar(AIRSTRIKE.splash * 0.6);
          ring.position.y = 2;
          grp.add(ring);
          const bomb = new THREE.Mesh(new THREE.ConeGeometry(4, 12, 6), std(COL.steel));
          bomb.name = 'bomb';
          bomb.rotation.x = Math.PI;
          grp.add(bomb);
          return grp;
        });
        g.visible = true;
        g.position.copy(toScene(st.x + dx, st.y + dy));
        (g.getObjectByName('bomb') as THREE.Mesh).position.y = (1 - k) * 260;
      }
    }
    for (let i = si; i < this.strikes.length; i++) this.strikes[i].visible = false;

    // shots
    s.shots.forEach((sh, i) => {
      const mesh = this.pooled(this.shots, i, () => new THREE.Mesh(this.geo.shot, basic(0xffffff)));
      mesh.visible = true;
      const def = TURRETS[sh.kind];
      mesh.material.color.set(sh.charged ? '#ffffff' : def.color);
      let h = sh.fromDrone ? 40 : 14;
      if (sh.arc) h = 14 + Math.sin(Math.min(1, sh.arc.t) * Math.PI) * 140;
      mesh.position.copy(toScene(sh.x, sh.y)).setY(h);
      if (sh.kind === 'rail') {
        mesh.scale.set(4, 1, 1);
        mesh.rotation.y = -Math.atan2(sh.vy, sh.vx);
      } else mesh.scale.setScalar(sh.kind === 'lance' ? 1.6 : 1);
    });
    for (let i = s.shots.length; i < this.shots.length; i++) this.shots[i].visible = false;

    // bolts
    s.bolts.forEach((b, i) => {
      const line = this.pooled(this.bolts, i, () => {
        const g = new THREE.BufferGeometry();
        g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(9), 3));
        return new THREE.Line(g, new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true }));
      });
      line.visible = true;
      const a = Math.min(1, b.life / b.max);
      line.material.color.set(b.color);
      line.material.opacity = a;
      const p0 = toScene(b.x0, b.y0).setY(14);
      const p1 = toScene(b.x1, b.y1).setY(14);
      const mid = p0.clone().lerp(p1, 0.5);
      if (b.width < 4) mid.add(new THREE.Vector3((Math.random() - 0.5) * 18, (Math.random() - 0.5) * 12, (Math.random() - 0.5) * 18));
      const arr = line.geometry.attributes.position as THREE.BufferAttribute;
      arr.setXYZ(0, p0.x, p0.y, p0.z);
      arr.setXYZ(1, mid.x, mid.y, mid.z);
      arr.setXYZ(2, p1.x, p1.y, p1.z);
      arr.needsUpdate = true;
    });
    for (let i = s.bolts.length; i < this.bolts.length; i++) this.bolts[i].visible = false;

    // waves
    s.waves.forEach((w, i) => {
      const ring = this.pooled(this.waves, i, () => {
        const r = new THREE.Mesh(this.geo.ring, basic(0xffffff, { transparent: true, side: THREE.DoubleSide }));
        r.rotation.x = -Math.PI / 2;
        return r;
      });
      ring.visible = true;
      ring.material.color.set(w.color);
      ring.material.opacity = 1 - w.r / w.max;
      ring.scale.setScalar(Math.max(1, w.r));
      ring.position.copy(toScene(w.x, w.y)).setY(3);
    });
    for (let i = s.waves.length; i < this.waves.length; i++) this.waves[i].visible = false;

    // particles
    const tmp = new THREE.Color();
    const n = Math.min(this.MAX_PARTS, s.parts.length);
    for (let i = 0; i < n; i++) {
      const q = s.parts[i];
      this.partPos[i * 3] = q.x - OX;
      this.partPos[i * 3 + 1] = 10 + (1 - q.life / q.max) * 10;
      this.partPos[i * 3 + 2] = q.y - OZ;
      tmp.set(q.color).multiplyScalar(1 - q.life / q.max);
      this.partCol[i * 3] = tmp.r;
      this.partCol[i * 3 + 1] = tmp.g;
      this.partCol[i * 3 + 2] = tmp.b;
    }
    this.particles.geometry.setDrawRange(0, n);
    (this.particles.geometry.attributes.position as THREE.BufferAttribute).needsUpdate = true;
    (this.particles.geometry.attributes.color as THREE.BufferAttribute).needsUpdate = true;

    // floating text
    s.floats.forEach((f, i) => {
      const sp = this.pooled(this.floats, i, () => new THREE.Sprite(new THREE.SpriteMaterial({ transparent: true, depthTest: false })));
      sp.visible = true;
      sp.material.map = this.floatTexture(f.text, f.color);
      sp.material.opacity = 1 - f.life / 1.1;
      sp.scale.set(60, 18, 1);
      sp.position.copy(toScene(f.x, f.y)).setY(26 + f.life * 30);
    });
    for (let i = s.floats.length; i < this.floats.length; i++) this.floats[i].visible = false;

    // targeting
    this.targetRing.visible = false;
    this.targetWall.visible = false;
    if (targeting) {
      if (targeting.kind === 'airstrike') {
        this.targetRing.visible = true;
        this.targetRing.scale.setScalar(AIRSTRIKE.spread + AIRSTRIKE.splash * 0.6);
        this.targetRing.position.copy(toScene(targeting.x, targeting.y)).setY(2.5);
      } else if (targeting.kind === 'barricade') {
        let best: [number, number, number] | null = null;
        let bd = Infinity;
        for (const l of m.lanes)
          for (let d = 20; d < l.len - 40; d += 6) {
            const [px, py, a] = laneAt(l, d);
            const dist = Math.hypot(px - targeting.x, py - targeting.y);
            if (dist < bd) {
              bd = dist;
              best = [px, py, a];
            }
          }
        if (best && bd <= 34) {
          this.targetWall.visible = true;
          this.targetWall.scale.set(10, 14, BARRICADE.width * 2 + 8);
          this.targetWall.position.copy(toScene(best[0], best[1])).setY(7);
          this.targetWall.rotation.y = -best[2];
        }
      }
    }

    // on the title screen the camera drifts low and slow around the field so the sky shows
    const wantCinematic = s.status === 'title';
    if (wantCinematic !== this.cinematic) {
      this.cinematic = wantCinematic;
      this.controls.autoRotate = wantCinematic;
      this.controls.autoRotateSpeed = 0.35;
      if (wantCinematic) {
        this.controls.minPolarAngle = 1.08;
        this.controls.maxPolarAngle = 1.18;
        this.controls.minDistance = 640;
        this.controls.maxDistance = 760;
      } else {
        this.controls.minPolarAngle = 0.25;
        this.controls.maxPolarAngle = 1.15;
        this.controls.minDistance = 280;
        this.controls.maxDistance = this.portraitFit ? 1300 : 900;
        this.camera.position.set(-40, 560, 400);
        if (this.portraitFit) this.camera.position.multiplyScalar(1.4);
      }
    }
    // overlays and camera
    this.tintPlane.material.opacity = s.tint * 0.16 + (s.overcharge > 0 ? 0.03 : 0);
    this.flashPlane.material.opacity = s.flash * 0.5;
    this.dimPlane.material.opacity = s.status === 'title' || s.status === 'over' || s.status === 'won' || s.paused ? 0.35 : 0;
    this.controls.update();
    if (s.shake > 0) {
      const k = s.shake * 5;
      this.camera.position.x += (Math.random() - 0.5) * k;
      this.camera.position.y += (Math.random() - 0.5) * k;
    }
    void ABILITIES;
    this.composer.render();
  }

  dispose() {
    this.controls.dispose();
    disposeTree(this.scene, new Set());
    for (const g of Object.values(this.geo)) g.dispose();
    for (const t of this.floatTex.values()) t.dispose();
    this.floatTex.clear();
    this.sun.shadow.dispose();
    this.bloom.dispose();
    this.composer.dispose();
    this.renderer.renderLists.dispose();
    this.renderer.dispose();
  }
}

export type { AbilityKind };
