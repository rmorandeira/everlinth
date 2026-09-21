import { TileType, type ScreenData, type MonsterState, type ItemState, type PlayerPublicState } from "@roi/shared";
import { toScreen, TILE_W, TILE_H } from "./iso.js";

export const SCENE_W = 960;
export const SCENE_H = 640;
const ORIGIN = { x: 400, y: 140 };

function project(col: number, row: number): { x: number; y: number } {
  const p = toScreen(col, row);
  return { x: p.x + ORIGIN.x, y: p.y + ORIGIN.y };
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
  const { x: cx, y: cy } = project(x, y);
  diamondPath(ctx, cx, cy, TILE_W, TILE_H);
  ctx.fillStyle = groundColor(tile);
  ctx.fill();
  ctx.strokeStyle = "rgba(0,0,0,0.12)";
  ctx.lineWidth = 1;
  ctx.stroke();

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
  const { x: cx, y: cy } = project(x, y);
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
  const { x: cx, y: cy } = project(x, y);
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
  const { x: cx, y: cy } = project(x, y);
  const w = TILE_W * 0.9;
  const h = 70;
  // Cara izquierda
  ctx.fillStyle = "#c9c9c9";
  ctx.beginPath();
  ctx.moveTo(cx - w / 2, cy);
  ctx.lineTo(cx, cy + TILE_H / 2);
  ctx.lineTo(cx, cy + TILE_H / 2 - h);
  ctx.lineTo(cx - w / 2, cy - h);
  ctx.closePath();
  ctx.fill();
  // Cara derecha
  ctx.fillStyle = "#e8e8e8";
  ctx.beginPath();
  ctx.moveTo(cx + w / 2, cy);
  ctx.lineTo(cx, cy + TILE_H / 2);
  ctx.lineTo(cx, cy + TILE_H / 2 - h);
  ctx.lineTo(cx + w / 2, cy - h);
  ctx.closePath();
  ctx.fill();
  // Tejado
  diamondPath(ctx, cx, cy - h, TILE_W, TILE_H);
  ctx.fillStyle = "#9a9a9a";
  ctx.fill();
  ctx.strokeStyle = "#555";
  ctx.stroke();
  // Ventanas
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
  const { x: cx, y: cy } = project(x, y);
  const bob = Math.sin(time * 4 + seed) * 1.5;
  const baseY = cy + TILE_H / 2 - 2 + bob;
  ctx.fillStyle = "rgba(0,0,0,0.25)";
  ctx.beginPath();
  ctx.ellipse(cx, cy + TILE_H / 2, 10, 4, 0, 0, Math.PI * 2);
  ctx.fill();

  ctx.strokeStyle = color;
  ctx.lineWidth = 3;
  ctx.lineCap = "round";
  // cuerpo
  ctx.beginPath();
  ctx.moveTo(cx, baseY - 4);
  ctx.lineTo(cx, baseY - 20);
  ctx.stroke();
  // cabeza
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.arc(cx, baseY - 25, 5, 0, Math.PI * 2);
  ctx.fill();
  // brazos
  ctx.beginPath();
  ctx.moveTo(cx - 6, baseY - 16);
  ctx.lineTo(cx + 6, baseY - 16);
  ctx.stroke();
  // piernas
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
  const { x: cx, y: cy } = project(x, y);
  const bob = Math.sin(time * 3 + x + y) * 3;
  ctx.fillStyle = "#f5d33c";
  ctx.beginPath();
  ctx.arc(cx, cy + TILE_H / 2 - 10 + bob, 5, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = "#a8860a";
  ctx.stroke();
}

export function renderScene(
  ctx: CanvasRenderingContext2D,
  screen: ScreenData,
  players: PlayerPublicState[],
  you: PlayerPublicState,
  time: number
): void {
  ctx.clearRect(0, 0, SCENE_W, SCENE_H);

  for (let y = 0; y < screen.tiles.length; y++) {
    for (let x = 0; x < screen.tiles[y].length; x++) {
      drawGroundTile(ctx, x, y, screen.tiles[y][x], time);
    }
  }

  type Sprite = { x: number; y: number; draw: () => void };
  const sprites: Sprite[] = [];

  for (let y = 0; y < screen.tiles.length; y++) {
    for (let x = 0; x < screen.tiles[y].length; x++) {
      const tile = screen.tiles[y][x];
      if (tile === TileType.Tree) sprites.push({ x, y, draw: () => drawTree(ctx, x, y, time) });
      else if (tile === TileType.Rock) sprites.push({ x, y, draw: () => drawRock(ctx, x, y) });
      else if (tile === TileType.Building) sprites.push({ x, y, draw: () => drawBuilding(ctx, x, y) });
    }
  }

  for (const item of screen.items) {
    if (item.takenBy) continue;
    sprites.push({ x: item.x, y: item.y, draw: () => drawItem(ctx, item.x, item.y, time) });
  }

  for (const m of screen.monsters) {
    if (!m.alive) continue;
    sprites.push({ x: m.x, y: m.y, draw: () => drawFigure(ctx, m.x, m.y, MONSTER_COLORS[m.kind] ?? "#a33", time, m.x * 7 + m.y, m.kind) });
  }

  for (const p of players) {
    sprites.push({ x: p.x, y: p.y, draw: () => drawFigure(ctx, p.x, p.y, "#3ba0e0", time, p.x * 3 + p.y, p.username) });
  }
  sprites.push({ x: you.x, y: you.y, draw: () => drawFigure(ctx, you.x, you.y, "#f0f0f0", time, you.x * 3 + you.y + 1, you.username) });

  sprites.sort((a, b) => a.x + a.y - (b.x + b.y));
  for (const s of sprites) s.draw();
}
