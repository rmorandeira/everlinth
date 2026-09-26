// Convierte un extracto de OpenStreetMap (JSON de Overpass con "out tags geom") en los
// datos compactos de la ciudad del juego: calles (tipo, sentido único, puentes con su
// nivel), edificios (planta real y plantas), costa, parques, playas, agua y espigones.
// Coordenadas en tiles del juego (1 tile = 1,5 m; y hacia el sur), con el punto de
// referencia (por defecto la plaza de María Pita, A Coruña) en el centro de la sala (0,0).
//
//   node tools/osm/build-city.mjs <overpass.json> [salida.json.gz] [lat] [lon]
//
// Datos © colaboradores de OpenStreetMap, licencia ODbL (ver server/data/osm/LICENCIA.md).
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { gzipSync } from "node:zlib";
import path from "node:path";

const [, , input, outArg, latArg, lonArg] = process.argv;
if (!input) {
  console.error("uso: node tools/osm/build-city.mjs <overpass.json> [salida.json.gz] [lat] [lon]");
  process.exit(1);
}
const out = outArg || "server/data/osm/acoruna.json.gz";
const LAT0 = latArg ? Number(latArg) : 43.37092; // plaza de María Pita
const LON0 = lonArg ? Number(lonArg) : -8.39588;
const TILE_M = 1.5;
const OX = 24; // el punto de referencia cae en el centro de la sala (0,0) (48 × 27 tiles)
const OY = 13.5;
const kx = (Math.cos((LAT0 * Math.PI) / 180) * 111320) / TILE_M;
const ky = 110574 / TILE_M;
const proj = (p) => [Math.round(((p.lon - LON0) * kx + OX) * 10) / 10, Math.round((-(p.lat - LAT0) * ky + OY) * 10) / 10];

const raw = JSON.parse(readFileSync(input, "utf8"));

// Douglas-Peucker (tiles)
function simplify(pts, tol) {
  if (pts.length <= 2) return pts;
  const keep = new Uint8Array(pts.length);
  keep[0] = keep[pts.length - 1] = 1;
  const stack = [[0, pts.length - 1]];
  while (stack.length) {
    const [a, b] = stack.pop();
    const [ax, ay] = pts[a];
    const [bx, by] = pts[b];
    const dx = bx - ax;
    const dy = by - ay;
    const l = Math.hypot(dx, dy) || 1;
    let best = -1;
    let bd = tol;
    for (let i = a + 1; i < b; i++) {
      const d = Math.abs((pts[i][0] - ax) * dy - (pts[i][1] - ay) * dx) / l;
      if (d > bd) {
        bd = d;
        best = i;
      }
    }
    if (best >= 0) {
      keep[best] = 1;
      stack.push([a, best], [best, b]);
    }
  }
  return pts.filter((_, i) => keep[i]);
}
function area(pts) {
  let s = 0;
  for (let i = 0; i < pts.length; i++) {
    const q = pts[(i + 1) % pts.length];
    s += pts[i][0] * q[1] - q[0] * pts[i][1];
  }
  return Math.abs(s) / 2;
}
const flat = (pts) => pts.flat();

// tipo de calle → clase del juego: 2 avenida, 1 principal, 0 menor
const ROAD_KIND = {
  motorway: 2, trunk: 2, primary: 2, motorway_link: 1, trunk_link: 1, primary_link: 1,
  secondary: 1, secondary_link: 1, tertiary: 1, tertiary_link: 0,
  residential: 0, unclassified: 0, living_street: 0, service: 0, road: 0,
};
const DEFAULT_FLOORS = {
  house: 2, detached: 2, semidetached_house: 2, terrace: 3, bungalow: 1, farm: 2,
  apartments: 7, residential: 6, hotel: 8, dormitory: 5,
  commercial: 4, retail: 3, office: 7, supermarket: 1, kiosk: 1,
  industrial: 2, warehouse: 2, garage: 1, garages: 1, shed: 1, hut: 1, parking: 4,
  church: 4, cathedral: 6, chapel: 2, school: 3, university: 4, hospital: 7, public: 4, civic: 4, government: 5,
  sports_hall: 2, stadium: 4, grandstand: 2, transportation: 2, train_station: 3, lighthouse: 16,
};

