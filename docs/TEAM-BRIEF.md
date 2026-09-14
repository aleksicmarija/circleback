# Circleback for the Convex All Gas Hackathon: team brief

Prepared 14 September 2026 from the repository state and the event page
(https://luma.com/convex-allgas-hackathon).

**Submit by Monday 22 September, 12:00 PM PT (21:00 in Belgrade).**
Form: https://vibeapps.dev/judging/convex-all-gas-hackathon-openai/submit
Winners announced 25 September.

The code is done and committed on the `convex-allgas-hackathon` branch
(three commits on 14 September, not pushed yet). What is left needs
accounts, keys, a video and a post.

## 1. What is built

All of this was verified against a local Convex deployment. The sponsor
calls themselves have not been made with real keys, because none exist on
the machine that built this.

| Piece | What it does | Status |
| --- | --- | --- |
| Convex static hosting | The site is served from the deployment's `.site` URL. `npm run deploy` builds, pushes and publishes in one step. Render is gone. | Verified |
| OpenAI bot brains | Every 7 s per active room, one call returns a strategy (expand, raid, hunt, defend) and a line for each bot. The core executes it cell by cell; plans expire after 20 s. | Needs key |
| Summon a rival | Paste any link or a sentence in the HUD. Firecrawl reads the page, OpenAI writes a name, blurb and voice, and the robot joins. The client follows it live; the spectator screen shows a feed. | Needs keys |
| Arena inbox | Email a link to the arena. AgentMail's webhook lands on `/api/agentmail/webhook`, the mail becomes a summon, and the inbox replies with a spectate link. | Needs key + inbox |
| Queue design | Nothing but the tick writes a room document. Brain answers and finished rivals go through a `botCommands` queue, like inputs already did. Three rivals summoned in a row with no conflicts. | Verified |
| Docs and build log | README, deploy guide, env example and `hackathon.md` (from the official skill) rewritten for this event. | Done |
| Auth + persistent leaderboard | Approved as optional. Held back: passkey auth cannot be checked without a cloud deployment and a browser. | Not started |

Typecheck is clean and the 11 game-core tests pass. Nobody has looked at
the new HUD panel in a browser yet, so the first person to deploy should
open the game and the spectator page and report anything odd.

## 2. What is left, in this order

1. **Register on Luma.** One team member is enough. Do it first; the form is keyed to it.
2. **Convex login and project.** The dev deployment on the build machine is anonymous and local. Run `npx convex login`, then `npx convex dev` once, and either join our existing project or create a new one. Whoever owns the project sets the keys.
3. **Keys on the production deployment.** See section 3. `FIRECRAWL_API_KEY` must exist before the first push, even as a placeholder, because the component declares it required.
4. **AgentMail inbox and webhook.** Create the inbox with `npx convex run --prod email:createInbox '{"username":"circleback"}'`, set `AGENTMAIL_INBOX` to the address it prints, register `https://<deployment>.convex.site/api/agentmail/webhook` for `message.received` in the AgentMail dashboard, and copy the signing secret into `AGENTMAIL_WEBHOOK_SECRET`.
5. **Deploy and check the three sponsor paths live.** `npm run deploy`. Then: bot lines change every few seconds, a link summon ends in a robot joining, an email gets a reply with a link.
6. **Fill the links in the README.** Play, spectator and video URLs are marked TODO. Run `/convex-hackathon-skill` once more so the build log carries the live URL.
7. **Video under 3 minutes.** The existing video predates all of this. The shot list is in `SUBMISSION.md`. Unlisted YouTube is fine.
8. **Social post.** X or LinkedIn, tagging @convex, @OpenAI, @firecrawl and @agentmail. Judges count it. Draft text is in `SUBMISSION.md`.
9. **Merge, push, submit.** Merge the branch to `main`, push, confirm the repo is public, submit the form. Resubmitting is possible, so submit early and update.

## 3. Accounts and keys

Set each on the *production* deployment with `npx convex env set --prod NAME value`
or in the Convex dashboard. Fill in the owner column when you pick it up.

| Variable | Needed for | Where to get it | Owner |
| --- | --- | --- | --- |
| `OPENAI_API_KEY` | Bot brains, rival personas | platform.openai.com | |
| `OPENAI_MODEL` | Optional, defaults to `gpt-5-mini` | | |
| `FIRECRAWL_API_KEY` | Summon from a link. Required at deploy time | firecrawl.dev | |
| `AGENTMAIL_API_KEY` | The arena inbox | agentmail.to | |
| `AGENTMAIL_WEBHOOK_SECRET` | Verifying inbound mail | AgentMail dashboard, after registering the webhook | |
| `AGENTMAIL_INBOX` | Address shown on the spectator screen | Printed by `email:createInbox` | |

Cost expectations: the brain makes one small call per active room every
7 seconds and only while someone is playing or watching. A room with nobody
in it pauses. Summons are rate-limited to four per room per minute and six
summoned rivals per room.

## 4. Rules check

The published rules versus where we stand. Nothing here reads as a
disqualification; the pending items are ordinary submission work.

| Rule on the event page | Us | |
| --- | --- | --- |
| New apps only, started on or after 25 Aug | First commit 12 Sep. The rule is about the start date, not about where the app was first shown. | OK |
| Convex is the backend: database, functions, real-time sync | Game loop, live state, brain, summoner, inbox and hosting all run on Convex. | OK |
| Built with Codex or any agent/IDE with the Convex plugin | Day one in Cursor with an agent; since then Claude Code with the Convex plugin. Commit history shows it. | OK |
| Setup prompt, hackathon skill, build log | The setup prompt is a convenience installer, not a rule. The skill is installed and `hackathon.md` is backfilled from git. | OK |
| Deployed on Convex static hosting or ChatGPT Sites | Wired and tested locally; the production URL does not exist yet. | Pending |
| Public GitHub repo | Repo is public; the branch still has to be merged and pushed. | Pending |
| Video under 3 minutes | Needs a new recording. | Pending |
| Share on X or LinkedIn with the four tags | Not posted. | Pending |
| Registered on Luma, 18+, not a sponsor employee, not in an excluded country | Confirm registration; the rest applies to each of us. | Confirm |

Judges will see the Belgrade origin in the README and the build log. Being
open about it is better than hiding it, and the event page does not forbid
an app that was also shown elsewhere. If anyone wants certainty, ask in the
Convex Discord #hackathon channel before we submit.

## 5. Commands

```bash
npx convex login                  # once per machine
npx convex dev                    # links the project, writes .env.local
npx convex env set --prod OPENAI_API_KEY sk-...
npx convex env set --prod FIRECRAWL_API_KEY fc-...
npx convex env set --prod AGENTMAIL_API_KEY ...
npm run deploy                    # build + push backend + publish site
npm run typecheck                 # before pushing code
npm test -w packages/game-core    # the core's tests
```

Windows note: with Node 24 the Convex CLI's `run` subcommand aborts on exit
when it manages a *local* anonymous deployment, and the hosting uploader
reads that as failure. Cloud deployments are not affected. The workaround
for local testing is in `docs/DEPLOYING.md`.

## 6. Where things live

- `packages/backend/convex/brains.ts`: the OpenAI call, the board view, the command queue.
- `packages/backend/convex/summon.ts`: request, Firecrawl scrape, persona, staging for the tick.
- `packages/backend/convex/email.ts` and `http.ts`: the AgentMail webhook, mail parsing, replies.
- `packages/backend/convex/tick.ts`: the game loop; the only writer of room documents.
- `packages/game-core/src/bots.ts`: plans, personas, how a strategy becomes steering.
- `apps/web/src/summon.ts`: the HUD panel. `apps/web/spectate.html`: the spectator card and feed.
- `docs/DEPLOYING.md`, `SUBMISSION.md`, `hackathon.md`: setup, the form draft and video script, the build log.
