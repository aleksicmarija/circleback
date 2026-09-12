# Circleback

A multiplayer browser game. Vanilla Three.js client, Convex backend, deployed to Render.

```
circleback/
├── apps/web/                  <- FRONTEND. Three.js, Vite, TypeScript.
│   └── src/
│       ├── main.ts            entry point + render loop
│       ├── scene.ts           Three.js scene graph and camera
│       ├── input.ts           keyboard -> direction vector
│       ├── interpolate.ts     smooths the 10Hz server tick to 60fps
│       ├── net.ts             the ONLY file that talks to Convex
│       └── ui.ts              DOM overlay (menu, room panel)
│
├── packages/backend/convex/   <- BACKEND. Convex functions + schema.
│   ├── schema.ts              tables and indexes
│   ├── rooms.ts               create / join / leave / start
│   ├── game.ts                snapshot query + input mutation
│   ├── tick.ts                server-authoritative game loop
│   └── constants.ts           tuning SHARED by both sides
│
├── render.yaml                Render Blueprint (infrastructure as code)
└── convex.json                points Convex at packages/backend/convex
```

## Who owns what

| Area | Files | Owner |
| --- | --- | --- |
| Game rules, state, physics | `packages/backend/convex/**` | backend |
| Rendering, input, UI | `apps/web/**` | frontend |
| The contract between them | `constants.ts` + the `api.game.snapshot` return type | both — discuss before changing |

The seam is deliberately narrow. The frontend only ever calls the helpers in
`apps/web/src/net.ts`; nothing else imports Convex. The backend never knows
Three.js exists.

## First-time setup

```bash
git clone git@github.com:aleksicmarija/circleback.git
cd circleback
npm install

# Creates your own private Convex dev deployment and writes .env.local.
# Ask Marija for an invite to the Convex team first.
npx convex dev
```

Leave `npx convex dev` running — it watches `packages/backend/convex/` and
pushes changes to *your own* deployment within a second. Your data is yours;
you cannot break anyone else's.

Then, in a second terminal:

```bash
npm run dev:web      # http://localhost:5173
```

Or run both at once with `npm run dev`.

## Everyday commands

| Command | What it does |
| --- | --- |
| `npm run dev` | Convex watcher + Vite dev server together |
| `npm run build` | Production build into `apps/web/dist` |
| `npm run typecheck` | Typechecks the client and the Convex functions |
| `npx convex dashboard` | Opens your deployment's data/logs browser |

To play multiplayer locally, open two browser windows: host in one, join with
the 4-character code in the other.

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

# Design notes

## The tick loop

The game is server-authoritative. Clients send a *direction*, never a position,
so a modified client cannot teleport. `tick.ts` is a Convex mutation that
reschedules itself every `TICK_MS` (100ms), integrates velocities, and writes
positions.

**It costs function calls the whole time it runs**, so it stops itself when:

- the room is deleted, or is no longer `playing`
- a newer loop has taken over (`tickToken` mismatch — prevents double loops)
- every player has left
- nobody has sent input for `IDLE_STOP_MS` (60s)

If you change the tick rate, know what you are buying: 10Hz is ~36,000 function
calls per hour per active room.

## Why the client renders in the past

The server ticks at 10Hz but the browser draws at 60fps. `interpolate.ts` keeps
a short buffer of snapshots and renders `INTERP_DELAY_MS` (200ms) behind the
newest one, blending between the two that bracket that moment. This is what
makes movement look smooth instead of stepping 10 times a second.

Raising `INTERP_DELAY_MS` looks smoother under bad network conditions and feels
laggier. Lowering it feels sharper and stutters sooner.

## Cost control

Writes only happen when something changes: the tick skips players who did not
move, and the client sends input only when the direction changes. An idle room
performs zero database writes, and the loop shuts down a minute later.
