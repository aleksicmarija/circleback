/**
 * Tiny sound layer over HTMLAudioElement. Sound effects come from Kenney's
 * CC0 audio packs (see public/models/LICENSE-kenney.txt).
 */

export type Sfx = "capture" | "kill" | "death" | "spawn" | "click";

const MUTE_KEY = "circleback.muted";
const SFX_VOLUME = 0.6;
const MUSIC_VOLUME = 0.3;

const pools = new Map<Sfx, HTMLAudioElement[]>();
let music: HTMLAudioElement | null = null;
let muted = false;
try {
  muted = localStorage.getItem(MUTE_KEY) === "1";
} catch {
  /* private mode */
}

function element(name: Sfx): HTMLAudioElement {
  // Small pool per sound so rapid repeats overlap instead of cutting off.
  let pool = pools.get(name);
  if (!pool) {
    pool = [];
    pools.set(name, pool);
  }
  let free = pool.find((a) => a.paused || a.ended);
  if (!free) {
    free = new Audio(`/audio/${name}.ogg`);
    free.volume = SFX_VOLUME;
    if (pool.length < 4) pool.push(free);
  }
  return free;
}

export function play(name: Sfx): void {
  if (muted) return;
  const audio = element(name);
  audio.currentTime = 0;
  void audio.play().catch(() => {
    /* before the first user gesture the browser refuses; fine */
  });
}

/** Call from a user gesture (the Play button) so autoplay rules allow it. */
export function startMusic(): void {
  if (!music) {
    music = new Audio("/audio/music.ogg");
    music.loop = true;
    music.volume = MUSIC_VOLUME;
  }
  if (!muted) void music.play().catch(() => {});
}

export function stopMusic(): void {
  music?.pause();
}

export function isMuted(): boolean {
  return muted;
}

export function setMuted(next: boolean): void {
  muted = next;
  try {
    localStorage.setItem(MUTE_KEY, next ? "1" : "0");
  } catch {
    /* ignore */
  }
  if (!music) return;
  if (muted) music.pause();
  else void music.play().catch(() => {});
}
