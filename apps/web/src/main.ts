import { BOT_SKINS, PET_SKINS, IDLE_KICK_MS, IDLE_WARN_MS, type PlayerSnapshot, type Snapshot } from "@core";
import { createBackend } from "./backend";
import * as ui from "./ui";
import * as scene from "./scene";
import * as audio from "./audio";
import * as interpolate from "./interpolate";
import { GridSync } from "./gridsync";
import { onDirection } from "./input";

const backend = createBackend();

type Session = { code: string; playerId: string };

let session: Session | null = null;
let latest: Snapshot | null = null;
let unsubscribe: (() => void) | null = null;
let grid: GridSync | null = null;
let hudUpdatedAt = 0;

const HUD_INTERVAL_MS = 200;

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Something went wrong.";
}

/**
 * Compares consecutive snapshots to fire sounds and particle bursts. The
 * server does not send events; everything is derived from state changes.
 */
function react(previous: Snapshot | null, next: Snapshot, localPlayerId: string): void {
  if (!previous) return;
  const before = new Map<string, PlayerSnapshot>(previous.players.map((p) => [p.id, p]));

  for (const p of next.players) {
    const b = before.get(p.id);
    if (!b) continue;
    const isMe = p.id === localPlayerId;

    if (p.cells > b.cells + 1 && p.alive) {
      scene.burst(p.x, p.z, p.slot, true);
      if (isMe) audio.play("capture");
    }
    if (b.alive && !p.alive) {
      scene.burst(b.x, b.z, p.slot, false);
      if (isMe) audio.play("death");
    }
    if (!b.alive && p.alive && isMe) audio.play("spawn");
    if (p.kills > b.kills && isMe) audio.play("kill");
  }
}

function connect(next: Session): void {
  disconnect();
  session = next;
  ui.showHud();
  grid = new GridSync(() => backend.fetchGrid(next.code), scene.updateBoard);

  unsubscribe = backend.watchRoom(next.code, (incoming) => {
    if (!incoming) {
      disconnect();
      ui.showMenu("That room was closed.");
      return;
    }
    if (!incoming.players.some((p) => p.id === next.playerId)) {
      const wasIdle = (latest?.players.find((p) => p.id === next.playerId)?.idleMs ?? 0) > IDLE_KICK_MS - IDLE_WARN_MS;
      disconnect();
      ui.showMenu(wasIdle ? "You were removed for inactivity. Jump back in!" : "You were disconnected from the room.");
      return;
    }

    react(latest, incoming, next.playerId);
    latest = incoming;
    grid?.apply(incoming);
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
  grid = null;
  interpolate.reset();
  scene.clearPlayers();
}

onDirection((dir) => {
  ui.hideTouchHint();
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
  async onPlay(name, code, skin) {
    try {
      connect(await backend.joinRoom(code, name, skin));
    } catch (error) {
      ui.showMenu(errorMessage(error));
    }
  },

  async onHost(name, skin) {
    try {
      connect(await backend.createRoom(name, skin));
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

scene.preload([...PET_SKINS, ...BOT_SKINS]);
ui.showMenu();
requestAnimationFrame(frame);
