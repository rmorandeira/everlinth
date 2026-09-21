// "Niebla de visión": la zona central de juego (donde está la sala activa) queda
// nítida, y el terreno de las estancias vecinas que rellena la pantalla hacia el
// norte/sur/este/oeste se difumina progresivamente hasta el borde. Es un
// post-proceso sobre el frame ya compuesto (igual que
// applyHeatShimmer/applyDayNightOverlay), no toca cómo se genera el terreno.

const SHARP_FRACTION = 0.5; // fracción del radio elíptico que queda 100% nítida
const BLUR_PX = 14; // radio de desenfoque ya escalado a tamaño real
const DOWNSCALE = 4; // el paso de blur se hace a 1/DOWNSCALE de resolución (barato); el reescalado hacia arriba suaviza aún más

let smallCanvas: HTMLCanvasElement | null = null;
let smallCtx: CanvasRenderingContext2D | null = null;
let maskCanvas: HTMLCanvasElement | null = null;
let maskCtx: CanvasRenderingContext2D | null = null;
let fullCanvas: HTMLCanvasElement | null = null;
let fullCtx: CanvasRenderingContext2D | null = null;
let maskW = 0;
let maskH = 0;

// Máscara elíptica (no rectangular): nítida en un óvalo centrado inscrito en la
// pantalla, difuminada del todo a partir de su borde — más natural que un marco
// recto, y ya cubre las esquinas sin necesidad de tratarlas aparte.
function drawMask(w: number, h: number): void {
  const ctx = maskCtx!;
  ctx.clearRect(0, 0, w, h);
  ctx.save();
  ctx.translate(w / 2, h / 2);
  ctx.scale(w / 2, h / 2); // 1 unidad = borde de la elipse inscrita en la pantalla

  const gradient = ctx.createRadialGradient(0, 0, 0, 0, 0, 1);
  gradient.addColorStop(0, "rgba(255,255,255,0)");
  gradient.addColorStop(SHARP_FRACTION, "rgba(255,255,255,0)");
  gradient.addColorStop(1, "rgba(255,255,255,1)");
  ctx.fillStyle = gradient;
  ctx.fillRect(-1, -1, 2, 2);
  ctx.restore();
}

function ensureBuffers(w: number, h: number): void {
  if (!smallCanvas) {
    smallCanvas = document.createElement("canvas");
    smallCtx = smallCanvas.getContext("2d");
  }
  if (!maskCanvas) {
    maskCanvas = document.createElement("canvas");
    maskCtx = maskCanvas.getContext("2d");
  }
  if (!fullCanvas) {
    fullCanvas = document.createElement("canvas");
    fullCtx = fullCanvas.getContext("2d");
  }

  const sw = Math.max(1, Math.round(w / DOWNSCALE));
  const sh = Math.max(1, Math.round(h / DOWNSCALE));
  if (smallCanvas.width !== sw || smallCanvas.height !== sh) {
    smallCanvas.width = sw;
    smallCanvas.height = sh;
  }
  if (fullCanvas.width !== w || fullCanvas.height !== h) {
    fullCanvas.width = w;
    fullCanvas.height = h;
  }
  if (maskW !== w || maskH !== h) {
    maskCanvas.width = w;
    maskCanvas.height = h;
    maskW = w;
    maskH = h;
    drawMask(w, h);
  }
}

// Pequeña vibración orgánica del desenfoque (dos frecuencias superpuestas, no un
// único seno) para que el borde no se vea como una viñeta estática de foto.
function blurJitter(time: number): number {
  return Math.sin(time * 2.2) * 2 + Math.sin(time * 7.3 + 1.7) * 0.8;
}

// Aplica el difuminado de bordes sobre `source` (el frame ya compuesto, con
// clima/transición/día-noche incluidos) y lo deja pintado en `ctx`.
export function applyEdgeBlur(
  ctx: CanvasRenderingContext2D,
  source: CanvasImageSource,
  width: number,
  height: number,
  time: number
): void {
  if (width <= 0 || height <= 0) return;
  ensureBuffers(width, height);

  const blurPx = Math.max(2, BLUR_PX + blurJitter(time));
  smallCtx!.clearRect(0, 0, smallCanvas!.width, smallCanvas!.height);
  smallCtx!.filter = `blur(${blurPx / DOWNSCALE}px)`;
  smallCtx!.drawImage(source, 0, 0, smallCanvas!.width, smallCanvas!.height);
  smallCtx!.filter = "none";

  fullCtx!.clearRect(0, 0, width, height);
  fullCtx!.drawImage(smallCanvas!, 0, 0, width, height);
  fullCtx!.globalCompositeOperation = "destination-in";
  fullCtx!.drawImage(maskCanvas!, 0, 0);
  fullCtx!.globalCompositeOperation = "source-over";

  ctx.drawImage(fullCanvas!, 0, 0);
}
