import { SCREEN_WIDTH, SCREEN_HEIGHT, TileType, type ScreenData, type PlayerPublicState } from "@roi/shared";
import { toScreen, TILE_W, TILE_H } from "./iso.js";

export interface Layout {
  scale: number;
  originX: number;
  originY: number;
}

// Calcula un layout que encaja TODA la pantalla (16x11) centrada y sin deformar,
// sea cual sea el tamaño/relación de aspecto real de la ventana.
export function computeLayout(width: number, height: number): Layout {
  const marginTop = 130; // hueco para la altura de árboles/edificios
  const marginBottom = 60;
  const marginSide = 40;

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
  const scale = Math.min(width / gridW, height / gridH);
  const originX = width / 2 - scale * ((minX + maxX) / 2);
  const originY = height / 2 - scale * ((minY + maxY) / 2);
  return { scale, originX, originY };
}

function diamondPath(ctx: CanvasRenderingContext2D, cx: number, cy: number, w: number, h: number): void {
  ctx.beginPath();
  ctx.moveTo(cx, cy - h / 2);
  ctx.lineTo(cx + w / 2, cy);
  ctx.lineTo(cx, cy + h / 2);
  ctx.lineTo(cx - w / 2, cy);
  ctx.closePath();
}

// Ruido determinista barato por celda, para texturizar sin necesidad de sprites/imágenes.
function hash2(x: number, y: number): number {
  const h = Math.sin(x * 127.1 + y * 311.7) * 43758.5453;
  return h - Math.floor(h);
}

function groundColor(tile: TileType): string {
  switch (tile) {
    case TileType.Grass:
      return "#3f9a4d";
    case TileType.Path:
      return "#b8a06a";
    case TileType.Water:
      return "#2e6fc4";
    default:
      return "#3f9a4d"; // bajo árboles/rocas/edificios sigue habiendo hierba
  }
}

function drawGroundTile(ctx: CanvasRenderingContext2D, x: number, y: number, tile: TileType, time: number): void {
  const { x: cx, y: cy } = toScreen(x, y);
  // Un pelín más grande que el tile lógico para que no queden costuras/cuadrícula entre celdas.
  diamondPath(ctx, cx, cy, TILE_W + 1, TILE_H + 1);
  ctx.fillStyle = groundColor(tile);
  ctx.fill();

  if (tile === TileType.Water) {
    const shimmer = 0.5 + 0.5 * Math.sin(time * 2 + x * 0.7 + y * 0.5);
    ctx.strokeStyle = `rgba(255,255,255,${0.15 + shimmer * 0.15})`;
    ctx.beginPath();
    ctx.moveTo(cx - TILE_W / 4, cy);
    ctx.lineTo(cx + TILE_W / 4, cy);
    ctx.stroke();
  } else if (tile === TileType.Grass) {
    // Mota de textura + pequeños matojos de hierba con micro-animación de balanceo.
    const n = hash2(x, y);
    if (n > 0.55) {
      const sway = Math.sin(time * 2.2 + x * 1.3 + y * 0.9) * 2;
      ctx.strokeStyle = "#2f7a3c";
      ctx.lineWidth = 2;
      for (let i = -1; i <= 1; i++) {
        ctx.beginPath();
        ctx.moveTo(cx + i * 4, cy + 4);
        ctx.lineTo(cx + i * 4 + sway, cy - 6);
        ctx.stroke();
      }
    }
  }
}

function drawTree(ctx: CanvasRenderingContext2D, x: number, y: number, time: number): void {
  const { x: cx, y: cy } = toScreen(x, y);
  const sway = Math.sin(time * 1.4 + x * 2.1 + y * 1.7) * 3;
  ctx.fillStyle = "#5a3a22";
  ctx.fillRect(cx - 3, cy - 14, 6, 16);
  ctx.fillStyle = "#276b34";
  ctx.beginPath();
  ctx.moveTo(cx + sway, cy - 52);
  ctx.lineTo(cx + 22, cy - 16);
  ctx.lineTo(cx - 22, cy - 16);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = "#33823f";
  ctx.beginPath();
  ctx.moveTo(cx + sway * 0.7, cy - 40);
  ctx.lineTo(cx + 15, cy - 20);
  ctx.lineTo(cx - 15, cy - 20);
  ctx.closePath();
  ctx.fill();
}

