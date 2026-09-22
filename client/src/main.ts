import "./style.css";
import {
  DEFAULT_VISION_SETTINGS,
  type BiomeId,
  type Direction,
  type ExoticTier,
  type InputState,
  type ItemState,
  type MonsterState,
  type NeighborTiles,
  type PlayerPrivateState,
  type PlayerPublicState,
  type ScreenData,
  type ServerMessage,
  type TreeDef,
  type VisionFogSettings,
} from "@roi/shared";
import { GameConnection } from "./net.js";
import { setupInput } from "./input.js";
import { setupGamepad, GAMEPAD_BUTTON_LABELS, START_BUTTON } from "./gamepad.js";
import { renderScene, computeLayout, type Layout, type Tileset } from "./render/scene.js";
import { toScreen, TILE_H } from "./render/iso.js";
import { getDayNight, applyDayNightOverlay } from "./render/daynight.js";
import { WeatherSystem, applyHeatShimmer, pickWeather } from "./render/weather.js";
import { applyEdgeBlur } from "./render/edgeblur.js";
import { applyChromaticAberration } from "./render/chromatic.js";
import { applyFlashlight, drawCursorDot } from "./render/flashlight.js";
import { loadTileset, type RasterBiome } from "./render/tileset.js";

// Solo "classic" tiene arte propio de momento (el resto cae en "badlands", el
// set original) — ver RASTER_SOURCES_BY_BIOME en tileset.ts.
function rasterBiomeFor(biome: BiomeId): RasterBiome {
  return biome === "classic" ? "classic" : "badlands";
}

const loginEl = document.getElementById("login") as HTMLDivElement;
const loginForm = document.getElementById("login-form") as HTMLFormElement;
const usernameInput = document.getElementById("username") as HTMLInputElement;
const loginError = document.getElementById("login-error") as HTMLParagraphElement;
const submitBtn = loginForm.querySelector("button[type=submit]") as HTMLButtonElement;
const gamepadKeyboardEl = document.getElementById("gamepad-keyboard") as HTMLDivElement;
const gamepadHintEl = document.getElementById("gamepad-hint") as HTMLParagraphElement;
const gameEl = document.getElementById("game") as HTMLDivElement;
const sceneCanvas = document.getElementById("scene") as HTMLCanvasElement;
const weatherCanvas = document.getElementById("weather") as HTMLCanvasElement;
const hpFill = document.getElementById("hp-fill") as HTMLDivElement;
const statsEl = document.getElementById("stats") as HTMLDivElement;
const discoveryEl = document.getElementById("discovery") as HTMLDivElement;
const screenCodeEl = document.getElementById("screen-code") as HTMLDivElement;

const sceneCtx = sceneCanvas.getContext("2d")!;
const buffer = document.createElement("canvas");
const bufferCtx = buffer.getContext("2d")!;
const weatherCtx = weatherCanvas.getContext("2d")!;
const weather = new WeatherSystem();

let layout: Layout = { scale: 1, originX: 0, originY: 0 };
let tileset: Tileset | null = null;
let activeRasterBiome: RasterBiome | null = null;
loadTileset("badlands").then((t) => (tileset = t));

// Cambia el tileset activo cuando la estancia entra en un bioma con arte propio
// distinto — loadTileset cachea por bioma, así que repetir uno ya visto no
// vuelve a descargar imágenes.
function ensureTilesetFor(biome: BiomeId): void {
  const wanted = rasterBiomeFor(biome);
  if (wanted === activeRasterBiome) return;
  activeRasterBiome = wanted;
  loadTileset(wanted).then((t) => {
    if (activeRasterBiome === wanted) tileset = t;
  });
}

// Ajustes de la niebla de visión: editables desde el backoffice, se piden una
// vez al arrancar (si falla la petición, se queda con los valores por defecto).
let visionSettings: VisionFogSettings = DEFAULT_VISION_SETTINGS;
fetch("/settings.json")
  .then((r) => r.json())
  .then((s) => (visionSettings = s))
  .catch(() => {});

