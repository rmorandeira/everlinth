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
  GIANT_HP,
  ZOMBIE_VIEW_RANGE,
  GUN_RANGE,
  GUN_FIRE_MS,
  TileType,
  screenKey,
  type ClientMessage,
  type ServerMessage,
  type PlayerPrivateState,
  type PlayerPublicState,
  type ScreenData,
  type InputState,
  type NeighborTiles,
  type ZombieState,
  type CityBuilding,
  type CivilianState,
} from "@roi/shared";
import { getScreen, saveScreen, getPlayer, savePlayer, deletePlayer } from "./db.js";
import { generateScreen } from "./worldgen.js";
import { rasterRoom } from "./citygen/index.js";
import { annotateBuildings, damageBuilding, distanceToPolygon } from "./buildings.js";
import { MONSTER_KINDS } from "./content.js";

const NO_INPUT: InputState = { N: false, S: false, E: false, W: false };

interface Connection {
  socket: WebSocket;
  username: string | null;
  input: InputState;
  lastShot: number;
  zombiesOn: boolean;
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
  private zombies: Array<ZombieState & { speed: number; hitCooldown: number; pack: number; stun?: number }> = [];
  private nextZombieId = 1;
  private nextPack = 1;
  // Población civil: deambula por las aceras, huye de la horda (y de los tiros) y, si
  // la muerden, se convierte en zombi al cabo de unos segundos: la horda crece.
  private civilians: Array<{ id: number; gx: number; gy: number; tx: number; ty: number; walk: number; run: number; panic: number; infected: number; v: number; wait: number; fallen: number; helping: number; helpT: number; helped: boolean }> = [];
  private sendTick = 0;
  private nextCivilianId = 1;
  private noises: Array<{ gx: number; gy: number; t: number; r: number }> = [];
  private static readonly CIVILIANS = 70;
  private static readonly PREY_RANGE = 16; // un zombi ve a sus víctimas a esta distancia
  private spawnTimer = 0;

  constructor() {
    setInterval(() => this.tick(), TICK_MS);
    setInterval(() => this.autosave(), 3000);
  }

  handleConnection(socket: WebSocket): void {
    const conn: Connection = { socket, username: null, input: { ...NO_INPUT }, lastShot: 0, zombiesOn: true };
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
    else if (msg.type === "debugExplode") {
      // tecla de prueba de explosiones (solo con DEBUG_WEAPONS=1, cerca del jugador)
      const px = player.sx * SCREEN_WIDTH + player.x;
      const py = player.sy * SCREEN_HEIGHT + player.y;
      if (process.env.DEBUG_WEAPONS?.trim() === "1" && Number.isFinite(msg.gx) && Number.isFinite(msg.gy) && dist(px, py, msg.gx, msg.gy) < 40) {
        this.explode(msg.gx, msg.gy, 4, 120, { conn, player });
      }
    }
    else if (msg.type === "setZombies") {
      conn.zombiesOn = msg.enabled === true;
      if (!conn.zombiesOn) send(conn.socket, { type: "zombies", zombies: [] });
    }
  }

