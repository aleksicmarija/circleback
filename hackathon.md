# Hackathon log

- **Project:** Circleback · Pets vs Bots
- **Event:** Convex All Gas Hackathon
- **What it does:** Real-time multiplayer turf war where pets claim territory against AI-driven robots, and anyone can summon a new rival from a web link or by email.
- **Live app:** not deployed
- **Repo:** https://github.com/aleksicmarija/circleback
- **Frontend:** Convex static hosting
- **Convex deployment:** not deployed
- **Components:** @convex-dev/static-hosting, @firecrawl/firecrawl-convex, @agentmail/convex
- **Convex features:** schema, tables, indexes, queries, mutations, actions, HTTP actions, scheduled functions, realtime queries, registered components, typed env
- **Auth:** none
- **AI models:** gpt-5-mini (default, overridable with `OPENAI_MODEL`)
- **Started:** 2026-09-12T09:39:22Z
- **Last updated:** 2026-09-14T18:10:06Z

## Log

### 2026-09-12 - 9667678
Scaffolded the monorepo: a pure TypeScript game core, an in-browser SharedWorker server for zero-setup local play, a Three.js client, and the Convex backend folder (`packages/game-core`, `packages/local-server`, `apps/web`, `packages/backend/convex`).

### 2026-09-12 - c3540ff
First playable version of the turf game (constant movement, trails, flood-fill capture, kills, respawns, heuristic bots), then the Convex backend driving the same core: rooms and grids as documents, a self-rescheduling internal mutation as the 10 Hz game loop, and a live snapshot query per room. Convex features: schema, indexes, queries, mutations, scheduled functions (`convex/schema.ts`, `convex/rooms.ts`, `convex/tick.ts`, `convex/game.ts`).

### 2026-09-12 - 6331e53
Pets vs Bots theme with Kenney CC0 models, a spectator page with leaderboard and QR code, mobile swipe input, and the first production deploy config (`apps/web/src/scene.ts`, `apps/web/spectate`).

### 2026-09-12 - 2b8e25e
Latency work on the Convex path: keypresses go to an `inputs` table the tick drains so they never contend with the tick's write; snapshots carry a byte-packed log of changed cells instead of the 8 KB grid; the client interpolates on the server clock and timestamps snapshots by the tick that produced them. Client-side prediction was tried and rolled back as too jittery (`convex/game.ts`, `packages/game-core/src/room.ts`, `apps/web/src/interpolate.ts`).

### 2026-09-12 - 37c796d
Spectators keep a room alive with a heartbeat mutation so bots play for a screen with nobody in the room; the grid moved to its own `grids` table so the live query never reads bytes it does not return; rooms with no audience pause and are deleted after 30 s. Convex features: mutations, indexes (`convex/game.ts`, `convex/tick.ts`, `convex/schema.ts`).

### 2026-09-14 - 66f523a
Moved the site onto Convex static hosting: the `@convex-dev/static-hosting` component serves the built client from the deployment's `.site` URL and `npm run deploy` builds, pushes the backend and publishes the site in one step. The app's HTTP routes moved under `/api`. Dropped the Render blueprint. Convex features: registered component (`convex/convex.config.ts`, `package.json`).

### 2026-09-14 - 24040bd
The robots got a brain: every few seconds per active room an action sends OpenAI a compact view of the board and gets back a strategy (expand, raid, hunt, defend) and a line for every bot, which the core executes cell by cell until the plan expires. Summon a rival: a mutation queues a request, an action has Firecrawl read the page and OpenAI write a persona, and the tick spawns the bot from a `botCommands` queue; the client follows the row through a live query. The arena inbox: AgentMail's webhook lands on a Convex HTTP route, inbound mail is parsed for a link, a description and a room code, becomes a summon, and gets a reply once the bot joins. Nothing but the tick writes a room document. Convex features: actions, HTTP actions, scheduled functions, realtime queries, registered components (Firecrawl, AgentMail), typed env (`convex/brains.ts`, `convex/summon.ts`, `convex/email.ts`, `convex/http.ts`, `convex/tick.ts`, `packages/game-core/src/bots.ts`).

### 2026-09-14 - working tree
Rewrote the README and deploy guide for this event and documented the deployment variables (`README.md`, `docs/DEPLOYING.md`, `.env.example`).
