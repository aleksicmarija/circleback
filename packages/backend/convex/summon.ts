import { internalAction, internalMutation, internalQuery, mutation, query, env } from "./_generated/server";
import { components, internal } from "./_generated/api";
import { v, ConvexError } from "convex/values";
import { FirecrawlClient } from "@firecrawl/firecrawl-convex";
import { MAX_NAME_LENGTH, MAX_SUMMONED_BOTS, type BotPersona } from "@game/core";
import type { Doc, Id } from "./_generated/dataModel";
import type { MutationCtx } from "./_generated/server";
import { botPersona } from "./schema";
import { byCode } from "./rooms";
import { DEFAULT_MODEL } from "./brains";

/**
 * Summon a rival: turn any web page (or a sentence) into a bot with a name,
 * a personality and a play style, and drop it into a room.
 *
 *   request (public mutation)  -> a `summons` row, status "queued"
 *   run (internal action)      -> Firecrawl scrapes the page, OpenAI writes
 *                                 the persona, `join` adds the bot
 *   status (public query)      -> the client follows the row live
 *
 * Email requests (see email.ts) enter at `enqueue` with a reply address and
 * get an answer once the bot has joined.
 */

const firecrawl = new FirecrawlClient(components.firecrawl);

/** Per room: at most this many summons in flight or recently made. */
const SUMMON_WINDOW_MS = 60_000;
const SUMMONS_PER_WINDOW = 4;
const MAX_SOURCE_LENGTH = 500;
/** How much of a scraped page the persona writer gets to read. */
const PAGE_EXCERPT_CHARS = 6_000;
const OPENAI_TIMEOUT_MS = 20_000;

export const vStatus = v.union(
  v.literal("queued"),
  v.literal("scraping"),
  v.literal("thinking"),
  v.literal("joined"),
  v.literal("failed"),
);

/** True for anything that looks like a link; bare domains count. */
export function looksLikeUrl(source: string): boolean {
  return /^(https?:\/\/)?[\w-]+(\.[\w-]+)+(\/\S*)?$/i.test(source.trim());
}

function normalizeUrl(source: string): string {
  const trimmed = source.trim();
  return /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
}

/**
 * Shared by the web and email entry points: validates, rate-limits, queues.
 * Deliberately never reads the room document: the tick rewrites it every
 * TICK_MS, and a mutation that read it would keep losing the race. The room
 * is checked by `run`, in a query, and the bot is added by the tick itself.
 */
export async function enqueue(
  ctx: MutationCtx,
  args: { code: string; source: string; via: "web" | "email"; reply?: Doc<"summons">["reply"] },
): Promise<Id<"summons">> {
  const code = args.code.trim().toUpperCase();
  const source = args.source.trim().slice(0, MAX_SOURCE_LENGTH);
  if (source.length < 3) throw new ConvexError("Paste a link, or describe the rival in a few words.");
  if (!/^[A-Z0-9]{4}$/.test(code)) throw new ConvexError(`"${code}" is not a room code.`);

  const recent = await ctx.db
    .query("summons")
    .withIndex("by_code", (q) => q.eq("code", code))
    .order("desc")
    .take(SUMMONS_PER_WINDOW);
  const now = Date.now();
  if (recent.length >= SUMMONS_PER_WINDOW && now - recent[recent.length - 1].createdAt < SUMMON_WINDOW_MS) {
    throw new ConvexError("This arena is summoning as fast as it can. Try again in a minute.");
  }

  const id = await ctx.db.insert("summons", {
    code,
    source,
    via: args.via,
    status: "queued",
    createdAt: now,
    reply: args.reply,
  });
  await ctx.scheduler.runAfter(0, internal.summon.run, { summonId: id });
  return id;
}

/** The game client's entry point. */
export const request = mutation({
  args: { code: v.string(), source: v.string() },
  returns: v.id("summons"),
  handler: async (ctx, args) => enqueue(ctx, { ...args, via: "web" }),
});

/** What the client follows. Never exposes the email reply address. */
export const status = query({
  args: { summonId: v.id("summons") },
  returns: v.union(
    v.null(),
    v.object({
      status: vStatus,
      source: v.string(),
      detail: v.optional(v.string()),
      botName: v.optional(v.string()),
    }),
  ),
  handler: async (ctx, { summonId }) => {
    const row = await ctx.db.get(summonId);
    if (!row) return null;
    return { status: row.status, source: row.source, detail: row.detail, botName: row.botName };
  },
});

/** Rivals summoned into a room, newest first, for the spectator screen. */
export const recent = query({
  args: { code: v.string() },
  returns: v.array(
    v.object({ status: vStatus, source: v.string(), detail: v.optional(v.string()), botName: v.optional(v.string()), via: v.union(v.literal("web"), v.literal("email")) }),
  ),
  handler: async (ctx, { code }) => {
    const rows = await ctx.db
      .query("summons")
      .withIndex("by_code", (q) => q.eq("code", code.toUpperCase()))
      .order("desc")
      .take(6);
    return rows.map((r) => ({ status: r.status, source: r.source, detail: r.detail, botName: r.botName, via: r.via }));
  },
});

