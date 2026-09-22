// Dibuja los árboles generados en /admin/trees (ver TreeDef en shared) dentro
// del propio juego. Es el mismo algoritmo, en el mismo orden, que la vista
// previa del backoffice (server/src/adminTrees.ts) — si se cambia uno, hay que
// cambiar el otro a mano, porque el backoffice es JS embebido en una plantilla
// HTML y no puede importar este módulo TypeScript del cliente.
//
// Rendimiento: la FORMA de un árbol (contornos, hojas) depende solo de
// treeDefId + índice de instancia — es 100% determinista, nunca del tiempo ni
// de dónde se plante. Por eso cada variante se "hornea" una única vez en un
// canvas descartable (ver getTreeBitmap) y luego cada frame solo hace falta un
// drawImage + una rotación barata para el balanceo del viento, en vez de
// recalcular cientos de trazos y gradientes por árbol y por frame. Esto es lo
// que hace viable un bosque con muchas copias del mismo árbol: por denso que
// sea, el nº de bitmaps cacheados solo depende de cuántos TreeDef distintos
// (× countPerTile) haya dado de alta el admin, no de cuántas veces se planten.
import type { TreeDef, LeafShape } from "@roi/shared";
import { TILE_W, TILE_H } from "./iso.js";

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hexToRgb(hex: string): { r: number; g: number; b: number } {
  const n = parseInt(hex.replace("#", ""), 16);
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}

function lerpColor(hexA: string, hexB: string, t: number): string {
  const a = hexToRgb(hexA);
  const b = hexToRgb(hexB);
  const r = Math.round(a.r + (b.r - a.r) * t);
  const g = Math.round(a.g + (b.g - a.g) * t);
  const bl = Math.round(a.b + (b.b - a.b) * t);
  return `rgb(${r},${g},${bl})`;
}

// amt<0 oscurece, amt>0 aclara (hacia blanco). Da volumen al tronco/ramas sin
// necesitar más de un color de entrada.
function shade(hex: string, amt: number): string {
  const c = hexToRgb(hex);
  const f = (v: number) => Math.max(0, Math.min(255, Math.round(amt >= 0 ? v + (255 - v) * amt : v * (1 + amt))));
  return `rgb(${f(c.r)},${f(c.g)},${f(c.b)})`;
}

interface Outline {
  left: Array<{ x: number; y: number }>;
  right: Array<{ x: number; y: number }>;
}

// Contorno (izq/der) de un tramo recto de (0,0) a (ex,ey) cuya línea central se
// curva con una onda perpendicular — el "retorcido". La onda vale 0 en los dos
// extremos (sin(t*PI)) y máxima a mitad de camino, así el tramo siempre empieza
// y acaba exactamente donde se le pide, solo se abomba en medio.
function bentOutline(ex: number, ey: number, w0: number, w1: number, twist: number, freq: number, phase: number, segments: number): Outline {
  const len = Math.hypot(ex, ey) || 1;
  const ux = ex / len;
  const uy = ey / len;
  const nx = -uy;
  const ny = ux;
  const left: Outline["left"] = [];
  const right: Outline["right"] = [];
  for (let i = 0; i <= segments; i++) {
    const t = i / segments;
    const cx = ex * t;
    const cy = ey * t;
    const bend = Math.sin(t * Math.PI * freq + phase) * Math.sin(t * Math.PI) * twist * len * 0.22;
    const w = (w0 + (w1 - w0) * t) / 2;
    left.push({ x: cx + nx * (bend - w), y: cy + ny * (bend - w) });
    right.push({ x: cx + nx * (bend + w), y: cy + ny * (bend + w) });
  }
  return { left, right };
}

function fillOutline(ctx: CanvasRenderingContext2D, outline: Outline, colorA: string, colorB: string): void {
  const p0 = outline.left[0];
  const p1 = outline.right[0];
  const g = ctx.createLinearGradient(p0.x, p0.y, p1.x, p1.y);
  g.addColorStop(0, colorA);
  g.addColorStop(0.5, colorB);
  g.addColorStop(1, colorA);
  ctx.fillStyle = g;
  const pts = outline.left.concat(outline.right.slice().reverse());
  ctx.beginPath();
  ctx.moveTo(pts[0].x, pts[0].y);
  for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
  ctx.closePath();
  ctx.fill();
}

