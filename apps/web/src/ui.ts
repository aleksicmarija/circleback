import { PLAYER_COLORS, MAX_NAME_LENGTH, type Snapshot } from "@core";

export type UiHandlers = {
  onPlay: (name: string, code: string | null) => void;
  onHost: (name: string) => void;
  onLeave: () => void;
};

const menu = document.getElementById("menu") as HTMLDivElement;
const hud = document.getElementById("hud") as HTMLDivElement;
const roomInfo = document.getElementById("room-info") as HTMLDivElement;
const leaderboard = document.getElementById("leaderboard") as HTMLOListElement;
const score = document.getElementById("score") as HTMLDivElement;
const overlay = document.getElementById("overlay") as HTMLDivElement;

const NAME_KEY = "circleback.name";

let handlers: UiHandlers;
let overlayText = "";

export function mount(next: UiHandlers): void {
  handlers = next;
  (document.getElementById("leave") as HTMLButtonElement).onclick = () => handlers.onLeave();
}

function hex(slot: number): string {
  return `#${PLAYER_COLORS[slot % PLAYER_COLORS.length].toString(16).padStart(6, "0")}`;
}

function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}

/** Menu is rebuilt only on explicit calls, so typing is never interrupted. */
export function showMenu(error?: string): void {
  hud.hidden = true;
  menu.hidden = false;
  menu.innerHTML = `
    <div class="panel">
      <h1>Circleback</h1>
      <p class="tagline">Claim territory. Cut trails. Don't get cut.</p>
      <label for="name">Your name</label>
      <input id="name" maxlength="${MAX_NAME_LENGTH}" placeholder="player" autocomplete="off" />
      <button id="play">Play</button>
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
      <p class="hint">WASD / arrows to steer. Swipe on touch.</p>
    </div>
  `;

  const nameField = menu.querySelector("#name") as HTMLInputElement;
  const codeField = menu.querySelector("#code") as HTMLInputElement;
  nameField.value = localStorage.getItem(NAME_KEY) ?? "";
  nameField.focus();

  const currentName = () => {
    const value = nameField.value.trim() || "player";
    localStorage.setItem(NAME_KEY, value);
    return value;
  };

  (menu.querySelector("#play") as HTMLButtonElement).onclick = () => handlers.onPlay(currentName(), null);
  nameField.onkeydown = (event) => {
    if (event.key === "Enter") handlers.onPlay(currentName(), null);
  };
  (menu.querySelector("#host") as HTMLButtonElement).onclick = () => handlers.onHost(currentName());
  (menu.querySelector("#join") as HTMLButtonElement).onclick = () => {
    const code = codeField.value.trim().toUpperCase();
    if (code.length !== 4) {
      showMenu("Enter the 4-character room code.");
      return;
    }
    handlers.onPlay(currentName(), code);
  };
}

export function showHud(): void {
  menu.hidden = true;
  hud.hidden = false;
  overlayText = "";
  overlay.hidden = true;
}

/** Leaderboard and score. Called a few times a second, not every tick. */
export function updateHud(snapshot: Snapshot, localPlayerId: string): void {
  const total = snapshot.w * snapshot.h;
  const humans = snapshot.players.filter((p) => !p.isBot).length;
  roomInfo.textContent = `Room ${snapshot.code} · ${humans} ${humans === 1 ? "human" : "humans"}`;

  const ranked = [...snapshot.players].sort((a, b) => b.cells - a.cells);
  leaderboard.innerHTML = ranked
    .slice(0, 5)
    .map((p) => `
      <li class="${p.id === localPlayerId ? "me" : ""}${p.alive ? "" : " dead"}">
        <span class="dot" style="background:${hex(p.slot)}"></span>
        <span class="name">${escapeHtml(p.name)}</span>
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

/** Death notice. Called every frame; only touches the DOM when the text changes. */
export function updateOverlay(snapshot: Snapshot, localPlayerId: string): void {
  const me = snapshot.players.find((p) => p.id === localPlayerId);
  let text = "";
  if (me && !me.alive) {
    const reason = me.killedBy ? `Cut off by ${me.killedBy}` : "You crashed";
    text = `${reason}\nRespawning in ${(me.respawnIn / 1000).toFixed(1)}s`;
  }
  if (text === overlayText) return;
  overlayText = text;
  overlay.hidden = text === "";
  overlay.textContent = text;
}
