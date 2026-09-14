import { describe, expect, it } from "vitest";
import { Room } from "./room";
import { MIN_PIECES } from "./constants";
import { brainView } from "./brain";

function seeded(seed: number): () => number {
  let state = seed;
  return () => {
    state = (state * 1103515245 + 12345) & 0x7fffffff;
    return state / 0x7fffffff;
  };
}

describe("bot plans", () => {
  it("shows a plan above the bot's head, keeps a line while it lasts, and drops both when it expires", () => {
    const room = new Room("PLAN", seeded(7));
    room.ensureBots(0);
    const [a, b] = [...room.players.values()];
    room.step(0);

    room.setPlan(a.id, { mode: "hunt", target: b.id, until: 1_000 }, "Mission log: engaging");
    expect(room.snapshot(10).players.find((p) => p.id === a.id)?.status).toBe("Mission log: engaging");

    room.setPlan(a.id, { mode: "hunt", target: b.id, until: 1_000 });
    expect(room.snapshot(10).players.find((p) => p.id === a.id)?.status).toBe(`hunting ${b.name}`);

    room.step(1_001);
    expect(a.bot?.plan).toBeNull();
    expect(["patrolling", "raiding", "heading home", "rebooting"]).toContain(
      room.snapshot(1_001).players.find((p) => p.id === a.id)?.status,
    );
  });

  it("ignores plans for humans and targets that are not in the room", () => {
    const room = new Room("PLAN", seeded(3));
    const human = room.addPlayer("pet", false, 0);
    room.ensureBots(0);
    const bot = [...room.players.values()].find((p) => p.isBot)!;

    room.setPlan(human.id, { mode: "hunt", target: bot.id, until: 999 }, "nope");
    expect(human.status).toBeNull();

    room.setPlan(bot.id, { mode: "raid", target: "ghost", until: 999 });
    expect(bot.bot?.plan).toEqual({ mode: "raid", target: null, until: 999 });
  });

  it("evicts house bots before summoned rivals when a human takes a seat", () => {
    const room = new Room("SEAT", seeded(11));
    room.ensureBots(0);
    const rival = room.addBot("Rival", 0, { blurb: "from the web", voice: "smug", source: "https://x.test" }, true);
    expect(room.players.size).toBe(MIN_PIECES + 1);

    room.addPlayer("pet", false, 0);
    expect(room.players.has(rival.id)).toBe(true);
    expect(room.summonedCount).toBe(1);
    expect(room.players.size).toBe(MIN_PIECES + 1); // a house bot gave up its seat
  });

  it("survives a serialize/hydrate round trip with plans and personas intact", () => {
    const room = new Room("SAVE", seeded(5));
    room.ensureBots(0);
    const bot = [...room.players.values()][0];
    room.setPlan(bot.id, { mode: "defend", target: null, until: 5_000 }, "holding");
    const copy = Room.hydrate(room.serialize());
    const again = copy.players.get(bot.id)!;
    expect(again.bot?.plan).toEqual({ mode: "defend", target: null, until: 5_000 });
    expect(again.bot?.persona).toEqual(bot.bot?.persona);
    expect(again.status).toBe("holding");
  });

  it("gives the brain a compact view with percentages, plans and personas", () => {
    const room = new Room("VIEW", seeded(9));
    room.ensureBots(0);
    room.step(0);
    const view = brainView("VIEW", [...room.players.values()], room.grid.w, room.grid.h);
    expect(view.pieces).toHaveLength(MIN_PIECES);
    for (const piece of view.pieces) {
      expect(piece.isBot).toBe(true);
      expect(piece.pct).toBeGreaterThan(0);
      expect(piece.persona?.voice).toBeTruthy();
      expect(piece.mode).toBeUndefined();
    }
  });
});
