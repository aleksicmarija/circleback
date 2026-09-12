import { internalMutation } from "./_generated/server";
import { internal } from "./_generated/api";
import { v } from "convex/values";
import { ROOM_IDLE_MS, TICK_MS } from "@game/core";
import { byCode, hydrate, patchFromRoom } from "./rooms";

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
        await ctx.db.delete(doc._id);
        return;
      }
      if (doc.emptySince === undefined) await ctx.db.patch(doc._id, { emptySince });
      await ctx.scheduler.runAfter(TICK_MS, internal.tick.tick, { code });
      return;
    }

    room.ensureBots(now);
    room.step(now);
    await ctx.db.patch(doc._id, { emptySince: undefined, ...patchFromRoom(room, doc.gridVersion) });
    await ctx.scheduler.runAfter(TICK_MS, internal.tick.tick, { code });
  },
});
