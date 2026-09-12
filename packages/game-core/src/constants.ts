// Tuning shared by the simulation and the renderer.

/** Arena size in cells. */
export const GRID_W = 64;
export const GRID_H = 64;

/** Simulation step. 100ms = 10 ticks/sec; movement is dt-based so this only affects smoothness and cost. */
export const TICK_MS = 100;

/**
 * Slower step used by hosts that pay per tick when only spectators are
 * watching and every piece is a bot. Keeps the screen alive at a fraction
 * of the cost; the client's interpolator follows the observed frame spacing.
 */
export const AUDIENCE_TICK_MS = 250;

/** How often a paused room (nobody playing or watching) checks whether to wake or delete itself. */
export const IDLE_POLL_MS = 1000;

/** Movement speed in cells per second. Players never stop moving. */
export const PLAYER_SPEED = 6.5;

/** Client renders this far behind the newest snapshot so it always has two to blend between. */
export const INTERP_DELAY_MS = 200;

/** Time between dying and reappearing somewhere fresh. */
export const RESPAWN_MS = 2500;

/** Radius of the starting blob of territory. */
export const SPAWN_RADIUS = 2;

/**
 * Hard cap on pieces per room. Not a design limit: the grid stores each
 * cell's owner as one byte (0 = nobody, slot + 1), which leaves 254 slots.
 */
export const MAX_PLAYERS = 254;

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
 * Total budget for the patch log inside the room document. Ordinary ticks add
 * well under 100 bytes, so this only bites after a run of large captures, and
 * it stops the log from bloating the row that every tick rewrites.
 */
export const GRID_LOG_MAX_BYTES = 4_096;

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

/**
 * Spectators keep a room alive without playing in it. A spectator page sends
 * a heartbeat every WATCH_HEARTBEAT_MS; a room counts as watched for
 * WATCH_TTL_MS after the last one.
 */
export const WATCH_HEARTBEAT_MS = 10_000;
export const WATCH_TTL_MS = 30_000;

/** A room with no humans in it is deleted after this long. */
export const ROOM_IDLE_MS = 30_000;

/**
 * Hand-picked colours for the first slots: saturated so paint reads on a
 * dark floor, and no white, which is reserved for the local player's rim and
 * would hide a trail against territory. The first eight are the most distinct
 * hues; the second eight are lighter cousins. Slots beyond the list get a
 * generated colour from `colorForSlot`.
 */
export const PLAYER_COLORS = [
  0xf87171, 0xfb923c, 0xfacc15, 0x2dd4bf,
  0x60a5fa, 0xa78bfa, 0x4ade80, 0xf472b6,
  0xa3e635, 0x22d3ee, 0xe879f9, 0xfdba74,
  0x86efac, 0xc4b5fd, 0xfda4af, 0xfde68a,
] as const;

/** Colour for any slot: the palette while it lasts, then evenly spread hues at varying lightness. */
export function colorForSlot(slot: number): number {
  if (slot < PLAYER_COLORS.length) return PLAYER_COLORS[slot];
  const n = slot - PLAYER_COLORS.length;
  const hue = (n * 137.508) % 360; // golden angle: consecutive slots land far apart
  const light = 0.55 + 0.15 * ((n % 3) - 1); // 0.40, 0.55, 0.70
  return hslToHex(hue, 0.85, light);
}

function hslToHex(h: number, s: number, l: number): number {
  const k = (n: number) => (n + h / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = (n: number) => l - a * Math.max(-1, Math.min(k(n) - 3, 9 - k(n), 1));
  const c = (v: number) => Math.round(v * 255);
  return (c(f(0)) << 16) | (c(f(8)) << 8) | c(f(4));
}

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
