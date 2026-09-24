// Edificios a partir de primitivas (sin texturas, color plano): una pequeña
// librería de piezas (bloque, tejado a dos aguas, tejado a cuatro aguas,
// cilindro, cono, semicilindro, ventanas instanciadas) y unos cuantos
// arquetipos que las combinan (casa, tienda, torre escalonada, nave, silo,
// edificio en L). Sustituye al SkyscraperGenerator de three.js: sus mínimos
// arquitectónicos (~6.7 unidades de base) obligaban a reescalarlo y no dejaban
// variar el tamaño; con primitivas, cada arquetipo se adapta al hueco que
// worldgen reservó (3-5 tiles de lado).
//
// Toda la geometría base es compartida (una unidad, se escala por malla): un
// edificio son unas pocas mallas sobre buffers ya existentes. Lo único que se
// crea por edificio son las ventanas (un InstancedMesh, un solo draw call),
// que hay que liberar al cambiar de pantalla — ver disposeBuildings().
import * as THREE from "three";

function hash2(x: number, z: number): number {
  const h = Math.sin(x * 127.1 + z * 311.7) * 43758.5453;
  return h - Math.floor(h);
}

// ---- Geometría base compartida (tamaño unidad, apoyada en y=0) ----

const boxGeo = new THREE.BoxGeometry(1, 1, 1).translate(0, 0.5, 0);
const cylGeo = new THREE.CylinderGeometry(0.5, 0.5, 1, 20).translate(0, 0.5, 0);
const coneGeo = new THREE.ConeGeometry(0.5, 1, 20).translate(0, 0.5, 0);
// Pirámide de base cuadrada de lado 1 (tejado a cuatro aguas).
const hipGeo = new THREE.ConeGeometry(Math.SQRT1_2, 1, 4).rotateY(Math.PI / 4).translate(0, 0.5, 0);
// Cilindro con el eje a lo largo de Z, centrado en el origen: su mitad
// inferior queda dentro del bloque sobre el que se apoya (tejado curvo de nave).
const barrelGeo = new THREE.CylinderGeometry(0.5, 0.5, 1, 20).rotateX(Math.PI / 2);

// Prisma triangular (tejado a dos aguas): base de ancho 1 en X, cumbrera a lo
// largo de Z, altura 1. No indexado para que computeVertexNormals dé normales planas.
function makeGableGeo(): THREE.BufferGeometry {
  const A = [-0.5, 0, 0.5], B = [0.5, 0, 0.5], C = [0, 1, 0.5];
  const D = [-0.5, 0, -0.5], E = [0.5, 0, -0.5], F = [0, 1, -0.5];
  const tris = [A, B, C, E, D, F, A, C, D, C, F, D, B, E, C, C, E, F, A, D, B, B, D, E];
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(tris.flat(), 3));
  g.computeVertexNormals();
  return g;
}
const gableGeo = makeGableGeo();

// ---- Materiales por color (compartidos) ----

const materialCache = new Map<number, THREE.MeshLambertMaterial>();
function mat(color: number): THREE.MeshLambertMaterial {
  let m = materialCache.get(color);
  if (!m) {
    m = new THREE.MeshLambertMaterial({ color, flatShading: true });
    materialCache.set(color, m);
  }
  return m;
}

const WALLS = [0xb5654a, 0xe8dcc0, 0xd4a85a, 0xa9a9a4, 0x8ea0b3, 0xc98f6b];
const ROOFS = [0xa8412f, 0x4a5560, 0xc9673a, 0x4f7a5a, 0x6b4a3a];
const TRIM = 0xd9d2c0;
const WINDOW_COLOR = 0x26323f;
const AWNINGS = [0xc0392b, 0x2f6d9a, 0x3a8a4f];

function pick<T>(arr: T[], n: number): T {
  return arr[Math.floor(n * arr.length) % arr.length];
}

// ---- Primitivas ----

// Bloque centrado en (x,z), con la base en y.
function block(parent: THREE.Group, w: number, h: number, d: number, x: number, y: number, z: number, color: number): THREE.Mesh {
  const m = new THREE.Mesh(boxGeo, mat(color));
  m.scale.set(w, h, d);
  m.position.set(x, y, z);
  parent.add(m);
  return m;
}

// Tejado a dos aguas sobre un rectángulo w×d; ridgeAlongX decide hacia dónde corre la cumbrera.
function gableRoof(parent: THREE.Group, w: number, d: number, h: number, x: number, y: number, z: number, color: number, ridgeAlongX: boolean): void {
  const m = new THREE.Mesh(gableGeo, mat(color));
  if (ridgeAlongX) {
    m.rotation.y = Math.PI / 2;
    m.scale.set(d, h, w);
  } else {
    m.scale.set(w, h, d);
  }
  m.position.set(x, y, z);
  parent.add(m);
}

function hipRoof(parent: THREE.Group, w: number, d: number, h: number, x: number, y: number, z: number, color: number): void {
  const m = new THREE.Mesh(hipGeo, mat(color));
  m.scale.set(w, h, d);
  m.position.set(x, y, z);
  parent.add(m);
}

