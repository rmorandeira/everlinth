// Recorta pasos sueltos de una grabación larga de pisadas (Sounds/footsteps.wav,
// WAV PCM 16 bits) para el juego: detecta cada pisada por la envolvente de energía,
// corta ~0,3 s desde un poco antes del golpe, aplica fundido de salida y guarda los
// más limpios como client/public/sounds/step-N.wav. En juego se reproduce uno al azar
// por pisada con ligera variación de tono, así que no hace falta más metraje.
//
//   node tools/sounds/split-steps.mjs [entrada.wav] [nº de pasos]
import fs from "node:fs";
import path from "node:path";

const input = process.argv[2] ?? "Sounds/footsteps.wav";
const COUNT = Number(process.argv[3] ?? 8);
const OUT = "client/public/sounds";

const b = fs.readFileSync(input);
let off = 12;
let fmt = null;
let data = null;
while (off < b.length) {
  const id = b.toString("ascii", off, off + 4);
  const size = b.readUInt32LE(off + 4);
  if (id === "fmt ") fmt = { ch: b.readUInt16LE(off + 10), rate: b.readUInt32LE(off + 12), bits: b.readUInt16LE(off + 22) };
  if (id === "data") data = { start: off + 8, size };
  off += 8 + size + (size % 2);
}
if (!fmt || !data || fmt.bits !== 16) throw new Error("Se espera WAV PCM de 16 bits");
const frames = data.size / (2 * fmt.ch);
const sample = (i) => {
  let s = 0;
  for (let c = 0; c < fmt.ch; c++) s += b.readInt16LE(data.start + (i * fmt.ch + c) * 2);
  return s / fmt.ch / 32768;
};
const mono = new Float32Array(frames);
for (let i = 0; i < frames; i++) mono[i] = sample(i);

// Envolvente RMS en ventanas de 10 ms y detección de golpes (subida brusca).
const WIN = Math.round(fmt.rate * 0.01);
const env = [];
for (let i = 0; i < frames; i += WIN) {
  let s = 0;
  const n = Math.min(WIN, frames - i);
  for (let j = 0; j < n; j++) s += mono[i + j] ** 2;
  env.push(Math.sqrt(s / n));
}
const sorted = [...env].sort((x, y) => x - y);
const floor = sorted[Math.floor(sorted.length * 0.3)];
const peak = sorted[Math.floor(sorted.length * 0.995)];
const threshold = floor + (peak - floor) * 0.25;
const onsets = [];
let last = -1e9;
for (let k = 1; k < env.length; k++) {
  if (env[k] > threshold && env[k - 1] <= threshold && k - last > 22) {
    // pico de ese golpe (en los 60 ms siguientes)
    let pk = k;
    for (let q = k; q < Math.min(env.length, k + 6); q++) if (env[q] > env[pk]) pk = q;
    onsets.push({ k, energy: env[pk] });
    last = k;
  }
}

// Cada paso: desde 15 ms antes del golpe, 300 ms (o hasta el siguiente golpe).
const clips = onsets.map((o, idx) => {
  const start = Math.max(0, o.k * WIN - Math.round(fmt.rate * 0.015));
  const nextStart = idx + 1 < onsets.length ? onsets[idx + 1].k * WIN - Math.round(fmt.rate * 0.02) : frames;
  const len = Math.min(Math.round(fmt.rate * 0.3), nextStart - start);
  // limpieza: energía del golpe frente a la cola (evita pasos solapados)
  let tail = 0;
  const tailStart = start + Math.floor(len * 0.7);
  for (let i = tailStart; i < start + len; i++) tail += mono[i] ** 2;
  tail = Math.sqrt(tail / Math.max(1, start + len - tailStart));
  return { start, len, energy: o.energy, clean: o.energy / (tail + 1e-4) };
});
const good = clips.filter((c) => c.len > fmt.rate * 0.18).sort((x, y) => y.clean - x.clean).slice(0, COUNT);
if (good.length === 0) throw new Error("No se detectaron pasos");
const maxE = Math.max(...good.map((c) => c.energy));

fs.mkdirSync(OUT, { recursive: true });
for (const f of fs.readdirSync(OUT)) if (/^step-\d+\.wav$/.test(f)) fs.unlinkSync(path.join(OUT, f));
good.sort((x, y) => x.start - y.start).forEach((c, n) => {
  const gain = (0.7 * maxE) / c.energy; // volúmenes parecidos entre pasos
  const pcm = Buffer.alloc(c.len * 2);
  const fadeIn = Math.round(fmt.rate * 0.004);
  const fadeOut = Math.round(c.len * 0.45);
  for (let i = 0; i < c.len; i++) {
    let v = mono[c.start + i] * gain;
    if (i < fadeIn) v *= i / fadeIn;
    if (i > c.len - fadeOut) v *= (c.len - i) / fadeOut;
    pcm.writeInt16LE(Math.max(-32767, Math.min(32767, Math.round(v * 32767))), i * 2);
  }
  const h = Buffer.alloc(44);
  h.write("RIFF", 0);
  h.writeUInt32LE(36 + pcm.length, 4);
  h.write("WAVE", 8);
  h.write("fmt ", 12);
  h.writeUInt32LE(16, 16);
  h.writeUInt16LE(1, 20);
  h.writeUInt16LE(1, 22);
  h.writeUInt32LE(fmt.rate, 24);
  h.writeUInt32LE(fmt.rate * 2, 28);
  h.writeUInt16LE(2, 32);
  h.writeUInt16LE(16, 34);
  h.write("data", 36);
  h.writeUInt32LE(pcm.length, 40);
  fs.writeFileSync(path.join(OUT, `step-${n + 1}.wav`), Buffer.concat([h, pcm]));
  console.log(`step-${n + 1}.wav  t=${(c.start / fmt.rate).toFixed(2)}s  ${(c.len / fmt.rate).toFixed(2)}s  limpieza ${c.clean.toFixed(1)}`);
});
console.log(`${onsets.length} pisadas detectadas, ${good.length} guardadas`);
