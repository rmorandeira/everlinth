// Figuras (personaje, otros jugadores, zombis, monstruos): una figura low-poly
// estilizada — extremidades largas y finas (cápsulas), torso de hombros anchos y
// cintura estrecha, cabeza pequeña, manos y pies — con colores de piel, ropa y
// calzado.
//
// Se dibujan con INSTANCING: cada tipo de pieza (pierna, pie, torso, cabeza…) de
// todas las figuras es un único InstancedMesh con el color por instancia, así cien
// zombis cuestan lo mismo en llamadas de dibujo que uno. Cada figura conserva una
// jerarquía de Object3D (raíz → cuerpo → columna → brazos/cabeza, piernas) que NO se
// dibuja: solo sirve para animar la pose y calcular la matriz de cada pieza.
//
// update() se llama una vez por frame con la lista actual de entidades: crea la
// pose la primera vez que aparece alguien, la anima mientras siga en la lista y la
// retira cuando deja de aparecer (cambio de pantalla, logout, muerte).
import * as THREE from "three";

// ---- Geometría de las piezas (proporciones sin escalar; ver FIGURE_SCALE) ----
const LEG_LEN = 0.5;
const ARM_LEN = 0.4;
const PART_GEOS = {
  leg: new THREE.CapsuleGeometry(0.042, LEG_LEN - 0.084, 3, 8),
  arm: new THREE.CapsuleGeometry(0.032, ARM_LEN - 0.064, 3, 8),
  torso: new THREE.CapsuleGeometry(0.1, 0.2, 3, 10),
  pelvis: new THREE.BoxGeometry(0.19, 0.09, 0.11),
  foot: new THREE.BoxGeometry(0.075, 0.045, 0.15),
  head: new THREE.IcosahedronGeometry(0.082, 1),
  hair: new THREE.SphereGeometry(0.086, 10, 6, 0, Math.PI * 2, 0, Math.PI * 0.55),
  gun: new THREE.BoxGeometry(0.07, 0.09, 0.5),
};
type PartKind = keyof typeof PART_GEOS;
const PART_KINDS = Object.keys(PART_GEOS) as PartKind[];

const shadowGeo = new THREE.CircleGeometry(0.22, 12).rotateX(-Math.PI / 2);
const shadowMat = new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.28, depthWrite: false });

// Silueta a través de las paredes: las mismas piezas con un material que solo se
// pinta donde la figura está TAPADA (prueba de profundidad invertida), en color plano
// semitransparente (el color va por instancia).
const silhouetteMat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.6, depthWrite: false, depthFunc: THREE.GreaterDepth, fog: false });

// Una textura de canvas por texto de etiqueta (no cambia por frame).
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

// Escala realista (1 tile ≈ 3 m): una persona de ~1.8 m mide ~0.6 unidades. La figura
// está dibujada con ~1.1 de alto, así que se reduce de una vez en la raíz.
const FIGURE_SCALE = 0.56;
const HIP_Y = LEG_LEN + 0.03; // pies en y=0, cadera a esta altura
const SHOULDER_UP = 0.4; // hombros sobre la cadera (dentro de la columna)
const HEAD_UP = 0.56;

const ZOMBIE_SHIRTS = [0x6b5d4f, 0x4f5d6b, 0x5d6b4f, 0x7a4a4a, 0x8a7f6a, 0x3f4a5a];
const HUMAN_SKINS = [0xd9a88a, 0xc08a68, 0x8d5d40, 0xe8c0a0];

interface Part {
  kind: PartKind;
  anchor: THREE.Object3D; // su matriz de mundo es la de la pieza
  color: THREE.Color;
}

interface Rig {
  root: THREE.Group;
  body: THREE.Group; // todo menos la sombra (sube/baja al correr)
  spine: THREE.Group; // torso, brazos y cabeza (se inclina)
  head: THREE.Object3D;
  legL: THREE.Group;
  legR: THREE.Group;
  armL: THREE.Group;
  armR: THREE.Group;
  parts: Part[];
  silhouette: THREE.Color | null;
  label: THREE.Sprite | null;
  zombie: boolean;
  phase: number;
  lastX: number;
  lastZ: number;
  facing: number;
  speed: number;
}

