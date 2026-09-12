// Tuning shared by the simulation and the renderer.

/** Arena size in cells. */
export const GRID_W = 64;
export const GRID_H = 64;

/** Simulation step. 50ms = 20 ticks/sec. */
export const TICK_MS = 50;

/** Movement speed in cells per second. Players never stop moving. */
export const PLAYER_SPEED = 6.5;

/** Client renders this far behind the newest snapshot so it always has two to blend between. */
export const INTERP_DELAY_MS = 100;

/** Time between dying and reappearing somewhere fresh. */
export const RESPAWN_MS = 2500;

/** Radius of the starting blob of territory. */
export const SPAWN_RADIUS = 2;

/** Hard cap per room, humans and bots combined. Also bounds the colour palette. */
export const MAX_PLAYERS = 8;

/** Bots top a room up to this many players so it never feels empty. */
export const MIN_PLAYERS = 6;

export const MAX_NAME_LENGTH = 16;

/** The public arena everyone lands in when they just press Play. */
export const DEFAULT_ROOM_CODE = "MAIN";

/** A room with no humans in it is deleted after this long. */
export const ROOM_IDLE_MS = 30_000;

/** Per-player colours, indexed by slot. */
export const PLAYER_COLORS = [
  0x4cc9f0, 0xf72585, 0x4ade80, 0xfbbf24,
  0xa78bfa, 0xfb7185, 0x22d3ee, 0xf97316,
] as const;

export const BOT_NAMES = [
  "Nova", "Pixel", "Zed", "Mango", "Comet", "Blip",
  "Rook", "Tango", "Juno", "Vex", "Kilo", "Echo",
] as const;
