import { INTERP_DELAY_MS, type PlayerSnapshot } from "@core";

type Frame = { at: number; players: PlayerSnapshot[] };

const MAX_FRAMES = 8;
/** A jump longer than this between frames is a respawn, not movement. */
const TELEPORT_CELLS = 3;

/** Adaptive delay: track how evenly snapshots arrive and stay just behind the worst gaps. */
const INTERVAL_SAMPLES = 40;
const MIN_SAMPLES = 8;
const DELAY_MARGIN_MS = 40;
const MIN_DELAY_MS = 90;
const MAX_DELAY_MS = 400;
const DELAY_EASING = 0.1;

const frames: Frame[] = [];
const intervals: number[] = [];
let lastArrivalAt = 0;
let delayMs = INTERP_DELAY_MS;

/** Called once per server snapshot, stamped with local arrival time. */
export function record(players: PlayerSnapshot[]): void {
  const now = performance.now();
  frames.push({ at: now, players });
  if (frames.length > MAX_FRAMES) frames.shift();

  if (lastArrivalAt > 0) {
    intervals.push(now - lastArrivalAt);
    if (intervals.length > INTERVAL_SAMPLES) intervals.shift();
    if (intervals.length >= MIN_SAMPLES) {
      const sorted = [...intervals].sort((a, b) => a - b);
      const p95 = sorted[Math.floor(0.95 * (sorted.length - 1))];
      const target = Math.min(MAX_DELAY_MS, Math.max(MIN_DELAY_MS, p95 + DELAY_MARGIN_MS));
      delayMs += (target - delayMs) * DELAY_EASING;
    }
  }
  lastArrivalAt = now;
}

export function reset(): void {
  frames.length = 0;
  intervals.length = 0;
  lastArrivalAt = 0;
  delayMs = INTERP_DELAY_MS;
}

/** How far behind the newest snapshot the scene is rendered right now, in ms. */
export function currentDelay(): number {
  return delayMs;
}

/**
 * Renders `currentDelay()` behind the newest snapshot, so there are always
 * two snapshots to blend between. This turns the server tick into smooth motion.
 */
export function sample(now: number): PlayerSnapshot[] {
  if (frames.length === 0) return [];

  const target = now - delayMs;
  let older: Frame | undefined;
  let newer: Frame | undefined;

  for (const frame of frames) {
    if (frame.at <= target) {
      older = frame;
    } else {
      newer = frame;
      break;
    }
  }

  // Not enough history yet, or we have fallen behind the buffer.
  if (!older) return frames[0].players;
  if (!newer) return frames[frames.length - 1].players;

  const span = newer.at - older.at;
  const t = span > 0 ? (target - older.at) / span : 1;
  const previous = new Map(older.players.map((p) => [p.id, p]));

  return newer.players.map((player) => {
    const before = previous.get(player.id);
    if (!before || !before.alive || !player.alive) return player;
    if (Math.abs(player.x - before.x) > TELEPORT_CELLS || Math.abs(player.z - before.z) > TELEPORT_CELLS) {
      return player;
    }
    return {
      ...player,
      x: before.x + (player.x - before.x) * t,
      z: before.z + (player.z - before.z) * t,
    };
  });
}
