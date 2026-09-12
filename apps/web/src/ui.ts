import { PLAYER_COLORS, MAX_NAME_LENGTH, PET_SKINS, IDLE_KICK_MS, IDLE_WARN_MS, type Snapshot } from "@core";
import * as audio from "./audio";

export type UiHandlers = {
  onPlay: (name: string, code: string | null, skin: string) => void;
  onHost: (name: string, skin: string) => void;
  onLeave: () => void;
};

const menu = document.getElementById("menu") as HTMLDivElement;
const hud = document.getElementById("hud") as HTMLDivElement;
const roomInfo = document.getElementById("room-info") as HTMLDivElement;
const leaderboard = document.getElementById("leaderboard") as HTMLOListElement;
const score = document.getElementById("score") as HTMLDivElement;
const overlay = document.getElementById("overlay") as HTMLDivElement;
const muteButton = document.getElementById("mute") as HTMLButtonElement;
const touchHint = document.getElementById("touch-hint") as HTMLDivElement;

/** Room code from a scanned QR / shared link (`/?room=ABCD`), if any. */
export function roomFromUrl(): string | null {
  const code = new URLSearchParams(location.search).get("room")?.trim().toUpperCase() ?? "";
  return /^[A-Z0-9]{4}$/.test(code) ? code : null;
}

const NAME_KEY = "circleback.name";
const SKIN_KEY = "circleback.skin";

const PET_LABELS: Record<string, string> = {
  "pet-elephant": "Elephant", "pet-pig": "Pig", "pet-caterpillar": "Caterpillar", "pet-bee": "Bee",
  "pet-koala": "Koala", "pet-crab": "Crab", "pet-panda": "Panda", "pet-tiger": "Tiger",
};

const SKIN_EMOJI: Record<string, string> = {
  "pet-elephant": "🐘", "pet-pig": "🐷", "pet-caterpillar": "🐛", "pet-bee": "🐝",
  "pet-koala": "🐨", "pet-crab": "🦀", "pet-panda": "🐼", "pet-tiger": "🐯",
  "robot-a": "🤖", "robot-b": "🤖",
};

function emoji(p: { skin?: string; isBot: boolean }): string {
  return SKIN_EMOJI[p.skin ?? ""] ?? (p.isBot ? "🤖" : "🐾");
}

let handlers: UiHandlers;
let overlayText = "";

export function mount(next: UiHandlers): void {
  handlers = next;
  (document.getElementById("leave") as HTMLButtonElement).onclick = () => {
    audio.play("click");
    handlers.onLeave();
  };
  muteButton.onclick = () => {
    audio.setMuted(!audio.isMuted());
    renderMute();
  };
  renderMute();
}

function renderMute(): void {
  muteButton.textContent = audio.isMuted() ? "🔇" : "🔊";
  muteButton.title = audio.isMuted() ? "Unmute" : "Mute";
}

function hex(slot: number): string {
  return `#${PLAYER_COLORS[slot % PLAYER_COLORS.length].toString(16).padStart(6, "0")}`;
}

function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}

function savedSkin(): string {
  const saved = localStorage.getItem(SKIN_KEY);
  return saved && (PET_SKINS as readonly string[]).includes(saved) ? saved : PET_SKINS[0];
}

