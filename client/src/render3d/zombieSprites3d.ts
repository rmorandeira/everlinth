// Zombis como sprites generados a partir del 3D (a lo Doom): al arrancar se renderiza
// la propia figura 3D de zombi a un atlas con el mismo ángulo de cámara que el juego:
// - andando: 4 variantes de ropa × 8 direcciones × 8 fotogramas del andar arrastrando
//   los pies;
// - cadáveres: 4 variantes × 4 posturas tumbadas × 8 direcciones.
// En el juego cada zombi es un rectángulo orientado a la cámara (2 triángulos) que
// muestra la celda de su variante, su dirección relativa a la cámara y su fotograma.
// Todos se dibujan en pocas llamadas (instancing): zombis, su silueta roja cuando
// quedan tapados, sus sombras en el suelo y los cadáveres.
import * as THREE from "three";
import { createBakeZombie, ZOMBIE_SPRITE_VARIANTS, SPRITE_FIGURE_SCALE } from "./figures3d.js";
import { BASE_YAW, ISO_PITCH } from "./isoCamera.js";

const DIRS = 8;
const FRAMES = 8;
const POSES = 4;
const CELL_W = 64;
const CELL_H = 96;
const COLS = DIRS * 2; // dos variantes por fila de bloques
const WALK_ROWS = FRAMES * Math.ceil(ZOMBIE_SPRITE_VARIANTS / 2);
const ROWS = WALK_ROWS + POSES * Math.ceil(ZOMBIE_SPRITE_VARIANTS / 2);
// Rectángulo de cámara que ocupa cada celda (unidades de render, figura normal).
const WALK_FRAME = new THREE.Vector2(0.5, 0.75);
const WALK_CENTER_Y = 0.33;
const CORPSE_FRAME = new THREE.Vector2(0.8, 0.8);
const CORPSE_CENTER_Y = 0.08;
const MAX = 1500;

export interface SpriteZombie {
  id: string;
  x: number; // unidades de render
  z: number;
  scale: number;
  variant: number;
}
export interface SpriteCorpse {
  x: number;
  z: number;
  scale: number;
  variant: number;
  pose: number;
  facing: number;
}

export interface ZombieSprites {
  group: THREE.Group;
  ready(): boolean;
  /** Hornea el atlas (una vez). */
  bake(renderer: THREE.WebGLRenderer): void;
  update(walkers: SpriteZombie[], corpses: SpriteCorpse[], camera: THREE.Camera, cameraYaw: number, light: number): void;
}

const VERT = /* glsl */ `
  attribute vec2 aCell;
  uniform vec3 uRight;
  uniform vec3 uUp;
  uniform vec2 uFrame;
  uniform float uCenterY;
  varying vec2 vUv;
  varying vec2 vCell;
  void main() {
    vec3 ground = (modelMatrix * instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
    float s = length(instanceMatrix[0].xyz);
    vec3 center = ground + vec3(0.0, uCenterY * s, 0.0);
    vec3 p = center + uRight * (position.x * uFrame.x * s) + uUp * (position.y * uFrame.y * s);
    vUv = uv;
    vCell = aCell;
    gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.0);
  }
`;
const FRAG = /* glsl */ `
  uniform sampler2D uAtlas;
  uniform vec2 uCellSize;
  uniform float uLight;
  uniform vec3 uTint;
  uniform float uSilhouette;
  varying vec2 vUv;
  varying vec2 vCell;
  void main() {
    vec4 c = texture2D(uAtlas, vCell + vUv * uCellSize);
    if (c.a < 0.5) discard;
    if (uSilhouette > 0.5) {
      gl_FragColor = vec4(uTint, 0.6);
    } else {
      gl_FragColor = vec4(c.rgb * uLight, 1.0);
    }
  }
`;