export const get = internalQuery({
  args: { summonId: v.id("summons") },
  returns: v.union(v.null(), v.any()),
  handler: async (ctx, { summonId }): Promise<Doc<"summons"> | null> => ctx.db.get(summonId),
});

/** Whether a room can take another rival. A query, so it never contends with the tick. */
export const roomState = internalQuery({
  args: { code: v.string() },
  returns: v.union(v.null(), v.object({ summoned: v.number() })),
  handler: async (ctx, { code }) => {
    const doc = await byCode(ctx, code);
    if (!doc) return null;
    return { summoned: doc.players.filter((p) => p.bot?.summoned).length };
  },
});

export const progress = internalMutation({
  args: { summonId: v.id("summons"), status: vStatus, detail: v.optional(v.string()) },
  returns: v.null(),
  handler: async (ctx, { summonId, status, detail }) => {
    await ctx.db.patch(summonId, detail === undefined ? { status } : { status, detail });
    return null;
  },
});

/**
 * Hands the finished rival to the tick, which adds it to the room on its
 * next step and marks the summon joined (see tick.ts). Nothing here reads
 * or writes the room document.
 */
export const stage = internalMutation({
  args: { summonId: v.id("summons"), name: v.string(), persona: botPersona },
  returns: v.null(),
  handler: async (ctx, { summonId, name, persona }) => {
    const row = await ctx.db.get(summonId);
    if (!row) return null;
    await ctx.db.insert("botCommands", { code: row.code, at: Date.now(), moves: [], spawns: [{ summonId, name, persona }] });
    return null;
  },
});

/** The pipeline. Every failure lands in the row so the client can show it. */
export const run = internalAction({
  args: { summonId: v.id("summons") },
  returns: v.null(),
  handler: async (ctx, { summonId }): Promise<null> => {
    // Same-file function references need explicit types (TypeScript circularity).
    const row: Doc<"summons"> | null = await ctx.runQuery(internal.summon.get, { summonId });
    if (!row || row.status !== "queued") return null;
    const fail = async (detail: string): Promise<null> => {
      await ctx.runMutation(internal.summon.progress, { summonId, status: "failed", detail });
      if (row.reply) await ctx.scheduler.runAfter(0, internal.email.answer, { summonId });
      return null;
    };

    const room: { summoned: number } | null = await ctx.runQuery(internal.summon.roomState, { code: row.code });
    if (!room) return fail(`There is no room ${row.code} right now.`);
    if (room.summoned >= MAX_SUMMONED_BOTS) return fail("This arena is full of rivals already.");

    let page: ScrapedPage | null = null;
    if (looksLikeUrl(row.source)) {
      if (!env.FIRECRAWL_API_KEY) return fail("Summoning from a link needs Firecrawl, which is not configured on this deployment.");
      await ctx.runMutation(internal.summon.progress, { summonId, status: "scraping" });
      try {
        page = await scrape(ctx, normalizeUrl(row.source));
      } catch (error) {
        return fail(`Could not read that page: ${scrapeErrorText(error)}`.slice(0, 200));
      }
      if (!page.text.trim() && !page.title) return fail("That page had nothing to read.");
    }

    await ctx.runMutation(internal.summon.progress, { summonId, status: "thinking", detail: page?.title });
    let persona: { name: string } & BotPersona;
    try {
      persona = env.OPENAI_API_KEY
        ? await writePersona(env.OPENAI_API_KEY, env.OPENAI_MODEL ?? DEFAULT_MODEL, row.source, page)
        : fallbackPersona(row.source, page);
    } catch (error) {
      console.warn(`summon ${summonId}: ${error instanceof Error ? error.message : String(error)}`);
      persona = fallbackPersona(row.source, page);
    }
    await ctx.runMutation(internal.summon.stage, {
      summonId,
      name: persona.name,
      persona: { blurb: persona.blurb, voice: persona.voice, source: persona.source },
    });
    return null;
  },
});

type ScrapedPage = { title: string; text: string; url: string };

/** The component wraps Firecrawl's answer in a ConvexError whose message is JSON; show only the human part. */
function scrapeErrorText(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error);
  const json = raw.match(/\{.*\}/s)?.[0];
  if (json) {
    try {
      const parsed = JSON.parse(json) as { message?: string; status?: number };
      if (parsed.status === 401) return "the Firecrawl key on this deployment was rejected.";
      if (parsed.message) return parsed.message.replace(/^Firecrawl \/v2\/scrape failed \(\d+\): /, "");
    } catch {
      // fall through to the raw text
    }
  }
  return raw.replace(/^Uncaught ConvexError: /, "");
}

