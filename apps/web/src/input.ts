import type { Dir } from "@core";

const KEY_TO_DIR: Record<string, Dir> = {
  KeyW: 0, ArrowUp: 0,
  KeyD: 1, ArrowRight: 1,
  KeyS: 2, ArrowDown: 2,
  KeyA: 3, ArrowLeft: 3,
};

/** Minimum drag distance (px) before a touch counts as a swipe. */
const SWIPE_PX = 24;

function typingInAField(): boolean {
  const active = document.activeElement;
  return active instanceof HTMLInputElement || active instanceof HTMLTextAreaElement;
}

/**
 * Direction input is edge-triggered: one event per keypress or swipe. The
 * player never stops moving, so there is no "idle" state to report.
 */
export function onDirection(callback: (dir: Dir) => void): void {
  window.addEventListener("keydown", (event) => {
    if (typingInAField()) return;
    const dir = KEY_TO_DIR[event.code];
    if (dir === undefined) return;
    event.preventDefault();
    if (event.repeat) return;
    callback(dir);
  });

  let touchStart: { x: number; y: number } | null = null;
  window.addEventListener("touchstart", (event) => {
    if (typingInAField()) return;
    const touch = event.touches[0];
    touchStart = { x: touch.clientX, y: touch.clientY };
  }, { passive: true });

  window.addEventListener("touchmove", (event) => {
    if (!touchStart) return;
    const touch = event.touches[0];
    const dx = touch.clientX - touchStart.x;
    const dy = touch.clientY - touchStart.y;
    if (Math.hypot(dx, dy) < SWIPE_PX) return;
    touchStart = null;
    if (Math.abs(dx) > Math.abs(dy)) callback(dx > 0 ? 1 : 3);
    else callback(dy > 0 ? 2 : 0);
  }, { passive: true });

  window.addEventListener("touchend", () => { touchStart = null; });
}
