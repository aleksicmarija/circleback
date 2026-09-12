// Tuning shared by the server tick and the client renderer.
// Both sides must agree on these or interpolation will look wrong.

/** Server simulation step. 100ms = 10 ticks/sec. */
export const TICK_MS = 100;

/** Minimum gap between accepted inputs from one player. Enforced server-side. */
export const INPUT_MIN_INTERVAL_MS = 100;

/** Client renders this far behind the newest snapshot so it always has two to lerp between. */
export const INTERP_DELAY_MS = 200;

/** Tick loop stops after this long with no input from anyone, so idle rooms cost nothing. */
export const IDLE_STOP_MS = 60_000;

/** Arena is a square spanning -ARENA_HALF..+ARENA_HALF on both x and z. */
export const ARENA_HALF = 25;

/** Player movement speed in world units per second. */
export const PLAYER_SPEED = 8;

export const PLAYER_RADIUS = 0.5;

export const MAX_PLAYERS = 8;

/** Per-player colours, indexed by join order. */
export const PLAYER_COLORS = [
  0x4cc9f0, 0xf72585, 0x4ade80, 0xfbbf24,
  0xa78bfa, 0xfb7185, 0x22d3ee, 0xfacc15,
] as const;
