// Volumetría real del Catastro (Dirección General del Catastro, INSPIRE Buildings,
// licencia CC BY 4.0) para la ciudad OSM: cada "parte de edificio" catastral (planta con
// su número de plantas sobre rasante) sustituye a los edificios de OpenStreetMap dentro
// del municipio. Así los volúmenes escalonan como los reales (bajos, áticos, torres).
//   node tools/osm/build-catastro.mjs [ciudad.json.gz] [municipio]
// Descarga (una vez) el ZIP del servicio ATOM del Catastro a tools/osm/.catastro/.
// Se conservan de OSM: los edificios fuera del municipio (sin datos catastrales), y los
// nombres y los hitos con modelo propio (Palacio de los Deportes…).
import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync } from "node:fs";
import { gunzipSync, gzipSync } from "node:zlib";
import { execFileSync } from "node:child_process";
import path from "node:path";

const cityFile = process.argv[2] || "server/data/osm/acoruna.json.gz";
const muni = process.argv[3] || "15900";
const DIR = path.join("tools", "osm", ".catastro");
const ZIP = path.join(DIR, `A.ES.SDGC.BU.${muni}.zip`);
const URL = `https://www.catastro.hacienda.gob.es/INSPIRE/Buildings/15/${muni}-A%20CORU%D1A/A.ES.SDGC.BU.${muni}.zip`;
const TILE_M = 1.5;
const OX = 24;
const OY = 13.5;

mkdirSync(DIR, { recursive: true });
if (!existsSync(ZIP)) {
  console.log("descargando", URL);
  const r = await fetch(URL, { headers: { "User-Agent": "everlinth-catastro/1.0" } });
  if (!r.ok) throw new Error(`${URL}: ${r.status}`);
  writeFileSync(ZIP, Buffer.from(await r.arrayBuffer()));
}
const partsGml = path.join(DIR, `A.ES.SDGC.BU.${muni}.buildingpart.gml`);
const bldGml = path.join(DIR, `A.ES.SDGC.BU.${muni}.building.gml`);
if (!existsSync(partsGml)) execFileSync("unzip", ["-o", "-q", ZIP, "-d", DIR]);

const city = JSON.parse(gunzipSync(readFileSync(cityFile)).toString("utf8"));
const LAT0 = city.origin.lat;
const LON0 = city.origin.lon;
const kx = (Math.cos((LAT0 * Math.PI) / 180) * 111320) / TILE_M;
const ky = 110574 / TILE_M;

// UTM (ETRS89 ≈ WGS84), huso 29 norte → latitud/longitud
function utmToLatLon(E, N, zone = 29) {
  const a = 6378137;
  const f = 1 / 298.257222101;
  const k0 = 0.9996;
  const e2 = f * (2 - f);
  const ep2 = e2 / (1 - e2);
  const x = E - 500000;
  const M = N / k0;
  const mu = M / (a * (1 - e2 / 4 - (3 * e2 * e2) / 64 - (5 * e2 ** 3) / 256));
  const e1 = (1 - Math.sqrt(1 - e2)) / (1 + Math.sqrt(1 - e2));
  const phi1 = mu + ((3 * e1) / 2 - (27 * e1 ** 3) / 32) * Math.sin(2 * mu) + ((21 * e1 * e1) / 16 - (55 * e1 ** 4) / 32) * Math.sin(4 * mu) + ((151 * e1 ** 3) / 96) * Math.sin(6 * mu) + ((1097 * e1 ** 4) / 512) * Math.sin(8 * mu);
  const C1 = ep2 * Math.cos(phi1) ** 2;
  const T1 = Math.tan(phi1) ** 2;
  const N1 = a / Math.sqrt(1 - e2 * Math.sin(phi1) ** 2);
  const R1 = (a * (1 - e2)) / (1 - e2 * Math.sin(phi1) ** 2) ** 1.5;
  const D = x / (N1 * k0);
  const lat = phi1 - ((N1 * Math.tan(phi1)) / R1) * ((D * D) / 2 - ((5 + 3 * T1 + 10 * C1 - 4 * C1 * C1 - 9 * ep2) * D ** 4) / 24 + ((61 + 90 * T1 + 298 * C1 + 45 * T1 * T1 - 252 * ep2 - 3 * C1 * C1) * D ** 6) / 720);
  const lon = (D - ((1 + 2 * T1 + C1) * D ** 3) / 6 + ((5 - 2 * C1 + 28 * T1 - 3 * C1 * C1 + 8 * ep2 + 24 * T1 * T1) * D ** 5) / 120) / Math.cos(phi1);
  return { lat: (lat * 180) / Math.PI, lon: ((zone - 1) * 6 - 180 + 3) + (lon * 180) / Math.PI };
}
const proj = (E, N) => {
  const p = utmToLatLon(E, N);
  return [Math.round(((p.lon - LON0) * kx + OX) * 10) / 10, Math.round((-(p.lat - LAT0) * ky + OY) * 10) / 10];
};

