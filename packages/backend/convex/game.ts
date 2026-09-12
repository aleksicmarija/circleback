import { query, mutation } from "./_generated/server";
import { v } from "convex/values";
import { DEFAULT_ROOM_CODE, type Dir, type Snapshot } from "@game/core";
import { byCode, createPublicArena, hydrate, toArrayBuffer } from "./rooms";

/**
 * The subscription payload. Same shape as `@core`'s `Snapshot`, except every
 * Uint8Array becomes Convex's bytes type on the wire. The grid layers are
 * normally absent -- `Room.snapshot` includes them only when no patch can
 * chain to the current version, so a client never has to stall on a separate
 * fetch to redraw its board.
 */
type WireSnapshot = Omit<Snapshot, "owner" | "trail" | "patches"> & {
  owner?: ArrayBuffer;
  trail?: ArrayBuffer;
  patches?: { from: number; version: number; cells: ArrayBuffer }[];
};

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
    const snap = hydrate(doc).snapshot(Date.now(), "patches");
    return {
      ...snap,
      owner: snap.owner ? toArrayBuffer(snap.owner) : undefined,
      trail: snap.trail ? toArrayBuffer(snap.trail) : undefined,
      patches: snap.patches?.map((p) => ({ from: p.from, version: p.version, cells: toArrayBuffer(p.cells) })),
    };
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
 * A spectator's heartbeat. Marks the room as watched so the tick keeps the
 * bots playing for an audience, and brings the public arena into existence
 * if a screen is opened before anyone has joined.
 */
export const watch = mutation({
  args: { code: v.string() },
  handler: async (ctx, { code }) => {
    const upper = code.toUpperCase();
    let doc = await byCode(ctx, upper);
    if (!doc && upper === DEFAULT_ROOM_CODE) doc = await createPublicArena(ctx);
    if (doc) await ctx.db.patch(doc._id, { lastWatchedAt: Date.now(), emptySince: undefined });
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
