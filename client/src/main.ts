import "./style.css";
import {
  type Direction,
  type ExoticTier,
  type InputState,
  type ItemState,
  type MonsterState,
  type PlayerPrivateState,
  type PlayerPublicState,
  type ScreenData,
  type ServerMessage,
} from "@roi/shared";
import { GameConnection } from "./net.js";
import { setupInput } from "./input.js";
import { setupGamepad } from "./gamepad.js";
import { renderScene, computeLayout, type Layout, type Tileset } from "./render/scene.js";
import { getDayNight, applyDayNightOverlay } from "./render/daynight.js";
import { WeatherSystem, applyHeatShimmer, pickWeather } from "./render/weather.js";
import { loadTileset } from "./render/tileset.js";

const loginEl = document.getElementById("login") as HTMLDivElement;
const loginForm = document.getElementById("login-form") as HTMLFormElement;
const usernameInput = document.getElementById("username") as HTMLInputElement;
const loginError = document.getElementById("login-error") as HTMLParagraphElement;
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
loadTileset().then((t) => (tileset = t));

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

let you: PlayerPrivateState | null = null;
let currentScreen: ScreenData | null = null;
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
      break;
    case "screen":
      if (currentScreen && (currentScreen.sx !== msg.screen.sx || currentScreen.sy !== msg.screen.sy)) {
        beginScreenTransition(msg.screen);
      }
      currentScreen = msg.screen;
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
  }
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

setupGamepad(
  (dirs: InputState) => conn?.send({ type: "input", dirs }),
  () => conn?.send({ type: "attack" }),
  () => conn?.send({ type: "pickup" })
);

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

      renderScene(bufferCtx, w, h, layout, tileset, currentScreen, othersDrawn, youDrawn, time);

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
      renderScene(bufferCtx, w, h, layout, tileset, currentScreen, othersDrawn, youDrawn, time);
      if (weather.getType() === "heat") {
        applyHeatShimmer(sceneCtx, buffer, time);
      } else {
        sceneCtx.clearRect(0, 0, w, h);
        sceneCtx.drawImage(buffer, 0, 0);
      }
    }

    const dn = getDayNight();
    applyDayNightOverlay(sceneCtx, w, h, dn);
  }

  weather.update(dt);
  weather.render(weatherCtx);

  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
