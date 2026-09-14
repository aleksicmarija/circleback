import { internalAction, internalMutation, internalQuery, env } from "./_generated/server";
import { internal } from "./_generated/api";
import { v } from "convex/values";
import {
  BOT_MODES, GRID_H, GRID_W, MAX_STATUS_LENGTH, brainView,
  type BotMode, type BrainMove, type BrainView,
} from "@game/core";
import { byCode, normalizePlayers } from "./rooms";

/**
 * The bots' brain: OpenAI picks a strategy for every bot in a room and
 * writes the line shown above its head. It never steers; the game core's
 * heuristic executes the plan cell by cell (see `BotPlan` in @game/core).
 *
 * The tick schedules `think` every BRAIN_INTERVAL_MS for an active room.
 * `think` reads a compact view of the board, calls the model, and drops the
 * answer into `botCommands`, which the next tick drains exactly like player
 * input, so the brain never writes the room document and never contends
 * with the tick.
 */

export const DEFAULT_MODEL = "gpt-5-mini";
const OPENAI_TIMEOUT_MS = 9_000;

export const vMode = v.union(...BOT_MODES.map((m) => v.literal(m)));
export const vMove = v.object({
  id: v.string(),
  mode: vMode,
  target: v.union(v.string(), v.null()),
  say: v.union(v.string(), v.null()),
});

/** The board as the brain sees it: players only, no grid. */
export const view = internalQuery({
  args: { code: v.string() },
  returns: v.union(v.null(), v.any()),
  handler: async (ctx, { code }): Promise<BrainView | null> => {
    const doc = await byCode(ctx, code);
    if (!doc) return null;
    return brainView(code, normalizePlayers(doc.players), GRID_W, GRID_H);
  },
});

/** Queues the brain's answer for the tick. */
export const command = internalMutation({
  args: { code: v.string(), moves: v.array(vMove) },
  returns: v.null(),
  handler: async (ctx, { code, moves }) => {
    await ctx.db.insert("botCommands", { code, at: Date.now(), moves });
    return null;
  },
});

export const think = internalAction({
  args: { code: v.string() },
  returns: v.null(),
  handler: async (ctx, { code }) => {
    const apiKey = env.OPENAI_API_KEY;
    if (!apiKey) return null; // no brain configured: bots stay on heuristics
    const board: BrainView | null = await ctx.runQuery(internal.brains.view, { code });
    if (!board || !board.pieces.some((p) => p.isBot)) return null;

    let moves: BrainMove[];
    try {
      moves = await askOpenAI(apiKey, env.OPENAI_MODEL ?? DEFAULT_MODEL, board);
    } catch (error) {
      console.warn(`brain: ${code}: ${error instanceof Error ? error.message : String(error)}`);
      return null;
    }
    if (moves.length > 0) await ctx.runMutation(internal.brains.command, { code, moves });
    return null;
  },
});

const SYSTEM_PROMPT = `You are the hive mind of the robots in Circleback, a real-time territory game (paper.io rules).
Every piece moves constantly on a 64x64 grid. Leaving your territory draws a trail; getting back home captures everything the loop enclosed, including other players' land. Driving over any trail kills its owner, and a piece dies with its whole territory. Score is territory percentage. Pets are the human players; bots are robots you control.

You do not steer. For each bot you choose one strategy for the next few seconds and, optionally, a short line it shows above its head:
- "expand": claim empty ground with safe loops. Good early, or when nobody is nearby.
- "raid" + target: loop through the target's territory to steal it. Best against the leader or a big neighbour.
- "hunt" + target: chase the target and cut its trail. Best against someone far from home with a long trail.
- "defend": short loops close to home. Best when the bot leads or has a long trail out.

Be a good show: vary strategies across bots, pick on the leader, gang up on a pet with a long trail, and let a bot with a persona speak in that persona's voice. Lines are trash talk or narration, under ${MAX_STATUS_LENGTH} characters, no emoji, no hashtags, no quotes, and must be safe for a family audience; use null for about half the bots so the arena is not a wall of text. Never target a dead piece or a bot's own id.`;

const RESPONSE_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    moves: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          id: { type: "string" },
          mode: { type: "string", enum: [...BOT_MODES] },
          target: { type: ["string", "null"] },
          say: { type: ["string", "null"] },
        },
        required: ["id", "mode", "target", "say"],
      },
    },
  },
  required: ["moves"],
};

/** One Chat Completions call for the whole room; returns only moves that make sense on this board. */
async function askOpenAI(apiKey: string, model: string, board: BrainView): Promise<BrainMove[]> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), OPENAI_TIMEOUT_MS);
  let response: Response;
  try {
    response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      signal: controller.signal,
      headers: { "content-type": "application/json", authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model,
        // The GPT-5 family reasons by default; the arena wants speed, not deliberation.
        ...(model.startsWith("gpt-5") ? { reasoning_effort: "minimal" } : { temperature: 0.9 }),
        max_completion_tokens: 700,
        response_format: { type: "json_schema", json_schema: { name: "moves", strict: true, schema: RESPONSE_SCHEMA } },
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          { role: "user", content: `Board:\n${JSON.stringify(board.pieces)}\n\nReturn one move for every bot (isBot true).` },
        ],
      }),
    });
  } finally {
    clearTimeout(timer);
  }
  if (!response.ok) throw new Error(`OpenAI ${response.status}: ${(await response.text()).slice(0, 200)}`);
  const body = (await response.json()) as { choices?: { message?: { content?: string } }[] };
  const content = body.choices?.[0]?.message?.content;
  if (!content) throw new Error("OpenAI returned no content");
  return sanitize(JSON.parse(content), board);
}

/** Keeps only moves for live bots, with targets that exist and lines that fit. */
export function sanitize(raw: unknown, board: BrainView): BrainMove[] {
  const moves = (raw as { moves?: unknown }).moves;
  if (!Array.isArray(moves)) return [];
  const pieces = new Map(board.pieces.map((p) => [p.id, p]));
  const seen = new Set<string>();
  const out: BrainMove[] = [];
  for (const move of moves as Record<string, unknown>[]) {
    const id = typeof move.id === "string" ? move.id : "";
    const bot = pieces.get(id);
    if (!bot?.isBot || seen.has(id)) continue;
    const mode = (BOT_MODES as readonly string[]).includes(String(move.mode)) ? (move.mode as BotMode) : "expand";
    let target = typeof move.target === "string" ? move.target : null;
    if (target === id || (target !== null && !pieces.get(target)?.alive)) target = null;
    if ((mode === "raid" || mode === "hunt") && target === null) continue; // a plan with nobody to aim at
    let say = typeof move.say === "string" ? move.say.replace(/\s+/g, " ").trim() : null;
    if (say !== null && say.length === 0) say = null;
    if (say !== null && say.length > MAX_STATUS_LENGTH) say = `${say.slice(0, MAX_STATUS_LENGTH - 1).trimEnd()}…`;
    seen.add(id);
    out.push({ id, mode, target, say });
  }
  return out;
}
