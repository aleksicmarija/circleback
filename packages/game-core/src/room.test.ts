import { describe, expect, it } from "vitest";
import { Room } from "./room";
import type { Dir } from "./types";

/**
 * A tiny deterministic PRNG whose mutable state lives in a box we control
 * from outside the closure, so a clone can be seeded with the exact state
 * the original had at the moment of the branch and then diverge independently.
 */
function makeRandom(box: { state: number }): () => number {
  return () => {
    box.state = (box.state * 1103515245 + 12345) & 0x7fffffff;
    return box.state / 0x7fffffff;
  };
}

describe("Room.serialize / Room.hydrate", () => {
  it("keeps a cloned room byte-for-byte identical to the original under the same inputs", { timeout: 30000 }, () => {
    const originalBox = { state: 42 };
    let nextId = 1;
    const makeId = (isBot: boolean) => `${isBot ? "b" : "p"}${nextId++}`;

    const original = new Room("TEST", makeRandom(originalBox), makeId);
    const human = original.addPlayer("petar", false, 0);
    original.addPlayer("bot-a", true, 0);
    original.addPlayer("bot-b", true, 0);

    let now = 0;
    let clone: Room | null = null;

    const dirs: Dir[] = [0, 1, 2, 3];
    for (let i = 0; i < 400; i++) {
      now += 50;

      if (i % 7 === 0) original.setDirection(human.id, dirs[i % dirs.length]);
      original.step(now);

      // Branch off a clone partway through, seeded with the original PRNG's
      // exact state at this instant, then let both diverge independently.
      if (i === 150) {
        const cloneBox = { state: originalBox.state };
        clone = Room.hydrate(original.serialize(), makeRandom(cloneBox), makeId);
        continue; // clone starts from this tick's post-state; step it from the next iteration
      }

      if (clone) {
        if (i % 7 === 0) clone.setDirection(human.id, dirs[i % dirs.length]);
        clone.step(now);

        expect(clone.grid.owner).toEqual(original.grid.owner);
        expect(clone.grid.trail).toEqual(original.grid.trail);
        expect(clone.snapshot(now, "patches")).toEqual(original.snapshot(now, "patches"));
      }
    }

    expect(clone).not.toBeNull();
  });
});
