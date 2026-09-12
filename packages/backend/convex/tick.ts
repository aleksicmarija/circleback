import { internalMutation } from "./_generated/server";
import { internal } from "./_generated/api";
import { v } from "convex/values";
import { AUDIENCE_TICK_MS, IDLE_POLL_MS, ROOM_IDLE_MS, TICK_MS, WATCH_TTL_MS, type Dir } from "@game/core";
import { byCode, gridByCode, hydrate, persist } from "./rooms";
import type { MutationCtx } from "./_generated/server";

/** Applies and clears every queued direction change for a room, oldest first. */
async function drainInputs(ctx: MutationCtx, code: string, apply: (playerId: string, dir: Dir, at: number) => void): Promise<void> {
  const pending = await ctx.db
    .query("inputs")
    .withIndex("by_code", (q) => q.eq("code", code))
    .collect();
  pending.sort((a, b) => a.at - b.at || a._creationTime - b._creationTime);
  for (const input of pending) {
    apply(input.playerId, input.dir as Dir, input.at);
    await ctx.db.delete(input._id);
  }
}

/** Forgets the player -> room link of players the simulation removed. */
async function forgetPlayers(ctx: MutationCtx, playerIds: string[]): Promise<void> {
  for (const playerId of playerIds) {
    const link = await ctx.db
      .query("playerRooms")
      .withIndex("by_player", (q) => q.eq("playerId", playerId))
      .first();
    if (link) await ctx.db.delete(link._id);
  }
}

/**
 * The server-authoritative game loop: one Convex mutation that reschedules
 * itself every TICK_MS. A Convex mutation is a fresh invocation each time,
 * so every tick loads the room's persisted state, drives a real `Room`
 * instance exactly like the local server does, and persists what changed.
 */
export const tick = internalMutation({
  args: { code: v.string() },
  handler: async (ctx, { code }) => {
    const doc = await byCode(ctx, code);
    if (!doc) return; // room deleted; loop ends here
    const grid = await gridByCode(ctx, code);
    if (!grid) {
      await ctx.db.delete(doc._id); // half a room is no room; stop the loop
      return;
    }

    const now = Date.now();
    const room = hydrate(doc, grid);

    // Bots play for humans in the room or for anyone watching it; otherwise pause.
    const watched = doc.lastWatchedAt !== undefined && now - doc.lastWatchedAt < WATCH_TTL_MS;
    if (room.humanCount === 0 && !watched) {
      const emptySince = doc.emptySince ?? now;
      if (now - emptySince > ROOM_IDLE_MS) {
        await drainInputs(ctx, code, () => {});
        await ctx.db.delete(doc._id);
        await ctx.db.delete(grid._id);
        return;
      }
      if (doc.emptySince === undefined) await ctx.db.patch(doc._id, { emptySince });
      // Paused: poll slowly rather than burning a function call every tick.
      await ctx.scheduler.runAfter(IDLE_POLL_MS, internal.tick.tick, { code });
      return;
    }

    room.ensureBots(now);
    await drainInputs(ctx, code, (playerId, dir, at) => room.setDirection(playerId, dir, at));
    const { kicked } = room.step(now);
    await forgetPlayers(ctx, kicked);
    await persist(ctx, doc, grid, room, { emptySince: undefined });
    // Bots playing for a screen alone run at a slower, cheaper cadence.
    const cadence = room.humanCount === 0 ? AUDIENCE_TICK_MS : TICK_MS;
    await ctx.scheduler.runAfter(cadence, internal.tick.tick, { code });
  },
});
