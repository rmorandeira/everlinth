// Zombis como sprites generados a partir del 3D ("impostores"): al arrancar se
// renderiza la propia figura 3D de zombi a un atlas — 4 variantes de ropa × 8
// direcciones × 8 fotogramas del andar arrastrando los pies — con el mismo ángulo
// de cámara que el juego. En el juego, cada zombi lejano es un rectángulo orientado a
// la cámara (2 triángulos) que muestra la celda de su variante, dirección relativa a
// la cámara y fotograma de andar. Todos se dibujan en una sola llamada (instancing),
// más otra para su silueta roja cuando quedan tapados.
import * as THREE from "three";
import { createBakeZombie, ZOMBIE_SPRITE_VARIANTS, SPRITE_FIGURE_SCALE } from "./figures3d.js";
import { BASE_YAW, ISO_PITCH } from "./isoCamera.js";

const DIRS = 8;
const FRAMES = 8;
const CELL_W = 64;
const CELL_H = 96;
// Rectángulo de cámara que ocupa cada celda (unidades de render, figura normal).
const FRAME_W = 0.5;
const FRAME_H = 0.75;
const CENTER_Y = 0.33; // altura del centro del encuadre sobre el suelo
const MAX = 1200;

export interface SpriteZombie {
  id: string;
  x: number; // unidades de render
  z: number;
  scale: number;
  variant: number;
}

export interface ZombieSprites {
  group: THREE.Group;
  ready(): boolean;
  /** Hornea el atlas (una vez). */
  bake(renderer: THREE.WebGLRenderer): void;
  update(list: SpriteZombie[], camera: THREE.Camera, cameraYaw: number, light: number): void;
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
  const quad = new THREE.PlaneGeometry(1, 1);
  const cellAttr = new THREE.InstancedBufferAttribute(new Float32Array(MAX * 2), 2);
  cellAttr.setUsage(THREE.DynamicDrawUsage);
  quad.setAttribute("aCell", cellAttr);

  const shared = {
    uRight: { value: new THREE.Vector3(1, 0, 0) },
    uUp: { value: new THREE.Vector3(0, 1, 0) },
    uFrame: { value: new THREE.Vector2(FRAME_W, FRAME_H) },
    uCenterY: { value: CENTER_Y },
    uAtlas: { value: null as THREE.Texture | null },
    uCellSize: { value: new THREE.Vector2(0, 0) },
    uLight: { value: 1 },
  };
  const bodyMat = new THREE.ShaderMaterial({ vertexShader: VERT, fragmentShader: FRAG, uniforms: { ...shared, uTint: { value: new THREE.Color(1, 1, 1) }, uSilhouette: { value: 0 } } });
  const ghostMat = new THREE.ShaderMaterial({
    vertexShader: VERT,
    fragmentShader: FRAG,
    uniforms: { ...shared, uTint: { value: new THREE.Color(0xff3b3b) }, uSilhouette: { value: 1 } },
    transparent: true,
    depthWrite: false,
    depthFunc: THREE.GreaterDepth,
  });
  const body = new THREE.InstancedMesh(quad, bodyMat, MAX);
  body.frustumCulled = false;
  body.count = 0;
  const ghost = new THREE.InstancedMesh(quad, ghostMat, MAX);
  ghost.frustumCulled = false;
  ghost.renderOrder = 10;
  ghost.count = 0;
  group.add(body, ghost);

