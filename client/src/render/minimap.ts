// Minimapa (abajo a la izquierda): vista cenital de la sala actual y sus vecinas,
// girada con la cámara para que "arriba" en el minimapa sea "arriba" en pantalla. El fondo (tiles + calles y edificios vectoriales de
// la ciudad) se pinta UNA vez por cambio de sala en un canvas fuera de pantalla; cada
// frame solo se recoloca bajo el jugador y se dibujan encima los puntos (jugador,
// otros jugadores, zombis, monstruos).
import { SCREEN_WIDTH, SCREEN_HEIGHT, TileType, CITY_ROAD_HALF, type ScreenData, type NeighborTiles, type CityData } from "@roi/shared";

const PX_PER_TILE = 2; // resolución del fondo
const VIEW_RADIUS = 55; // tiles visibles desde el centro hasta el borde del minimapa

const TILE_COLORS: Record<number, string> = {
  [TileType.Grass]: "#5c9a4c",
  [TileType.Path]: "#a8966a",
  [TileType.Water]: "#3a72b8",
  [TileType.Tree]: "#3f7a3a",
  [TileType.Rock]: "#7c7c7c",
  [TileType.Building]: "#6a5d52",
  [TileType.Fence]: "#8a6b4a",
  [TileType.Cactus]: "#5f8a3a",
  [TileType.Road]: "#b8b3a7",
  [TileType.Sidewalk]: "#b8b3a7",
};

export interface MinimapDot {
  gx: number; // tiles globales
  gy: number;
  color: string;
  r: number;
}

export interface Minimap {
  update(screen: ScreenData, neighbors: NeighborTiles[]): void;
  /** yaw: el de la cámara, para que el minimapa gire con ella. */
  draw(playerGX: number, playerGY: number, facing: number, dots: MinimapDot[], yaw: number): void;
}

