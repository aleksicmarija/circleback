/**
 * Two byte layers over the arena: `owner` is territory, `trail` is the line a
 * player draws while outside their territory. Both use 0 = nobody, slot + 1.
 */
export class Grid {
  readonly owner: Uint8Array;
  readonly trail: Uint8Array;
  private readonly visited: Uint8Array;
  private readonly queue: Int32Array;

  constructor(readonly w: number, readonly h: number) {
    const size = w * h;
    this.owner = new Uint8Array(size);
    this.trail = new Uint8Array(size);
    this.visited = new Uint8Array(size);
    this.queue = new Int32Array(size);
  }

  index(x: number, z: number): number {
    return z * this.w + x;
  }

  inBounds(x: number, z: number): boolean {
    return x >= 0 && z >= 0 && x < this.w && z < this.h;
  }

  /**
   * Closes a loop: everything enclosed by value `v`'s territory plus trail
   * becomes `v`'s territory, and the trail is absorbed.
   *
   * Flood-fills from the arena border through cells that are NOT part of the
   * wall; whatever the fill cannot reach is inside the loop.
   */
  capture(v: number): void {
    const { w, h, owner, trail, visited, queue } = this;
    visited.fill(0);
    let head = 0;
    let tail = 0;

    const push = (i: number) => {
      if (visited[i] === 0 && owner[i] !== v && trail[i] !== v) {
        visited[i] = 1;
        queue[tail++] = i;
      }
    };

    for (let x = 0; x < w; x++) {
      push(x);
      push((h - 1) * w + x);
    }
    for (let z = 0; z < h; z++) {
      push(z * w);
      push(z * w + w - 1);
    }

    while (head < tail) {
      const i = queue[head++];
      const x = i % w;
      if (x > 0) push(i - 1);
      if (x < w - 1) push(i + 1);
      if (i >= w) push(i - w);
      if (i < (h - 1) * w) push(i + w);
    }

    for (let i = 0; i < w * h; i++) {
      if (visited[i] === 0) owner[i] = v;
      if (trail[i] === v) trail[i] = 0;
    }
  }

  /** Removes every trace of `v` from both layers. */
  clear(v: number): void {
    const { owner, trail } = this;
    for (let i = 0; i < owner.length; i++) {
      if (owner[i] === v) owner[i] = 0;
      if (trail[i] === v) trail[i] = 0;
    }
  }

  /** Territory size per value, written into `out` (index = value). */
  count(out: Uint32Array): void {
    out.fill(0);
    const { owner } = this;
    for (let i = 0; i < owner.length; i++) out[owner[i]]++;
  }
}
