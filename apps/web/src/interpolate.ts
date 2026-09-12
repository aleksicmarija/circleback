import { INTERP_DELAY_MS } from "@backend/constants";
import type { PlayerView } from "./net";

type Frame = { at: number; players: PlayerView[] };

const MAX_FRAMES = 8;
const frames: Frame[] = [];

/** Called once per server snapshot, stamped with local arrival time. */
export function record(players: PlayerView[]): void {
  frames.push({ at: performance.now(), players });
  if (frames.length > MAX_FRAMES) frames.shift();
}

export function reset(): void {
  frames.length = 0;
}

function shortestTurn(from: number, to: number): number {
  const full = Math.PI * 2;
  let delta = (to - from) % full;
  if (delta > Math.PI) delta -= full;
  if (delta < -Math.PI) delta += full;
  return delta;
}

/**
 * Renders INTERP_DELAY_MS behind the newest snapshot, so there are always two
 * snapshots to blend between. This is what turns a 10Hz server tick into
 * smooth 60fps motion.
 */
export function sample(now: number): PlayerView[] {
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
    // A player who joined between the two frames has nothing to blend from.
    if (!before) return player;
    return {
      ...player,
      x: before.x + (player.x - before.x) * t,
      z: before.z + (player.z - before.z) * t,
      yaw: before.yaw + shortestTurn(before.yaw, player.yaw) * t,
    };
  });
}
