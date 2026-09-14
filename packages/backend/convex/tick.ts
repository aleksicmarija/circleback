import { internalMutation, env } from "./_generated/server";
import { internal } from "./_generated/api";
import { v } from "convex/values";
import {
  AUDIENCE_TICK_MS, BRAIN_INTERVAL_MS, IDLE_POLL_MS, MAX_SUMMONED_BOTS, PLAN_TTL_MS, ROOM_IDLE_MS, TICK_MS, WATCH_TTL_MS,
  type Dir, type Room,
} from "@game/core";
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

/**
 * Hands the brain's queued plans to the bots, spawns rivals that finished
 * summoning, and clears the queue, oldest first. Spawning here, rather than
 * in the summon pipeline, keeps every write to the room document in the tick.
 */
async function drainBotCommands(ctx: MutationCtx, code: string, room: Room, now: number): Promise<void> {
  const pending = await ctx.db
    .query("botCommands")
    .withIndex("by_code", (q) => q.eq("code", code))
    .collect();
  pending.sort((a, b) => a.at - b.at || a._creationTime - b._creationTime);
  for (const batch of pending) {
    for (const move of batch.moves) {
      room.setPlan(move.id, { mode: move.mode, target: move.target, until: now + PLAN_TTL_MS }, move.say);
    }
    for (const spawn of batch.spawns ?? []) {
      const summon = await ctx.db.get(spawn.summonId);
      if (!summon) continue;
      if (room.summonedCount >= MAX_SUMMONED_BOTS) {
        await ctx.db.patch(spawn.summonId, { status: "failed", detail: "The arena filled up with rivals first." });
      } else {
        const player = room.addBot(spawn.name, now, spawn.persona, true);
        await ctx.db.patch(spawn.summonId, { status: "joined", detail: spawn.persona.blurb, botName: player.name, playerId: player.id });
      }
      if (summon.reply) await ctx.scheduler.runAfter(0, internal.email.answer, { summonId: spawn.summonId });
    }
    await ctx.db.delete(batch._id);
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
    await drainBotCommands(ctx, code, room, now);
    const { kicked } = room.step(now);
    await forgetPlayers(ctx, kicked);

    // Ask the brain for fresh plans every BRAIN_INTERVAL_MS while the room is
    // active. It answers into `botCommands`, which a later tick drains; the
    // timestamp travels with the room row this tick writes anyway.
    let brainAt = doc.brainAt;
    if (env.OPENAI_API_KEY && now - (brainAt ?? 0) >= BRAIN_INTERVAL_MS) {
      brainAt = now;
      await ctx.scheduler.runAfter(0, internal.brains.think, { code });
    }
    await persist(ctx, doc, grid, room, { emptySince: undefined, brainAt });
    // Bots playing for a screen alone run at a slower, cheaper cadence.
    const cadence = room.humanCount === 0 ? AUDIENCE_TICK_MS : TICK_MS;
    await ctx.scheduler.runAfter(cadence, internal.tick.tick, { code });
  },
});
