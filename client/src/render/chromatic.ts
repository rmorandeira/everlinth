// Aberración cromática de la escena del juego (nunca del HUD, que vive en DOM
// aparte). Separa el canal rojo hacia un lado y el azul hacia el otro; el verde
// se queda centrado. Se trabaja a resolución reducida (como en edgeblur.ts) para
// que el recorrido píxel a píxel sea barato.

const DOWNSCALE = 3;
const MAX_OFFSET_PX = 6; // desplazamiento máximo, ya a la resolución reducida

let smallCanvas: HTMLCanvasElement | null = null;
let smallCtx: CanvasRenderingContext2D | null = null;
let outCanvas: HTMLCanvasElement | null = null;
let outCtx: CanvasRenderingContext2D | null = null;

function ensureBuffers(sw: number, sh: number): void {
  if (!smallCanvas) {
    smallCanvas = document.createElement("canvas");
    smallCtx = smallCanvas.getContext("2d", { willReadFrequently: true });
  }
  if (!outCanvas) {
    outCanvas = document.createElement("canvas");
    outCtx = outCanvas.getContext("2d");
  }
  if (smallCanvas.width !== sw || smallCanvas.height !== sh) {
    smallCanvas.width = sw;
    smallCanvas.height = sh;
    outCanvas.width = sw;
    outCanvas.height = sh;
  }
}

// Aplica el efecto sobre `source` (la escena ya compuesta) y deja el resultado
// pintado en `ctx`. Si `amount` es ~0 no hace nada (deja `ctx` tal cual estaba).
export function applyChromaticAberration(
  ctx: CanvasRenderingContext2D,
  source: CanvasImageSource,
  width: number,
  height: number,
  amount: number
): void {
  if (amount <= 0.005 || width <= 0 || height <= 0) return;

  const sw = Math.max(1, Math.round(width / DOWNSCALE));
  const sh = Math.max(1, Math.round(height / DOWNSCALE));
  ensureBuffers(sw, sh);

  smallCtx!.clearRect(0, 0, sw, sh);
  smallCtx!.drawImage(source, 0, 0, sw, sh);
  const src = smallCtx!.getImageData(0, 0, sw, sh);
  const out = outCtx!.createImageData(sw, sh);
  const sd = src.data;
  const od = out.data;

  const offset = Math.round(Math.min(1, amount) * MAX_OFFSET_PX);
  if (offset <= 0) return;

  for (let y = 0; y < sh; y++) {
    const row = y * sw;
    for (let x = 0; x < sw; x++) {
      const di = (row + x) * 4;
      const rx = x + offset < sw ? x + offset : sw - 1;
      const bx = x - offset >= 0 ? x - offset : 0;
      const ri = (row + rx) * 4;
      const bi = (row + bx) * 4;
      od[di] = sd[ri]; // rojo desplazado a un lado
      od[di + 1] = sd[di + 1]; // verde centrado
      od[di + 2] = sd[bi + 2]; // azul desplazado al otro lado
      od[di + 3] = sd[di + 3];
    }
  }

  outCtx!.putImageData(out, 0, 0);
  ctx.clearRect(0, 0, width, height);
  ctx.drawImage(outCanvas!, 0, 0, width, height);
}