// Siluetas planas de hoja (polígonos, no puntos redondos), en unidades -1..1
// antes de escalar. Cada instancia se pinta con un ángulo propio aleatorio (ver
// drawLeafCluster) para que no queden todas "de cara" como una calcomanía.
const LEAF_SHAPES_PTS: Record<LeafShape, Array<[number, number]>> = {
  round: [[0, -1], [0.87, -0.5], [0.87, 0.5], [0, 1], [-0.87, 0.5], [-0.87, -0.5]],
  oval: [[0, -1], [0.7, -0.6], [0.9, 0], [0.7, 0.6], [0, 1], [-0.7, 0.6], [-0.9, 0], [-0.7, -0.6]],
  pointed: [[0, -1], [0.55, -0.3], [0.35, 0.6], [0, 1], [-0.35, 0.6], [-0.55, -0.3]],
  needle: [[0, -1], [0.18, 0], [0, 1], [-0.18, 0]],
};

function drawLeafShape(ctx: CanvasRenderingContext2D, shapeKey: LeafShape, x: number, y: number, size: number, angle: number, color: string): void {
  const pts = LEAF_SHAPES_PTS[shapeKey] || LEAF_SHAPES_PTS.oval;
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(angle);
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.moveTo(pts[0][0] * size, pts[0][1] * size);
  for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0] * size, pts[i][1] * size);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

function drawLeafCluster(ctx: CanvasRenderingContext2D, def: TreeDef, rng: () => number, count: number): void {
  const leaves: Array<{ x: number; y: number }> = [];
  let minY = Infinity;
  let maxY = -Infinity;
  for (let k = 0; k < count; k++) {
    const spread = def.height * 0.09 * (0.3 + rng() * 0.8);
    const a2 = rng() * Math.PI * 2;
    const r2 = rng();
    const lx = Math.cos(a2) * spread * r2;
    const ly = Math.sin(a2) * spread * r2 * 0.85;
    leaves.push({ x: lx, y: ly });
    if (ly < minY) minY = ly;
    if (ly > maxY) maxY = ly;
  }
  const dotSize = Math.max(1.6, def.height * 0.02);
  for (const leaf of leaves) {
    const baseExpo = maxY > minY ? 1 - (leaf.y - minY) / (maxY - minY) : 1;
    const expo = Math.max(0, Math.min(1, baseExpo + (rng() - 0.5) * 0.4));
    const color = lerpColor(def.leafColorShade, def.leafColorSun, expo);
    const angle = rng() * Math.PI * 2; // orientación libre, no todas mirando igual
    const size = dotSize * (0.6 + rng() * 0.9);
    drawLeafShape(ctx, def.leafShape, leaf.x, leaf.y, size, angle, color);
  }
}

// Ángulo de una rama respecto a la VERTICAL del tronco (0 = sigue recto hacia
// arriba, PI/2 = horizontal): siempre en ese rango, con distribución triangular
// (media de dos tiradas) que hace comunes los valores intermedios (~45°) y
// raros los dos extremos. La longitud varía según la forma de copa elegida.
function branchGeometry(def: TreeDef, t: number, rng: () => number): { angle: number; length: number } {
  const distFromCenter = Math.abs(t - 0.5) * 2;
  const side = t < 0.5 ? -1 : t > 0.5 ? 1 : rng() < 0.5 ? -1 : 1;
  const widthFactor = def.canopyShape === "wide" ? 1 : def.canopyShape === "triangular" ? 0.6 : 0.85;
  const maxDeviation = (Math.PI / 2) * (0.5 + def.canopyWidth * 0.5) * widthFactor;
  const bias = (rng() + rng()) / 2;
  const deviation = Math.max(0, Math.min(Math.PI / 2, bias * maxDeviation));
  const angle = -Math.PI / 2 + side * deviation;

  let length: number;
  if (def.canopyShape === "triangular") {
    length = def.height * (0.2 + distFromCenter * 0.28) * (0.85 + rng() * 0.3);
  } else if (def.canopyShape === "wide") {
    length = def.height * (0.32 + def.canopyWidth * 0.14) * (0.85 + rng() * 0.3);
  } else {
    length = def.height * (0.3 + rng() * 0.18);
  }
  return { angle, length };
}

