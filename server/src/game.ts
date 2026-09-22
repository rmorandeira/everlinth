import type { WebSocket } from "ws";
import {
  SCREEN_WIDTH,
  SCREEN_HEIGHT,
  BLOCKING_TILES,
  TICK_MS,
  PLAYER_SPEED,
  ATTACK_RANGE,
  PICKUP_RANGE,
  WORLD_MIN,
  WORLD_MAX,
  screenKey,
  type ClientMessage,
  type ServerMessage,
  type PlayerPrivateState,
  type PlayerPublicState,
  type Direction,
  type ScreenData,
  type InputState,
  type NeighborTiles,
} from "@roi/shared";
import { getScreen, saveScreen, getPlayer, savePlayer, deletePlayer } from "./db.js";
import { generateScreen } from "./worldgen.js";
import { MONSTER_KINDS } from "./content.js";

const NO_INPUT: InputState = { N: false, S: false, E: false, W: false };

interface Connection {
  socket: WebSocket;
  username: string | null;
  input: InputState;
}

function send(socket: WebSocket, msg: ServerMessage): void {
  if (socket.readyState === socket.OPEN) socket.send(JSON.stringify(msg));
}

function toPublic(p: PlayerPrivateState): PlayerPublicState {
  const { inventory, ...pub } = p;
  return pub;
}

function xpForNextLevel(level: number): number {
  return level * 20;
}

function dist(ax: number, ay: number, bx: number, by: number): number {
  return Math.hypot(ax - bx, ay - by);
}

export class GameServer {
  private connections = new Set<Connection>();
  private players = new Map<string, PlayerPrivateState>();
  private screenRooms = new Map<string, Set<Connection>>();
  private connByUsername = new Map<string, Connection>();
  private screenCache = new Map<string, ScreenData>();

  constructor() {
    setInterval(() => this.tick(), TICK_MS);
    setInterval(() => this.autosave(), 3000);
  }

  handleConnection(socket: WebSocket): void {
    const conn: Connection = { socket, username: null, input: { ...NO_INPUT } };
    this.connections.add(conn);

    socket.on("message", (raw: Buffer) => {
      let msg: ClientMessage;
      try {
        msg = JSON.parse(raw.toString());
      } catch {
        return;
      }
      this.handleMessage(conn, msg);
    });

    socket.on("close", () => {
      this.connections.delete(conn);
      if (conn.username) this.disconnectPlayer(conn);
    });
  }

  private disconnectPlayer(conn: Connection): void {
    const username = conn.username!;
    const player = this.players.get(username);
    if (player) {
      savePlayer(player);
      this.leaveScreenRoom(conn, screenKey({ sx: player.sx, sy: player.sy }));
      this.broadcastToScreen(player.sx, player.sy, { type: "playerLeft", username }, conn);
    }
    this.players.delete(username);
    this.connByUsername.delete(username);
    conn.username = null;
  }

  private autosave(): void {
    for (const player of this.players.values()) savePlayer(player);
  }

  private handleMessage(conn: Connection, msg: ClientMessage): void {
    if (msg.type === "join") {
      this.handleJoin(conn, msg.username);
      return;
    }
    if (!conn.username) return;
    const player = this.players.get(conn.username);
    if (!player) return;

    if (msg.type === "input") conn.input = msg.dirs;
    else if (msg.type === "attack") this.handleAttack(conn, player);
    else if (msg.type === "pickup") this.handlePickup(conn, player);
  }

  private handleJoin(conn: Connection, usernameRaw: string): void {
    const username = usernameRaw.trim().slice(0, 20);
    if (!username) {
      send(conn.socket, { type: "error", message: "Nombre inválido" });
      return;
    }
    if (this.connByUsername.has(username)) {
      send(conn.socket, { type: "error", message: "Ese usuario ya está conectado" });
      return;
    }

    let player = getPlayer(username);
    if (!player) {
      player = {
        username,
        sx: 0,
        sy: 0,
        x: SCREEN_WIDTH / 2,
        y: SCREEN_HEIGHT / 2,
        hp: 20,
        maxHp: 20,
        level: 1,
        xp: 0,
        facing: "S",
        inventory: [],
      };
      savePlayer(player);
    }

    conn.username = username;
    conn.input = { ...NO_INPUT };
    this.players.set(username, player);
    this.connByUsername.set(username, conn);

    send(conn.socket, { type: "joined", you: player });
    this.enterScreen(conn, player, player.sx, player.sy, false);
  }

