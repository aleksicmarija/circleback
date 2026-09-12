/** 0 = north (z-), 1 = east (x+), 2 = south (z+), 3 = west (x-). */
export type Dir = 0 | 1 | 2 | 3;

export const DIR_DX: readonly number[] = [0, 1, 0, -1];
export const DIR_DZ: readonly number[] = [-1, 0, 1, 0];

export const opposite = (dir: Dir): Dir => ((dir + 2) % 4) as Dir;
export const turnRight = (dir: Dir): Dir => ((dir + 1) % 4) as Dir;
export const turnLeft = (dir: Dir): Dir => ((dir + 3) % 4) as Dir;

export type PlayerId = string;

/** What every client sees about a player. */
export type PlayerSnapshot = {
  id: PlayerId;
  name: string;
  /** Colour index, stable for the player's lifetime in the room. */
  slot: number;
  isBot: boolean;
  /** Cosmetic model id (see PET_SKINS / BOT_SKINS). Optional so older backends still work. */
  skin?: string;
  /** Short line shown above bots: what the agent is currently doing or saying. */
  status?: string;
  alive: boolean;
  /** Continuous position in cell units; cell (cx, cz) has its centre at (cx + 0.5, cz + 0.5). */
  x: number;
  z: number;
  dir: Dir;
  /** Cells of territory owned. Score = cells / (w * h). */
  cells: number;
  kills: number;
  /** Milliseconds until respawn; 0 while alive. */
  respawnIn: number;
  /** Name of whoever cut this player off, while dead. */
  killedBy: string | null;
  /** Milliseconds since this player last sent input; always 0 for bots. */
  idleMs: number;
};

/** Cells that changed between two grid versions, as flat triples: index, owner, trail. */
export type GridPatch = { from: number; version: number; cells: number[] };

/** A full copy of both grid layers at one version. */
export type GridState = { gridVersion: number; owner: Uint8Array; trail: Uint8Array };

/** What a snapshot carries about the grid: everything, or only recent changes. */
export type GridMode = "full" | "patches";

/**
 * One frame of authoritative state.
 *
 * The grid travels one of two ways. A "full" snapshot carries both layers.
 * A "patches" snapshot carries the room's recent change log instead, a few
 * dozen bytes per tick rather than 8 KB: the client applies the patch whose
 * `from` matches the version it holds and fetches the full grid only when it
 * has fallen further behind than the log remembers.
 *
 * Grid encoding, both layers: 0 = nobody, otherwise slot + 1.
 */
export type Snapshot = {
  code: string;
  tick: number;
  /** Server clock (ms) when the snapshot was taken. */
  at: number;
  w: number;
  h: number;
  gridVersion: number;
  owner?: Uint8Array;
  trail?: Uint8Array;
  /** Recent grid changes, oldest first. Present in "patches" mode. */
  patches?: GridPatch[];
  players: PlayerSnapshot[];
};
