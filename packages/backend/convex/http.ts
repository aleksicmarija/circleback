import { httpRouter } from "convex/server";
import { httpAction } from "./_generated/server";
import { components, internal } from "./_generated/api";
import { AgentMail } from "@agentmail/convex";

/**
 * The app's HTTP routes. They are mounted under /api (see convex.config.ts)
 * because the static-hosting component owns the root of the .site URL, so
 * this webhook's public address is https://<deployment>.convex.site/api/agentmail/webhook.
 */
const http = httpRouter();

const agentmail = new AgentMail(components.agentmail, {
  onMessageReceived: internal.email.onMessageReceived,
});

// The AgentMail client types its context against an older Convex release
// whose runMutation had no options argument; the runtime contract is the same.
type WebhookCtx = Parameters<AgentMail["handleWebhook"]>[0];

http.route({
  path: "/agentmail/webhook",
  method: "POST",
  handler: httpAction(async (ctx, req) => agentmail.handleWebhook(ctx as unknown as WebhookCtx, req)),
});

export default http;