  private ensureScreenLoaded(sx: number, sy: number): { screen: ScreenData; discoveryXp: number | null } {
    const key = screenKey({ sx, sy });
    const cached = this.screenCache.get(key);
    if (cached) return { screen: cached, discoveryXp: null };

    const existing = getScreen(sx, sy);
    if (existing) {
      this.screenCache.set(key, existing);
      return { screen: existing, discoveryXp: null };
    }

    const { screen, discoveryXp } = generateScreen(sx, sy);
    saveScreen(screen);
    this.screenCache.set(key, screen);
    return { screen, discoveryXp };
  }

  // Radio de estancias vecinas cuyo terreno (solo tiles, sin monstruos/objetos) se
  // manda junto a la sala activa, para que el margen que rellena la pantalla en la
  // vista isométrica sea contenido real generado y persistido, no relleno falso.
  // Más radio en Y que en X porque cada fila de tiles cubre menos alto de pantalla
  // que una columna de ancho (proyección 2:1): hace falta más alcance vertical para
  // cubrir el mismo margen visible.
  private static readonly NEIGHBOR_RADIUS_X = 1;
  private static readonly NEIGHBOR_RADIUS_Y = 2;

  private neighborTiles(sx: number, sy: number): NeighborTiles[] {
    const neighbors: NeighborTiles[] = [];
    for (let dy = -GameServer.NEIGHBOR_RADIUS_Y; dy <= GameServer.NEIGHBOR_RADIUS_Y; dy++) {
      for (let dx = -GameServer.NEIGHBOR_RADIUS_X; dx <= GameServer.NEIGHBOR_RADIUS_X; dx++) {
        if (dx === 0 && dy === 0) continue;
        const nsx = sx + dx;
        const nsy = sy + dy;
        if (nsx < WORLD_MIN || nsx > WORLD_MAX || nsy < WORLD_MIN || nsy > WORLD_MAX) continue;
        const { screen } = this.ensureScreenLoaded(nsx, nsy);
        neighbors.push({ sx: nsx, sy: nsy, tiles: screen.tiles, placedTrees: screen.placedTrees });
      }
    }
    return neighbors;
  }

  private enterScreen(conn: Connection, player: PlayerPrivateState, sx: number, sy: number, awardDiscovery: boolean): void {
    const { screen, discoveryXp } = this.ensureScreenLoaded(sx, sy);
    const neighbors = this.neighborTiles(sx, sy);

    const key = screenKey({ sx, sy });
    this.joinScreenRoom(conn, key);

    const others: PlayerPublicState[] = [];
    for (const other of this.screenRooms.get(key) ?? []) {
      if (other === conn || !other.username) continue;
      const op = this.players.get(other.username);
      if (op) others.push(toPublic(op));
    }

    send(conn.socket, { type: "screen", screen, players: others, neighbors });
    send(conn.socket, { type: "youUpdate", you: player });
    this.broadcastToScreen(sx, sy, { type: "playerUpdate", player: toPublic(player) }, conn);

    if (awardDiscovery && discoveryXp !== null) {
      this.grantXp(player, discoveryXp);
      send(conn.socket, { type: "discovery", tier: screen.exoticTier, xp: discoveryXp });
      send(conn.socket, { type: "youUpdate", you: player });
    }
  }

  private isBlocked(screen: ScreenData, x: number, y: number): boolean {
    const tx = Math.floor(x);
    const ty = Math.floor(y);
    if (tx < 0 || tx >= SCREEN_WIDTH || ty < 0 || ty >= SCREEN_HEIGHT) return false;
    return BLOCKING_TILES.has(screen.tiles[ty][tx]);
  }

