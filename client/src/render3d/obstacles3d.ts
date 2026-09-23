// Fase 1 de la migración a 3D (ver plan): formas low-poly sin textura, color
// plano por vértice, para los TileType "obstáculo" (Rock/Building/Fence/
// Cactus — Tree queda para el sistema de árboles procedurales de la Fase 2,
// no se toca aquí). Cada tipo tiene un puñado de variantes fijas construidas
// UNA vez; cada aparición en el mundo es un `.clone()` barato (comparte
// geometría/material, solo copia la transformación).
//
// El recuento de estos tiles por pantalla es bajo (como mucho un puñado,
// según las probabilidades de worldgen), así que no hace falta InstancedMesh
// aquí — el suelo sí lo usa, en scene3d.ts, porque ahí el recuento es alto.
import * as THREE from "three";
import { TileType } from "@roi/shared";

function box(w: number, h: number, d: number, color: number): THREE.Mesh {
  return new THREE.Mesh(new THREE.BoxGeometry(w, h, d), new THREE.MeshLambertMaterial({ color }));
}

// --- Roca: icosaedro irregular (flatShading = facetas visibles, look low-poly) ---
const ROCK_COLOR = 0x8a8a86;
function buildRockVariant(scale: number): THREE.Group {
  const group = new THREE.Group();
  const mesh = new THREE.Mesh(
    new THREE.IcosahedronGeometry(0.4 * scale, 0),
    new THREE.MeshLambertMaterial({ color: ROCK_COLOR, flatShading: true })
  );
  mesh.position.y = 0.26 * scale;
  mesh.rotation.set(0.3, 0.6, 0.1);
  group.add(mesh);
  return group;
}
const ROCK_VARIANTS = [buildRockVariant(0.8), buildRockVariant(1.15)];

// --- Edificio: caseta de tejado a cuatro aguas, colores cálidos (diorama) ---
const ROOF_COLORS = [0xd94f4f, 0x4f7ed9, 0xe0a23a];
function buildBuildingVariant(roofColor: number): THREE.Group {
  const group = new THREE.Group();
  const body = box(0.85, 0.55, 0.85, 0xf1e6d0);
  body.position.y = 0.275;
  group.add(body);
  const roof = new THREE.Mesh(
    new THREE.ConeGeometry(0.68, 0.45, 4),
    new THREE.MeshLambertMaterial({ color: roofColor, flatShading: true })
  );
  roof.position.y = 0.55 + 0.225;
  roof.rotation.y = Math.PI / 4;
  group.add(roof);
  return group;
}
const BUILDING_VARIANTS = ROOF_COLORS.map(buildBuildingVariant);

// --- Valla: dos postes + un travesaño, madera ---
function buildFenceVariant(): THREE.Group {
  const group = new THREE.Group();
  const wood = 0x8a6a45;
  const postL = box(0.08, 0.35, 0.08, wood);
  postL.position.set(-0.35, 0.175, 0);
  const postR = box(0.08, 0.35, 0.08, wood);
  postR.position.set(0.35, 0.175, 0);
  const rail = box(0.86, 0.08, 0.06, wood);
  rail.position.set(0, 0.2, 0);
  group.add(postL, postR, rail);
  return group;
}
const FENCE_VARIANTS = [buildFenceVariant()];

// --- Cactus: tronco + un brazo, cápsulas redondeadas ---
function buildCactusVariant(): THREE.Group {
  const group = new THREE.Group();
  const green = 0x4f9a4f;
  const trunk = new THREE.Mesh(new THREE.CapsuleGeometry(0.14, 0.4, 2, 6), new THREE.MeshLambertMaterial({ color: green }));
  trunk.position.y = 0.35;
  group.add(trunk);
  const arm = new THREE.Mesh(new THREE.CapsuleGeometry(0.08, 0.22, 2, 6), new THREE.MeshLambertMaterial({ color: green }));
  arm.position.set(0.16, 0.42, 0);
  arm.rotation.z = Math.PI / 2.5;
  group.add(arm);
  return group;
}
const CACTUS_VARIANTS = [buildCactusVariant()];

const VARIANTS_BY_TYPE: Partial<Record<TileType, THREE.Group[]>> = {
  [TileType.Rock]: ROCK_VARIANTS,
  [TileType.Building]: BUILDING_VARIANTS,
  [TileType.Fence]: FENCE_VARIANTS,
  [TileType.Cactus]: CACTUS_VARIANTS,
};

// hash en [0,1) determinista por celda (mismo criterio que hash2 en el
// scene.ts 2D): elige variante y, para el que solo tiene una, sirve igual
// como semilla de una pequeña rotación/escala para que no se vean clones idénticos.
export function buildObstacle(tile: TileType, hash: number): THREE.Object3D | null {
  const variants = VARIANTS_BY_TYPE[tile];
  if (!variants) return null;
  const idx = Math.floor(hash * variants.length) % variants.length;
  const obj = variants[idx].clone(true);
  obj.rotation.y = hash * Math.PI * 2;
  return obj;
}
