import type { WebSocket } from "ws";
import {
  SCREEN_WIDTH,
  SCREEN_HEIGHT,
  DIRECTION_DELTA,
  BLOCKING_TILES,
  screenKey,
  type ClientMessage,
  type ServerMessage,
  type PlayerPrivateState,
  type PlayerPublicState,
  type Direction,
  type ScreenData,
} from "@roi/shared";
import { getScreen, saveScreen, getPlayer, savePlayer, deletePlayer } from "./db.js";
import { generateScreen } from "./worldgen.js";
import { MONSTER_KINDS } from "./content.js";

interface Connection {
  socket: WebSocket;
  username: string | null;
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

export class GameServer {
  private connections = new Set<Connection>();
  private players = new Map<string, PlayerPrivateState>();
  private screenRooms = new Map<string, Set<Connection>>();
  private connByUsername = new Map<string, Connection>();

  handleConnection(socket: WebSocket): void {
    const conn: Connection = { socket, username: null };
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
      if (conn.username) {
        const player = this.players.get(conn.username);
        if (player) {
          savePlayer(player);
          this.leaveScreenRoom(conn, screenKey({ sx: player.sx, sy: player.sy }));
          this.broadcastToScreen(player.sx, player.sy, { type: "playerLeft", username: conn.username }, conn);
        }
        this.players.delete(conn.username);
        this.connByUsername.delete(conn.username);
      }
    });
  }

  private handleMessage(conn: Connection, msg: ClientMessage): void {
    if (msg.type === "join") {
      this.handleJoin(conn, msg.username);
      return;
    }
    if (!conn.username) return;
    const player = this.players.get(conn.username);
    if (!player) return;

    if (msg.type === "move") this.handleMove(conn, player, msg.dir);
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
        x: Math.floor(SCREEN_WIDTH / 2),
        y: Math.floor(SCREEN_HEIGHT / 2),
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
    this.players.set(username, player);
    this.connByUsername.set(username, conn);

    send(conn.socket, { type: "joined", you: player });
    this.enterScreen(conn, player, player.sx, player.sy, false);
  }

  private loadOrGenerateScreen(sx: number, sy: number): { screen: ScreenData; discoveryXp: number | null } {
    const existing = getScreen(sx, sy);
    if (existing) return { screen: existing, discoveryXp: null };
    const { screen, discoveryXp } = generateScreen(sx, sy);
    saveScreen(screen);
    return { screen, discoveryXp };
  }

  private enterScreen(conn: Connection, player: PlayerPrivateState, sx: number, sy: number, awardDiscovery: boolean): void {
    const { screen, discoveryXp } = this.loadOrGenerateScreen(sx, sy);

    const key = screenKey({ sx, sy });
    this.joinScreenRoom(conn, key);

    const others: PlayerPublicState[] = [];
    for (const other of this.screenRooms.get(key) ?? []) {
      if (other === conn || !other.username) continue;
      const op = this.players.get(other.username);
      if (op) others.push(toPublic(op));
    }

    send(conn.socket, { type: "screen", screen, players: others });
    this.broadcastToScreen(sx, sy, { type: "playerUpdate", player: toPublic(player) }, conn);

    if (awardDiscovery && discoveryXp !== null) {
      this.grantXp(conn, player, discoveryXp);
      send(conn.socket, { type: "discovery", tier: screen.exoticTier, xp: discoveryXp });
    }
  }

  private handleMove(conn: Connection, player: PlayerPrivateState, dir: Direction): void {
    player.facing = dir;
    const { dx, dy } = DIRECTION_DELTA[dir];
    let nx = player.x + dx;
    let ny = player.y + dy;

    if (nx < 0 || nx >= SCREEN_WIDTH || ny < 0 || ny >= SCREEN_HEIGHT) {
      // Transición de pantalla: aparece por el borde opuesto de la pantalla vecina.
      let nsx = player.sx;
      let nsy = player.sy;
      if (nx < 0) { nsx -= 1; nx = SCREEN_WIDTH - 1; }
      else if (nx >= SCREEN_WIDTH) { nsx += 1; nx = 0; }
      if (ny < 0) { nsy -= 1; ny = SCREEN_HEIGHT - 1; }
      else if (ny >= SCREEN_HEIGHT) { nsy += 1; ny = 0; }

      const oldKey = screenKey({ sx: player.sx, sy: player.sy });
      this.leaveScreenRoom(conn, oldKey);
      this.broadcastToScreen(player.sx, player.sy, { type: "playerLeft", username: player.username }, conn);

      player.sx = nsx;
      player.sy = nsy;
      player.x = nx;
      player.y = ny;
      savePlayer(player);
      this.enterScreen(conn, player, nsx, nsy, true);
      send(conn.socket, { type: "youUpdate", you: player });
      return;
    }

    const { screen } = this.loadOrGenerateScreen(player.sx, player.sy);

    const monster = screen.monsters.find((m) => m.alive && m.x === nx && m.y === ny);
    if (monster) {
      monster.hp -= 4;
      if (monster.hp <= 0) {
        monster.alive = false;
        this.grantXp(conn, player, MONSTER_KINDS.find((k) => k.kind === monster.kind)?.xp ?? 5);
      } else {
        const kind = MONSTER_KINDS.find((k) => k.kind === monster.kind);
        player.hp -= kind?.damage ?? 1;
      }
      saveScreen(screen);
      this.broadcastToScreen(player.sx, player.sy, { type: "monsterUpdate", monster });
      if (player.hp <= 0) {
        this.handleDeath(conn, player);
        return;
      }
      savePlayer(player);
      send(conn.socket, { type: "youUpdate", you: player });
      this.broadcastToScreen(player.sx, player.sy, { type: "playerUpdate", player: toPublic(player) }, conn);
      return;
    }

    const occupied = this.isOccupiedByOtherPlayer(player, nx, ny);
    if (occupied) return;

    const tile = screen.tiles[ny][nx];
    if (BLOCKING_TILES.has(tile)) return;

    player.x = nx;
    player.y = ny;
    savePlayer(player);
    this.broadcastToScreen(player.sx, player.sy, { type: "playerUpdate", player: toPublic(player) }, conn);
    send(conn.socket, { type: "youUpdate", you: player });
  }

  private handlePickup(conn: Connection, player: PlayerPrivateState): void {
    const { screen } = this.loadOrGenerateScreen(player.sx, player.sy);
    const item = screen.items.find((i) => !i.takenBy && i.x === player.x && i.y === player.y);
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

  private grantXp(conn: Connection, player: PlayerPrivateState, amount: number): void {
    player.xp += amount;
    while (player.xp >= xpForNextLevel(player.level)) {
      player.xp -= xpForNextLevel(player.level);
      player.level += 1;
      player.maxHp += 5;
      player.hp = player.maxHp;
    }
    savePlayer(player);
  }

  private isOccupiedByOtherPlayer(player: PlayerPrivateState, x: number, y: number): boolean {
    for (const other of this.players.values()) {
      if (other.username === player.username) continue;
      if (other.sx === player.sx && other.sy === player.sy && other.x === x && other.y === y) return true;
    }
    return false;
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
}