// zonas verdes de verdad (no parques infantiles pavimentados, roca, franja intermareal…)
const GREEN = new Set(["grass", "garden", "scrub", "pitch", "forest", "wood", "park", "meadow", "greenfield", "grassland", "cemetery", "dog_park", "heath", "village_green", "recreation_ground"]);
const roads = [];
const buildings = [];
const coast = [];
const green = [];
const sand = [];
const water = [];
const piers = [];
let skipped = 0;
for (const el of raw.elements) {
  if (el.type !== "way" || !el.geometry) continue;
  const t = el.tags || {};
  const pts = el.geometry.filter(Boolean).map(proj);
  if (pts.length < 2) continue;
  if (t.highway) {
    let kind = ROAD_KIND[t.highway];
    if (kind === undefined) continue; // peatonales, caminos, escaleras: la acera ya lo cubre
    if (t.highway === "service" && !t.name) continue; // accesos y aparcamientos sin nombre
    if (t.tunnel === "yes" || t.tunnel === "building_passage" || Number(t.layer) < 0) continue;
    if (t.area === "yes") continue;
    const ow = t.oneway === "yes" || t.oneway === "1" || t.junction === "roundabout" ? 1 : t.oneway === "-1" ? -1 : 0;
    const bridge = t.bridge && t.bridge !== "no" ? Math.max(1, Number(t.layer) || 1) : 0;
    roads.push([el.id, kind, ow, bridge, flat(simplify(pts, 0.3))]);
  } else if (t.building && t.building !== "no" && t.building !== "roof" && t.building !== "construction") {
    if (pts.length < 4) continue;
    let poly = simplify(pts.slice(0, -1), 0.25);
    if (poly.length < 3 || area(poly) < 8) {
      skipped++;
      continue;
    }
    let floors = Number(t["building:levels"]);
    if (!floors && t.height) floors = Math.round(parseFloat(t.height) / 3);
    if (!floors) floors = DEFAULT_FLOORS[t.building] ?? 5;
    floors = Math.max(1, Math.min(40, Math.round(floors)));
    const name = t["name:es"] || t.name || "";
    buildings.push(name ? [el.id, floors, t.building, flat(poly), name] : [el.id, floors, t.building, flat(poly)]);
  } else if (t.natural === "coastline") {
    coast.push(flat(simplify(pts, 0.5)));
  } else if (t.man_made === "pier" || t.man_made === "breakwater") {
    piers.push(flat(simplify(pts, 0.4)));
  } else if (t.natural === "beach" || t.natural === "sand") {
    if (pts.length >= 4) sand.push(flat(simplify(pts.slice(0, -1), 0.5)));
  } else if (t.natural === "water") {
    if (pts.length >= 4) water.push(flat(simplify(pts.slice(0, -1), 0.5)));
  } else if (GREEN.has(t.leisure) || GREEN.has(t.landuse) || GREEN.has(t.natural)) {
    if (pts.length >= 4) green.push(flat(simplify(pts.slice(0, -1), 0.5)));
  }
}
let minx = Infinity, miny = Infinity, maxx = -Infinity, maxy = -Infinity;
for (const b of buildings) for (let i = 0; i < b[3].length; i += 2) {
  minx = Math.min(minx, b[3][i]); maxx = Math.max(maxx, b[3][i]);
  miny = Math.min(miny, b[3][i + 1]); maxy = Math.max(maxy, b[3][i + 1]);
}
// Hitos modelados a mano (su planta no viene como vía simple en el extracto):
// posición real, tamaño exterior (m) y orientación del eje largo (grados desde el norte).
const LANDMARKS = [{ kind: "stadium", name: "Estadio de Riazor", lat: 43.36866, lon: -8.41741, len: 190, wid: 150, ang: 14 }];
const landmarks = LANDMARKS.map((l) => { const [x, y] = proj(l); return { kind: l.kind, name: l.name, x, y, len: l.len / TILE_M, wid: l.wid / TILE_M, ang: (l.ang * Math.PI) / 180 }; });
const data = {
  source: "© colaboradores de OpenStreetMap (ODbL)",
  origin: { lat: LAT0, lon: LON0 },
  bbox: [minx, miny, maxx, maxy],
  roads, buildings, coast, green, sand, water, piers, landmarks,
};
mkdirSync(path.dirname(out), { recursive: true });
const json = JSON.stringify(data);
writeFileSync(out, gzipSync(json, { level: 9 }));
console.log(`calles ${roads.length} · edificios ${buildings.length} (descartados ${skipped}) · costa ${coast.length} · verde ${green.length} · arena ${sand.length} · agua ${water.length} · espigones ${piers.length}`);
console.log(`extensión: x ${minx}..${maxx}, y ${miny}..${maxy} tiles (${((maxx - minx) * 1.5 / 1000).toFixed(1)} × ${((maxy - miny) * 1.5 / 1000).toFixed(1)} km) · ${(json.length / 1e6).toFixed(1)} MB → ${out}`);
