// "Niebla de visión": la zona central de juego (donde está la sala activa) queda
// nítida, y el terreno de las estancias vecinas que rellena la pantalla hacia el
// norte/sur/este/oeste se difumina progresivamente hasta el borde. Es un
// post-proceso sobre el frame ya compuesto (igual que
// applyHeatShimmer/applyDayNightOverlay), no toca cómo se genera el terreno.

const SHARP_FRACTION = 0.72; // fracción del radio elíptico que queda nítida: cuanto más alta, más pegada al borde queda la niebla
const RADIUS_JITTER = 0.035; // cuánto "respira" ese radio (fracción), no es un valor fijo
const BLUR_PX = 16; // radio de desenfoque base, ya escalado a tamaño real
const BLUR_JITTER = 6; // amplitud de la vibración del desenfoque
const DOWNSCALE = 4; // el paso de blur se hace a 1/DOWNSCALE de resolución (barato); el reescalado hacia arriba suaviza aún más

let smallCanvas: HTMLCanvasElement | null = null;
let smallCtx: CanvasRenderingContext2D | null = null;
let maskCanvas: HTMLCanvasElement | null = null;
let maskCtx: CanvasRenderingContext2D | null = null;
let fullCanvas: HTMLCanvasElement | null = null;
let fullCtx: CanvasRenderingContext2D | null = null;
let maskW = 0;
let maskH = 0;

// Dos frecuencias superpuestas (no un único seno) para que la vibración se vea
// orgánica y no como un pulso mecánico y predecible.
function organicJitter(time: number, speedA: number, speedB: number, phase: number): number {
  return Math.sin(time * speedA) * 0.7 + Math.sin(time * speedB + phase) * 0.3;
}

// Máscara elíptica (no rectangular): nítida en un óvalo centrado inscrito en la
// pantalla, difuminada del todo a partir de su radio — más natural que un marco
// recto, y ya cubre las esquinas sin necesidad de tratarlas aparte. Se redibuja
// cada frame con el radio "respirando" un poco, así el límite nítido/borroso
// tiembla en vez de ser una viñeta fija.
function drawMask(w: number, h: number, sharpFraction: number, ellipseScale: number): void {
  const ctx = maskCtx!;
  ctx.clearRect(0, 0, w, h);
  ctx.save();
  ctx.translate(w / 2, h / 2);
  // 1 unidad = borde de la elipse inscrita en la pantalla, multiplicado por
  // ellipseScale: <1 la encoge (niebla más agresiva, entra antes), >1 la agranda
  // (puede sacar la niebla fuera de la pantalla, dejando todo nítido).
  ctx.scale((w / 2) * ellipseScale, (h / 2) * ellipseScale);

  const gradient = ctx.createRadialGradient(0, 0, 0, 0, 0, 1);
  gradient.addColorStop(0, "rgba(255,255,255,0)");
  gradient.addColorStop(Math.max(0, Math.min(0.98, sharpFraction)), "rgba(255,255,255,0)");
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
  }
}

// Aplica el difuminado de bordes sobre `source` (el frame ya compuesto, con
// clima/transición/día-noche incluidos) y lo deja pintado en `ctx`.
export function applyEdgeBlur(
  ctx: CanvasRenderingContext2D,
  source: CanvasImageSource,
  width: number,
  height: number,
  time: number,
  sharpFractionBase: number = SHARP_FRACTION,
  vibration: number = 1,
  ellipseScale: number = 1
): void {
  if (width <= 0 || height <= 0) return;
  ensureBuffers(width, height);

  const sharpFraction = sharpFractionBase + organicJitter(time, 0.9, 2.6, 0.4) * RADIUS_JITTER * vibration;
  drawMask(width, height, sharpFraction, ellipseScale);

  const blurPx = Math.max(2, BLUR_PX + organicJitter(time, 2.2, 7.3, 1.7) * BLUR_JITTER * vibration);
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
