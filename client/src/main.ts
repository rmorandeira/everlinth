import "./style.css";
import {
  DEFAULT_VISION_SETTINGS,
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
import { WeatherSystem, pickWeather } from "./render/weather.js";
import { drawCursorDot } from "./render/flashlight.js";
import { createScene3D } from "./render3d/scene3d.js";

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

const weatherCtx = weatherCanvas.getContext("2d")!;
const weather = new WeatherSystem();

// Fase 0 de la migración a 3D (ver plan en .claude/plans): el canvas #scene,
// que antes tenía un contexto 2D, ahora lo posee three.js por completo.
const scene3d = createScene3D(sceneCanvas);

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
  scene3d.renderer.setPixelRatio(dpr);
  scene3d.resize(window.innerWidth, window.innerHeight);
  weatherCanvas.width = w;
  weatherCanvas.height = h;
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

// La linterna (SpotLight real), la niebla de visión (THREE.Fog) y el
// día/noche (luces reales) vuelven en la Fase 4 del plan 3D — de momento el
// cursor personalizado se mantiene solo para el canvas de clima.

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

// La transición deslizante entre pantallas (captura+desliza dos canvas 2D) no
// aplica a un mundo 3D continuo — Fase 6 del plan decidirá su reemplazo
// (probablemente un barrido de cámara). De momento el cambio de sala es
// instantáneo.

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
      currentScreen = msg.screen;
      currentNeighbors = msg.neighbors;
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

  if (you && currentScreen) {
    youDisplay.x = lerpTowards(youDisplay.x, you.x, dt);
    youDisplay.y = lerpTowards(youDisplay.y, you.y, dt);
    for (const [username, p] of otherPlayers) {
      const d = otherDisplay.get(username) ?? { x: p.x, y: p.y };
      d.x = lerpTowards(d.x, p.x, dt);
      d.y = lerpTowards(d.y, p.y, dt);
      otherDisplay.set(username, d);
    }

    // Fase 2: terreno + obstáculos + árboles procedurales 3D (ver plan).
    // Jugadores/efectos todavía no. scene.y del juego (fila) es la Z de mundo
    // en three.js.
    scene3d.updateGround(currentScreen, currentNeighbors, treeDefs);
    scene3d.render(youDisplay.x, youDisplay.y, time);
  }

  weather.update(dt);
  weather.render(weatherCtx);
  drawCursorDot(weatherCtx, cursorPx.x, cursorPx.y);

  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
