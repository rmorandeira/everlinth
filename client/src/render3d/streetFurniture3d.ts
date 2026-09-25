// Mobiliario urbano estilo Nueva York (procedural, en unidades de render: 1 = 3 m):
// - Farola "cobra": poste alto troncocónico gris, brazo que se curva hacia la calzada
//   y cabeza ovalada con la parte de abajo luminosa.
// - Semáforo de mástil: poste en la esquina con un brazo largo sobre la calzada del
//   que cuelgan cabezas amarillas de tres focos (rojo/ámbar/verde) mirando a los
//   coches que llegan, y una cabeza en el propio poste.
// - Semáforo peatonal (mano naranja / peatón blanco) en el poste, mirando al paso.
// Los focos usan materiales compartidos por "eje" del cruce (A/B): updateSignals()
// cambia su color cada frame, así todos los semáforos cambian de fase de verdad
// (cuando un eje está en verde, el otro está en rojo) sin tocar la geometría.
import * as THREE from "three";

const cyl = new THREE.CylinderGeometry(1, 1, 1, 10).translate(0, 0.5, 0);
const cone = new THREE.CylinderGeometry(0.6, 1, 1, 10).translate(0, 0.5, 0); // se estrecha hacia arriba
const box = new THREE.BoxGeometry(1, 1, 1);
const sphere = new THREE.SphereGeometry(1, 12, 8);
const disc = new THREE.CircleGeometry(1, 12);

const mats = new Map<number, THREE.MeshLambertMaterial>();
function lambert(color: number): THREE.MeshLambertMaterial {
  let m = mats.get(color);
  if (!m) {
    m = new THREE.MeshLambertMaterial({ color });
    mats.set(color, m);
  }
  return m;
}
const POLE = 0x5f656b;
const SIGNAL_YELLOW = 0xe8b400;
const lampGlow = new THREE.MeshBasicMaterial({ color: 0xfff0c8 });

// ---- Focos con fase ----
const OFF = { red: 0x3a0e0e, amber: 0x3a2a08, green: 0x0c2a14, walk: 0x2a2a2a, hand: 0x2a1606 };
const ON = { red: 0xff2a1a, amber: 0xffb020, green: 0x33ff7a, walk: 0xf4f4f0, hand: 0xff7a1a };
type Lens = keyof typeof ON;
const lensMats: Record<"A" | "B", Record<Lens, THREE.MeshBasicMaterial>> = {
  A: { red: new THREE.MeshBasicMaterial(), amber: new THREE.MeshBasicMaterial(), green: new THREE.MeshBasicMaterial(), walk: new THREE.MeshBasicMaterial(), hand: new THREE.MeshBasicMaterial() },
  B: { red: new THREE.MeshBasicMaterial(), amber: new THREE.MeshBasicMaterial(), green: new THREE.MeshBasicMaterial(), walk: new THREE.MeshBasicMaterial(), hand: new THREE.MeshBasicMaterial() },
};

// Ciclo de 16 s: eje A verde 0-6, ámbar 6-8, rojo 8-16; eje B rojo 0-8, verde 8-14,
// ámbar 14-16. Los peatones que cruzan la calle de un eje caminan cuando ese eje está
// en rojo (mano naranja fija en los últimos segundos, parpadeando antes).
const CYCLE = 16;
function axisState(t: number, axis: "A" | "B"): "green" | "amber" | "red" {
  const u = (((t + (axis === "B" ? CYCLE / 2 : 0)) % CYCLE) + CYCLE) % CYCLE;
  return u < 6 ? "green" : u < 8 ? "amber" : "red";
}
export function updateSignals(time: number): void {
  for (const axis of ["A", "B"] as const) {
    const st = axisState(time, axis);
    const m = lensMats[axis];
    m.red.color.setHex(st === "red" ? ON.red : OFF.red);
    m.amber.color.setHex(st === "amber" ? ON.amber : OFF.amber);
    m.green.color.setHex(st === "green" ? ON.green : OFF.green);
    // peatones: cruzan cuando los coches de este eje están en rojo
    const u = (((time + (axis === "B" ? CYCLE / 2 : 0)) % CYCLE) + CYCLE) % CYCLE;
    const walk = u >= 8.5 && u < 13.5;
    const flashing = u >= 13.5 && u < 15.5 && Math.floor(time * 2) % 2 === 0;
    m.walk.color.setHex(walk ? ON.walk : OFF.walk);
    m.hand.color.setHex(!walk && !flashing ? ON.hand : OFF.hand);
  }
}

function part(g: THREE.Group, geo: THREE.BufferGeometry, mat: THREE.Material, sx: number, sy: number, sz: number, x: number, y: number, z: number): THREE.Mesh {
  const m = new THREE.Mesh(geo, mat);
  m.scale.set(sx, sy, sz);
  m.position.set(x, y, z);
  g.add(m);
  return m;
}

