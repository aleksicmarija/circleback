import { DIR_DX, DIR_DZ, type Dir, type PlayerId } from "./types";
import type { Player, Room } from "./room";

/**
 * Bot behaviour: head out, draw a rough rectangle by favouring turns in one
 * direction, then steer home once the trail is long enough. Each cell entry
 * scores straight/left/right by a short look-ahead and picks the best.
 *
 * An external brain (an LLM, see `BotPlan`) does not steer. It hands the bot
 * a strategy every few seconds, and the look-ahead below turns that strategy
 * into a preference: which cells are worth driving towards. Steering stays
 * local, cheap and instant; the brain only has to think about the board.
 */

export const BOT_MODES = ["expand", "raid", "hunt", "defend"] as const;
export type BotMode = (typeof BOT_MODES)[number];

/**
 * A strategy handed down by a brain. `target` names another player for
 * `raid` (loop through their land) and `hunt` (cut their trail); it is
 * ignored by `expand` (claim empty ground) and `defend` (short loops near
 * home). The plan expires at `until`, after which the bot is on its own.
 */
export type BotPlan = { mode: BotMode; target: PlayerId | null; until: number };

/** Who a bot is: written by a brain from a web page, an email, or the house list. */
export type BotPersona = {
  /** One line about the bot, for the UI. */
  blurb: string;
  /** How it talks; guidance for whoever writes its lines. */
  voice: string;
  /** Where the persona came from (a URL or an email address), if anywhere. */
  source: string | null;
};

export type BotState = {
  /** Trail length at which the bot turns for home. */
  targetTrail: number;
  /** Last cell the bot stood on inside its own territory. */
  homeX: number;
  homeZ: number;
  /** 1 = clockwise loops, 3 = counter-clockwise. */
  turnBias: 1 | 3;
  /** Current strategy, if a brain has given one. */
  plan: BotPlan | null;
  persona: BotPersona | null;
  /** Summoned rivals are never evicted to make room for a human while a house bot remains. */
  summoned: boolean;
};

export function createBotState(random: () => number, persona: BotPersona | null = null, summoned = false): BotState {
  return {
    targetTrail: pickTargetTrail(random),
    homeX: 0,
    homeZ: 0,
    turnBias: random() < 0.5 ? 1 : 3,
    plan: null,
    persona,
    summoned,
  };
}

export function pickTargetTrail(random: () => number): number {
  return 6 + Math.floor(random() * 14);
}

/** Trail length a plan asks for: raids loop deep into enemy land, defenders stay close. */
export function planTargetTrail(mode: BotMode, current: number): number {
  if (mode === "raid") return Math.max(current, 14);
  if (mode === "defend") return Math.min(current, 8);
  return current;
}

/** What a bot is up to, for the label above its head when the brain has not given it a line. */
export function describeBot(room: Room, p: Player): string {
  if (!p.alive) return "rebooting";
  const bot = p.bot;
  if (!bot) return "";
  const plan = bot.plan;
  const target = plan?.target ? room.players.get(plan.target) : undefined;
  if (plan) {
    switch (plan.mode) {
      case "hunt":
        return target ? `hunting ${target.name}` : "hunting";
      case "raid":
        return target ? `raiding ${target.name}` : "raiding";
      case "defend":
        return "holding the fort";
      case "expand":
        return "land grabbing";
    }
  }
  if (p.trailCells.length >= bot.targetTrail) return "heading home";
  if (p.trailCells.length > 0) return "raiding";
  return "patrolling";
}

export function decideBot(room: Room, p: Player, bot: BotState, random: () => number): void {
  const { grid } = room;
  const v = p.slot + 1;
  const inHome = grid.owner[grid.index(p.cx, p.cz)] === v;

  if (inHome && p.trailCells.length === 0) {
    bot.homeX = p.cx;
    bot.homeZ = p.cz;
  }

  const plan = bot.plan;
  const target = plan?.target ? room.players.get(plan.target) : undefined;
  const hunting = plan?.mode === "hunt" && target?.alive ? target : null;
  const raiding = plan?.mode === "raid" && target?.alive ? target : null;
  const targetV = target ? target.slot + 1 : 0;

  const goHome = p.trailCells.length >= bot.targetTrail;
  if (goHome && grid.owner[grid.index(bot.homeX, bot.homeZ)] !== v) {
    relocateHome(room, p, bot);
  }
  const distHere = Math.abs(p.cx - bot.homeX) + Math.abs(p.cz - bot.homeZ);
  const huntDistHere = hunting ? Math.abs(p.cx - hunting.cx) + Math.abs(p.cz - hunting.cz) : 0;

  const withBias = ((p.dir + bot.turnBias) % 4) as Dir;
  const againstBias = ((p.dir + 4 - bot.turnBias) % 4) as Dir;
  const candidates: Dir[] = [p.dir, withBias, againstBias];

  let bestDir = p.dir;
  let bestScore = -Infinity;

  for (const d of candidates) {
    let score = d === p.dir ? 0.5 : 0;

    // Look a few cells ahead: walls and our own trail are fatal, other
    // people's trails are kills. A plan makes some ground more attractive:
    // the target's trail and land, empty ground, or our own turf.
    for (let k = 1; k <= 4; k++) {
      const nx = p.cx + DIR_DX[d] * k;
      const nz = p.cz + DIR_DZ[d] * k;
      if (!grid.inBounds(nx, nz)) {
        score -= k === 1 ? 1000 : 6 / k;
        break;
      }
      const i = grid.index(nx, nz);
      const t = grid.trail[i];
      if (t === v) {
        score -= k === 1 ? 1000 : 6 / k;
        break;
      }
      if (t !== 0 && k <= 2) score += t === targetV && hunting ? 5 : 3;

      const o = grid.owner[i];
      if (raiding && o === targetV) score += 1.2 / k;
      else if (plan?.mode === "expand" && o === 0 && !goHome) score += 0.6 / k;
      else if (plan?.mode === "defend" && o === v && k === 1) score += 1.5;
    }

    const nx = p.cx + DIR_DX[d];
    const nz = p.cz + DIR_DZ[d];
    if (goHome) {
      const dist = Math.abs(nx - bot.homeX) + Math.abs(nz - bot.homeZ);
      score += (distHere - dist) * 2;
    } else if (hunting) {
      const dist = Math.abs(nx - hunting.cx) + Math.abs(nz - hunting.cz);
      score += (huntDistHere - dist) * 1.2;
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
