import type { Dir, PlayerId, Snapshot } from "@core";

export type JoinResult = { code: string; playerId: PlayerId };

/**
 * Everything the game client needs from a backend. This is the seam: the
 * rest of `apps/web` only ever touches this interface, so swapping the
 * in-browser simulation for a real server is a matter of adding another
 * implementation in this folder and selecting it in `index.ts`.
 */
export interface Backend {
  /** Creates a private room and joins it. */
  createRoom(name: string): Promise<JoinResult>;
  /** Joins a room by code, or the public arena when `code` is null. */
  joinRoom(code: string | null, name: string): Promise<JoinResult>;
  leaveRoom(playerId: PlayerId): Promise<void>;
  /** Fire-and-forget; sent on every keypress. */
  setDirection(playerId: PlayerId, dir: Dir): void;
  /**
   * Streams snapshots for a room until the returned function is called.
   * `null` means the room no longer exists.
   */
  watchRoom(code: string, onSnapshot: (snapshot: Snapshot | null) => void): () => void;
}
