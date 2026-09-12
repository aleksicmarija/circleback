import { query, mutation } from "./_generated/server";
import { v, ConvexError } from "convex/values";
import { INPUT_MIN_INTERVAL_MS, PLAYER_SPEED } from "./constants";

/**
 * The single subscription the client lives on. Convex re-runs this and pushes
 * the result to every connected client whenever any row it read changes.
 */
export const snapshot = query({
  args: { code: v.string() },
  handler: async (ctx, { code }) => {
    const room = await ctx.db
      .query("rooms")
      .withIndex("by_code", (q) => q.eq("code", code.toUpperCase()))
      .first();
    if (!room) return null;

    const players = await ctx.db
      .query("players")
      .withIndex("by_room", (q) => q.eq("roomId", room._id))
      .collect();

    return {
      roomId: room._id,
      code: room.code,
      status: room.status,
      players: players.map((p) => ({
        id: p._id,
        name: p.name,
        colorIndex: p.colorIndex,
        x: p.x,
        z: p.z,
        yaw: p.yaw,
      })),
    };
  },
});

/**
 * Records a player's intent. The client sends a direction, never a position --
 * the tick owns position, so a modified client cannot teleport.
 */
export const input = mutation({
  args: {
    playerId: v.id("players"),
    moveX: v.number(),
    moveZ: v.number(),
    yaw: v.number(),
  },
  handler: async (ctx, { playerId, moveX, moveZ, yaw }) => {
    const player = await ctx.db.get(playerId);
    if (!player) throw new ConvexError("Player not found");

    // Rate limit server-side; a client can always ignore its own throttle.
    const now = Date.now();
    if (now - player.lastInputAt < INPUT_MIN_INTERVAL_MS * 0.8) return;

    // Normalise so diagonal movement is not faster than straight movement.
    const length = Math.hypot(moveX, moveZ);
    const nx = length > 1 ? moveX / length : moveX;
    const nz = length > 1 ? moveZ / length : moveZ;

    await ctx.db.patch(playerId, {
      vx: nx * PLAYER_SPEED,
      vz: nz * PLAYER_SPEED,
      yaw,
      lastInputAt: now,
    });
  },
});