  private tick(): void {
    const dt = TICK_MS / 1000;

    for (const [username, conn] of this.connByUsername) {
      const player = this.players.get(username);
      if (!player) continue;
      const input = conn.input;

      // Las 4 teclas son direcciones relativas a la PANTALLA (arriba/abajo/izq/dcha
      // tal como se ven), no ejes del mundo: como la cámara es isométrica, cada una
      // se traduce a un movimiento diagonal en la rejilla del mundo.
      let dx = 0;
      let dy = 0;
      if (input.N) { dx -= 1; dy -= 1; } // arriba en pantalla
      if (input.S) { dx += 1; dy += 1; } // abajo en pantalla
      if (input.W) { dx -= 1; dy += 1; } // izquierda en pantalla
      if (input.E) { dx += 1; dy -= 1; } // derecha en pantalla
      if (dx === 0 && dy === 0) continue;

      const len = Math.hypot(dx, dy) || 1;
      const stepX = (dx / len) * PLAYER_SPEED * dt;
      const stepY = (dy / len) * PLAYER_SPEED * dt;

      const { screen } = this.ensureScreenLoaded(player.sx, player.sy);

      const targetX = player.x + stepX;
      if (targetX < 0 || targetX >= SCREEN_WIDTH || !this.isBlocked(screen, targetX, player.y)) {
        player.x = targetX;
      }
      const targetY = player.y + stepY;
      if (targetY < 0 || targetY >= SCREEN_HEIGHT || !this.isBlocked(screen, player.x, targetY)) {
        player.y = targetY;
      }

      if (dx > 0) player.facing = "E";
      else if (dx < 0) player.facing = "W";
      else if (dy > 0) player.facing = "S";
      else if (dy < 0) player.facing = "N";

      // Los bordes de la estancia son rectos EN PANTALLA (arriba/abajo/izq/dcha), no
      // las esquinas del mundo. Como la cámara es isométrica, eso corresponde a un
      // sistema de coordenadas rotado: s = x+y (eje norte-sur) y d = x-y (eje oeste-
      // este). El movimiento relativo a pantalla cambia s y d de forma INDEPENDIENTE
      // (arriba/abajo solo mueven s, izq/dcha solo mueven d), así que cruzar un borde
      // no depende de tocar también el otro eje: se sale en línea recta, sin desvíos.
      const sMax = SCREEN_WIDTH - 1 + (SCREEN_HEIGHT - 1);
      const dMin = -(SCREEN_HEIGHT - 1);
      const dMax = SCREEN_WIDTH - 1;

      let s = player.x + player.y;
      let d = player.x - player.y;

      let crossedDir: Direction | null = null;
      let nsx = player.sx;
      let nsy = player.sy;

      if (s < 0) {
        crossedDir = "N";
        nsy -= 1;
        s += sMax;
      } else if (s > sMax) {
        crossedDir = "S";
        nsy += 1;
        s -= sMax;
      } else if (d < dMin) {
        crossedDir = "W";
        nsx -= 1;
        d += dMax - dMin;
      } else if (d > dMax) {
        crossedDir = "E";
        nsx += 1;
        d -= dMax - dMin;
      }

      // Límite actual del mundo (400x400, provisional): más allá de esto no hay
      // pantallas, así que el borde exterior actúa como un muro invisible.
      const withinWorld = nsx >= WORLD_MIN && nsx <= WORLD_MAX && nsy >= WORLD_MIN && nsy <= WORLD_MAX;

      if (crossedDir && !withinWorld) {
        // Se queda pegado justo dentro del límite de su propia pantalla.
        s = Math.min(Math.max(s, 0.001), sMax - 0.001);
        d = Math.min(Math.max(d, dMin + 0.001), dMax - 0.001);
        player.x = (s + d) / 2;
        player.y = (s - d) / 2;
        send(conn.socket, { type: "youUpdate", you: player });
        this.broadcastToScreen(player.sx, player.sy, { type: "playerUpdate", player: toPublic(player) }, conn);
      } else if (crossedDir) {
        player.x = (s + d) / 2;
        player.y = (s - d) / 2;
        const oldKey = screenKey({ sx: player.sx, sy: player.sy });
        this.leaveScreenRoom(conn, oldKey);
        this.broadcastToScreen(player.sx, player.sy, { type: "playerLeft", username }, conn);
        player.sx = nsx;
        player.sy = nsy;
        this.enterScreen(conn, player, nsx, nsy, true);
      } else {
        send(conn.socket, { type: "youUpdate", you: player });
        this.broadcastToScreen(player.sx, player.sy, { type: "playerUpdate", player: toPublic(player) }, conn);
      }
    }
  }

