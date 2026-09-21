// Tileset inicial de EVERLINTH: sprites vectoriales (SVG) isométricos planos,
// inspirados en la referencia de estilo compartida (terreno, agua, edificios, objetos).
// Se generan como imágenes (no se redibujan a mano cada frame) para poder iterar
// el arte de forma independiente del código de renderizado.

export interface Sprite {
  img: HTMLImageElement;
  w: number;
  h: number;
  anchorX: number;
  anchorY: number; // punto de la imagen que coincide con el suelo (cx, cy) del tile
}

function svgToImage(svg: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = `data:image/svg+xml;base64,${btoa(unescape(encodeURIComponent(svg)))}`;
  });
}

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = url;
  });
}

// Tiles fotográficos recortados de una hoja de sprites isométrica (raster, no vector),
// con el fondo eliminado. Todas las celdas de origen son cuadradas y comparten el mismo
// punto de anclaje relativo (el centro del rombo superior del bloque).
const RASTER_SOURCES: Record<string, string> = {
  grass1: "/raster/ground_plain.png",
  grass2: "/raster/ground_pebbly.png",
  grass3: "/raster/ground_tufts.png",
  dirt: "/raster/ground_path.png",
  water1: "/raster/puddle.png",
  water2: "/raster/puddle.png",
  tree: "/raster/dead_tree.png",
  tree2: "/raster/dead_tree.png",
  rock1: "/raster/rock_spire.png",
  rock2: "/raster/rock_spire.png",
  building: "/raster/rock_mesa.png",
  fence: "/raster/cliff_wall.png",
};

// ---- Paleta compartida (a partir de la referencia) ----
const GREEN_LIGHT = "#5cc23e";
const GREEN_MID = "#3f9a4d";
const GREEN_DARK = "#2f7a3c";
const TAN = "#b8a06a";
const TAN_DARK = "#8a7a4a";
const BLUE = "#2e6fc4";
const BLUE_LIGHT = "#5aa0e8";
const GRAY_LIGHT = "#e8e8e8";
const GRAY = "#9a9a9a";
const GRAY_DARK = "#555555";
const INK = "rgba(0,0,0,0.25)";
const GOLD = "#f0c419";

function diamond(cx: number, cy: number, w: number, h: number): string {
  return `${cx},${cy - h / 2} ${cx + w / 2},${cy} ${cx},${cy + h / 2} ${cx - w / 2},${cy}`;
}

