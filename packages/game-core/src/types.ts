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

/** Bytes per changed cell in a patch: index (uint16 little-endian), owner, trail. */
export const PATCH_STRIDE = 4;

/**
 * Cells that changed between two grid versions, packed PATCH_STRIDE bytes
 * each. Bytes rather than a number array because the same change costs a few
 * times less on the wire and sidesteps Convex's limit on array length, which
 * together let the log hold real captures instead of dropping them.
 */
export type GridPatch = { from: number; version: number; cells: Uint8Array };

/** Writes a patch's cells into both grid layers. The only reader of the packing above. */
export function applyPatchCells(cells: Uint8Array, owner: Uint8Array, trail: Uint8Array): void {
  for (let at = 0; at + PATCH_STRIDE <= cells.length; at += PATCH_STRIDE) {
    const index = cells[at] | (cells[at + 1] << 8);
    owner[index] = cells[at + 2];
    trail[index] = cells[at + 3];
  }
}

/** Packs one changed cell at `at`. The only writer of the packing above. */
export function writePatchCell(cells: Uint8Array, at: number, index: number, owner: number, trail: number): void {
  cells[at] = index & 0xff;
  cells[at + 1] = (index >> 8) & 0xff;
  cells[at + 2] = owner;
  cells[at + 3] = trail;
}

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