  function bake(renderer: THREE.WebGLRenderer): void {
    if (atlas) return;
    const cols = DIRS * 2; // 2 variantes por fila de bloques
    const W = CELL_W * cols;
    const H = CELL_H * FRAMES * Math.ceil(ZOMBIE_SPRITE_VARIANTS / 2);
    atlas = new THREE.WebGLRenderTarget(W, H, { samples: 4 });
    atlas.texture.colorSpace = THREE.SRGBColorSpace;
    const scene = new THREE.Scene();
    scene.add(new THREE.HemisphereLight(0xdfe9ff, 0x7a6e60, 1.25));
    const sun = new THREE.DirectionalLight(0xffffff, 1.9);
    scene.add(sun);
    const cam = new THREE.OrthographicCamera(-FRAME_W / 2, FRAME_W / 2, FRAME_H / 2, -FRAME_H / 2, 0.1, 50);
    const dir = new THREE.Vector3(Math.cos(ISO_PITCH) * Math.cos(BASE_YAW), Math.sin(ISO_PITCH), Math.cos(ISO_PITCH) * Math.sin(BASE_YAW));
    const target = new THREE.Vector3(0, CENTER_Y, 0);
    cam.position.copy(target).addScaledVector(dir, 10);
    cam.lookAt(target);
    sun.position.set(-4, 10, 6);

    const prevTarget = renderer.getRenderTarget();
    const prevClear = renderer.getClearColor(new THREE.Color());
    const prevAlpha = renderer.getClearAlpha();
    const prevScissor = renderer.getScissorTest();
    renderer.setRenderTarget(atlas);
    renderer.setClearColor(0x000000, 0);
    renderer.setScissorTest(false);
    renderer.clear();
    renderer.setScissorTest(true);
    for (let v = 0; v < ZOMBIE_SPRITE_VARIANTS; v++) {
      const fig = createBakeZombie(v);
      fig.root.scale.setScalar(SPRITE_FIGURE_SCALE);
      scene.add(fig.root);
      for (let d = 0; d < DIRS; d++) {
        fig.setFacing((d / DIRS) * Math.PI * 2);
        for (let f = 0; f < FRAMES; f++) {
          fig.setWalk((f / FRAMES) * Math.PI * 2);
          const x = ((v % 2) * DIRS + d) * CELL_W;
          const y = (Math.floor(v / 2) * FRAMES + f) * CELL_H;
          renderer.setViewport(x, y, CELL_W, CELL_H);
          renderer.setScissor(x, y, CELL_W, CELL_H);
          renderer.render(scene, cam);
        }
      }
      scene.remove(fig.root);
    }
    renderer.setScissorTest(prevScissor);
    renderer.setRenderTarget(prevTarget);
    renderer.setClearColor(prevClear, prevAlpha);
    shared.uAtlas.value = atlas.texture;
    shared.uCellSize.value.set(1 / cols, 1 / (FRAMES * Math.ceil(ZOMBIE_SPRITE_VARIANTS / 2)));
  }

  // estado por zombi: fase de andar y hacia dónde mira (como los rigs 3D)
  const state = new Map<string, { lastX: number; lastZ: number; phase: number; facing: number }>();
  const m = new THREE.Matrix4();
  const right = new THREE.Vector3();
  const up = new THREE.Vector3();

  function update(list: SpriteZombie[], camera: THREE.Camera, cameraYaw: number, light: number): void {
    if (!atlas) {
      body.count = ghost.count = 0;
      return;
    }
    camera.matrixWorld.extractBasis(right, up, new THREE.Vector3());
    shared.uRight.value.copy(right);
    shared.uUp.value.copy(up);
    shared.uLight.value = light;
    const cw = shared.uCellSize.value.x;
    const ch = shared.uCellSize.value.y;
    const seen = new Set<string>();
    let n = 0;
    for (const z of list) {
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
      // dirección relativa a la cámara (el atlas se horneó con la cámara base)
      const rel = s.facing + (cameraYaw - BASE_YAW);
      const d = ((Math.round((rel / (Math.PI * 2)) * DIRS) % DIRS) + DIRS) % DIRS;
      const f = Math.floor(((((s.phase % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2)) / (Math.PI * 2)) * FRAMES) % FRAMES;
      const v = z.variant % ZOMBIE_SPRITE_VARIANTS;
      cellAttr.setXY(n, ((v % 2) * DIRS + d) * cw, (Math.floor(v / 2) * FRAMES + f) * ch);
      m.makeScale(z.scale, z.scale, z.scale).setPosition(z.x, 0, z.z);
      body.setMatrixAt(n, m);
      ghost.setMatrixAt(n, m);
      n++;
    }
    body.count = ghost.count = n;
    body.instanceMatrix.needsUpdate = true;
    ghost.instanceMatrix.needsUpdate = true;
    cellAttr.needsUpdate = true;
    for (const id of state.keys()) if (!seen.has(id)) state.delete(id);
  }

  return { group, ready: () => atlas !== null, bake, update };
}
