import { GRID_W, GRID_H, applyPatchCells, type GridState, type Snapshot } from "@core";

/**
 * Keeps a local copy of both grid layers in step with the server.
 *
 * Snapshots normally carry only a short change log (see `Snapshot.patches`).
 * Each patch says which version it upgrades from; we apply the chain that
 * starts at the version we hold. If no patch matches, we have fallen behind
 * the log and ask the backend for the full grid once.
 */
export class GridSync {
  readonly owner = new Uint8Array(GRID_W * GRID_H);
  readonly trail = new Uint8Array(GRID_W * GRID_H);
  version = 0;
  private fetching = false;

  constructor(
    private readonly fetchFull: () => Promise<GridState | null>,
    private readonly onChange: (owner: Uint8Array, trail: Uint8Array) => void,
  ) {}

  apply(snapshot: Snapshot): void {
    if (snapshot.owner && snapshot.trail) {
      this.owner.set(snapshot.owner);
      this.trail.set(snapshot.trail);
      this.version = snapshot.gridVersion;
      this.onChange(this.owner, this.trail);
      return;
    }
    if (snapshot.gridVersion === this.version) return;

    let changed = false;
    for (const patch of snapshot.patches ?? []) {
      if (patch.from !== this.version) continue;
      applyPatchCells(patch.cells, this.owner, this.trail);
      this.version = patch.version;
      changed = true;
    }
    if (changed) this.onChange(this.owner, this.trail);
    if (this.version !== snapshot.gridVersion) this.resync();
  }

  private resync(): void {
    if (this.fetching) return;
    this.fetching = true;
    this.fetchFull()
      .then((grid) => {
        if (!grid) return;
        this.owner.set(grid.owner);
        this.trail.set(grid.trail);
        this.version = grid.gridVersion;
        this.onChange(this.owner, this.trail);
      })
      .catch(() => {
        /* the next snapshot triggers another attempt */
      })
      .finally(() => {
        this.fetching = false;
      });
  }
}
