import { internalMutation } from "./_generated/server";
import { internal } from "./_generated/api";
import { v } from "convex/values";
import { TICK_MS, IDLE_STOP_MS, ARENA_HALF, PLAYER_RADIUS } from "./constants";

const clamp = (value: number, limit: number) =>
  Math.max(-limit, Math.min(limit, value));

/**
 * The server-authoritative game loop: one Convex mutation that reschedules
 * itself every TICK_MS.
 *
 * Every exit path below is deliberate. This loop consumes function calls for
 * as long as it runs, so it must stop on its own when nobody is playing.
 */
export const tick = internalMutation({
  args: {
    roomId: v.id("rooms"),
    token: v.number(),
    prevAt: v.number(),
  },
  handler: async (ctx, { roomId, token, prevAt }) => {
    const room = await ctx.db.get(roomId);

    // Stop: room deleted, no longer playing, or a newer loop has taken over.
    if (!room || room.status !== "playing" || room.tickToken !== token) return;

    const players = await ctx.db
      .query("players")
      .withIndex("by_room", (q) => q.eq("roomId", roomId))
      .collect();

    const now = Date.now();
    const lastInputAt = players.reduce((max, p) => Math.max(max, p.lastInputAt), 0);

    // Stop: everyone left, or nobody has touched a key in a while.
    if (players.length === 0 || now - lastInputAt > IDLE_STOP_MS) {
      await ctx.db.patch(roomId, { status: "ended" });
      return;
    }

    // Clamp dt so a delayed tick cannot teleport everyone across the arena.
    const dt = Math.min((now - prevAt) / 1000, 0.5);
    const bound = ARENA_HALF - PLAYER_RADIUS;

    for (const player of players) {
      const x = clamp(player.x + player.vx * dt, bound);
      const z = clamp(player.z + player.vz * dt, bound);
      // Only write when something moved; an idle player costs no bandwidth
      // and does not invalidate the snapshot subscription.
      if (x !== player.x || z !== player.z) {
        await ctx.db.patch(player._id, { x, z });
      }
    }

    // prevAt travels through the schedule rather than the room row, so an
    // idle tick performs zero writes.
    await ctx.scheduler.runAfter(TICK_MS, internal.tick.tick, {
      roomId,
      token,
      prevAt: now,
    });
  },
});