  // Punto transitable más cercano al centro de la sala, preferiblemente calzada.
  private findSpawn(sx: number, sy: number): { x: number; y: number } {
    const cx = SCREEN_WIDTH / 2;
    const cy = SCREEN_HEIGHT / 2;
    let best = { x: cx, y: cy };
    let bestD = Infinity;
    for (let y = 0; y < SCREEN_HEIGHT; y++) {
      for (let x = 0; x < SCREEN_WIDTH; x++) {
        if (this.isBlockedAt(sx, sy, x + 0.5, y + 0.5)) continue;
        const d = Math.hypot(x + 0.5 - cx, y + 0.5 - cy);
        if (d < bestD) {
          bestD = d;
          best = { x: x + 0.5, y: y + 0.5 };
        }
      }
    }
    return best;
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
        x: -1, // centinela: se recoloca en un punto transitable al entrar
        y: -1,
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
    if (player.x < 0 || player.y < 0 || player.x >= SCREEN_WIDTH || player.y >= SCREEN_HEIGHT || this.isBlockedAt(player.sx, player.sy, player.x, player.y)) {
      const spot = this.findSpawn(player.sx, player.sy);
      player.x = spot.x;
      player.y = spot.y;
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
    const withCity = (sc: ScreenData): ScreenData => {
      // La geometría vectorial de la ciudad no se guarda: se regenera (determinista).
      // La ciudad no se guarda: geometría y casillas se regeneran (deterministas), así
      // las salas guardadas siguen al generador (autovías, pilares, corredores…).
      if (sc.biome === "city" && !sc.city) {
        const r = rasterRoom(sx, sy);
        sc.city = r.city;
        sc.tiles = r.tiles;
      }
      if (sc.city) {
        annotateBuildings(sc.city.buildings);
        for (const b of sc.city.buildings) if (b.hp !== undefined && b.hp <= 0) this.clearBuildingTiles(sc, b);
      }
      return sc;
    };

    const existing = getScreen(sx, sy);
    // Salas guardadas con otro tamaño (versión anterior del mundo): se regeneran.
    if (existing && existing.tiles.length === SCREEN_HEIGHT && existing.tiles[0].length === SCREEN_WIDTH) {
      this.screenCache.set(key, withCity(existing));
      return { screen: existing, discoveryXp: null };
    }

    const { screen, discoveryXp } = generateScreen(sx, sy);
    saveScreen(screen);
    this.screenCache.set(key, withCity(screen));
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
        neighbors.push({ sx: nsx, sy: nsy, tiles: screen.tiles, placedTrees: screen.placedTrees, city: screen.city });
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
    this.noises.push({ gx: player.sx * SCREEN_WIDTH + player.x, gy: player.sy * SCREEN_HEIGHT + player.y, t: now, r: 14 });
    // Dispersión del arma: cada bala se desvía un poco de donde se apunta (normal con
    // σ ≈ 0,7°, aproximada sumando uniformes), así las ráfagas abren un pequeño cono.
    const spread = (Math.random() + Math.random() + Math.random() - 1.5) * 0.025;
    const cs = Math.cos(spread);
    const sn = Math.sin(spread);
    const ax = dxRaw / len;
    const az = dzRaw / len;
    const dx = ax * cs - az * sn;
    const dz = ax * sn + az * cs;
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
      if (Math.abs(rx * dz - ry * dx) < (z.giant ? 1.5 : 0.7)) {
        hit = z;
        hitT = t;
      }
    }
    if (hit) {
      hit.hp -= 1;
      // el balazo lo frena un instante y lo empuja un poco hacia atrás (muy poco)
      const push = hit.giant ? 0.03 : 0.12;
      if (!this.isBlockedAt(0, 0, hit.gx + dx * push, hit.gy + dz * push)) {
        hit.gx += dx * push;
        hit.gy += dz * push;
      }
      hit.stun = hit.giant ? 0.05 : 0.18;
      if (hit.hp <= 0) {
        this.zombies = this.zombies.filter((z) => z !== hit);
        this.grantXp(player, hit.giant ? 20 : 2);
        send(conn.socket, { type: "youUpdate", you: player });
        send(conn.socket, { type: "kill" });
        const died: ServerMessage = { type: "zombieDied", gx: hit.gx, gy: hit.gy, giant: hit.giant === true };
        for (const c of this.connections) {
          if (!c.username) continue;
          const p = this.players.get(c.username);
          if (p && dist(p.sx * SCREEN_WIDTH + p.x, p.sy * SCREEN_HEIGHT + p.y, hit.gx, hit.gy) <= ZOMBIE_VIEW_RANGE) send(c.socket, died);
        }
      }
    }
    const shot: ServerMessage = { type: "shot", from: { gx: ox, gy: oy }, to: { gx: ox + dx * hitT, gy: oy + dz * hitT }, hit: hit ? "zombie" : wall < GUN_RANGE ? "wall" : "none" };
    for (const c of this.connections) {
      if (!c.username) continue;
      const p = this.players.get(c.username);
      if (p && dist(p.sx * SCREEN_WIDTH + p.x, p.sy * SCREEN_HEIGHT + p.y, ox, oy) <= ZOMBIE_VIEW_RANGE) send(c.socket, shot);
    }
  }

