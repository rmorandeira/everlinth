// Daño y derrumbe de edificios de la ciudad. La geometría de la ciudad no se guarda
// (se regenera, determinista), pero el daño de cada edificio sí: tabla building_damage
// por id de edificio. Las balas que dan en un edificio le quitan vida; a cero se
// derrumba: sus casillas pasan a ser transitables (escombro) y queda así para siempre.
import { db } from "./db.js";
import type { CityBuilding } from "@roi/shared";

db.exec(`
  CREATE TABLE IF NOT EXISTS building_damage (
    id TEXT PRIMARY KEY,
    hp REAL NOT NULL,
    max_hp REAL NOT NULL
  )
`);

const upsertStmt = db.prepare("INSERT INTO building_damage (id, hp, max_hp) VALUES (?, ?, ?) ON CONFLICT(id) DO UPDATE SET hp = excluded.hp, max_hp = excluded.max_hp");
const damage = new Map<string, { hp: number; maxHp: number }>();
for (const row of db.prepare("SELECT id, hp, max_hp FROM building_damage").all() as Array<{ id: string; hp: number; max_hp: number }>) {
  damage.set(row.id, { hp: row.hp, maxHp: row.max_hp });
}

/** Vida de un edificio intacto: balas que aguanta (una ráfaga continua son ~22 por segundo). */
export function buildingMaxHp(floors: number): number {
  return 60 + floors * 12;
}

export function buildingDamage(id: string): { hp: number; maxHp: number } | undefined {
  return damage.get(id);
}

/** Anota el daño guardado en los edificios de una ciudad (se manda así al cliente). */
export function annotateBuildings(buildings: CityBuilding[]): void {
  for (const b of buildings) {
    const d = damage.get(b.id);
    if (d) {
      b.hp = d.hp;
      b.maxHp = d.maxHp;
    }
  }
}

/** Quita vida a un edificio. Devuelve su nuevo estado (y si acaba de derrumbarse). */
export function damageBuilding(b: CityBuilding, amount: number): { hp: number; maxHp: number; collapsed: boolean; changedStage: boolean } {
  const d = damage.get(b.id) ?? { hp: buildingMaxHp(b.floors), maxHp: buildingMaxHp(b.floors) };
  if (d.hp <= 0) return { ...d, collapsed: false, changedStage: false };
  const stage = (hp: number): number => Math.ceil((hp / d.maxHp) * 10);
  const before = stage(d.hp);
  d.hp = Math.max(0, d.hp - amount);
  damage.set(b.id, d);
  const changedStage = stage(d.hp) !== before;
  // se guarda al cambiar de escalón (no en cada bala)
  if (changedStage || d.hp <= 0) upsertStmt.run(b.id, d.hp, d.maxHp);
  return { ...d, collapsed: d.hp <= 0, changedStage };
}

/** ¿Está el punto (tiles globales) dentro del polígono? */
export function pointInPolygon(x: number, y: number, pts: Array<[number, number]>): boolean {
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const [xi, yi] = pts[i];
    const [xj, yj] = pts[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/** Distancia del punto al borde del polígono (0 si está dentro). */
export function distanceToPolygon(x: number, y: number, pts: Array<[number, number]>): number {
  if (pointInPolygon(x, y, pts)) return 0;
  let best = Infinity;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const [ax, ay] = pts[j];
    const [bx, by] = pts[i];
    const vx = bx - ax;
    const vy = by - ay;
    const l2 = vx * vx + vy * vy;
    const t = l2 > 0 ? Math.max(0, Math.min(1, ((x - ax) * vx + (y - ay) * vy) / l2)) : 0;
    best = Math.min(best, Math.hypot(x - (ax + t * vx), y - (ay + t * vy)));
  }
  return best;
}
