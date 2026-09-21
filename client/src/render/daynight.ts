// Ciclo día/noche basado en la hora real del jugador (no se sincroniza con el servidor).
export interface DayNight {
  darkness: number; // 0 = pleno día, 1 = noche cerrada
  glow: number; // 0..1, resplandor cálido de amanecer/atardecer
}

function triangle(hour: number, center: number, width: number): number {
  const d = Math.abs(hour - center);
  return Math.max(0, 1 - d / width);
}

export function getDayNight(date: Date = new Date()): DayNight {
  const hour = date.getHours() + date.getMinutes() / 60;

  let darkness: number;
  if (hour >= 7 && hour < 18) darkness = 0;
  else if (hour >= 18 && hour < 20) darkness = (hour - 18) / 2;
  else if (hour >= 5 && hour < 7) darkness = 1 - (hour - 5) / 2;
  else darkness = 1;

  const glow = Math.max(triangle(hour, 6, 1.5), triangle(hour, 19, 1.5)) * (1 - darkness * 0.3);

  return { darkness, glow };
}

export function applyDayNightOverlay(ctx: CanvasRenderingContext2D, width: number, height: number, dn: DayNight): void {
  if (dn.darkness > 0.01) {
    ctx.fillStyle = `rgba(10, 12, 45, ${dn.darkness * 0.65})`;
    ctx.fillRect(0, 0, width, height);
  }
  if (dn.glow > 0.05) {
    const gradient = ctx.createLinearGradient(0, 0, 0, height);
    gradient.addColorStop(0, `rgba(255, 140, 60, ${dn.glow * 0.18})`);
    gradient.addColorStop(1, `rgba(255, 90, 60, 0)`);
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, width, height);
  }
}