// Catálogo de árboles del backoffice, pedido una vez al arrancar. El propio
// juego solo guarda qué árbol y dónde (PlacedTree) — la forma se recalcula
// aquí a partir del TreeDef correspondiente.
let treeDefs: Map<string, TreeDef> = new Map();
fetch("/tree-defs.json")
  .then((r) => r.json())
  .then((defs: TreeDef[]) => (treeDefs = new Map(defs.map((d) => [d.id, d]))))
  .catch(() => {});

function resizeCanvases(): void {
  const dpr = window.devicePixelRatio || 1;
  const w = Math.round(window.innerWidth * dpr);
  const h = Math.round(window.innerHeight * dpr);
  sceneCanvas.width = w;
  sceneCanvas.height = h;
  buffer.width = w;
  buffer.height = h;
  weatherCanvas.width = w;
  weatherCanvas.height = h;
  layout = computeLayout(w, h);
  weather.resize(w, h);
}
window.addEventListener("resize", resizeCanvases);
resizeCanvases();

// Cursor personalizado (punto rojo 4x4, ver flashlight.ts): se oculta el cursor
// nativo por CSS y se sigue la posición aquí, en coordenadas de canvas (píxeles
// reales, contando devicePixelRatio) para poder dibujarlo y para apuntar la linterna.
let cursorPx = { x: 0, y: 0 };
gameEl.addEventListener("mousemove", (ev) => {
  const rect = sceneCanvas.getBoundingClientRect();
  cursorPx = {
    x: ((ev.clientX - rect.left) * sceneCanvas.width) / rect.width,
    y: ((ev.clientY - rect.top) * sceneCanvas.height) / rect.height,
  };
});

// La linterna es puramente un efecto visual del cliente (no se manda al
// servidor ni afecta a la partida), así que su tecla se maneja aparte de
// setupInput, que es solo para acciones que sí viajan como ClientMessage.
let flashlightOn = false;
window.addEventListener("keydown", (ev) => {
  if (ev.key === "l" || ev.key === "L") flashlightOn = !flashlightOn;
});

// Punto de origen de la linterna: la mano derecha del personaje, no el centro
// del cuerpo. Offsets calculados a mano a partir de drawStickGuy (scene.ts):
// baseY (pies) = toScreen().y + TILE_H/2 - 2; el brazo derecho está a x≈6,
// altura de mano y≈-13 relativo a baseY, en las unidades locales del dibujo —
// todo ya multiplicado por el 0.5 al que se escaló el personaje.
function worldToCanvasPx(x: number, y: number): { x: number; y: number } {
  const p = toScreen(x, y);
  const BASE_Y_OFFSET = TILE_H / 2 - 2;
  const HAND_OFFSET_X = 6 * 0.5;
  const HAND_OFFSET_Y = BASE_Y_OFFSET + -13 * 0.5;
  return {
    x: (p.x + HAND_OFFSET_X) * layout.scale + layout.originX,
    y: (p.y + HAND_OFFSET_Y) * layout.scale + layout.originY,
  };
}

// Centro del cuerpo del personaje (no los pies ni la mano): mismo anclaje de
// pies que drawStickGuy (scene.ts, baseY = toScreen().y + TILE_H/2 - 2) menos
// media altura del sprite ya escalado, para apuntar aprox. al torso.
function worldToCanvasCenterPx(x: number, y: number): { x: number; y: number } {
  const p = toScreen(x, y);
  const BASE_Y_OFFSET = TILE_H / 2 - 2;
  const BODY_CENTER_Y_OFFSET = BASE_Y_OFFSET - 10;
  return {
    x: p.x * layout.scale + layout.originX,
    y: (p.y + BODY_CENTER_Y_OFFSET) * layout.scale + layout.originY,
  };
}

let you: PlayerPrivateState | null = null;
let currentScreen: ScreenData | null = null;
let currentNeighbors: NeighborTiles[] = [];
const otherPlayers = new Map<string, PlayerPublicState>();

