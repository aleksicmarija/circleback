# Circleback

A multiplayer territory game in the spirit of Color Galaxy / paper.io. Vanilla
Three.js client. The backend is a pure TypeScript simulation that today runs
**inside the browser** in a Web Worker, and is designed to move to a real
server without touching game logic or the client.

```
circleback/
├── packages/game-core/src/      <- THE GAME. Pure TS: no DOM, no Three, no transport.
│   ├── constants.ts             tuning shared by simulation and renderer
│   ├── types.ts                 Dir, PlayerSnapshot, Snapshot (the client-facing contract)
│   ├── grid.ts                  territory + trail layers, flood-fill capture
│   ├── room.ts                  one arena: movement, trails, kills, respawns
│   └── bots.ts                  bot steering
│
├── packages/local-server/src/   <- THE "SERVER". Also transport-agnostic.
│   ├── protocol.ts              client <-> server messages (the wire format)
│   ├── server.ts                GameServer: rooms, connections, tick loop, heartbeat
│   └── worker.ts                ~20 lines: SharedWorker/Worker entry that feeds ports into GameServer
│
├── apps/web/src/                <- FRONTEND. Three.js, Vite, TypeScript.
│   ├── backend/types.ts         `Backend` interface — the ONLY thing the client depends on
│   ├── backend/local.ts         `Backend` over the worker (postMessage)
│   ├── backend/index.ts         picks the implementation from VITE_BACKEND
│   ├── main.ts                  entry point, session, render loop
│   ├── scene.ts                 Three.js: board texture, avatars, camera
│   ├── input.ts                 keys/swipes -> direction
│   ├── interpolate.ts           smooths the 20Hz tick to 60fps
│   └── ui.ts                    menu, leaderboard, death overlay
│
├── packages/backend/convex/     Convex backend from the first scaffold. Not used by the
│                                client right now; see "Moving to a real server".
└── render.yaml                  Render Blueprint (static site)
```

## The rules

- Everyone moves constantly. WASD / arrows (or a swipe) pick a direction; you
  cannot reverse.
- Leaving your territory draws a trail. Getting back home captures everything
  the loop enclosed, including other people's land.
- Driving over any trail kills its owner. Your own trail included.
- The arena edge bounces you 90 degrees to a random side. Dying wipes your
  territory; you respawn in 2.5s.
- Bots top every room up to `MIN_PLAYERS`. A human joining a full room evicts a bot.

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
                                                                  ticks at 20Hz
```

- **The server is authoritative.** The client sends a direction, never a
  position. Every 50ms the server steps every room and pushes a `Snapshot`
  to subscribers. The grid layers ride along only when they changed.
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
- **`game.ts`** has the `snapshot` query the client subscribes to (Convex's
  bytes type is `ArrayBuffer`; the client adapter converts it back to the
  `Uint8Array` the rest of `apps/web` expects) and `setDirection`.

Nothing in `packages/game-core` or `packages/local-server/src/server.ts`
knows which backend is driving it, and the client stays as it is either way,
because it only ever imports `./backend`.

---

# How deployment works

Two clouds, and **Convex is not deployed to Render**.

```
                    ┌──────────────────────────────┐
   git push         │  Render (static site + CDN)  │
   + Manual Deploy  │  serves apps/web/dist        │
        │           └──────────────┬───────────────┘
        │                          │ 1. browser loads HTML/JS
        v                          v
  ┌───────────┐              ┌──────────┐
  │  GitHub   │              │ browser  │
  └───────────┘              └────┬─────┘
                                  │ 2. WebSocket, straight to Convex
                                  v
                    ┌──────────────────────────────┐
                    │  Convex Cloud                │
                    │  database + functions +      │
                    │  the realtime sync engine    │
                    └──────────────────────────────┘
```

Render serves the bundle once and is then out of the data path entirely. All
gameplay traffic goes browser ↔ Convex over a WebSocket.

## The one command that deploys both halves

`render.yaml` sets the build command to:

```bash
npm ci && npx convex deploy --cmd-url-env-var-name VITE_CONVEX_URL --cmd 'npm run build -w apps/web'
```

`npx convex deploy` does three things, **in this order**:

1. Reads `CONVEX_DEPLOY_KEY` from the environment and resolves the production
   deployment's URL.
2. Runs the `--cmd` with `VITE_CONVEX_URL` injected, so Vite bakes the
   production URL into the bundle.
3. **Then** uploads `packages/backend/convex/` to the Convex production
   deployment and regenerates `_generated`.

> **Why `--cmd-url-env-var-name` is there.**
> Convex picks the env var name by looking for `vite` in the **root**
> `package.json`. In a monorepo Vite lives in `apps/web`, so without help
> Convex falls back to the generic `CONVEX_URL` — which Vite never exposes to
> browser code, because only `VITE_`-prefixed variables reach the bundle. The
> result is a build that succeeds and a page that dies on "VITE_CONVEX_URL is
> not set". Two things prevent that: `vite` is declared in the root
> `package.json` devDependencies so detection works, and the flag pins the name
> so CI cannot guess differently.
>
> **Why `convex/_generated/` is committed to git.**
> Step 2 runs *before* step 3. On a fresh CI checkout the client is built
> before codegen has ever run, so if `_generated/` were gitignored the Render
> build would fail on a missing `@backend/_generated/api` import.
> **Whenever you add, rename, or delete a Convex function, commit the changed
> `_generated/` files along with it.**

## One-time Render setup

1. In the Render dashboard: **New → Blueprint**, and pick `aleksicmarija/circleback`.
   Render reads `render.yaml` and creates the static site with the right build
   command, publish path, and SPA rewrite.
2. It will prompt for **`CONVEX_DEPLOY_KEY`** (declared `sync: false`, so it is
   never stored in git). Get the value from the
   [Convex dashboard](https://dashboard.convex.dev) → your project →
   **Production** deployment → *Settings → General → Generate Production Deploy
   Key*, with the `deployment:deploy` permission enabled.
3. Click deploy.

## Shipping a change

`autoDeploy: false` in `render.yaml`, so pushing to `main` does **not** deploy.
Nothing reaches players until someone chooses to ship:

**Render dashboard → the service → Manual Deploy → Deploy latest commit.**

That protects a live demo from a bad last-minute push. To switch to
deploy-on-push later, set `autoDeploy: true` in `render.yaml`.

## Environments

| | Backend | Frontend | Data |
| --- | --- | --- | --- |
| Local | your own Convex dev deployment | `localhost:5173` | yours alone |
| Production | the Convex prod deployment | the Render site | shared, real |

`npx convex dev` and `npx convex deploy` target different deployments, so local
work can never touch production data.

---
