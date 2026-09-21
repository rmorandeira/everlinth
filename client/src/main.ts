import "./style.css";
import type {
  ExoticTier,
  ItemState,
  MonsterState,
  PlayerPrivateState,
  PlayerPublicState,
  ScreenData,
  ServerMessage,
} from "@roi/shared";
import { GameConnection } from "./net.js";
import { setupInput } from "./input.js";
import { renderScene, SCENE_W, SCENE_H } from "./render/scene.js";
import { getDayNight, applyDayNightOverlay } from "./render/daynight.js";
import { WeatherSystem, applyHeatShimmer, pickWeather } from "./render/weather.js";

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

sceneCanvas.width = SCENE_W;
sceneCanvas.height = SCENE_H;
const sceneCtx = sceneCanvas.getContext("2d")!;

const buffer = document.createElement("canvas");
buffer.width = SCENE_W;
buffer.height = SCENE_H;
const bufferCtx = buffer.getContext("2d")!;

const weatherCtx = weatherCanvas.getContext("2d")!;
const weather = new WeatherSystem();

function resizeWeatherCanvas(): void {
  const dpr = window.devicePixelRatio || 1;
  weatherCanvas.width = window.innerWidth * dpr;
  weatherCanvas.height = window.innerHeight * dpr;
  weatherCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
  weather.resize(window.innerWidth, window.innerHeight);
}
window.addEventListener("resize", resizeWeatherCanvas);
resizeWeatherCanvas();

let you: PlayerPrivateState | null = null;
let currentScreen: ScreenData | null = null;
const otherPlayers = new Map<string, PlayerPublicState>();
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
      loginEl.classList.add("hidden");
      gameEl.classList.remove("hidden");
      updateHud();
      break;
    case "screen":
      currentScreen = msg.screen;
      otherPlayers.clear();
      for (const p of msg.players) otherPlayers.set(p.username, p);
      weather.setWeather(pickWeather(msg.screen.sx, msg.screen.sy));
      updateHud();
      break;
    case "playerUpdate":
      otherPlayers.set(msg.player.username, msg.player);
      break;
    case "playerLeft":
      otherPlayers.delete(msg.username);
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
  (dir) => conn?.send({ type: "move", dir }),
  () => conn?.send({ type: "pickup" })
);

let lastTime = performance.now();
function frame(now: number): void {
  const dt = Math.min(0.1, (now - lastTime) / 1000);
  lastTime = now;
  const time = now / 1000;

  if (you && currentScreen) {
    renderScene(bufferCtx, currentScreen, [...otherPlayers.values()], you, time);

    const dn = getDayNight();
    if (weather.getType() === "heat") {
      applyHeatShimmer(sceneCtx, buffer, time);
    } else {
      sceneCtx.clearRect(0, 0, SCENE_W, SCENE_H);
      sceneCtx.drawImage(buffer, 0, 0);
    }
    applyDayNightOverlay(sceneCtx, SCENE_W, SCENE_H, dn);
  }

  weather.update(dt);
  weather.render(weatherCtx);

  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