export function createMinimap(canvas: HTMLCanvasElement): Minimap {
  const ctx = canvas.getContext("2d")!;
  const bg = document.createElement("canvas");
  const bgCtx = bg.getContext("2d")!;
  let bgOriginGX = 0; // tile global de la esquina superior-izquierda del fondo
  let bgOriginGY = 0;
  let lastKey = "";

  function update(screen: ScreenData, neighbors: NeighborTiles[]): void {
    const key = `${screen.sx},${screen.sy},${neighbors.length}`;
    if (key === lastKey) return;
    lastKey = key;

    const rooms = [{ sx: screen.sx, sy: screen.sy, tiles: screen.tiles, city: screen.city }, ...neighbors];
    const minSX = Math.min(...rooms.map((r) => r.sx));
    const maxSX = Math.max(...rooms.map((r) => r.sx));
    const minSY = Math.min(...rooms.map((r) => r.sy));
    const maxSY = Math.max(...rooms.map((r) => r.sy));
    bgOriginGX = minSX * SCREEN_WIDTH;
    bgOriginGY = minSY * SCREEN_HEIGHT;
    bg.width = (maxSX - minSX + 1) * SCREEN_WIDTH * PX_PER_TILE;
    bg.height = (maxSY - minSY + 1) * SCREEN_HEIGHT * PX_PER_TILE;
    bgCtx.fillStyle = "#1a1c20";
    bgCtx.fillRect(0, 0, bg.width, bg.height);

    // Tiles (en la ciudad, los edificios se pintan luego como polígonos).
    for (const r of rooms) {
      const ox = (r.sx * SCREEN_WIDTH - bgOriginGX) * PX_PER_TILE;
      const oy = (r.sy * SCREEN_HEIGHT - bgOriginGY) * PX_PER_TILE;
      const urban = r.city !== undefined;
      for (let y = 0; y < r.tiles.length; y++) {
        for (let x = 0; x < r.tiles[y].length; x++) {
          const t = r.tiles[y][x];
          bgCtx.fillStyle = TILE_COLORS[urban && t === TileType.Building ? TileType.Sidewalk : t] ?? "#555";
          bgCtx.fillRect(ox + x * PX_PER_TILE, oy + y * PX_PER_TILE, PX_PER_TILE, PX_PER_TILE);
        }
      }
    }

    // Ciudad vectorial: calles y edificios con su forma real (deduplicados por id).
    const roads = new Map<string, CityData["roads"][number]>();
    const buildings = new Map<string, CityData["buildings"][number]>();
    for (const r of rooms) {
      if (!r.city) continue;
      for (const s of r.city.roads) roads.set(s.id, s);
      for (const b of r.city.buildings) buildings.set(b.id, b);
    }
    const P = (gx: number, gy: number): [number, number] => [(gx - bgOriginGX) * PX_PER_TILE, (gy - bgOriginGY) * PX_PER_TILE];
    bgCtx.lineCap = "round";
    bgCtx.strokeStyle = "#3a3d42";
    for (const s of roads.values()) {
      bgCtx.lineWidth = CITY_ROAD_HALF[s.kind] * 2 * PX_PER_TILE;
      bgCtx.beginPath();
      bgCtx.moveTo(...P(s.x0, s.y0));
      bgCtx.lineTo(...P(s.x1, s.y1));
      bgCtx.stroke();
    }
    for (const b of buildings.values()) {
      const l = Math.min(70, 34 + b.floors * 1.4);
      bgCtx.fillStyle = `hsl(25, 12%, ${l}%)`;
      bgCtx.beginPath();
      b.pts.forEach(([x, y], i) => (i === 0 ? bgCtx.moveTo(...P(x, y)) : bgCtx.lineTo(...P(x, y))));
      bgCtx.closePath();
      bgCtx.fill();
    }
  }

  function draw(playerGX: number, playerGY: number, facing: number, dots: MinimapDot[], yaw: number): void {
    const dpr = window.devicePixelRatio || 1;
    const cssSize = canvas.clientWidth;
    const size = Math.round(cssSize * dpr);
    if (canvas.width !== size) {
      canvas.width = size;
      canvas.height = size;
    }
    const c = size / 2;
    const scale = c / VIEW_RADIUS; // px de minimapa por tile

    ctx.clearRect(0, 0, size, size);
    ctx.save();
    ctx.beginPath();
    ctx.arc(c, c, c - 1, 0, Math.PI * 2);
    ctx.clip();
    ctx.fillStyle = "#1a1c20";
    ctx.fillRect(0, 0, size, size);

    // Mundo → minimapa: centrado en el jugador y girado como la cámara ("arriba"
    // del minimapa = "arriba" en pantalla; con el yaw base de 45° son 45°).
    ctx.translate(c, c);
    ctx.rotate(Math.PI / 2 - yaw);
    ctx.scale(scale, scale);
    ctx.translate(-playerGX, -playerGY);
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(bg, bgOriginGX, bgOriginGY, bg.width / PX_PER_TILE, bg.height / PX_PER_TILE);

    for (const d of dots) {
      ctx.fillStyle = d.color;
      ctx.beginPath();
      ctx.arc(d.gx, d.gy, d.r, 0, Math.PI * 2);
      ctx.fill();
    }

    // Jugador: flecha en la dirección en la que mira (facing = atan2(dx, dz)).
    ctx.translate(playerGX, playerGY);
    ctx.rotate(-facing + Math.PI / 2);
    ctx.fillStyle = "#ffffff";
    ctx.strokeStyle = "#000";
    ctx.lineWidth = 0.6;
    ctx.beginPath();
    ctx.moveTo(3.2, 0);
    ctx.lineTo(-2, 2.2);
    ctx.lineTo(-1, 0);
    ctx.lineTo(-2, -2.2);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.restore();

    // Aro exterior.
    ctx.strokeStyle = "rgba(255,255,255,0.55)";
    ctx.lineWidth = 2 * dpr;
    ctx.beginPath();
    ctx.arc(c, c, c - dpr, 0, Math.PI * 2);
    ctx.stroke();
  }

  return { update, draw };
}
