// Coches aparcados destructibles. Se dibujan con instancing (una malla por tipo de
// pieza para todos los coches) y cada coche guarda su daño (por su posición en el
// mundo, así el daño se conserva al cambiar de sala).
//
// Impactos (cosméticos, en el cliente: la bala del servidor no se detiene en coches):
// - cada bala lo agita un poco;
// - con daño medio pierde una rueda (sale rodando y el coche se hunde de ese lado);
// - con más daño salta el capó dando vueltas;
// - al agotar la vida explota: fogonazo con luz, bola de fuego, piezas, humo, y queda
//   calcinado y ardiendo un rato.
import * as THREE from "three";

export interface CarSpec {
  key: string; // identidad estable (posición global)
  x: number; // unidades de render, locales a la escena
  z: number;
  ang: number; // dirección del eje largo (radianes, en XZ)
  color: number;
}

interface Car extends CarSpec {
  hp: number;
  shake: number;
  wheels: boolean[]; // delantera izq, del. dcha, trasera izq, tras. dcha
  hood: boolean;
  burnt: boolean;
  burnT: number; // segundos de fuego restantes
  tilt: THREE.Vector2; // inclinación por ruedas perdidas (x: cabeceo, y: alabeo)
}

const CAR_HP = 12;
const L = 1.5; // largo (unidades)
const W = 0.62; // ancho
const BURNT = new THREE.Color(0x2a2522);

// Piezas en el espacio del coche (eje largo = +X, frente en +X).
const PARTS = {
  body: { geo: new THREE.BoxGeometry(L, 0.3, W), pos: [0, 0.21, 0] },
  under: { geo: new THREE.BoxGeometry(L * 1.01, 0.09, W * 1.02), pos: [0, 0.09, 0] },
  cabin: { geo: new THREE.BoxGeometry(0.8, 0.26, W * 0.9), pos: [-0.05, 0.49, 0] },
  glass: { geo: new THREE.BoxGeometry(0.82, 0.16, W * 0.93), pos: [-0.05, 0.48, 0] },
  hood: { geo: new THREE.BoxGeometry(0.46, 0.03, W * 0.94), pos: [0.5, 0.375, 0] },
};
const wheelGeo = new THREE.CylinderGeometry(0.11, 0.11, 0.08, 12).rotateX(Math.PI / 2);
const WHEEL_POS: Array<[number, number, number]> = [
  [0.48, 0.11, W / 2],
  [0.48, 0.11, -W / 2],
  [-0.48, 0.11, W / 2],
  [-0.48, 0.11, -W / 2],
];

interface Debris {
  mesh: THREE.Mesh;
  v: THREE.Vector3;
  spin: THREE.Vector3;
  rest: boolean;
}
interface Fire {
  sprite: THREE.Sprite;
  base: THREE.Vector3;
  t: number;
  life: number;
  kind: "ball" | "flame" | "smoke";
  vy: number;
  size: number;
}

