import { ConvexClient } from "convex/browser";
import { api } from "@backend/_generated/api";

// Proves the deployed pipeline end to end:
//   1. this bundle was built with VITE_CONVEX_URL pointing at a deployment,
//   2. the browser opens a WebSocket to it,
//   3. a mutation round-trips,
//   4. the live query pushes the change to every subscribed tab.

const url = import.meta.env.VITE_CONVEX_URL;
if (!url) {
  throw new Error(
    "VITE_CONVEX_URL is not set. Run `npx convex dev` once from the repo root to create .env.local.",
  );
}

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const sender = `tab-${Math.random().toString(36).slice(2, 6)}`;

$("url").textContent = url;
$("log").textContent = `this tab is ${sender}`;

const convex = new ConvexClient(url);

convex.subscribeToConnectionState((state) => {
  const dot = $("ws");
  dot.className = `dot ${state.isWebSocketConnected ? "ok" : state.hasEverConnected ? "bad" : ""}`;
  $("ws-text").textContent = state.isWebSocketConnected
    ? `WebSocket connected (connections so far: ${state.connectionCount})`
    : state.hasEverConnected
      ? "WebSocket disconnected — reconnecting…"
      : "connecting…";
});

convex.onUpdate(api.smoke.latest, {}, ({ pings }) => {
  $("pings").innerHTML = pings
    .map(
      (p) =>
        `<tr><td>${p.sender}${p.sender === sender ? " (me)" : ""}</td>` +
        `<td>${p.at - p.sentAt} ms</td>` +
        `<td>${new Date(p.at).toISOString().slice(11, 23)}</td></tr>`,
    )
    .join("");
});

$("ping").addEventListener("click", async () => {
  const sentAt = Date.now();
  $("ack").textContent = "sending…";
  try {
    const { at } = await convex.mutation(api.smoke.ping, { sender, sentAt });
    $("ack").textContent = `ack in ${Date.now() - sentAt} ms (server clock ${new Date(at).toISOString().slice(11, 23)})`;
  } catch (err) {
    $("ack").textContent = `mutation failed: ${(err as Error).message}`;
  }
});
