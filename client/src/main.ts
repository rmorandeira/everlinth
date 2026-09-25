import "./style.css";
import {
  DEFAULT_VISION_SETTINGS,
  SCREEN_HEIGHT,
  SCREEN_WIDTH,
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
import { drawCursorDot } from "./render/cursor.js";
import { createScene3D } from "./render3d/scene3d.js";
import { createMinimap, type MinimapDot } from "./render/minimap.js";
import { unlockAudio, playStep } from "./audio.js";
import { MONSTER_COLORS, MONSTER_COLOR_DEFAULT, type FigureEntity } from "./render3d/figures3d.js";

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
const minimap = createMinimap(document.getElementById("minimap") as HTMLCanvasElement);
(window as unknown as { __scene3d: unknown }).__scene3d = scene3d; // hook de depuración (renderer.info)

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

// Cursor personalizado (punto rojo 4x4, ver render/cursor.ts): se oculta el cursor
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
  // Q/R: girar la cámara 90° (se reenvía el input para que las teclas pulsadas
  // sigan significando "arriba/abajo/izq/dcha" de la pantalla nueva).
  if (ev.key === "q" || ev.key === "Q") {
    scene3d.rotateCamera(-1);
    sendDirs(lastDirs);
  }
  if (ev.key === "r" || ev.key === "R") {
    scene3d.rotateCamera(1);
    sendDirs(lastDirs);
  }
});

let you: PlayerPrivateState | null = null;
let currentScreen: ScreenData | null = null;
let currentNeighbors: NeighborTiles[] = [];
const otherPlayers = new Map<string, PlayerPublicState>();

// Posiciones "de render" con suavizado, para que el movimiento se vea fluido
// aunque el servidor solo envíe actualizaciones a un tick fijo.
let youDisplay = { x: 0, y: 0 };
const otherDisplay = new Map<string, { x: number; y: number }>();
// Zombis: posiciones GLOBALES (sala*tamaño + local), suavizadas entre snapshots.
const zombieTargets = new Map<number, { gx: number; gy: number }>();
const zombieDisplay = new Map<number, { gx: number; gy: number }>();
const ZOMBIE_COLOR = 0x5b8f45;
let aimAngle = 0;
const STRIDE = 1.4; // tiles entre pisadas (≈2 m, zancada de carrera)
let strideAcc = 0;
let firing = false;
let lastShotAt = 0;

function lerpTowards(current: number, target: number, dt: number, rate = 18): number {
  const t = 1 - Math.exp(-rate * dt);
  return current + (target - current) * t;
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
        // El mundo se re-basa en la sala nueva (offset 0): desplazar la posición
        // suavizada la misma cantidad mantiene al jugador y a la cámara donde
        // estaban, en vez de deslizarlos por toda la sala nueva.
        youDisplay.x += (currentScreen.sx - msg.screen.sx) * SCREEN_WIDTH;
        youDisplay.y += (currentScreen.sy - msg.screen.sy) * SCREEN_HEIGHT;
      }
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
    case "zombies": {
      zombieTargets.clear();
      for (const z of msg.zombies) {
        zombieTargets.set(z.id, { gx: z.gx, gy: z.gy });
        if (!zombieDisplay.has(z.id)) zombieDisplay.set(z.id, { gx: z.gx, gy: z.gy });
      }
      for (const id of zombieDisplay.keys()) if (!zombieTargets.has(id)) zombieDisplay.delete(id);
      break;
    }
    case "shot":
      if (currentScreen) {
        const ox = currentScreen.sx * SCREEN_WIDTH;
        const oy = currentScreen.sy * SCREEN_HEIGHT;
        scene3d.addTracer(msg.from.gx - ox, msg.from.gy - oy, msg.to.gx - ox, msg.to.gy - oy);
      }
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

