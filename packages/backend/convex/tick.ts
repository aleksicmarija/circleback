import { internalMutation } from "./_generated/server";
import { internal } from "./_generated/api";
import { v } from "convex/values";
import { ROOM_IDLE_MS, TICK_MS, type Dir } from "@game/core";
import { byCode, hydrate, patchFromRoom } from "./rooms";
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

    const now = Date.now();
    const room = hydrate(doc);

    if (room.humanCount === 0) {
      const emptySince = doc.emptySince ?? now;
      if (now - emptySince > ROOM_IDLE_MS) {
        await drainInputs(ctx, code, () => {});
        await ctx.db.delete(doc._id);
        return;
      }
      if (doc.emptySince === undefined) await ctx.db.patch(doc._id, { emptySince });
      await ctx.scheduler.runAfter(TICK_MS, internal.tick.tick, { code });
      return;
    }

    room.ensureBots(now);
    await drainInputs(ctx, code, (playerId, dir, at) => room.setDirection(playerId, dir, at));
    const { kicked } = room.step(now);
    await forgetPlayers(ctx, kicked);
    await ctx.db.patch(doc._id, { emptySince: undefined, ...patchFromRoom(room, doc.gridVersion) });
    await ctx.scheduler.runAfter(TICK_MS, internal.tick.tick, { code });
  },
});
