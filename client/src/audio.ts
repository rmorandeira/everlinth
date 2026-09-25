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
    loadGun();
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

// ---- Ametralladora (Sounds/machinegun.mp3 → public/sounds/machinegun.mp3) ----
// La grabación es una ráfaga con un disparo cada ~85 ms (casi la cadencia del arma,
// GUN_FIRE_MS) seguida de la cola de eco. Cada disparo del juego reproduce uno de los
// golpes de la ráfaga (al azar), y al dejar de disparar suena la cola.
const GUN_SHOTS = [0.025, 0.105, 0.19, 0.28, 0.36]; // inicio de cada golpe (s)
const SHOT_LEN = 0.11;
const TAIL_START = 0.86;
let gun: AudioBuffer | null = null;
let gunLoading = false;

function loadGun(): void {
  if (!ctx || gun || gunLoading) return;
  gunLoading = true;
  const c = ctx;
  fetch("/sounds/machinegun.mp3")
    .then((r) => r.arrayBuffer())
    .then((ab) => c.decodeAudioData(ab))
    .then((buf) => {
      gun = buf;
    })
    .catch((e) => console.warn("Sonido de ametralladora no cargado:", e));
}

function playSlice(offset: number, dur: number, volume: number, rate: number, fadeIn: number, fadeOut: number): void {
  if (!ctx || !master || !gun) return;
  const src = ctx.createBufferSource();
  src.buffer = gun;
  src.playbackRate.value = rate;
  const g = ctx.createGain();
  const t = ctx.currentTime;
  const real = dur / rate;
  g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(volume, t + fadeIn);
  g.gain.setValueAtTime(volume, t + Math.max(fadeIn, real - fadeOut));
  g.gain.linearRampToValueAtTime(0, t + real);
  src.connect(g).connect(master);
  src.start(t, offset, dur);
}

// volume 0..1 (los disparos de otros jugadores, atenuados por distancia).
export function playGunshot(volume = 1): void {
  loadGun();
  const off = GUN_SHOTS[Math.floor(Math.random() * GUN_SHOTS.length)];
  playSlice(off, SHOT_LEN, volume, 0.96 + Math.random() * 0.08, 0.002, 0.03);
}

export function playGunTail(volume = 1): void {
  loadGun();
  if (!gun) return;
  playSlice(TAIL_START, gun.duration - TAIL_START, volume * 0.9, 1, 0.01, 0.35);
}

// ---- Risa (Sounds/laugh.mp3 → public/sounds/laugh.mp3), algo acelerada/aguda ----
let laugh: AudioBuffer | null = null;
let laughLoading = false;
export function playLaugh(volume = 1): void {
  if (!ctx || !master) return;
  if (!laugh) {
    if (!laughLoading) {
      laughLoading = true;
      const c = ctx;
      fetch("/sounds/laugh.mp3")
        .then((r) => {
          if (!r.ok) throw new Error(String(r.status));
          return r.arrayBuffer();
        })
        .then((ab) => c.decodeAudioData(ab))
        .then((buf) => {
          laugh = buf;
          playLaugh(volume);
        })
        .catch((e) => console.warn("Risa no cargada:", e));
    }
    return;
  }
  const src = ctx.createBufferSource();
  src.buffer = laugh;
  src.playbackRate.value = 1.3; // más rápida y más aguda
  const g = ctx.createGain();
  g.gain.value = volume;
  src.connect(g).connect(master);
  src.start();
}
