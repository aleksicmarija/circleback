import { PLAYER_COLORS, MAX_PLAYERS } from "@backend/constants";
import type { Snapshot } from "./net";

export type UiHandlers = {
  onCreate: (name: string) => void;
  onJoin: (code: string, name: string) => void;
  onStart: () => void;
  onLeave: () => void;
};

const hud = document.getElementById("hud") as HTMLDivElement;
const NAME_KEY = "circleback.name";

let handlers: UiHandlers;

export function mount(next: UiHandlers): void {
  handlers = next;
}

function hex(colorIndex: number): string {
  const color = PLAYER_COLORS[colorIndex % PLAYER_COLORS.length];
  return `#${color.toString(16).padStart(6, "0")}`;
}

function panel(): HTMLDivElement {
  hud.replaceChildren();
  const element = document.createElement("div");
  element.className = "panel";
  hud.append(element);
  return element;
}

/** Menu is rebuilt only on explicit calls, so typing is never interrupted. */
export function showMenu(error?: string): void {
  const root = panel();
  root.innerHTML = `
    <h1>Circleback</h1>
    <label for="name">Your name</label>
    <input id="name" maxlength="16" placeholder="player" />
    <label for="code">Room code (leave blank to host)</label>
    <input id="code" maxlength="4" placeholder="ABCD" style="text-transform:uppercase" />
    <div>
      <button id="host">Host a room</button>
      <button id="join" class="secondary">Join</button>
    </div>
    ${error ? `<p class="error">${error}</p>` : ""}
  `;

  const nameField = root.querySelector("#name") as HTMLInputElement;
  const codeField = root.querySelector("#code") as HTMLInputElement;
  nameField.value = localStorage.getItem(NAME_KEY) ?? "";

  const currentName = () => {
    const value = nameField.value.trim() || "player";
    localStorage.setItem(NAME_KEY, value);
    return value;
  };

  (root.querySelector("#host") as HTMLButtonElement).onclick = () =>
    handlers.onCreate(currentName());

  (root.querySelector("#join") as HTMLButtonElement).onclick = () => {
    const code = codeField.value.trim().toUpperCase();
    if (code.length !== 4) {
      showMenu("Enter the 4-character room code.");
      return;
    }
    handlers.onJoin(code, currentName());
  };
}

export function showRoom(snapshot: Snapshot, localPlayerId: string): void {
  const root = panel();
  const waiting = snapshot.status === "lobby";
  const ended = snapshot.status === "ended";

  root.innerHTML = `
    <h1>Room</h1>
    <div class="code">${snapshot.code}</div>
    <ul class="players">
      ${snapshot.players
        .map(
          (player) => `
        <li>
          <span class="dot" style="background:${hex(player.colorIndex)}"></span>
          ${player.name}${player.id === localPlayerId ? " (you)" : ""}
        </li>`,
        )
        .join("")}
    </ul>
    <div>
      ${waiting ? `<button id="start">Start game</button>` : ""}
      ${ended ? `<button id="start">Play again</button>` : ""}
      <button id="leave" class="secondary">Leave</button>
    </div>
    <p class="hint">
      ${
        waiting
          ? `Share the code. Up to ${MAX_PLAYERS} players.`
          : ended
            ? "Round ended after a spell with no input."
            : "Move with WASD or the arrow keys."
      }
    </p>
  `;

  const start = root.querySelector("#start") as HTMLButtonElement | null;
  if (start) start.onclick = () => handlers.onStart();
  (root.querySelector("#leave") as HTMLButtonElement).onclick = () => handlers.onLeave();
}
