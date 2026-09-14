import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

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
});
