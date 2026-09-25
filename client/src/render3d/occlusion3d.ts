// Transparencia de edificios que tapan al jugador: desde el jugador se lanza un
// rayo hacia la cámara (la cámara es ortográfica y fija, así que la dirección es
// siempre la misma); todo edificio cuya caja atraviesa ese rayo se vuelve
// translúcido con una transición suave, y recupera su material original (el
// compartido y opaco) cuando deja de tapar.
import * as THREE from "three";

const GHOST_OPACITY = 0.06;
const FADE_RATE = 9;

interface Entry {
  object: THREE.Object3D;
  box: THREE.Box3;
  fade: number; // 1 = opaco
  ghosted: boolean;
  originals: Map<THREE.Mesh, THREE.Material | THREE.Material[]>;
  clones: Map<THREE.Material, THREE.Material>;
}

export interface Occlusion3D {
  register(object: THREE.Object3D): void;
  clear(): void;
  /** Depuración: registrados / translúcidos. */
  debug(): { total: number; ghosted: number };
  /**
   * Puntos del suelo que deben verse (en unidades de render: el jugador y la línea
   * hacia donde apunta), cada uno con su holgura lateral; towardCamera: dirección
   * unitaria hacia la cámara (ortográfica: la misma para todos los puntos).
   */
  update(points: Array<{ p: THREE.Vector3; margin: number }>, towardCamera: THREE.Vector3, dt: number): void;
}

export function createOcclusion3D(): Occlusion3D {
  let entries: Entry[] = [];
  const ray = new THREE.Ray();
  const hit = new THREE.Vector3();
  const expanded = new THREE.Box3();

  function ghostify(e: Entry): void {
    e.object.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh) return;
      e.originals.set(mesh, mesh.material);
      const swap = (m: THREE.Material): THREE.Material => {
        let c = e.clones.get(m);
        if (!c) {
          c = m.clone();
          c.transparent = true;
          c.depthWrite = false;
          e.clones.set(m, c);
        }
        return c;
      };
      mesh.material = Array.isArray(mesh.material) ? mesh.material.map(swap) : swap(mesh.material);
    });
    e.ghosted = true;
  }

  function restore(e: Entry): void {
    for (const [mesh, mat] of e.originals) mesh.material = mat;
    for (const c of e.clones.values()) c.dispose();
    e.originals.clear();
    e.clones.clear();
    e.ghosted = false;
  }

  function register(object: THREE.Object3D): void {
    object.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(object);
    entries.push({ object, box, fade: 1, ghosted: false, originals: new Map(), clones: new Map() });
  }

  function clear(): void {
    for (const e of entries) if (e.ghosted) restore(e);
    entries = [];
  }

  function update(points: Array<{ p: THREE.Vector3; margin: number }>, towardCamera: THREE.Vector3, dt: number): void {
    ray.direction.copy(towardCamera);
    const blocksAny = (e: Entry): boolean => {
      for (const pt of points) {
        // El rayo sale a la altura del pecho, no del suelo.
        ray.origin.copy(pt.p);
        ray.origin.y += 0.3;
        expanded.copy(e.box).expandByScalar(pt.margin);
        if (ray.intersectBox(expanded, hit) !== null) return true;
      }
      return false;
    };
    const k = 1 - Math.exp(-FADE_RATE * dt);
    for (const e of entries) {
      const blocks = blocksAny(e);
      const target = blocks ? GHOST_OPACITY : 1;
      if (e.fade === 1 && target === 1) continue;
      e.fade += (target - e.fade) * k;
      if (Math.abs(e.fade - target) < 0.01) e.fade = target;
      if (e.fade < 1 && !e.ghosted) ghostify(e);
      if (e.ghosted) {
        for (const c of e.clones.values()) c.opacity = e.fade;
        if (e.fade === 1) restore(e);
      }
    }
  }

  function debug(): { total: number; ghosted: number } {
    return { total: entries.length, ghosted: entries.filter((e) => e.ghosted).length };
  }

  return { register, clear, update, debug };
}
