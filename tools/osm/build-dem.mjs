// Relieve de la ciudad: descarga las teselas de elevación "Terrarium" (AWS Terrain Tiles,
// datos abiertos: SRTM, Copernicus EU-DEM y otros; ver server/data/osm/LICENCIA.md) que
// cubren la extensión de la ciudad OSM y las remuestrea a una rejilla en tiles del juego
// (misma proyección que build-city.mjs). Salida: cabecera JSON + Int16 (decímetros).
//
//   node tools/osm/build-dem.mjs [ciudad.json.gz] [salida.bin.gz] [paso en tiles] [zoom]
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { gunzipSync, gzipSync, inflateSync } from "node:zlib";
import path from "node:path";

const [, , cityArg, outArg, stepArg, zoomArg] = process.argv;
const cityFile = cityArg || "server/data/osm/acoruna.json.gz";
const out = outArg || "server/data/osm/acoruna-dem.bin.gz";
const STEP = Number(stepArg || 4); // tiles del juego por muestra (6 m)
const Z = Number(zoomArg || 14);
const TILE_M = 1.5;
const OX = 24;
const OY = 13.5;
const city = JSON.parse(gunzipSync(readFileSync(cityFile)).toString("utf8"));
const LAT0 = city.origin.lat;
const LON0 = city.origin.lon;
const kx = (Math.cos((LAT0 * Math.PI) / 180) * 111320) / TILE_M;
const ky = 110574 / TILE_M;
const [bx0, by0, bx1, by1] = city.bbox;
const x0 = Math.floor(bx0 / STEP) * STEP - STEP * 4;
const y0 = Math.floor(by0 / STEP) * STEP - STEP * 4;
const w = Math.ceil((bx1 - x0) / STEP) + 5;
const h = Math.ceil((by1 - y0) / STEP) + 5;

// PNG de 8 bits RGB/RGBA sin entrelazar (lo que sirven las teselas Terrarium)
function decodePng(buf) {
  let p = 8;
  let width = 0, height = 0, ctype = 0;
  const idat = [];
  while (p < buf.length) {
    const len = buf.readUInt32BE(p);
    const type = buf.toString("ascii", p + 4, p + 8);
    const data = buf.subarray(p + 8, p + 8 + len);
    if (type === "IHDR") {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      ctype = data[9];
    } else if (type === "IDAT") idat.push(data);
    p += 12 + len;
  }
  const bpp = ctype === 6 ? 4 : ctype === 2 ? 3 : 0;
  if (!bpp) throw new Error("PNG no soportado, tipo " + ctype);
  const raw = inflateSync(Buffer.concat(idat));
  const px = Buffer.alloc(width * height * bpp);
  const stride = width * bpp;
  for (let y = 0; y < height; y++) {
    const f = raw[y * (stride + 1)];
    const src = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    const row = px.subarray(y * stride, (y + 1) * stride);
    const prev = y > 0 ? px.subarray((y - 1) * stride, y * stride) : null;
    for (let i = 0; i < stride; i++) {
      const a = i >= bpp ? row[i - bpp] : 0;
      const b = prev ? prev[i] : 0;
      const c = prev && i >= bpp ? prev[i - bpp] : 0;
      let v = src[i];
      if (f === 1) v += a;
      else if (f === 2) v += b;
      else if (f === 3) v += (a + b) >> 1;
      else if (f === 4) {
        const pp = a + b - c;
        const pa = Math.abs(pp - a), pb = Math.abs(pp - b), pc = Math.abs(pp - c);
        v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
      }
      row[i] = v & 255;
    }
  }
  return { width, height, bpp, px };
}

const cacheDir = path.join("tools", "osm", ".dem-cache");
mkdirSync(cacheDir, { recursive: true });
const tiles = new Map();
async function tile(tx, ty) {
  const key = `${tx},${ty}`;
  if (tiles.has(key)) return tiles.get(key);
  const file = path.join(cacheDir, `${Z}-${tx}-${ty}.png`);
  let buf;
  if (existsSync(file)) buf = readFileSync(file);
  else {
    const url = `https://s3.amazonaws.com/elevation-tiles-prod/terrarium/${Z}/${tx}/${ty}.png`;
    const r = await fetch(url, { headers: { "User-Agent": "everlinth-dem/1.0" } });
    if (!r.ok) throw new Error(`${url}: ${r.status}`);
    buf = Buffer.from(await r.arrayBuffer());
    writeFileSync(file, buf);
  }
  const img = decodePng(buf);
  tiles.set(key, img);
  return img;
}
const n = 2 ** Z;
async function elevation(lat, lon) {
  const fx = ((lon + 180) / 360) * n;
  const lr = (lat * Math.PI) / 180;
  const fy = ((1 - Math.asinh(Math.tan(lr)) / Math.PI) / 2) * n;
  const tx = Math.floor(fx);
  const ty = Math.floor(fy);
  const img = await tile(tx, ty);
  // bilineal dentro de la tesela (256 px)
  const u = (fx - tx) * img.width - 0.5;
  const v = (fy - ty) * img.height - 0.5;
  const at = (i, j) => {
    i = Math.max(0, Math.min(img.width - 1, i));
    j = Math.max(0, Math.min(img.height - 1, j));
    const k = (j * img.width + i) * img.bpp;
    return img.px[k] * 256 + img.px[k + 1] + img.px[k + 2] / 256 - 32768;
  };
  const i = Math.floor(u), j = Math.floor(v);
  const a = u - i, b = v - j;
  return (at(i, j) * (1 - a) + at(i + 1, j) * a) * (1 - b) + (at(i, j + 1) * (1 - a) + at(i + 1, j + 1) * a) * b;
}

const grid = new Int16Array(w * h);
let lo = Infinity, hi = -Infinity;
for (let j = 0; j < h; j++) {
  for (let i = 0; i < w; i++) {
    const gx = x0 + i * STEP;
    const gy = y0 + j * STEP;
    const lon = LON0 + (gx - OX) / kx;
    const lat = LAT0 - (gy - OY) / ky;
    const e = await elevation(lat, lon);
    grid[j * w + i] = Math.round(Math.max(-50, Math.min(3000, e)) * 10);
    lo = Math.min(lo, e);
    hi = Math.max(hi, e);
  }
}
const header = Buffer.from(JSON.stringify({ x0, y0, step: STEP, w, h, unit: 0.1, source: "AWS Terrain Tiles (Terrarium): SRTM, Copernicus EU-DEM y otros" }));
const hl = Buffer.alloc(4);
hl.writeUInt32LE(header.length);
writeFileSync(out, gzipSync(Buffer.concat([hl, header, Buffer.from(grid.buffer)]), { level: 9 }));
console.log(`relieve ${w}×${h} muestras cada ${STEP} tiles · ${tiles.size} teselas · ${lo.toFixed(1)}..${hi.toFixed(1)} m → ${out}`);
