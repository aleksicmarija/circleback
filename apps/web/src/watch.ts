/**
 * Spectator screen: the whole arena from above, the leaderboard, and a QR
 * code that sends phones into the same room. Meant for a projector.
 * Open as /watch.html or /watch.html?room=ABCD.
 */
import QRCode from "qrcode";
import { DEFAULT_ROOM_CODE, PLAYER_COLORS, BOT_SKINS, PET_SKINS, type Snapshot } from "@core";
import { createBackend } from "./backend";
import * as scene from "./scene";
import * as interpolate from "./interpolate";
import { GridSync } from "./gridsync";

const backend = createBackend();

const board = document.getElementById("watch-board") as HTMLOListElement;
const status = document.getElementById("watch-status") as HTMLDivElement;
const roomCode = document.getElementById("room-code") as HTMLDivElement;
const roomStats = document.getElementById("room-stats") as HTMLDivElement;
const joinUrlEl = document.getElementById("join-url") as HTMLAnchorElement;
const qr = document.getElementById("qr") as HTMLCanvasElement;

const SKIN_EMOJI: Record<string, string> = {
  "pet-elephant": "🐘", "pet-pig": "🐷", "pet-caterpillar": "🐛", "pet-bee": "🐝",
  "pet-koala": "🐨", "pet-crab": "🦀", "pet-panda": "🐼", "pet-tiger": "🐯",
  "robot-a": "🤖", "robot-b": "🤖",
};

const requested = new URLSearchParams(location.search).get("room")?.trim().toUpperCase() ?? "";
const code = /^[A-Z0-9]{4}$/.test(requested) ? requested : DEFAULT_ROOM_CODE;

// The public arena is the default on the game page, so its link stays short.
const joinUrl = new URL("/", location.origin);
if (code !== DEFAULT_ROOM_CODE) joinUrl.searchParams.set("room", code);

roomCode.textContent = code;
joinUrlEl.href = joinUrl.toString();
joinUrlEl.textContent = joinUrl.host + joinUrl.pathname + joinUrl.search;
void QRCode.toCanvas(qr, joinUrl.toString(), {
  width: 220,
  margin: 1,
  color: { dark: "#edecec", light: "#14120b" },
});

function hex(slot: number): string {
  return `#${PLAYER_COLORS[slot % PLAYER_COLORS.length].toString(16).padStart(6, "0")}`;
}

function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}

let latest: Snapshot | null = null;
let boardUpdatedAt = 0;
const grid = new GridSync(() => backend.fetchGrid(code), scene.updateBoard);

function updateBoard(snapshot: Snapshot): void {
  const total = snapshot.w * snapshot.h;
  const humans = snapshot.players.filter((p) => !p.isBot).length;
  const bots = snapshot.players.length - humans;
  roomStats.textContent = `${humans} ${humans === 1 ? "pet" : "pets"} · ${bots} ${bots === 1 ? "bot" : "bots"}`;

  const ranked = [...snapshot.players].sort((a, b) => b.cells - a.cells);
  board.innerHTML = ranked
    .map((p, i) => `
      <li class="${p.alive ? "" : "dead"}">
        <span class="rank">${i + 1}</span>
        <span class="dot" style="background:${hex(p.slot)}"></span>
        <span class="name">${SKIN_EMOJI[p.skin ?? ""] ?? (p.isBot ? "🤖" : "🐾")} ${escapeHtml(p.name)}</span>
        <span class="pct">${((p.cells / total) * 100).toFixed(1)}%</span>
      </li>`)
    .join("");
}

function setStatus(text: string | null): void {
  status.hidden = text === null;
  status.textContent = text ?? "";
}

backend.watchRoom(code, (incoming) => {
  if (!incoming) {
    latest = null;
    interpolate.reset();
    scene.clearPlayers();
    setStatus(`Room ${code} is closed. Waiting for players…`);
    return;
  }
  setStatus(null);
  latest = incoming;
  grid.apply(incoming);
  interpolate.record(incoming.players);

  const now = performance.now();
  if (now - boardUpdatedAt > 250) {
    boardUpdatedAt = now;
    updateBoard(incoming);
  }
});

function frame(): void {
  scene.syncPlayers(interpolate.sample(performance.now()), null);
  scene.render();
  requestAnimationFrame(frame);
}

scene.preload([...PET_SKINS, ...BOT_SKINS]);
scene.setOverview();
window.addEventListener("resize", () => scene.setOverview());
setStatus(latest ? null : "Connecting…");
requestAnimationFrame(frame);