function cylinder(parent: THREE.Group, r: number, h: number, x: number, y: number, z: number, color: number): void {
  const m = new THREE.Mesh(cylGeo, mat(color));
  m.scale.set(r * 2, h, r * 2);
  m.position.set(x, y, z);
  parent.add(m);
}

function cone(parent: THREE.Group, r: number, h: number, x: number, y: number, z: number, color: number): void {
  const m = new THREE.Mesh(coneGeo, mat(color));
  m.scale.set(r * 2, h, r * 2);
  m.position.set(x, y, z);
  parent.add(m);
}

// Parapeto: marco fino alrededor de una azotea plana.
function parapet(parent: THREE.Group, w: number, d: number, x: number, y: number, z: number, color: number): void {
  const t = 0.06;
  const h = 0.14;
  block(parent, w, h, t, x, y, z + d / 2 - t / 2, color);
  block(parent, w, h, t, x, y, z - d / 2 + t / 2, color);
  block(parent, t, h, d - 2 * t, x + w / 2 - t / 2, y, z, color);
  block(parent, t, h, d - 2 * t, x - w / 2 + t / 2, y, z, color);
}

// ---- Ventanas: un único InstancedMesh por edificio ----

const windowMat = new THREE.MeshLambertMaterial({ color: WINDOW_COLOR });
const FLOOR_H = 1.0; // ~3 m con 1 tile ≈ 3 m
const activeWindows: THREE.InstancedMesh[] = [];

interface Facade {
  w: number; // ancho del bloque en X
  d: number; // fondo del bloque en Z
  x: number;
  z: number;
  baseY: number;
  floors: number;
  skipGround?: boolean; // deja la planta baja libre (p. ej. tienda con su propio escaparate)
}

function addWindows(parent: THREE.Group, f: Facade): void {
  const ww = 0.3;
  const wh = 0.42;
  const wd = 0.04;
  const mats: THREE.Matrix4[] = [];
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const s = new THREE.Vector3(ww, wh, wd);
  const p = new THREE.Vector3();
  const facades: Array<{ len: number; cx: number; cz: number; rotY: number }> = [
    { len: f.w, cx: f.x, cz: f.z + f.d / 2, rotY: 0 },
    { len: f.w, cx: f.x, cz: f.z - f.d / 2, rotY: Math.PI },
    { len: f.d, cx: f.x + f.w / 2, cz: f.z, rotY: Math.PI / 2 },
    { len: f.d, cx: f.x - f.w / 2, cz: f.z, rotY: -Math.PI / 2 },
  ];
  for (const fc of facades) {
    const cols = Math.max(2, Math.floor(fc.len / 0.75));
    const step = fc.len / cols;
    q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), fc.rotY);
    const along = new THREE.Vector3(Math.cos(fc.rotY), 0, -Math.sin(fc.rotY)); // eje local X de la fachada, en mundo
    const out = new THREE.Vector3(Math.sin(fc.rotY), 0, Math.cos(fc.rotY)); // normal exterior
    for (let fl = f.skipGround ? 1 : 0; fl < f.floors; fl++) {
      const y = f.baseY + fl * FLOOR_H + FLOOR_H * 0.5 - wh / 2;
      for (let c = 0; c < cols; c++) {
        const off = -fc.len / 2 + step * (c + 0.5);
        p.set(fc.cx + along.x * off + out.x * 0.01, y, fc.cz + along.z * off + out.z * 0.01);
        m.compose(p, q, s);
        mats.push(m.clone());
      }
    }
  }
  if (mats.length === 0) return;
  const inst = new THREE.InstancedMesh(boxGeo, windowMat, mats.length);
  mats.forEach((mm, i) => inst.setMatrixAt(i, mm));
  inst.instanceMatrix.needsUpdate = true;
  parent.add(inst);
  activeWindows.push(inst);
}

// ---- Arquetipos (todos centrados en el origen, base en y=0) ----
// `s` es el lado disponible en unidades de mundo (tiles reservados × 0.86).

function house(g: THREE.Group, s: number, n: number): void {
  const w = s * 0.8;
  const d = s * 0.7;
  const wall = pick(WALLS, n);
  const floors = 2;
  block(g, w, floors * FLOOR_H, d, 0, 0, 0, wall);
  addWindows(g, { w, d, x: 0, z: 0, baseY: 0, floors });
  gableRoof(g, w * 1.08, d * 1.08, 1.0, 0, floors * FLOOR_H, 0, pick(ROOFS, n * 7.3), n > 0.5);
  block(g, 0.25, 0.7, 0.25, w * 0.25, floors * FLOOR_H + 0.2, 0, 0x7a5a4a); // chimenea
  block(g, 0.4, 0.75, 0.05, 0, 0, d / 2 + 0.01, 0x5a3a2a); // puerta
}

