const MOVEMENT_KEYS = new Set([
  "KeyW", "KeyA", "KeyS", "KeyD",
  "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight",
]);

const pressed = new Set<string>();

function typingInAField(): boolean {
  const active = document.activeElement;
  return active instanceof HTMLInputElement || active instanceof HTMLTextAreaElement;
}

window.addEventListener("keydown", (event) => {
  if (typingInAField()) return;
  if (MOVEMENT_KEYS.has(event.code)) {
    event.preventDefault();
    pressed.add(event.code);
  }
});

window.addEventListener("keyup", (event) => pressed.delete(event.code));
// Keys held while the tab loses focus would otherwise stick down forever.
window.addEventListener("blur", () => pressed.clear());

export type Movement = { moveX: number; moveZ: number };

/** Current WASD/arrow direction as a unit vector, or zero when idle. */
export function readMovement(): Movement {
  if (typingInAField()) return { moveX: 0, moveZ: 0 };

  let x = 0;
  let z = 0;
  if (pressed.has("KeyW") || pressed.has("ArrowUp")) z -= 1;
  if (pressed.has("KeyS") || pressed.has("ArrowDown")) z += 1;
  if (pressed.has("KeyA") || pressed.has("ArrowLeft")) x -= 1;
  if (pressed.has("KeyD") || pressed.has("ArrowRight")) x += 1;

  const length = Math.hypot(x, z);
  return length > 0 ? { moveX: x / length, moveZ: z / length } : { moveX: 0, moveZ: 0 };
}