// Las direcciones del jugador son relativas a la PANTALLA; el servidor las traduce a
// diagonales del mundo suponiendo la vista base. Con la cámara girada k cuartos de
// vuelta, "arriba en pantalla" es la dirección de servidor k pasos más allá en el
// ciclo N → E → S → W (cada una es la anterior girada 90°).
const DIR_CYCLE: Array<keyof InputState> = ["N", "E", "S", "W"];
let lastDirs: InputState = { N: false, S: false, E: false, W: false };
function sendDirs(dirs: InputState): void {
  lastDirs = dirs;
  const k = scene3d.cameraStep();
  const out: InputState = { N: false, S: false, E: false, W: false };
  DIR_CYCLE.forEach((d, i) => {
    if (dirs[d]) out[DIR_CYCLE[(i + k) % 4]] = true;
  });
  conn?.send({ type: "input", dirs: out });
}
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
  sendDirs(dirs);
}

// Un pequeño acercamiento de cámara al atacar/recoger (ver Fase 5 del plan
// 3D): mismo hook setCameraMood que el cambio de pantalla y el descubrimiento,
// disparado desde el único punto por el que pasan tanto teclado como mando.
function sendAttack(): void {
  conn?.send({ type: "attack" });
  fireGun();
}

// Ametralladora: dispara hacia el punto del suelo bajo el cursor (botón izquierdo
// del ratón, mantenido = ráfaga; el servidor limita la cadencia).
function fireGun(): void {
  if (!you) return;
  const g = scene3d.cursorToGround((cursorPx.x / sceneCanvas.width) * 2 - 1, -(cursorPx.y / sceneCanvas.height) * 2 + 1);
  if (!g) return;
  const dx = g.x - youDisplay.x;
  const dz = g.z - youDisplay.y;
  if (Math.hypot(dx, dz) < 0.05) return;
  conn?.send({ type: "shoot", dx, dz });
}
gameEl.addEventListener("mousedown", (ev) => {
  if (ev.button === 0) firing = true;
});
window.addEventListener("mouseup", (ev) => {
  if (ev.button === 0) firing = false;
});
window.addEventListener("blur", () => {
  firing = false;
});

function sendPickup(): void {
  conn?.send({ type: "pickup" });
}

function handleGamepadAttack(): void {
  if (gamepadConnected && !loginEl.classList.contains("hidden")) {
    activateKey(KEY_ROWS[keySelRow][keySelCol]);
    return;
  }
  sendAttack();
}

function handleGamepadPickup(): void {
  if (gamepadConnected && !loginEl.classList.contains("hidden")) {
    activateKey("⌫");
    return;
  }
  sendPickup();
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
  unlockAudio(); // el login es un gesto del usuario: el navegador deja arrancar el audio
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
  (dirs: InputState) => sendDirs(dirs),
  sendAttack,
  sendPickup
);

setupGamepad(handleGamepadDirs, handleGamepadAttack, handleGamepadPickup, handleGamepadStart, handleRightStick, handleGamepadConnectedChange);

