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
  grass1: groundTile(GREEN_MID, speckleField(1, 10, GREEN_DARK)),
  grass2: groundTile(GREEN_LIGHT, speckleField(2, 10, GREEN_MID)),
  grass3: groundTile(GREEN_MID, speckleField(3, 6, GREEN_DARK).concat(speckleField(30, 4, GREEN_LIGHT))),
  dirt: groundTile(TAN, speckleField(4, 8, TAN_DARK)),
  water1: groundTile(BLUE, speckleField(5, 8, BLUE_LIGHT)),
  water2: groundTile(BLUE, speckleField(6, 8, BLUE_LIGHT)),

  tree: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 60">
    <ellipse cx="32" cy="56" rx="14" ry="4" fill="${INK}" />
    <rect x="29" y="42" width="6" height="16" fill="#5a3a22" stroke="#3d2716" stroke-width="0.5" />
    <polygon points="32,4 54,40 10,40" fill="${GREEN_DARK}" stroke="#1c4a26" stroke-width="1" />
    <polygon points="32,16 47,42 17,42" fill="${GREEN_MID}" stroke="#1c4a26" stroke-width="1" />
    <polygon points="32,26 40,44 24,44" fill="${GREEN_LIGHT}" />
  </svg>`,

  bush: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 26">
    <ellipse cx="20" cy="24" rx="12" ry="3" fill="${INK}" />
    <circle cx="14" cy="16" r="9" fill="${GREEN_DARK}" stroke="#1c4a26" stroke-width="1" />
    <circle cx="26" cy="16" r="9" fill="${GREEN_MID}" stroke="#1c4a26" stroke-width="1" />
    <circle cx="20" cy="10" r="8" fill="${GREEN_LIGHT}" stroke="#1c4a26" stroke-width="1" />
  </svg>`,

  tree2: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 64">
    <ellipse cx="24" cy="60" rx="10" ry="3" fill="${INK}" />
    <rect x="21" y="46" width="6" height="14" fill="#5a3a22" stroke="#3d2716" stroke-width="0.5" />
    <polygon points="24,4 36,26 12,26" fill="${GREEN_DARK}" stroke="#1c4a26" stroke-width="1" />
    <polygon points="24,16 34,36 14,36" fill="${GREEN_MID}" stroke="#1c4a26" stroke-width="1" />
    <polygon points="24,28 32,46 16,46" fill="${GREEN_LIGHT}" stroke="#1c4a26" stroke-width="1" />
  </svg>`,

  fence: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 48">
    <polygon points="32,16 64,32 32,48 0,32" fill="${GREEN_MID}" stroke="rgba(0,0,0,0.25)" stroke-width="0.5" />
    <rect x="1.7" y="16.4" width="3" height="14" fill="#e8e8e8" stroke="#333" stroke-width="0.5" />
    <rect x="8.1" y="19.2" width="3" height="14" fill="#2a2a2a" />
    <rect x="14.5" y="22" width="3" height="14" fill="#e8e8e8" stroke="#333" stroke-width="0.5" />
    <rect x="20.9" y="24.8" width="3" height="14" fill="#2a2a2a" />
    <rect x="27.3" y="27.6" width="3" height="14" fill="#e8e8e8" stroke="#333" stroke-width="0.5" />
    <rect x="33.7" y="24.8" width="3" height="14" fill="#2a2a2a" />
    <rect x="40.1" y="22" width="3" height="14" fill="#e8e8e8" stroke="#333" stroke-width="0.5" />
    <rect x="46.5" y="19.2" width="3" height="14" fill="#2a2a2a" />
    <rect x="52.9" y="16.4" width="3" height="14" fill="#e8e8e8" stroke="#333" stroke-width="0.5" />
    <rect x="59.3" y="13.6" width="3" height="14" fill="#2a2a2a" />
  </svg>`,

  rock1: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 36 24">
    <ellipse cx="18" cy="22" rx="14" ry="2.5" fill="${INK}" />
    <polygon points="4,16 12,4 26,6 32,16 20,22 10,20" fill="${GRAY}" stroke="${GRAY_DARK}" stroke-width="1" />
    <polygon points="12,4 26,6 20,12 10,10" fill="${GRAY_LIGHT}" opacity="0.7" />
  </svg>`,
  rock2: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 30 20">
    <ellipse cx="15" cy="18" rx="11" ry="2" fill="${INK}" />
    <polygon points="3,13 10,3 22,5 27,13 16,18 8,16" fill="${GRAY}" stroke="${GRAY_DARK}" stroke-width="1" />
  </svg>`,

  building: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 112 150">
    <ellipse cx="56" cy="146" rx="34" ry="6" fill="${INK}" />
    <polygon points="8,96 56,120 56,146 8,122" fill="${GRAY_LIGHT}" stroke="${GRAY_DARK}" stroke-width="1" />
    <polygon points="104,96 56,120 56,146 104,122" fill="#f2f2f2" stroke="${GRAY_DARK}" stroke-width="1" />
    <polygon points="8,96 56,72 104,96 56,120" fill="${GRAY}" stroke="${GRAY_DARK}" stroke-width="1" />
    <rect x="16" y="102" width="8" height="12" fill="#222" />
    <rect x="30" y="106" width="8" height="12" fill="#222" />
    <rect x="76" y="106" width="8" height="12" fill="#222" />
    <rect x="90" y="102" width="8" height="12" fill="#222" />
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

