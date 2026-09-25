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
  ZOMBIE_MAX_HP,
  ZOMBIE_VIEW_RANGE,
  GUN_RANGE,
  GUN_FIRE_MS,
  screenKey,
  type ClientMessage,
  type ServerMessage,
  type PlayerPrivateState,
  type PlayerPublicState,
  type ScreenData,
  type InputState,
  type NeighborTiles,
  type ZombieState,
} from "@roi/shared";
import { getScreen, saveScreen, getPlayer, savePlayer, deletePlayer } from "./db.js";
import { generateScreen } from "./worldgen.js";
import { MONSTER_KINDS } from "./content.js";

const NO_INPUT: InputState = { N: false, S: false, E: false, W: false };

interface Connection {
  socket: WebSocket;
  username: string | null;
  input: InputState;
  lastShot: number;
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
  private zombies: Array<ZombieState & { speed: number; hitCooldown: number }> = [];
  private nextZombieId = 1;
  private spawnTimer = 0;

  constructor() {
    setInterval(() => this.tick(), TICK_MS);
    setInterval(() => this.autosave(), 3000);
  }

  handleConnection(socket: WebSocket): void {
    const conn: Connection = { socket, username: null, input: { ...NO_INPUT }, lastShot: 0 };
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
    else if (msg.type === "shoot") this.handleShoot(conn, player, msg.dx, msg.dz);
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
        x: 4.5, // centro del cruce de la sala (0,0)
        y: 4.5,
        hp: 20,
        maxHp: 20,
        level: 1,
        xp: 0,
        facing: "S",
        inventory: [],
      };
      savePlayer(player);
    }

    // Posición guardada inválida (mundo de otro tamaño o dentro de un edificio): al cruce de su sala.
    player.x = Math.min(Math.max(player.x, 0.5), SCREEN_WIDTH - 0.5);
    player.y = Math.min(Math.max(player.y, 0.5), SCREEN_HEIGHT - 0.5);
    if (this.isBlockedAt(player.sx, player.sy, player.x, player.y)) {
      player.x = 4.5;
      player.y = 4.5;
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
    // Salas guardadas con otro tamaño (versión anterior del mundo): se regeneran.
    if (existing && existing.tiles.length === SCREEN_HEIGHT && existing.tiles[0].length === SCREEN_WIDTH) {
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
  private static readonly NEIGHBOR_RADIUS_X = 2;
  private static readonly NEIGHBOR_RADIUS_Y = 3;

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

  // Colisión en coordenadas locales de la sala (sx,sy), pudiendo salirse de ella:
  // las celdas fuera de rango se resuelven contra la sala vecina. Más allá del
  // límite del mundo actúa un muro invisible.
  private isBlockedAt(sx: number, sy: number, x: number, y: number): boolean {
    const gx = Math.floor(x);
    const gy = Math.floor(y);
    const rsx = sx + Math.floor(gx / SCREEN_WIDTH);
    const rsy = sy + Math.floor(gy / SCREEN_HEIGHT);
    if (rsx < WORLD_MIN || rsx > WORLD_MAX || rsy < WORLD_MIN || rsy > WORLD_MAX) return true;
    const { screen } = this.ensureScreenLoaded(rsx, rsy);
    const tx = ((gx % SCREEN_WIDTH) + SCREEN_WIDTH) % SCREEN_WIDTH;
    const ty = ((gy % SCREEN_HEIGHT) + SCREEN_HEIGHT) % SCREEN_HEIGHT;
    return BLOCKING_TILES.has(screen.tiles[ty][tx]);
  }

  private tick(): void {
    const dt = TICK_MS / 1000;
    this.tickZombies(dt);

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

      // Mundo continuo: x/y son coordenadas locales de la sala actual, pero las
      // salas se colocan en una rejilla alineada con los ejes (igual que las dibuja
      // el cliente), así que cruzar un borde es solo re-basar x/y en la sala vecina
      // — la posición global no cambia ni un ápice. La colisión también mira los
      // tiles de las salas vecinas, para poder andar sobre el borde sin atravesar
      // obstáculos.
      const targetX = player.x + stepX;
      if (!this.isBlockedAt(player.sx, player.sy, targetX, player.y)) player.x = targetX;
      const targetY = player.y + stepY;
      if (!this.isBlockedAt(player.sx, player.sy, player.x, targetY)) player.y = targetY;

      if (dx > 0) player.facing = "E";
      else if (dx < 0) player.facing = "W";
      else if (dy > 0) player.facing = "S";
      else if (dy < 0) player.facing = "N";

      let nsx = player.sx;
      let nsy = player.sy;
      if (player.x < 0) { nsx -= 1; player.x += SCREEN_WIDTH; }
      else if (player.x >= SCREEN_WIDTH) { nsx += 1; player.x -= SCREEN_WIDTH; }
      if (player.y < 0) { nsy -= 1; player.y += SCREEN_HEIGHT; }
      else if (player.y >= SCREEN_HEIGHT) { nsy += 1; player.y -= SCREEN_HEIGHT; }

      const crossed = nsx !== player.sx || nsy !== player.sy;
      if (crossed) {
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

  private handleShoot(conn: Connection, player: PlayerPrivateState, dxRaw: number, dzRaw: number): void {
    const now = Date.now();
    if (now - conn.lastShot < GUN_FIRE_MS * 0.8) return;
    if (!Number.isFinite(dxRaw) || !Number.isFinite(dzRaw)) return;
    const len = Math.hypot(dxRaw, dzRaw);
    if (len < 1e-6) return;
    conn.lastShot = now;
    const dx = dxRaw / len;
    const dz = dzRaw / len;
    const ox = player.sx * SCREEN_WIDTH + player.x;
    const oy = player.sy * SCREEN_HEIGHT + player.y;

    // Distancia hasta el primer obstáculo que bloquea el disparo.
    let wall = GUN_RANGE;
    for (let t = 0.3; t <= GUN_RANGE; t += 0.25) {
      if (this.isBlockedAt(0, 0, ox + dx * t, oy + dz * t)) {
        wall = t;
        break;
      }
    }
    // Primer zombi alcanzado a lo largo del rayo (radio de impacto 0.7 tiles ≈ 1 m).
    let hit: (typeof this.zombies)[number] | null = null;
    let hitT = wall;
    for (const z of this.zombies) {
      const rx = z.gx - ox;
      const ry = z.gy - oy;
      const t = rx * dx + ry * dz;
      if (t < 0 || t > hitT) continue;
      if (Math.abs(rx * dz - ry * dx) < 0.7) {
        hit = z;
        hitT = t;
      }
    }
    if (hit) {
      hit.hp -= 1;
      if (hit.hp <= 0) {
        this.zombies = this.zombies.filter((z) => z !== hit);
        this.grantXp(player, 2);
        send(conn.socket, { type: "youUpdate", you: player });
      }
    }
    const shot: ServerMessage = { type: "shot", from: { gx: ox, gy: oy }, to: { gx: ox + dx * hitT, gy: oy + dz * hitT } };
    for (const c of this.connections) {
      if (!c.username) continue;
      const p = this.players.get(c.username);
      if (p && dist(p.sx * SCREEN_WIDTH + p.x, p.sy * SCREEN_HEIGHT + p.y, ox, oy) <= ZOMBIE_VIEW_RANGE) send(c.socket, shot);
    }
  }

  // Horda: cada jugador atrae hasta HORDE_SIZE zombis que aparecen en un anillo
  // fuera de pantalla, caminan hacia el jugador más cercano y le muerden al
  // contacto. Se descartan si quedan lejos de todos.
  private static readonly HORDE_SIZE = 14;
  private tickZombies(dt: number): void {
    const targets: Array<{ conn: Connection; player: PlayerPrivateState; gx: number; gy: number }> = [];
    for (const [username, conn] of this.connByUsername) {
      const player = this.players.get(username);
      if (player) targets.push({ conn, player, gx: player.sx * SCREEN_WIDTH + player.x, gy: player.sy * SCREEN_HEIGHT + player.y });
    }
    if (targets.length === 0) {
      this.zombies = [];
      return;
    }

    if (process.env.NO_ZOMBIES) {
      this.zombies = [];
      return;
    }
    this.spawnTimer -= dt;
    if (this.spawnTimer <= 0 && this.zombies.length < GameServer.HORDE_SIZE * targets.length) {
      this.spawnTimer = 0.5;
      const t = targets[Math.floor(Math.random() * targets.length)];
      for (let attempt = 0; attempt < 6; attempt++) {
        const ang = Math.random() * Math.PI * 2;
        const r = 30 + Math.random() * 10;
        const gx = t.gx + Math.cos(ang) * r;
        const gy = t.gy + Math.sin(ang) * r;
        if (this.isBlockedAt(0, 0, gx, gy)) continue;
        this.zombies.push({ id: this.nextZombieId++, gx, gy, hp: ZOMBIE_MAX_HP, speed: 2.2 + Math.random() * 1.6, hitCooldown: 0 });
        break;
      }
    }

    const dead = new Set<Connection>();
    this.zombies = this.zombies.filter((z) => {
      let near = targets[0];
      let nd = Infinity;
      for (const t of targets) {
        const d = dist(z.gx, z.gy, t.gx, t.gy);
        if (d < nd) {
          nd = d;
          near = t;
        }
      }
      if (nd > ZOMBIE_VIEW_RANGE * 1.6) return false;
      z.hitCooldown -= dt;
      if (nd < 0.9) {
        if (z.hitCooldown <= 0 && !dead.has(near.conn)) {
          z.hitCooldown = 1;
          near.player.hp -= 2;
          if (near.player.hp <= 0) {
            dead.add(near.conn);
            this.handleDeath(near.conn, near.player);
          } else {
            send(near.conn.socket, { type: "youUpdate", you: near.player });
          }
        }
        return true;
      }
      const sx = ((near.gx - z.gx) / nd) * z.speed * dt;
      const sy = ((near.gy - z.gy) / nd) * z.speed * dt;
      if (!this.isBlockedAt(0, 0, z.gx + sx, z.gy)) z.gx += sx;
      if (!this.isBlockedAt(0, 0, z.gx, z.gy + sy)) z.gy += sy;
      return true;
    });

    for (const t of targets) {
      if (dead.has(t.conn)) continue;
      const list = this.zombies
        .filter((z) => Math.abs(z.gx - t.gx) < ZOMBIE_VIEW_RANGE && Math.abs(z.gy - t.gy) < ZOMBIE_VIEW_RANGE)
        .map((z) => ({ id: z.id, gx: Math.round(z.gx * 100) / 100, gy: Math.round(z.gy * 100) / 100, hp: z.hp }));
      send(t.conn.socket, { type: "zombies", zombies: list });
    }
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