function shop(g: THREE.Group, s: number, n: number): void {
  const w = s * 0.92;
  const d = s * 0.78;
  const floors = 2 + (n > 0.6 ? 1 : 0);
  const wall = pick(WALLS, n);
  block(g, w, floors * FLOOR_H, d, 0, 0, 0, wall);
  block(g, w * 1.02, 0.08, d * 1.02, 0, floors * FLOOR_H, 0, TRIM); // cornisa
  parapet(g, w, d, 0, floors * FLOOR_H + 0.08, 0, wall);
  addWindows(g, { w, d, x: 0, z: 0, baseY: 0, floors, skipGround: true });
  block(g, w * 0.8, 0.6, 0.03, 0, 0.15, d / 2 + 0.01, WINDOW_COLOR); // escaparate
  block(g, w * 0.9, 0.06, 0.4, 0, 0.85, d / 2 + 0.2, pick(AWNINGS, n * 3.1)); // toldo
}

function tower(g: THREE.Group, s: number, n: number): void {
  const wall = pick(WALLS, n);
  const tiers = [
    { k: 0.88, floors: 4 },
    { k: 0.68, floors: 3 },
    { k: 0.46, floors: 2 },
  ];
  let y = 0;
  for (const t of tiers) {
    const w = s * t.k;
    const h = t.floors * FLOOR_H;
    block(g, w, h, w, 0, y, 0, wall);
    addWindows(g, { w, d: w, x: 0, z: 0, baseY: y, floors: t.floors });
    block(g, w * 1.05, 0.07, w * 1.05, 0, y + h, 0, TRIM);
    y += h + 0.07;
  }
  cylinder(g, 0.04, 1.4, 0, y, 0, 0x444444); // antena
}

function warehouse(g: THREE.Group, s: number, n: number): void {
  const w = s * 0.95;
  const d = s * 0.75;
  const h = 2.0;
  block(g, w, h, d, 0, 0, 0, pick(WALLS, n));
  const roof = new THREE.Mesh(barrelGeo, mat(pick(ROOFS, n * 5.7)));
  roof.scale.set(w, 1.2 * 2, d);
  roof.position.set(0, h, 0);
  g.add(roof);
  block(g, w * 0.4, 1.3, 0.05, 0, 0, d / 2 + 0.01, 0x3a3f45); // portón
}

function silo(g: THREE.Group, s: number, n: number): void {
  const r = s * 0.36;
  const h = 3.5;
  cylinder(g, r, h, 0, 0, 0, pick(WALLS, n));
  cone(g, r * 1.15, 1.3, 0, h, 0, pick(ROOFS, n * 3.3));
  cylinder(g, r * 1.05, 0.08, 0, h * 0.5, 0, TRIM); // aro
}

function lShape(g: THREE.Group, s: number, n: number): void {
  const wall = pick(WALLS, n);
  const roof = pick(ROOFS, n * 4.9);
  const a = s * 0.9;
  const t = s * 0.42;
  // Ala larga a lo largo de X y ala corta a lo largo de Z formando una L.
  const floors = 2;
  const h = floors * FLOOR_H;
  block(g, a, h, t, 0, 0, s * 0.24, wall);
  addWindows(g, { w: a, d: t, x: 0, z: s * 0.24, baseY: 0, floors });
  gableRoof(g, a * 1.05, t * 1.1, 0.9, 0, h, s * 0.24, roof, true);
  const armLen = s * 0.55;
  const ax = -a / 2 + t / 2;
  const az = s * 0.24 - t / 2 - armLen / 2;
  block(g, t, h, armLen, ax, 0, az, wall);
  addWindows(g, { w: t, d: armLen, x: ax, z: az, baseY: 0, floors });
  gableRoof(g, t * 1.1, armLen * 1.02, 0.9, ax, h, az, roof, false);
}

function chooseArchetype(size: number, n: number): (g: THREE.Group, s: number, n: number) => void {
  if (size <= 3) return pick([house, shop, silo, house], n);
  if (size === 4) return pick([shop, house, tower, warehouse, lShape], n);
  return pick([tower, warehouse, lShape, shop, tower, silo], n);
}

// anchorX/anchorZ: esquina superior-izquierda del hueco reservado (mundo).
// footprintTiles: lado del hueco en tiles. Devuelve un Group centrado en el
// origen con la base en y=0; scene3d.ts lo coloca en el centro del hueco.
export function buildBuilding(anchorX: number, anchorZ: number, footprintTiles: number): THREE.Object3D {
  const n = hash2(anchorX + 0.33, anchorZ + 0.77);
  const g = new THREE.Group();
  const s = footprintTiles * 0.86;
  chooseArchetype(footprintTiles, n)(g, s, hash2(anchorX + 9.1, anchorZ + 4.7));
  // Orientación variada en pasos de 90° para que no miren todos igual.
  g.rotation.y = (Math.floor(n * 4) * Math.PI) / 2;
  return g;
}

export function disposeBuildings(): void {
  for (const w of activeWindows) w.dispose();
  activeWindows.length = 0;
}
