import {
  GRID_W, GRID_H, PLAYER_SPEED, RESPAWN_MS, SPAWN_RADIUS,
  MAX_PLAYERS, MIN_PLAYERS, BOT_NAMES, BOT_SKINS, PET_SKINS,
} from "./constants";
import { Grid } from "./grid";
import {
  DIR_DX, DIR_DZ, opposite, turnLeft, turnRight,
  type Dir, type PlayerId, type PlayerSnapshot, type Snapshot,
} from "./types";
import { createBotState, decideBot, pickTargetTrail, type BotState } from "./bots";

export type Player = {
  id: PlayerId;
  name: string;
  slot: number;
  isBot: boolean;
  skin: string;
  /** Free-text line shown above the player; an AI agent can set it via setStatus. */
  status: string | null;
  alive: boolean;
  /** Cell the player is leaving; `progress` is how far along to the next one (0..1). */
  cx: number;
  cz: number;
  dir: Dir;
  /** Turn applied at the next cell centre, so paths always follow grid lines. */
  nextDir: Dir;
  progress: number;
  /** Cell indices of the current trail, oldest first. */
  trailCells: number[];
  kills: number;
  respawnAt: number;
  killedBy: string | null;
  bot: BotState | null;
};

/** What a heuristic bot is up to, for the label above its head. */
function botStatus(p: Player): string {
  if (!p.alive) return "rebooting";
  if (!p.bot) return "";
  if (p.trailCells.length >= p.bot.targetTrail) return "heading home";
  if (p.trailCells.length > 0) return "raiding";
  return "patrolling";
}

export class RoomFullError extends Error {
  constructor() {
    super("Room is full");
  }
}

/**
 * One arena. Pure simulation: no timers, no I/O. The host calls `step(now)`
 * on a schedule and `snapshot(now)` to read the result.
 *
 * Rules (Color Galaxy / paper.io):
 * - Everyone moves constantly at PLAYER_SPEED; you only choose a direction.
 * - Outside your territory you leave a trail. Re-entering your territory
 *   captures everything the loop enclosed.
 * - Anyone who drives over a trail kills its owner. That includes your own.
 * - The arena edge bounces you 90 degrees to a random side.
 * - Dying wipes your territory.
 */
export class Room {
  readonly grid = new Grid(GRID_W, GRID_H);
  readonly players = new Map<PlayerId, Player>();
  tick = 0;
  /** Bumped whenever either grid layer changes; lets hosts skip resending an unchanged grid. */
  gridVersion = 1;

  private readonly bySlot: (Player | null)[] = new Array(MAX_PLAYERS).fill(null);
  private readonly counts = new Uint32Array(MAX_PLAYERS + 1);
  private countedVersion = 0;
  private lastStepAt: number | null = null;
  private nextId = 1;
  private nextBotName = 0;
  private nextBotSkin = 0;

  constructor(
    readonly code: string,
    private readonly random: () => number = Math.random,
    /** Hosts running several rooms must supply ids that are unique across all of them. */
    private readonly makeId: (isBot: boolean) => string = (isBot) => `${isBot ? "b" : "p"}${this.nextId++}`,
  ) {}

  get humanCount(): number {
    let n = 0;
    for (const p of this.players.values()) if (!p.isBot) n++;
    return n;
  }

  /** Adds a player and spawns them. A human joining a full room evicts a bot. */
  addPlayer(name: string, isBot: boolean, now: number, skin?: string): Player {
    let slot = this.freeSlot();
    if (slot < 0 && !isBot) {
      const bot = [...this.players.values()].find((p) => p.isBot);
      if (bot) {
        this.removePlayer(bot.id);
        slot = this.freeSlot();
      }
    }
    if (slot < 0) throw new RoomFullError();

    const player: Player = {
      id: this.makeId(isBot),
      name,
      slot,
      isBot,
      skin: this.pickSkin(isBot, slot, skin),
      status: null,
      alive: false,
      cx: 0,
      cz: 0,
      dir: 0,
      nextDir: 0,
      progress: 0,
      trailCells: [],
      kills: 0,
      respawnAt: now,
      killedBy: null,
      bot: isBot ? createBotState(this.random) : null,
    };
    this.players.set(player.id, player);
    this.bySlot[slot] = player;
    this.spawn(player);
    return player;
  }

