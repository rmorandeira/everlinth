import type { InputState } from "@roi/shared";

const KEY_TO_DIR: Record<string, keyof InputState> = {
  ArrowUp: "N",
  ArrowDown: "S",
  ArrowLeft: "W",
  ArrowRight: "E",
  w: "N",
  s: "S",
  a: "W",
  d: "E",
};

export function setupInput(onInputChange: (dirs: InputState) => void, onAttack: () => void, onPickup: () => void): () => void {
  const dirs: InputState = { N: false, S: false, E: false, W: false };

  function keydown(ev: KeyboardEvent): void {
    if (ev.key === " ") {
      onAttack();
      return;
    }
    if (ev.key === "e" || ev.key === "E") {
      onPickup();
      return;
    }
    const dir = KEY_TO_DIR[ev.key];
    if (!dir || dirs[dir]) return;
    dirs[dir] = true;
    onInputChange({ ...dirs });
  }

  function keyup(ev: KeyboardEvent): void {
    const dir = KEY_TO_DIR[ev.key];
    if (!dir || !dirs[dir]) return;
    dirs[dir] = false;
    onInputChange({ ...dirs });
  }

  function blur(): void {
    dirs.N = dirs.S = dirs.E = dirs.W = false;
    onInputChange({ ...dirs });
  }

  window.addEventListener("keydown", keydown);
  window.addEventListener("keyup", keyup);
  window.addEventListener("blur", blur);
  return () => {
    window.removeEventListener("keydown", keydown);
    window.removeEventListener("keyup", keyup);
    window.removeEventListener("blur", blur);
  };
}
