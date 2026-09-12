import { query, mutation } from "./_generated/server";
import { v } from "convex/values";
import type { Dir, Snapshot } from "@game/core";
import { byCode, hydrate } from "./rooms";

/** The subscription payload: a `Snapshot` in "patches" mode, which never carries the byte layers. */
type WireSnapshot = Omit<Snapshot, "owner" | "trail">;

/**
 * The single subscription the client lives on. Convex re-runs this and pushes
 * the result to every connected client whenever any row it read changes.
 * The shape is `@core`'s `Snapshot` in "patches" mode: players plus the
 * room's recent grid change log, never the full 8 KB layers. A client that
 * falls behind the log calls `grid` once to resync.
 */
export const snapshot = query({
  args: { code: v.string() },
  handler: async (ctx, { code }): Promise<WireSnapshot | null> => {
    const doc = await byCode(ctx, code.toUpperCase());
    if (!doc) return null;
    const { owner: _owner, trail: _trail, ...snap } = hydrate(doc).snapshot(Date.now(), "patches");
    return snap;
  },
});

/** Full grid layers, fetched once on join and whenever a client misses patches. */
export const grid = query({
  args: { code: v.string() },
  handler: async (ctx, { code }) => {
    const doc = await byCode(ctx, code.toUpperCase());
    if (!doc) return null;
    return { gridVersion: doc.gridVersion, owner: doc.owner, trail: doc.trail };
  },
});

/**
 * Records a player's intent. Only inserts a row into `inputs`; the tick
 * applies it. Keeping this mutation off the room document means a keypress
 * never conflicts with the tick's write, so neither one gets retried.
 */
export const setDirection = mutation({
  args: { playerId: v.string(), dir: v.union(v.literal(0), v.literal(1), v.literal(2), v.literal(3)) },
  handler: async (ctx, { playerId, dir }) => {
    const link = await ctx.db
      .query("playerRooms")
      .withIndex("by_player", (q) => q.eq("playerId", playerId))
      .first();
    if (!link) return;
    await ctx.db.insert("inputs", { code: link.code, playerId, dir: dir as Dir, at: Date.now() });
  },
});
