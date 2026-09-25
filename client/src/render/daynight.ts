// Ciclo día/noche basado en la hora real del jugador (no se sincroniza con el servidor),
// o en una hora fijada a mano desde el control del HUD (setHourOverride).
export interface DayNight {
  darkness: number; // 0 = pleno día, 1 = noche cerrada
  glow: number; // 0..1, resplandor cálido de amanecer/atardecer
}

function triangle(hour: number, center: number, width: number): number {
  const d = Math.abs(hour - center);
  return Math.max(0, 1 - d / width);
}

let hourOverride: number | null = null;
/** Fija la hora del día (0..24) o vuelve a la hora real con null. */
export function setHourOverride(hour: number | null): void {
  hourOverride = hour === null ? null : ((hour % 24) + 24) % 24;
}
/** Hora del día en uso (0..24). */
export function getHour(date: Date = new Date()): number {
  return hourOverride ?? date.getHours() + date.getMinutes() / 60;
}

export function getDayNight(date: Date = new Date()): DayNight {
  const hour = getHour(date);

  let darkness: number;
  if (hour >= 7 && hour < 18) darkness = 0;
  else if (hour >= 18 && hour < 20) darkness = (hour - 18) / 2;
  else if (hour >= 5 && hour < 7) darkness = 1 - (hour - 5) / 2;
  else darkness = 1;

  const glow = Math.max(triangle(hour, 6, 1.5), triangle(hour, 19, 1.5)) * (1 - darkness * 0.3);

  return { darkness, glow };
}