function drawRock(ctx: CanvasRenderingContext2D, x: number, y: number): void {
  const { x: cx, y: cy } = toScreen(x, y);
  ctx.fillStyle = "#8a8a8a";
  ctx.beginPath();
  ctx.moveTo(cx - 14, cy);
  ctx.lineTo(cx - 6, cy - 14);
  ctx.lineTo(cx + 10, cy - 12);
  ctx.lineTo(cx + 14, cy);
  ctx.lineTo(cx, cy + 6);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = "#5f5f5f";
  ctx.stroke();
}

function drawBuilding(ctx: CanvasRenderingContext2D, x: number, y: number): void {
  const { x: cx, y: cy } = toScreen(x, y);
  const w = TILE_W * 0.9;
  const h = 70;
  ctx.fillStyle = "#c9c9c9";
  ctx.beginPath();
  ctx.moveTo(cx - w / 2, cy);
  ctx.lineTo(cx, cy + TILE_H / 2);
  ctx.lineTo(cx, cy + TILE_H / 2 - h);
  ctx.lineTo(cx - w / 2, cy - h);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = "#e8e8e8";
  ctx.beginPath();
  ctx.moveTo(cx + w / 2, cy);
  ctx.lineTo(cx, cy + TILE_H / 2);
  ctx.lineTo(cx, cy + TILE_H / 2 - h);
  ctx.lineTo(cx + w / 2, cy - h);
  ctx.closePath();
  ctx.fill();
  diamondPath(ctx, cx, cy - h, TILE_W, TILE_H);
  ctx.fillStyle = "#9a9a9a";
  ctx.fill();
  ctx.strokeStyle = "#555";
  ctx.stroke();
  ctx.fillStyle = "#222";
  ctx.fillRect(cx - w / 2 + 6, cy - h * 0.55, 6, 10);
  ctx.fillRect(cx + w / 2 - 12, cy - h * 0.55, 6, 10);
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

function drawItem(ctx: CanvasRenderingContext2D, x: number, y: number, time: number): void {
  const { x: cx, y: cy } = toScreen(x, y);
  const bob = Math.sin(time * 3 + x + y) * 3;
  ctx.fillStyle = "#f5d33c";
  ctx.beginPath();
  ctx.arc(cx, cy + TILE_H / 2 - 10 + bob, 5, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = "#a8860a";
  ctx.stroke();
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
  screen: ScreenData,
  players: Array<PlayerPublicState & EntityDrawPos>,
  you: PlayerPublicState & EntityDrawPos,
  time: number
): void {
  ctx.save();
  ctx.clearRect(0, 0, canvasWidth, canvasHeight);
  ctx.setTransform(layout.scale, 0, 0, layout.scale, layout.originX, layout.originY);

  for (let y = 0; y < screen.tiles.length; y++) {
    for (let x = 0; x < screen.tiles[y].length; x++) {
      drawGroundTile(ctx, x, y, screen.tiles[y][x], time);
    }
  }

  type Sprite = { depth: number; draw: () => void };
  const sprites: Sprite[] = [];

  for (let y = 0; y < screen.tiles.length; y++) {
    for (let x = 0; x < screen.tiles[y].length; x++) {
      const tile = screen.tiles[y][x];
      if (tile === TileType.Tree) sprites.push({ depth: x + y, draw: () => drawTree(ctx, x, y, time) });
      else if (tile === TileType.Rock) sprites.push({ depth: x + y, draw: () => drawRock(ctx, x, y) });
      else if (tile === TileType.Building) sprites.push({ depth: x + y, draw: () => drawBuilding(ctx, x, y) });
    }
  }

  for (const item of screen.items) {
    if (item.takenBy) continue;
    sprites.push({ depth: item.x + item.y, draw: () => drawItem(ctx, item.x, item.y, time) });
  }

  for (const m of screen.monsters) {
    if (!m.alive) continue;
    sprites.push({ depth: m.x + m.y, draw: () => drawFigure(ctx, m.x, m.y, MONSTER_COLORS[m.kind] ?? "#a33", time, m.x * 7 + m.y, m.kind) });
  }

  for (const p of players) {
    sprites.push({ depth: p.x + p.y, draw: () => drawFigure(ctx, p.x, p.y, "#3ba0e0", time, p.x * 3 + p.y, p.username) });
  }
  sprites.push({ depth: you.x + you.y, draw: () => drawFigure(ctx, you.x, you.y, "#f0f0f0", time, you.x * 3 + you.y + 1, you.username) });

  sprites.sort((a, b) => a.depth - b.depth);
  for (const s of sprites) s.draw();

  ctx.restore();
}