function groundTile(fill: string, speckles: Array<[number, number, string]>): string {
  const pts = diamond(32, 16, 64, 32);
  const dots = speckles
    .map(([x, y, c]) => `<circle cx="${x}" cy="${y}" r="1.3" fill="${c}" />`)
    .join("");
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 32">
    <polygon points="${pts}" fill="${fill}" stroke="${INK}" stroke-width="0.5" />
    ${dots}
  </svg>`;
}

function mulberry(seed: number) {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function speckleField(seed: number, count: number, color: string): Array<[number, number, string]> {
  const rnd = mulberry(seed);
  const out: Array<[number, number, string]> = [];
  for (let i = 0; i < count; i++) {
    const x = 6 + rnd() * 52;
    const y = 6 + rnd() * 20;
    out.push([x, y, color]);
  }
  return out;
}

const SVGS = {
  bush: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 26">
    <ellipse cx="20" cy="24" rx="12" ry="3" fill="${INK}" />
    <circle cx="14" cy="16" r="9" fill="${GREEN_DARK}" stroke="#1c4a26" stroke-width="1" />
    <circle cx="26" cy="16" r="9" fill="${GREEN_MID}" stroke="#1c4a26" stroke-width="1" />
    <circle cx="20" cy="10" r="8" fill="${GREEN_LIGHT}" stroke="#1c4a26" stroke-width="1" />
  </svg>`,

  barrel: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 28">
    <ellipse cx="12" cy="26" rx="9" ry="2" fill="${INK}" />
    <rect x="3" y="8" width="18" height="16" rx="3" fill="${TAN}" stroke="${TAN_DARK}" stroke-width="1" />
    <ellipse cx="12" cy="8" rx="9" ry="3" fill="${TAN_DARK}" stroke="${TAN_DARK}" stroke-width="1" />
    <rect x="3" y="13" width="18" height="2" fill="${TAN_DARK}" />
    <rect x="3" y="19" width="18" height="2" fill="${TAN_DARK}" />
  </svg>`,

  flag: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 30 46">
    <ellipse cx="15" cy="44" rx="6" ry="2" fill="${INK}" />
    <rect x="13" y="6" width="2.5" height="38" fill="#ccc" />
    <polygon points="15,6 30,11 15,16" fill="#d63a3a" stroke="#7a1f1f" stroke-width="0.5" />
  </svg>`,

  coin: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20">
    <circle cx="10" cy="10" r="8" fill="${GOLD}" stroke="#a8860a" stroke-width="1.5" />
    <circle cx="10" cy="10" r="4" fill="none" stroke="#a8860a" stroke-width="1" />
  </svg>`,
};

export type SpriteKey = keyof typeof SVGS | keyof typeof RASTER_SOURCES;

// Tamaño de despliegue uniforme para los tiles raster (todos vienen de celdas
// cuadradas de la misma hoja, con el rombo centrado en la misma fracción vertical).
const RASTER_SIZE = { w: 68, h: 68, ax: 34, ay: 20 };

const ANCHORS: Record<SpriteKey, { w: number; h: number; ax: number; ay: number }> = {
  grass1: RASTER_SIZE,
  grass2: RASTER_SIZE,
  grass3: RASTER_SIZE,
  dirt: RASTER_SIZE,
  water1: RASTER_SIZE,
  water2: RASTER_SIZE,
  tree: RASTER_SIZE,
  tree2: RASTER_SIZE,
  fence: RASTER_SIZE,
  rock1: RASTER_SIZE,
  rock2: RASTER_SIZE,
  building: { w: 100, h: 100, ax: 50, ay: 30 },
  bush: { w: 40, h: 26, ax: 20, ay: 24 },
  barrel: { w: 24, h: 28, ax: 12, ay: 26 },
  flag: { w: 30, h: 46, ax: 15, ay: 44 },
  coin: { w: 20, h: 20, ax: 10, ay: 10 },
};

let cache: Record<SpriteKey, Sprite> | null = null;
let loading: Promise<Record<SpriteKey, Sprite>> | null = null;

export function loadTileset(): Promise<Record<SpriteKey, Sprite>> {
  if (cache) return Promise.resolve(cache);
  if (loading) return loading;

  const svgKeys = Object.keys(SVGS) as Array<keyof typeof SVGS>;
  const rasterKeys = Object.keys(RASTER_SOURCES) as Array<keyof typeof RASTER_SOURCES>;

  loading = Promise.all([
    Promise.all(svgKeys.map((k) => svgToImage(SVGS[k]))),
    Promise.all(rasterKeys.map((k) => loadImage(RASTER_SOURCES[k]))),
  ]).then(([svgImages, rasterImages]) => {
    const result = {} as Record<SpriteKey, Sprite>;
    svgKeys.forEach((k, i) => {
      const a = ANCHORS[k];
      result[k] = { img: svgImages[i], w: a.w, h: a.h, anchorX: a.ax, anchorY: a.ay };
    });
    rasterKeys.forEach((k, i) => {
      const a = ANCHORS[k];
      result[k] = { img: rasterImages[i], w: a.w, h: a.h, anchorX: a.ax, anchorY: a.ay };
    });
    cache = result;
    return result;
  });
  return loading;
}

export function drawSprite(ctx: CanvasRenderingContext2D, sprite: Sprite, cx: number, cy: number): void {
  ctx.drawImage(sprite.img, cx - sprite.anchorX, cy - sprite.anchorY, sprite.w, sprite.h);
}