function buildRig(color: number, label: string | undefined, armed: boolean, silhouette: number | undefined, zombie: boolean, seed: number): Rig {
  const parts: Part[] = [];
  const part = (kind: PartKind, parent: THREE.Object3D, col: number, x = 0, y = 0, z = 0): THREE.Object3D => {
    const a = new THREE.Object3D();
    a.position.set(x, y, z);
    parent.add(a);
    parts.push({ kind, anchor: a, color: new THREE.Color(col) });
    return a;
  };
  const limb = (parent: THREE.Object3D, sideX: number, pivotY: number, kind: PartKind, len: number, col: number): THREE.Group => {
    const pivot = new THREE.Group();
    pivot.position.set(sideX, pivotY, 0);
    parent.add(pivot);
    part(kind, pivot, col, 0, -len / 2, 0);
    return pivot;
  };

  const skin = zombie ? 0x93a874 : HUMAN_SKINS[seed % HUMAN_SKINS.length];
  const shirt = zombie ? ZOMBIE_SHIRTS[seed % ZOMBIE_SHIRTS.length] : color;
  const pants = zombie ? 0x35363c : 0x2b2f38;
  const shoes = 0x1a1a1c;

  const root = new THREE.Group();
  root.scale.setScalar(FIGURE_SCALE);
  const body = new THREE.Group();
  root.add(body);

  const legL = limb(body, -0.062, HIP_Y, "leg", LEG_LEN, pants);
  const legR = limb(body, 0.062, HIP_Y, "leg", LEG_LEN, pants);
  for (const leg of [legL, legR]) part("foot", leg, shoes, 0, -LEG_LEN + 0.02, 0.035);
  part("pelvis", body, pants, 0, HIP_Y + 0.01, 0);

  const spine = new THREE.Group();
  spine.position.y = HIP_Y;
  body.add(spine);
  part("torso", spine, shirt, 0, 0.22, 0).scale.set(1.3, 1, 0.72);
  const armL = limb(spine, -0.165, SHOULDER_UP, "arm", ARM_LEN, shirt);
  const armR = limb(spine, 0.165, SHOULDER_UP, "arm", ARM_LEN, shirt);
  for (const arm of [armL, armR]) part("head", arm, skin, 0, -ARM_LEN + 0.01, 0).scale.setScalar(0.42); // mano
  const head = part("head", spine, skin, 0, HEAD_UP, 0);
  if (!zombie) {
    const hair = part("hair", head, 0x2a1d14, 0, 0.012, 0);
    hair.rotation.x = -0.25;
  }
  if (armed) part("gun", spine, 0x23262b, 0.12, SHOULDER_UP - 0.12, 0.26);

  let sprite: THREE.Sprite | null = null;
  if (label) {
    sprite = new THREE.Sprite(labelMaterialFor(label));
    sprite.scale.set(1.2, 0.3, 1); // compensa FIGURE_SCALE: la etiqueta sigue legible
    sprite.position.y = HIP_Y + HEAD_UP + 0.3;
    root.add(sprite);
  }

  return {
    root,
    body,
    spine,
    head,
    legL,
    legR,
    armL,
    armR,
    parts,
    silhouette: silhouette !== undefined ? new THREE.Color(silhouette) : null,
    label: sprite,
    zombie,
    phase: seed * 0.7,
    lastX: 0,
    lastZ: 0,
    facing: 0,
    speed: 0,
  };
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
  /** Anda como un zombi: encorvado, brazos al frente, arrastrando los pies. */
  zombie?: boolean;
  /** Color de su silueta cuando queda tapada (sin silueta si no se da). */
  silhouette?: number;
  /** Lleva ametralladora (se dibuja en la mano). */
  armed?: boolean;
  /** Si se da, la figura mira ahí (ángulo atan2(dx,dz)) en vez de hacia donde camina. */
  facing?: number;
}

export interface FigureManager {
  group: THREE.Group;
  update(entities: FigureEntity[], time: number): void;
}

function seedOf(id: string): number {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) | 0;
  return Math.abs(h) % 997;
}

const MAX_FIGURES = 400;

function animate(rig: Rig, dist: number): void {
  rig.speed += (dist - rig.speed) * 0.2;
  const moving = Math.min(1, rig.speed / 0.02);
  if (rig.zombie) {
    // Zombi: encorvado, cabeza ladeada, brazos al frente; pasos muy cortos con los pies
    // casi sin despegarse del suelo (se arrastran) y balanceo de un lado a otro.
    const p = rig.phase * 0.6;
    rig.spine.rotation.x = 0.42 + Math.sin(p * 2) * 0.03;
    rig.spine.rotation.z = Math.sin(p) * 0.09;
    rig.head.rotation.z = 0.35;
    rig.head.rotation.x = -0.3;
    rig.legL.rotation.x = Math.sin(p) * 0.2;
    rig.legR.rotation.x = -Math.sin(p) * 0.2;
    rig.legL.rotation.z = 0.04;
    rig.legR.rotation.z = -0.04;
    rig.armL.rotation.x = -1.1 + Math.sin(p + 0.5) * 0.1;
    rig.armR.rotation.x = -0.95 + Math.sin(p + 2.1) * 0.12;
    rig.body.position.y = -0.03 + Math.abs(Math.sin(p)) * 0.008;
  } else {
    // Personaje: carrera con braceo, algo inclinado hacia delante al moverse, con rebote.
    const legSwing = Math.sin(rig.phase) * 0.65 * moving;
    const armSwing = Math.sin(rig.phase + Math.PI) * 0.55 * moving;
    rig.legL.rotation.x = legSwing;
    rig.legR.rotation.x = -legSwing;
    rig.armL.rotation.x = -armSwing;
    rig.armR.rotation.x = armSwing;
    rig.spine.rotation.x = 0.12 * moving;
    rig.body.position.y = Math.abs(Math.sin(rig.phase)) * 0.03 * moving;
  }
}

