import { mutation, query } from "./_generated/server";
import { v } from "convex/values";

// Pipeline smoke test (see apps/smoke). Not part of the game.
// A ping is inserted by a browser; every subscribed browser sees it within a
// tick over the WebSocket. Keeps only the newest rows so the table stays tiny.
const KEEP = 20;

export const latest = query({
  args: {},
  handler: async (ctx) => {
    const pings = await ctx.db
      .query("smoke_pings")
      .withIndex("by_at")
      .order("desc")
      .take(KEEP);
    return { count: pings.length, pings };
  },
});

export const ping = mutation({
  args: { sender: v.string(), sentAt: v.number() },
  handler: async (ctx, { sender, sentAt }) => {
    const at = Date.now();
    await ctx.db.insert("smoke_pings", { sender, sentAt, at });

    const stale = await ctx.db
      .query("smoke_pings")
      .withIndex("by_at")
      .order("desc")
      .collect();
    for (const row of stale.slice(KEEP)) {
      await ctx.db.delete(row._id);
    }
    return { at };
  },
});