/** Menu is rebuilt only on explicit calls, so typing is never interrupted. */
export function showMenu(error?: string): void {
  hud.hidden = true;
  menu.hidden = false;
  audio.stopMusic();

  let skin = savedSkin();
  const invited = roomFromUrl();

  menu.innerHTML = `
    <div class="panel">
      <h1>Circleback</h1>
      <p class="tagline">Pets vs Bots. Claim turf, cut trails, don't get cut.</p>
      <label>Pick your pet</label>
      <div class="pets">
        ${PET_SKINS.map((id) => `
          <button class="pet${id === skin ? " selected" : ""}" data-skin="${id}" title="${PET_LABELS[id]}">
            <img src="/previews/${id}.png" alt="${PET_LABELS[id]}" width="64" height="64" />
          </button>`).join("")}
      </div>
      <label for="name">Your name</label>
      <input id="name" maxlength="${MAX_NAME_LENGTH}" placeholder="player" autocomplete="off" />
      <button id="play">${invited ? `Join room ${invited}` : "Play"}</button>
      <details>
        <summary>Private rooms</summary>
        <label for="code">Room code</label>
        <input id="code" maxlength="4" placeholder="ABCD" autocomplete="off" style="text-transform:uppercase" />
        <div>
          <button id="join" class="secondary">Join room</button>
          <button id="host" class="secondary">Host new room</button>
        </div>
      </details>
      ${error ? `<p class="error">${escapeHtml(error)}</p>` : ""}
      <p class="hint">WASD / arrows to steer. Swipe on touch. The robots are AI agents.</p>
    </div>
  `;

  const nameField = menu.querySelector("#name") as HTMLInputElement;
  const codeField = menu.querySelector("#code") as HTMLInputElement;
  nameField.value = localStorage.getItem(NAME_KEY) ?? "";
  nameField.focus();

  for (const button of menu.querySelectorAll<HTMLButtonElement>(".pet")) {
    button.onclick = () => {
      skin = button.dataset.skin!;
      localStorage.setItem(SKIN_KEY, skin);
      for (const other of menu.querySelectorAll(".pet")) other.classList.toggle("selected", other === button);
      audio.play("click");
    };
  }

  const currentName = () => {
    const value = nameField.value.trim() || "player";
    localStorage.setItem(NAME_KEY, value);
    return value;
  };

  const play = () => {
    audio.play("click");
    audio.startMusic();
    handlers.onPlay(currentName(), invited, skin);
  };
  (menu.querySelector("#play") as HTMLButtonElement).onclick = play;
  nameField.onkeydown = (event) => {
    if (event.key === "Enter") play();
  };
  (menu.querySelector("#host") as HTMLButtonElement).onclick = () => {
    audio.play("click");
    audio.startMusic();
    handlers.onHost(currentName(), skin);
  };
  (menu.querySelector("#join") as HTMLButtonElement).onclick = () => {
    const code = codeField.value.trim().toUpperCase();
    if (code.length !== 4) {
      showMenu("Enter the 4-character room code.");
      return;
    }
    audio.play("click");
    audio.startMusic();
    handlers.onPlay(currentName(), code, skin);
  };
}

export function showHud(): void {
  menu.hidden = true;
  hud.hidden = false;
  overlayText = "";
  overlay.hidden = true;
  touchHint.hidden = !("ontouchstart" in window);
}

export function hideTouchHint(): void {
  touchHint.hidden = true;
}

/** Leaderboard and score. Called a few times a second, not every tick. */
export function updateHud(snapshot: Snapshot, localPlayerId: string): void {
  const total = snapshot.w * snapshot.h;
  const humans = snapshot.players.filter((p) => !p.isBot).length;
  const bots = snapshot.players.length - humans;
  roomInfo.textContent = `Room ${snapshot.code} · ${humans} ${humans === 1 ? "pet" : "pets"} · ${bots} ${bots === 1 ? "bot" : "bots"}`;

  const ranked = [...snapshot.players].sort((a, b) => b.cells - a.cells);
  leaderboard.innerHTML = ranked
    .slice(0, 5)
    .map((p) => `
      <li class="${p.id === localPlayerId ? "me" : ""}${p.alive ? "" : " dead"}">
        <span class="dot" style="background:${hex(p.slot)}"></span>
        <span class="name">${emoji(p)} ${escapeHtml(p.name)}</span>
        <span class="pct">${((p.cells / total) * 100).toFixed(1)}%</span>
      </li>`)
    .join("");

  const me = snapshot.players.find((p) => p.id === localPlayerId);
  if (me) {
    const rank = ranked.indexOf(me) + 1;
    score.innerHTML = `
      <span class="big">${((me.cells / total) * 100).toFixed(1)}%</span>
      <span>#${rank} · ${me.kills} ${me.kills === 1 ? "kill" : "kills"}</span>`;
  }
}

/** Death notice and idle warning. Called every frame; only touches the DOM when the text changes. */
export function updateOverlay(snapshot: Snapshot, localPlayerId: string): void {
  const me = snapshot.players.find((p) => p.id === localPlayerId);
  let text = "";
  if (me && !me.alive) {
    const reason = me.killedBy ? `Cut off by ${me.killedBy}` : "You crashed";
    text = `${reason}\nRespawning in ${(me.respawnIn / 1000).toFixed(1)}s`;
  } else if (me && me.idleMs > IDLE_KICK_MS - IDLE_WARN_MS) {
    const left = Math.max(0, Math.ceil((IDLE_KICK_MS - me.idleMs) / 1000));
    text = `Still there?\nSteer or you leave the arena in ${left}s`;
  }
  if (text === overlayText) return;
  overlayText = text;
  overlay.hidden = text === "";
  overlay.textContent = text;
}
