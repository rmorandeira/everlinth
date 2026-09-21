// Cono de luz que sale del personaje hacia donde apunta el cursor. Se pinta con
// mezcla aditiva ("lighter") por encima de la niebla de visión y el tinte de
// día/noche, así que perfora la oscuridad en vez de taparla con un color plano.
// De día apenas se nota (es sobre todo un indicador de puntería); de noche es el
// efecto principal.

const CONE_HALF_ANGLE = (26 * Math.PI) / 180;
const CONE_RANGE = 320; // px de pantalla, no escala con el zoom de la sala

export function applyFlashlight(
  ctx: CanvasRenderingContext2D,
  originX: number,
  originY: number,
  targetX: number,
  targetY: number,
  darkness: number
): void {
  const dx = targetX - originX;
  const dy = targetY - originY;
  const dist = Math.hypot(dx, dy);
  if (dist < 1) return;
  const angle = Math.atan2(dy, dx);

  // Siempre hay un mínimo de intensidad (para que se note hacia dónde apuntas
  // también de día), pero de noche el haz es el efecto dominante.
  const intensity = 0.12 + darkness * 0.75;

  const gradient = ctx.createRadialGradient(originX, originY, 0, originX, originY, CONE_RANGE);
  gradient.addColorStop(0, `rgba(255, 244, 214, ${0.55 * intensity})`);
  gradient.addColorStop(0.5, `rgba(255, 230, 180, ${0.28 * intensity})`);
  gradient.addColorStop(1, "rgba(255, 220, 160, 0)");

  ctx.save();
  ctx.globalCompositeOperation = "lighter";
  ctx.beginPath();
  ctx.moveTo(originX, originY);
  ctx.arc(originX, originY, CONE_RANGE, angle - CONE_HALF_ANGLE, angle + CONE_HALF_ANGLE);
  ctx.closePath();
  ctx.fillStyle = gradient;
  ctx.fill();
  ctx.restore();
}

// Punto de mira: sustituye al cursor nativo del sistema (oculto por CSS) por un
// cuadrado rojo de 4x4, dibujado en la capa superior (el canvas de clima, que ya
// se redibuja entero cada frame y va por encima de la escena).
export function drawCursorDot(ctx: CanvasRenderingContext2D, x: number, y: number): void {
  ctx.fillStyle = "#ff2020";
  ctx.fillRect(Math.round(x - 2), Math.round(y - 2), 4, 4);
}
