import type { InputState } from "@roi/shared";

const DEADZONE = 0.35;
const ATTACK_BUTTON = 0; // A / Cruz
const PICKUP_BUTTON = 2; // X / Cuadrado
export const START_BUTTON = 9; // Start / Options: confirma formularios (login)

// Mapeo estándar de la Web Gamepad API (independiente de la marca real del
// mando): sirve para que la UI muestre "(A)", "(Start)"... entre paréntesis
// en vez de un número de botón sin sentido para quien lo lee.
export const GAMEPAD_BUTTON_LABELS: Record<number, string> = {
  0: "A",
  1: "B",
  2: "X",
  3: "Y",
  4: "LB",
  5: "RB",
  6: "LT",
  7: "RT",
  8: "Select",
  9: "Start",
  10: "L3",
  11: "R3",
  12: "↑",
  13: "↓",
  14: "←",
  15: "→",
};

const CURSOR_SPEED = 900; // px/seg del cursor al fondo del recorrido del stick derecho

// Mando Bluetooth/USB vía Web Gamepad API: no hace falta ninguna librería, funciona
// en cualquier navegador Chromium (incluye Chromecast con Google TV / Android TV).
// No hay eventos por botón: hay que sondear el estado en cada frame.
export function setupGamepad(
  onInputChange: (dirs: InputState) => void,
  onAttack: () => void,
  onPickup: () => void,
  onStart: () => void,
  onRightStick: (dx: number, dy: number) => void,
  onConnectedChange: (connected: boolean) => void
): () => void {
  let dirs: InputState = { N: false, S: false, E: false, W: false };
  let prevAttack = false;
  let prevPickup = false;
  let prevStart = false;
  let prevConnected = false;
  let lastTime = performance.now();
  let rafId = 0;
  let stopped = false;

  function poll(now: number): void {
    if (stopped) return;
    const dt = Math.min(0.05, Math.max(0, (now - lastTime) / 1000));
    lastTime = now;

    const pads = navigator.getGamepads ? navigator.getGamepads() : [];
    const gp = pads[0];
    const connected = gp != null;
    if (connected !== prevConnected) {
      prevConnected = connected;
      onConnectedChange(connected);
    }

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

      const start = gp.buttons[START_BUTTON]?.pressed === true;
      if (start && !prevStart) onStart();
      prevStart = start;

      // Stick derecho mueve el cursor (apuntado de la linterna, selección de UI):
      // se manda como delta ya escalado por dt, no como eje crudo, así quien
      // recibe esto solo tiene que sumarlo a la posición actual del cursor.
      const rsx = gp.axes[2] ?? 0;
      const rsy = gp.axes[3] ?? 0;
      const mag = Math.hypot(rsx, rsy);
      if (mag > DEADZONE) {
        const eased = (mag - DEADZONE) / (1 - DEADZONE);
        const speed = (CURSOR_SPEED * eased) / mag;
        onRightStick(rsx * speed * dt, rsy * speed * dt);
      }
    }

    rafId = requestAnimationFrame(poll);
  }

  rafId = requestAnimationFrame(poll);
  return () => {
    stopped = true;
    cancelAnimationFrame(rafId);
  };
}
