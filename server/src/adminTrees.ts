import { Router } from "express";
import { randomUUID } from "node:crypto";
import { DEFAULT_TREE_DEF, LEAF_SHAPES, CANOPY_SHAPES, BIOME_IDS, BIOME_CATALOG, type TreeDef, type LeafShape, type CanopyShape, type BiomeId } from "@roi/shared";
import { listTreeDefs, saveTreeDef, deleteTreeDef } from "./db.js";

// Backoffice: generador procedural de árboles (ver TreeDef en shared). Vive en
// su propio router/página (/admin/trees) en vez de sumarse al HTML gigante de
// index.ts, para no pisarnos con quien esté tocando ese archivo a la vez.
export const treesRouter = Router();

treesRouter.get("/admin/trees.json", (_req, res) => {
  res.json(listTreeDefs());
});

// Pública (no /admin): el propio juego la necesita para dibujar los árboles
// colocados en el mundo (ScreenData.placedTrees solo guarda el id + posición).
treesRouter.get("/tree-defs.json", (_req, res) => {
  res.json(listTreeDefs());
});

treesRouter.post("/admin/trees", (req, res) => {
  const body = req.body as Partial<TreeDef> | undefined;
  if (!body || typeof body.name !== "string" || !body.name.trim()) {
    res.status(400).json({ error: "invalid body" });
    return;
  }
  const num = (v: unknown, fallback: number): number => (Number.isFinite(Number(v)) ? Number(v) : fallback);
  const str = (v: unknown, fallback: string): string => (typeof v === "string" && v ? v : fallback);

  const def: TreeDef = {
    id: typeof body.id === "string" && body.id ? body.id : randomUUID(),
    name: body.name.trim().slice(0, 40),
    height: num(body.height, DEFAULT_TREE_DEF.height),
    trunkWidth: num(body.trunkWidth, DEFAULT_TREE_DEF.trunkWidth),
    branchCount: Math.max(1, Math.round(num(body.branchCount, DEFAULT_TREE_DEF.branchCount))),
    leafCount: Math.max(1, Math.round(num(body.leafCount, DEFAULT_TREE_DEF.leafCount))),
    leafShape: LEAF_SHAPES.includes(body.leafShape as LeafShape) ? (body.leafShape as LeafShape) : DEFAULT_TREE_DEF.leafShape,
    canopyShape: CANOPY_SHAPES.includes(body.canopyShape as CanopyShape)
      ? (body.canopyShape as CanopyShape)
      : DEFAULT_TREE_DEF.canopyShape,
    branchStartHeight: Math.min(1, Math.max(0, num(body.branchStartHeight, DEFAULT_TREE_DEF.branchStartHeight))),
    tileSpan: [1, 2, 4].includes(body.tileSpan as number) ? (body.tileSpan as 1 | 2 | 4) : DEFAULT_TREE_DEF.tileSpan,
    countPerTile: Math.min(8, Math.max(1, Math.round(num(body.countPerTile, DEFAULT_TREE_DEF.countPerTile)))),
    instanceOffsets: Array.isArray(body.instanceOffsets)
      ? body.instanceOffsets
          .filter((o): o is { x: number; y: number } => !!o && Number.isFinite(o.x) && Number.isFinite(o.y))
          .map((o) => ({ x: Math.min(2.5, Math.max(-2.5, o.x)), y: Math.min(2.5, Math.max(-2.5, o.y)) }))
      : [],
    lean: Math.min(1, Math.max(-1, num(body.lean, DEFAULT_TREE_DEF.lean))),
    branchFlexibility: Math.min(1, Math.max(0, num(body.branchFlexibility, DEFAULT_TREE_DEF.branchFlexibility))),
    allowedBiomes: Array.isArray(body.allowedBiomes)
      ? body.allowedBiomes.filter((b): b is BiomeId => BIOME_IDS.includes(b as BiomeId))
      : [],
    leafColorSun: str(body.leafColorSun, DEFAULT_TREE_DEF.leafColorSun),
    leafColorShade: str(body.leafColorShade, DEFAULT_TREE_DEF.leafColorShade),
    trunkColor: str(body.trunkColor, DEFAULT_TREE_DEF.trunkColor),
    windSway: num(body.windSway, DEFAULT_TREE_DEF.windSway),
    trunkTwist: num(body.trunkTwist, DEFAULT_TREE_DEF.trunkTwist),
    branchTwist: num(body.branchTwist, DEFAULT_TREE_DEF.branchTwist),
    canopyWidth: num(body.canopyWidth, DEFAULT_TREE_DEF.canopyWidth),
    seed: Math.round(num(body.seed, DEFAULT_TREE_DEF.seed)),
  };
  saveTreeDef(def);
  res.json(def);
});

treesRouter.delete("/admin/trees/:id", (req, res) => {
  res.json({ deleted: deleteTreeDef(req.params.id) });
});