  // ---- Edificios destructibles (ver buildings.ts) ----

  /**
   * Explosión en (gx, gy) (tiles globales): daña los edificios a su alcance (más cuanto
   * más cerca) y mata o empuja a los zombis. Las balas no dañan edificios; esto es para
   * las armas explosivas (granadas, cohetes…) y, de momento, la tecla de prueba.
   */
  explode(gx: number, gy: number, radius: number, power: number, by?: { conn: Connection; player: PlayerPrivateState }): void {
    this.noises.push({ gx, gy, t: Date.now(), r: 30 });
    const seen = new Set<string>();
    const R = Math.ceil(radius / SCREEN_WIDTH) + 1;
    for (let ry = Math.floor(gy / SCREEN_HEIGHT) - R; ry <= Math.floor(gy / SCREEN_HEIGHT) + R; ry++) {
      for (let rx = Math.floor(gx / SCREEN_WIDTH) - R; rx <= Math.floor(gx / SCREEN_WIDTH) + R; rx++) {
        if (rx < WORLD_MIN || rx > WORLD_MAX || ry < WORLD_MIN || ry > WORLD_MAX) continue;
        const { screen } = this.ensureScreenLoaded(rx, ry);
        if (!screen.city) continue;
        for (const b of screen.city.buildings) {
          if (seen.has(b.id) || (b.hp !== undefined && b.hp <= 0)) continue;
          const d = distanceToPolygon(gx, gy, b.pts);
          if (d > radius) continue;
          seen.add(b.id);
          this.damageBuildingBy(b, power * (1 - (d / radius) * 0.7), gx, gy);
        }
      }
    }
    for (const z of this.zombies) {
      const d = dist(z.gx, z.gy, gx, gy);
      if (d > radius) continue;
      z.hp -= Math.ceil(power * 0.2 * (1 - d / radius));
      const push = (1 - d / radius) * 1.5;
      if (d > 0.01) {
        z.gx += ((z.gx - gx) / d) * push;
        z.gy += ((z.gy - gy) / d) * push;
      }
      z.stun = 0.6;
    }
    const killed = this.zombies.filter((z) => z.hp <= 0);
    if (killed.length > 0) {
      this.zombies = this.zombies.filter((z) => z.hp > 0);
      for (const z of killed) {
        const died: ServerMessage = { type: "zombieDied", gx: z.gx, gy: z.gy, giant: z.giant === true };
        this.sendNear(z.gx, z.gy, ZOMBIE_VIEW_RANGE, died);
        if (by) {
          this.grantXp(by.player, z.giant ? 20 : 2);
          send(by.conn.socket, { type: "kill" });
        }
      }
      if (by) send(by.conn.socket, { type: "youUpdate", you: by.player });
    }
    this.sendNear(gx, gy, ZOMBIE_VIEW_RANGE * 1.5, { type: "explosion", gx, gy, radius });
  }

  private sendNear(gx: number, gy: number, range: number, msg: ServerMessage): void {
    for (const c of this.connections) {
      if (!c.username) continue;
      const p = this.players.get(c.username);
      if (p && dist(p.sx * SCREEN_WIDTH + p.x, p.sy * SCREEN_HEIGHT + p.y, gx, gy) <= range) send(c.socket, msg);
    }
  }

  private damageBuildingBy(best: CityBuilding, amount: number, gx: number, gy: number): void {
    const r = damageBuilding(best, amount);
    if (!r.changedStage && !r.collapsed) return;
    // el mismo edificio aparece en la ciudad de cada sala que toca: se actualizan todas
    for (const sc of this.screenCache.values()) {
      if (!sc.city) continue;
      for (const b of sc.city.buildings) {
        if (b.id !== best.id) continue;
        b.hp = r.hp;
        b.maxHp = r.maxHp;
      }
    }
    if (r.collapsed) {
      const xs = best.pts.map((p) => p[0]);
      const ys = best.pts.map((p) => p[1]);
      for (let ry = Math.floor(Math.min(...ys) / SCREEN_HEIGHT); ry <= Math.floor(Math.max(...ys) / SCREEN_HEIGHT); ry++) {
        for (let rx = Math.floor(Math.min(...xs) / SCREEN_WIDTH); rx <= Math.floor(Math.max(...xs) / SCREEN_WIDTH); rx++) {
          if (rx < WORLD_MIN || rx > WORLD_MAX || ry < WORLD_MIN || ry > WORLD_MAX) continue;
          const { screen: sc } = this.ensureScreenLoaded(rx, ry);
          if (this.clearBuildingTiles(sc, best)) saveScreen(sc);
        }
      }
    }
    const msg: ServerMessage = { type: "buildingDamaged", id: best.id, hp: r.hp, maxHp: r.maxHp };
    for (const c of this.connections) {
      if (!c.username) continue;
      const p = this.players.get(c.username);
      if (p && dist(p.sx * SCREEN_WIDTH + p.x, p.sy * SCREEN_HEIGHT + p.y, gx, gy) <= ZOMBIE_VIEW_RANGE * 1.5) send(c.socket, msg);
    }
  }

