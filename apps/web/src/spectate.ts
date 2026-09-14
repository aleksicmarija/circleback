/**
 * Spectator screen: the whole arena from above, the leaderboard, and a QR
 * code that sends phones into the same room. Meant for a projector.
 * Served at /spectate (forwarded to /spectate.html), or /spectate?room=ABCD for a private room.
 */
import QRCode from "qrcode";
import { DEFAULT_ROOM_CODE, colorForSlot, BOT_SKINS, PET_SKINS, type Snapshot } from "@core";
import { createBackend } from "./backend";
import * as scene from "./scene";
import * as interpolate from "./interpolate";
import { GridSync } from "./gridsync";

const backend = createBackend();

const board = document.getElementById("spectate-board") as HTMLOListElement;
const status = document.getElementById("spectate-status") as HTMLDivElement;
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
  return `#${colorForSlot(slot).toString(16).padStart(6, "0")}`;
}

function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}

let latest: Snapshot | null = null;
let boardUpdatedAt = 0;
/** Board changes wait here until the interpolated pieces catch up (see main.ts). */
let pendingBoard: { at: number; snapshot: Snapshot }[] = [];
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

// How to summon a rival, and who arrived lately. Only when the backend can summon.
if (backend.summon) {
  const card = document.getElementById("summon-card") as HTMLElement;
  const how = document.getElementById("summon-how") as HTMLParagraphElement;
  const mail = document.getElementById("summon-mail") as HTMLParagraphElement;
  const inbox = document.getElementById("summon-inbox") as HTMLSpanElement;
  const feed = document.getElementById("summon-feed") as HTMLOListElement;
  card.hidden = false;

  backend.summon.capabilities((caps) => {
    how.textContent = caps.links
      ? "Paste any link in the game and a robot written from that page joins this arena."
      : "Describe a rival in the game and a robot written from your words joins this arena.";
    mail.hidden = !caps.email;
    inbox.textContent = caps.email ?? "";
  });

  const shorten = (text: string) => {
    const bare = text.replace(/^https?:\/\//i, "").replace(/\/$/, "");
    return bare.length > 34 ? `${bare.slice(0, 33)}…` : bare;
  };
  backend.summon.recent(code, (rows) => {
    feed.innerHTML = rows
      .map((r) => {
        const from = `<span class="from">${r.via === "email" ? "📧" : "🔗"} ${escapeHtml(shorten(r.source))}</span>`;
        if (r.status === "joined") return `<li>🤖 ${escapeHtml(r.botName ?? "A rival")} arrived ${from}</li>`;
        if (r.status === "failed") return `<li class="failed">Could not summon ${from}</li>`;
        return `<li>⏳ Summoning ${from}</li>`;
      })
      .join("");
  });
}

backend.watchRoom(code, (incoming) => {
  if (!incoming) {
    latest = null;
    pendingBoard = [];
    interpolate.reset();
    scene.clearPlayers();
    setStatus(`Room ${code} is closed. Waiting for players…`);
    return;
  }
  setStatus(null);
  latest = incoming;
  interpolate.record(incoming.at, incoming.players);
  pendingBoard.push({ at: incoming.at, snapshot: incoming });

  const now = performance.now();
  if (now - boardUpdatedAt > 250) {
    boardUpdatedAt = now;
    updateBoard(incoming);
  }
});

function frame(): void {
  const now = performance.now();
  const due = interpolate.renderTime(now);
  while (pendingBoard.length > 0 && pendingBoard[0].at <= due) grid.apply(pendingBoard.shift()!.snapshot);
  scene.syncPlayers(interpolate.sample(now), null);
  scene.render();
  requestAnimationFrame(frame);
}

scene.preload([...PET_SKINS, ...BOT_SKINS]);
scene.setOverview();
window.addEventListener("resize", () => scene.setOverview());
setStatus(latest ? null : "Connecting…");
requestAnimationFrame(frame);