let lastTime = performance.now();
function frame(now: number): void {
  const dt = Math.min(0.1, (now - lastTime) / 1000);
  lastTime = now;
  const time = now / 1000;

  if (you && currentScreen) {
    const prevX = youDisplay.x;
    const prevY = youDisplay.y;
    youDisplay.x = lerpTowards(youDisplay.x, you.x, dt);
    youDisplay.y = lerpTowards(youDisplay.y, you.y, dt);
    // Pasos: una pisada cada STRIDE tiles recorridos (a la velocidad del jugador,
    // ~5 pisadas por segundo: carrera). Los saltos grandes (re-base al cambiar de
    // sala) no cuentan.
    const moved = Math.hypot(youDisplay.x - prevX, youDisplay.y - prevY);
    if (moved < 2) {
      strideAcc += moved;
      if (strideAcc >= STRIDE) {
        strideAcc -= STRIDE;
        playStep(0.9);
      }
    }
    for (const [username, p] of otherPlayers) {
      const d = otherDisplay.get(username) ?? { x: p.x, y: p.y };
      d.x = lerpTowards(d.x, p.x, dt);
      d.y = lerpTowards(d.y, p.y, dt);
      otherDisplay.set(username, d);
    }

    // Fase 4: terreno + obstáculos + árboles + jugadores/monstruos + luz/
    // niebla/linterna reales en 3D (ver plan). scene.y del juego (fila) es
    // la Z de mundo en three.js.
    scene3d.updateGround(currentScreen, currentNeighbors, treeDefs);
    minimap.update(currentScreen, currentNeighbors);

    const entities: FigureEntity[] = [
      { id: you.username, x: youDisplay.x, z: youDisplay.y, color: 0xf0f0f0, label: you.username, armed: true, facing: aimAngle },
    ];
    for (const [username, p] of otherPlayers) {
      const d = otherDisplay.get(username)!;
      entities.push({ id: username, x: d.x, z: d.y, color: 0x3ba0e0, label: username, armed: true });
    }
    const zox = currentScreen.sx * SCREEN_WIDTH;
    const zoy = currentScreen.sy * SCREEN_HEIGHT;
    for (const [id, d] of zombieDisplay) {
      const t = zombieTargets.get(id);
      if (t) {
        d.gx = lerpTowards(d.gx, t.gx, dt, 14);
        d.gy = lerpTowards(d.gy, t.gy, dt, 14);
      }
      entities.push({ id: `z${id}`, x: d.gx - zox, z: d.gy - zoy, color: ZOMBIE_COLOR });
    }
    for (const m of currentScreen.monsters) {
      if (!m.alive) continue;
      entities.push({ id: m.id, x: m.x, z: m.y, color: MONSTER_COLORS[m.kind] ?? MONSTER_COLOR_DEFAULT, label: m.kind });
    }
    scene3d.updateFigures(entities, time);

    // Coordenadas normalizadas (-1..1, Y hacia arriba) del cursor para el
    // raycast de la linterna contra el suelo — misma conversión estándar de
    // three.js, a partir del cursor ya trackeado en píxeles de canvas.
    const cursorNdcX = (cursorPx.x / sceneCanvas.width) * 2 - 1;
    const cursorNdcY = -(cursorPx.y / sceneCanvas.height) * 2 + 1;
    // Apuntado: el jugador mira hacia el cursor; con el botón mantenido, ráfaga.
    const aim = scene3d.cursorToGround(cursorNdcX, cursorNdcY);
    if (aim) aimAngle = Math.atan2(aim.x - youDisplay.x, aim.z - youDisplay.y);
    if (firing && now - lastShotAt >= 90) {
      lastShotAt = now;
      fireGun();
    }
    {
      const ox = currentScreen.sx * SCREEN_WIDTH;
      const oy = currentScreen.sy * SCREEN_HEIGHT;
      const dots: MinimapDot[] = [];
      for (const m of currentScreen.monsters) if (m.alive) dots.push({ gx: ox + m.x, gy: oy + m.y, color: "#e0a030", r: 1.3 });
      for (const d of zombieDisplay.values()) dots.push({ gx: d.gx, gy: d.gy, color: "#e03a3a", r: 1.3 });
      for (const d of otherDisplay.values()) dots.push({ gx: ox + d.x, gy: oy + d.y, color: "#3ba0e0", r: 1.6 });
      minimap.draw(ox + youDisplay.x, oy + youDisplay.y, aimAngle, dots, scene3d.cameraYaw());
    }
    scene3d.render(youDisplay.x, youDisplay.y, time, dt, visionSettings, { enabled: flashlightOn, cursorNdcX, cursorNdcY }, weather.getType() === "heat" ? 1 : 0);
  }

  weather.update(dt);
  weather.render(weatherCtx);
  drawCursorDot(weatherCtx, cursorPx.x, cursorPx.y);

  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