// Posiciones "de render" con suavizado, para que el movimiento se vea fluido
// aunque el servidor solo envíe actualizaciones a un tick fijo.
let youDisplay = { x: 0, y: 0 };
const otherDisplay = new Map<string, { x: number; y: number }>();

function lerpTowards(current: number, target: number, dt: number, rate = 18): number {
  const t = 1 - Math.exp(-rate * dt);
  return current + (target - current) * t;
}

interface Transition {
  active: boolean;
  dir: Direction;
  start: number;
  duration: number;
  snapshot: HTMLCanvasElement;
}
let transition: Transition | null = null;

// Las 4 direcciones son relativas a la pantalla (arriba/abajo/izq/dcha tal como se ven).
// Este vector es hacia dónde sale la escena VIEJA (la nueva entra por el lado opuesto):
// si sales por arriba, la sala vieja se va hacia abajo y la nueva entra desde arriba.
const SCREEN_DIR_VECTOR: Record<Direction, { x: number; y: number }> = {
  N: { x: 0, y: 1 },
  S: { x: 0, y: -1 },
  W: { x: 1, y: 0 },
  E: { x: -1, y: 0 },
};

function dirVector(dir: Direction): { x: number; y: number } {
  return SCREEN_DIR_VECTOR[dir];
}

let conn: GameConnection | null = null;

function updateHud(): void {
  if (!you) return;
  hpFill.style.width = `${Math.max(0, (you.hp / you.maxHp) * 100)}%`;
  statsEl.textContent = `${you.username} · Nv ${you.level} · XP ${you.xp} · (${you.sx},${you.sy})`;
}

function showDiscovery(tier: ExoticTier, xp: number): void {
  discoveryEl.innerHTML = `<span class="dot"></span> Pantalla descubierta (${tier}) +${xp} XP`;
  discoveryEl.classList.remove("hidden");
  window.setTimeout(() => discoveryEl.classList.add("hidden"), 3500);
}

function findMonster(id: string): MonsterState | undefined {
  return currentScreen?.monsters.find((m) => m.id === id);
}
function findItem(id: string): ItemState | undefined {
  return currentScreen?.items.find((i) => i.id === id);
}

function beginScreenTransition(newScreen: ScreenData): void {
  if (!currentScreen) return;
  const dx = newScreen.sx - currentScreen.sx;
  const dy = newScreen.sy - currentScreen.sy;
  let dir: Direction | null = null;
  if (dx > 0) dir = "E";
  else if (dx < 0) dir = "W";
  else if (dy > 0) dir = "S";
  else if (dy < 0) dir = "N";
  if (!dir) return;

  const snapshot = document.createElement("canvas");
  snapshot.width = sceneCanvas.width;
  snapshot.height = sceneCanvas.height;
  snapshot.getContext("2d")!.drawImage(sceneCanvas, 0, 0);

  transition = { active: true, dir, start: performance.now(), duration: 380, snapshot };
}

