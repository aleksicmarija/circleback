import { describe, expect, it } from "vitest";
import { Room } from "./room";
import { TICK_MS } from "./constants";
import { applyPatchCells } from "./types";

function makeRandom(box: { state: number }): () => number {
  return () => {
    box.state = (box.state * 1103515245 + 12345) & 0x7fffffff;
    return box.state / 0x7fffffff;
  };
}

describe("grid patch log", () => {
  /**
   * The property the board freeze was violating. A client that has the grid
   * and then only consumes snapshots, in order, must always be able to reach
   * the server's version from what each snapshot carries -- a patch chaining
   * from where it is, or the layers inline. When it cannot, `GridSync` has to
   * fetch the grid over a separate round trip, and the board is frozen until
   * that lands.
   */
  it("lets a snapshot-only client track the server grid exactly, with no refetch", () => {
    const room = new Room("TEST", makeRandom({ state: 7 }));
    let now = 1_000_000;
    room.ensureBots(now);

    // Join: the client starts from the full grid, as `fetchGrid` gives it.
    const seed = room.gridState();
    const owner = new Uint8Array(seed.owner);
    const trail = new Uint8Array(seed.trail);
    let version = seed.gridVersion;

    for (let step = 0; step < 600; step++) {
      now += TICK_MS;
      room.step(now);
      const snap = room.snapshot(now, "patches");

      if (snap.owner && snap.trail) {
        owner.set(snap.owner);
        trail.set(snap.trail);
        version = snap.gridVersion;
      } else {
        for (const patch of snap.patches ?? []) {
          if (patch.from !== version) continue;
          applyPatchCells(patch.cells, owner, trail);
          version = patch.version;
        }
      }

      expect(version).toBe(snap.gridVersion);
    }

    const truth = room.gridState();
    expect(Array.from(owner)).toEqual(Array.from(truth.owner));
    expect(Array.from(trail)).toEqual(Array.from(truth.trail));
  });

  /** With no patch able to chain, the layers ride along instead of costing a round trip. */
  it("ships the grid layers inline when the log cannot chain", () => {
    const room = new Room("TEST", makeRandom({ state: 3 }));
    const snap = room.snapshot(1_000_000, "patches");

    expect(snap.patches).toEqual([]);
    expect(snap.owner).toBeDefined();
    expect(snap.trail).toBeDefined();
  });

  /** Once the log is chaining, snapshots stay small: no layers, just patches. */
  it("omits the layers once patches can carry the change", () => {
    const room = new Room("TEST", makeRandom({ state: 11 }));
    let now = 1_000_000;
    room.ensureBots(now);
    room.step((now += TICK_MS));
    room.step((now += TICK_MS));

    const snap = room.snapshot(now, "patches");
    expect(snap.owner).toBeUndefined();
    expect(snap.trail).toBeUndefined();
    expect((snap.patches ?? []).length).toBeGreaterThan(0);
  });
});
