// Tuning shared by the simulation and the renderer.

/** Arena size in cells. */
export const GRID_W = 64;
export const GRID_H = 64;

/** Simulation step. 100ms = 10 ticks/sec; movement is dt-based so this only affects smoothness and cost. */
export const TICK_MS = 100;

/** Movement speed in cells per second. Players never stop moving. */
export const PLAYER_SPEED = 6.5;

/** Client renders this far behind the newest snapshot so it always has two to blend between. */
export const INTERP_DELAY_MS = 200;

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

/** How many grid patches a room remembers; a client further behind than this refetches the full grid. */
export const GRID_LOG_LENGTH = 6;

/** A room with no humans in it is deleted after this long. */
export const ROOM_IDLE_MS = 30_000;

/** Per-player colours, indexed by slot. Saturated so paint reads on a dark floor. */
export const PLAYER_COLORS = [
  0x38bdf8, 0xf472b6, 0x4ade80, 0xfacc15,
  0xa78bfa, 0xf87171, 0xe2e8f0, 0xfb923c,
] as const;

/**
 * Cosmetic skins. Humans pick a pet; bots are always robots. The client loads
 * `/models/<skin>.glb`, so these ids double as file names.
 */
export const PET_SKINS = [
  "pet-elephant", "pet-pig", "pet-caterpillar", "pet-bee",
  "pet-koala", "pet-crab", "pet-panda", "pet-tiger",
] as const;
export const BOT_SKINS = ["robot-a", "robot-b"] as const;

export type Skin = (typeof PET_SKINS)[number] | (typeof BOT_SKINS)[number];

export const BOT_NAMES = [
  "Nova", "Pixel", "Zed", "Byte", "Comet", "Blip",
  "Rook", "Tango", "Juno", "Vex", "Kilo", "Echo",
] as const;
