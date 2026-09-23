// Fase 2 de la migración a 3D (ver plan): puerto del generador de árboles de
// client/src/render/proceduralTree.ts (algoritmo 2D en canvas) a geometría
// real de three.js. Mismos parámetros de TreeDef, misma jerarquía tronco→
// rama→subrama→hoja y las mismas fórmulas de balanceo por viento — pero
// aquí la jerarquía de Object3D ES el sistema de animación (nido de
// save/rotate del canvas 2D → nido de Group.rotation en 3D), no hace falta
// re-hornear nada cada frame.
//
// Simplificaciones deliberadas frente al algoritmo 2D (ver informe de la
// Fase 2): el retorcido de tronco/rama (bentOutline, una curva en S) se
// sustituye por un cilindro recto cónico — el retorcido era necesario en 2D
// para dar interés visual a una silueta plana; en 3D con luz y ramificación
// real ya no hace falta, y añadir tubos curvos habría multiplicado la
// complejidad para un matiz menor. trunkTwist/branchTwist quedan sin usar
// por ahora (candidatos a una vuelta futura si se echa en falta el retorcido).
import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import type { TreeDef, LeafShape } from "@roi/shared";

// 1 unidad de mundo = 1 tile = 64px del TreeDef 2D (mismo TILE_W que usaba
// el renderer 2D), así los valores de altura/ancho ya calibrados en el
// backoffice se ven con el tamaño esperado sin tener que retocarlos.
const WORLD_SCALE = 1 / 64;

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function shade(c: THREE.Color, amt: number): THREE.Color {
  const f = (v: number) => Math.max(0, Math.min(1, amt >= 0 ? v + (1 - v) * amt : v * (1 + amt)));
  return new THREE.Color(f(c.r), f(c.g), f(c.b));
}

// Mismas siluetas planas de hoja que en 2D, en unidades -1..1: se comparten
// como geometría base (una por forma) y cada hoja solo aplica su propia
// escala/rotación/posición/color al fusionarse en el racimo.
const LEAF_SHAPES_PTS: Record<LeafShape, Array<[number, number]>> = {
  round: [[0, 1], [0.87, 0.5], [0.87, -0.5], [0, -1], [-0.87, -0.5], [-0.87, 0.5]],
  oval: [[0, 1], [0.7, 0.6], [0.9, 0], [0.7, -0.6], [0, -1], [-0.7, -0.6], [-0.9, 0], [-0.7, 0.6]],
  pointed: [[0, 1], [0.55, 0.3], [0.35, -0.6], [0, -1], [-0.35, -0.6], [-0.55, 0.3]],
  needle: [[0, 1], [0.18, 0], [0, -1], [-0.18, 0]],
};

const leafBaseGeoCache = new Map<LeafShape, THREE.ShapeGeometry>();
function leafBaseGeometry(leafShape: LeafShape): THREE.ShapeGeometry {
  let g = leafBaseGeoCache.get(leafShape);
  if (!g) {
    const pts = LEAF_SHAPES_PTS[leafShape] ?? LEAF_SHAPES_PTS.oval;
    const shape = new THREE.Shape(pts.map(([x, y]) => new THREE.Vector2(x, y)));
    g = new THREE.ShapeGeometry(shape);
    leafBaseGeoCache.set(leafShape, g);
  }
  return g;
}

