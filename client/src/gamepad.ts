import type { InputState } from "@roi/shared";

const DEADZONE = 0.35;
const ATTACK_BUTTON = 0; // A / Cruz
const PICKUP_BUTTON = 2; // X / Cuadrado

// Mando Bluetooth/USB vía Web Gamepad API: no hace falta ninguna librería, funciona
// en cualquier navegador Chromium (incluye Chromecast con Google TV / Android TV).
// No hay eventos por botón: hay que sondear el estado en cada frame.
export function setupGamepad(onInputChange: (dirs: InputState) => void, onAttack: () => void, onPickup: () => void): () => void {
  let dirs: InputState = { N: false, S: false, E: false, W: false };
  let prevAttack = false;
  let prevPickup = false;
  let rafId = 0;
  let stopped = false;

  function poll(): void {
    if (stopped) return;
    const pads = navigator.getGamepads ? navigator.getGamepads() : [];
    const gp = pads[0];
    if (gp) {
      const axisX = gp.axes[0] ?? 0;
      const axisY = gp.axes[1] ?? 0;
      const next: InputState = {
        N: gp.buttons[12]?.pressed === true || axisY < -DEADZONE,
        S: gp.buttons[13]?.pressed === true || axisY > DEADZONE,
        W: gp.buttons[14]?.pressed === true || axisX < -DEADZONE,
        E: gp.buttons[15]?.pressed === true || axisX > DEADZONE,
      };
      if (next.N !== dirs.N || next.S !== dirs.S || next.E !== dirs.E || next.W !== dirs.W) {
        dirs = next;
        onInputChange({ ...dirs });
      }

      const attack = gp.buttons[ATTACK_BUTTON]?.pressed === true;
      if (attack && !prevAttack) onAttack();
      prevAttack = attack;

      const pickup = gp.buttons[PICKUP_BUTTON]?.pressed === true;
      if (pickup && !prevPickup) onPickup();
      prevPickup = pickup;
    }
    rafId = requestAnimationFrame(poll);
  }

  rafId = requestAnimationFrame(poll);
  return () => {
    stopped = true;
    cancelAnimationFrame(rafId);
  };
}
