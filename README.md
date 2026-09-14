# Circleback · Pets vs Bots

**A real-time multiplayer turf war you can join from any device in five seconds.
Cute pets claim territory. The robots are AI agents, and you can summon a new
one from any link on the web, or by sending the arena an email.**

Built for the [Convex All Gas Hackathon](https://luma.com/convex-allgas-hackathon)
(September 2026). The whole thing runs on Convex: the game loop, the live
state, the bots' brains, the web reader, the inbox, and the site itself.

- 🎮 **Play:** https://TODO.convex.site/
- 📺 **Spectator view:** https://TODO.convex.site/spectate
- 🎥 **Demo video:** TODO
- 💻 **Source:** https://github.com/aleksicmarija/circleback

Put the **spectator view** on a big screen. It shows the whole arena, the
live leaderboard, a QR code that drops anyone who scans it into the same
match, and the address you can email a rival to.

---

## The game in 30 seconds

- Pick a pet, press **Play**. You are dropped into the public arena with a
  small blob of turf. You never stop moving; WASD, arrows, or a swipe pick a
  direction.
- Leave your turf and you draw a trail. Get back home and everything your loop
  enclosed becomes yours, including other players' land.
- Anyone who drives over a trail kills its owner. That includes your own.
- The arena edge bounces you. Death wipes your turf; you respawn 2.5 seconds
  later. Stop steering for 45 seconds and you are removed.
- **The robots are AI agents.** The board never has fewer than seven pieces:
  bots fill the seats humans have not taken and hand them back when someone
  leaves. Every few seconds OpenAI looks at the board and gives each bot a
  strategy (expand, raid someone's land, hunt someone's trail, defend) and a
  line to say. The line under a robot's name is what it is doing, or what it
  thinks of you.
- **Summon a rival.** Paste any link into the game (a site, a profile, a
  product, a repo) or describe one in a sentence. Firecrawl reads the page,
  OpenAI writes a robot with a name, a blurb and a voice from it, and it
  joins your arena, trash talk included. Or email the link to the arena's
  inbox and it writes back with a link to watch.
- Scores are territory percentage. There is no end; the leaderboard is the game.

Works on desktop and phones. Private rooms with 4-letter codes exist for
playing with friends; put the code in the email subject to summon a rival
into one.

## How it is built

**One game core, two hosts.** The entire rule set (movement, trails,
flood-fill capture, kills, respawns, bot steering, plan execution) lives in
one pure TypeScript package with no DOM, no rendering and no network code,
covered by tests. An in-browser SharedWorker host drives it for zero-setup
local development; **Convex drives the identical code in production.**

**Convex is the whole backend.**

| Convex feature | What it does here |
| --- | --- |
| Scheduled mutations | A self-rescheduling internal mutation is the authoritative 10 Hz game loop: it loads the room, drives a real `Room` from the core, persists what changed, and reschedules itself. |
| Live queries | One subscription per room streams players plus a byte-packed log of changed cells (a few hundred bytes, not the 8 KB grid) to every player and spectator. The summon panel and the spectator feed are live queries too. |
| Mutations that never contend | Keypresses, the brain's answers and finished rivals all land in queue tables the tick drains. Nothing but the tick writes a room document, so a busy arena never fights its own game loop. |
| Actions | The brain and the summon pipeline are actions: they read a compact view of the board through queries, call OpenAI and Firecrawl, and hand results back through mutations. |
| HTTP actions | AgentMail's webhook is a Convex HTTP route under `/api`. |
| Components | `@firecrawl/firecrawl-convex` reads the web, `@agentmail/convex` runs the inbox, `@convex-dev/static-hosting` serves the site. Typed `env` declares every key the app needs. |
| Static hosting | The Three.js client is served from the same deployment as the backend. One command deploys both halves. |

**The sponsors do real work.**

- **OpenAI** is the bots' hive mind. Every few seconds, per active room, one
  Chat Completions call with a strict JSON schema returns a strategy and an
  optional line for every bot. It also writes every summoned rival's persona.
  The core executes strategies cell by cell, so a slow answer never stalls
  the game; an expired plan hands the bot back to its heuristics.
- **Firecrawl** reads any page a player pastes: main content as markdown,
  cached for an hour, through the Firecrawl Convex component.
- **AgentMail** gives the arena an inbox. Inbound mail arrives over a
  Svix-verified webhook, is parsed for a link, a description and a room
  code, becomes a summon, and gets a reply from a mutation once the robot is
  in, with a link to watch it play.

**Honest rendering.** The server is authoritative and there is no
client-side prediction: an interpolator measures feed jitter and renders just
behind it, so what you see is what the server said.

## Art

Every 3D model, sound and font is handmade by [Kenney](https://kenney.nl) and
released CC0. No art in this project was AI-generated.

## Origins

Circleback started as a one-day build at the Grok Bot Serbia Hackathon in
Belgrade on 12 September 2026 (pets, bots, the Convex game loop, the
spectator screen). The AI brains, summoning, the inbox and Convex hosting
were built for this event; `hackathon.md` is the evidence-based build log.

---

# For developers

Repository layout:

```
circleback/
├── packages/game-core/      THE GAME. Pure TypeScript rules: grid, trails, capture,
│                            kills, respawns, bot steering and plans. No DOM, no Three, no network.
├── packages/local-server/   In-browser server: GameServer (rooms, connections, 10Hz
│                            loop, heartbeat) plus a 20-line SharedWorker entry.
├── packages/backend/convex/ Production server: the tick, the brain, summoning, the inbox,
│                            and the component config.
├── apps/web/                Three.js client. Talks only to the `Backend` interface in
│                            src/backend/, with local and Convex implementations.
│   └── spectate.html        Spectator page: whole arena, leaderboard, QR code, summon feed.
└── docs/DEPLOYING.md        Keys, inbox setup, and the one-command deploy.
```

## Running it

```bash
npm install
npm run dev:web      # http://localhost:5173 -- that's it, no accounts, no cloud
```

Press **Play** to drop into the public arena. Open `/spectate` on a big
screen for the spectator view (`/spectate?room=ABCD` for private rooms).
Open a second tab and press Play again: both tabs share one SharedWorker, so
you are playing against yourself. The in-browser host has no web access, so
summoning and the brain only exist against Convex.

| Command | What it does |
| --- | --- |
| `npm run dev:web` | Vite dev server only, whole game in a Web Worker, no Convex account needed |
| `npm run dev` | Convex watcher plus Vite together, for full-stack work |
| `npm run build` | Production build into `apps/web/dist` (always targets Convex) |
| `npm run typecheck` | Typechecks core, local server, client and the Convex functions |
| `npm test -w packages/game-core` | Runs the core's tests |
| `npm run deploy` | Builds, pushes the backend, publishes the site to `https://<deployment>.convex.site` |

Optional `.env.local` settings are listed in `.env.example`; the sponsor keys
live on the Convex deployment, see [docs/DEPLOYING.md](docs/DEPLOYING.md).

## How the pieces fit

```
   keys / swipe                 Backend interface                 Convex
 ┌────────────┐  setDirection  ┌──────────────┐   mutation     ┌──────────────────────┐
 │  main.ts   │ ─────────────▶ │ backend/     │ ─────────────▶ │ inputs / botCommands │──┐
 │  scene.ts  │ ◀───────────── │   convex.ts  │ ◀───────────── │ game.snapshot (live) │  │ drained
 └────────────┘   snapshots    └──────────────┘                └──────────────────────┘  │ by
   60 fps, interpolated                                        ┌──────────────────────┐  │
                                                               │ tick.ts  (10 Hz)     │◀─┘
                                                               │   Room from @game/core
                                                               │   every ~7s ─▶ brains.think ─▶ OpenAI
                                                               └──────────────────────┘
   "Summon a rival" ──▶ summon.request ──▶ summon.run: Firecrawl ─▶ OpenAI ─▶ botCommands ─▶ tick spawns it
   email ──▶ /api/agentmail/webhook ──▶ email.onMessageReceived ──▶ same pipeline ──▶ email.answer
```

- **The server is authoritative.** The client sends a direction, never a
  position. Every 100 ms the tick steps the room and the live query pushes a
  `Snapshot` to subscribers.
- **The brain never steers.** It returns `{ id, mode, target, say }` per bot;
  `decideBot` in the core turns the mode into look-ahead preferences (the
  target's trail is worth chasing, the target's land is worth looping
  through, empty ground is worth claiming, home is worth staying near).
- **Rooms with no audience pause.** Bots play for humans or for a spectator
  screen with a heartbeat; otherwise the loop polls slowly and the room is
  deleted after 30 s.

## The Convex backend

`packages/backend/convex/`:

- **`schema.ts`**: `rooms` (flat state, players with their bot plans and
  personas), `grids` (the two byte layers, kept out of the live query),
  `playerRooms`, `inputs`, `botCommands` (brain answers and rivals to spawn),
  `summons` (each summon's progress, followed live by the client).
- **`tick.ts`**: the loop. Drains inputs and bot commands, steps the room,
  schedules the brain, persists.
- **`brains.ts`**: `view` (the board without the grid), `think` (OpenAI),
  `command` (queue the answer).
- **`summon.ts`**: `request` (queue), `run` (Firecrawl, OpenAI, stage the
  bot), `status` / `recent` / `capabilities` (live queries for the UI).
- **`email.ts`** and **`http.ts`**: the AgentMail webhook, the mail parser,
  and the reply.
- **`convex.config.ts`**: components and typed env.

Everything a mutation writes to a room document happens in `tick.ts`; that
one rule is what keeps a full arena responsive.