  /** Casillas de un edificio derrumbado en esta sala → acera (escombro transitable). */
  private clearBuildingTiles(screen: ScreenData, b: CityBuilding): boolean {
    const ox = screen.sx * SCREEN_WIDTH;
    const oy = screen.sy * SCREEN_HEIGHT;
    let changed = false;
    for (let ty = 0; ty < SCREEN_HEIGHT; ty++) {
      for (let tx = 0; tx < SCREEN_WIDTH; tx++) {
        if (screen.tiles[ty][tx] !== TileType.Building) continue;
        if (distanceToPolygon(ox + tx + 0.5, oy + ty + 0.5, b.pts) > 0.75) continue;
        screen.tiles[ty][tx] = TileType.Sidewalk;
        changed = true;
      }
    }
    return changed;
  }

  // Horda: cada jugador (con los zombis activados) atrae hasta HORDE_SIZE zombis que
  // aparecen en grupos en un anillo fuera de pantalla, caminan despacio
  // arrastrándose hacia el jugador más cercano, se empujan entre ellos para no
  // amontonarse en un punto, y muerden al contacto. Se descartan si quedan lejos de todos.
  private static readonly HORDE_SIZE = 600;
  private tickZombies(dt: number): void {
    const targets: Array<{ conn: Connection; player: PlayerPrivateState; gx: number; gy: number }> = [];
    for (const [username, conn] of this.connByUsername) {
      const player = this.players.get(username);
      if (player && conn.zombiesOn) targets.push({ conn, player, gx: player.sx * SCREEN_WIDTH + player.x, gy: player.sy * SCREEN_HEIGHT + player.y });
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
      this.spawnTimer = 0.2;
      const t = targets[Math.floor(Math.random() * targets.length)];
      // una manada de 8-20 muy junta alrededor de un punto del anillo, todos a un paso
      // parecido (así no se estiran por el camino)
      const ang = Math.random() * Math.PI * 2;
      const r = 28 + Math.random() * 12;
      const cx = t.gx + Math.cos(ang) * r;
      const cy = t.gy + Math.sin(ang) * r;
      const n = 8 + Math.floor(Math.random() * 13);
      const pack = this.nextPack++;
      const packSpeed = 0.8 + Math.random() * 0.8;
      for (let i = 0; i < n; i++) {
        for (let attempt = 0; attempt < 5; attempt++) {
          const gx = cx + (Math.random() - 0.5) * 3.5;
          const gy = cy + (Math.random() - 0.5) * 3.5;
          if (this.isBlockedAt(0, 0, gx, gy)) continue;
          // De vez en cuando, si la horda alrededor del jugador ya es muy grande, un
          // gigante (máximo 2 a la vez por jugador): muy lento y muy resistente.
          const nearCount = this.zombies.filter((zz) => Math.abs(zz.gx - t.gx) < ZOMBIE_VIEW_RANGE && Math.abs(zz.gy - t.gy) < ZOMBIE_VIEW_RANGE).length;
          const giants = this.zombies.filter((zz) => zz.giant && Math.abs(zz.gx - t.gx) < ZOMBIE_VIEW_RANGE && Math.abs(zz.gy - t.gy) < ZOMBIE_VIEW_RANGE).length;
          const giant = nearCount > 100 && giants < 2 && Math.random() < 0.02;
          // lentos, arrastrándose: 0,8-1,6 tiles/s (el jugador corre a más de 7); gigantes 0,5-0,7
          this.zombies.push(
            giant
              ? { id: this.nextZombieId++, gx, gy, hp: GIANT_HP, speed: 0.5 + Math.random() * 0.2, hitCooldown: 0, giant: true, pack }
              : { id: this.nextZombieId++, gx, gy, hp: ZOMBIE_MAX_HP, speed: packSpeed * (0.94 + Math.random() * 0.12), hitCooldown: 0, pack }
          );
          break;
        }
      }
    }

    // Centro de cada manada (para que avancen juntas) y rejilla de vecinos (separación
    // sin comparar todos con todos).
    const packs = new Map<number, { x: number; y: number; n: number }>();
    const grid = new Map<string, Array<(typeof this.zombies)[number]>>();
    for (const z of this.zombies) {
      const p = packs.get(z.pack) ?? { x: 0, y: 0, n: 0 };
      p.x += z.gx;
      p.y += z.gy;
      p.n++;
      packs.set(z.pack, p);
      const k = `${Math.floor(z.gx)},${Math.floor(z.gy)}`;
      let cell = grid.get(k);
      if (!cell) grid.set(k, (cell = []));
      cell.push(z);
    }
    this.tickCivilianSpawns(targets);
    // rejilla de civiles (celdas de 4 tiles) para que cada zombi encuentre su presa
    const civGrid = new Map<string, Array<(typeof this.civilians)[number]>>();
    for (const c of this.civilians) {
      if (c.infected > 0) continue;
      const k = `${Math.floor(c.gx / 4)},${Math.floor(c.gy / 4)}`;
      let cell = civGrid.get(k);
      if (!cell) civGrid.set(k, (cell = []));
      cell.push(c);
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
      // La horda se despliega: cada zombi va a por la víctima que tenga más cerca
      // (un paseante o un jugador); sin presa a la vista, avanza con su manada.
      let prey: (typeof this.civilians)[number] | null = null;
      let pd = Math.min(nd, GameServer.PREY_RANGE);
      const gcx = Math.floor(z.gx / 4);
      const gcy = Math.floor(z.gy / 4);
      for (let yy = gcy - 4; yy <= gcy + 4; yy++) {
        for (let xx = gcx - 4; xx <= gcx + 4; xx++) {
          for (const c of civGrid.get(`${xx},${yy}`) ?? []) {
            const d = dist(z.gx, z.gy, c.gx, c.gy);
            if (d < pd) {
              pd = d;
              prey = c;
            }
          }
        }
      }
      z.hitCooldown -= dt;
      if (z.stun && z.stun > 0) {
        z.stun -= dt;
        return true;
      }
      if (prey) {
        if (pd < (z.giant ? 1.6 : 0.75)) {
          if (z.hitCooldown <= 0 && prey.infected <= 0) {
            z.hitCooldown = 1;
            prey.infected = 2.5 + Math.random() * 2; // mordido: se convierte al rato
            prey.panic = 0;
          }
          return true;
        }
      } else if (nd < (z.giant ? 1.9 : 0.9)) {
        if (z.hitCooldown <= 0 && !dead.has(near.conn)) {
          z.hitCooldown = 1;
          near.player.hp -= z.giant ? 6 : 2;
          if (near.player.hp <= 0) {
            dead.add(near.conn);
            this.handleDeath(near.conn, near.player);
          } else {
            send(near.conn.socket, { type: "youUpdate", you: near.player });
          }
        }
        return true;
      }
      const tx = prey ? prey.gx : near.gx;
      const ty = prey ? prey.gy : near.gy;
      const td = Math.max(0.001, prey ? pd : nd);
      // tras una presa corren algo más (un tirón hacia la víctima)
      const sp = z.speed * (prey ? 1.35 : 1);
      let sx = ((tx - z.gx) / td) * sp * dt;
      let sy = ((ty - z.gy) / td) * sp * dt;
      // cohesión: solo sin presa a la vista (con presa, la manada se abre en abanico)
      const p = packs.get(z.pack);
      if (!prey && nd > GameServer.PREY_RANGE && p && p.n > 1) {
        const px = p.x / p.n - z.gx;
        const py = p.y / p.n - z.gy;
        const pd = Math.hypot(px, py);
        if (pd > 0.9) {
          sx += (px / pd) * Math.min(1, pd - 0.9) * 0.45 * dt;
          sy += (py / pd) * Math.min(1, pd - 0.9) * 0.45 * dt;
        }
      }
      // separación: empuje suave solo contra los que casi se tocan (van hombro con hombro)
      const cx0 = Math.floor(z.gx);
      const cy0 = Math.floor(z.gy);
      for (let gy = cy0 - 1; gy <= cy0 + 1; gy++) {
        for (let gx = cx0 - 1; gx <= cx0 + 1; gx++) {
          for (const o of grid.get(`${gx},${gy}`) ?? []) {
            if (o === z) continue;
            const ox = z.gx - o.gx;
            const oy = z.gy - o.gy;
            const d2 = ox * ox + oy * oy;
            if (d2 > 0.0001 && d2 < 0.2) {
              const d = Math.sqrt(d2);
              sx += (ox / d) * (0.45 - d) * 1.1 * dt;
              sy += (oy / d) * (0.45 - d) * 1.1 * dt;
            }
          }
        }
      }
      if (!this.isBlockedAt(0, 0, z.gx + sx, z.gy)) z.gx += sx;
      if (!this.isBlockedAt(0, 0, z.gx, z.gy + sy)) z.gy += sy;
      return true;
    });

