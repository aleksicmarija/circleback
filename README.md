# Circleback · Pets vs Bots

**A real-time multiplayer turf war you can join from your phone in five seconds.
Cute pets claim territory. Robots are AI agents trying to take it back.**

Built in one day at the [Grok Bot Serbia Hackathon](https://hackathon.cursorserbia.com/),
Belgrade, 12 September 2026.

<!-- TODO: replace the two placeholder URLs below with the live Render URLs before submitting -->

- 🎮 **Play:** https://circleback-web.onrender.com/ <sub>(placeholder)</sub>
- 📺 **Watch the live match:** https://circleback-web.onrender.com/watch.html <sub>(placeholder)</sub>
- 🎥 **Demo video:** link coming with the submission
- 💻 **Source:** https://github.com/aleksicmarija/circleback

Put the **Watch** page on a big screen. It shows the whole arena, the live
leaderboard, and a QR code. Anyone who scans it lands in the same match.

---

## The game in 30 seconds

Circleback is a territory game built from scratch in Three.js.

- Pick a pet, press **Play**. You are dropped into the public arena with a
  small blob of turf. You never stop moving; WASD, arrows, or a swipe pick a
  direction.
- Leave your turf and you draw a trail. Get back home and everything your loop
  enclosed becomes yours, including other players' land.
- Anyone who drives over a trail kills its owner. That includes your own
  trail, so don't cross yourself.
- The arena edge bounces you 90 degrees to a random side. Death wipes your
  turf; you respawn somewhere fresh 2.5 seconds later.
- The **robots are AI agents**. Every room is topped up with them so it never
  feels empty, and a human joining a full room evicts one. The line under a
  robot's name tells you what it is doing right now.
- Scores are territory percentage. There is no end; the leaderboard is the game.

Works on desktop and phones. Private rooms with 4-letter codes exist for
playing with friends.

## How it is built

**One game core, two servers.** The entire rule set (movement, trails,
flood-fill capture, kills, respawns, bot steering) lives in one pure
TypeScript package with no DOM, no rendering, and no network code. Two
different hosts drive that same code unchanged:

- an **in-browser server** running in a SharedWorker, which is how we
  prototyped all day with zero infrastructure (two tabs in one browser play
  against each other), and
- the **Convex backend**, where a scheduled mutation ticks every room 10 times
  a second, persisting the room state between invocations.

The client does not know or care which one it is talking to. It only speaks
to a five-method `Backend` interface, and swapping hosts is an environment
variable.

**The bots are designed to be replaced by real agents.** They already expose
a `status` line the client renders above their heads, and the core has a
`setStatus` hook so an external brain can narrate what a bot is doing. The
message protocol between client and server is transport-agnostic, so any
agent that can open a WebSocket could join a match as a player. That is the
direction we want to take this (see the roadmap below).

## How we used the partner stack

| Partner | What it does for Circleback |
| --- | --- |
| **Grok Bot / Cursor** | The whole codebase was written in the host editor with agents during the hackathon. The commit history is the audit trail. |
| **Convex** | Production backend. Rooms are Convex documents, a self-rescheduling internal mutation is the authoritative 10 Hz game loop, and one live query per room streams snapshots to every client over Convex's WebSocket. No sockets, no Postgres, no server process of our own. |
| **Render** | Hosts the static Three.js client from a Blueprint (`render.yaml`). The build command deploys the Convex functions and bakes the production Convex URL into the bundle in one step. |
| **Kenney (CC0)** | 3D pets and robots, sounds, music, and the display font. Not a hackathon partner, but worth crediting: every asset is handmade by [Kenney](https://kenney.nl) and released as public domain. **No art in this project was AI-generated.** |

## Roadmap

Things we designed for but did not finish in the day, roughly in the order
we'd tackle them.

**Agents**
- [ ] Grok-driven bots via the **xAI API**: the LLM picks a strategy every few
  seconds (raid, defend, hunt the leader) and the heuristic executes it cell
  by cell. Trash talk goes into the existing `status` line.
- [ ] "Describe your bot": a player types a personality in plain language and
  Grok compiles it into a strategy config.
- [ ] Bring-your-own-agent: publish the wire protocol so external agents can
  join a match over a WebSocket and compete against humans and each other.
- [ ] Run agent brains as **Mozaik** participants on its event bus, so agents
  react to each other instead of polling.
- [ ] Run untrusted player-written agents in **Daytona** sandboxes.

**Game**
- [ ] Kill feed and "you were cut off by" attribution in the spectator view.
- [ ] Power-ups: speed boost, shield, trail eraser.
- [ ] Round timer with a winner screen, for demo-friendly matches.
- [ ] Persistent leaderboard across matches (one Convex table).
- [ ] On-screen D-pad as an alternative to swipes on phones.

**Presentation**
- [ ] Generate a unique pet skin per player with **Fal.ai** from a prompt.
- [ ] Rebuild the menu and HUD in **Wonder** so design edits ship as code.
- [ ] Pretty `/watch` route on Render (today the page lives at `/watch.html`).

---

# For developers

Repository layout:

```
circleback/
├── packages/game-core/      THE GAME. Pure TypeScript rules: grid, trails, capture,
│                            kills, respawns, bot steering. No DOM, no Three, no network.
├── packages/local-server/   In-browser server: GameServer (rooms, connections, 10Hz
│                            loop, heartbeat) plus a 20-line SharedWorker entry.
├── packages/backend/convex/ Production server: Convex functions that hydrate a Room
│                            from a document, tick it, and stream snapshots.
├── apps/web/                Three.js client. Talks only to the `Backend` interface in
│                            src/backend/, with local and Convex implementations.
│   └── watch.html           Spectator page: whole arena, leaderboard, QR code.
└── render.yaml              Render Blueprint for the static site.
```

## Running it

```bash
npm install
npm run dev:web      # http://localhost:5173 -- that's it, no accounts, no cloud
```

Press **Play** to drop into the public arena. Open `/watch.html` on a big
screen for the spectator view: whole arena, leaderboard, and a QR code that
sends phones to the same room (`/watch.html?room=ABCD` for private rooms). Open a second tab and press Play
again: both tabs share one SharedWorker, so you are playing against yourself.
"Host new room" / "Join room" give you private 4-letter rooms.

| Command | What it does |
| --- | --- |
| `npm run dev:web` | Vite dev server only, running the whole game (backend included) in a Web Worker -- the zero-setup path, no Convex account needed |
| `npm run dev` | Convex watcher plus Vite together, for full-stack work against the Convex backend |
| `npm run build` | Production build into `apps/web/dist` |
| `npm run typecheck` | Typechecks core, local server, client and the Convex functions |

Optional `.env.local` settings (see `.env.example`):

- `VITE_BACKEND=convex` switches the client from the in-browser simulation to
  the Convex backend (default is `local`). Used together with `npm run dev`.
- `VITE_FAKE_LATENCY_MS=120` adds simulated round-trip latency to the local
  backend. Use it to check that interpolation and input feel hold up.

## How the pieces fit

```
   keys / swipe                 Backend interface                 GameServer
 ┌────────────┐  setDirection  ┌──────────────┐  postMessage   ┌──────────────┐
 │  main.ts   │ ─────────────▶ │ backend/     │ ─────────────▶ │ worker.ts    │
 │  scene.ts  │ ◀───────────── │   local.ts   │ ◀───────────── │ server.ts    │
 └────────────┘   snapshots    └──────────────┘   snapshots    │   Room x N   │
   60 fps, interpolated                                        │  (game-core) │
                                                               └──────────────┘
                                                                  ticks at 10Hz
```

- **The server is authoritative.** The client sends a direction, never a
  position. Every 100ms the server steps every room and pushes a `Snapshot`
  to subscribers. Snapshots carry a short log of changed cells, a few
  hundred bytes, instead of the 8 KB grid; a client that falls behind the
  log fetches the full grid once.
- **The client renders 100ms in the past** (`INTERP_DELAY_MS`) so it always
  has two snapshots to blend between. Respawns are detected as jumps and not
  interpolated.
- **Connections have a heartbeat.** A tab that vanishes without saying
  goodbye is dropped after 8s and its player removed. Rooms with no humans
  stop simulating and are deleted after 30s.
- **Ownership is enforced server-side.** A connection can only steer or
  remove players it created.

## The Convex backend

`packages/backend/convex/` is a second, production `Backend` implementation
that behaves identically to the local one. Since a Convex mutation is a fresh
invocation every time (nothing survives between calls except the database),
its `tick.ts` reloads the room's persisted state, drives a real `Room`
instance from `@game/core` exactly like `GameServer` does, and persists what
changed -- see `Room.serialize()` / `Room.hydrate()` in `game-core/src/room.ts`.

- **Schema** (`schema.ts`): one `rooms` row holds the entire room state as
  flat top-level fields (not nested), so a tick that didn't touch the grid
  can omit the `owner`/`trail` bytes from its patch. `playerRooms` mirrors
  `GameServer`'s in-memory `playerId -> connection` map, since `leaveRoom`/
  `setDirection` only take a player id.
- **`rooms.ts`** has `create` / `join` / `leave`, mirroring `GameServer`'s
  methods of the same shape.
- **`tick.ts`** is the scheduled loop: it reschedules itself every `TICK_MS`
  and stops for good once a room's document is deleted (idle rooms are
  deleted after `ROOM_IDLE_MS`).
- **`game.ts`** has the `snapshot` query the client subscribes to (players
  plus the grid change log, never the byte layers), the one-shot `grid` query
  a client calls when it falls behind that log, and `setDirection`, which only
  inserts into the `inputs` table so a keypress never contends with the tick's
  write of the room document. The tick drains `inputs` before it steps.

Nothing in `packages/game-core` or `packages/local-server/src/server.ts`
knows which backend is driving it, and the client stays as it is either way,
because it only ever imports `./backend`.

## Deploying

Render serves the static client; Convex hosts the backend itself. The build
command does both halves in one step. Setup, deploy keys, and the shipping
checklist live in [docs/DEPLOYING.md](docs/DEPLOYING.md).