// Forma ESTÁTICA del árbol (sin balanceo de viento, que es animación — solo
// `lean`, que es forma fija) alrededor del origen local (0,0) = base del
// tronco. Se llama una única vez por variante, sobre el contexto de un canvas
// descartable: ver getTreeBitmap.
function drawTreeStatic(ctx: CanvasRenderingContext2D, def: TreeDef): void {
  const rng = mulberry32(def.seed);

  ctx.save();
  ctx.rotate(def.lean * 0.4);

  const trunkTopY = -def.height * 0.45;
  const trunkOutline = bentOutline(0, trunkTopY, def.trunkWidth, def.trunkWidth * 0.55, def.trunkTwist, 1.1, def.seed * 0.3, 8);
  fillOutline(ctx, trunkOutline, shade(def.trunkColor, -0.4), shade(def.trunkColor, 0.32));

  const branchCount = Math.max(1, def.branchCount);
  for (let i = 0; i < branchCount; i++) {
    const t = branchCount === 1 ? 0.5 : i / (branchCount - 1);
    const attachFrac = def.branchStartHeight + (1 - def.branchStartHeight) * t;
    const attachY = trunkTopY * attachFrac;
    const { angle, length } = branchGeometry(def, t, rng);
    const ex = Math.cos(angle) * length;
    const ey = Math.sin(angle) * length;

    // Nudo en la unión: un bulto de corteza fijo al tronco donde nace la rama,
    // para que el empalme no sea una línea recta pegada.
    const knotR = def.trunkWidth * (0.24 + rng() * 0.1);
    ctx.beginPath();
    ctx.ellipse(0, attachY, knotR, knotR * 0.8, 0, 0, Math.PI * 2);
    ctx.fillStyle = shade(def.trunkColor, -0.18);
    ctx.fill();

    ctx.save();
    ctx.translate(0, attachY);

    const branchOutline = bentOutline(ex, ey, def.trunkWidth * 0.4, def.trunkWidth * 0.12, def.branchTwist, 1.6, def.seed * 1.7 + i * 2.1, 6);
    fillOutline(ctx, branchOutline, shade(def.trunkColor, -0.3), shade(def.trunkColor, 0.35));

    ctx.translate(ex, ey);

    const splitAngle = 0.25 + def.canopyWidth * 0.9;
    const subLen = length * (0.35 + rng() * 0.2);
    const lengthFrac = Math.min(1, length / def.height);
    const subBranchCount = Math.max(2, Math.round(2 + lengthFrac * 4));
    const dotsPerSub = Math.max(4, Math.round((def.leafCount * 4) / (branchCount * subBranchCount)));

    for (let k = 0; k < subBranchCount; k++) {
      const kt = subBranchCount === 1 ? 0 : (k / (subBranchCount - 1) - 0.5) * 2;
      const sAngle = angle + kt * splitAngle * (0.6 + rng() * 0.5);
      const sx = Math.cos(sAngle) * subLen;
      const sy = Math.sin(sAngle) * subLen;

      ctx.save();
      const subOutline = bentOutline(sx, sy, def.trunkWidth * 0.14, def.trunkWidth * 0.05, def.branchTwist * 0.7, 1.8, def.seed * 3.1 + i * 5 + k, 5);
      fillOutline(ctx, subOutline, shade(def.trunkColor, -0.25), shade(def.trunkColor, 0.3));

      ctx.save();
      ctx.translate(sx, sy);
      drawLeafCluster(ctx, def, rng, dotsPerSub);
      ctx.restore();

      ctx.restore();
    }

    ctx.restore();
  }

  ctx.restore();
}

interface TreeBitmap {
  canvas: HTMLCanvasElement;
  anchorX: number;
  anchorY: number;
}

// Cacheado por "treeDefId:índice de instancia" — no por instancia plantada en
// el mundo. Todas las copias de un mismo árbol en el mismo índice (p.ej. la
// 2ª copia de countPerTile) son geométricamente idénticas estén donde estén,
// así que un bosque con miles de copias solo genera tantos bitmaps como
// (nº de TreeDef distintos) × countPerTile.
const bitmapCache = new Map<string, TreeBitmap>();

