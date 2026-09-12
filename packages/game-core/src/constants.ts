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

/** Hard cap on pieces per room: one colour per slot. Humans are otherwise unlimited. */
export const MAX_PLAYERS = 16;

/**
 * The board never has fewer pieces than this. Bots make up the difference:
 * a human joining a board at or above this size takes a bot's seat while any
 * bot is left, beyond that humans simply join; a human leaving is replaced by
 * a bot again whenever the count drops below it.
 */
export const MIN_PIECES = 7;

export const MAX_NAME_LENGTH = 16;

/** The public arena everyone lands in when they just press Play. */
export const DEFAULT_ROOM_CODE = "MAIN";

/** How many grid patches a room remembers; a client further behind than this refetches the full grid. */
export const GRID_LOG_LENGTH = 6;

/**
 * A change touching more cells than this (a big capture, a wipe) is not
 * logged as a patch; clients resync from the full grid instead. Keeps every
 * patch under Convex's 8192-element array limit (3 numbers per cell) and
 * avoids shipping a patch bigger than the grid itself.
 */
export const MAX_PATCH_CELLS = 512;

/** A human who has not sent any input for this long is removed from the room. */
export const IDLE_KICK_MS = 45_000;

/** The client starts warning this long before the kick. */
export const IDLE_WARN_MS = 15_000;

/** A room with no humans in it is deleted after this long. */
export const ROOM_IDLE_MS = 30_000;

/**
 * Per-player colours, indexed by slot: MAX_PLAYERS distinct entries, saturated
 * so paint reads on a dark floor, and no white, which is reserved for the
 * local player's rim and would hide a trail against territory. The first
 * eight are the most distinct hues; the second eight are lighter cousins.
 */
export const PLAYER_COLORS = [
  0xf87171, 0xfb923c, 0xfacc15, 0x2dd4bf,
  0x60a5fa, 0xa78bfa, 0x4ade80, 0xf472b6,
  0xa3e635, 0x22d3ee, 0xe879f9, 0xfdba74,
  0x86efac, 0xc4b5fd, 0xfda4af, 0xfde68a,
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