// Farola cobra en (x,z) con el brazo hacia la calzada (dx,dz unitario).
export function nycStreetlight(x: number, z: number, dx: number, dz: number): THREE.Object3D {
  const g = new THREE.Group();
  const H = 2.9;
  part(g, cyl, lambert(POLE), 0.075, 0.25, 0.075, 0, 0, 0); // basa
  part(g, cone, lambert(POLE), 0.045, H, 0.045, 0, 0.25, 0); // fuste
  // brazo: arco de cuarto de círculo y tramo recto, en el plano local XY (+X = calzada)
  const R = 0.35;
  const top = 0.25 + H;
  let px = 0;
  let py = top - R;
  for (let i = 1; i <= 5; i++) {
    const a = (i / 5) * (Math.PI / 2);
    const nx = R - Math.cos(a) * R;
    const ny = top - R + Math.sin(a) * R;
    const len = Math.hypot(nx - px, ny - py);
    const seg = part(g, cyl, lambert(POLE), 0.025, len, 0.025, px, py, 0);
    seg.rotation.z = -Math.atan2(nx - px, ny - py);
    px = nx;
    py = ny;
  }
  const armLen = 0.85;
  const straight = part(g, cyl, lambert(POLE), 0.024, armLen, 0.024, px, py, 0);
  straight.rotation.z = -Math.PI / 2 + 0.06;
  const hx = px + armLen;
  const hy = py - 0.05;
  part(g, sphere, lambert(0x7a8088), 0.2, 0.06, 0.1, hx, hy, 0); // cabeza ovalada
  const glow = part(g, disc, lampGlow, 0.15, 0.075, 1, hx, hy - 0.045, 0);
  glow.rotation.x = Math.PI / 2; // luz hacia abajo
  g.position.set(x, 0.05, z);
  g.rotation.y = -Math.atan2(dz, dx);
  return g;
}

// Cabeza de semáforo de tres focos mirando a +Z local.
function signalHead(g: THREE.Object3D, x: number, y: number, z: number, axis: "A" | "B"): void {
  const h = new THREE.Group();
  const body = new THREE.Mesh(box, lambert(SIGNAL_YELLOW));
  body.scale.set(0.12, 0.36, 0.1);
  h.add(body);
  const lenses: Lens[] = ["red", "amber", "green"];
  lenses.forEach((l, i) => {
    const d = new THREE.Mesh(disc, lensMats[axis][l]);
    d.scale.setScalar(0.036);
    d.position.set(0, 0.11 - i * 0.11, 0.051);
    h.add(d);
    const visor = new THREE.Mesh(box, lambert(0x1c1c1c));
    visor.scale.set(0.09, 0.012, 0.05);
    visor.position.set(0, 0.11 - i * 0.11 + 0.045, 0.075);
    h.add(visor);
  });
  h.position.set(x, y, z);
  g.add(h);
}

// Semáforo peatonal (mano / peatón) mirando a +Z local.
function pedHead(g: THREE.Object3D, x: number, y: number, z: number, axis: "A" | "B"): void {
  const h = new THREE.Group();
  const body = new THREE.Mesh(box, lambert(SIGNAL_YELLOW));
  body.scale.set(0.13, 0.13, 0.07);
  h.add(body);
  const hand = new THREE.Mesh(box, lensMats[axis].hand);
  hand.scale.set(0.05, 0.06, 0.005);
  hand.position.set(-0.03, 0, 0.036);
  h.add(hand);
  const walk = new THREE.Mesh(box, lensMats[axis].walk);
  walk.scale.set(0.03, 0.07, 0.005);
  walk.position.set(0.035, 0, 0.036);
  h.add(walk);
  h.position.set(x, y, z);
  g.add(h);
}

/**
 * Semáforo de mástil en la esquina (x,z), en unidades de render.
 * heading: sentido de los coches que llegan (unitario, en XZ); el brazo sale hacia la
 * izquierda del conductor, sobre la calzada, y lleva una cabeza por carril (distancias
 * desde el poste hacia la calzada, en unidades). axis: fase del cruce a la que obedece.
 */
export function nycTrafficSignal(x: number, z: number, hx: number, hz: number, laneOffsets: number[], axis: "A" | "B"): THREE.Object3D {
  const g = new THREE.Group();
  const H = 2.3;
  part(g, cyl, lambert(POLE), 0.07, 0.2, 0.07, 0, 0, 0);
  part(g, cone, lambert(POLE), 0.042, H, 0.042, 0, 0.2, 0);
  // Marco local: +Z = hacia el conductor que llega (las cabezas le miran),
  // +X = derecha del conductor (el poste está en la acera derecha): el brazo va hacia -X.
  const reach = Math.max(...laneOffsets, 0.6) + 0.25;
  const arm = part(g, cyl, lambert(POLE), 0.028, reach, 0.028, 0, H - 0.1, 0);
  arm.rotation.z = Math.PI / 2 - 0.12; // hacia -X, ligeramente hacia arriba, como en la foto
  for (const off of laneOffsets) signalHead(g, -off, H - 0.1 + off * 0.12 - 0.22, 0, axis);
  signalHead(g, -0.1, 1.6, 0, axis); // cabeza en el poste
  // semáforo peatonal mirando al otro lado del paso (hacia -X local, cruzando la calle)
  const ped = new THREE.Group();
  pedHead(ped, 0, 0, 0, axis === "A" ? "B" : "A");
  ped.position.set(-0.08, 1.05, 0);
  ped.rotation.y = -Math.PI / 2;
  g.add(ped);
  // señal de "ONE WAY"/nombre: placa blanca y verde en el poste
  part(g, box, lambert(0x2f6b3f), 0.36, 0.07, 0.01, 0.1, 2.05, 0.03);

  g.position.set(x, 0.05, z);
  // +Z local → hacia el conductor = -heading; +X local → derecha del conductor
  g.rotation.y = Math.atan2(-hx, -hz);
  return g;
}
