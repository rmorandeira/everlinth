// Fase 3 de la migración a 3D (ver plan): sustituye drawStickGuy/drawFigure
// (client/src/render/scene.ts) por una figura low-poly compartida (cajas para
// piernas/torso/brazos/cabeza), usada tanto para jugadores como monstruos —
// solo cambia el color.
//
// A diferencia del suelo/obstáculos/árboles (se reconstruyen solo al cambiar
// de pantalla), jugadores y monstruos se mueven cada frame: este módulo
// mantiene un Map<id, rig> vivo entre frames (id = username o
// MonsterState.id) en vez de reconstruir nada. update() se llama una vez por
// frame con la lista actual de entidades — crea el rig la primera vez que
// aparece alguien, actualiza posición/animación mientras siga en la lista, y
// LO RETIRA de la escena si deja de aparecer (cambio de pantalla, logout,
// muerte). El playerAnims/otherDisplay de la versión 2D nunca limpiaba
// entradas viejas (inofensivo allí, eran solo datos); aquí un rig sin limpiar
// se quedaría visible en la escena para siempre.
import * as THREE from "three";

const legGeo = new THREE.BoxGeometry(0.09, 0.4, 0.09);
const torsoGeo = new THREE.BoxGeometry(0.32, 0.38, 0.2);
const armGeo = new THREE.BoxGeometry(0.09, 0.34, 0.09);
const headGeo = new THREE.BoxGeometry(0.22, 0.22, 0.22);
const shadowGeo = new THREE.CircleGeometry(0.22, 12);
const shadowMat = new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.28 });

const materialCache = new Map<number, THREE.MeshLambertMaterial>();
function materialFor(color: number): THREE.MeshLambertMaterial {
  let m = materialCache.get(color);
  if (!m) {
    m = new THREE.MeshLambertMaterial({ color });
    materialCache.set(color, m);
  }
  return m;
}

// Una textura de canvas por texto de etiqueta (no cambia por frame): el
// Sprite en sí es barato de crear, uno por rig, referenciando el mismo
// material — un Sprite ya mira siempre a cámara sin código extra.
const labelMaterialCache = new Map<string, THREE.SpriteMaterial>();
function labelMaterialFor(text: string): THREE.SpriteMaterial {
  let mat = labelMaterialCache.get(text);
  if (!mat) {
    const canvas = document.createElement("canvas");
    canvas.width = 160;
    canvas.height = 40;
    const ctx = canvas.getContext("2d")!;
    ctx.fillStyle = "#fff";
    ctx.font = "24px monospace";
    ctx.textAlign = "center";
    ctx.fillText(text, 80, 28);
    const texture = new THREE.CanvasTexture(canvas);
    mat = new THREE.SpriteMaterial({ map: texture, depthTest: false, transparent: true });
    labelMaterialCache.set(text, mat);
  }
  return mat;
}

// Escala realista (1 tile ≈ 3 m): una persona de ~1.8 m mide ~0.6 tiles. El rig
// está dibujado con ~1.05 de alto, así que se reduce de una vez en el grupo raíz.
const FIGURE_SCALE = 0.62;
const HIP_Y = 0.4; // pies en y=0, cadera a esta altura
const SHOULDER_Y = HIP_Y + 0.36;
const HEAD_Y = SHOULDER_Y + 0.17;

interface Rig {
  root: THREE.Group;
  legL: THREE.Group;
  legR: THREE.Group;
  armL: THREE.Group;
  armR: THREE.Group;
  phase: number;
  lastX: number;
  lastZ: number;
  facing: number;
}

function buildLimb(sideX: number, pivotY: number, geo: THREE.BoxGeometry, mat: THREE.MeshLambertMaterial, halfLen: number, root: THREE.Group): THREE.Group {
  const pivot = new THREE.Group();
  pivot.position.set(sideX, pivotY, 0);
  const mesh = new THREE.Mesh(geo, mat);
  mesh.position.y = -halfLen;
  pivot.add(mesh);
  root.add(pivot);
  return pivot;
}

const gunGeo = new THREE.BoxGeometry(0.07, 0.09, 0.5);
const gunMat = new THREE.MeshLambertMaterial({ color: 0x23262b });