function handleServerMessage(msg: ServerMessage): void {
  switch (msg.type) {
    case "joined":
      you = msg.you;
      youDisplay = { x: you.x, y: you.y };
      loginEl.classList.add("hidden");
      gameEl.classList.remove("hidden");
      updateHud();
      refreshGamepadUi();
      break;
    case "screen":
      if (currentScreen && (currentScreen.sx !== msg.screen.sx || currentScreen.sy !== msg.screen.sy)) {
        beginScreenTransition(msg.screen);
      }
      currentScreen = msg.screen;
      currentNeighbors = msg.neighbors;
      ensureTilesetFor(msg.screen.biome);
      otherPlayers.clear();
      otherDisplay.clear();
      for (const p of msg.players) {
        otherPlayers.set(p.username, p);
        otherDisplay.set(p.username, { x: p.x, y: p.y });
      }
      weather.setWeather(pickWeather(msg.screen.sx, msg.screen.sy));
      screenCodeEl.textContent = `${msg.screen.biome} · ${msg.screen.code}`;
      updateHud();
      break;
    case "playerUpdate":
      otherPlayers.set(msg.player.username, msg.player);
      if (!otherDisplay.has(msg.player.username)) {
        otherDisplay.set(msg.player.username, { x: msg.player.x, y: msg.player.y });
      }
      break;
    case "playerLeft":
      otherPlayers.delete(msg.username);
      otherDisplay.delete(msg.username);
      break;
    case "youUpdate":
      you = msg.you;
      updateHud();
      break;
    case "monsterUpdate": {
      const m = findMonster(msg.monster.id);
      if (m) Object.assign(m, msg.monster);
      else currentScreen?.monsters.push(msg.monster);
      break;
    }
    case "itemUpdate": {
      const i = findItem(msg.item.id);
      if (i) Object.assign(i, msg.item);
      else currentScreen?.items.push(msg.item);
      break;
    }
    case "discovery":
      showDiscovery(msg.tier, msg.xp);
      break;
    case "died":
      alert("Has muerto. Tu personaje se ha perdido para siempre.");
      resetToLogin();
      break;
    case "error":
      loginError.textContent = msg.message;
      break;
    case "visionSettings":
      // Cambios desde el backoffice: se aplican al momento, sin recargar.
      visionSettings = msg.settings;
      break;
  }
}

// ---- Mando: teclado en pantalla e hints de botón en la UI ----
// Solo hace falta en la pantalla de login (el único formulario de texto del
// juego); el resto de la UI son HUD de solo lectura, sin más botones.
const KEY_ROWS: string[][] = [
  ["1", "2", "3", "4", "5", "6", "7", "8", "9", "0"],
  ["Q", "W", "E", "R", "T", "Y", "U", "I", "O", "P"],
  ["A", "S", "D", "F", "G", "H", "J", "K", "L", "Ñ"],
  ["Z", "X", "C", "V", "B", "N", "M", "⌫", "␣", "OK"],
];

let gamepadConnected = false;
let keySelRow = 0;
let keySelCol = 0;
let prevGamepadDirs: InputState = { N: false, S: false, E: false, W: false };
const submitBtnBaseText = submitBtn.textContent ?? "Entrar";

function updateKeyboardSelection(): void {
  gamepadKeyboardEl.querySelectorAll(".kb-row").forEach((rowEl, r) => {
    rowEl.querySelectorAll(".kb-key").forEach((keyEl, c) => {
      keyEl.classList.toggle("active", r === keySelRow && c === keySelCol);
    });
  });
}

function moveKeySelection(dir: Direction): void {
  if (dir === "N") keySelRow = (keySelRow - 1 + KEY_ROWS.length) % KEY_ROWS.length;
  else if (dir === "S") keySelRow = (keySelRow + 1) % KEY_ROWS.length;
  keySelCol = Math.min(keySelCol, KEY_ROWS[keySelRow].length - 1);
  if (dir === "W") keySelCol = (keySelCol - 1 + KEY_ROWS[keySelRow].length) % KEY_ROWS[keySelRow].length;
  else if (dir === "E") keySelCol = (keySelCol + 1) % KEY_ROWS[keySelRow].length;
  updateKeyboardSelection();
}

function activateKey(key: string): void {
  if (key === "⌫") usernameInput.value = usernameInput.value.slice(0, -1);
  else if (key === "␣") usernameInput.value = (usernameInput.value + " ").slice(0, 20);
  else if (key === "OK") loginForm.requestSubmit();
  else usernameInput.value = (usernameInput.value + key).slice(0, 20);
}

function buildGamepadKeyboard(): void {
  gamepadKeyboardEl.innerHTML = "";
  KEY_ROWS.forEach((row, r) => {
    const rowEl = document.createElement("div");
    rowEl.className = "kb-row";
    row.forEach((key, c) => {
      const keyEl = document.createElement("button");
      keyEl.type = "button";
      keyEl.className = "kb-key";
      keyEl.textContent = key;
      keyEl.addEventListener("click", () => {
        keySelRow = r;
        keySelCol = c;
        updateKeyboardSelection();
        activateKey(key);
      });
      rowEl.appendChild(keyEl);
    });
    gamepadKeyboardEl.appendChild(rowEl);
  });
  updateKeyboardSelection();
}
buildGamepadKeyboard();

