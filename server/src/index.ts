import express from "express";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { WebSocketServer } from "ws";
import { WORLD_MIN, WORLD_MAX, TileType, BIOME_CATALOG, BIOME_IDS, type BiomeId } from "@roi/shared";
import { GameServer } from "./game.js";
import { listScreenCoords, getScreen, listPaint, paintCells, unpaintCells, deleteScreens } from "./db.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT ? Number(process.env.PORT) : 3000;

const app = express();
app.use(express.json());

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

// ---- Terreno decretado (spraybrush del super admin) ----

function parseCells(body: unknown): Array<{ sx: number; sy: number }> | null {
  const cells = (body as { cells?: unknown })?.cells;
  if (!Array.isArray(cells) || cells.length === 0) return null;
  const out: Array<{ sx: number; sy: number }> = [];
  for (const c of cells) {
    const sx = Number((c as { sx?: unknown })?.sx);
    const sy = Number((c as { sy?: unknown })?.sy);
    if (!Number.isInteger(sx) || !Number.isInteger(sy)) return null;
    out.push({ sx, sy });
  }
  return out;
}

app.get("/admin/paint.json", (_req, res) => {
  res.json(listPaint());
});

app.post("/admin/paint", (req, res) => {
  const cells = parseCells(req.body);
  const biome = (req.body as { biome?: unknown })?.biome as BiomeId | undefined;
  if (!cells || !biome || !BIOME_IDS.includes(biome)) {
    res.status(400).json({ error: "invalid body" });
    return;
  }
  paintCells(cells, biome);
  res.json({ painted: cells.length });
});

app.post("/admin/unpaint", (req, res) => {
  const cells = parseCells(req.body);
  if (!cells) {
    res.status(400).json({ error: "invalid body" });
    return;
  }
  unpaintCells(cells);
  res.json({ unpainted: cells.length });
});