function buildRig(color: number, label?: string, armed = false): Rig {
  const root = new THREE.Group();
  root.scale.setScalar(FIGURE_SCALE);

  const shadow = new THREE.Mesh(shadowGeo, shadowMat);
  shadow.rotation.x = -Math.PI / 2;
  shadow.position.y = 0.01;
  root.add(shadow);

  const mat = materialFor(color);
  const legL = buildLimb(-0.06, HIP_Y, legGeo, mat, 0.2, root);
  const legR = buildLimb(0.06, HIP_Y, legGeo, mat, 0.2, root);

  const torso = new THREE.Mesh(torsoGeo, mat);
  torso.position.y = HIP_Y + 0.19;
  root.add(torso);

  const armL = buildLimb(-0.2, SHOULDER_Y, armGeo, mat, 0.17, root);
  const armR = buildLimb(0.2, SHOULDER_Y, armGeo, mat, 0.17, root);

  const head = new THREE.Mesh(headGeo, mat);
  head.position.y = HEAD_Y;
  root.add(head);

  if (armed) {
    const gun = new THREE.Mesh(gunGeo, gunMat);
    gun.position.set(0.12, SHOULDER_Y - 0.12, 0.26);
    root.add(gun);
  }

  if (label) {
    const sprite = new THREE.Sprite(labelMaterialFor(label));
    sprite.scale.set(1.1, 0.275, 1); // compensa FIGURE_SCALE: la etiqueta sigue legible
    sprite.position.y = HEAD_Y + 0.28;
    root.add(sprite);
  }

  root.traverse((o) => {
    if ((o as THREE.Mesh).isMesh && !(o as THREE.Sprite).isSprite && o !== shadow) o.castShadow = true;
  });

  return { root, legL, legR, armL, armR, phase: 0, lastX: 0, lastZ: 0, facing: 0 };
}

// Mismos colores que MONSTER_COLORS en el scene.ts 2D.
export const MONSTER_COLORS: Record<string, number> = {
  rat: 0x8a6b4f,
  goblin: 0x5fa04a,
  wolf: 0x777777,
  ogre: 0x7a4a4a,
};
export const MONSTER_COLOR_DEFAULT = 0xaa3333;

export interface FigureEntity {
  id: string;
  x: number;
  z: number;
  color: number;
  label?: string;
  /** Lleva ametralladora (se dibuja en la mano). */
  armed?: boolean;
  /** Si se da, la figura mira ahí (ángulo atan2(dx,dz)) en vez de hacia donde camina. */
  facing?: number;
}

export interface FigureManager {
  group: THREE.Group;
  update(entities: FigureEntity[], time: number): void;
}

export function createFigureManager(): FigureManager {
  const group = new THREE.Group();
  const rigs = new Map<string, Rig>();

  function update(entities: FigureEntity[], time: number): void {
    void time; // reservado para animaciones futuras que no dependan del movimiento
    const seen = new Set<string>();

    for (const e of entities) {
      seen.add(e.id);
      let rig = rigs.get(e.id);
      if (!rig) {
        rig = buildRig(e.color, e.label, e.armed);
        rig.lastX = e.x;
        rig.lastZ = e.z;
        rigs.set(e.id, rig);
        group.add(rig.root);
      }

      const dx = e.x - rig.lastX;
      const dz = e.z - rig.lastZ;
      const dist = Math.hypot(dx, dz);
      if (dist > 0.0008) {
        rig.phase += dist * 16;
        rig.facing = Math.atan2(dx, dz);
      }
      rig.lastX = e.x;
      rig.lastZ = e.z;

      rig.root.position.set(e.x, 0, e.z);
      rig.root.rotation.y = e.facing ?? rig.facing;

      const legSwing = Math.sin(rig.phase) * 0.5;
      const armSwing = Math.sin(rig.phase + Math.PI) * 0.4;
      rig.legL.rotation.x = legSwing;
      rig.legR.rotation.x = -legSwing;
      rig.armL.rotation.x = -armSwing;
      rig.armR.rotation.x = armSwing;
    }

    for (const [id, rig] of rigs) {
      if (seen.has(id)) continue;
      group.remove(rig.root);
      rigs.delete(id);
    }
  }

  return { group, update };
}