// Douglas-Peucker (tiles), como build-city
function simplify(pts, tol) {
  if (pts.length <= 3) return pts;
  const keep = new Uint8Array(pts.length);
  keep[0] = keep[pts.length - 1] = 1;
  const stack = [[0, pts.length - 1]];
  while (stack.length) {
    const [a, b] = stack.pop();
    const [ax, ay] = pts[a];
    const [bx, by] = pts[b];
    const l = Math.hypot(bx - ax, by - ay) || 1;
    let best = -1;
    let bd = tol;
    for (let i = a + 1; i < b; i++) {
      const d = Math.abs((pts[i][0] - ax) * (by - ay) - (pts[i][1] - ay) * (bx - ax)) / l;
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
function inPoly(x, y, p) {
  let inside = false;
  for (let i = 0, j = p.length - 1; i < p.length; j = i++) {
    const [xi, yi] = p[i];
    const [xj, yj] = p[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}
function centroid(p) {
  let x = 0;
  let y = 0;
  for (const q of p) {
    x += q[0];
    y += q[1];
  }
  return [x / p.length, y / p.length];
}

// uso de cada edificio (referencia catastral) → tipo del juego
const useOf = new Map();
{
  const s = readFileSync(bldGml, "utf8");
  const re = /<base:localId>([^<]+)<\/base:localId>[\s\S]*?<bu-ext2d:currentUse>([^<]+)</g;
  let m;
  while ((m = re.exec(s))) useOf.set(m[1], m[2]);
}
const TYPE = { "1_residential": "residential", "2_agriculture": "farm", "3_industrial": "industrial", "4_1_office": "office", "4_2_retail": "retail", "4_3_publicServices": "public" };

// partes de edificio
const parts = [];
{
  const s = readFileSync(partsGml, "utf8");
  let i = 0;
  let skipped = 0;
  for (;;) {
    const a = s.indexOf("<bu-ext2d:BuildingPart ", i);
    if (a < 0) break;
    const b = s.indexOf("</bu-ext2d:BuildingPart>", a);
    const blk = s.slice(a, b);
    i = b;
    const id = /<base:localId>([^<]+)</.exec(blk)?.[1];
    const floors = Number(/<bu-ext2d:numberOfFloorsAboveGround>(\d+)</.exec(blk)?.[1] ?? 0);
    const ext = /<gml:exterior>[\s\S]*?<gml:posList[^>]*>([^<]+)</.exec(blk)?.[1];
    if (!id || !ext || floors <= 0) {
      skipped++;
      continue; // patios, sótanos y plantas bajo rasante: nada que levantar
    }
    const nums = ext.trim().split(/\s+/).map(Number);
    let pts = [];
    for (let k = 0; k + 1 < nums.length; k += 2) pts.push(proj(nums[k], nums[k + 1]));
    pts = simplify(pts.slice(0, -1), 0.12);
    if (pts.length < 3 || area(pts) < 2) {
      skipped++;
      continue;
    }
    const ref = id.split("_part")[0];
    const use = useOf.get(ref) ?? "1_residential";
    let t = TYPE[use] ?? "yes";
    if (t === "residential" && floors <= 2) t = "house";
    else if (t === "residential" && floors >= 3) t = "apartments";
    parts.push({ id, ref, floors: Math.min(40, floors), t, pts, c: centroid(pts) });
  }
  console.log(`catastro: ${parts.length} partes de edificio (${skipped} descartadas: patios, bajo rasante o diminutas)`);
}

// rejilla para buscar partes por posición
const CELL = 24;
const grid = new Map();
const key = (x, y) => `${Math.floor(x / CELL)},${Math.floor(y / CELL)}`;
let bx0 = Infinity, by0 = Infinity, bx1 = -Infinity, by1 = -Infinity;
parts.forEach((p, i) => {
  const k = key(p.c[0], p.c[1]);
  if (!grid.has(k)) grid.set(k, []);
  grid.get(k).push(i);
  for (const [x, y] of p.pts) {
    bx0 = Math.min(bx0, x); bx1 = Math.max(bx1, x); by0 = Math.min(by0, y); by1 = Math.max(by1, y);
  }
});
const near = (x, y, r) => {
  const out = [];
  for (let cy = Math.floor((y - r) / CELL); cy <= Math.floor((y + r) / CELL); cy++)
    for (let cx = Math.floor((x - r) / CELL); cx <= Math.floor((x + r) / CELL); cx++) out.push(...(grid.get(`${cx},${cy}`) ?? []));
  return out;
};

// edificios OSM: fuera del municipio se quedan; dentro, se quedan solo los hitos con
// modelo propio (y se quitan las partes catastrales que caen en ellos); los nombres
// pasan a la parte catastral que contiene el centro del edificio OSM
const KEEP_OSM = /palacio de los deportes|pazo dos deportes/i;
// alturas de monumentos que el Catastro no cuenta en plantas (plantas de 3 m)
const HEIGHT_OVERRIDE = { "Torre de Hércules": 18 };
const drop = new Set();
const names = new Map();
const out = [];
let kept = 0;
for (const b of city.buildings) {
  const flat = b[3];
  const pts = [];
  for (let k = 0; k + 1 < flat.length; k += 2) pts.push([flat[k], flat[k + 1]]);
  const [cx, cy] = centroid(pts);
  const name = b[4];
  const cands = near(cx, cy, 30);
  const covered = cands.some((i) => inPoly(cx, cy, parts[i].pts) || inPoly(parts[i].c[0], parts[i].c[1], pts));
  if (name && KEEP_OSM.test(name)) {
    for (const i of cands) if (inPoly(parts[i].c[0], parts[i].c[1], pts)) drop.add(i);
    out.push(b);
    kept++;
    continue;
  }
  if (!covered) {
    out.push(b); // fuera del municipio o sin dato catastral
    kept++;
    continue;
  }
  if (name) {
    const hit = cands.find((i) => inPoly(cx, cy, parts[i].pts));
    if (hit !== undefined) {
      names.set(hit, name);
      if (HEIGHT_OVERRIDE[name]) parts[hit].floors = HEIGHT_OVERRIDE[name];
    }
  }
}
parts.forEach((p, i) => {
  if (drop.has(i)) return;
  const flat = p.pts.flat();
  // [id, plantas, tipo, planta, nombre, grupo (edificio catastral: estilo común)]
  out.push([`c${p.id}`, p.floors, p.t, flat, names.get(i) ?? "", p.ref]);
});
city.buildings = out;
city.source = "© colaboradores de OpenStreetMap (ODbL); edificios: Dirección General del Catastro (CC BY 4.0)";
writeFileSync(cityFile, gzipSync(JSON.stringify(city), { level: 9 }));
console.log(`edificios: ${parts.length - drop.size} del catastro + ${kept} de OSM (fuera del municipio o hitos) → ${cityFile}`);