// Ángulo de una rama respecto a la VERTICAL (0 = recto hacia arriba, PI/2 =
// horizontal): distribución triangular (media de dos tiradas), igual que en
// 2D — hace comunes los valores intermedios (~45°) y raros los extremos. La
// longitud varía según la forma de copa elegida. A diferencia de 2D (que
// vivía en un único plano, la pantalla), aquí se combina con un azimut para
// repartir las ramas alrededor de todo el tronco, no solo a izq/derecha.
function branchGeometry(def: TreeDef, t: number, rng: () => number): { deviation: number; length: number } {
  const distFromCenter = Math.abs(t - 0.5) * 2;
  const widthFactor = def.canopyShape === "wide" ? 1 : def.canopyShape === "triangular" ? 0.6 : 0.85;
  const maxDeviation = (Math.PI / 2) * (0.5 + def.canopyWidth * 0.5) * widthFactor;
  const bias = (rng() + rng()) / 2;
  const deviation = Math.max(0, Math.min(Math.PI / 2, bias * maxDeviation));

  let length: number;
  if (def.canopyShape === "triangular") {
    length = def.height * (0.2 + distFromCenter * 0.28) * (0.85 + rng() * 0.3);
  } else if (def.canopyShape === "wide") {
    length = def.height * (0.32 + def.canopyWidth * 0.14) * (0.85 + rng() * 0.3);
  } else {
    length = def.height * (0.3 + rng() * 0.18);
  }
  return { deviation, length: length * WORLD_SCALE };
}

function dirFromAngles(deviation: number, azimuth: number): THREE.Vector3 {
  return new THREE.Vector3(Math.sin(deviation) * Math.cos(azimuth), Math.cos(deviation), Math.sin(deviation) * Math.sin(azimuth));
}

const UP = new THREE.Vector3(0, 1, 0);

// Orienta y posiciona un cilindro (por defecto centrado en el origen, eje Y)
// para que vaya de `from` a `from + dir*length`.
function placeLimb(mesh: THREE.Mesh, from: THREE.Vector3, dir: THREE.Vector3, length: number): void {
  mesh.position.copy(from).addScaledVector(dir, length / 2);
  mesh.quaternion.setFromUnitVectors(UP, dir);
}

interface LeafInstance {
  x: number;
  y: number;
  z: number;
  size: number;
  color: THREE.Color;
}

function computeLeafCluster(def: TreeDef, rng: () => number, count: number, sunColor: THREE.Color, shadeColor: THREE.Color): LeafInstance[] {
  const spreadBase = def.height * 0.09 * WORLD_SCALE;
  const leaves: LeafInstance[] = [];
  let minY = Infinity;
  let maxY = -Infinity;
  const raw: Array<{ x: number; y: number; z: number }> = [];
  for (let k = 0; k < count; k++) {
    const spread = spreadBase * (0.3 + rng() * 0.8);
    const a = rng() * Math.PI * 2;
    const r = rng();
    const x = Math.cos(a) * spread * r;
    const y = Math.sin(a) * spread * r * 0.85;
    const z = (rng() - 0.5) * spread * 0.9;
    raw.push({ x, y, z });
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }
  const dotSize = Math.max(1.6, def.height * 0.02) * WORLD_SCALE;
  const lerped = new THREE.Color();
  for (const p of raw) {
    const baseExpo = maxY > minY ? (p.y - minY) / (maxY - minY) : 1;
    const expo = Math.max(0, Math.min(1, baseExpo + (rng() - 0.5) * 0.4));
    lerped.copy(shadeColor).lerp(sunColor, expo);
    const size = dotSize * (0.6 + rng() * 0.9);
    leaves.push({ x: p.x, y: p.y, z: p.z, size, color: lerped.clone() });
  }
  return leaves;
}

// Funde todas las hojas de un racimo en UNA sola malla con color por vértice
// — la lección de rendimiento de la caché 2D pieza a pieza, aplicada aquí:
// un árbol con leafCount alto puede significar cientos de hojas por rama, y
// una malla individual por hoja dispararía el nº de objetos/materiales.
function buildLeafClusterMesh(leaves: LeafInstance[], leafShape: LeafShape): THREE.BufferGeometry {
  const base = leafBaseGeometry(leafShape);
  const m = new THREE.Matrix4();
  const parts: THREE.BufferGeometry[] = leaves.map((leaf) => {
    const g = base.clone();
    const angleY = Math.random() * Math.PI * 2;
    const angleX = (Math.random() - 0.5) * Math.PI * 0.6;
    m.compose(
      new THREE.Vector3(leaf.x, leaf.y, leaf.z),
      new THREE.Quaternion().setFromEuler(new THREE.Euler(angleX, angleY, 0)),
      new THREE.Vector3(leaf.size, leaf.size, leaf.size)
    );
    g.applyMatrix4(m);
    const colors = new Float32Array(g.attributes.position.count * 3);
    for (let i = 0; i < g.attributes.position.count; i++) {
      colors[i * 3] = leaf.color.r;
      colors[i * 3 + 1] = leaf.color.g;
      colors[i * 3 + 2] = leaf.color.b;
    }
    g.setAttribute("color", new THREE.BufferAttribute(colors, 3));
    return g;
  });
  return mergeGeometries(parts, false);
}