// Solo afecta a estancias YA generadas (nunca a lo que aún no existe): borrar
// aquí las obliga a regenerarse desde cero la próxima vez que alguien las visite,
// con el terreno pintado que haya en ese momento.
app.post("/admin/delete-screens", (req, res) => {
  const cells = parseCells(req.body);
  if (!cells) {
    res.status(400).json({ error: "invalid body" });
    return;
  }
  const deleted = deleteScreens(cells);
  res.json({ deleted });
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
  #mapWrap { flex:1; overflow:auto; padding:16px; position:relative; }
  canvas#map { background:#1a1a1a; image-rendering:pixelated; cursor:pointer; display:block; }
  #panel { width:320px; border-left:1px solid #333; padding:16px; box-sizing:border-box; overflow-y:auto; }
  #panel h2 { margin-top:0; font-size:16px; color:#4caf6d; }
  #thumb { background:#000; border:1px solid #333; }
  .empty { color:#777; }
  .stat { margin:4px 0; }
  code { color:#f0c419; }
  #zoomBar { position:sticky; top:0; left:0; z-index:2; display:inline-flex; align-items:center; gap:6px; background:#111; padding:4px; border:1px solid #333; margin-bottom:8px; }
  #zoomBar button { background:#222; color:#ddd; border:1px solid #444; width:26px; height:26px; cursor:pointer; font-family:inherit; }
  #zoomBar button:hover { background:#333; }
  #zoomLabel { font-size:12px; color:#999; min-width:70px; }
  #navHint { font-size:11px; color:#666; margin-left:8px; }
  #terrainPanel { margin-top:24px; padding-top:16px; border-top:1px solid #333; }
  .swatch { display:inline-block; width:28px; height:28px; margin:2px; border:2px solid transparent; cursor:pointer; box-sizing:border-box; border-radius:3px; }
  .swatch.active { border-color:#fff; }
  #terrainPanel label { display:block; margin:3px 0; cursor:pointer; }
  #terrainPanel input[type=range] { vertical-align:middle; }
  #minimapWrap { position:sticky; bottom:0; left:0; z-index:2; display:inline-block; background:#111; border:1px solid #444; padding:4px; margin-top:8px; }
  #minimap { display:block; background:#1a1a1a; cursor:crosshair; image-rendering:pixelated; }

  /* Barras de scroll a juego con el resto del backoffice (Chromium/Electron). */
  #mapWrap, #panel { scrollbar-width: thin; scrollbar-color: #3a3a3a #111; }
  #mapWrap::-webkit-scrollbar, #panel::-webkit-scrollbar { width: 12px; height: 12px; }
  #mapWrap::-webkit-scrollbar-track, #panel::-webkit-scrollbar-track { background: #111; }
  #mapWrap::-webkit-scrollbar-thumb, #panel::-webkit-scrollbar-thumb { background: #333; border: 2px solid #111; border-radius: 6px; }
  #mapWrap::-webkit-scrollbar-thumb:hover, #panel::-webkit-scrollbar-thumb:hover { background: #4caf6d; }
  #mapWrap::-webkit-scrollbar-corner, #panel::-webkit-scrollbar-corner { background: #111; }
</style>
</head>
<body>
<div id="mapWrap">
  <div id="zoomBar">
    <button id="zoomOut">−</button>
    <button id="zoomIn">+</button>
    <span id="zoomLabel"></span>
    <span id="navHint">scroll: mover · shift+scroll: mover lateral · ctrl+scroll: zoom · espacio+arrastrar: mover</span>
  </div>
  <canvas id="map"></canvas>
  <div id="minimapWrap"><canvas id="minimap" width="180" height="180"></canvas></div>
</div>
<div id="panel">
  <h2>Estancia</h2>
  <div id="info" class="empty">Clica una casilla verde fosforito del mapa (o del minimapa) para ver su miniatura.</div>
  <canvas id="thumb" width="256" height="176" style="display:none;margin-top:10px;"></canvas>

  <div id="terrainPanel">
    <h2>Terreno (super admin)</h2>
    <div id="biomePalette"></div>
    <div class="stat">Pincel: <input id="brushSize" type="range" min="0" max="6" value="2"> <span id="brushSizeLabel"></span></div>
    <div class="stat" style="margin-top:8px;">
      <label><input type="radio" name="mode" value="inspect" checked> Inspeccionar</label>
      <label><input type="radio" name="mode" value="paint"> Pintar bioma decretado</label>
      <label><input type="radio" name="mode" value="unpaint"> Quitar decreto</label>
      <label><input type="radio" name="mode" value="delete"> Borrar estancia ya generada</label>
    </div>
  </div>
</div>
<script>
  const WORLD_MIN = ${WORLD_MIN};
  const WORLD_MAX = ${WORLD_MAX};
  const WORLD_SIZE = WORLD_MAX - WORLD_MIN + 1;
  const MIN_CELL = 1, MAX_CELL = 40;
  let cell = 4;
  const TILE_COLORS = ${JSON.stringify(TILE_COLORS)};
  const BIOMES = ${JSON.stringify(BIOME_IDS.map((id) => ({ id, label: BIOME_CATALOG[id].label, color: BIOME_CATALOG[id].debugColor })))};

  const mapWrap = document.getElementById('mapWrap');
  const canvas = document.getElementById('map');
  const ctx = canvas.getContext('2d');
  const info = document.getElementById('info');
  const thumb = document.getElementById('thumb');
  const thumbCtx = thumb.getContext('2d');
  const zoomLabel = document.getElementById('zoomLabel');
  const minimap = document.getElementById('minimap');
  const minimapCtx = minimap.getContext('2d');
  const EXPLORED_COLOR = '#39ff14'; // verde fosforito: siempre distingue lo ya explorado

  let discovered = new Map(); // "sx,sy" -> {biome, code}
  let painted = new Map(); // "sx,sy" -> biome id

  // ---- Panel de terreno: paleta, pincel, modo ----
  let activeBiome = BIOMES[0].id;
  let brushRadius = 2;
  let mode = 'inspect'; // 'inspect' | 'paint' | 'unpaint' | 'delete'

  const biomePaletteEl = document.getElementById('biomePalette');
  for (const b of BIOMES) {
    const sw = document.createElement('span');
    sw.className = 'swatch' + (b.id === activeBiome ? ' active' : '');
    sw.style.background = b.color;
    sw.title = b.label;
    sw.addEventListener('click', () => {
      activeBiome = b.id;
      for (const el of biomePaletteEl.children) el.classList.remove('active');
      sw.classList.add('active');
    });
    biomePaletteEl.appendChild(sw);
  }

  const brushSizeInput = document.getElementById('brushSize');
  const brushSizeLabel = document.getElementById('brushSizeLabel');
  function updateBrushLabel() { brushSizeLabel.textContent = brushRadius + ' estancias de radio'; }
  brushSizeInput.addEventListener('input', () => { brushRadius = Number(brushSizeInput.value); updateBrushLabel(); });
  updateBrushLabel();

  for (const radio of document.querySelectorAll('input[name=mode]')) {
    radio.addEventListener('change', (ev) => { mode = ev.target.value; });
  }

  function cellsInBrush(sx, sy) {
    const out = [];
    for (let dy = -brushRadius; dy <= brushRadius; dy++) {
      for (let dx = -brushRadius; dx <= brushRadius; dx++) {
        if (Math.hypot(dx, dy) > brushRadius) continue;
        out.push({ sx: sx + dx, sy: sy + dy });
      }
    }
    return out;
  }

  async function refreshPaint() {
    const res = await fetch('/admin/paint.json');
    const rows = await res.json();
    painted = new Map(rows.map(r => [r.sx + ',' + r.sy, r.biome]));
    draw();
  }

  function resizeCanvas() {
    canvas.width = WORLD_SIZE * cell;
    canvas.height = WORLD_SIZE * cell;
    zoomLabel.textContent = cell.toFixed(1) + ' px/estancia';
  }

  function biomeColor(id) {
    const b = BIOMES.find(x => x.id === id);
    return b ? b.color : '#888';
  }

  function draw() {
    ctx.fillStyle = '#1a1a1a';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // Terreno decretado por el super admin: color de fondo del bioma pintado.
    for (const [key, biome] of painted) {
      const [sx, sy] = key.split(',').map(Number);
      ctx.fillStyle = biomeColor(biome);
      ctx.fillRect((sx - WORLD_MIN) * cell, (sy - WORLD_MIN) * cell, cell, cell);
    }

    // Estancias ya exploradas: siempre en verde fosforito, para que se distingan
    // del resto pase lo que pase. Si además hay un bioma decretado debajo, se ve
    // como un marco verde fosforito sobre ese color (en vez de tapar el color).
    ctx.fillStyle = EXPLORED_COLOR;
    const markSize = Math.max(2, cell * 0.55);
    for (const key of discovered.keys()) {
      const [sx, sy] = key.split(',').map(Number);
      const cx = (sx - WORLD_MIN) * cell;
      const cy = (sy - WORLD_MIN) * cell;
      if (painted.has(key)) {
        // Ya tiene el color del bioma decretado de fondo: solo una marca en la
        // esquina, del tamaño de la celda actual (no un pixel fijo), para que se
        // vea "descubierta" sin tapar el color pintado.
        ctx.fillRect(cx + cell - markSize, cy, markSize, markSize);
      } else {
        ctx.fillRect(cx, cy, cell, cell);
      }
    }

    // Vista previa del pincel mientras se pinta/borra.
    if (brushPreview.size > 0) {
      ctx.globalAlpha = 0.55;
      ctx.fillStyle = mode === 'delete' ? '#ff5050' : mode === 'unpaint' ? '#ffffff' : biomeColor(activeBiome);
      for (const key of brushPreview) {
        const [sx, sy] = key.split(',').map(Number);
        ctx.fillRect((sx - WORLD_MIN) * cell, (sy - WORLD_MIN) * cell, cell, cell);
      }
      ctx.globalAlpha = 1;
    }

    // Cruce de referencia en el origen (0,0), para orientarse en el mundo.
    ctx.strokeStyle = 'rgba(255,255,255,0.25)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo((0 - WORLD_MIN) * cell, 0);
    ctx.lineTo((0 - WORLD_MIN) * cell, canvas.height);
    ctx.moveTo(0, (0 - WORLD_MIN) * cell);
    ctx.lineTo(canvas.width, (0 - WORLD_MIN) * cell);
    ctx.stroke();
    // Cuadrícula: solo se pinta si hay hueco suficiente para que se vea limpia.
    if (cell >= 6) {
      ctx.strokeStyle = 'rgba(255,255,255,0.08)';
      ctx.beginPath();
      for (let i = 0; i <= WORLD_SIZE; i++) {
        ctx.moveTo(i * cell, 0);
        ctx.lineTo(i * cell, canvas.height);
        ctx.moveTo(0, i * cell);
        ctx.lineTo(canvas.width, i * cell);
      }
      ctx.stroke();
    }

    drawMinimap();
  }

  // Minimapa del mundo completo: siempre muestra las 400x400 estancias enteras,
  // con un recuadro indicando qué parte se ve ahora mismo en el mapa grande.
  // Clicar en un punto centra el mapa grande ahí.
  function drawMinimap() {
    const mcell = minimap.width / WORLD_SIZE;
    minimapCtx.fillStyle = '#1a1a1a';
    minimapCtx.fillRect(0, 0, minimap.width, minimap.height);

    for (const [key, biome] of painted) {
      const [sx, sy] = key.split(',').map(Number);
      minimapCtx.fillStyle = biomeColor(biome);
      minimapCtx.fillRect((sx - WORLD_MIN) * mcell, (sy - WORLD_MIN) * mcell, Math.max(1, mcell), Math.max(1, mcell));
    }
    minimapCtx.fillStyle = EXPLORED_COLOR;
    for (const key of discovered.keys()) {
      const [sx, sy] = key.split(',').map(Number);
      minimapCtx.fillRect((sx - WORLD_MIN) * mcell, (sy - WORLD_MIN) * mcell, Math.max(1, mcell), Math.max(1, mcell));
    }

    // Recuadro de viewport: qué parte del mundo se ve ahora en el mapa grande.
    minimapCtx.strokeStyle = '#fff';
    minimapCtx.lineWidth = 1;
    const vx = (mapWrap.scrollLeft / cell) * mcell;
    const vy = (mapWrap.scrollTop / cell) * mcell;
    const vw = (mapWrap.clientWidth / cell) * mcell;
    const vh = (mapWrap.clientHeight / cell) * mcell;
    minimapCtx.strokeRect(vx, vy, vw, vh);
  }

  function jumpFromMinimap(ev) {
    const rect = minimap.getBoundingClientRect();
    const mcell = minimap.width / WORLD_SIZE;
    const mx = (ev.clientX - rect.left) * (minimap.width / rect.width) / mcell;
    const my = (ev.clientY - rect.top) * (minimap.height / rect.height) / mcell;
    mapWrap.scrollLeft = mx * cell - mapWrap.clientWidth / 2;
    mapWrap.scrollTop = my * cell - mapWrap.clientHeight / 2;
    drawMinimap();
  }

  // Clicar salta ahí; clicar y arrastrar va moviendo la vista en vivo mientras se arrastra.
  let minimapDragging = false;
  minimap.addEventListener('mousedown', (ev) => {
    minimapDragging = true;
    jumpFromMinimap(ev);
  });
  window.addEventListener('mousemove', (ev) => {
    if (!minimapDragging) return;
    jumpFromMinimap(ev);
  });
  window.addEventListener('mouseup', () => { minimapDragging = false; });

  mapWrap.addEventListener('scroll', () => drawMinimap());

  function zoomAt(clientX, clientY, factor) {
    const rect = mapWrap.getBoundingClientRect();
    const localX = clientX - rect.left + mapWrap.scrollLeft;
    const localY = clientY - rect.top + mapWrap.scrollTop;
    const worldX = localX / cell;
    const worldY = localY / cell;
    cell = Math.min(MAX_CELL, Math.max(MIN_CELL, cell * factor));
    resizeCanvas();
    draw();
    mapWrap.scrollLeft = worldX * cell - (clientX - rect.left);
    mapWrap.scrollTop = worldY * cell - (clientY - rect.top);
  }

  // Navegación: scroll = mover vertical, shift+scroll = mover lateral,
  // ctrl+scroll = zoom, espacio+clic+arrastrar = mover (como una mano de agarre).
  mapWrap.addEventListener('wheel', (ev) => {
    if (ev.ctrlKey) {
      ev.preventDefault();
      zoomAt(ev.clientX, ev.clientY, ev.deltaY < 0 ? 1.15 : 1 / 1.15);
    } else if (ev.shiftKey) {
      ev.preventDefault();
      mapWrap.scrollLeft += ev.deltaY;
    }
    // scroll normal (sin modificadores): se deja el comportamiento nativo del navegador.
  }, { passive: false });

  document.getElementById('zoomIn').addEventListener('click', () => {
    const r = mapWrap.getBoundingClientRect();
    zoomAt(r.left + r.width / 2, r.top + r.height / 2, 1.4);
  });
  document.getElementById('zoomOut').addEventListener('click', () => {
    const r = mapWrap.getBoundingClientRect();
    zoomAt(r.left + r.width / 2, r.top + r.height / 2, 1 / 1.4);
  });

  let spaceDown = false;
  window.addEventListener('keydown', (ev) => {
    if (ev.code === 'Space' && !ev.repeat) {
      spaceDown = true;
      mapWrap.style.cursor = 'grab';
      ev.preventDefault();
    }
  });
  window.addEventListener('keyup', (ev) => {
    if (ev.code === 'Space') {
      spaceDown = false;
      if (!panning) mapWrap.style.cursor = '';
    }
  });

  let panning = false;
  let panStart = { x: 0, y: 0, scrollLeft: 0, scrollTop: 0 };
  mapWrap.addEventListener('mousedown', (ev) => {
    if (!spaceDown) return;
    panning = true;
    panStart = { x: ev.clientX, y: ev.clientY, scrollLeft: mapWrap.scrollLeft, scrollTop: mapWrap.scrollTop };
    mapWrap.style.cursor = 'grabbing';
    ev.preventDefault();
  });
  window.addEventListener('mousemove', (ev) => {
    if (!panning) return;
    mapWrap.scrollLeft = panStart.scrollLeft - (ev.clientX - panStart.x);
    mapWrap.scrollTop = panStart.scrollTop - (ev.clientY - panStart.y);
  });
  window.addEventListener('mouseup', () => {
    if (!panning) return;
    panning = false;
    mapWrap.style.cursor = spaceDown ? 'grab' : '';
  });

  async function refresh() {
    const res = await fetch('/admin/screens.json');
    const rows = await res.json();
    discovered = new Map(rows.map(r => [r.sx + ',' + r.sy, { biome: r.biome, code: r.code }]));
    draw();
  }

  function cellFromEvent(ev) {
    const rect = canvas.getBoundingClientRect();
    const px = Math.floor((ev.clientX - rect.left) * (canvas.width / rect.width) / cell);
    const py = Math.floor((ev.clientY - rect.top) * (canvas.height / rect.height) / cell);
    return { sx: px + WORLD_MIN, sy: py + WORLD_MIN };
  }

  canvas.addEventListener('click', async (ev) => {
    if (spaceDown || mode !== 'inspect') return;
    const { sx, sy } = cellFromEvent(ev);
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

  // ---- Spraybrush: pintar/despintar/borrar arrastrando sobre el mapa ----
  let dragging = false;
  let brushPreview = new Map(); // "sx,sy" -> {sx,sy}, buffer acumulado del trazo actual

  function addBrushAt(ev) {
    const { sx, sy } = cellFromEvent(ev);
    for (const c of cellsInBrush(sx, sy)) brushPreview.set(c.sx + ',' + c.sy, c);
    draw();
  }

  canvas.addEventListener('mousedown', (ev) => {
    if (spaceDown || mode === 'inspect') return;
    dragging = true;
    addBrushAt(ev);
  });
  canvas.addEventListener('mousemove', (ev) => {
    if (!dragging) return;
    addBrushAt(ev);
  });
  window.addEventListener('mouseup', async () => {
    if (!dragging) return;
    dragging = false;
    const cells = [...brushPreview.values()];
    brushPreview = new Map();
    if (cells.length === 0) { draw(); return; }

    if (mode === 'paint') {
      await fetch('/admin/paint', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ cells, biome: activeBiome }) });
      await refreshPaint();
    } else if (mode === 'unpaint') {
      await fetch('/admin/unpaint', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ cells }) });
      await refreshPaint();
    } else if (mode === 'delete') {
      await fetch('/admin/delete-screens', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ cells }) });
      await refresh();
    }
    draw();
  });

  // Miniatura con los sprites reales del juego (misma proyección isométrica que el
  // cliente), en vez de un grid de colores planos.
  const TILE_W = 64, TILE_H = 32;
  function toScreen(col, row) { return { x: (col - row) * (TILE_W / 2), y: (col + row) * (TILE_H / 2) }; }

  const TILE_SPRITES = {
    0: '/raster/ground_plain.png',
    1: '/raster/ground_path.png',
    2: '/raster/puddle.png',
    3: '/raster/dead_tree.png',
    4: '/raster/rock_spire.png',
    5: '/raster/rock_mesa.png',
    6: '/raster/cliff_wall.png',
    7: '/raster/cactus_tall.png',
  };
  const RAISED = new Set([3, 4, 5, 6, 7]);
  const spriteImages = {};
  const spritesReady = Promise.all(Object.entries(TILE_SPRITES).map(([t, src]) => new Promise((resolve) => {
    const img = new Image();
    img.onload = () => { spriteImages[t] = img; resolve(); };
    img.onerror = () => resolve();
    img.src = src;
  })));

  async function drawThumb(screen) {
    await spritesReady;
    thumb.style.display = 'block';
    const tiles = screen.tiles;
    const h = tiles.length, w = tiles[0].length;

    const corners = [toScreen(0, 0), toScreen(w - 1, 0), toScreen(0, h - 1), toScreen(w - 1, h - 1)];
    const minX = Math.min(...corners.map(p => p.x)) - TILE_W / 2;
    const maxX = Math.max(...corners.map(p => p.x)) + TILE_W / 2;
    const minY = Math.min(...corners.map(p => p.y)) - 70;
    const maxY = Math.max(...corners.map(p => p.y)) + TILE_H / 2 + 20;
    const s = Math.min(thumb.width / (maxX - minX), thumb.height / (maxY - minY)) * 0.95;
    const originX = thumb.width / 2 - s * (minX + maxX) / 2;
    const originY = thumb.height / 2 - s * (minY + maxY) / 2;

    thumbCtx.clearRect(0, 0, thumb.width, thumb.height);
    thumbCtx.save();
    thumbCtx.setTransform(s, 0, 0, s, originX, originY);

    const SW = 68, SH = 68, AX = 34, AY = 20;
    function drawSprite(t, col, row) {
      const img = spriteImages[t];
      if (!img) return;
      const p = toScreen(col, row);
      thumbCtx.drawImage(img, p.x - AX, p.y - AY, SW, SH);
    }

    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) drawSprite(RAISED.has(tiles[y][x]) ? 0 : tiles[y][x], x, y);

    const raised = [];
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (RAISED.has(tiles[y][x])) raised.push({ depth: x + y, x, y, t: tiles[y][x] });
    for (const m of screen.monsters) if (m.alive) raised.push({ depth: m.x + m.y, x: m.x, y: m.y, dot: '#e05555' });
    for (const it of screen.items) if (!it.takenBy) raised.push({ depth: it.x + it.y, x: it.x, y: it.y, dot: '#f0c419' });
    raised.sort((a, b) => a.depth - b.depth);
    for (const r of raised) {
      if (r.dot) {
        const p = toScreen(r.x, r.y);
        thumbCtx.fillStyle = r.dot;
        thumbCtx.beginPath();
        thumbCtx.arc(p.x, p.y, 4, 0, Math.PI * 2);
        thumbCtx.fill();
      } else {
        drawSprite(r.t, r.x, r.y);
      }
    }
    thumbCtx.restore();
  }

  resizeCanvas();
  refresh();
  refreshPaint();
  setInterval(refresh, 4000);
  setInterval(refreshPaint, 4000);
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