export type SpriteKey = keyof typeof SVGS;

const ANCHORS: Record<SpriteKey, { w: number; h: number; ax: number; ay: number }> = {
  grass1: { w: 64, h: 32, ax: 32, ay: 16 },
  grass2: { w: 64, h: 32, ax: 32, ay: 16 },
  grass3: { w: 64, h: 32, ax: 32, ay: 16 },
  dirt: { w: 64, h: 32, ax: 32, ay: 16 },
  water1: { w: 64, h: 32, ax: 32, ay: 16 },
  water2: { w: 64, h: 32, ax: 32, ay: 16 },
  tree: { w: 64, h: 60, ax: 32, ay: 56 },
  tree2: { w: 48, h: 64, ax: 24, ay: 60 },
  bush: { w: 40, h: 26, ax: 20, ay: 24 },
  fence: { w: 64, h: 48, ax: 32, ay: 32 },
  rock1: { w: 36, h: 24, ax: 18, ay: 21 },
  rock2: { w: 30, h: 20, ax: 15, ay: 18 },
  building: { w: 112, h: 150, ax: 56, ay: 138 },
  barrel: { w: 24, h: 28, ax: 12, ay: 26 },
  flag: { w: 30, h: 46, ax: 15, ay: 44 },
  coin: { w: 20, h: 20, ax: 10, ay: 10 },
};

let cache: Record<SpriteKey, Sprite> | null = null;
let loading: Promise<Record<SpriteKey, Sprite>> | null = null;

export function loadTileset(): Promise<Record<SpriteKey, Sprite>> {
  if (cache) return Promise.resolve(cache);
  if (loading) return loading;

  const keys = Object.keys(SVGS) as SpriteKey[];
  loading = Promise.all(keys.map((k) => svgToImage(SVGS[k]))).then((images) => {
    const result = {} as Record<SpriteKey, Sprite>;
    keys.forEach((k, i) => {
      const a = ANCHORS[k];
      result[k] = { img: images[i], w: a.w, h: a.h, anchorX: a.ax, anchorY: a.ay };
    });
    cache = result;
    return result;
  });
  return loading;
}

export function drawSprite(ctx: CanvasRenderingContext2D, sprite: Sprite, cx: number, cy: number): void {
  ctx.drawImage(sprite.img, cx - sprite.anchorX, cy - sprite.anchorY, sprite.w, sprite.h);
}
