import { GameServer } from "./server";
import type { ClientMessage } from "./protocol";

/**
 * Worker entry point. Works both as a SharedWorker (every tab in the browser
 * shares one server, so tabs can play against each other) and as a plain
 * dedicated Worker (fallback where SharedWorker is unavailable).
 *
 * Deliberately tiny: all it does is turn message ports into connections.
 * A Node host would do the same with WebSockets.
 */

type PortLike = {
  postMessage(message: unknown): void;
  onmessage: ((event: MessageEvent) => void) | null;
};

const server = new GameServer();
server.start();

function attach(port: PortLike): void {
  const connection = server.connect((message) => port.postMessage(message));
  port.onmessage = (event) => server.handle(connection, event.data as ClientMessage);
}

const scope = self as unknown as PortLike & {
  onconnect?: ((event: MessageEvent) => void) | null;
};

if ("onconnect" in scope) {
  scope.onconnect = (event) => attach(event.ports[0] as unknown as PortLike);
} else {
  attach(scope);
}
