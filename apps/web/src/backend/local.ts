import type { Dir, PlayerId, Snapshot } from "@core";
import {
  PING_INTERVAL_MS,
  type ClientMessage, type GridResult, type JoinResult, type Request, type ServerMessage,
} from "@server/protocol";
import SimSharedWorker from "@server/worker?sharedworker";
import SimWorker from "@server/worker?worker";
import type { Backend } from "./types";

/**
 * Talks to the in-browser game server. Uses a SharedWorker so every tab on
 * this origin joins the same server (open two tabs to play against
 * yourself), falling back to a dedicated Worker where SharedWorker is
 * unavailable.
 */
export function createLocalBackend(): Backend {
  const port = openPort();
  const latency = Number(import.meta.env.VITE_FAKE_LATENCY_MS ?? 0) || 0;

  /** Optionally delays every message one way, so half the configured round trip. */
  const delay = (fn: () => void) => (latency > 0 ? setTimeout(fn, latency / 2) : fn());

  let nextRequestId = 1;
  const pending = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void }>();
  const watchers = new Map<string, Set<(snapshot: Snapshot | null) => void>>();

  function post(message: ClientMessage): void {
    delay(() => port.postMessage(message));
  }

  function request<T>(message: Request): Promise<T> {
    const id = nextRequestId++;
    return new Promise<T>((resolve, reject) => {
      pending.set(id, { resolve: resolve as (v: unknown) => void, reject });
      post({ id, ...message });
    });
  }

  function dispatch(message: ServerMessage): void {
    if (message.type === "reply") {
      const waiter = pending.get(message.id);
      if (!waiter) return;
      pending.delete(message.id);
      if (message.ok) waiter.resolve(message.result);
      else waiter.reject(new Error(message.error));
      return;
    }

    const callbacks = watchers.get(message.code);
    if (!callbacks) return;
    for (const callback of callbacks) callback(message.snapshot);
    if (message.snapshot === null) watchers.delete(message.code);
  }

  port.onmessage = (event) => delay(() => dispatch(event.data as ServerMessage));
  setInterval(() => post({ type: "ping" }), PING_INTERVAL_MS);

  return {
    createRoom(name, skin) {
      return request<JoinResult>({ type: "create", name, skin });
    },

    joinRoom(code, name, skin) {
      return request<JoinResult>({ type: "join", code, name, skin });
    },

    async leaveRoom(playerId: PlayerId) {
      await request({ type: "leave", playerId });
    },

    setDirection(playerId: PlayerId, dir: Dir) {
      post({ type: "direction", playerId, dir });
    },

    fetchGrid(code) {
      return request<GridResult>({ type: "grid", code: code.toUpperCase() });
    },

    watchRoom(code, onSnapshot) {
      const key = code.toUpperCase();
      let callbacks = watchers.get(key);
      if (!callbacks) {
        callbacks = new Set();
        watchers.set(key, callbacks);
        request({ type: "subscribe", code: key }).catch((error: Error) => onSnapshot(null) ?? error);
      }
      callbacks.add(onSnapshot);

      return () => {
        const current = watchers.get(key);
        if (!current) return;
        current.delete(onSnapshot);
        if (current.size === 0) {
          watchers.delete(key);
          post({ id: nextRequestId++, type: "unsubscribe", code: key });
        }
      };
    },
  };
}

type PortLike = {
  postMessage(message: unknown): void;
  onmessage: ((event: MessageEvent) => void) | null;
};

function openPort(): PortLike {
  if (typeof SharedWorker !== "undefined") {
    const worker = new SimSharedWorker({ name: "circleback-server" });
    worker.port.start();
    return worker.port;
  }
  return new SimWorker({ name: "circleback-server" });
}
