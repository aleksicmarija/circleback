import { DIR_DX, DIR_DZ, type Dir } from "./types";
import type { Player, Room } from "./room";

/**
 * Bot behaviour: head out, draw a rough rectangle by favouring turns in one
 * direction, then steer home once the trail is long enough. Each cell entry
 * scores straight/left/right by a short look-ahead and picks the best.
 */
export type BotState = {
  /** Trail length at which the bot turns for home. */
  targetTrail: number;
  /** Last cell the bot stood on inside its own territory. */
  homeX: number;
  homeZ: number;
  /** 1 = clockwise loops, 3 = counter-clockwise. */
  turnBias: 1 | 3;
};

export function createBotState(random: () => number): BotState {
  return {
    targetTrail: pickTargetTrail(random),
    homeX: 0,
    homeZ: 0,
    turnBias: random() < 0.5 ? 1 : 3,
  };
}

export function pickTargetTrail(random: () => number): number {
  return 6 + Math.floor(random() * 14);
}

export function decideBot(room: Room, p: Player, bot: BotState, random: () => number): void {
  const { grid } = room;
  const v = p.slot + 1;
  const inHome = grid.owner[grid.index(p.cx, p.cz)] === v;

  if (inHome && p.trailCells.length === 0) {
    bot.homeX = p.cx;
    bot.homeZ = p.cz;
  }

  const goHome = p.trailCells.length >= bot.targetTrail;
  if (goHome && grid.owner[grid.index(bot.homeX, bot.homeZ)] !== v) {
    relocateHome(room, p, bot);
  }
  const distHere = Math.abs(p.cx - bot.homeX) + Math.abs(p.cz - bot.homeZ);

  const withBias = ((p.dir + bot.turnBias) % 4) as Dir;
  const againstBias = ((p.dir + 4 - bot.turnBias) % 4) as Dir;
  const candidates: Dir[] = [p.dir, withBias, againstBias];

  let bestDir = p.dir;
  let bestScore = -Infinity;

  for (const d of candidates) {
    let score = d === p.dir ? 0.5 : 0;

    // Look a few cells ahead: walls and our own trail are fatal, other
    // people's trails are kills.
    for (let k = 1; k <= 4; k++) {
      const nx = p.cx + DIR_DX[d] * k;
      const nz = p.cz + DIR_DZ[d] * k;
      if (!grid.inBounds(nx, nz)) {
        score -= k === 1 ? 1000 : 6 / k;
        break;
      }
      const t = grid.trail[grid.index(nx, nz)];
      if (t === v) {
        score -= k === 1 ? 1000 : 6 / k;
        break;
      }
      if (t !== 0 && k <= 2) score += 3;
    }

    if (goHome) {
      const nx = p.cx + DIR_DX[d];
      const nz = p.cz + DIR_DZ[d];
      const dist = Math.abs(nx - bot.homeX) + Math.abs(nz - bot.homeZ);
      score += (distHere - dist) * 2;
    } else if (!inHome && d === withBias && random() < 0.18) {
      score += 1.5;
    } else if (inHome && d !== p.dir && random() < 0.1) {
      score += 1;
    }

    score += random() * 0.3;
    if (score > bestScore) {
      bestScore = score;
      bestDir = d;
    }
  }

  p.nextDir = bestDir;
}

/** Home got captured: aim for the nearest cell we still own, if any. */
function relocateHome(room: Room, p: Player, bot: BotState): void {
  const { grid } = room;
  const v = p.slot + 1;
  let best = Infinity;
  for (let i = 0; i < grid.owner.length; i++) {
    if (grid.owner[i] !== v) continue;
    const x = i % grid.w;
    const z = (i - x) / grid.w;
    const dist = Math.abs(x - p.cx) + Math.abs(z - p.cz);
    if (dist < best) {
      best = dist;
      bot.homeX = x;
      bot.homeZ = z;
    }
  }
}
