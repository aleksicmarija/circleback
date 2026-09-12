import type { Backend } from "./types";
import { createLocalBackend } from "./local";
import { createConvexBackend } from "./convex";

export type { Backend, JoinResult } from "./types";

/** Picks the backend from VITE_BACKEND. Defaults to the in-browser simulation. */
export function createBackend(): Backend {
  const kind = import.meta.env.VITE_BACKEND ?? "local";
  switch (kind) {
    case "local":
      return createLocalBackend();
    case "convex":
      return createConvexBackend();
    default:
      throw new Error(`Unknown VITE_BACKEND "${String(kind)}"`);
  }
}