treesRouter.get("/admin/trees", (_req, res) => {
  res.send(`<!doctype html>
<html><head><meta charset="utf-8"><title>EVERLINTH — Generador de árboles</title>
<style>
  body { margin:0; background:#111; color:#ddd; font-family: monospace; display:flex; height:100vh; }
  a { color:#4caf6d; }
  #previewCol { flex:1; display:flex; align-items:center; justify-content:center; background:#0c1710; }
  #preview { background:#16241a; border:1px solid #333; }
  #panel { width:360px; border-left:1px solid #333; padding:16px; box-sizing:border-box; overflow-y:auto; }
  #panel h2 { margin-top:0; font-size:16px; color:#4caf6d; }
  .row { margin:10px 0; }
  .row label { display:flex; justify-content:space-between; font-size:12px; color:#aaa; margin-bottom:2px; }
  .row input[type=range] { width:100%; }
  .row input[type=text] { width:100%; background:#000; border:1px solid #444; color:#ddd; font-family:inherit; padding:4px; box-sizing:border-box; }
  .colorRow { display:flex; gap:10px; align-items:center; }
  .colorRow > div { flex:1; text-align:center; font-size:11px; color:#aaa; }
  button { background:#222; color:#ddd; border:1px solid #444; cursor:pointer; font-family:inherit; padding:6px 10px; }
  button:hover { background:#333; }
  button.primary { background:#4caf6d; color:#111; border:none; font-weight:bold; }
  #savedList { margin-top:10px; }
  .savedItem { display:flex; align-items:center; gap:8px; padding:4px; border:1px solid #292929; margin-bottom:4px; }
  .savedItem canvas { background:#16241a; }
  .savedItem .name { flex:1; font-size:12px; }
  .savedItem button { font-size:11px; padding:3px 6px; }
  select { width:100%; background:#000; border:1px solid #444; color:#ddd; font-family:inherit; padding:4px; box-sizing:border-box; }
  #previewCol { flex-direction:column; gap:10px; }
  #zoomBar { display:flex; align-items:center; gap:6px; background:#111; padding:4px 8px; border:1px solid #333; }
  #zoomBar button { width:30px; }
  #zoomLabel { font-size:12px; color:#999; min-width:60px; text-align:center; }
  #preview { cursor:grab; }
  #preview.dragging { cursor:grabbing; }
</style>
</head>
<body>
<div id="previewCol">
  <div id="zoomBar">
    <button id="zoomOut">−</button>
    <button id="zoom1to1">1:1</button>
    <button id="zoomIn">+</button>
    <span id="zoomLabel"></span>
    <span style="font-size:11px;color:#666;">arrastra el árbol para reposicionarlo en el tile</span>
  </div>
  <canvas id="preview" width="460" height="560"></canvas>
</div>
<div id="panel">
  <div style="margin-bottom:10px;"><a href="/admin">← Volver al mapa</a></div>
  <h2>Generador de árboles</h2>

  <div class="row"><input id="name" type="text" placeholder="Nombre del árbol"></div>

  <div class="row"><label>Altura <span id="heightVal"></span></label><input id="height" type="range" min="30" max="200" value="90"></div>
  <div class="row"><label>Ancho del tronco <span id="trunkWidthVal"></span></label><input id="trunkWidth" type="range" min="2" max="30" value="10"></div>
  <div class="row"><label>Nº de ramas <span id="branchCountVal"></span></label><input id="branchCount" type="range" min="1" max="10" value="4"></div>
  <div class="row"><label>Nº de hojas <span id="leafCountVal"></span></label><input id="leafCount" type="range" min="1" max="150" value="24"></div>
  <div class="row"><label>Inclinación <span id="leanVal"></span></label><input id="lean" type="range" min="-100" max="100" value="0"></div>
  <div class="row"><label>Flexibilidad de las ramas <span id="branchFlexibilityVal"></span></label><input id="branchFlexibility" type="range" min="0" max="100" value="70"></div>
  <div class="row"><label>Tamaño de tile</label><select id="tileSpan">
    <option value="1">1×1</option>
    <option value="2">2×2</option>
    <option value="4">4×4</option>
  </select></div>
  <div class="row"><label>Árboles por tile <span id="countPerTileVal"></span></label><input id="countPerTile" type="range" min="1" max="8" value="1"></div>
  <div class="row">
    <label>Biomas donde puede salir <span style="font-weight:normal;color:#666;">(ninguno marcado = cualquiera)</span></label>
    <div id="biomeChecks">
      ${BIOME_IDS.map(
        (id) =>
          `<label style="display:inline-flex;align-items:center;gap:4px;margin:2px 8px 2px 0;font-size:11px;color:#ccc;">` +
          `<input type="checkbox" class="biomeCheck" value="${id}"> <span style="display:inline-block;width:10px;height:10px;background:${BIOME_CATALOG[id].debugColor};border-radius:2px;"></span> ${BIOME_CATALOG[id].label}</label>`
      ).join("")}
    </div>
  </div>
  <div class="row"><label>Forma de la copa</label><select id="canopyShape">
    <option value="round">Redonda</option>
    <option value="triangular">Triangular</option>
    <option value="wide">Ancha</option>
  </select></div>
  <div class="row"><label>Ancho de copa <span id="canopyWidthVal"></span></label><input id="canopyWidth" type="range" min="0" max="100" value="50"></div>
  <div class="row"><label>Altura de arranque de ramas <span id="branchStartHeightVal"></span></label><input id="branchStartHeight" type="range" min="0" max="100" value="55"></div>
  <div class="row"><label>Tipo de hoja</label><select id="leafShape">
    <option value="round">Redonda</option>
    <option value="oval">Ovalada</option>
    <option value="pointed">Puntiaguda</option>
    <option value="needle">Aguja</option>
  </select></div>
  <div class="row"><label>Retorcido del tronco <span id="trunkTwistVal"></span></label><input id="trunkTwist" type="range" min="0" max="100" value="20"></div>
  <div class="row"><label>Retorcido de las ramas <span id="branchTwistVal"></span></label><input id="branchTwist" type="range" min="0" max="100" value="35"></div>
  <div class="row"><label>Viento <span id="windSwayVal"></span></label><input id="windSway" type="range" min="0" max="100" value="40"></div>

  <div class="row colorRow">
    <div>Hoja al sol<br><input id="leafColorSun" type="color" value="#7bc95e"></div>
    <div>Hoja en sombra<br><input id="leafColorShade" type="color" value="#2f6b34"></div>
    <div>Tronco<br><input id="trunkColor" type="color" value="#6b4a2f"></div>
  </div>

  <div class="row" style="display:flex; gap:8px;">
    <button id="newTreeBtn">➕ Nuevo</button>
    <button id="randomizeSeed">🎲 Nueva forma</button>
    <button id="saveBtn" class="primary" style="flex:1;">Guardar</button>
  </div>
  <div id="editingHint" class="row" style="font-size:11px; color:#666;"></div>

  <h2>Guardados</h2>
  <div id="savedList" class="empty">Ninguno todavía.</div>
</div>
<script>
  // ---- Generación procedural (idéntico criterio al que usará el juego): tronco
  // con ramas en abanico y racimos de hoja coloreados según su exposición
  // vertical (más arriba = más sol = más claro). Determinista por "seed".
  function mulberry32(seed) {
    let a = seed >>> 0;
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  function hexToRgb(hex) {
    const n = parseInt(hex.replace('#', ''), 16);
    return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
  }
  function lerpColor(hexA, hexB, t) {
    const a = hexToRgb(hexA), b = hexToRgb(hexB);
    const r = Math.round(a.r + (b.r - a.r) * t);
    const g = Math.round(a.g + (b.g - a.g) * t);
    const bl = Math.round(a.b + (b.b - a.b) * t);
    return 'rgb(' + r + ',' + g + ',' + bl + ')';
  }
  // amt<0 oscurece, amt>0 aclara (hacia blanco). Para dar volumen al tronco/ramas
  // sin necesitar más de un color de entrada.
  function shade(hex, amt) {
    const c = hexToRgb(hex);
    const f = (v) => Math.max(0, Math.min(255, Math.round(amt >= 0 ? v + (255 - v) * amt : v * (1 + amt))));
    return 'rgb(' + f(c.r) + ',' + f(c.g) + ',' + f(c.b) + ')';
  }

  // Contorno (izq/der) de un tramo recto de (0,0) a (ex,ey) cuya línea central
  // se curva con una onda perpendicular — el "retorcido". La onda vale 0 en los
  // dos extremos (sin(t*PI)) y máxima a mitad de camino, así el tramo siempre
  // empieza y acaba exactamente donde se le pide, solo se abomba en medio.
  function bentOutline(ex, ey, w0, w1, twist, freq, phase, segments) {
    const len = Math.hypot(ex, ey) || 1;
    const ux = ex / len, uy = ey / len;
    const nx = -uy, ny = ux;
    const left = [], right = [];
    for (let i = 0; i <= segments; i++) {
      const t = i / segments;
      const cx = ex * t, cy = ey * t;
      const bend = Math.sin(t * Math.PI * freq + phase) * Math.sin(t * Math.PI) * twist * len * 0.22;
      const w = (w0 + (w1 - w0) * t) / 2;
      left.push({ x: cx + nx * (bend - w), y: cy + ny * (bend - w) });
      right.push({ x: cx + nx * (bend + w), y: cy + ny * (bend + w) });
    }
    return { left, right };
  }

  function fillOutline(ctx, outline, colorA, colorB) {
    const p0 = outline.left[0], p1 = outline.right[0];
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
  // antes de escalar. Cada instancia se pinta con un ángulo propio aleatorio
  // (ver drawLeafShape) para que no queden todas "de cara" como una calcomanía.
  const LEAF_SHAPES_PTS = {
    round: [[0, -1], [0.87, -0.5], [0.87, 0.5], [0, 1], [-0.87, 0.5], [-0.87, -0.5]],
    oval: [[0, -1], [0.7, -0.6], [0.9, 0], [0.7, 0.6], [0, 1], [-0.7, 0.6], [-0.9, 0], [-0.7, -0.6]],
    pointed: [[0, -1], [0.55, -0.3], [0.35, 0.6], [0, 1], [-0.35, 0.6], [-0.55, -0.3]],
    needle: [[0, -1], [0.18, 0], [0, 1], [-0.18, 0]],
  };

  function drawLeafShape(ctx, shapeKey, x, y, size, angle, color) {
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

  function drawLeafCluster(ctx, def, rng, count) {
    const leaves = [];
    let minY = Infinity, maxY = -Infinity;
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

  // Ángulo y longitud de una rama principal según la forma de copa elegida:
  // - triangular: más vertical, y las ramas de los extremos del abanico (más
  //   cerca de la base de la copa) son más largas que las del centro (la punta),
  //   como una conífera.
  // - wide: abanico mucho más horizontal, ramas algo más largas.
  // - round (por defecto): abanico equilibrado, longitudes similares.
  // Ángulo de una rama respecto a la VERTICAL del tronco (0 = sigue recto hacia
  // arriba, PI/2 = horizontal): siempre en ese rango 0-90°, con una
  // distribución triangular (media de dos tiradas) que hace comunes los
  // valores intermedios (~45°) y raros los dos extremos, como pidió el usuario.
  function branchGeometry(def, t, rng) {
    const distFromCenter = Math.abs(t - 0.5) * 2; // 0 en el centro del abanico, 1 en los extremos
    const side = t < 0.5 ? -1 : t > 0.5 ? 1 : rng() < 0.5 ? -1 : 1;
    const widthFactor = def.canopyShape === 'wide' ? 1 : def.canopyShape === 'triangular' ? 0.6 : 0.85;
    const maxDeviation = (Math.PI / 2) * (0.5 + def.canopyWidth * 0.5) * widthFactor;
    const bias = (rng() + rng()) / 2; // 0..1 triangular, centrada en 0.5 (nunca exactamente 0 ni 1)
    const deviation = Math.max(0, Math.min(Math.PI / 2, bias * maxDeviation));
    const angle = -Math.PI / 2 + side * deviation;

    let length;
    if (def.canopyShape === 'triangular') {
      length = def.height * (0.2 + distFromCenter * 0.28) * (0.85 + rng() * 0.3);
    } else if (def.canopyShape === 'wide') {
      length = def.height * (0.32 + def.canopyWidth * 0.14) * (0.85 + rng() * 0.3);
    } else {
      length = def.height * (0.3 + rng() * 0.18);
    }
    return { angle, length };
  }

  // El viento apenas mueve el tronco, algo más las ramas, y bastante las hojas
  // (que además llevan un temblor de más frecuencia encima) — un árbol real se
  // mueve así, no entero de una pieza.
  function drawTree(ctx, def, cx, baseY, time) {
    const rng = mulberry32(def.seed);
    const w = def.windSway / 100;
    const windPhase = Math.sin(time * 1.3 + def.seed * 0.7);
    const windFlutter = Math.sin(time * 3.4 + def.seed * 1.9);
    // El movimiento lo lleva la rama, meciéndose desde el punto donde nace del
    // tronco (no las hojas girando sueltas sobre su propio centro): el tronco
    // casi no se mueve, la rama es el balanceo principal, la sub-rama (más
    // fina) flexiona todavía más que la rama gruesa, y las hojas solo añaden
    // encima un tintineo rápido y pequeño, no el movimiento en sí.
    const trunkSway = windPhase * w * 0.015;
    const branchSway = (windPhase * 0.32 + windFlutter * 0.07) * w * def.branchFlexibility;
    const leafShimmerBase = w * 0.09;
    const leanAngle = def.lean * 0.4; // inclinación fija del árbol, no depende del viento

    ctx.save();
    ctx.translate(cx, baseY);
    ctx.rotate(trunkSway + leanAngle);

    const trunkTopY = -def.height * 0.45;
    const trunkOutline = bentOutline(0, trunkTopY, def.trunkWidth, def.trunkWidth * 0.55, def.trunkTwist, 1.1, def.seed * 0.3, 8);
    fillOutline(ctx, trunkOutline, shade(def.trunkColor, -0.4), shade(def.trunkColor, 0.32));

    const branchCount = Math.max(1, def.branchCount);
    for (let i = 0; i < branchCount; i++) {
      const t = branchCount === 1 ? 0.5 : i / (branchCount - 1);
      // Cada rama nace a una altura distinta del tronco (no todas del mismo
      // punto): entre branchStartHeight (la más baja) y la copa (la más alta).
      const attachFrac = def.branchStartHeight + (1 - def.branchStartHeight) * t;
      const attachY = trunkTopY * attachFrac;
      const { angle, length } = branchGeometry(def, t, rng);
      const ex = Math.cos(angle) * length;
      const ey = Math.sin(angle) * length;

      // Nudo en la unión: un bulto de corteza fijo al tronco (no gira con la
      // rama) donde nace, para que el empalme no sea una línea recta pegada.
      const knotR = def.trunkWidth * (0.24 + rng() * 0.1);
      ctx.beginPath();
      ctx.ellipse(0, attachY, knotR, knotR * 0.8, 0, 0, Math.PI * 2);
      ctx.fillStyle = shade(def.trunkColor, -0.18);
      ctx.fill();

      ctx.save();
      ctx.translate(0, attachY);
      ctx.rotate(branchSway * (0.6 + rng() * 0.8));

      const branchOutline = bentOutline(ex, ey, def.trunkWidth * 0.4, def.trunkWidth * 0.12, def.branchTwist, 1.6, def.seed * 1.7 + i * 2.1, 6);
      fillOutline(ctx, branchOutline, shade(def.trunkColor, -0.3), shade(def.trunkColor, 0.35));

      ctx.translate(ex, ey);

      // Bifurcación: cuánto se separan las sub-ramas depende del ancho de copa,
      // y CUÁNTAS salen depende de lo larga que sea esta rama en concreto —
      // una rama larga saca más sub-ramas con sus hojas, una corta solo 2.
      const splitAngle = 0.25 + def.canopyWidth * 0.9;
      const subLen = length * (0.35 + rng() * 0.2);
      const lengthFrac = Math.min(1, length / def.height);
      const subBranchCount = Math.max(2, Math.round(2 + lengthFrac * 4));
      const dotsPerSub = Math.max(4, Math.round((def.leafCount * 4) / (branchCount * subBranchCount)));

      for (let k = 0; k < subBranchCount; k++) {
        const kt = subBranchCount === 1 ? 0 : (k / (subBranchCount - 1) - 0.5) * 2; // -1..1, en abanico
        const sAngle = angle + kt * splitAngle * (0.6 + rng() * 0.5);
        const sx = Math.cos(sAngle) * subLen;
        const sy = Math.sin(sAngle) * subLen;

        ctx.save();
        // La punta fina flexiona más que la rama gruesa de la que cuelga; un
        // pequeño término fijo evita que la sub-rama central quede estática.
        ctx.rotate(branchSway * (1.4 * kt + 0.3) * (0.7 + rng() * 0.4));

        const subOutline = bentOutline(sx, sy, def.trunkWidth * 0.14, def.trunkWidth * 0.05, def.branchTwist * 0.7, 1.8, def.seed * 3.1 + i * 5 + k, 5);
        fillOutline(ctx, subOutline, shade(def.trunkColor, -0.25), shade(def.trunkColor, 0.3));

        ctx.save();
        ctx.translate(sx, sy);
        // Tintineo: rápido y de poca amplitud, se suma al balanceo que ya trae
        // la rama/sub-rama — un temblor encima del movimiento, no el movimiento.
        const leafShimmer = Math.sin(time * 7.5 + def.seed * 2.3 + i * 1.7 + k) * leafShimmerBase;
        ctx.rotate(leafShimmer);
        drawLeafCluster(ctx, def, rng, dotsPerSub);
        ctx.restore();

        ctx.restore();
      }

      ctx.restore();
    }

    ctx.restore();
  }

  // Rombo de referencia del tile real del juego (TILE_W=64, TILE_H=32 en
  // client/src/render/iso.ts): para ver exactamente cómo queda el árbol
  // encuadrado dentro de una celda antes de plantarlo en el mundo.
  const TILE_W = 64, TILE_H = 32;

  // Rejilla de span×span tiles (1x1, 2x2 o 4x4), centrada en (cx,cy) — se
  // construye con los dos vectores de paso de la proyección isométrica en vez
  // de un solo rombo, así se generaliza a cualquier tamaño de tile.
  function drawTileGrid(ctx, cx, cy, zoom, span) {
    const hw = (TILE_W / 2) * zoom, hh = (TILE_H / 2) * zoom;
    const stepRow = { x: hw, y: hh };
    const stepCol = { x: hw, y: -hh };
    const originX = cx - (stepRow.x + stepCol.x) * span / 2;
    const originY = cy - (stepRow.y + stepCol.y) * span / 2;
    const pt = (col, row) => ({ x: originX + col * stepCol.x + row * stepRow.x, y: originY + col * stepCol.y + row * stepRow.y });

    ctx.save();
    ctx.strokeStyle = 'rgba(255,255,255,0.35)';
    ctx.setLineDash([4, 3]);
    ctx.lineWidth = 1;
    for (let row = 0; row <= span; row++) {
      const p0 = pt(0, row), p1 = pt(span, row);
      ctx.beginPath();
      ctx.moveTo(p0.x, p0.y);
      ctx.lineTo(p1.x, p1.y);
      ctx.stroke();
    }
    for (let col = 0; col <= span; col++) {
      const p0 = pt(col, 0), p1 = pt(col, span);
      ctx.beginPath();
      ctx.moveTo(p0.x, p0.y);
      ctx.lineTo(p1.x, p1.y);
      ctx.stroke();
    }
    ctx.setLineDash([]);
    ctx.fillStyle = 'rgba(255,255,255,0.6)';
    ctx.beginPath();
    ctx.arc(cx, cy, 1.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  // Posición de cada copia dentro del área tileSpan×tileSpan: usa la guardada
  // en def.instanceOffsets si el admin ya la arrastró a mano; si no, la reparte
  // sola de forma determinista (la copia 0 en el centro, el resto alrededor).
  function resolveInstanceOffsets(def) {
    const span = def.tileSpan || 1;
    const bound = 0.5 * span + 0.1;
    const stored = Array.isArray(def.instanceOffsets) ? def.instanceOffsets : [];
    const rng = mulberry32(def.seed * 7 + 3);
    const count = Math.max(1, def.countPerTile);
    const out = [];
    for (let i = 0; i < count; i++) {
      if (stored[i]) {
        out.push({ x: stored[i].x, y: stored[i].y });
        continue;
      }
      let ox = 0, oy = 0;
      if (i > 0) {
        ox = (rng() - 0.5) * 0.7 * span;
        oy = (rng() - 0.5) * 0.5 * span;
      }
      out.push({ x: Math.max(-bound, Math.min(bound, ox)), y: Math.max(-bound * 0.85, Math.min(bound * 0.85, oy)) });
    }
    return out;
  }

  // Coloca countPerTile copias del árbol dentro del área tileSpan×tileSpan.
  // Cada copia extra varía (tamaño, ancho de tronco, nº de ramas, semilla) a
  // partir del mismo árbol "patrón" — no son clones idénticos. Devuelve las
  // posiciones usadas, para poder arrastrar cada una por separado.
  function plantTile(ctx, def, cx, cy, time, zoom, showGrid) {
    const span = def.tileSpan || 1;
    if (showGrid) drawTileGrid(ctx, cx, cy, zoom, span);
    const offsets = resolveInstanceOffsets(def);
    const rng = mulberry32(def.seed * 13 + 5);
    ctx.save();
    ctx.translate(cx, cy);
    ctx.scale(zoom, zoom);
    offsets.forEach((o, i) => {
      const instanceDef =
        i === 0
          ? def
          : Object.assign({}, def, {
              seed: def.seed + i * 97,
              height: def.height * (0.75 + rng() * 0.3),
              trunkWidth: def.trunkWidth * (0.8 + rng() * 0.35),
              branchCount: Math.max(1, def.branchCount + Math.round((rng() - 0.5) * 3)),
            });
      drawTree(ctx, instanceDef, o.x * TILE_W, o.y * TILE_H, time);
    });
    ctx.restore();
    return offsets;
  }

  // ---- UI ----
  const els = {
    name: document.getElementById('name'),
    height: document.getElementById('height'),
    trunkWidth: document.getElementById('trunkWidth'),
    branchCount: document.getElementById('branchCount'),
    leafCount: document.getElementById('leafCount'),
    leafShape: document.getElementById('leafShape'),
    canopyShape: document.getElementById('canopyShape'),
    canopyWidth: document.getElementById('canopyWidth'),
    branchStartHeight: document.getElementById('branchStartHeight'),
    trunkTwist: document.getElementById('trunkTwist'),
    branchTwist: document.getElementById('branchTwist'),
    windSway: document.getElementById('windSway'),
    lean: document.getElementById('lean'),
    branchFlexibility: document.getElementById('branchFlexibility'),
    tileSpan: document.getElementById('tileSpan'),
    countPerTile: document.getElementById('countPerTile'),
    leafColorSun: document.getElementById('leafColorSun'),
    leafColorShade: document.getElementById('leafColorShade'),
    trunkColor: document.getElementById('trunkColor'),
  };
  let seed = 1;
  let editingId = null;
  let instanceOffsets = []; // posiciones ya fijadas a mano (arrastre); las que faltan se reparten solas

  function selectedBiomes() {
    return Array.from(document.querySelectorAll('.biomeCheck:checked')).map((el) => el.value);
  }

  function currentDef() {
    return {
      height: Number(els.height.value),
      trunkWidth: Number(els.trunkWidth.value),
      branchCount: Number(els.branchCount.value),
      leafCount: Number(els.leafCount.value),
      leafShape: els.leafShape.value,
      canopyShape: els.canopyShape.value,
      canopyWidth: Number(els.canopyWidth.value) / 100,
      branchStartHeight: Number(els.branchStartHeight.value) / 100,
      trunkTwist: Number(els.trunkTwist.value) / 100,
      branchTwist: Number(els.branchTwist.value) / 100,
      windSway: Number(els.windSway.value),
      lean: Number(els.lean.value) / 100,
      branchFlexibility: Number(els.branchFlexibility.value) / 100,
      tileSpan: Number(els.tileSpan.value),
      countPerTile: Number(els.countPerTile.value),
      instanceOffsets,
      allowedBiomes: selectedBiomes(),
      leafColorSun: els.leafColorSun.value,
      leafColorShade: els.leafColorShade.value,
      trunkColor: els.trunkColor.value,
      seed,
    };
  }

  function updateLabels() {
    document.getElementById('heightVal').textContent = els.height.value;
    document.getElementById('trunkWidthVal').textContent = els.trunkWidth.value;
    document.getElementById('branchCountVal').textContent = els.branchCount.value;
    document.getElementById('leafCountVal').textContent = els.leafCount.value;
    document.getElementById('canopyWidthVal').textContent = els.canopyWidth.value + '%';
    document.getElementById('branchStartHeightVal').textContent = els.branchStartHeight.value + '%';
    document.getElementById('trunkTwistVal').textContent = els.trunkTwist.value + '%';
    document.getElementById('branchTwistVal').textContent = els.branchTwist.value + '%';
    document.getElementById('windSwayVal').textContent = els.windSway.value + '%';
    document.getElementById('leanVal').textContent = els.lean.value + '%';
    document.getElementById('branchFlexibilityVal').textContent = els.branchFlexibility.value + '%';
    document.getElementById('countPerTileVal').textContent = els.countPerTile.value;
  }
  for (const k of ['height', 'trunkWidth', 'branchCount', 'leafCount', 'canopyWidth', 'branchStartHeight', 'trunkTwist', 'branchTwist', 'windSway', 'lean', 'branchFlexibility', 'countPerTile']) {
    els[k].addEventListener('input', updateLabels);
  }
  for (const k of ['leafShape', 'canopyShape', 'tileSpan']) {
    els[k].addEventListener('change', updateLabels);
  }
  updateLabels();
  updateEditingHint();

  document.getElementById('randomizeSeed').addEventListener('click', () => {
    seed = Math.floor(Math.random() * 1e9);
  });

  // ---- Zoom + arrastre para posicionar el árbol dentro del tile ----
  let zoom = 2;
  const ZOOM_MIN = 0.5, ZOOM_MAX = 6;
  function updateZoomLabel() {
    document.getElementById('zoomLabel').textContent = zoom.toFixed(2) + 'x';
  }
  document.getElementById('zoomIn').addEventListener('click', () => {
    zoom = Math.min(ZOOM_MAX, zoom * 1.25);
    updateZoomLabel();
  });
  document.getElementById('zoomOut').addEventListener('click', () => {
    zoom = Math.max(ZOOM_MIN, zoom / 1.25);
    updateZoomLabel();
  });
  document.getElementById('zoom1to1').addEventListener('click', () => {
    zoom = 1; // 1 px de canvas = 1 px de juego, para juzgar el tamaño real
    updateZoomLabel();
  });
  updateZoomLabel();

  const preview = document.getElementById('preview');
  const pctx = preview.getContext('2d');
  const anchorX = () => preview.width / 2;
  const anchorY = () => preview.height * 0.72; // más margen arriba para ver bien el tronco entero

  // Arrastre por instancia: al bajar el ratón se busca cuál de los árboles
  // plantados en el último frame está más cerca del clic, y esa es la que se
  // mueve — así con countPerTile>1 se puede recolocar cada uno por separado.
  let dragging = false;
  let dragIndex = -1;
  let lastOffsets = [];

  function clickToCanvasPx(ev) {
    const rect = preview.getBoundingClientRect();
    return {
      x: ((ev.clientX - rect.left) * preview.width) / rect.width,
      y: ((ev.clientY - rect.top) * preview.height) / rect.height,
    };
  }

  preview.addEventListener('mousedown', (ev) => {
    const click = clickToCanvasPx(ev);
    let best = 0, bestDist = Infinity;
    lastOffsets.forEach((o, i) => {
      const sx = anchorX() + o.x * TILE_W * zoom;
      const sy = anchorY() + o.y * TILE_H * zoom;
      const d = Math.hypot(click.x - sx, click.y - sy);
      if (d < bestDist) { bestDist = d; best = i; }
    });
    dragIndex = best;
    dragging = true;
    preview.classList.add('dragging');
  });
  window.addEventListener('mousemove', (ev) => {
    if (!dragging || dragIndex < 0) return;
    const rect = preview.getBoundingClientRect();
    const dx = (ev.movementX * preview.width) / rect.width;
    const dy = (ev.movementY * preview.height) / rect.height;
    const span = Number(els.tileSpan.value) || 1;
    const bound = 0.5 * span + 0.1;
    const base = instanceOffsets[dragIndex] || lastOffsets[dragIndex] || { x: 0, y: 0 };
    const next = {
      x: Math.max(-bound, Math.min(bound, base.x + dx / (TILE_W * zoom))),
      y: Math.max(-bound * 0.85, Math.min(bound * 0.85, base.y + dy / (TILE_H * zoom))),
    };
    instanceOffsets[dragIndex] = next;
  });
  window.addEventListener('mouseup', () => {
    dragging = false;
    dragIndex = -1;
    preview.classList.remove('dragging');
  });
  function loop(t) {
    pctx.clearRect(0, 0, preview.width, preview.height);
    lastOffsets = plantTile(pctx, currentDef(), anchorX(), anchorY(), t / 1000, zoom, true);
    requestAnimationFrame(loop);
  }
  requestAnimationFrame(loop);

  // ---- Guardar / listar / borrar ----
  async function refreshList() {
    const res = await fetch('/admin/trees.json');
    const defs = await res.json();
    const list = document.getElementById('savedList');
    if (defs.length === 0) {
      list.className = 'empty';
      list.textContent = 'Ninguno todavía.';
      return;
    }
    list.className = '';
    list.innerHTML = '';
    for (const def of defs) {
      const item = document.createElement('div');
      item.className = 'savedItem';
      const c = document.createElement('canvas');
      c.width = 60; c.height = 60;
      const cctx = c.getContext('2d');
      plantTile(cctx, def, 30, 45, 0, 0.6, false);
      const name = document.createElement('div');
      name.className = 'name';
      name.textContent = def.name;
      const loadBtn = document.createElement('button');
      loadBtn.textContent = 'Cargar';
      loadBtn.addEventListener('click', () => loadDef(def));
      const delBtn = document.createElement('button');
      delBtn.textContent = 'Borrar';
      delBtn.addEventListener('click', async () => {
        await fetch('/admin/trees/' + def.id, { method: 'DELETE' });
        refreshList();
      });
      item.appendChild(c);
      item.appendChild(name);
      item.appendChild(loadBtn);
      item.appendChild(delBtn);
      list.appendChild(item);
    }
  }

  function updateEditingHint() {
    document.getElementById('editingHint').textContent = editingId
      ? 'Editando "' + els.name.value + '" — Guardar actualiza este árbol. Pulsa "Nuevo" para crear otro distinto.'
      : 'Árbol nuevo — Guardar creará una entrada nueva.';
  }

  document.getElementById('newTreeBtn').addEventListener('click', () => {
    editingId = null;
    els.name.value = '';
    seed = Math.floor(Math.random() * 1e9);
    instanceOffsets = [];
    document.querySelectorAll('.biomeCheck').forEach((el) => (el.checked = false));
    updateEditingHint();
    els.name.focus();
  });

  function loadDef(def) {
    editingId = def.id;
    els.name.value = def.name;
    els.height.value = def.height;
    els.trunkWidth.value = def.trunkWidth;
    els.branchCount.value = def.branchCount;
    els.leafCount.value = def.leafCount;
    els.leafShape.value = def.leafShape;
    els.canopyShape.value = def.canopyShape;
    els.canopyWidth.value = Math.round(def.canopyWidth * 100);
    els.branchStartHeight.value = Math.round(def.branchStartHeight * 100);
    els.trunkTwist.value = Math.round(def.trunkTwist * 100);
    els.branchTwist.value = Math.round(def.branchTwist * 100);
    els.windSway.value = def.windSway;
    els.lean.value = Math.round(def.lean * 100);
    els.branchFlexibility.value = Math.round(def.branchFlexibility * 100);
    els.tileSpan.value = def.tileSpan;
    els.countPerTile.value = def.countPerTile;
    instanceOffsets = Array.isArray(def.instanceOffsets) ? def.instanceOffsets.map((o) => Object.assign({}, o)) : [];
    els.leafColorSun.value = def.leafColorSun;
    els.leafColorShade.value = def.leafColorShade;
    els.trunkColor.value = def.trunkColor;
    seed = def.seed;
    const allowed = Array.isArray(def.allowedBiomes) ? def.allowedBiomes : [];
    document.querySelectorAll('.biomeCheck').forEach((el) => {
      el.checked = allowed.length === 0 ? false : allowed.includes(el.value);
    });
    updateLabels();
    updateEditingHint();
  }

  document.getElementById('saveBtn').addEventListener('click', async () => {
    if (!els.name.value.trim()) {
      els.name.focus();
      return;
    }
    const payload = Object.assign({ id: editingId, name: els.name.value }, currentDef());
    const res = await fetch('/admin/trees', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const saved = await res.json();
    editingId = saved.id;
    updateEditingHint();
    refreshList();
  });

  refreshList();
</script>
</body></html>`);
});