// Se llama al conectar/desconectar el mando y al mostrar/ocultar el login:
// el teclado de apoyo solo tiene sentido con mando Y en la pantalla de login,
// y el hint de qué botón pulsar solo tiene sentido con mando detectado.
function refreshGamepadUi(): void {
  const onLogin = !loginEl.classList.contains("hidden");
  gamepadKeyboardEl.classList.toggle("hidden", !(gamepadConnected && onLogin));
  gamepadHintEl.classList.toggle("hidden", !(gamepadConnected && onLogin));
  if (gamepadConnected && onLogin) {
    gamepadHintEl.textContent = `Mando detectado — mueve el stick/D-pad para elegir letra, (${GAMEPAD_BUTTON_LABELS[0]}) selecciona, (${GAMEPAD_BUTTON_LABELS[2]}) borra, (${GAMEPAD_BUTTON_LABELS[START_BUTTON]}) envía.`;
  }
  submitBtn.textContent = gamepadConnected ? `${submitBtnBaseText} (${GAMEPAD_BUTTON_LABELS[START_BUTTON]})` : submitBtnBaseText;
}

function handleGamepadConnectedChange(connected: boolean): void {
  gamepadConnected = connected;
  refreshGamepadUi();
}

function handleGamepadDirs(dirs: InputState): void {
  if (gamepadConnected && !loginEl.classList.contains("hidden")) {
    (Object.keys(dirs) as Array<keyof InputState>).forEach((d) => {
      if (dirs[d] && !prevGamepadDirs[d]) moveKeySelection(d);
    });
    prevGamepadDirs = dirs;
    return;
  }
  prevGamepadDirs = dirs;
  conn?.send({ type: "input", dirs });
}

function handleGamepadAttack(): void {
  if (gamepadConnected && !loginEl.classList.contains("hidden")) {
    activateKey(KEY_ROWS[keySelRow][keySelCol]);
    return;
  }
  conn?.send({ type: "attack" });
}

function handleGamepadPickup(): void {
  if (gamepadConnected && !loginEl.classList.contains("hidden")) {
    activateKey("⌫");
    return;
  }
  conn?.send({ type: "pickup" });
}

function handleGamepadStart(): void {
  if (!loginEl.classList.contains("hidden")) loginForm.requestSubmit();
}

function handleRightStick(dx: number, dy: number): void {
  cursorPx = {
    x: Math.max(0, Math.min(sceneCanvas.width, cursorPx.x + dx)),
    y: Math.max(0, Math.min(sceneCanvas.height, cursorPx.y + dy)),
  };
}

function resetToLogin(): void {
  conn?.close();
  conn = null;
  you = null;
  currentScreen = null;
  otherPlayers.clear();
  otherDisplay.clear();
  transition = null;
  gameEl.classList.add("hidden");
  loginEl.classList.remove("hidden");
  refreshGamepadUi();
}

loginForm.addEventListener("submit", async (ev) => {
  ev.preventDefault();
  loginError.textContent = "";
  const username = usernameInput.value.trim();
  if (!username) return;

  conn = new GameConnection(handleServerMessage, () => {
    if (you) {
      loginError.textContent = "Conexión perdida con el servidor";
      resetToLogin();
    }
  });
  await conn.waitOpen();
  conn.send({ type: "join", username });
});

setupInput(
  (dirs: InputState) => conn?.send({ type: "input", dirs }),
  () => conn?.send({ type: "attack" }),
  () => conn?.send({ type: "pickup" })
);

setupGamepad(handleGamepadDirs, handleGamepadAttack, handleGamepadPickup, handleGamepadStart, handleRightStick, handleGamepadConnectedChange);

