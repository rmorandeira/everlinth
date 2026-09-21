import express from "express";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { WebSocketServer } from "ws";
import { WORLD_MIN, WORLD_MAX, TileType } from "@roi/shared";
import { GameServer } from "./game.js";
import { listScreenCoords, getScreen } from "./db.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT ? Number(process.env.PORT) : 3000;

const app = express();

// Backoffice: mapa de administración del mundo. Nota MVP: sin autenticación
// todavía; pensado solo para uso local/interno del admin.
app.get("/admin/screens.json", (_req, res) => {
  res.json(listScreenCoords());
});

app.get("/admin/screen/:sx/:sy.json", (req, res) => {
  const sx = Number(req.params.sx);
  const sy = Number(req.params.sy);
  const screen = getScreen(sx, sy);
  if (!screen) {
    res.status(404).json({ error: "not generated" });
    return;
  }
  res.json(screen);
});

const TILE_COLORS: Record<number, string> = {
  [TileType.Grass]: "#b5652b",
  [TileType.Path]: "#c9a06a",
  [TileType.Water]: "#2e6fc4",
  [TileType.Tree]: "#5a3a22",
  [TileType.Rock]: "#8a8a8a",
  [TileType.Building]: "#e8e8e8",
  [TileType.Fence]: "#cfcfcf",
  [TileType.Cactus]: "#4a7d3c",
};

app.get("/admin", (_req, res) => {
  res.send(`<!doctype html>
<html><head><meta charset="utf-8"><title>EVERLINTH — Backoffice del mundo</title>
<style>
  body { margin:0; background:#111; color:#ddd; font-family: monospace; display:flex; height:100vh; }
  #mapWrap { flex:1; overflow:auto; padding:16px; }
  canvas#map { background:#1a1a1a; image-rendering:pixelated; cursor:pointer; }
  #panel { width:320px; border-left:1px solid #333; padding:16px; box-sizing:border-box; }
  #panel h2 { margin-top:0; font-size:16px; color:#4caf6d; }
  #thumb { background:#000; border:1px solid #333; }
  .empty { color:#777; }
  .stat { margin:4px 0; }
  code { color:#f0c419; }
</style>
</head>
<body>
<div id="mapWrap"><canvas id="map"></canvas></div>
<div id="panel">
  <h2>Estancia</h2>
  <div id="info" class="empty">Clica una casilla verde del mapa para ver su miniatura.</div>
  <canvas id="thumb" width="256" height="176" style="display:none;margin-top:10px;"></canvas>
</div>
<script>
  const WORLD_MIN = ${WORLD_MIN};
  const WORLD_MAX = ${WORLD_MAX};
  const WORLD_SIZE = WORLD_MAX - WORLD_MIN + 1;
  const CELL = 4;
  const TILE_COLORS = ${JSON.stringify(TILE_COLORS)};

  const canvas = document.getElementById('map');
  canvas.width = WORLD_SIZE * CELL;
  canvas.height = WORLD_SIZE * CELL;
  const ctx = canvas.getContext('2d');
  const info = document.getElementById('info');
  const thumb = document.getElementById('thumb');
  const thumbCtx = thumb.getContext('2d');

  let discovered = new Map(); // "sx,sy" -> {biome, code}

  function draw() {
    ctx.fillStyle = '#1a1a1a';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = '#4caf6d';
    for (const key of discovered.keys()) {
      const [sx, sy] = key.split(',').map(Number);
      ctx.fillRect((sx - WORLD_MIN) * CELL, (sy - WORLD_MIN) * CELL, CELL, CELL);
    }
  }

  async function refresh() {
    const res = await fetch('/admin/screens.json');
    const rows = await res.json();
    discovered = new Map(rows.map(r => [r.sx + ',' + r.sy, { biome: r.biome, code: r.code }]));
    draw();
  }

  canvas.addEventListener('click', async (ev) => {
    const rect = canvas.getBoundingClientRect();
    const px = Math.floor((ev.clientX - rect.left) * (canvas.width / rect.width) / CELL);
    const py = Math.floor((ev.clientY - rect.top) * (canvas.height / rect.height) / CELL);
    const sx = px + WORLD_MIN;
    const sy = py + WORLD_MIN;
    const key = sx + ',' + sy;
    const meta = discovered.get(key);
    if (!meta) {
      info.className = 'empty';
      info.textContent = 'Estancia (' + sx + ', ' + sy + ') aún no explorada.';
      thumb.style.display = 'none';
      return;
    }
    const res = await fetch('/admin/screen/' + sx + '/' + sy + '.json');
    const screen = await res.json();
    info.className = '';
    info.innerHTML =
      '<div class="stat">Coordenadas: (' + sx + ', ' + sy + ')</div>' +
      '<div class="stat">Bioma: ' + meta.biome + '</div>' +
      '<div class="stat">Código: <code>' + meta.code + '</code></div>' +
      '<div class="stat">Rareza: ' + screen.exoticTier + '</div>' +
      '<div class="stat">Monstruos: ' + screen.monsters.length + ' · Objetos: ' + screen.items.filter(i=>!i.takenBy).length + '</div>';
    drawThumb(screen);
  });

  function drawThumb(screen) {
    thumb.style.display = 'block';
    const tiles = screen.tiles;
    const h = tiles.length, w = tiles[0].length;
    const tw = thumb.width / w, th = thumb.height / h;
    thumbCtx.clearRect(0, 0, thumb.width, thumb.height);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        thumbCtx.fillStyle = TILE_COLORS[tiles[y][x]] || '#333';
        thumbCtx.fillRect(x * tw, y * th, tw + 1, th + 1);
      }
    }
    thumbCtx.fillStyle = '#e05555';
    for (const m of screen.monsters) { if (m.alive) thumbCtx.fillRect(m.x*tw-1, m.y*th-1, 3, 3); }
    thumbCtx.fillStyle = '#f0c419';
    for (const it of screen.items) { if (!it.takenBy) thumbCtx.fillRect(it.x*tw-1, it.y*th-1, 3, 3); }
  }

  refresh();
  setInterval(refresh, 4000);
</script>
</body></html>`);
});

const clientDist = path.join(__dirname, "..", "..", "client", "dist");
app.use(express.static(clientDist));
app.get("*", (_req, res) => {
  res.sendFile(path.join(clientDist, "index.html"));
});

const server = http.createServer(app);
const wss = new WebSocketServer({ server });
const game = new GameServer();

wss.on("connection", (socket) => game.handleConnection(socket));

server.listen(PORT, () => {
  console.log(`EVERLINTH — servidor escuchando en http://localhost:${PORT}`);
  console.log(`Mapa admin en http://localhost:${PORT}/admin`);
});
