import { INTERP_DELAY_MS, type PlayerSnapshot } from "@core";

type Frame = { at: number; players: PlayerSnapshot[] };

const MAX_FRAMES = 8;
/** A jump longer than this between frames is a respawn, not movement. */
const TELEPORT_CELLS = 3;

const frames: Frame[] = [];

/** Called once per server snapshot, stamped with local arrival time. */
export function record(players: PlayerSnapshot[]): void {
  frames.push({ at: performance.now(), players });
  if (frames.length > MAX_FRAMES) frames.shift();
}

export function reset(): void {
  frames.length = 0;
}

/**
 * Renders INTERP_DELAY_MS behind the newest snapshot, so there are always two
 * snapshots to blend between. This turns the server tick into smooth motion.
 */
export function sample(now: number): PlayerSnapshot[] {
  if (frames.length === 0) return [];

  const target = now - INTERP_DELAY_MS;
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
