import type { SummonApi, SummonStatus } from "./backend";
import * as audio from "./audio";

/**
 * The "Summon a rival" panel in the game HUD. Paste a link (or a sentence),
 * press Summon, and follow the request live until the bot joins. Shown only
 * when the backend can summon (the Convex one); the in-browser simulation
 * has no web access.
 */

const open = document.getElementById("summon-open") as HTMLButtonElement;
const form = document.getElementById("summon") as HTMLFormElement;
const source = document.getElementById("summon-source") as HTMLInputElement;
const go = document.getElementById("summon-go") as HTMLButtonElement;
const status = document.getElementById("summon-status") as HTMLParagraphElement;
const hint = document.getElementById("summon-hint") as HTMLParagraphElement;

let api: SummonApi | null = null;
let currentCode: (() => string | null) | null = null;
let stopWatching: (() => void) | null = null;
let stopCapabilities: (() => void) | null = null;

export function mount(summon: SummonApi | undefined, code: () => string | null): void {
  if (!summon) return; // feature hidden: the button stays `hidden`
  api = summon;
  currentCode = code;
  open.hidden = false;

  open.onclick = () => {
    audio.play("click");
    form.hidden = !form.hidden;
    if (!form.hidden) source.focus();
  };
  form.onsubmit = (event) => {
    event.preventDefault();
    void submit();
  };
  source.onkeydown = (event) => {
    if (event.key === "Escape") {
      form.hidden = true;
      source.blur();
    }
  };

  stopCapabilities?.();
  stopCapabilities = summon.capabilities((caps) => {
    source.placeholder = caps.links ? "https://… or describe a rival" : "Describe a rival in a few words";
    hint.textContent = caps.links
      ? "A robot with a personality written from that page joins this arena."
      : "Links are off on this deployment (no Firecrawl key); descriptions still work.";
    if (caps.email) hint.textContent += ` You can also email a link to ${caps.email}.`;
  });
}

/** Hides the panel when the player leaves the room. */
export function reset(): void {
  form.hidden = true;
  stopWatching?.();
  stopWatching = null;
  status.hidden = true;
  status.className = "";
  go.disabled = false;
}

async function submit(): Promise<void> {
  const code = currentCode?.();
  if (!api || !code) return;
  const text = source.value.trim();
  if (text.length < 3) return;
  audio.play("click");
  go.disabled = true;
  show("Summoning", "busy");
  try {
    const summonId = await api.request(code, text);
    source.value = "";
    stopWatching?.();
    stopWatching = api.watch(summonId, (row) => {
      if (!row) return;
      render(row);
      if (row.status === "joined" || row.status === "failed") {
        go.disabled = false;
        stopWatching?.();
        stopWatching = null;
        if (row.status === "joined") audio.play("spawn");
      }
    });
  } catch (error) {
    go.disabled = false;
    show(errorText(error), "failed");
  }
}

function render(row: SummonStatus): void {
  switch (row.status) {
    case "queued":
      return show("Queued", "busy");
    case "scraping":
      return show(`Reading ${shorten(row.source)}`, "busy");
    case "thinking":
      return show(`Writing a rival from ${row.detail ? `“${row.detail}”` : shorten(row.source)}`, "busy");
    case "joined":
      return show(`${row.botName} has entered the arena. ${row.detail ?? ""}`.trim(), "joined");
    case "failed":
      return show(row.detail ?? "That did not work.", "failed");
  }
}

function show(text: string, kind: "busy" | "joined" | "failed"): void {
  status.hidden = false;
  status.textContent = text;
  status.className = kind;
}

function shorten(text: string): string {
  const bare = text.replace(/^https?:\/\//i, "").replace(/\/$/, "");
  return bare.length > 40 ? `${bare.slice(0, 39)}…` : bare;
}

function errorText(error: unknown): string {
  // ConvexError carries the player-facing message in `data`.
  const data = (error as { data?: unknown })?.data;
  if (typeof data === "string") return data;
  return error instanceof Error ? error.message : "Something went wrong.";
}
