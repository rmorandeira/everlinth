// Sonido del juego (Web Audio). Pasos: varios recortes cortos de una misma grabación
// (ver tools/sounds/split-steps.mjs); en cada pisada suena uno al azar, sin repetir el
// anterior, con pequeñas variaciones de tono y volumen para que no suene a bucle.
// El AudioContext solo puede arrancar tras un gesto del usuario (el propio login).

const STEP_FILES = Array.from({ length: 8 }, (_, i) => `/sounds/step-${i + 1}.wav`);

let ctx: AudioContext | null = null;
let master: GainNode | null = null;
const steps: AudioBuffer[] = [];
let lastStep = -1;

async function loadAll(): Promise<void> {
  if (!ctx) return;
  const c = ctx;
  await Promise.all(
    STEP_FILES.map(async (url) => {
      try {
        const res = await fetch(url);
        steps.push(await c.decodeAudioData(await res.arrayBuffer()));
      } catch (e) {
        console.warn("Sonido no cargado:", url, e);
      }
    })
  );
}

// Llamar desde un gesto del usuario (click/tecla): crea o reanuda el contexto.
export function unlockAudio(): void {
  if (!ctx) {
    ctx = new AudioContext();
    master = ctx.createGain();
    master.gain.value = 0.8;
    master.connect(ctx.destination);
    void loadAll();
  } else if (ctx.state === "suspended") {
    void ctx.resume();
  }
}

export function playStep(volume = 1): void {
  if (!ctx || !master || steps.length === 0) return;
  let i = Math.floor(Math.random() * steps.length);
  if (i === lastStep && steps.length > 1) i = (i + 1) % steps.length;
  lastStep = i;
  const src = ctx.createBufferSource();
  src.buffer = steps[i];
  src.playbackRate.value = 1.1 + Math.random() * 0.16; // algo acelerado: suena a carrera
  const g = ctx.createGain();
  g.gain.value = volume * (0.75 + Math.random() * 0.25);
  src.connect(g).connect(master);
  src.start();
}
