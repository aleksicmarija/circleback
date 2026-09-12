import { ConvexClient } from "convex/browser";
import type { FunctionReturnType } from "convex/server";
import { api } from "@backend/_generated/api";
import type { Id } from "@backend/_generated/dataModel";

const url = import.meta.env.VITE_CONVEX_URL;
if (!url) {
  throw new Error(
    "VITE_CONVEX_URL is not set. Run `npx convex dev` once from the repo root to create .env.local.",
  );
}

export const convex = new ConvexClient(url);

/** Derived from the query itself, so client types cannot drift from the backend. */
export type Snapshot = NonNullable<FunctionReturnType<typeof api.game.snapshot>>;
export type PlayerView = Snapshot["players"][number];

export type Session = {
  code: string;
  roomId: Id<"rooms">;
  playerId: Id<"players">;
};

const SESSION_KEY = "circleback.session";

export function saveSession(session: Session): void {
  sessionStorage.setItem(SESSION_KEY, JSON.stringify(session));
}

export function loadSession(): Session | null {
  try {
    const raw = sessionStorage.getItem(SESSION_KEY);
    return raw ? (JSON.parse(raw) as Session) : null;
  } catch {
    return null;
  }
}

export function clearSession(): void {
  sessionStorage.removeItem(SESSION_KEY);
}

export function createRoom(name: string) {
  return convex.mutation(api.rooms.create, { name });
}

export function joinRoom(code: string, name: string) {
  return convex.mutation(api.rooms.join, { code, name });
}

export function startGame(roomId: Id<"rooms">) {
  return convex.mutation(api.rooms.start, { roomId });
}

export function leaveRoom(playerId: Id<"players">) {
  return convex.mutation(api.rooms.leave, { playerId });
}

export function sendInput(
  playerId: Id<"players">,
  moveX: number,
  moveZ: number,
  yaw: number,
) {
  return convex.mutation(api.game.input, { playerId, moveX, moveZ, yaw });
}

/** Opens the live subscription. Returns an unsubscribe function. */
export function watchRoom(code: string, onChange: (snap: Snapshot | null) => void) {
  return convex.onUpdate(api.game.snapshot, { code }, onChange);
}
