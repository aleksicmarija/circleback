import { mutation } from "./_generated/server";
import { internal } from "./_generated/api";
import { v, ConvexError } from "convex/values";
import {
  Room, RoomFullError, DEFAULT_ROOM_CODE, MAX_NAME_LENGTH, TICK_MS,
  type PlayerState, type RoomState,
} from "@game/core";
import type { Doc } from "./_generated/dataModel";
import type { MutationCtx, QueryCtx } from "./_generated/server";

// Ambiguous characters (0/O, 1/I) left out so codes are easy to read aloud.
const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

// Player ids must be unique across every room in the deployment, not just
// within one room: `playerRooms` is keyed by playerId alone. `Room`'s
// built-in id generator only counts within a single instance, so every
// place a Room is created or hydrated here supplies this instead.
const makeId = (isBot: boolean): string => `${isBot ? "b" : "p"}_${crypto.randomUUID()}`;

/**
 * Rebuilds a live Room. Pass the room's `grids` document to get a room you can
 * drive (tick, join, leave). Pass null for a snapshot-only room: scores come
 * from the persisted per-player `cells`, and the layers are only needed by a
 * snapshot while the patch log is empty, which callers check first.
 */
export function hydrate(doc: Doc<"rooms">, grid: Doc<"grids"> | null): Room {
  const state: RoomState = {
    code: doc.code,
    tick: doc.tick,
    gridVersion: doc.gridVersion,
    lastStepAt: doc.lastStepAt,
    nextId: doc.nextId,
    nextBotName: doc.nextBotName,
    owner: grid ? new Uint8Array(grid.owner) : undefined,
    trail: grid ? new Uint8Array(grid.trail) : undefined,
    gridLog: doc.gridLog.map((p) => ({ ...p, cells: new Uint8Array(p.cells) })),
    players: doc.players as PlayerState[],
  };
  return Room.hydrate(state, Math.random, makeId);
}

/** The patch log as it is stored: `cells` is Convex bytes, not a Uint8Array. */
type WireGridPatch = { from: number; version: number; cells: ArrayBuffer };

type RoomFields = {
  tick: number;
  gridVersion: number;
  lastStepAt: number | null;
  nextId: number;
  nextBotName: number;
  gridLog: WireGridPatch[];
  players: PlayerState[];
};

type GridFields = {
  gridVersion: number;
  owner: ArrayBuffer;
  trail: ArrayBuffer;
};

function roomFields(room: Room): RoomFields {
  const state = room.serialize();
  return {
    tick: state.tick,
    gridVersion: state.gridVersion,
    lastStepAt: state.lastStepAt,
    nextId: state.nextId,
    nextBotName: state.nextBotName,
    gridLog: toWireLog(state.gridLog),
    players: state.players,
  };
}

function gridFields(room: Room): GridFields {
  const state = room.serialize();
  return {
    gridVersion: state.gridVersion,
    owner: toArrayBuffer(state.owner!),
    trail: toArrayBuffer(state.trail!),
  };
}

/**
 * Writes a driven Room back: the room row every time, the grid row only when
 * the grid changed since it was loaded. `extra` merges into the room row.
 */
export async function persist(
  ctx: MutationCtx,
  doc: Doc<"rooms">,
  grid: Doc<"grids">,
  room: Room,
  extra: { emptySince?: number | undefined } = {},
): Promise<void> {
  await ctx.db.patch(doc._id, { ...extra, ...roomFields(room) });
  if (room.gridVersion !== doc.gridVersion) await ctx.db.patch(grid._id, gridFields(room));
}

function toWireLog(log: RoomState["gridLog"]): WireGridPatch[] {
  return log.map((p) => ({ from: p.from, version: p.version, cells: toArrayBuffer(p.cells) }));
}

export function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

export async function byCode(ctx: QueryCtx, code: string): Promise<Doc<"rooms"> | null> {
  return await ctx.db
    .query("rooms")
    .withIndex("by_code", (q) => q.eq("code", code))
    .first();
}

export async function gridByCode(ctx: QueryCtx, code: string): Promise<Doc<"grids"> | null> {
  return await ctx.db
    .query("grids")
    .withIndex("by_code", (q) => q.eq("code", code))
    .first();
}

async function uniqueCode(ctx: MutationCtx): Promise<string> {
  for (;;) {
    let code = "";
    for (let i = 0; i < 4; i++) code += CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)];
    if (!(await byCode(ctx, code))) return code;
  }
}

function cleanName(name: string): string {
  return name.trim().slice(0, MAX_NAME_LENGTH) || "player";
}

async function insertRoom(ctx: MutationCtx, code: string, room: Room): Promise<void> {
  await ctx.db.insert("rooms", { code, ...roomFields(room) });
  await ctx.db.insert("grids", { code, ...gridFields(room) });
  await ctx.scheduler.runAfter(TICK_MS, internal.tick.tick, { code });
}

export async function createPublicArena(ctx: MutationCtx): Promise<Doc<"rooms">> {
  const room = new Room(DEFAULT_ROOM_CODE, Math.random, makeId);
  room.ensureBots(Date.now());
  await insertRoom(ctx, DEFAULT_ROOM_CODE, room);
  return (await byCode(ctx, DEFAULT_ROOM_CODE))!;
}

export const create = mutation({
  args: { name: v.string(), skin: v.optional(v.string()) },
  handler: async (ctx, { name, skin }) => {
    const code = await uniqueCode(ctx);
    const room = new Room(code, Math.random, makeId);
    room.ensureBots(Date.now());
    const player = room.addPlayer(cleanName(name), false, Date.now(), skin);

    await insertRoom(ctx, code, room);
    await ctx.db.insert("playerRooms", { playerId: player.id, code });
    return { code, playerId: player.id };
  },
});

export const join = mutation({
  args: { code: v.union(v.string(), v.null()), name: v.string(), skin: v.optional(v.string()) },
  handler: async (ctx, { code, name, skin }) => {
    const targetCode = code?.trim().toUpperCase() || DEFAULT_ROOM_CODE;
    let doc = await byCode(ctx, targetCode);
    if (!doc && targetCode === DEFAULT_ROOM_CODE) doc = await createPublicArena(ctx);
    if (!doc) throw new ConvexError(`No room with code ${targetCode}`);
    const grid = await gridByCode(ctx, doc.code);
    if (!grid) throw new ConvexError(`Room ${targetCode} has no grid`);

    const room = hydrate(doc, grid);
    let player;
    try {
      player = room.addPlayer(cleanName(name), false, Date.now(), skin);
    } catch (error) {
      if (error instanceof RoomFullError) throw new ConvexError("That room is full.");
      throw error;
    }

    await persist(ctx, doc, grid, room, { emptySince: undefined });
    await ctx.db.insert("playerRooms", { playerId: player.id, code: doc.code });
    return { code: doc.code, playerId: player.id };
  },
});

export const leave = mutation({
  args: { playerId: v.string() },
  handler: async (ctx, { playerId }) => {
    const link = await ctx.db
      .query("playerRooms")
      .withIndex("by_player", (q) => q.eq("playerId", playerId))
      .first();
    if (!link) return;

    const doc = await byCode(ctx, link.code);
    const grid = doc ? await gridByCode(ctx, doc.code) : null;
    if (doc && grid) {
      const room = hydrate(doc, grid);
      room.removePlayer(playerId);
      const emptySince = room.humanCount === 0 ? Date.now() : undefined;
      await persist(ctx, doc, grid, room, { emptySince });
    }
    await ctx.db.delete(link._id);
  },
});