export function createFigureManager(): FigureManager {
  const group = new THREE.Group();
  const rigs = new Map<string, Rig>();

  // Un InstancedMesh por tipo de pieza (cuerpo) y otro para su silueta.
  const bodyMat = new THREE.MeshLambertMaterial({ color: 0xffffff, flatShading: true });
  const meshes = new Map<PartKind, THREE.InstancedMesh>();
  const ghosts = new Map<PartKind, THREE.InstancedMesh>();
  for (const kind of PART_KINDS) {
    const count = kind === "head" ? MAX_FIGURES * 3 : kind === "leg" || kind === "arm" || kind === "foot" ? MAX_FIGURES * 2 : MAX_FIGURES;
    const m = new THREE.InstancedMesh(PART_GEOS[kind], bodyMat, count);
    m.castShadow = true;
    m.frustumCulled = false; // las instancias se mueven por todo el mundo
    m.count = 0;
    m.setColorAt(0, new THREE.Color(1, 1, 1));
    group.add(m);
    meshes.set(kind, m);
    const g = new THREE.InstancedMesh(PART_GEOS[kind], silhouetteMat, count);
    g.frustumCulled = false;
    g.renderOrder = 10; // después de la escena opaca
    g.count = 0;
    g.setColorAt(0, new THREE.Color(1, 1, 1));
    group.add(g);
    ghosts.set(kind, g);
  }
  const shadows = new THREE.InstancedMesh(shadowGeo, shadowMat, MAX_FIGURES);
  shadows.frustumCulled = false;
  shadows.count = 0;
  group.add(shadows);

  const shadowM = new THREE.Matrix4();
  const shadowPos = new THREE.Vector3();
  const shadowQ = new THREE.Quaternion();
  const shadowS = new THREE.Vector3();

  function update(entities: FigureEntity[], time: number): void {
    void time;
    const seen = new Set<string>();
    const counts = new Map<PartKind, number>();
    const ghostCounts = new Map<PartKind, number>();
    let shadowCount = 0;

    for (const e of entities) {
      if (seen.size >= MAX_FIGURES) break;
      seen.add(e.id);
      let rig = rigs.get(e.id);
      if (!rig) {
        rig = buildRig(e.color, e.label, e.armed === true, e.silhouette, e.zombie === true, seedOf(e.id));
        rig.lastX = e.x;
        rig.lastZ = e.z;
        rigs.set(e.id, rig);
        if (rig.label) group.add(rig.root); // solo para dibujar la etiqueta (sprite)
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
      animate(rig, dist);
      rig.root.updateMatrixWorld(true);

      for (const p of rig.parts) {
        const im = meshes.get(p.kind)!;
        const i = counts.get(p.kind) ?? 0;
        if (i >= im.instanceMatrix.count) continue;
        im.setMatrixAt(i, p.anchor.matrixWorld);
        im.setColorAt(i, p.color);
        counts.set(p.kind, i + 1);
        if (rig.silhouette) {
          const gm = ghosts.get(p.kind)!;
          const j = ghostCounts.get(p.kind) ?? 0;
          gm.setMatrixAt(j, p.anchor.matrixWorld);
          gm.setColorAt(j, rig.silhouette);
          ghostCounts.set(p.kind, j + 1);
        }
      }
      rig.root.matrixWorld.decompose(shadowPos, shadowQ, shadowS);
      shadowM.compose(shadowPos.setY(0.01), shadowQ, shadowS);
      shadows.setMatrixAt(shadowCount++, shadowM);
    }

    for (const kind of PART_KINDS) {
      for (const [map, cnt] of [
        [meshes, counts],
        [ghosts, ghostCounts],
      ] as const) {
        const im = map.get(kind)!;
        im.count = cnt.get(kind) ?? 0;
        im.instanceMatrix.needsUpdate = true;
        if (im.instanceColor) im.instanceColor.needsUpdate = true;
      }
    }
    shadows.count = shadowCount;
    shadows.instanceMatrix.needsUpdate = true;

    for (const [id, rig] of rigs) {
      if (seen.has(id)) continue;
      if (rig.label) group.remove(rig.root);
      rigs.delete(id);
    }
  }

  return { group, update };
}
