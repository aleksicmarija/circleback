import { internalAction, internalMutation, env } from "./_generated/server";
import { components } from "./_generated/api";
import { v } from "convex/values";
import { AgentMail } from "@agentmail/convex";
import { DEFAULT_ROOM_CODE } from "@game/core";
import { enqueue } from "./summon";

/**
 * The arena's inbox. Anyone can email it a link (or a sentence) and a rival
 * built from it joins the arena; the inbox writes back once the bot is in,
 * with a link to watch. AgentMail keeps the threads; this module only
 * decides what a mail means and what to say back.
 *
 * Setup, once per deployment:
 *   npx convex env set AGENTMAIL_API_KEY ...
 *   npx convex run email:createInbox '{"username":"circleback"}'
 *   npx convex env set AGENTMAIL_INBOX circleback@agentmail.to
 *   register https://<deployment>.convex.site/api/agentmail/webhook in the
 *   AgentMail dashboard and set AGENTMAIL_WEBHOOK_SECRET
 */

export const agentmail = new AgentMail(components.agentmail, {
  onMessageReceived: undefined, // set below, once the mutation exists
});

/** One-time setup helper; prints the inbox address to use as AGENTMAIL_INBOX. */
export const createInbox = internalAction({
  args: { username: v.optional(v.string()), displayName: v.optional(v.string()) },
  returns: v.any(),
  handler: async (ctx, { username, displayName }) => {
    return await agentmail.createInbox(ctx, {
      username: username ?? "circleback",
      displayName: displayName ?? "Circleback Arena",
    });
  },
});

/** Loose shape of an AgentMail inbound message; only what this module reads. */
type Inbound = {
  inbox_id?: string;
  message_id?: string;
  from?: string;
  subject?: string;
  text?: string;
  extracted_text?: string;
};

const ROOM_CODE = /\b(?:room|arena|code)\s*[:#]?\s*([A-Z0-9]{4})\b/i;
const ROOM_PARAM = /[?&]room=([A-Z0-9]{4})\b/i;
const URL_IN_TEXT = /https?:\/\/[^\s<>"')\]]+/i;

/** What a mail is asking for: where, and from what. */
export function parseSummonMail(mail: { subject?: string; body?: string }): { code: string; source: string | null } {
  const subject = (mail.subject ?? "").replace(/^\s*(re|fwd?):\s*/i, "").trim();
  const body = (mail.body ?? "").trim();
  const everything = `${subject}\n${body}`;
  const code = (everything.match(ROOM_PARAM)?.[1] ?? everything.match(ROOM_CODE)?.[1] ?? DEFAULT_ROOM_CODE).toUpperCase();

  const url = body.match(URL_IN_TEXT)?.[0] ?? subject.match(URL_IN_TEXT)?.[0] ?? null;
  if (url) return { code, source: url };

  // No link: the first line of the body, else the subject, describes the rival.
  const firstLine = body.split(/\r?\n/).map((l) => l.trim()).find((l) => l.length >= 3 && !ROOM_CODE.test(l)) ?? "";
  const source = firstLine || (subject.length >= 3 && !/^(hi|hello|hey|summon|rival)$/i.test(subject) ? subject : "");
  return { code, source: source || null };
}

/** AgentMail calls this for every inbound message (see http.ts). */
export const onMessageReceived = internalMutation({
  args: { message: v.any(), thread: v.any(), eventId: v.string() },
  returns: v.null(),
  handler: async (ctx, { message }) => {
    const mail = message as Inbound;
    if (!mail.inbox_id || !mail.message_id || !mail.from) return null;
    const reply = { inboxId: mail.inbox_id, messageId: mail.message_id, from: mail.from };
    const parsed = parseSummonMail({ subject: mail.subject, body: mail.extracted_text ?? mail.text });

    let refusal: string | null = null;
    if (!parsed.source) refusal = "I could not find a link or a description in your mail.";
    else {
      try {
        await enqueue(ctx, { code: parsed.code, source: parsed.source, via: "email", reply });
      } catch (error) {
        refusal = error instanceof Error ? error.message : String(error);
        // ConvexError carries the player-facing text in `data`.
        const data = (error as { data?: unknown }).data;
        if (typeof data === "string") refusal = data;
      }
    }
    if (refusal) {
      await agentmail.replyToMessage(ctx, reply.inboxId, reply.messageId, {
        text: `${refusal}\n\n${HELP}`,
        labels: ["circleback", "refused"],
      });
    }
    return null;
  },
});

/** Writes back once the summon finished, one way or the other. */
export const answer = internalMutation({
  args: { summonId: v.id("summons") },
  returns: v.null(),
  handler: async (ctx, { summonId }) => {
    const row = await ctx.db.get(summonId);
    if (!row?.reply) return null;
    const site = env.CONVEX_SITE_URL;
    const room = row.code === DEFAULT_ROOM_CODE ? "" : `?room=${row.code}`;
    const text =
      row.status === "joined"
        ? `${row.botName} has entered arena ${row.code}.\n${row.detail ?? ""}\n\nWatch it play: ${site}/spectate${room}\nJump in yourself: ${site}/${room}\n\nSend another link to summon another rival.`
        : `I could not summon a rival from that. ${row.detail ?? ""}\n\n${HELP}`;
    await agentmail.replyToMessage(ctx, row.reply.inboxId, row.reply.messageId, {
      text,
      labels: ["circleback", row.status === "joined" ? "summoned" : "failed"],
    });
    return null;
  },
});

const HELP =
  "How to summon a rival: email me a link to any web page (a site, a profile, a product, a repo) or a one-line description, and a robot built from it joins the public arena. Put a room code in the subject, like \"room ABCD\", to send it to a private arena instead.";