interface SubBranchRes {
  from: THREE.Vector3; // punto de arranque, relativo a la punta de la rama madre
  dir: THREE.Vector3;
  length: number;
  geo: THREE.CylinderGeometry;
  mat: THREE.MeshLambertMaterial;
  swayCoef: number;
  leafGeo: THREE.BufferGeometry | null;
  leafMat: THREE.MeshLambertMaterial | null;
  leafPhaseOffset: number;
}

interface BranchRes {
  attachY: number;
  dir: THREE.Vector3;
  length: number;
  geo: THREE.CylinderGeometry;
  mat: THREE.MeshLambertMaterial;
  knotGeo: THREE.IcosahedronGeometry;
  knotMat: THREE.MeshLambertMaterial;
  swayCoef: number;
  subBranches: SubBranchRes[];
}

export interface TreeResources {
  trunkGeo: THREE.CylinderGeometry;
  trunkMat: THREE.MeshLambertMaterial;
  trunkHeight: number;
  branches: BranchRes[];
}

// Construye, una única vez por variante (treeDefId + índice de instancia),
// todas las geometrías/materiales del árbol y la disposición de la
// jerarquía. El mismo criterio que la caché 2D: lo caro (geometría) se
// hornea una vez; instantiateTree() solo monta objetos ligeros que la
// referencian, uno por cada planta real en el mundo.
export function buildTreeResources(def: TreeDef): TreeResources {
  const rng = mulberry32(def.seed);
  const trunkColor = new THREE.Color(def.trunkColor);
  const sunColor = new THREE.Color(def.leafColorSun);
  const shadeCol = new THREE.Color(def.leafColorShade);

  const trunkHeight = def.height * 0.45 * WORLD_SCALE;
  const trunkGeo = new THREE.CylinderGeometry(def.trunkWidth * 0.55 * 0.5 * WORLD_SCALE, def.trunkWidth * 0.5 * WORLD_SCALE, trunkHeight, 6);
  const trunkMat = new THREE.MeshLambertMaterial({ color: shade(trunkColor, -0.15) });

  const branchCount = Math.max(1, def.branchCount);
  const branches: BranchRes[] = [];
  for (let i = 0; i < branchCount; i++) {
    const t = branchCount === 1 ? 0.5 : i / (branchCount - 1);
    const attachFrac = def.branchStartHeight + (1 - def.branchStartHeight) * t;
    const attachY = trunkHeight * attachFrac;
    const { deviation, length } = branchGeometry(def, t, rng);
    const azimuth = (i / branchCount) * Math.PI * 2 + (rng() - 0.5) * 0.6;
    const dir = dirFromAngles(deviation, azimuth);

    const knotR = def.trunkWidth * (0.24 + rng() * 0.1) * 0.5 * WORLD_SCALE;
    const swayCoef = 0.6 + rng() * 0.8;

    const geo = new THREE.CylinderGeometry(def.trunkWidth * 0.12 * 0.5 * WORLD_SCALE, def.trunkWidth * 0.4 * 0.5 * WORLD_SCALE, length, 5);
    const mat = new THREE.MeshLambertMaterial({ color: shade(trunkColor, -0.05) });
    const knotGeo = new THREE.IcosahedronGeometry(knotR, 0);
    const knotMat = new THREE.MeshLambertMaterial({ color: shade(trunkColor, -0.2), flatShading: true });

    const splitAngle = 0.3 + def.canopyWidth * 0.7;
    const subLen = length * (0.35 + rng() * 0.2);
    const lengthFrac = Math.min(1, length / (def.height * WORLD_SCALE));
    const subBranchCount = Math.max(2, Math.round(2 + lengthFrac * 4));
    const dotsPerSub = Math.max(4, Math.round((def.leafCount * 4) / (branchCount * subBranchCount)));

    const subBranches: SubBranchRes[] = [];
    for (let k = 0; k < subBranchCount; k++) {
      const kt = subBranchCount === 1 ? 0 : (k / (subBranchCount - 1) - 0.5) * 2;
      const subDeviation = Math.max(0, Math.min(Math.PI / 2, deviation + kt * splitAngle * (0.6 + rng() * 0.5)));
      const subAzimuth = azimuth + kt * splitAngle * (0.6 + rng() * 0.5);
      const subDir = dirFromAngles(subDeviation, subAzimuth);

      const subSwayCoef = (1.4 * kt + 0.3) * (0.7 + rng() * 0.4);
      const subGeo = new THREE.CylinderGeometry(
        def.trunkWidth * 0.05 * 0.5 * WORLD_SCALE,
        def.trunkWidth * 0.14 * 0.5 * WORLD_SCALE,
        subLen,
        4
      );
      const subMat = new THREE.MeshLambertMaterial({ color: shade(trunkColor, 0.05) });

      const leaves = computeLeafCluster(def, rng, dotsPerSub, sunColor, shadeCol);
      let leafGeo: THREE.BufferGeometry | null = null;
      let leafMat: THREE.MeshLambertMaterial | null = null;
      if (leaves.length > 0) {
        leafGeo = buildLeafClusterMesh(leaves, def.leafShape);
        leafMat = new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide });
      }

      subBranches.push({
        from: dir.clone().multiplyScalar(length),
        dir: subDir,
        length: subLen,
        geo: subGeo,
        mat: subMat,
        swayCoef: subSwayCoef,
        leafGeo,
        leafMat,
        leafPhaseOffset: def.seed * 2.3 + i * 1.7 + k,
      });
    }

    branches.push({ attachY, dir, length, geo, mat, knotGeo, knotMat, swayCoef, subBranches });
  }

  return { trunkGeo, trunkMat, trunkHeight, branches };
}

