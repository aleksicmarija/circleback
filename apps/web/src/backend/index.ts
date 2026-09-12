import type { Backend } from "./types";
import { createLocalBackend } from "./local";

export type { Backend, JoinResult } from "./types";

/** Picks the backend from VITE_BACKEND. Defaults to the in-browser simulation. */
export function createBackend(): Backend {
  const kind = import.meta.env.VITE_BACKEND ?? "local";
  switch (kind) {
    case "local":
      return createLocalBackend();
    case "convex":
      throw new Error(
        "The Convex backend has not been ported to the territory game yet. " +
          "Implement `Backend` in apps/web/src/backend/convex.ts and wire it here.",
      );
    default:
      throw new Error(`Unknown VITE_BACKEND "${String(kind)}"`);
  }
}
