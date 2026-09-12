import type { Dir, PlayerId, Snapshot } from "@core";

/**
 * The wire protocol between a client and the game server.
 *
 * Today it travels over postMessage to a Web Worker. Moving to a real server
 * means sending these same objects over a WebSocket; nothing else changes.
 */

export type JoinResult = { code: string; playerId: PlayerId };

/** Requests get a numbered reply. */
export type Request =
  | { type: "create"; name: string }
  | { type: "join"; code: string | null; name: string }
  | { type: "leave"; playerId: PlayerId }
  | { type: "subscribe"; code: string }
  | { type: "unsubscribe"; code: string };

export type ClientMessage =
  | ({ id: number } & Request)
  /** Fire-and-forget: sent on every keypress, no reply. */
  | { type: "direction"; playerId: PlayerId; dir: Dir }
  /** Keeps the connection alive; a silent client is dropped and its players removed. */
  | { type: "ping" };

export type ServerMessage =
  | { type: "reply"; id: number; ok: true; result: unknown }
  | { type: "reply"; id: number; ok: false; error: string }
  /** Pushed every tick to subscribers. `null` means the room was closed. */
  | { type: "snapshot"; code: string; snapshot: Snapshot | null };

/** How often a client must ping, and how long the server waits before giving up on it. */
export const PING_INTERVAL_MS = 2000;
export const CLIENT_TIMEOUT_MS = 8000;