interface TreeHandle {
  root: THREE.Group;
  update(time: number, def: TreeDef): void;
}

// Monta la jerarquía de Object3D ligera (comparte geometría/material con
// TreeResources) para UNA planta concreta en el mundo, y devuelve una
// función que recalcula el balanceo cada frame. La jerarquía de grupos ES la
// animación: rotar el grupo del tronco mueve todo lo de dentro, rotar el de
// una rama mueve solo esa rama y sus hijas — igual que save/rotate anidados
// en el canvas 2D, pero sin tener que rehacer ningún trazo.
export function instantiateTree(res: TreeResources): TreeHandle {
  const trunkGroup = new THREE.Group();
  const trunkMesh = new THREE.Mesh(res.trunkGeo, res.trunkMat);
  trunkMesh.position.y = res.trunkHeight / 2;
  trunkGroup.add(trunkMesh);

  const branchPivots: Array<{ pivot: THREE.Group; swayCoef: number; subs: Array<{ pivot: THREE.Group; swayCoef: number; leafGroup: THREE.Group | null; leafPhaseOffset: number }> }> = [];

  for (const b of res.branches) {
    const knot = new THREE.Mesh(b.knotGeo, b.knotMat);
    knot.position.y = b.attachY;
    trunkGroup.add(knot);

    const branchPivot = new THREE.Group();
    branchPivot.position.y = b.attachY;
    trunkGroup.add(branchPivot);

    const branchMesh = new THREE.Mesh(b.geo, b.mat);
    placeLimb(branchMesh, new THREE.Vector3(0, 0, 0), b.dir, b.length);
    branchPivot.add(branchMesh);

    const subs: Array<{ pivot: THREE.Group; swayCoef: number; leafGroup: THREE.Group | null; leafPhaseOffset: number }> = [];
    for (const s of b.subBranches) {
      const subPivot = new THREE.Group();
      subPivot.position.copy(s.from);
      branchPivot.add(subPivot);

      const subMesh = new THREE.Mesh(s.geo, s.mat);
      placeLimb(subMesh, new THREE.Vector3(0, 0, 0), s.dir, s.length);
      subPivot.add(subMesh);

      let leafGroup: THREE.Group | null = null;
      if (s.leafGeo && s.leafMat) {
        leafGroup = new THREE.Group();
        leafGroup.position.copy(s.dir).multiplyScalar(s.length);
        const leafMesh = new THREE.Mesh(s.leafGeo, s.leafMat);
        leafGroup.add(leafMesh);
        subPivot.add(leafGroup);
      }

      subs.push({ pivot: subPivot, swayCoef: s.swayCoef, leafGroup, leafPhaseOffset: s.leafPhaseOffset });
    }

    branchPivots.push({ pivot: branchPivot, swayCoef: b.swayCoef, subs });
  }

  function update(time: number, def: TreeDef): void {
    const w = def.windSway / 100;
    const windPhase = Math.sin(time * 1.3 + def.seed * 0.7);
    const windFlutter = Math.sin(time * 3.4 + def.seed * 1.9);
    const trunkSway = windPhase * w * 0.06;
    const branchSway = (windPhase * 0.32 + windFlutter * 0.07) * w * def.branchFlexibility;
    const leafShimmerBase = w * 0.35;
    const leanAngle = def.lean * 0.4;

    trunkGroup.rotation.z = trunkSway + leanAngle;
    for (const b of branchPivots) {
      b.pivot.rotation.z = branchSway * b.swayCoef;
      for (const s of b.subs) {
        s.pivot.rotation.z = branchSway * s.swayCoef;
        if (s.leafGroup) s.leafGroup.rotation.z = Math.sin(time * 7.5 + s.leafPhaseOffset) * leafShimmerBase;
      }
    }
  }

  return { root: trunkGroup, update };
}

