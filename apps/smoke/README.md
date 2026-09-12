# Pipeline smoke test

A one-page app that proves the deployment pipeline works before the real game
does: static bundle served by Render, WebSocket to Convex, a mutation
round-trip, and the live query pushing the change to every open tab.

It uses its own backend module (`packages/backend/convex/smoke.ts`) and table
(`smoke_pings`), so it never touches game data. Delete both plus this folder
when it has served its purpose.

## Local

```bash
npx convex dev            # terminal 1 (writes VITE_CONVEX_URL to .env.local)
npm run dev:smoke         # terminal 2 -> http://localhost:5174
```

Open the page in two tabs, click **Send ping** in one, watch the row appear in
the other. The green dot is the WebSocket state; the "ack" is the mutation
round-trip.

## Render

`render.yaml` defines a second static site, `hackathon-game-smoke`, built with
the same command shape as the game but for this app:

```bash
npm ci && npx convex deploy --cmd 'npm run build -w apps/smoke'
```

It needs the same `CONVEX_DEPLOY_KEY`. Deploy it from the Render dashboard
(Manual Deploy), open the site URL, and repeat the two-tab check against the
production deployment.
