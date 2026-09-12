import { INTERP_DELAY_MS, TICK_MS, type PlayerSnapshot } from "@core";

/** A snapshot, kept on the server's clock rather than the moment it reached us. */
type Frame = { at: number; players: PlayerSnapshot[] };

const MAX_FRAMES = 8;
/** A jump longer than this between frames is a respawn, not movement. */
const TELEPORT_CELLS = 3;

/** Delay tracking: how much later than best-case each snapshot arrived. */
const JITTER_SAMPLES = 40;
const MIN_SAMPLES = 8;
const DELAY_MARGIN_MS = 30;
const MIN_DELAY_MS = 90;
const MAX_DELAY_MS = 400;
const DELAY_EASING = 0.1;
/** How quickly the clock offset follows genuine drift once a best case is known. */
const OFFSET_DRIFT = 0.002;

const frames: Frame[] = [];
const jitters: number[] = [];
/** Server-time gap between consecutive frames; the feed slows to AUDIENCE_TICK_MS when only bots play. */
const spacings: number[] = [];
/** localClock - serverClock, estimated from the least-delayed snapshot seen. */
let offset = 0;
let haveOffset = false;
let delayMs = INTERP_DELAY_MS;

/**
 * Records a snapshot against the server clock it was taken on.
 *
 * Timing frames by arrival instead would turn network and scheduler jitter
 * straight into speed changes: two snapshots holding one tick of motion that
 * arrive 60ms apart would be played half as fast again as two that arrive
 * 150ms apart. The server advances positions by real elapsed time, so its own
 * timestamps are the even timeline, and jitter belongs in the delay buffer.
 */
export function record(serverAt: number, players: PlayerSnapshot[]): void {
  const observed = performance.now() - serverAt;

  if (!haveOffset) {
    offset = observed;
    haveOffset = true;
  } else if (observed < offset) {
    // A faster trip than anything seen so far is the truer offset.
    offset = observed;
  } else {
    offset += (observed - offset) * OFFSET_DRIFT;
  }

  jitters.push(observed - offset);
  if (jitters.length > JITTER_SAMPLES) jitters.shift();
  if (jitters.length >= MIN_SAMPLES) {
    const sorted = [...jitters].sort((a, b) => a - b);
    const p95 = sorted[Math.floor(0.95 * (sorted.length - 1))];
    // One frame of buffer so a newer frame always exists, plus the jitter to
    // absorb. The frame spacing is measured, not assumed: a room with only
    // bots ticks slower, and the buffer has to grow with it.
    const target = Math.min(MAX_DELAY_MS, Math.max(MIN_DELAY_MS, p95 + frameSpacing() + DELAY_MARGIN_MS));
    delayMs += (target - delayMs) * DELAY_EASING;
  }

  const newest = frames[frames.length - 1];
  if (newest && serverAt <= newest.at) return; // stale or duplicate delivery
  if (newest) {
    spacings.push(serverAt - newest.at);
    if (spacings.length > JITTER_SAMPLES) spacings.shift();
  }
  frames.push({ at: serverAt, players });
  if (frames.length > MAX_FRAMES) frames.shift();
}

/** Typical gap between frames on the server clock; never less than one full-speed tick. */
function frameSpacing(): number {
  if (spacings.length < MIN_SAMPLES) return TICK_MS;
  const sorted = [...spacings].sort((a, b) => a - b);
  return Math.max(TICK_MS, sorted[Math.floor(0.5 * (sorted.length - 1))]);
}

export function reset(): void {
  frames.length = 0;
  jitters.length = 0;
  spacings.length = 0;
  offset = 0;
  haveOffset = false;
  delayMs = INTERP_DELAY_MS;
}

/** How far behind the newest snapshot the scene is rendered right now, in ms. */
export function currentDelay(): number {
  return delayMs;
}

/**
 * The instant on the server's clock that the scene is currently showing.
 * Anything keyed to a snapshot (board paint, effects) must use this, or it
 * will run ahead of the pieces.
 */
export function renderTime(nowLocal: number): number {
  return nowLocal - offset - delayMs;
}

/**
 * Renders `currentDelay()` behind the feed, blending the two snapshots that
 * bracket that instant. This turns the server tick into smooth motion.
 */
export function sample(nowLocal: number): PlayerSnapshot[] {
  if (frames.length === 0) return [];

  const target = renderTime(nowLocal);
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