export function createZombieSprites(): ZombieSprites {
  const group = new THREE.Group();
  let atlas: THREE.WebGLRenderTarget | null = null;

  const common = {
    uRight: { value: new THREE.Vector3(1, 0, 0) },
    uUp: { value: new THREE.Vector3(0, 1, 0) },
    uAtlas: { value: null as THREE.Texture | null },
    uCellSize: { value: new THREE.Vector2(1 / COLS, 1 / ROWS) },
    uLight: { value: 1 },
  };
  function spriteLayer(frame: THREE.Vector2, centerY: number, silhouette: boolean): { mesh: THREE.InstancedMesh; cells: THREE.InstancedBufferAttribute } {
    const geo = new THREE.PlaneGeometry(1, 1);
    const cells = new THREE.InstancedBufferAttribute(new Float32Array(MAX * 2), 2);
    cells.setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute("aCell", cells);
    const mat = new THREE.ShaderMaterial({
      vertexShader: VERT,
      fragmentShader: FRAG,
      uniforms: {
        ...common,
        uFrame: { value: frame },
        uCenterY: { value: centerY },
        uTint: { value: new THREE.Color(0xff3b3b) },
        uSilhouette: { value: silhouette ? 1 : 0 },
      },
      ...(silhouette ? { transparent: true, depthWrite: false, depthFunc: THREE.GreaterDepth } : {}),
    });
    const mesh = new THREE.InstancedMesh(geo, mat, MAX);
    mesh.frustumCulled = false;
    mesh.count = 0;
    if (silhouette) mesh.renderOrder = 10;
    group.add(mesh);
    return { mesh, cells };
  }
  const walk = spriteLayer(WALK_FRAME, WALK_CENTER_Y, false);
  const ghost = spriteLayer(WALK_FRAME, WALK_CENTER_Y, true);
  const dead = spriteLayer(CORPSE_FRAME, CORPSE_CENTER_Y, false);
  // sombra en el suelo bajo cada zombi (mancha oscura, como en los clásicos)
  const shadowGeo = new THREE.CircleGeometry(0.13, 12).rotateX(-Math.PI / 2);
  const shadows = new THREE.InstancedMesh(shadowGeo, new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.3, depthWrite: false }), MAX);
  shadows.frustumCulled = false;
  shadows.count = 0;
  group.add(shadows);

  function bake(renderer: THREE.WebGLRenderer): void {
    if (atlas) return;
    atlas = new THREE.WebGLRenderTarget(CELL_W * COLS, CELL_H * ROWS, { samples: 4 });
    atlas.texture.colorSpace = THREE.SRGBColorSpace;
    const scene = new THREE.Scene();
    scene.add(new THREE.HemisphereLight(0xdfe9ff, 0x7a6e60, 1.25));
    const sun = new THREE.DirectionalLight(0xffffff, 1.9);
    sun.position.set(-4, 10, 6);
    scene.add(sun);
    const dir = new THREE.Vector3(Math.cos(ISO_PITCH) * Math.cos(BASE_YAW), Math.sin(ISO_PITCH), Math.cos(ISO_PITCH) * Math.sin(BASE_YAW));
    const camFor = (frame: THREE.Vector2, centerY: number): THREE.OrthographicCamera => {
      const cam = new THREE.OrthographicCamera(-frame.x / 2, frame.x / 2, frame.y / 2, -frame.y / 2, 0.1, 50);
      const target = new THREE.Vector3(0, centerY, 0);
      cam.position.copy(target).addScaledVector(dir, 10);
      cam.lookAt(target);
      return cam;
    };
    const walkCam = camFor(WALK_FRAME, WALK_CENTER_Y);
    const corpseCam = camFor(CORPSE_FRAME, CORPSE_CENTER_Y);

    const prevTarget = renderer.getRenderTarget();
    const prevClear = renderer.getClearColor(new THREE.Color());
    const prevAlpha = renderer.getClearAlpha();
    const prevScissor = renderer.getScissorTest();
    const prevViewport = renderer.getViewport(new THREE.Vector4());
    const prevScissorRect = renderer.getScissor(new THREE.Vector4());
    renderer.setRenderTarget(atlas);
    renderer.setClearColor(0x000000, 0);
    renderer.setScissorTest(false);
    renderer.clear();
    renderer.setScissorTest(true);
    const cell = (col: number, row: number, cam: THREE.Camera): void => {
      const x = col * CELL_W;
      const y = row * CELL_H;
      renderer.setViewport(x, y, CELL_W, CELL_H);
      renderer.setScissor(x, y, CELL_W, CELL_H);
      renderer.render(scene, cam);
    };
    for (let v = 0; v < ZOMBIE_SPRITE_VARIANTS; v++) {
      const colBase = (v % 2) * DIRS;
      // andando
      const fig = createBakeZombie(v);
      fig.root.scale.setScalar(SPRITE_FIGURE_SCALE);
      scene.add(fig.root);
      for (let d = 0; d < DIRS; d++) {
        fig.setFacing((d / DIRS) * Math.PI * 2);
        for (let f = 0; f < FRAMES; f++) {
          fig.setWalk((f / FRAMES) * Math.PI * 2);
          cell(colBase + d, Math.floor(v / 2) * FRAMES + f, walkCam);
        }
      }
      scene.remove(fig.root);
      // cadáveres
      for (let p = 0; p < POSES; p++) {
        const body = createBakeZombie(v);
        body.root.scale.setScalar(SPRITE_FIGURE_SCALE);
        body.setCorpse(p + v * POSES);
        scene.add(body.root);
        for (let d = 0; d < DIRS; d++) {
          body.setFacing((d / DIRS) * Math.PI * 2);
          cell(colBase + d, WALK_ROWS + Math.floor(v / 2) * POSES + p, corpseCam);
        }
        scene.remove(body.root);
      }
    }
    renderer.setRenderTarget(prevTarget);
    // restaurar el área de dibujo y el recorte (si no, la pantalla queda en la última celda)
    renderer.setViewport(prevViewport);
    renderer.setScissor(prevScissorRect);
    renderer.setScissorTest(prevScissor);
    renderer.setClearColor(prevClear, prevAlpha);
    common.uAtlas.value = atlas.texture;
  }

  // estado por zombi: fase de andar y hacia dónde mira (como los rigs 3D)
  const state = new Map<string, { lastX: number; lastZ: number; phase: number; facing: number }>();
  const m = new THREE.Matrix4();
  const right = new THREE.Vector3();
  const up = new THREE.Vector3();
  const TAU = Math.PI * 2;
  const dirIndex = (facing: number, cameraYaw: number): number => {
    const rel = facing + (cameraYaw - BASE_YAW);
    return ((Math.round((rel / TAU) * DIRS) % DIRS) + DIRS) % DIRS;
  };

  function update(walkers: SpriteZombie[], corpses: SpriteCorpse[], camera: THREE.Camera, cameraYaw: number, light: number): void {
    if (!atlas) return;
    camera.matrixWorld.extractBasis(right, up, new THREE.Vector3());
    common.uRight.value.copy(right);
    common.uUp.value.copy(up);
    common.uLight.value = light;
    const cw = 1 / COLS;
    const ch = 1 / ROWS;
    const seen = new Set<string>();
    let n = 0;
    for (const z of walkers) {
      if (n >= MAX) break;
      seen.add(z.id);
      let s = state.get(z.id);
      if (!s) {
        s = { lastX: z.x, lastZ: z.z, phase: Math.random() * 10, facing: 0 };
        state.set(z.id, s);
      }
      const dx = z.x - s.lastX;
      const dz = z.z - s.lastZ;
      const dist = Math.hypot(dx, dz);
      if (dist > 0.0005) {
        s.phase += (dist * 16 * 0.6) / z.scale;
        s.facing = Math.atan2(dx, dz);
      }
      s.lastX = z.x;
      s.lastZ = z.z;
      const d = dirIndex(s.facing, cameraYaw);
      const f = Math.floor(((((s.phase % TAU) + TAU) % TAU) / TAU) * FRAMES) % FRAMES;
      const v = z.variant % ZOMBIE_SPRITE_VARIANTS;
      const cx = ((v % 2) * DIRS + d) * cw;
      const cy = (Math.floor(v / 2) * FRAMES + f) * ch;
      walk.cells.setXY(n, cx, cy);
      ghost.cells.setXY(n, cx, cy);
      m.makeScale(z.scale, z.scale, z.scale).setPosition(z.x, 0, z.z);
      walk.mesh.setMatrixAt(n, m);
      ghost.mesh.setMatrixAt(n, m);
      m.makeScale(z.scale, 1, z.scale).setPosition(z.x, 0.012, z.z);
      shadows.setMatrixAt(n, m);
      n++;
    }
    for (const L of [walk, ghost]) {
      L.mesh.count = n;
      L.mesh.instanceMatrix.needsUpdate = true;
      L.cells.needsUpdate = true;
    }
    shadows.count = n;
    shadows.instanceMatrix.needsUpdate = true;
    for (const id of state.keys()) if (!seen.has(id)) state.delete(id);

    let k = 0;
    for (const c of corpses) {
      if (k >= MAX) break;
      const v = c.variant % ZOMBIE_SPRITE_VARIANTS;
      dead.cells.setXY(k, ((v % 2) * DIRS + dirIndex(c.facing, cameraYaw)) * cw, (WALK_ROWS + Math.floor(v / 2) * POSES + (c.pose % POSES)) * ch);
      m.makeScale(c.scale, c.scale, c.scale).setPosition(c.x, 0, c.z);
      dead.mesh.setMatrixAt(k, m);
      k++;
    }
    dead.mesh.count = k;
    dead.mesh.instanceMatrix.needsUpdate = true;
    dead.cells.needsUpdate = true;
  }

  return { group, ready: () => atlas !== null, bake, update };
}
