import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

/** Mirrors `BotMode` in @game/core. */
export const botMode = v.union(v.literal("expand"), v.literal("raid"), v.literal("hunt"), v.literal("defend"));

/** Mirrors `BotPlan` in @game/core: a strategy from the brain, valid until `until`. */
export const botPlan = v.object({ mode: botMode, target: v.union(v.string(), v.null()), until: v.number() });

/** Mirrors `BotPersona` in @game/core. */
export const botPersona = v.object({ blurb: v.string(), voice: v.string(), source: v.union(v.string(), v.null()) });

// One document per room holds the room state as flat top-level fields. The
// two grid layers live in `grids`, a separate document per room, so that the
// snapshot query, which re-runs on every tick, never reads 8 KB of bytes it
// does not return. The tick reads both and writes the grid only when it changed.
export default defineSchema({
  rooms: defineTable({
    code: v.string(),
    // Set when the room lost its audience (no humans, nobody watching); the
    // room is deleted after ROOM_IDLE_MS.
    emptySince: v.optional(v.number()),
    // Last spectator heartbeat (see game.watch). Bots keep playing for a
    // watched room even when no human is in it.
    lastWatchedAt: v.optional(v.number()),
    // When the tick last asked the brain (brains.think) for the bots' plans.
    brainAt: v.optional(v.number()),

    tick: v.number(),
    gridVersion: v.number(),
    lastStepAt: v.union(v.number(), v.null()),
    nextId: v.number(),
    nextBotName: v.number(),
    // Recent grid changes (see core `GridPatch`). The snapshot query ships
    // these instead of the 8 KB layers; clients refetch the full grid only
    // when they fall behind the log.
    gridLog: v.array(
      v.object({ from: v.number(), version: v.number(), cells: v.bytes() }),
    ),
    players: v.array(
      v.object({
        id: v.string(),
        name: v.string(),
        slot: v.number(),
        isBot: v.boolean(),
        skin: v.string(),
        status: v.union(v.string(), v.null()),
        alive: v.boolean(),
        cx: v.number(),
        cz: v.number(),
        dir: v.number(),
        nextDir: v.number(),
        progress: v.number(),
        trailCells: v.array(v.number()),
        kills: v.number(),
        // Territory size, refreshed by the tick whenever the grid changes, so
        // the snapshot query can score without reading the grid row.
        cells: v.number(),
        respawnAt: v.number(),
        killedBy: v.union(v.string(), v.null()),
        lastInputAt: v.number(),
        bot: v.union(
          v.null(),
          v.object({
            targetTrail: v.number(),
            homeX: v.number(),
            homeZ: v.number(),
            turnBias: v.number(),
            // Optional because rooms written before the brain existed lack
            // them; `normalizePlayers` fills the defaults on load.
            plan: v.optional(v.union(v.null(), botPlan)),
            persona: v.optional(v.union(v.null(), botPersona)),
            summoned: v.optional(v.boolean()),
          }),
        ),
      }),
    ),
  }).index("by_code", ["code"]),

  // The grid layers, one document per room (see the note at the top).
  grids: defineTable({
    code: v.string(),
    gridVersion: v.number(),
    owner: v.bytes(), // Uint8Array, GRID_W * GRID_H
    trail: v.bytes(), // same size
  }).index("by_code", ["code"]),

  // Mirrors GameServer's in-memory `owners: Map<PlayerId, Connection>`. The
  // Backend interface's `leaveRoom`/`setDirection` only take a player id, not
  // a room code, so something has to carry that mapping.
  playerRooms: defineTable({
    playerId: v.string(),
    code: v.string(),
  }).index("by_player", ["playerId"]),

  // Pending direction changes. `setDirection` only inserts here, so a
  // keypress never rewrites the room document and never contends with the
  // tick's write; the tick drains this table for its room each time it runs.
  inputs: defineTable({
    code: v.string(),
    playerId: v.string(),
    dir: v.number(),
    at: v.number(),
  }).index("by_code", ["code"]),

  // Work for the tick that would otherwise contend with it: the brain's
  // answers (brains.think) and rivals ready to spawn (summon.stage). Drained
  // like `inputs`, so nothing but the tick ever writes a room document.
  botCommands: defineTable({
    code: v.string(),
    at: v.number(),
    moves: v.array(
      v.object({
        id: v.string(),
        mode: botMode,
        target: v.union(v.string(), v.null()),
        say: v.union(v.string(), v.null()),
      }),
    ),
    spawns: v.optional(
      v.array(v.object({ summonId: v.id("summons"), name: v.string(), persona: botPersona })),
    ),
  }).index("by_code", ["code"]),

  // A request to bring a rival bot into a room from a web page (Firecrawl
  // scrapes it, OpenAI writes the persona) or from an email. Clients
  // subscribe to a row to follow it from "queued" to "joined".
  summons: defineTable({
    code: v.string(),
    // A URL, or free text describing the rival.
    source: v.string(),
    via: v.union(v.literal("web"), v.literal("email")),
    status: v.union(
      v.literal("queued"),
      v.literal("scraping"),
      v.literal("thinking"),
      v.literal("joined"),
      v.literal("failed"),
    ),
    // Page title while in flight, the bot's blurb once joined, the reason when failed.
    detail: v.optional(v.string()),
    botName: v.optional(v.string()),
    playerId: v.optional(v.string()),
    createdAt: v.number(),
    // Where to answer when the request came in by email.
    reply: v.optional(v.object({ inboxId: v.string(), messageId: v.string(), from: v.string() })),
  }).index("by_code", ["code"]),
});
