import { describe, expect, it } from "vitest";
import { Room } from "./room";
import { PLAYER_SPEED } from "./constants";
import { DIR_DX, DIR_DZ } from "./types";

function makeRandom(box: { state: number }): () => number {
  return () => {
    box.state = (box.state * 1103515245 + 12345) & 0x7fffffff;
    return box.state / 0x7fffffff;
  };
}

/**
 * A client blends between two snapshots using the clock they carry, so that
 * clock has to advance by exactly the time the pieces moved for. Timestamping
 * a snapshot when it was *built* folds in however long the host took to answer,
 * which the movement knows nothing about, and the client renders the same
 * motion over a longer or shorter span: the piece speeds up and slows down for
 * reasons that are not movement.
 */
describe("snapshot clock", () => {
  it("times positions by the tick that produced them, not by when it was asked", () => {
    const room = new Room("T", makeRandom({ state: 4 }));
    const first = 1_000_000;
    room.ensureBots(first);
    room.step(first);

    // Built immediately, and again much later, with no tick in between.
    expect(room.snapshot(first + 1, "patches").at).toBe(first);
    expect(room.snapshot(first + 250, "patches").at).toBe(first);

    const second = first + 137;
    room.step(second);
    expect(room.snapshot(second + 90, "patches").at).toBe(second);
  });

  it("moves pieces exactly as far as its clock advanced", () => {
    const box = { state: 9 };
    const rnd = makeRandom(box);
    const room = new Room("T", makeRandom({ state: 4 }));

    let now = 1_000_000;
    room.ensureBots(now);
    room.step(now);
    let previous = room.snapshot(now, "patches");

    for (let i = 0; i < 400; i++) {
      // Uneven ticks, and the snapshot built some time after each one.
      now += 20 + Math.floor(rnd() * 30);
      room.step(now);
      const snapshot = room.snapshot(now + Math.floor(rnd() * 60), "patches");
      const elapsed = (snapshot.at - previous.at) / 1000;

      for (const player of snapshot.players) {
        const before = previous.players.find((p) => p.id === player.id);
        if (!before || !before.alive || !player.alive) continue;
        if (before.dir !== player.dir) continue; // a turn splits the path across two axes

        const across = DIR_DX[player.dir] !== 0 ? player.z - before.z : player.x - before.x;
        if (across !== 0) continue; // turned and turned back within the step

        const along = DIR_DX[player.dir] !== 0
          ? (player.x - before.x) * DIR_DX[player.dir]
          : (player.z - before.z) * DIR_DZ[player.dir];
        expect(along).toBeCloseTo(PLAYER_SPEED * elapsed, 6);
      }
      previous = snapshot;
    }
  });
});
