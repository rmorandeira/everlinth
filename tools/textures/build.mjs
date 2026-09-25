// Prepara las texturas de fachada del juego: las fotos originales de assets/buildings
// (PNG de hasta 2048 px, ~200 MB en total) se reducen a JPEG de 512 px máximo y se
// genera un manifest con la categoría de cada una y cuántas plantas muestra.
//
//   cd tools/textures && npm install && node build.mjs
//
// Salida: client/public/textures/buildings/*.jpg + manifest.json
import sharp from "sharp";
import fs from "node:fs";
import path from "node:path";

const SRC = "../../assets/buildings";
const OUT = "../../client/public/textures/buildings";
const MAX_SIDE = 512;

// Categorías (ver assets/buildings a ojo):
//  tower   — rejillas de ventanas de varias plantas, para los muros altos
//  lowrise — fachada completa de 1-3 plantas (naves, casas, iglesias…)
//  ground  — planta baja / escaparate / persiana, para la base de las torres
const TOWER = new Set([
  "apartment_block5", "apartment_block6", "apartment_block7", "apartment_block8",
  "apartments1", "apartments2-2", "apartments2", "apartments4", "apartments5", "apartments6",
  "apartments7", "apartments8", "apartments9", "building_dock_apartments", "building_dock_apartments2",
  "building_lh1", "building_mirrored", "building_office", "building_office10", "building_office11",
  "building_office2", "building_office3", "building_office4", "building_office5", "building_office7",
  "building_office8", "building_office9", "building_office13", "building_modern2", "building_l2",
  "building_liver", "building_construction",
]);
const GROUND_PREFIX = ["shop_front", "shopfront", "shutters_", "wall_shutter", "wall_steel_", "warehouse_", "loading_bays", "restaurant_window"];
const CHURCH_PREFIX = ["building_church", "church_"];

// Correcciones a ojo donde la autocorrelación se equivoca (periodo doble o triple).
const FLOORS_OVERRIDE = { building_office3: 5, building_office4: 3, building_liver: 9, building_lh1: 10, apartments7: 12, apartment_block6: 22, building_dock_apartments: 6 };

function category(id) {
  if (TOWER.has(id)) return "tower";
  if (GROUND_PREFIX.some((p) => id.startsWith(p))) return "ground";
  return "lowrise";
}

// Estima cuántas plantas muestra una fachada: periodo dominante del perfil vertical
// de brillo (autocorrelación). Devuelve null si no encuentra periodicidad clara.
async function estimateFloors(file) {
  const W = 48;
  const { data, info } = await sharp(file).resize({ width: W, height: 400, fit: "fill" }).greyscale().raw().toBuffer({ resolveWithObject: true });
  const H = info.height;
  const prof = new Float64Array(H);
  for (let y = 0; y < H; y++) {
    let s = 0;
    for (let x = 0; x < W; x++) s += data[y * W + x];
    prof[y] = s / W;
  }
  let mean = 0;
  for (const v of prof) mean += v;
  mean /= H;
  for (let y = 0; y < H; y++) prof[y] -= mean;
  let var0 = 0;
  for (const v of prof) var0 += v * v;
  if (var0 < 1e-6) return null;
  let best = null;
  const minLag = Math.max(4, Math.floor(H / 30));
  const maxLag = Math.floor(H / 1.7);
  let prev = -Infinity;
  let prevPrev = -Infinity;
  const ac = [];
  for (let lag = 0; lag <= maxLag; lag++) {
    let s = 0;
    for (let y = 0; y + lag < H; y++) s += prof[y] * prof[y + lag];
    ac.push(s / var0);
  }
  for (let lag = minLag; lag < maxLag; lag++) {
    const isPeak = ac[lag] > ac[lag - 1] && ac[lag] >= ac[lag + 1];
    if (isPeak && ac[lag] > 0.25 && (!best || ac[lag] > best.score * 1.15)) best = { lag, score: ac[lag] };
  }
  void prev;
  void prevPrev;
  if (!best) return null;
  return { floors: Math.round(H / best.lag), score: best.score };
}

fs.mkdirSync(OUT, { recursive: true });
const files = fs.readdirSync(SRC).filter((f) => f.endsWith(".png")).sort();
const manifest = [];
for (const f of files) {
  const id = f.replace(".png", "");
  const full = path.join(SRC, f);
  const meta = await sharp(full).metadata();
  const scale = MAX_SIDE / Math.max(meta.width, meta.height);
  const w = Math.max(8, Math.round(meta.width * Math.min(1, scale)));
  const h = Math.max(8, Math.round(meta.height * Math.min(1, scale)));
  await sharp(full).resize(w, h, { fit: "fill" }).jpeg({ quality: 82, mozjpeg: true }).toFile(path.join(OUT, `${id}.jpg`));
  const cat = category(id);
  let floors = 1;
  let est = null;
  if (cat === "tower") {
    est = await estimateFloors(full);
    floors = FLOORS_OVERRIDE[id] ?? (est ? Math.min(24, Math.max(2, est.floors)) : Math.max(2, Math.round(meta.height / 190)));
  } else if (cat === "lowrise") {
    floors = CHURCH_PREFIX.some((p) => id.startsWith(p)) ? 3 : 2;
  }
  manifest.push({ id, cat, floors, w: meta.width, h: meta.height, est: est ? Number(est.score.toFixed(2)) : null });
  console.log(id.padEnd(34), cat.padEnd(8), String(floors).padStart(3), est ? est.score.toFixed(2) : "-");
}
fs.writeFileSync(path.join(OUT, "manifest.json"), JSON.stringify(manifest.map(({ est, ...m }) => m)));
const total = fs.readdirSync(OUT).reduce((n, f) => n + fs.statSync(path.join(OUT, f)).size, 0);
console.log(`\n${manifest.length} texturas, ${(total / 1e6).toFixed(1)} MB`);
