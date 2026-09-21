import { SCREEN_WIDTH, SCREEN_HEIGHT, TileType, type ScreenData, type PlayerPublicState } from "@roi/shared";
import { toScreen, TILE_W, TILE_H } from "./iso.js";
import { drawSprite, type Sprite, type SpriteKey } from "./tileset.js";

export interface Layout {
  scale: number;
  originX: number;
  originY: number;
}

export type Tileset = Record<SpriteKey, Sprite>;

// Calcula un layout que encaja TODA la pantalla (16x11) centrada y sin deformar,
// sea cual sea el tamaño/relación de aspecto real de la ventana.
export function computeLayout(width: number, height: number): Layout {
  const marginTop = 80; // hueco para la altura de árboles/edificios
  const marginBottom = 24;
  const marginSide = 12;
  const overscan = 1.1; // usa más superficie de pantalla; solo recorta el margen decorativo, nunca la rejilla jugable

  const corners = [
    toScreen(0, 0),
    toScreen(SCREEN_WIDTH - 1, 0),
    toScreen(0, SCREEN_HEIGHT - 1),
    toScreen(SCREEN_WIDTH - 1, SCREEN_HEIGHT - 1),
  ];
  const minX = Math.min(...corners.map((p) => p.x)) - TILE_W / 2 - marginSide;
  const maxX = Math.max(...corners.map((p) => p.x)) + TILE_W / 2 + marginSide;
  const minY = Math.min(...corners.map((p) => p.y)) - marginTop;
  const maxY = Math.max(...corners.map((p) => p.y)) + TILE_H / 2 + marginBottom;

  const gridW = maxX - minX;
  const gridH = maxY - minY;
  const scale = Math.min(width / gridW, height / gridH) * overscan;
  const originX = width / 2 - scale * ((minX + maxX) / 2);
  const originY = height / 2 - scale * ((minY + maxY) / 2);
  return { scale, originX, originY };
}

// Ruido determinista barato por celda, para elegir variante de sprite y texturizar.
function hash2(x: number, y: number): number {
  const h = Math.sin(x * 127.1 + y * 311.7) * 43758.5453;
  return h - Math.floor(h);
}

const GRASS_VARIANTS: SpriteKey[] = ["grass1", "grass2", "grass3"];
const WATER_VARIANTS: SpriteKey[] = ["water1", "water2"];
const ROCK_VARIANTS: SpriteKey[] = ["rock1", "rock2"];
const TREE_VARIANTS: SpriteKey[] = ["tree", "tree2"];

function pick<T>(arr: T[], n: number): T {
  return arr[Math.floor(n * arr.length) % arr.length];
}

function drawGroundTile(ctx: CanvasRenderingContext2D, tiles: Tileset, x: number, y: number, tile: TileType, time: number): void {
  const { x: cx, y: cy } = toScreen(x, y);
  const n = hash2(x, y);

  let key: SpriteKey;
  if (tile === TileType.Water) key = pick(WATER_VARIANTS, n);
  else if (tile === TileType.Path) key = "dirt";
  else key = pick(GRASS_VARIANTS, n);

  drawSprite(ctx, tiles[key], cx, cy);

  if (tile === TileType.Water) {
    const shimmer = 0.5 + 0.5 * Math.sin(time * 2 + x * 0.7 + y * 0.5);
    ctx.strokeStyle = `rgba(255,255,255,${0.15 + shimmer * 0.15})`;
    ctx.beginPath();
    ctx.moveTo(cx - TILE_W / 4, cy);
    ctx.lineTo(cx + TILE_W / 4, cy);
    ctx.stroke();
  } else if (tile === TileType.Grass && n > 0.8) {
    // Matojo de hierba con micro-animación de balanceo, sobre la textura base.
    const sway = Math.sin(time * 2.2 + x * 1.3 + y * 0.9) * 2;
    ctx.strokeStyle = "#2f7a3c";
    ctx.lineWidth = 2;
    for (let i = -1; i <= 1; i++) {
      ctx.beginPath();
      ctx.moveTo(cx + i * 4, cy + 4);
      ctx.lineTo(cx + i * 4 + sway, cy - 6);
      ctx.stroke();
    }
  } else if (tile === TileType.Grass && n > 0.65 && n <= 0.8) {
    drawSprite(ctx, tiles.bush, cx, cy + TILE_H / 2 - 6);
  }
}

function drawTree(ctx: CanvasRenderingContext2D, tiles: Tileset, x: number, y: number, time: number): void {
  const { x: cx, y: cy } = toScreen(x, y);
  const key = pick(TREE_VARIANTS, hash2(x + 0.25, y + 0.25));
  // Balanceo sutil: rota todo el árbol alrededor de su base (micro-animación).
  const angle = Math.sin(time * 1.4 + x * 2.1 + y * 1.7) * 0.035;
  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate(angle);
  drawSprite(ctx, tiles[key], 0, 0);
  ctx.restore();
}

function drawFence(ctx: CanvasRenderingContext2D, tiles: Tileset, x: number, y: number): void {
  const { x: cx, y: cy } = toScreen(x, y);
  drawSprite(ctx, tiles.fence, cx, cy);
}

function drawRock(ctx: CanvasRenderingContext2D, tiles: Tileset, x: number, y: number): void {
  const { x: cx, y: cy } = toScreen(x, y);
  const key = pick(ROCK_VARIANTS, hash2(x + 0.5, y + 0.5));
  drawSprite(ctx, tiles[key], cx, cy + TILE_H / 2 - 4);
}

