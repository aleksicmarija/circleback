import { defineApp } from "convex/server";
import staticHosting from "@convex-dev/static-hosting/convex.config";

/**
 * Components mounted into the app. The static-hosting component serves the
 * built client (apps/web/dist) from the root of the deployment's .site URL,
 * so the game and the backend share one origin with no second host. The
 * app's own HTTP routes (convex/http.ts) therefore live under /api.
 */
const app = defineApp({ httpPrefix: "/api" });
app.use(staticHosting, { httpPrefix: "/" });

export default app;