  private handleAttack(conn: Connection, player: PlayerPrivateState): void {
    const { screen } = this.ensureScreenLoaded(player.sx, player.sy);
    let nearest: (typeof screen.monsters)[number] | null = null;
    let nearestDist = Infinity;
    for (const m of screen.monsters) {
      if (!m.alive) continue;
      const d = dist(player.x, player.y, m.x, m.y);
      if (d <= ATTACK_RANGE && d < nearestDist) {
        nearest = m;
        nearestDist = d;
      }
    }
    if (!nearest) return;

    const kind = MONSTER_KINDS.find((k) => k.kind === nearest!.kind);
    nearest.hp -= 5;
    if (nearest.hp <= 0) {
      nearest.alive = false;
      this.grantXp(player, kind?.xp ?? 5);
    } else {
      player.hp -= kind?.damage ?? 1;
    }
    saveScreen(screen);
    this.broadcastToScreen(player.sx, player.sy, { type: "monsterUpdate", monster: nearest });

    if (player.hp <= 0) {
      this.handleDeath(conn, player);
      return;
    }
    savePlayer(player);
    send(conn.socket, { type: "youUpdate", you: player });
  }

  private handlePickup(conn: Connection, player: PlayerPrivateState): void {
    const { screen } = this.ensureScreenLoaded(player.sx, player.sy);
    const item = screen.items.find((i) => !i.takenBy && dist(player.x, player.y, i.x, i.y) <= PICKUP_RANGE);
    if (!item) return;
    item.takenBy = player.username;
    player.inventory.push(item.kind);
    saveScreen(screen);
    savePlayer(player);
    send(conn.socket, { type: "youUpdate", you: player });
    this.broadcastToScreen(player.sx, player.sy, { type: "itemUpdate", item });
  }

  private handleDeath(conn: Connection, player: PlayerPrivateState): void {
    deletePlayer(player.username);
    this.players.delete(player.username);
    this.connByUsername.delete(player.username);
    this.leaveScreenRoom(conn, screenKey({ sx: player.sx, sy: player.sy }));
    this.broadcastToScreen(player.sx, player.sy, { type: "playerLeft", username: player.username }, conn);
    send(conn.socket, { type: "died" });
    conn.username = null;
  }

  private grantXp(player: PlayerPrivateState, amount: number): void {
    player.xp += amount;
    while (player.xp >= xpForNextLevel(player.level)) {
      player.xp -= xpForNextLevel(player.level);
      player.level += 1;
      player.maxHp += 5;
      player.hp = player.maxHp;
    }
    savePlayer(player);
  }

  private joinScreenRoom(conn: Connection, key: string): void {
    let room = this.screenRooms.get(key);
    if (!room) {
      room = new Set();
      this.screenRooms.set(key, room);
    }
    room.add(conn);
  }

  private leaveScreenRoom(conn: Connection, key: string): void {
    const room = this.screenRooms.get(key);
    if (!room) return;
    room.delete(conn);
    if (room.size === 0) this.screenRooms.delete(key);
  }

  private broadcastToScreen(sx: number, sy: number, msg: ServerMessage, exclude?: Connection): void {
    const room = this.screenRooms.get(screenKey({ sx, sy }));
    if (!room) return;
    for (const c of room) {
      if (c === exclude) continue;
      send(c.socket, msg);
    }
  }

  // Para ajustes globales del backoffice (niebla de visión, etc.) que deben
  // aplicarse al momento a todo el mundo conectado, no solo a una pantalla.
  broadcastAll(msg: ServerMessage): void {
    for (const conn of this.connections) send(conn.socket, msg);
  }
}
