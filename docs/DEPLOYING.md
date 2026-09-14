# Deploying Circleback

One cloud. Convex runs the backend **and** serves the client, from the same
deployment, at `https://<deployment>.convex.site`.

```
   npm run deploy
        │
        ├─ 1. vite build  (VITE_CONVEX_URL baked in)      apps/web/dist
        ├─ 2. npx convex deploy                           functions + schema + components
        └─ 3. upload dist/ to the static-hosting component
                                                          │
  browser ──── GET https://<deployment>.convex.site ──────┘   HTML/JS/models from Convex storage
  browser ──── WebSocket to https://<deployment>.convex.cloud   live queries, mutations
```

The `@convex-dev/static-hosting` component owns `/` on the `.site` URL. The
app's own HTTP routes (`convex/http.ts`) live under `/api`, which is where
AgentMail's webhook lands.

## First-time setup

1. **Log in and pick a project.** `npx convex login`, then `npx convex dev`
   once; it creates or links the project and writes `.env.local`.
2. **Set the deployment variables** on the *production* deployment (add
   `--prod` to each `env set`, or use the dashboard). The game runs without
   them, but the sponsor features do not:

   | Variable | Needed for | Where to get it |
   | --- | --- | --- |
   | `OPENAI_API_KEY` | bot brains and rival personas | platform.openai.com |
   | `OPENAI_MODEL` | optional, defaults to `gpt-5-mini` | |
   | `FIRECRAWL_API_KEY` | summoning a rival from a link. **Required by the component at deploy time**: set it before the first push, even if it is a placeholder | firecrawl.dev |
   | `AGENTMAIL_API_KEY` | the arena inbox | agentmail.to |
   | `AGENTMAIL_WEBHOOK_SECRET` | verifying inbound mail | AgentMail dashboard, after step 4 |
   | `AGENTMAIL_INBOX` | the address shown on the spectator screen | step 3 |

3. **Create the inbox** (needs `AGENTMAIL_API_KEY` on the deployment):

   ```bash
   npx convex run --prod email:createInbox '{"username":"circleback"}'
   npx convex env set --prod AGENTMAIL_INBOX circleback@agentmail.to
   ```

4. **Register the webhook** in the AgentMail dashboard:
   `https://<deployment>.convex.site/api/agentmail/webhook`, event
   `message.received`, and copy the signing secret into
   `AGENTMAIL_WEBHOOK_SECRET`.

## Shipping a change

```bash
npm run deploy
```

That is the whole release. It typechecks, builds `apps/web` with the
production Convex URL, pushes `packages/backend/convex/`, and publishes the
new `dist/` atomically: visitors never see a page whose assets are missing,
and a failed upload leaves the previous version live.

To try the hosted build against the **dev** deployment first (same HTTP,
caching and SPA behaviour as production):

```bash
npm run deploy:preview
```

> **Windows note.** On this machine the Convex CLI's `run` subcommand crashes
> on exit (`Assertion failed: !(handle->flags & UV_HANDLE_CLOSING)`) when it
> manages a *local* anonymous deployment, and the hosting uploader reads that
> as failure. Cloud deployments are not affected. To upload to a local
> deployment anyway, address it as self-hosted:
>
> ```bash
> CONVEX_DEPLOYMENT= CONVEX_SELF_HOSTED_URL=http://127.0.0.1:3210 \
> CONVEX_SELF_HOSTED_ADMIN_KEY=$(node -p "require('./.convex/local/default/config.json').adminKey") \
> npm run deploy:preview
> ```

## Why `_generated/` is committed

`convex deploy` runs the client build *before* codegen, so a fresh checkout
must already have `packages/backend/convex/_generated/`. **Whenever you add,
rename or delete a Convex function or component, commit the changed
`_generated/` files with it.**

## Checklist before a demo

- `https://<deployment>.convex.site/` opens on a phone and a laptop, Play works
- `/spectate` shows the arena, the QR code and the summon card
- Bots show lines above their heads that change every few seconds (OpenAI key is set)
- "Summon a rival" with a link ends in a robot joining (Firecrawl key is set)
- An email to the inbox gets a reply with a spectate link (AgentMail webhook is registered)
