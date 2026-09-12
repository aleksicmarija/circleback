import { mutation } from "./_generated/server";
import { internal } from "./_generated/api";
import { v, ConvexError } from "convex/values";
import { MAX_PLAYERS, PLAYER_COLORS, ARENA_HALF, TICK_MS } from "./constants";

// Ambiguous characters (0/O, 1/I) left out so codes are easy to read aloud.
const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

function randomCode(): string {
  let code = "";
  for (let i = 0; i < 4; i++) {
    code += CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)];
  }
  return code;
}

/** Spawns players evenly around a circle so nobody starts inside anyone else. */
function spawnPoint(index: number): { x: number; z: number; yaw: number } {
  const angle = (index / MAX_PLAYERS) * Math.PI * 2;
  const radius = ARENA_HALF * 0.6;
  return {
    x: Math.cos(angle) * radius,
    z: Math.sin(angle) * radius,
    yaw: angle + Math.PI,
  };
}

export const create = mutation({
  args: { name: v.string() },
  handler: async (ctx, { name }) => {
    // Retry on the small chance of a code collision.
    let code = randomCode();
    for (let attempt = 0; attempt < 5; attempt++) {
      const clash = await ctx.db
        .query("rooms")
        .withIndex("by_code", (q) => q.eq("code", code))
        .first();
      if (!clash) break;
      code = randomCode();
    }

    const roomId = await ctx.db.insert("rooms", {
      code,
      status: "lobby",
      tickToken: 0,
    });

    const spawn = spawnPoint(0);
    const playerId = await ctx.db.insert("players", {
      roomId,
      name,
      colorIndex: 0,
      x: spawn.x,
      z: spawn.z,
      vx: 0,
      vz: 0,
      yaw: spawn.yaw,
      lastInputAt: Date.now(),
    });

    return { code, roomId, playerId };
  },
});

export const join = mutation({
  args: { code: v.string(), name: v.string() },
  handler: async (ctx, { code, name }) => {
    const room = await ctx.db
      .query("rooms")
      .withIndex("by_code", (q) => q.eq("code", code.toUpperCase()))
      .first();
    if (!room) throw new ConvexError(`No room with code ${code}`);

    const players = await ctx.db
      .query("players")
      .withIndex("by_room", (q) => q.eq("roomId", room._id))
      .collect();
    if (players.length >= MAX_PLAYERS) throw new ConvexError("Room is full");

    const slot = players.length;
    const spawn = spawnPoint(slot);
    const playerId = await ctx.db.insert("players", {
      roomId: room._id,
      name,
      colorIndex: slot % PLAYER_COLORS.length,
      x: spawn.x,
      z: spawn.z,
      vx: 0,
      vz: 0,
      yaw: spawn.yaw,
      lastInputAt: Date.now(),
    });

    return { code: room.code, roomId: room._id, playerId };
  },
});

export const leave = mutation({
  args: { playerId: v.id("players") },
  handler: async (ctx, { playerId }) => {
    const player = await ctx.db.get(playerId);
    if (player) await ctx.db.delete(playerId);
  },
});

/**
 * Flips the room to "playing" and starts the tick loop.
 * Bumping tickToken retires any loop still running from a previous start.
 */
export const start = mutation({
  args: { roomId: v.id("rooms") },
  handler: async (ctx, { roomId }) => {
    const room = await ctx.db.get(roomId);
    if (!room) throw new ConvexError("Room not found");

    const token = room.tickToken + 1;
    await ctx.db.patch(roomId, { status: "playing", tickToken: token });
    await ctx.scheduler.runAfter(TICK_MS, internal.tick.tick, {
      roomId,
      token,
      prevAt: Date.now(),
    });
  },
});
