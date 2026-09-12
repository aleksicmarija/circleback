import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

// One document per room holds the entire `RoomState` as flat top-level
// fields, not nested inside one `state: {...}` object. `patch` replaces
// whatever value a field is given wholesale rather than deep-merging, so
// keeping `owner`/`trail` as siblings of `players`/`tick`/etc. lets a tick
// that didn't change the grid omit those two (large) fields from its patch
// entirely instead of being forced to re-supply them every time.
export default defineSchema({
  rooms: defineTable({
    code: v.string(),
    // Set when humanCount hits 0; the room is deleted after ROOM_IDLE_MS.
    emptySince: v.optional(v.number()),

    tick: v.number(),
    gridVersion: v.number(),
    lastStepAt: v.union(v.number(), v.null()),
    nextId: v.number(),
    nextBotName: v.number(),
    owner: v.bytes(), // Uint8Array, GRID_W * GRID_H
    trail: v.bytes(), // same size
    players: v.array(
      v.object({
        id: v.string(),
        name: v.string(),
        slot: v.number(),
        isBot: v.boolean(),
        alive: v.boolean(),
        cx: v.number(),
        cz: v.number(),
        dir: v.number(),
        nextDir: v.number(),
        progress: v.number(),
        trailCells: v.array(v.number()),
        kills: v.number(),
        respawnAt: v.number(),
        killedBy: v.union(v.string(), v.null()),
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

  // Mirrors GameServer's in-memory `owners: Map<PlayerId, Connection>`. The
  // Backend interface's `leaveRoom`/`setDirection` only take a player id, not
  // a room code, so something has to carry that mapping.
  playerRooms: defineTable({
    playerId: v.string(),
    code: v.string(),
  }).index("by_player", ["playerId"]),

  // Pipeline smoke test only (apps/smoke + smoke.ts). Unrelated to the game.
  smoke_pings: defineTable({
    sender: v.string(),
    sentAt: v.number(),
    at: v.number(),
  }).index("by_at", ["at"]),
});
