// Hoja de contacto de las texturas (solo para revisarlas a ojo).
import sharp from "sharp";
import fs from "node:fs";
import path from "node:path";

const dir = "../../assets/buildings";
const out = process.argv[2];
const files = fs.readdirSync(dir).filter((f) => f.endsWith(".png")).sort();
const COLS = 8;
const CW = 190;
const CH = 170;
const PER = 40;
for (let s = 0; s * PER < files.length; s++) {
  const chunk = files.slice(s * PER, (s + 1) * PER);
  const rows = Math.ceil(chunk.length / COLS);
  const comps = [];
  for (let i = 0; i < chunk.length; i++) {
    const x = (i % COLS) * CW;
    const y = Math.floor(i / COLS) * CH;
    const img = await sharp(path.join(dir, chunk[i])).resize(CW - 6, CH - 22, { fit: "inside" }).jpeg({ quality: 70 }).toBuffer();
    comps.push({ input: img, left: x + 3, top: y + 2 });
    const label = chunk[i].replace(".png", "").slice(0, 28);
    const svg = `<svg width="${CW}" height="18" xmlns="http://www.w3.org/2000/svg"><text x="3" y="13" font-size="12" font-family="Arial" fill="#fff">${label}</text></svg>`;
    comps.push({ input: Buffer.from(svg), left: x, top: y + CH - 19 });
  }
  await sharp({ create: { width: COLS * CW, height: rows * CH, channels: 3, background: "#222" } })
    .composite(comps)
    .jpeg({ quality: 78 })
    .toFile(path.join(out, `sheet${s}.jpg`));
}
console.log("sheets", Math.ceil(files.length / PER));
