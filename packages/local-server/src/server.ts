import {
  Room, RoomFullError, DEFAULT_ROOM_CODE, MAX_NAME_LENGTH, ROOM_IDLE_MS, TICK_MS,
  type PlayerId,
} from "@core";
import {
  CLIENT_TIMEOUT_MS,
  type ClientMessage, type JoinResult, type Request, type ServerMessage,
} from "./protocol";

/** One connected client. Whatever transport carries it, this is all the server knows. */
export type Connection = {
  readonly id: number;
  readonly send: (message: ServerMessage) => void;
  lastSeenAt: number;
  /** Rooms this connection receives snapshots for. */
  readonly subscriptions: Set<string>;
  /** Players this connection created; removed when it goes away. */
  readonly players: Map<PlayerId, string>;
};

type RoomEntry = {
  room: Room;
  subscribers: Set<Connection>;
  /** Since when nobody (player or spectator) has been in the room; deleted after ROOM_IDLE_MS. */
  emptySince: number | null;
};

// Ambiguous characters (0/O, 1/I) left out so codes are easy to read aloud.
const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

/**
 * The whole backend, minus transport. Hosts (a Web Worker today, a Node
 * process tomorrow) call `connect` per client, `handle` per message, and
 * `start` once. Everything else is internal.
 */
export class GameServer {
  private readonly rooms = new Map<string, RoomEntry>();
  private readonly connections = new Set<Connection>();
  /** Which connection owns each player, across all rooms. */
  private readonly owners = new Map<PlayerId, Connection>();
  private nextConnectionId = 1;
  private nextPlayerId = 1;
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(private readonly clock: () => number = Date.now) {}

  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => this.tick(), TICK_MS);
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  connect(send: (message: ServerMessage) => void): Connection {
    const connection: Connection = {
      id: this.nextConnectionId++,
      send,
      lastSeenAt: this.clock(),
      subscriptions: new Set(),
      players: new Map(),
    };
    this.connections.add(connection);
    return connection;
  }

  disconnect(connection: Connection): void {
    for (const [playerId, code] of connection.players) this.removePlayer(code, playerId);
    for (const code of connection.subscriptions) this.rooms.get(code)?.subscribers.delete(connection);
    this.connections.delete(connection);
  }

  handle(connection: Connection, message: ClientMessage): void {
    connection.lastSeenAt = this.clock();

    if (message.type === "ping") return;

    if (message.type === "direction") {
      const code = connection.players.get(message.playerId);
      if (code) this.rooms.get(code)?.room.setDirection(message.playerId, message.dir);
      return;
    }

    try {
      const result = this.request(connection, message);
      connection.send({ type: "reply", id: message.id, ok: true, result });
    } catch (error) {
      const text = error instanceof Error ? error.message : String(error);
      connection.send({ type: "reply", id: message.id, ok: false, error: text });
    }
  }

  // ---- requests ----------------------------------------------------------

  private request(connection: Connection, message: Request): unknown {
    switch (message.type) {
      case "create":
        return this.join(connection, this.createRoom().room.code, message.name, message.skin);

      case "join": {
        const code = message.code ? message.code.trim().toUpperCase() : DEFAULT_ROOM_CODE;
        if (code === DEFAULT_ROOM_CODE && !this.rooms.has(code)) this.createRoom(code);
        return this.join(connection, code, message.name, message.skin);
      }

      case "leave": {
        const code = connection.players.get(message.playerId);
        if (code) this.removePlayer(code, message.playerId);
        return null;
      }

      case "subscribe": {
        const code = message.code.toUpperCase();
        // Spectators may open the public arena before anyone has joined it.
        if (code === DEFAULT_ROOM_CODE && !this.rooms.has(code)) this.createRoom(code);
        const entry = this.rooms.get(code);
        if (!entry) throw new Error(`No room with code ${code}`);
        entry.subscribers.add(connection);
        connection.subscriptions.add(code);
        // A fresh subscriber needs the full grid straight away; after that, patches.
        connection.send({ type: "snapshot", code, snapshot: entry.room.snapshot(this.clock(), "full") });
        return null;
      }

      case "grid":
        return this.rooms.get(message.code.toUpperCase())?.room.gridState() ?? null;

      case "unsubscribe": {
        const code = message.code.toUpperCase();
        this.rooms.get(code)?.subscribers.delete(connection);
        connection.subscriptions.delete(code);
        return null;
      }
    }
  }

  private join(connection: Connection, code: string, rawName: string, skin?: string): JoinResult {
    const entry = this.rooms.get(code);
    if (!entry) throw new Error(`No room with code ${code}`);

    const name = rawName.trim().slice(0, MAX_NAME_LENGTH) || "player";
    const now = this.clock();
    try {
      const player = entry.room.addPlayer(name, false, now, skin);
      connection.players.set(player.id, code);
      this.owners.set(player.id, connection);
      return { code, playerId: player.id };
    } catch (error) {
      if (error instanceof RoomFullError) throw new Error("That room is full.");
      throw error;
    }
  }

  private createRoom(code = this.uniqueCode()): RoomEntry {
    const entry: RoomEntry = {
      room: new Room(code, Math.random, (isBot) => `${isBot ? "b" : "p"}${this.nextPlayerId++}`),
      subscribers: new Set(),
      emptySince: this.clock(),
    };
    entry.room.ensureBots(this.clock());
    this.rooms.set(code, entry);
    return entry;
  }

  private removePlayer(code: string, playerId: PlayerId): void {
    const entry = this.rooms.get(code);
    if (!entry) return;
    entry.room.removePlayer(playerId);
    this.owners.get(playerId)?.players.delete(playerId);
    this.owners.delete(playerId);
  }

  private uniqueCode(): string {
    for (;;) {
      let code = "";
      for (let i = 0; i < 4; i++) {
        code += CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)];
      }
      if (!this.rooms.has(code)) return code;
    }
  }

  // ---- the loop ----------------------------------------------------------

  private tick(): void {
    const now = this.clock();
    this.dropSilentConnections(now);

    for (const [code, entry] of this.rooms) {
      // A room with neither players nor spectators pauses, then goes away.
      const audience = entry.room.humanCount > 0 || entry.subscribers.size > 0;
      if (audience) {
        entry.emptySince = null;
      } else {
        entry.emptySince ??= now;
        if (now - entry.emptySince > ROOM_IDLE_MS) this.rooms.delete(code);
        continue;
      }

      entry.room.ensureBots(now);
      entry.room.step(now);

      if (entry.subscribers.size === 0) continue;
      const snapshot = entry.room.snapshot(now, "patches");
      for (const connection of entry.subscribers) {
        connection.send({ type: "snapshot", code, snapshot });
      }
    }
  }

  private dropSilentConnections(now: number): void {
    for (const connection of this.connections) {
      if (now - connection.lastSeenAt > CLIENT_TIMEOUT_MS) this.disconnect(connection);
    }
  }
}