    this.tickCivilians(dt);

    this.sendTick = (this.sendTick + 1) % 2;
    if (this.sendTick !== 0) return;
    for (const t of targets) {
      if (dead.has(t.conn)) continue;
      const civs: CivilianState[] = this.civilians
        .filter((c) => Math.abs(c.gx - t.gx) < ZOMBIE_VIEW_RANGE && Math.abs(c.gy - t.gy) < ZOMBIE_VIEW_RANGE)
        .map((c) => ({ id: c.id, gx: Math.round(c.gx * 100) / 100, gy: Math.round(c.gy * 100) / 100, s: c.infected > 0 ? 2 : c.fallen > 0 ? 3 : c.helpT > 0 ? 4 : c.panic > 0 ? 1 : 0, v: c.v }));
      send(t.conn.socket, { type: "civilians", civilians: civs });
      const list = this.zombies
        .filter((z) => Math.abs(z.gx - t.gx) < ZOMBIE_VIEW_RANGE && Math.abs(z.gy - t.gy) < ZOMBIE_VIEW_RANGE)
        .map((z) => ({ id: z.id, gx: Math.round(z.gx * 100) / 100, gy: Math.round(z.gy * 100) / 100, hp: z.hp, ...(z.giant ? { giant: true } : {}) }));
      send(t.conn.socket, { type: "zombies", zombies: list });
    }
  }

  /** ¿Se puede andar por ahí? */
  private walkable(gx: number, gy: number): boolean {
    return !this.isBlockedAt(0, 0, gx, gy);
  }

  /** ¿Es acera? (en la ciudad los paseantes van por la acera; fuera de ella, donde sea) */
  private sidewalk(gx: number, gy: number): boolean {
    const rsx = Math.floor(gx / SCREEN_WIDTH);
    const rsy = Math.floor(gy / SCREEN_HEIGHT);
    if (rsx < WORLD_MIN || rsx > WORLD_MAX || rsy < WORLD_MIN || rsy > WORLD_MAX) return false;
    const { screen } = this.ensureScreenLoaded(rsx, rsy);
    const t = screen.tiles[((Math.floor(gy) % SCREEN_HEIGHT) + SCREEN_HEIGHT) % SCREEN_HEIGHT][((Math.floor(gx) % SCREEN_WIDTH) + SCREEN_WIDTH) % SCREEN_WIDTH];
    if (!screen.city) return !BLOCKING_TILES.has(t);
    return t === TileType.Sidewalk;
  }

  private tickCivilianSpawns(targets: Array<{ gx: number; gy: number }>): void {
    // se retiran los que quedan lejos de todos
    this.civilians = this.civilians.filter((c) => targets.some((t) => dist(c.gx, c.gy, t.gx, t.gy) < ZOMBIE_VIEW_RANGE * 1.4));
    const want = GameServer.CIVILIANS * targets.length;
    for (let n = 0; n < 6 && this.civilians.length < want; n++) {
      const t = targets[Math.floor(Math.random() * targets.length)];
      // al principio también cerca (la calle ya está poblada); luego fuera de pantalla
      const near = this.civilians.length < want * 0.5;
      const ang = Math.random() * Math.PI * 2;
      const r = (near ? 5 : 26) + Math.random() * (near ? 30 : 14);
      const gx = t.gx + Math.cos(ang) * r;
      const gy = t.gy + Math.sin(ang) * r;
      if (!this.sidewalk(gx, gy)) continue;
      this.civilians.push({ id: this.nextCivilianId++, gx, gy, tx: gx, ty: gy, walk: 0.8 + Math.random() * 0.5, run: 3.0 + Math.random() * 1.3, panic: 0, infected: 0, v: Math.floor(Math.random() * 1000), wait: Math.random() * 3, fallen: 0, helping: 0, helpT: 0, helped: false });
    }
  }

  private tickCivilians(dt: number): void {
    const now = Date.now();
    this.noises = this.noises.filter((n) => now - n.t < 1500);
    const zGrid = new Map<string, Array<(typeof this.zombies)[number]>>();
    for (const z of this.zombies) {
      const k = `${Math.floor(z.gx / 4)},${Math.floor(z.gy / 4)}`;
      let cell = zGrid.get(k);
      if (!cell) zGrid.set(k, (cell = []));
      cell.push(z);
    }
    const turned: Array<(typeof this.civilians)[number]> = [];
    const byId = new Map<number, (typeof this.civilians)[number]>();
    for (const c of this.civilians) byId.set(c.id, c);
    for (const c of this.civilians) {
      if (c.infected > 0) {
        // mordido: se tambalea y al cabo de unos segundos se levanta como zombi
        c.infected -= dt;
        const a = Math.random() * Math.PI * 2;
        const sx = Math.cos(a) * 0.3 * dt;
        const sy = Math.sin(a) * 0.3 * dt;
        if (this.walkable(c.gx + sx, c.gy + sy)) {
          c.gx += sx;
          c.gy += sy;
        }
        if (c.infected <= 0) turned.push(c);
        continue;
      }
      // ¿amenaza cerca? zombis a menos de 11 tiles, o tiros / explosiones
      let fx = 0;
      let fy = 0;
      let threat = false;
      const gcx = Math.floor(c.gx / 4);
      const gcy = Math.floor(c.gy / 4);
      for (let yy = gcy - 3; yy <= gcy + 3; yy++) {
        for (let xx = gcx - 3; xx <= gcx + 3; xx++) {
          for (const z of zGrid.get(`${xx},${yy}`) ?? []) {
            const dx = c.gx - z.gx;
            const dy = c.gy - z.gy;
            const d2 = dx * dx + dy * dy;
            if (d2 < 121 && d2 > 0.0001) {
              threat = true;
              fx += dx / d2;
              fy += dy / d2;
            }
          }
        }
      }
      for (const n of this.noises) {
        const dx = c.gx - n.gx;
        const dy = c.gy - n.gy;
        const d2 = dx * dx + dy * dy;
        if (d2 < n.r * n.r && d2 > 0.0001) {
          threat = true;
          fx += (dx / d2) * 0.5;
          fy += (dy / d2) * 0.5;
        }
      }
      if (threat) c.panic = 4 + Math.random() * 2;
      else c.panic = Math.max(0, c.panic - dt);
      // caído en el suelo: no se mueve hasta levantarse (antes si alguien le ayuda)
      if (c.fallen > 0) {
        c.fallen -= dt;
        if (c.fallen <= 0) c.helped = false;
        continue;
      }
      // ayudando a alguien a levantarse: va hacia él y tira de él
      if (c.helping > 0) {
        const f = byId.get(c.helping);
        if (!f || f.fallen <= 0 || f.infected > 0) {
          c.helping = 0;
          c.helpT = 0;
        } else if (c.helpT > 0) {
          c.helpT -= dt;
          if (c.helpT <= 0) {
            f.fallen = 0;
            f.helped = false;
            f.panic = Math.max(f.panic, 3);
            c.helping = 0;
          }
          continue;
        } else {
          const hx = f.gx - c.gx;
          const hy = f.gy - c.gy;
          const hd = Math.hypot(hx, hy);
          if (hd < 0.55) {
            c.helpT = 0.9 + Math.random() * 0.6;
            continue;
          }
          const nx = c.gx + (hx / hd) * c.run * dt;
          const ny = c.gy + (hy / hd) * c.run * dt;
          if (this.walkable(nx, ny)) {
            c.gx = nx;
            c.gy = ny;
          } else c.helping = 0;
          continue;
        }
      }
      if (c.panic > 0) {
        // en desbandada se tropieza: cae al suelo un rato
        if (Math.random() < dt * 0.06) {
          c.fallen = 1.5 + Math.random() * 2.5;
          continue;
        }
        // algunos se paran a ayudar a quien ha caído cerca
        if (Math.random() < dt * 1.5) {
          for (const f of this.civilians) {
            if (f === c || f.fallen <= 0 || f.helped || f.infected > 0) continue;
            if (Math.abs(f.gx - c.gx) > 3 || Math.abs(f.gy - c.gy) > 3) continue;
            f.helped = true;
            if (Math.random() < 0.4) c.helping = f.id;
            break;
          }
          if (c.helping > 0) continue;
        }
        // huida: lejos de la amenaza, corriendo; si choca, prueba a desviarse
        const fl = Math.hypot(fx, fy);
        let ang = fl > 1e-6 ? Math.atan2(fy, fx) : Math.atan2(c.gy - c.ty, c.gx - c.tx);
        ang += (Math.random() - 0.5) * 0.4;
        const step = c.run * dt;
        for (const off of [0, 0.7, -0.7, 1.4, -1.4, 2.1, -2.1]) {
          const nx = c.gx + Math.cos(ang + off) * step;
          const ny = c.gy + Math.sin(ang + off) * step;
          if (this.walkable(nx, ny)) {
            c.tx = c.gx;
            c.ty = c.gy;
            c.gx = nx;
            c.gy = ny;
            break;
          }
        }
        continue;
      }
      // paseo: va a un punto cercano, a veces se para un poco, y elige otro
      if (c.wait > 0) {
        c.wait -= dt;
        continue;
      }
      const dx = c.tx - c.gx;
      const dy = c.ty - c.gy;
      const d = Math.hypot(dx, dy);
      if (d < 0.3) {
        c.wait = Math.random() < 0.3 ? 1 + Math.random() * 3 : 0;
        for (let k = 0; k < 6; k++) {
          const a = Math.random() * Math.PI * 2;
          const r = 3 + Math.random() * 7;
          const nx = c.gx + Math.cos(a) * r;
          const ny = c.gy + Math.sin(a) * r;
          // de paseo, por la acera (cruzan la calzada solo si al otro lado sigue la acera
          // cerca: como por un paso de peatones, sin cruzar a media manzana)
          const mid = this.sidewalk((c.gx + nx) / 2, (c.gy + ny) / 2);
          if (this.sidewalk(nx, ny) && (mid || r < 5)) {
            c.tx = nx;
            c.ty = ny;
            break;
          }
        }
        continue;
      }
      const nx = c.gx + (dx / d) * c.walk * dt;
      const ny = c.gy + (dy / d) * c.walk * dt;
      if (this.walkable(nx, ny) && (this.sidewalk(nx, ny) || this.sidewalk(c.tx, c.ty))) {
        c.gx = nx;
        c.gy = ny;
      } else {
        c.tx = c.gx;
        c.ty = c.gy;
      }
    }
    if (turned.length > 0) {
      const gone = new Set(turned);
      this.civilians = this.civilians.filter((c) => !gone.has(c));
      for (const c of turned) {
        this.zombies.push({ id: this.nextZombieId++, gx: c.gx, gy: c.gy, hp: ZOMBIE_MAX_HP, speed: 0.9 + Math.random() * 0.6, hitCooldown: 1, pack: this.nextPack++ });
      }
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