function getTreeBitmap(defId: string, instanceIndex: number, instanceDef: TreeDef): TreeBitmap {
  const key = `${defId}:${instanceIndex}`;
  const cached = bitmapCache.get(key);
  if (cached) return cached;

  // Caja generosa: el alcance máximo (rama + sub-rama + hoja) no pasa de
  // ~0.85×height desde la base en ninguna dirección; el margen de sobra
  // absorbe además el `lean` (que solo rota esa extensión, no la agranda).
  const halfW = Math.max(8, instanceDef.height * 1.05);
  const topPad = Math.max(8, instanceDef.height * 1.35);
  const bottomPad = Math.max(4, instanceDef.height * 0.25);

  const canvas = document.createElement("canvas");
  canvas.width = Math.ceil(halfW * 2);
  canvas.height = Math.ceil(topPad + bottomPad);
  const octx = canvas.getContext("2d")!;
  octx.translate(halfW, topPad);
  drawTreeStatic(octx, instanceDef);

  const entry: TreeBitmap = { canvas, anchorX: halfW, anchorY: topPad };
  bitmapCache.set(key, entry);
  return entry;
}

// Balanceo aproximado de TODO el árbol como una sola pieza (no rama a rama):
// mucho más barato que animar cada tramo por separado, y a la distancia/zoom
// habituales del juego se lee igual de bien como "el árbol se mece".
function computeSwayAngle(def: TreeDef, time: number): number {
  const w = (def.windSway / 100) * def.branchFlexibility;
  const windPhase = Math.sin(time * 1.3 + def.seed * 0.7);
  const windFlutter = Math.sin(time * 3.4 + def.seed * 1.9);
  return (windPhase * 0.06 + windFlutter * 0.015) * w;
}

// Posición de cada copia dentro del área tileSpan×tileSpan: usa la guardada en
// def.instanceOffsets si el admin la fijó a mano; si no, la reparte sola de
// forma determinista (la copia 0 en el centro, el resto alrededor).
function resolveInstanceOffsets(def: TreeDef): Array<{ x: number; y: number }> {
  const span = def.tileSpan || 1;
  const bound = 0.5 * span + 0.1;
  const stored = Array.isArray(def.instanceOffsets) ? def.instanceOffsets : [];
  const rng = mulberry32(def.seed * 7 + 3);
  const count = Math.max(1, def.countPerTile);
  const out: Array<{ x: number; y: number }> = [];
  for (let i = 0; i < count; i++) {
    if (stored[i]) {
      out.push({ x: stored[i].x, y: stored[i].y });
      continue;
    }
    let ox = 0;
    let oy = 0;
    if (i > 0) {
      ox = (rng() - 0.5) * 0.7 * span;
      oy = (rng() - 0.5) * 0.5 * span;
    }
    out.push({ x: Math.max(-bound, Math.min(bound, ox)), y: Math.max(-bound * 0.85, Math.min(bound * 0.85, oy)) });
  }
  return out;
}

// Punto de entrada para el juego: dibuja las countPerTile copias de un árbol
// plantado, centradas en (cx,cy) — coordenadas de pantalla ya proyectadas
// (toScreen), igual que el resto de props de scene.ts. Cada copia extra varía
// tamaño/ancho de tronco/nº de ramas a partir del mismo árbol "patrón".
export function drawPlacedTree(ctx: CanvasRenderingContext2D, def: TreeDef, cx: number, cy: number, time: number): void {
  const offsets = resolveInstanceOffsets(def);
  const rng = mulberry32(def.seed * 13 + 5);
  offsets.forEach((o, i) => {
    const instanceDef: TreeDef =
      i === 0
        ? def
        : {
            ...def,
            seed: def.seed + i * 97,
            height: def.height * (0.75 + rng() * 0.3),
            trunkWidth: def.trunkWidth * (0.8 + rng() * 0.35),
            branchCount: Math.max(1, def.branchCount + Math.round((rng() - 0.5) * 3)),
          };
    const bitmap = getTreeBitmap(def.id, i, instanceDef);
    const sway = computeSwayAngle(instanceDef, time);
    ctx.save();
    ctx.translate(cx + o.x * TILE_W, cy + o.y * TILE_H);
    ctx.rotate(sway);
    ctx.drawImage(bitmap.canvas, -bitmap.anchorX, -bitmap.anchorY);
    ctx.restore();
  });
}
