import { ConvexClient } from "convex/browser";
import { api } from "@backend/_generated/api";
import { WATCH_HEARTBEAT_MS, type Dir, type PlayerId, type Snapshot } from "@core";
import type { Backend } from "./types";

/** Convex's wire type for every byte array is ArrayBuffer; `@core` wants Uint8Array. */
type WireSnapshot = Omit<Snapshot, "owner" | "trail" | "patches"> & {
  owner?: ArrayBuffer;
  trail?: ArrayBuffer;
  patches?: { from: number; version: number; cells: ArrayBuffer }[];
};

function toSnapshot(wire: WireSnapshot | null): Snapshot | null {
  if (!wire) return null;
  return {
    ...wire,
    owner: wire.owner ? new Uint8Array(wire.owner) : undefined,
    trail: wire.trail ? new Uint8Array(wire.trail) : undefined,
    patches: wire.patches?.map((p) => ({ from: p.from, version: p.version, cells: new Uint8Array(p.cells) })),
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
    createRoom: (name, skin) => convex.mutation(api.rooms.create, { name, skin }),
    joinRoom: (code, name, skin) => convex.mutation(api.rooms.join, { code, name, skin }),
    leaveRoom: async (playerId) => {
      await convex.mutation(api.rooms.leave, { playerId });
    },
    setDirection: (playerId: PlayerId, dir: Dir) => void convex.mutation(api.game.setDirection, { playerId, dir }),
    watchRoom: (code, onSnapshot) => {
      // Convex queries cannot tell the server someone is watching, so say so
      // explicitly; the tick keeps bots playing for a room with a heartbeat.
      // Only while the page is actually visible: a hidden tab or a closed lid
      // stops the heartbeat, and the room pauses instead of playing to nobody.
      const beat = () => {
        if (document.visibilityState !== "visible") return;
        void convex.mutation(api.game.watch, { code }).catch(() => {});
      };
      beat();
      const timer = setInterval(beat, WATCH_HEARTBEAT_MS);
      document.addEventListener("visibilitychange", beat);
      const stop = convex.onUpdate(api.game.snapshot, { code }, (snap) => onSnapshot(toSnapshot(snap)));
      return () => {
        clearInterval(timer);
        document.removeEventListener("visibilitychange", beat);
        stop();
      };
    },
    fetchGrid: async (code) => {
      const grid = await convex.query(api.game.grid, { code });
      if (!grid) return null;
      return { gridVersion: grid.gridVersion, owner: new Uint8Array(grid.owner), trail: new Uint8Array(grid.trail) };
    },
  };
}
