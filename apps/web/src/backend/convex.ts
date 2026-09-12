import { ConvexClient } from "convex/browser";
import { api } from "@backend/_generated/api";
import type { Dir, PlayerId, Snapshot } from "@core";
import type { Backend } from "./types";

/** Convex's wire type for the grid layers is ArrayBuffer; `@core` wants Uint8Array. */
type WireSnapshot = Omit<Snapshot, "owner" | "trail"> & { owner?: ArrayBuffer; trail?: ArrayBuffer };

function toSnapshot(wire: WireSnapshot | null): Snapshot | null {
  if (!wire) return null;
  return {
    ...wire,
    owner: wire.owner ? new Uint8Array(wire.owner) : undefined,
    trail: wire.trail ? new Uint8Array(wire.trail) : undefined,
  };
}

/**
 * Talks to the Convex backend, a thin transport adapter with no game logic:
 * a tick loop scheduled server-side drives the same `@core` `Room` the local
 * backend uses, and `game.snapshot` returns its actual `Snapshot` shape (only
 * the grid layers' wire type differs, converted back here), so nothing else
 * in `apps/web` needs to change to support this backend.
 */
export function createConvexBackend(): Backend {
  const url = import.meta.env.VITE_CONVEX_URL;
  if (!url) throw new Error("VITE_CONVEX_URL is not set. Run `npx convex dev` once to create .env.local.");
  const convex = new ConvexClient(url);

  return {
    createRoom: (name) => convex.mutation(api.rooms.create, { name }),
    joinRoom: (code, name) => convex.mutation(api.rooms.join, { code, name }),
    leaveRoom: async (playerId) => {
      await convex.mutation(api.rooms.leave, { playerId });
    },
    setDirection: (playerId: PlayerId, dir: Dir) => void convex.mutation(api.game.setDirection, { playerId, dir }),
    watchRoom: (code, onSnapshot) =>
      convex.onUpdate(api.game.snapshot, { code }, (snap) => onSnapshot(toSnapshot(snap))),
  };
}
