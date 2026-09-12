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
export const GRID_LOG_LENGTH = 20;

/**
 * Total budget for the patch log inside the room document. Ordinary ticks add
 * well under 100 bytes, so this only bites after a run of large captures, and
 * it stops the log from bloating the row that every tick rewrites.
 */
export const GRID_LOG_MAX_BYTES = 16_384;

/**
 * A change touching more cells than this is not worth sending as a patch: at
 * PATCH_STRIDE bytes per cell it would cost more than both grid layers
 * (GRID_W * GRID_H * 2 bytes), so the snapshot ships the layers instead.
 * This is the break-even point, not a wire limit -- patches are bytes, so
 * Convex's 8192-element array limit no longer applies.
 */
export const MAX_PATCH_CELLS = (GRID_W * GRID_H * 2) / 4;

/** A human who has not sent any input for this long is removed from the room. */
export const IDLE_KICK_MS = 45_000;

/** The client starts warning this long before the kick. */
export const IDLE_WARN_MS = 15_000;

/** A room with no humans in it is deleted after this long. */
export const ROOM_IDLE_MS = 30_000;

/**
 * Per-player colours, indexed by slot. Eight distinct hues, saturated so paint
 * reads on a dark floor, and no white: white is reserved for the local
 * player's rim and would make a trail indistinguishable from territory.
 * Bots fill slots 0-5 first, so the first humans land on the last two.
 */
export const PLAYER_COLORS = [
  0xf87171, 0xfb923c, 0xfacc15, 0x2dd4bf,
  0x60a5fa, 0xa78bfa, 0x4ade80, 0xf472b6,
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