/** Firecrawl does the reading: main content as markdown, cached for an hour. */
async function scrape(ctx: Parameters<FirecrawlClient["scrape"]>[0], url: string): Promise<ScrapedPage> {
  const doc = await firecrawl.scrape(ctx, url, {
    formats: ["markdown"],
    onlyMainContent: true,
    maxAge: 3_600_000,
    timeout: 25_000,
  });
  const text = (doc.markdown ?? "").replace(/\s+\n/g, "\n").slice(0, PAGE_EXCERPT_CHARS);
  const title = (doc.metadata?.title ?? doc.metadata?.description ?? "").trim().slice(0, 120);
  return { title, text, url: doc.metadata?.sourceURL ?? url };
}

const PERSONA_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    name: { type: "string", description: `Display name, at most ${MAX_NAME_LENGTH} characters, letters digits and spaces only` },
    blurb: { type: "string", description: "One line, under 80 characters, who this rival is" },
    voice: { type: "string", description: "How it talks in the arena, under 120 characters" },
  },
  required: ["name", "blurb", "voice"],
};

/** OpenAI turns the page (or the sentence) into a rival. */
async function writePersona(apiKey: string, model: string, source: string, page: ScrapedPage | null): Promise<{ name: string } & BotPersona> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), OPENAI_TIMEOUT_MS);
  let response: Response;
  try {
    response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      signal: controller.signal,
      headers: { "content-type": "application/json", authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model,
        ...(model.startsWith("gpt-5") ? { reasoning_effort: "minimal" } : { temperature: 0.9 }),
        max_completion_tokens: 300,
        response_format: { type: "json_schema", json_schema: { name: "persona", strict: true, schema: PERSONA_SCHEMA } },
        messages: [
          {
            role: "system",
            content:
              "You create rival robots for Circleback, a cute multiplayer territory game where pets and robots draw loops to claim turf. Given a web page or a description, invent a robot persona that clearly comes from it: a short punchy name (a nickname, product, mascot or the person's first name, never an email address), a one-line blurb, and a voice that a writer can use for its trash talk. Playful, never mean, no profanity, safe for a family audience. Do not include private personal details.",
          },
          {
            role: "user",
            content: page
              ? `Source: ${page.url}\nTitle: ${page.title}\n\nPage content:\n${page.text}`
              : `Description of the rival: ${source}`,
          },
        ],
      }),
    });
  } finally {
    clearTimeout(timer);
  }
  if (!response.ok) throw new Error(`OpenAI ${response.status}: ${(await response.text()).slice(0, 200)}`);
  const body = (await response.json()) as { choices?: { message?: { content?: string } }[] };
  const content = body.choices?.[0]?.message?.content;
  if (!content) throw new Error("OpenAI returned no content");
  const raw = JSON.parse(content) as Record<string, unknown>;
  const fallback = fallbackPersona(source, page);
  return {
    name: cleanName(String(raw.name ?? "")) || fallback.name,
    blurb: String(raw.blurb ?? "").trim().slice(0, 120) || fallback.blurb,
    voice: String(raw.voice ?? "").trim().slice(0, 160) || fallback.voice,
    source: page?.url ?? null,
  };
}

const STOPWORDS = new Set(["a", "an", "the", "of", "and", "who", "that", "with", "for", "from", "to", "in", "on", "at", "is", "my", "our"]);

/** No OpenAI: a rival named after the first two real words of the page title or the description. */
function fallbackPersona(source: string, page: ScrapedPage | null): { name: string } & BotPersona {
  const seed = page?.title || source.replace(/^https?:\/\/(www\.)?/i, "");
  const words = seed
    .split(/[\s|:\-–—·/.,]+/)
    .filter((w) => w && !STOPWORDS.has(w.toLowerCase()))
    .slice(0, 2)
    .map((w) => w[0].toUpperCase() + w.slice(1));
  const name = cleanName(words.join(" ")) || "Rival";
  return {
    name,
    blurb: (page?.title || source).slice(0, 120),
    voice: `sounds like ${seed.slice(0, 60)}`,
    source: page?.url ?? null,
  };
}

function cleanName(name: string): string {
  return name.replace(/[^\p{L}\p{N} ]/gu, "").replace(/\s+/g, " ").trim().slice(0, MAX_NAME_LENGTH);
}

/** Lets the spectator screen and the menu know whether summoning is available. */
export const capabilities = query({
  args: {},
  returns: v.object({ links: v.boolean(), text: v.boolean(), email: v.union(v.string(), v.null()) }),
  handler: async () => ({
    links: Boolean(env.FIRECRAWL_API_KEY),
    text: true,
    email: env.AGENTMAIL_INBOX ?? null,
  }),
});
