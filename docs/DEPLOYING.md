# Deploying Circleback

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
