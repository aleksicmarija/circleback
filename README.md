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
npm run dev          # http://localhost:5173 -- that's it, no accounts, no cloud
```

Press **Play** to drop into the public arena. Open `/watch.html` on a big
screen for the spectator view: whole arena, leaderboard, and a QR code that
sends phones to the same room (`/watch.html?room=ABCD` for private rooms). Open a second tab and press Play
again: both tabs share one SharedWorker, so you are playing against yourself.
"Host new room" / "Join room" give you private 4-letter rooms.

| Command | What it does |
| --- | --- |
| `npm run dev` | Vite dev server (the whole game, backend included) |
| `npm run build` | Production build into `apps/web/dist` |
| `npm run typecheck` | Typechecks core, local server, client and the Convex functions |
| `npm run dev:all` | Vite plus the Convex watcher, for when the Convex backend is ported |

Optional `.env.local` settings (see `.env.example`):

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

## Moving to a real server

Nothing in `packages/game-core` or `packages/local-server/src/server.ts`
knows it is in a browser. To host it for real:

1. **Node + WebSockets (smallest change).** Write a ~30-line host that does
   what `worker.ts` does with sockets instead of ports: on connection call
   `server.connect(send)`, on message call `server.handle(connection, msg)`,
   on close call `server.disconnect(connection)`. Serialise with JSON, or
   MessagePack so the `Uint8Array` grid layers stay compact. Then add
   `apps/web/src/backend/ws.ts` implementing `Backend` over a WebSocket (it
   is `local.ts` with `port` swapped for a socket) and select it in
   `backend/index.ts`.
2. **Convex.** Port `Room` into a scheduled mutation the way the original
   scaffold's `tick.ts` did, storing the two grid layers as bytes on the room
   row, and implement `Backend` over `ConvexClient`. Convex functions can
   import `game-core` by relative path. Mind the cost: 20Hz is 72,000
   function calls per room-hour, so you would likely drop the tick rate and
   raise `INTERP_DELAY_MS`.

Either way the client stays as it is, because it only ever imports
`./backend`.

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
npm ci && npx convex deploy --cmd 'npm run build -w apps/web'
```

`npx convex deploy` does three things, **in this order**:

1. Reads `CONVEX_DEPLOY_KEY` from the environment and resolves the production
   deployment's URL.
2. Runs the `--cmd` with `VITE_CONVEX_URL` injected, so Vite bakes the
   production URL into the bundle.
3. **Then** uploads `packages/backend/convex/` to the Convex production
   deployment and regenerates `_generated`.

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
