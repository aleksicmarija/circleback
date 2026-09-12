import type { Snapshot } from "@core";
import { createBackend } from "./backend";
import * as ui from "./ui";
import * as scene from "./scene";
import * as interpolate from "./interpolate";
import { onDirection } from "./input";

const backend = createBackend();

type Session = { code: string; playerId: string };

let session: Session | null = null;
let latest: Snapshot | null = null;
let unsubscribe: (() => void) | null = null;
let hudUpdatedAt = 0;

const HUD_INTERVAL_MS = 200;

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Something went wrong.";
}

function connect(next: Session): void {
  disconnect();
  session = next;
  ui.showHud();

  unsubscribe = backend.watchRoom(next.code, (incoming) => {
    if (!incoming) {
      disconnect();
      ui.showMenu("That room was closed.");
      return;
    }
    if (!incoming.players.some((p) => p.id === next.playerId)) {
      disconnect();
      ui.showMenu("You were disconnected from the room.");
      return;
    }

    latest = incoming;
    if (incoming.owner && incoming.trail) scene.updateBoard(incoming.owner, incoming.trail);
    interpolate.record(incoming.players);

    const now = performance.now();
    if (now - hudUpdatedAt > HUD_INTERVAL_MS) {
      hudUpdatedAt = now;
      ui.updateHud(incoming, next.playerId);
    }
  });
}

function disconnect(): void {
  unsubscribe?.();
  unsubscribe = null;
  session = null;
  latest = null;
  interpolate.reset();
  scene.clearPlayers();
}

onDirection((dir) => {
  if (session) backend.setDirection(session.playerId, dir);
});

function frame(): void {
  const now = performance.now();
  scene.syncPlayers(interpolate.sample(now), session?.playerId ?? null);
  if (session && latest) ui.updateOverlay(latest, session.playerId);
  scene.render();
  requestAnimationFrame(frame);
}

ui.mount({
  async onPlay(name, code) {
    try {
      connect(await backend.joinRoom(code, name));
    } catch (error) {
      ui.showMenu(errorMessage(error));
    }
  },

  async onHost(name) {
    try {
      connect(await backend.createRoom(name));
    } catch (error) {
      ui.showMenu(errorMessage(error));
    }
  },

  onLeave() {
    const leaving = session;
    disconnect();
    ui.showMenu();
    if (leaving) void backend.leaveRoom(leaving.playerId).catch(() => {});
  },
});

// Best-effort cleanup so players do not linger after closing the tab.
// The server's heartbeat timeout catches whatever this misses.
window.addEventListener("pagehide", () => {
  if (session) void backend.leaveRoom(session.playerId);
});

ui.showMenu();
requestAnimationFrame(frame);
