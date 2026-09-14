import type { BotMode, BotPersona } from "./bots";
import type { Player } from "./room";
import type { PlayerId } from "./types";

/**
 * What a brain gets to see: a few hundred bytes, not the grid. Built from
 * the persisted player list alone so a host can prepare it without loading
 * the board. Coordinates are cells, `pct` is territory as a percentage.
 */
export type BrainPiece = {
  id: PlayerId;
  name: string;
  isBot: boolean;
  alive: boolean;
  pct: number;
  trail: number;
  x: number;
  z: number;
  kills: number;
  /** Bots only: current plan and who they are. */
  mode?: BotMode;
  target?: PlayerId | null;
  persona?: BotPersona | null;
};

export type BrainView = { code: string; pieces: BrainPiece[] };

/** One instruction back from the brain, per bot. */
export type BrainMove = {
  id: PlayerId;
  mode: BotMode;
  target: PlayerId | null;
  /** A line to show above the bot's head; null keeps the plan's default description. */
  say: string | null;
};

export function brainView(code: string, players: readonly Player[], w: number, h: number): BrainView {
  const total = w * h;
  const pieces: BrainPiece[] = players.map((p) => {
    const piece: BrainPiece = {
      id: p.id,
      name: p.name,
      isBot: p.isBot,
      alive: p.alive,
      pct: Math.round((p.cells / total) * 1000) / 10,
      trail: p.trailCells.length,
      x: p.cx,
      z: p.cz,
      kills: p.kills,
    };
    if (p.bot) {
      piece.mode = p.bot.plan?.mode;
      piece.target = p.bot.plan?.target ?? null;
      piece.persona = p.bot.persona;
    }
    return piece;
  });
  return { code, pieces };
}