  removePlayer(id: PlayerId): void {
    const player = this.players.get(id);
    if (!player) return;
    this.clearFootprint(player);
    this.players.delete(id);
    this.bySlot[player.slot] = null;
  }

  /** Tops the room up with bots to MIN_PLAYERS. */
  ensureBots(now: number): void {
    while (this.players.size < MIN_PLAYERS) {
      const name = BOT_NAMES[this.nextBotName++ % BOT_NAMES.length];
      this.addPlayer(name, true, now);
    }
  }

  /** Lets an external brain (an LLM agent, for instance) narrate what a player is doing. */
  setStatus(id: PlayerId, status: string | null): void {
    const player = this.players.get(id);
    if (player) player.status = status;
  }

  /** The only input a player has. Reversing into your own trail is refused. */
  setDirection(id: PlayerId, dir: Dir): void {
    const player = this.players.get(id);
    if (!player || !player.alive) return;
    if (dir === opposite(player.dir)) return;
    player.nextDir = dir;
  }

  step(now: number): void {
    // Clamp dt so a stalled host cannot fling everyone across the arena.
    const dt = this.lastStepAt === null ? 0 : Math.min((now - this.lastStepAt) / 1000, 0.25);
    this.lastStepAt = now;
    this.tick++;

    for (const player of this.players.values()) {
      if (!player.alive) {
        if (now >= player.respawnAt) this.spawn(player);
        continue;
      }

      player.progress += PLAYER_SPEED * dt;

      while (player.alive && player.progress >= 1) {
        player.progress -= 1;
        this.enterCell(player, player.cx + DIR_DX[player.dir], player.cz + DIR_DZ[player.dir], now);
        if (!player.alive) break;
        if (player.bot) decideBot(this, player, player.bot, this.random);
        player.dir = player.nextDir;
        this.steerOffWalls(player);
      }
    }

    this.resolveHeadOn(now);
  }

  snapshot(now: number, includeGrid: boolean): Snapshot {
    if (this.countedVersion !== this.gridVersion) {
      this.grid.count(this.counts);
      this.countedVersion = this.gridVersion;
    }

    const players: PlayerSnapshot[] = [];
    for (const p of this.players.values()) {
      players.push({
        id: p.id,
        name: p.name,
        slot: p.slot,
        isBot: p.isBot,
        skin: p.skin,
        status: p.status ?? (p.bot ? botStatus(p) : undefined),
        alive: p.alive,
        x: p.cx + 0.5 + DIR_DX[p.dir] * p.progress,
        z: p.cz + 0.5 + DIR_DZ[p.dir] * p.progress,
        dir: p.dir,
        cells: this.counts[p.slot + 1],
        kills: p.kills,
        respawnIn: p.alive ? 0 : Math.max(0, p.respawnAt - now),
        killedBy: p.killedBy,
      });
    }

    return {
      code: this.code,
      tick: this.tick,
      at: now,
      w: this.grid.w,
      h: this.grid.h,
      gridVersion: this.gridVersion,
      owner: includeGrid ? this.grid.owner.slice() : undefined,
      trail: includeGrid ? this.grid.trail.slice() : undefined,
      players,
    };
  }

  // ---- internals ---------------------------------------------------------

  private freeSlot(): number {
    return this.bySlot.indexOf(null);
  }

  private pickSkin(isBot: boolean, slot: number, requested?: string): string {
    if (isBot) return BOT_SKINS[this.nextBotSkin++ % BOT_SKINS.length];
    if (requested && (PET_SKINS as readonly string[]).includes(requested)) return requested;
    return PET_SKINS[slot % PET_SKINS.length];
  }

  /** About to drive off the edge: turn 90 degrees to a random side that stays inside. */
  private steerOffWalls(p: Player): void {
    const { grid } = this;
    if (grid.inBounds(p.cx + DIR_DX[p.dir], p.cz + DIR_DZ[p.dir])) return;
    const options = [turnLeft(p.dir), turnRight(p.dir)].filter((d) =>
      grid.inBounds(p.cx + DIR_DX[d], p.cz + DIR_DZ[d]),
    );
    p.dir = options.length > 0 ? options[Math.floor(this.random() * options.length)] : opposite(p.dir);
    p.nextDir = p.dir;
  }

