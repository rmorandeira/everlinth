import type { Direction } from "@roi/shared";

const KEY_TO_DIR: Record<string, Direction> = {
  ArrowUp: "N",
  ArrowDown: "S",
  ArrowLeft: "W",
  ArrowRight: "E",
  w: "N",
  s: "S",
  a: "W",
  d: "E",
};

const MOVE_COOLDOWN_MS = 130;

export function setupInput(onMove: (dir: Direction) => void, onPickup: () => void): () => void {
  let lastMove = 0;

  function handler(ev: KeyboardEvent): void {
    if (ev.key === " " || ev.key === "e" || ev.key === "E") {
      onPickup();
      return;
    }
    const dir = KEY_TO_DIR[ev.key];
    if (!dir) return;
    const now = performance.now();
    if (now - lastMove < MOVE_COOLDOWN_MS) return;
    lastMove = now;
    onMove(dir);
  }

  window.addEventListener("keydown", handler);
  return () => window.removeEventListener("keydown", handler);
}