let lastTime = performance.now();
function frame(now: number): void {
  const dt = Math.min(0.1, (now - lastTime) / 1000);
  lastTime = now;
  const time = now / 1000;

  if (you && currentScreen && tileset) {
    youDisplay.x = lerpTowards(youDisplay.x, you.x, dt);
    youDisplay.y = lerpTowards(youDisplay.y, you.y, dt);
    for (const [username, p] of otherPlayers) {
      const d = otherDisplay.get(username) ?? { x: p.x, y: p.y };
      d.x = lerpTowards(d.x, p.x, dt);
      d.y = lerpTowards(d.y, p.y, dt);
      otherDisplay.set(username, d);
    }

    const youDrawn = { ...you, x: youDisplay.x, y: youDisplay.y };
    const othersDrawn = [...otherPlayers.values()].map((p) => {
      const d = otherDisplay.get(p.username)!;
      return { ...p, x: d.x, y: d.y };
    });

    const w = sceneCanvas.width;
    const h = sceneCanvas.height;

    if (transition?.active) {
      const t = Math.min(1, (now - transition.start) / transition.duration);
      const ease = 1 - Math.pow(1 - t, 3);
      const vec = dirVector(transition.dir);
      // Distancia de deslizamiento = tamaño del canvas en el eje del movimiento,
      // así la escena vieja y la nueva encajan sin huecos ni solapes en todo momento.
      const K = vec.x !== 0 ? w : h;

      renderScene(bufferCtx, w, h, layout, tileset, currentScreen, currentNeighbors, treeDefs, othersDrawn, youDrawn, time);

      sceneCtx.clearRect(0, 0, w, h);
      sceneCtx.save();
      sceneCtx.translate(vec.x * ease * K, vec.y * ease * K);
      sceneCtx.drawImage(transition.snapshot, 0, 0);
      sceneCtx.restore();

      sceneCtx.save();
      sceneCtx.translate(vec.x * (ease - 1) * K, vec.y * (ease - 1) * K);
      sceneCtx.drawImage(buffer, 0, 0);
      sceneCtx.restore();

      if (t >= 1) transition = null;
    } else {
      renderScene(bufferCtx, w, h, layout, tileset, currentScreen, currentNeighbors, treeDefs, othersDrawn, youDrawn, time);
      if (weather.getType() === "heat") {
        applyHeatShimmer(sceneCtx, buffer, time);
      } else {
        sceneCtx.clearRect(0, 0, w, h);
        sceneCtx.drawImage(buffer, 0, 0);
      }
    }

    // La niebla de visión (difuminado N/S/E/O) actúa sobre la escena en crudo,
    // antes que cualquier efecto de color — así el tinte de día/noche se aplica
    // por igual a la zona nítida y a la difuminada, en vez de quedar él mismo
    // borroso en los bordes.
    const fogCenter = worldToCanvasCenterPx(youDisplay.x, youDisplay.y);
    applyEdgeBlur(
      sceneCtx,
      sceneCanvas,
      w,
      h,
      time,
      visionSettings.sharpFraction,
      visionSettings.vibration,
      visionSettings.ellipseScale,
      visionSettings.blurStrength,
      fogCenter.x,
      fogCenter.y
    );

    const dn = getDayNight();
    applyDayNightOverlay(sceneCtx, w, h, dn);

    // Linterna: se enciende/apaga con L. El cono sale del personaje y apunta
    // hacia donde esté el cursor, perforando la oscuridad (mezcla aditiva).
    if (flashlightOn) {
      const origin = worldToCanvasPx(youDisplay.x, youDisplay.y);
      applyFlashlight(sceneCtx, origin.x, origin.y, cursorPx.x, cursorPx.y, dn.darkness);
    }

    // Aberración cromática: último paso, solo sobre la escena (nunca el HUD, que
    // vive en elementos DOM aparte y en el canvas de clima).
    applyChromaticAberration(sceneCtx, sceneCanvas, w, h, visionSettings.chromaticAberration);
  }

  weather.update(dt);
  weather.render(weatherCtx);
  drawCursorDot(weatherCtx, cursorPx.x, cursorPx.y);

  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