function drawBuilding(ctx: CanvasRenderingContext2D, tiles: Tileset, x: number, y: number): void {
  const { x: cx, y: cy } = toScreen(x, y);
  drawSprite(ctx, tiles.building, cx, cy + TILE_H / 2);
}

const MONSTER_COLORS: Record<string, string> = {
  rat: "#8a6b4f",
  goblin: "#5fa04a",
  wolf: "#777",
  ogre: "#7a4a4a",
};

function drawFigure(ctx: CanvasRenderingContext2D, x: number, y: number, color: string, time: number, seed: number, label?: string): void {
  const { x: cx, y: cy } = toScreen(x, y);
  const bob = Math.sin(time * 4 + seed) * 1.5;
  const baseY = cy + TILE_H / 2 - 2 + bob;
  ctx.fillStyle = "rgba(0,0,0,0.25)";
  ctx.beginPath();
  ctx.ellipse(cx, cy + TILE_H / 2, 10, 4, 0, 0, Math.PI * 2);
  ctx.fill();

  ctx.strokeStyle = color;
  ctx.lineWidth = 3;
  ctx.lineCap = "round";
  ctx.beginPath();
  ctx.moveTo(cx, baseY - 4);
  ctx.lineTo(cx, baseY - 20);
  ctx.stroke();
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.arc(cx, baseY - 25, 5, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.moveTo(cx - 6, baseY - 16);
  ctx.lineTo(cx + 6, baseY - 16);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(cx, baseY - 4);
  ctx.lineTo(cx - 5, baseY + 4);
  ctx.moveTo(cx, baseY - 4);
  ctx.lineTo(cx + 5, baseY + 4);
  ctx.stroke();

  if (label) {
    ctx.fillStyle = "#fff";
    ctx.font = "10px monospace";
    ctx.textAlign = "center";
    ctx.fillText(label, cx, baseY - 32);
  }
}

function drawItem(ctx: CanvasRenderingContext2D, tiles: Tileset, x: number, y: number, time: number): void {
  const { x: cx, y: cy } = toScreen(x, y);
  const bob = Math.sin(time * 3 + x + y) * 3;
  drawSprite(ctx, tiles.coin, cx, cy + TILE_H / 2 - 10 + bob);
}

export interface EntityDrawPos {
  x: number;
  y: number;
}

export function renderScene(
  ctx: CanvasRenderingContext2D,
  canvasWidth: number,
  canvasHeight: number,
  layout: Layout,
  tiles: Tileset,
  screen: ScreenData,
  players: Array<PlayerPublicState & EntityDrawPos>,
  you: PlayerPublicState & EntityDrawPos,
  time: number
): void {
  ctx.save();
  ctx.clearRect(0, 0, canvasWidth, canvasHeight);
  ctx.setTransform(layout.scale, 0, 0, layout.scale, layout.originX, layout.originY);

  // El terreno se extiende más allá de la sala jugable (solo hierba decorativa, sin
  // colisión ni entidades) para que el paisaje llegue hasta los bordes de la pantalla,
  // sin bandas negras, sea cual sea la relación de aspecto de la ventana.
  const EDGE_PAD = 18;
  for (let y = -EDGE_PAD; y < SCREEN_HEIGHT + EDGE_PAD; y++) {
    for (let x = -EDGE_PAD; x < SCREEN_WIDTH + EDGE_PAD; x++) {
      const inBounds = y >= 0 && y < screen.tiles.length && x >= 0 && x < screen.tiles[0].length;
      const tile = inBounds ? screen.tiles[y][x] : TileType.Grass;
      drawGroundTile(ctx, tiles, x, y, tile, time);
    }
  }

  type Drawable = { depth: number; draw: () => void };
  const drawables: Drawable[] = [];

  for (let y = 0; y < screen.tiles.length; y++) {
    for (let x = 0; x < screen.tiles[y].length; x++) {
      const tile = screen.tiles[y][x];
      if (tile === TileType.Tree) drawables.push({ depth: x + y, draw: () => drawTree(ctx, tiles, x, y, time) });
      else if (tile === TileType.Rock) drawables.push({ depth: x + y, draw: () => drawRock(ctx, tiles, x, y) });
      else if (tile === TileType.Building) drawables.push({ depth: x + y, draw: () => drawBuilding(ctx, tiles, x, y) });
      else if (tile === TileType.Fence) drawables.push({ depth: x + y, draw: () => drawFence(ctx, tiles, x, y) });
    }
  }

  for (const item of screen.items) {
    if (item.takenBy) continue;
    drawables.push({ depth: item.x + item.y, draw: () => drawItem(ctx, tiles, item.x, item.y, time) });
  }

  for (const m of screen.monsters) {
    if (!m.alive) continue;
    drawables.push({ depth: m.x + m.y, draw: () => drawFigure(ctx, m.x, m.y, MONSTER_COLORS[m.kind] ?? "#a33", time, m.x * 7 + m.y, m.kind) });
  }

  for (const p of players) {
    drawables.push({ depth: p.x + p.y, draw: () => drawFigure(ctx, p.x, p.y, "#3ba0e0", time, p.x * 3 + p.y, p.username) });
  }
  drawables.push({ depth: you.x + you.y, draw: () => drawFigure(ctx, you.x, you.y, "#f0f0f0", time, you.x * 3 + you.y + 1, you.username) });

  drawables.sort((a, b) => a.depth - b.depth);
  for (const d of drawables) d.draw();

  ctx.restore();
}
