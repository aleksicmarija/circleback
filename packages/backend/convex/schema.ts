import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

export default defineSchema({
  rooms: defineTable({
    code: v.string(),
    status: v.union(v.literal("lobby"), v.literal("playing"), v.literal("ended")),
    // Identifies the currently-live tick loop. A tick whose token no longer
    // matches exits, which prevents two loops running for one room.
    tickToken: v.number(),
  }).index("by_code", ["code"]),

  players: defineTable({
    roomId: v.id("rooms"),
    name: v.string(),
    colorIndex: v.number(),
    // Authoritative position, written only by the tick.
    x: v.number(),
    z: v.number(),
    // Desired velocity, written only by the input mutation.
    vx: v.number(),
    vz: v.number(),
    yaw: v.number(),
    lastInputAt: v.number(),
  }).index("by_room", ["roomId"]),

  // Pipeline smoke test only (apps/smoke + smoke.ts). Safe to delete later.
  smoke_pings: defineTable({
    sender: v.string(),
    sentAt: v.number(),
    at: v.number(),
  }).index("by_at", ["at"]),
});
