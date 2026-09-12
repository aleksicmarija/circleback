import { query, mutation } from "./_generated/server";
import { v } from "convex/values";
import type { Dir, Snapshot } from "@game/core";
import { byCode, hydrate, patchFromRoom } from "./rooms";

/** A `Snapshot` with the grid layers as `ArrayBuffer`s, Convex's wire type for bytes. */
type WireSnapshot = Omit<Snapshot, "owner" | "trail"> & { owner?: ArrayBuffer; trail?: ArrayBuffer };

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

/**
 * The single subscription the client lives on. Convex re-runs this and pushes
 * the result to every connected client whenever any row it read changes.
 * The shape is `@core`'s `Snapshot`, unmodified except that the grid layers
 * cross the wire as `ArrayBuffer` (Convex's bytes type) instead of
 * `Uint8Array`; the client adapter converts them back.
 */
export const snapshot = query({
  args: { code: v.string() },
  handler: async (ctx, { code }): Promise<WireSnapshot | null> => {
    const doc = await byCode(ctx, code.toUpperCase());
    if (!doc) return null;

    const snap = hydrate(doc).snapshot(Date.now(), true);
    return {
      ...snap,
      owner: snap.owner ? toArrayBuffer(snap.owner) : undefined,
      trail: snap.trail ? toArrayBuffer(snap.trail) : undefined,
    };
  },
});

/**
 * Records a player's intent. Direction changes are edge-triggered -- one
 * call per keypress, not per tick -- so hydrating/re-serializing the whole
 * room here is bounded by input rate, not tick rate.
 */
export const setDirection = mutation({
  args: { playerId: v.string(), dir: v.union(v.literal(0), v.literal(1), v.literal(2), v.literal(3)) },
  handler: async (ctx, { playerId, dir }) => {
    const link = await ctx.db
      .query("playerRooms")
      .withIndex("by_player", (q) => q.eq("playerId", playerId))
      .first();
    if (!link) return;

    const doc = await byCode(ctx, link.code);
    if (!doc) return;

    const room = hydrate(doc);
    room.setDirection(playerId, dir as Dir);
    await ctx.db.patch(doc._id, patchFromRoom(room, doc.gridVersion));
  },
});
