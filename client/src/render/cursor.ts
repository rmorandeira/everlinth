// Punto de mira: sustituye al cursor nativo del sistema (oculto por CSS) por un
// cuadrado rojo de 4x4, dibujado en la capa superior (el canvas de clima, que ya
// se redibuja entero cada frame y va por encima de la escena).
export function drawCursorDot(ctx: CanvasRenderingContext2D, x: number, y: number): void {
  ctx.fillStyle = "#ff2020";
  ctx.fillRect(Math.round(x - 2), Math.round(y - 2), 4, 4);
}