export interface TreeInstance {
  offsetX: number;
  offsetZ: number;
  index: number;
  instanceDef: TreeDef;
}

// Igual que resolveInstanceOffsets + la variación por copia de drawPlacedTree
// en el generador 2D: countPerTile copias de un mismo árbol "patrón", cada
// una con su posición dentro del tileSpan×tileSpan (guardada a mano en el
// backoffice o repartida sola) y, a partir de la segunda, con tamaño/ancho de
// tronco/nº de ramas ligeramente distintos para que no se vean clones exactos.
export function resolveTreeInstances(def: TreeDef): TreeInstance[] {
  const span = def.tileSpan || 1;
  const bound = 0.5 * span + 0.1;
  const stored = Array.isArray(def.instanceOffsets) ? def.instanceOffsets : [];
  const offsetRng = mulberry32(def.seed * 7 + 3);
  const varyRng = mulberry32(def.seed * 13 + 5);
  const count = Math.max(1, def.countPerTile);

  const out: TreeInstance[] = [];
  for (let i = 0; i < count; i++) {
    let ox = 0;
    let oy = 0;
    if (stored[i]) {
      ox = stored[i].x;
      oy = stored[i].y;
    } else if (i > 0) {
      ox = (offsetRng() - 0.5) * 0.7 * span;
      oy = (offsetRng() - 0.5) * 0.5 * span;
    }
    ox = Math.max(-bound, Math.min(bound, ox));
    oy = Math.max(-bound * 0.85, Math.min(bound * 0.85, oy));

    const instanceDef: TreeDef =
      i === 0
        ? def
        : {
            ...def,
            seed: def.seed + i * 97,
            height: def.height * (0.75 + varyRng() * 0.3),
            trunkWidth: def.trunkWidth * (0.8 + varyRng() * 0.35),
            branchCount: Math.max(1, def.branchCount + Math.round((varyRng() - 0.5) * 3)),
          };
    out.push({ offsetX: ox, offsetZ: oy, index: i, instanceDef });
  }
  return out;
}
