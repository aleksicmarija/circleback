import { ConvexError } from "convex/values";
import { INPUT_MIN_INTERVAL_MS } from "@backend/constants";
import * as ui from "./ui";
import * as scene from "./scene";
import * as interpolate from "./interpolate";
import { readMovement } from "./input";
import {
  createRoom, joinRoom, startGame, leaveRoom, sendInput, watchRoom,
  saveSession, loadSession, clearSession,
} from "./net";
import type { Session, Snapshot } from "./net";

let session: Session | null = null;
let snapshot: Snapshot | null = null;
let unsubscribe: (() => void) | null = null;

let roomSignature = "";
let lastSentAt = 0;
let lastMoveX = 0;
let lastMoveZ = 0;
let yaw = 0;

function errorMessage(error: unknown): string {
  if (error instanceof ConvexError) return String(error.data);
  if (error instanceof Error) return error.message;
  return "Something went wrong.";
}

function connect(next: Session): void {
  unsubscribe?.();
  interpolate.reset();
  scene.clearPlayers();
  roomSignature = "";

  session = next;
  saveSession(next);

  unsubscribe = watchRoom(next.code, (incoming) => {
    // The room was deleted out from under us.
    if (!incoming) {
      disconnect();
      ui.showMenu("That room is gone.");
      return;
    }

    snapshot = incoming;
    interpolate.record(incoming.players);

    // Rebuild the panel only when the roster or status actually changes,
    // not on every positional tick.
    const signature = `${incoming.status}|${incoming.players.map((p) => p.id + p.name).join(",")}`;
    if (signature !== roomSignature) {
      roomSignature = signature;
      ui.showRoom(incoming, next.playerId);
    }
  });
}

function disconnect(): void {
  unsubscribe?.();
  unsubscribe = null;
  session = null;
  snapshot = null;
  roomSignature = "";
  interpolate.reset();
  scene.clearPlayers();
  clearSession();
}

/** Sends only when the direction changes, so idle players cost nothing. */
function pumpInput(now: number): void {
  if (!session || snapshot?.status !== "playing") return;

  const { moveX, moveZ } = readMovement();
  if (moveX === lastMoveX && moveZ === lastMoveZ) return;
  if (now - lastSentAt < INPUT_MIN_INTERVAL_MS) return;

  lastMoveX = moveX;
  lastMoveZ = moveZ;
  lastSentAt = now;
  // Keep facing the last direction of travel when the player stops.
  if (moveX !== 0 || moveZ !== 0) yaw = Math.atan2(moveX, moveZ);

  void sendInput(session.playerId, moveX, moveZ, yaw).catch(() => {
    /* a dropped input is corrected by the next one */
  });
}

function frame(): void {
  const now = performance.now();
  pumpInput(now);
  scene.syncPlayers(interpolate.sample(now), session?.playerId ?? null);
  scene.render();
  requestAnimationFrame(frame);
}

ui.mount({
  async onCreate(name) {
    try {
      const room = await createRoom(name);
      connect({ code: room.code, roomId: room.roomId, playerId: room.playerId });
    } catch (error) {
      ui.showMenu(errorMessage(error));
    }
  },

  async onJoin(code, name) {
    try {
      const room = await joinRoom(code, name);
      connect({ code: room.code, roomId: room.roomId, playerId: room.playerId });
    } catch (error) {
      ui.showMenu(errorMessage(error));
    }
  },

  async onStart() {
    if (!session) return;
    try {
      await startGame(session.roomId);
    } catch (error) {
      ui.showMenu(errorMessage(error));
    }
  },

  async onLeave() {
    const leaving = session;
    disconnect();
    ui.showMenu();
    if (leaving) await leaveRoom(leaving.playerId).catch(() => {});
  },
});

// Best-effort cleanup so players do not linger after closing the tab.
window.addEventListener("beforeunload", () => {
  if (session) void leaveRoom(session.playerId);
});

const restored = loadSession();
if (restored) {
  connect(restored);
} else {
  ui.showMenu();
}

requestAnimationFrame(frame);