  private enterCell(p: Player, x: number, z: number, now: number): void {
    const { grid } = this;
    if (!grid.inBounds(x, z)) {
      // steerOffWalls should make this unreachable; bounce rather than crash if it is not.
      this.steerOffWalls(p);
      return;
    }

    p.cx = x;
    p.cz = z;
    const i = grid.index(x, z);
    const v = p.slot + 1;

    const t = grid.trail[i];
    if (t !== 0) {
      const victim = this.bySlot[t - 1];
      if (victim) this.kill(victim, victim === p ? null : p, now);
      if (!p.alive) return;
    }

    if (grid.owner[i] === v) {
      if (p.trailCells.length > 0) {
        grid.capture(v);
        p.trailCells.length = 0;
        this.gridVersion++;
        if (p.bot) p.bot.targetTrail = pickTargetTrail(this.random);
      }
    } else {
      grid.trail[i] = v;
      p.trailCells.push(i);
      this.gridVersion++;
    }
  }

  /** Two heads on one cell: whoever is not standing in their own territory dies. */
  private resolveHeadOn(now: number): void {
    const occupied = new Map<number, Player[]>();
    for (const p of this.players.values()) {
      if (!p.alive) continue;
      const i = this.grid.index(p.cx, p.cz);
      const list = occupied.get(i);
      if (list) list.push(p);
      else occupied.set(i, [p]);
    }
    for (const [i, list] of occupied) {
      if (list.length < 2) continue;
      for (const p of list) {
        if (this.grid.owner[i] !== p.slot + 1) {
          const other = list.find((q) => q !== p) ?? null;
          this.kill(p, other, now);
        }
      }
    }
  }

  private kill(p: Player, killer: Player | null, now: number): void {
    if (!p.alive) return;
    p.alive = false;
    p.respawnAt = now + RESPAWN_MS;
    p.killedBy = killer ? killer.name : null;
    if (killer && killer !== p) killer.kills++;
    this.clearFootprint(p);
  }

  private clearFootprint(p: Player): void {
    this.grid.clear(p.slot + 1);
    p.trailCells.length = 0;
    this.gridVersion++;
  }

  private spawn(p: Player): void {
    const { grid } = this;
    const v = p.slot + 1;
    const { x, z } = this.findSpawn();

    p.alive = true;
    p.cx = x;
    p.cz = z;
    p.dir = Math.floor(this.random() * 4) as Dir;
    p.nextDir = p.dir;
    this.steerOffWalls(p);
    p.progress = 0;
    p.trailCells.length = 0;
    p.killedBy = null;

    const r = SPAWN_RADIUS;
    for (let dz = -r; dz <= r; dz++) {
      for (let dx = -r; dx <= r; dx++) {
        // Rounded square: drop the corners so the blob reads as a circle.
        if (dx * dx + dz * dz > r * r + 1) continue;
        const cx = x + dx;
        const cz = z + dz;
        if (!grid.inBounds(cx, cz)) continue;
        const i = grid.index(cx, cz);
        grid.owner[i] = v;
        grid.trail[i] = 0;
      }
    }
    this.gridVersion++;

    if (p.bot) {
      p.bot.homeX = x;
      p.bot.homeZ = z;
      p.bot.targetTrail = pickTargetTrail(this.random);
    }
  }

  /** A spot with nothing painted nearby and no player heads close by. */
  private findSpawn(): { x: number; z: number } {
    const { grid } = this;
    const margin = SPAWN_RADIUS + 2;
    const clearance = SPAWN_RADIUS + 2;
    let x = margin;
    let z = margin;

    for (let attempt = 0; attempt < 60; attempt++) {
      x = margin + Math.floor(this.random() * (grid.w - margin * 2));
      z = margin + Math.floor(this.random() * (grid.h - margin * 2));

      let clear = true;
      for (let dz = -clearance; dz <= clearance && clear; dz++) {
        for (let dx = -clearance; dx <= clearance; dx++) {
          const i = grid.index(x + dx, z + dz);
          if (grid.owner[i] !== 0 || grid.trail[i] !== 0) {
            clear = false;
            break;
          }
        }
      }
      if (!clear) continue;

      for (const other of this.players.values()) {
        if (!other.alive) continue;
        if (Math.abs(other.cx - x) <= 6 && Math.abs(other.cz - z) <= 6) {
          clear = false;
          break;
        }
      }
      if (clear) break;
    }

    return { x, z };
  }
}
