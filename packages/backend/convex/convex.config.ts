import { defineApp } from "convex/server";
import { v } from "convex/values";
import staticHosting from "@convex-dev/static-hosting/convex.config";
import firecrawl from "@firecrawl/firecrawl-convex/convex.config";
import agentmail from "@agentmail/convex/convex.config";

/**
 * Components mounted into the app, and the deployment variables the app
 * reads through the typed `env` object. Every key is optional: without them
 * the game still runs, the bots fall back to their built-in heuristics and
 * summoning a rival from a link reports that it is not configured.
 *
 * - static-hosting serves the built client (apps/web/dist) from the root of
 *   the deployment's .site URL, so the game and the backend share one origin.
 *   The app's own HTTP routes (convex/http.ts) therefore live under /api.
 * - firecrawl reads the web page a rival is summoned from (summon.ts).
 * - agentmail gives the arena an inbox; mailing it a link summons a rival
 *   (email.ts). It reads AGENTMAIL_API_KEY and AGENTMAIL_WEBHOOK_SECRET from
 *   the deployment itself.
 */
const app = defineApp({
  httpPrefix: "/api",
  env: {
    /** Lets OpenAI drive the bots (strategy plus the line above their heads) and write rival personas. */
    OPENAI_API_KEY: v.optional(v.string()),
    /** Chat Completions model id; defaults to gpt-5-mini. */
    OPENAI_MODEL: v.optional(v.string()),
    /**
     * Lets players summon a rival from any URL. The component insists on a
     * required declaration; see the note on the deploy checklist about
     * setting it before the first push.
     */
    FIRECRAWL_API_KEY: v.string(),
    /** The arena's inbox address, shown on the spectator screen once AgentMail is set up. */
    AGENTMAIL_INBOX: v.optional(v.string()),
  },
});
app.use(staticHosting, { httpPrefix: "/" });
app.use(firecrawl, { env: { FIRECRAWL_API_KEY: app.env.FIRECRAWL_API_KEY } });
app.use(agentmail);

export default app;
