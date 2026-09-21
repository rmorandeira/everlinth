// PRNG determinista (mulberry32) sembrado a partir de las coordenadas de la pantalla,
// para que la generación de una pantalla sea reproducible.
export function makeRng(seed: number): () => number {
  let a = seed >>> 0;
  return function rng() {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function seedFromCoords(sx: number, sy: number): number {
  // Cantor-ish pairing con signos, suficiente para dispersar coordenadas negativas/positivas.
  const a = sx >= 0 ? sx * 2 : -sx * 2 - 1;
  const b = sy >= 0 ? sy * 2 : -sy * 2 - 1;
  return ((a + b) * (a + b + 1)) / 2 + b;
}