function radial(inner: string, outer: string): THREE.CanvasTexture {
  const S = 64;
  const c = document.createElement("canvas");
  c.width = c.height = S;
  const g = c.getContext("2d")!;
  const grd = g.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
  grd.addColorStop(0, inner);
  grd.addColorStop(1, outer);
  g.fillStyle = grd;
  g.fillRect(0, 0, S, S);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export interface CarManager {
  group: THREE.Group;
  setCars(specs: CarSpec[]): void;
  /** Bala de (x0,z0) a (x1,z1) (render): daña el primer coche que atraviesa. */
  hit(x0: number, z0: number, x1: number, z1: number): void;
  update(dt: number, time: number): void;
}

export function createCarManager(scene: THREE.Scene): CarManager {
  const group = new THREE.Group();
  scene.add(group);
  const MAX = 400;
  const paintMat = new THREE.MeshLambertMaterial({ color: 0xffffff });
  const darkMat = new THREE.MeshLambertMaterial({ color: 0x1a1a1a });
  const glassMat = new THREE.MeshLambertMaterial({ color: 0x26323f });
  const meshes: Record<string, THREE.InstancedMesh> = {};
  for (const [k, p] of Object.entries(PARTS)) {
    const mat = k === "under" ? darkMat : k === "glass" ? glassMat : paintMat;
    const im = new THREE.InstancedMesh(p.geo, mat, MAX);
    im.castShadow = true;
    im.receiveShadow = true;
    im.frustumCulled = false;
    im.count = 0;
    if (mat === paintMat) im.setColorAt(0, new THREE.Color(1, 1, 1));
    group.add(im);
    meshes[k] = im;
  }
  const wheels = new THREE.InstancedMesh(wheelGeo, darkMat, MAX * 4);
  wheels.castShadow = true;
  wheels.frustumCulled = false;
  wheels.count = 0;
  group.add(wheels);

  const state = new Map<string, Car>(); // daño por coche (persiste entre salas)
  let cars: Car[] = [];

  function setCars(specs: CarSpec[]): void {
    cars = specs.map((sp) => {
      let c = state.get(sp.key);
      if (!c) {
        c = { ...sp, hp: CAR_HP, shake: 0, wheels: [true, true, true, true], hood: true, burnt: false, burnT: 0, tilt: new THREE.Vector2() };
        state.set(sp.key, c);
      }
      c.x = sp.x;
      c.z = sp.z;
      return c;
    });
  }

  // ---- restos y fuego ----
  const debris: Debris[] = [];
  const fires: Fire[] = [];
  const fireTex = radial("rgba(255,230,160,1)", "rgba(255,90,10,0)");
  const smokeTex = radial("rgba(60,58,55,0.8)", "rgba(60,58,55,0)");
  const light = new THREE.PointLight(0xff8a30, 0, 10, 1.6);
  scene.add(light);
  let lightT = 0;

  function spawnDebris(geo: THREE.BufferGeometry, mat: THREE.Material, pos: THREE.Vector3, rot: number, v: THREE.Vector3): void {
    const m = new THREE.Mesh(geo, mat);
    m.position.copy(pos);
    m.rotation.y = rot;
    m.castShadow = true;
    scene.add(m);
    debris.push({ mesh: m, v, spin: new THREE.Vector3((Math.random() - 0.5) * 12, (Math.random() - 0.5) * 6, (Math.random() - 0.5) * 12), rest: false });
    if (debris.length > 120) {
      const old = debris.shift()!;
      scene.remove(old.mesh);
    }
  }
  function spawnFire(kind: Fire["kind"], p: THREE.Vector3, life: number, size: number, vy: number): void {
    const mat = new THREE.SpriteMaterial({ map: kind === "smoke" ? smokeTex : fireTex, transparent: true, depthWrite: false, blending: kind === "smoke" ? THREE.NormalBlending : THREE.AdditiveBlending, fog: false });
    const s = new THREE.Sprite(mat);
    s.position.copy(p);
    s.scale.setScalar(size * 0.3);
    scene.add(s);
    fires.push({ sprite: s, base: p.clone(), t: 0, life, kind, vy, size });
  }

  const tmpM = new THREE.Matrix4();
  const tmpQ = new THREE.Quaternion();
  const tmpV = new THREE.Vector3();
  const tmpS = new THREE.Vector3(1, 1, 1);
  const carM = new THREE.Matrix4();
  const partM = new THREE.Matrix4();

  function worldOf(c: Car, local: [number, number, number]): THREE.Vector3 {
    const cs = Math.cos(c.ang);
    const sn = Math.sin(c.ang);
    return new THREE.Vector3(c.x + local[0] * cs - local[2] * sn, local[1] + 0.05, c.z + local[0] * sn + local[2] * cs);
  }

  function explode(c: Car): void {
    c.burnt = true;
    c.burnT = 14;
    lightT = 0.45;
    light.position.set(c.x, 0.8, c.z);
    for (let i = 0; i < 4; i++) if (c.wheels[i]) {
      c.wheels[i] = false;
      spawnDebris(wheelGeo, darkMat, worldOf(c, WHEEL_POS[i]), c.ang, new THREE.Vector3((Math.random() - 0.5) * 5, 3 + Math.random() * 3, (Math.random() - 0.5) * 5));
    }
    if (c.hood) {
      c.hood = false;
      spawnDebris(PARTS.hood.geo, new THREE.MeshLambertMaterial({ color: 0x2a2522 }), worldOf(c, [0.5, 0.4, 0]), c.ang, new THREE.Vector3((Math.random() - 0.5) * 3, 7, (Math.random() - 0.5) * 3));
    }
    for (let i = 0; i < 6; i++) {
      const p = new THREE.Vector3(c.x + (Math.random() - 0.5) * 0.6, 0.4 + Math.random() * 0.4, c.z + (Math.random() - 0.5) * 0.6);
      spawnFire("ball", p, 0.5 + Math.random() * 0.3, 2.4 + Math.random() * 1.4, 1.5);
    }
    c.tilt.set(0, 0);
  }

  function damage(c: Car): void {
    if (c.burnt) {
      c.shake = Math.min(1, c.shake + 0.3);
      return;
    }
    c.hp -= 1;
    c.shake = 1;
    if (c.hp === 8 || c.hp === 5) {
      // pierde una rueda al azar (de las que le quedan)
      const left = c.wheels.map((w, i) => (w ? i : -1)).filter((i) => i >= 0);
      const i = left[Math.floor(Math.random() * left.length)];
      if (i !== undefined) {
        c.wheels[i] = false;
        const side = WHEEL_POS[i][2] > 0 ? 1 : -1;
        const cs = Math.cos(c.ang);
        const sn = Math.sin(c.ang);
        // sale rodando hacia fuera del coche
        spawnDebris(wheelGeo, darkMat, worldOf(c, WHEEL_POS[i]), c.ang, new THREE.Vector3(-sn * side * 2.2, 1.2, cs * side * 2.2));
        c.tilt.x += WHEEL_POS[i][0] > 0 ? -0.08 : 0.08;
        c.tilt.y += side * 0.1;
      }
    }
    if (c.hp === 3 && c.hood) {
      c.hood = false;
      const hoodMat = new THREE.MeshLambertMaterial({ color: c.color });
      spawnDebris(PARTS.hood.geo, hoodMat, worldOf(c, [0.5, 0.4, 0]), c.ang, new THREE.Vector3((Math.random() - 0.5) * 1.5, 5.5, (Math.random() - 0.5) * 1.5));
      spawnFire("smoke", worldOf(c, [0.5, 0.45, 0]), 2.5, 0.8, 0.5);
    }
    if (c.hp <= 0) explode(c);
  }

  function hit(x0: number, z0: number, x1: number, z1: number): void {
    const dx = x1 - x0;
    const dz = z1 - z0;
    const len = Math.hypot(dx, dz);
    if (len < 1e-4) return;
    const ux = dx / len;
    const uz = dz / len;
    let best: Car | null = null;
    let bestT = len + 0.3;
    for (const c of cars) {
      // intersección rayo–rectángulo orientado del coche (en su espacio local)
      const cs = Math.cos(-c.ang);
      const sn = Math.sin(-c.ang);
      const ox = (x0 - c.x) * cs - (z0 - c.z) * sn;
      const oz = (x0 - c.x) * sn + (z0 - c.z) * cs;
      const lx = ux * cs - uz * sn;
      const lz = ux * sn + uz * cs;
      let tmin = 0;
      let tmax = bestT;
      for (const [o, d, h] of [
        [ox, lx, L / 2 + 0.05],
        [oz, lz, W / 2 + 0.05],
      ]) {
        if (Math.abs(d) < 1e-6) {
          if (Math.abs(o) > h) tmax = -1;
        } else {
          let t1 = (-h - o) / d;
          let t2 = (h - o) / d;
          if (t1 > t2) [t1, t2] = [t2, t1];
          tmin = Math.max(tmin, t1);
          tmax = Math.min(tmax, t2);
        }
      }
      if (tmax >= tmin && tmin < bestT) {
        bestT = tmin;
        best = c;
      }
    }
    if (best) damage(best);
  }

  function update(dt: number, time: number): void {
    const colorTmp = new THREE.Color();
    let n = 0;
    let nw = 0;
    for (const c of cars) {
      if (n >= MAX) break;
      c.shake = Math.max(0, c.shake - dt * 4);
      const jig = c.shake * 0.06;
      const sx = Math.sin(time * 60 + c.x) * jig;
      const sz = Math.cos(time * 53 + c.z) * jig;
      // raíz del coche: posición, rumbo, inclinación (ruedas perdidas) y sacudida
      tmpQ.setFromEuler(new THREE.Euler(0, -c.ang, 0)).multiply(new THREE.Quaternion().setFromEuler(new THREE.Euler(c.tilt.y + sz * 0.8, 0, c.tilt.x + sx * 0.8)));
      const lost = c.wheels.filter((w) => !w).length;
      tmpV.set(c.x + sx * 0.2, 0.05 - lost * 0.025 - (c.burnt ? 0.07 : 0), c.z + sz * 0.2);
      carM.compose(tmpV, tmpQ, tmpS);
      colorTmp.setHex(c.burnt ? BURNT.getHex() : c.color);
      for (const [k, p] of Object.entries(PARTS)) {
        if (k === "hood" && !c.hood) {
          // sin capó: se ve el motor (una caja oscura en su sitio)
          partM.makeTranslation(p.pos[0], p.pos[1] - 0.02, p.pos[2]);
          meshes.hood.setMatrixAt(n, tmpM.multiplyMatrices(carM, partM));
          meshes.hood.setColorAt(n, colorTmp.clone().setHex(0x1c1c1c));
          continue;
        }
        partM.makeTranslation(p.pos[0], p.pos[1], p.pos[2]);
        meshes[k].setMatrixAt(n, tmpM.multiplyMatrices(carM, partM));
        if (k !== "under" && k !== "glass") meshes[k].setColorAt(n, colorTmp);
      }
      c.wheels.forEach((w, i) => {
        if (!w) return;
        partM.makeTranslation(...WHEEL_POS[i]);
        wheels.setMatrixAt(nw++, tmpM.multiplyMatrices(carM, partM));
      });
      n++;
      // fuego del coche calcinado
      if (c.burnT > 0) {
        c.burnT -= dt;
        if (Math.random() < dt * 14) spawnFire("flame", new THREE.Vector3(c.x + (Math.random() - 0.5) * 0.9, 0.45, c.z + (Math.random() - 0.5) * 0.5), 0.5 + Math.random() * 0.4, 0.9 + Math.random() * 0.5, 1.4);
        if (Math.random() < dt * 5) spawnFire("smoke", new THREE.Vector3(c.x, 0.8, c.z), 3 + Math.random() * 2, 1.4 + Math.random(), 0.9);
      }
    }
    for (const im of Object.values(meshes)) {
      im.count = n;
      im.instanceMatrix.needsUpdate = true;
      if (im.instanceColor) im.instanceColor.needsUpdate = true;
    }
    wheels.count = nw;
    wheels.instanceMatrix.needsUpdate = true;

    // restos con gravedad, rebote y rozamiento
    for (const d of debris) {
      if (d.rest) continue;
      d.v.y -= 14 * dt;
      d.mesh.position.addScaledVector(d.v, dt);
      d.mesh.rotation.x += d.spin.x * dt;
      d.mesh.rotation.y += d.spin.y * dt;
      d.mesh.rotation.z += d.spin.z * dt;
      if (d.mesh.position.y < 0.1) {
        d.mesh.position.y = 0.1;
        d.v.y = Math.abs(d.v.y) * 0.35;
        d.v.x *= 0.7;
        d.v.z *= 0.7;
        d.spin.multiplyScalar(0.6);
        if (Math.hypot(d.v.x, d.v.y, d.v.z) < 0.4) d.rest = true;
      }
    }
    // fuego y humo
    for (let i = fires.length - 1; i >= 0; i--) {
      const f = fires[i];
      f.t += dt;
      const t = f.t / f.life;
      if (t >= 1) {
        scene.remove(f.sprite);
        f.sprite.material.dispose();
        fires.splice(i, 1);
        continue;
      }
      f.sprite.position.y = f.base.y + f.vy * f.t;
      const grow = f.kind === "ball" ? 0.4 + t * 1.2 : f.kind === "smoke" ? 0.5 + t * 1.8 : 0.8 - t * 0.5;
      f.sprite.scale.setScalar(f.size * grow);
      f.sprite.material.opacity = f.kind === "smoke" ? 0.55 * Math.min(1, t * 5) * (1 - t) : 1 - t;
    }
    lightT = Math.max(0, lightT - dt);
    light.intensity = lightT > 0 ? 120 * (lightT / 0.45) ** 2 : 0;
  }

  return { group, setCars, hit, update };
}
