import { GRID_W, GRID_H, PLAYER_SPEED, DIR_DX, DIR_DZ, opposite, type Dir, type PlayerSnapshot } from "@core";

/**
 * Client-side prediction for the local player's piece.
 *
 * Everyone else is rendered from the interpolated feed, a few hundred
 * milliseconds in the past. Your own piece instead runs here, ahead of the
 * feed, using the same movement rules as the server: constant speed, turns
 * applied at cell centres, no reversing. A keypress therefore turns the piece
 * immediately instead of after a full round trip plus the interpolation delay.
 *
 * Every server snapshot pulls the prediction back toward the truth. Small
 * errors are eased out; big ones (a wall bounce the client could not predict,
 * a respawn, a missed turn) snap.
 */

/** Disagreement beyond this many cells means the prediction is wrong; snap. */
const SNAP_CELLS = 2;
/** Fraction of the remaining error removed per snapshot. */
const NUDGE = 0.15;
/** Give up waiting for the server to confirm a turn after this long. */
const ACK_TIMEOUT_MS = 1000;
/** How far ahead of the feed we run, as a fraction of measured input latency, clamped. */
const LEAD_FRACTION = 0.6;
const MIN_LEAD_MS = 40;
const MAX_LEAD_MS = 250;
const INITIAL_LATENCY_MS = 200;
const EPS = 1e-6;

export type Predicted = { x: number; z: number; dir: Dir };

export class LocalPredictor {
  private x = 0;
  private z = 0;
  private dir: Dir = 0;
  private nextDir: Dir = 0;
  private alive = false;
  private primed = false;
  private stuckAtWall = false;
  private lastSampleAt = 0;
  /** A turn sent to the server that the feed has not shown yet. */
  private pending: { dir: Dir; sentAt: number } | null = null;
  /** Smoothed keypress-to-feed latency, in ms. */
  private latencyMs = INITIAL_LATENCY_MS;

  reset(): void {
    this.alive = false;
    this.primed = false;
    this.stuckAtWall = false;
    this.pending = null;
    this.latencyMs = INITIAL_LATENCY_MS;
  }

  /** A keypress. Mirrors the server's rules so the prediction cannot do what the server would refuse. */
  onInput(dir: Dir, now: number): void {
    if (!this.alive || !this.primed) return;
    if (dir === this.dir || dir === opposite(this.dir)) return;
    this.nextDir = dir;
    this.pending = { dir, sentAt: now };
    this.stuckAtWall = false;
  }

  /** The local player's entry from a fresh server snapshot. */
  onSnapshot(p: PlayerSnapshot, arrivedAt: number): void {
    if (this.pending) {
      if (p.dir === this.pending.dir) {
        const observed = arrivedAt - this.pending.sentAt;
        this.latencyMs += (observed - this.latencyMs) * 0.3;
        this.pending = null;
      } else if (arrivedAt - this.pending.sentAt > ACK_TIMEOUT_MS) {
        this.pending = null;
      }
    }

    if (!p.alive) {
      this.alive = false;
      this.primed = false;
      return;
    }

    // Where the server piece will be by the time this shows, if it keeps its heading.
    const ahead = PLAYER_SPEED * (this.lead() / 1000);
    const tx = clamp(p.x + DIR_DX[p.dir] * ahead, 0.5, GRID_W - 0.5);
    const tz = clamp(p.z + DIR_DZ[p.dir] * ahead, 0.5, GRID_H - 0.5);

    const turnExplainsIt = p.dir === this.nextDir || this.pending !== null;
    const dirMismatch = p.dir !== this.dir && !turnExplainsIt;
    const error = Math.abs(tx - this.x) + Math.abs(tz - this.z);

    if (!this.primed || !this.alive || this.stuckAtWall || dirMismatch || error > SNAP_CELLS) {
      this.x = tx;
      this.z = tz;
      this.dir = p.dir;
      this.nextDir = this.pending ? this.pending.dir : p.dir;
      this.alive = true;
      this.primed = true;
      this.stuckAtWall = false;
      return;
    }

    this.x += (tx - this.x) * NUDGE;
    this.z += (tz - this.z) * NUDGE;
  }

  /** Advances the piece to `now`. Null while dead or before the first snapshot. */
  sample(now: number): Predicted | null {
    const dt = Math.min(Math.max(0, now - this.lastSampleAt) / 1000, 0.1);
    this.lastSampleAt = now;
    if (!this.alive || !this.primed) return null;

    let remaining = PLAYER_SPEED * dt;
    while (remaining > EPS && !this.stuckAtWall) {
      const alongX = DIR_DX[this.dir] !== 0;
      const sign = alongX ? DIR_DX[this.dir] : DIR_DZ[this.dir];
      const a = alongX ? this.x : this.z;
      // Cell centres sit at k + 0.5; find the next one in the direction of travel.
      const nextCentre = sign > 0 ? Math.floor(a - 0.5 + EPS) + 1.5 : Math.ceil(a - 0.5 - EPS) - 0.5;
      const toCentre = Math.abs(nextCentre - a);

      if (remaining < toCentre) {
        if (alongX) this.x += sign * remaining;
        else this.z += sign * remaining;
        break;
      }

      if (alongX) this.x = nextCentre;
      else this.z = nextCentre;
      remaining -= toCentre;

      // At the centre: apply the queued turn, then refuse to drive off the board.
      // The server bounces to a random side here; we wait for it to tell us which.
      if (this.nextDir !== this.dir) this.dir = this.nextDir;
      const nx = this.x + DIR_DX[this.dir];
      const nz = this.z + DIR_DZ[this.dir];
      if (nx < 0.5 - EPS || nx > GRID_W - 0.5 + EPS || nz < 0.5 - EPS || nz > GRID_H - 0.5 + EPS) {
        this.stuckAtWall = true;
      }
    }

    return { x: this.x, z: this.z, dir: this.dir };
  }

  private lead(): number {
    return clamp(this.latencyMs * LEAD_FRACTION, MIN_LEAD_MS, MAX_LEAD_MS);
  }
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
