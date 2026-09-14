import type { Dir, GridState, PlayerId, Snapshot } from "@core";

export type JoinResult = { code: string; playerId: PlayerId };

export type SummonStatus = {
  status: "queued" | "scraping" | "thinking" | "joined" | "failed";
  /** The link or description the rival was summoned from. */
  source: string;
  /** Page title while in flight, the bot's blurb once joined, the reason when failed. */
  detail?: string;
  botName?: string;
};

export type SummonCapabilities = {
  /** Links can be summoned from (the backend can read web pages). */
  links: boolean;
  /** Free-text descriptions can be summoned from. */
  text: boolean;
  /** The arena's inbox address, when mailing it a link works too. */
  email: string | null;
};

/**
 * Summon a rival: a bot built from a web page or a sentence joins the room.
 * Optional on the backend; the in-browser simulation has no web access and
 * the client hides the feature when it is missing.
 */
export interface SummonApi {
  /** Starts a summon and returns its id; follow it with `watch`. */
  request(code: string, source: string): Promise<string>;
  watch(summonId: string, onChange: (status: SummonStatus | null) => void): () => void;
  /** Recent summons in a room, newest first, for the spectator screen. */
  recent(code: string, onChange: (rows: (SummonStatus & { via: "web" | "email" })[]) => void): () => void;
  capabilities(onChange: (caps: SummonCapabilities) => void): () => void;
}

/**
 * Everything the game client needs from a backend. This is the seam: the
 * rest of `apps/web` only ever touches this interface, so swapping the
 * in-browser simulation for a real server is a matter of adding another
 * implementation in this folder and selecting it in `index.ts`.
 */
export interface Backend {
  /** Creates a private room and joins it. `skin` is a PET_SKINS id. */
  createRoom(name: string, skin: string): Promise<JoinResult>;
  /** Joins a room by code, or the public arena when `code` is null. */
  joinRoom(code: string | null, name: string, skin: string): Promise<JoinResult>;
  leaveRoom(playerId: PlayerId): Promise<void>;
  /** Fire-and-forget; sent on every keypress. */
  setDirection(playerId: PlayerId, dir: Dir): void;
  /**
   * Streams snapshots for a room until the returned function is called.
   * `null` means the room no longer exists.
   */
  watchRoom(code: string, onSnapshot: (snapshot: Snapshot | null) => void): () => void;
  /** One-shot full grid, for when the client fell behind the snapshot patch log. */
  fetchGrid(code: string): Promise<GridState | null>;
  /** Present when this backend can summon rivals; see `SummonApi`. */
  summon?: SummonApi;
}
