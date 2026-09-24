// Fase 5 de la migración a 3D (ver plan): el ángulo isométrico nunca cambia
// (eso lo fija isoCamera.ts), pero la distancia/zoom se anima hacia un valor
// objetivo según el contexto — más alejada explorando (para que quepa la sala
// entera, ver fitHalfHeightToGrid en scene3d.ts), más cerca en combate,
// recogida o al descubrir una pantalla nueva. Mismo patrón de suavizado
// (lerpTowards con tasa exponencial) que ya usa main.ts para la posición del
// jugador, aplicado aquí al half-height del frustum ortográfico.
export type CameraMood = "explore" | "action";

const MOOD_SCALE: Record<CameraMood, number> = {
  explore: 1.8, // más lejos que el ajuste exacto de la sala: se ve más mundo y el jugador queda pequeño
  action: 1.3, // más cerca: combate/recogida/descubrimiento piden ver más detalle, no más mapa
};

export interface CameraRig {
  /** Pide un zoom de "mood" durante holdSeconds; pasado ese tiempo vuelve solo a "explore". */
  pulse(mood: CameraMood, holdSeconds: number): void;
  /** Se llama una vez por frame con el half-height "de reposo" (el que llena la pantalla) y dt; devuelve el half-height ya suavizado de este frame. */
  update(restHalfHeight: number, dt: number): number;
}

export function createCameraRig(): CameraRig {
  let current = 0;
  let initialized = false;
  let mood: CameraMood = "explore";
  let holdTimer = 0;

  function pulse(newMood: CameraMood, holdSeconds: number): void {
    mood = newMood;
    holdTimer = holdSeconds;
  }

  function update(restHalfHeight: number, dt: number): number {
    if (holdTimer > 0) {
      holdTimer -= dt;
      if (holdTimer <= 0) mood = "explore";
    }
    const target = restHalfHeight * MOOD_SCALE[mood];
    if (!initialized) {
      current = target;
      initialized = true;
    }
    const t = 1 - Math.exp(-5 * dt);
    current += (target - current) * t;
    return current;
  }

  return { pulse, update };
}
