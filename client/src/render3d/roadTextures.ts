// Texturas procedurales de la calzada (canvas 2D → CanvasTexture), sin archivos:
// - asfalto: árido fino, parches de reasfaltado, grietas y desgaste en las rodadas;
// - mancha de aceite, marcas de frenada;
// - rotulado sobre el asfalto: "STOP", flecha recta y flecha de giro a la izquierda.
// Las de rotulado se dibujan con la "parte de arriba" del canvas en la dirección de
// la marcha (ver city3d.ts: así el conductor que llega las lee de frente).
import * as THREE from "three";

function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function canvas(w: number, h: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  return [c, c.getContext("2d")!];
}

function toTexture(c: HTMLCanvasElement, repeat: boolean): THREE.CanvasTexture {
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}

let asphalt: THREE.CanvasTexture | null = null;
// Asfalto que se repite sin costuras (lo que sale por un borde entra por el opuesto).
export function asphaltTexture(): THREE.CanvasTexture {
  if (asphalt) return asphalt;
  const S = 512;
  const [c, g] = canvas(S, S);
  const r = rng(7);
  g.fillStyle = "#5d6066";
  g.fillRect(0, 0, S, S);
  const wrap = (fn: (ox: number, oy: number) => void): void => {
    for (const ox of [-S, 0, S]) for (const oy of [-S, 0, S]) fn(ox, oy);
  };
  // Manchas grandes de tono (asfalto viejo/nuevo, parches rectangulares).
  for (let i = 0; i < 26; i++) {
    const x = r() * S;
    const y = r() * S;
    const rad = 30 + r() * 110;
    const dark = r() < 0.55;
    const alpha = 0.05 + r() * 0.09;
    wrap((ox, oy) => {
      const grd = g.createRadialGradient(x + ox, y + oy, 0, x + ox, y + oy, rad);
      grd.addColorStop(0, dark ? `rgba(20,21,24,${alpha})` : `rgba(120,120,118,${alpha})`);
      grd.addColorStop(1, "rgba(0,0,0,0)");
      g.fillStyle = grd;
      g.fillRect(x + ox - rad, y + oy - rad, rad * 2, rad * 2);
    });
  }
  for (let i = 0; i < 3; i++) {
    const x = r() * S;
    const y = r() * S;
    const w = 60 + r() * 120;
    const h = 40 + r() * 90;
    const tone = r() < 0.5 ? "rgba(28,30,33,0.35)" : "rgba(95,96,98,0.22)";
    wrap((ox, oy) => {
      g.fillStyle = tone;
      g.fillRect(x + ox, y + oy, w, h);
      g.strokeStyle = "rgba(15,15,17,0.45)";
      g.lineWidth = 1.5;
      g.strokeRect(x + ox, y + oy, w, h);
    });
  }
  // Zonas descoloridas por el sol y el tráfico (más claras y algo más cálidas).
  for (let i = 0; i < 10; i++) {
    const x = r() * S;
    const y = r() * S;
    const rad = 50 + r() * 120;
    const alpha = 0.06 + r() * 0.08;
    wrap((ox, oy) => {
      const grd = g.createRadialGradient(x + ox, y + oy, 0, x + ox, y + oy, rad);
      grd.addColorStop(0, `rgba(170,165,152,${alpha})`);
      grd.addColorStop(1, "rgba(0,0,0,0)");
      g.fillStyle = grd;
      g.fillRect(x + ox - rad, y + oy - rad, rad * 2, rad * 2);
    });
  }
  // Árido: ruido fino por píxel y "puntos de claridad" (piedrecitas claras que
  // asoman al gastarse el betún), más algún punto oscuro.
  const img = g.getImageData(0, 0, S, S);
  const d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    const n = (r() - 0.5) * 30;
    const q = r();
    const speck = q < 0.045 ? 45 + r() * 60 : q < 0.075 ? -30 - r() * 15 : 0;
    for (let k = 0; k < 3; k++) d[i + k] = Math.max(0, Math.min(255, d[i + k] + n + speck));
  }
  g.putImageData(img, 0, 0);
  // Piedras claras algo mayores (2-3 px).
  for (let i = 0; i < 900; i++) {
    const x = r() * S;
    const y = r() * S;
    g.fillStyle = `rgba(${200 + r() * 40},${196 + r() * 40},${185 + r() * 40},${0.35 + r() * 0.4})`;
    g.beginPath();
    g.arc(x, y, 0.8 + r() * 1.3, 0, Math.PI * 2);
    g.fill();
  }
  // Grietas: polilíneas finas y quebradas, algunas ramificadas.
  g.lineCap = "round";
  for (let i = 0; i < 9; i++) {
    let x = r() * S;
    let y = r() * S;
    let ang = r() * Math.PI * 2;
    const steps = 8 + Math.floor(r() * 18);
    const pts: Array<[number, number]> = [[x, y]];
    for (let k = 0; k < steps; k++) {
      ang += (r() - 0.5) * 1.2;
      x += Math.cos(ang) * (5 + r() * 9);
      y += Math.sin(ang) * (5 + r() * 9);
      pts.push([x, y]);
    }
    wrap((ox, oy) => {
      g.strokeStyle = "rgba(14,14,16,0.75)";
      g.lineWidth = 1 + r() * 0.8;
      g.beginPath();
      pts.forEach(([px, py], k) => (k === 0 ? g.moveTo(px + ox, py + oy) : g.lineTo(px + ox, py + oy)));
      g.stroke();
    });
  }
  asphalt = toTexture(c, true);
  return asphalt;
}

let oil: THREE.CanvasTexture | null = null;
// Mancha de aceite: núcleo oscuro irregular con bordes difusos y algún goteo.
export function oilTexture(): THREE.CanvasTexture {
  if (oil) return oil;
  const S = 128;
  const [c, g] = canvas(S, S);
  const r = rng(11);
  for (let i = 0; i < 14; i++) {
    const x = S / 2 + (r() - 0.5) * 44;
    const y = S / 2 + (r() - 0.5) * 30;
    const rad = 10 + r() * 26;
    const grd = g.createRadialGradient(x, y, 0, x, y, rad);
    grd.addColorStop(0, `rgba(8,8,10,${0.28 + r() * 0.2})`);
    grd.addColorStop(0.6, "rgba(10,10,12,0.12)");
    grd.addColorStop(1, "rgba(0,0,0,0)");
    g.fillStyle = grd;
    g.fillRect(0, 0, S, S);
  }
  for (let i = 0; i < 6; i++) {
    g.fillStyle = "rgba(6,6,8,0.4)";
    g.beginPath();
    g.arc(S / 2 + (r() - 0.5) * 90, S / 2 + (r() - 0.5) * 70, 1.5 + r() * 3, 0, Math.PI * 2);
    g.fill();
  }
  oil = toTexture(c, false);
  return oil;
}

let skid: THREE.CanvasTexture | null = null;
// Frenada: dos huellas paralelas de neumático (a lo largo de u), más negras donde se
// bloquearon las ruedas y desvaneciéndose al principio.
export function skidTexture(): THREE.CanvasTexture {
  if (skid) return skid;
  const W = 256;
  const H = 64;
  const [c, g] = canvas(W, H);
  const r = rng(23);
  for (const cy of [16, 48]) {
    for (let x = 0; x < W; x++) {
      const t = x / W;
      const a = Math.min(1, t * 3) * (0.55 + 0.35 * Math.sin(t * 9 + cy)) * (1 - Math.max(0, t - 0.92) * 12);
      const wob = Math.sin(t * 5 + cy) * 2;
      for (let k = -5; k <= 5; k++) {
        if (r() < 0.25) continue;
        g.fillStyle = `rgba(10,10,10,${Math.max(0, a * (1 - Math.abs(k) / 6) * 0.8)})`;
        g.fillRect(x, cy + wob + k, 1, 1);
      }
    }
  }
  skid = toTexture(c, false);
  return skid;
}

const PAINT = "#ecebe4";

let worn: THREE.CanvasTexture | null = null;
// Desgaste de la pintura vial: blanco opaco con desconchones y zonas más finas (alfa),
// repetible. Se aplica con UV de mundo, así cada marca tiene su propio desgaste.
export function wornPaintTexture(): THREE.CanvasTexture {
  if (worn) return worn;
  const S = 256;
  const [c, g] = canvas(S, S);
  const r = rng(41);
  g.fillStyle = "#ffffff";
  g.fillRect(0, 0, S, S);
  const img = g.getImageData(0, 0, S, S);
  const d = img.data;
  // base: opacidad alta con ruido
  for (let i = 0; i < d.length; i += 4) d[i + 3] = 215 + r() * 40;
  g.putImageData(img, 0, 0);
  g.globalCompositeOperation = "destination-out";
  for (let i = 0; i < 70; i++) {
    const x = r() * S;
    const y = r() * S;
    const rad = 3 + r() * 16;
    const a = 0.25 + r() * 0.6;
    for (const ox of [-S, 0, S]) {
      for (const oy of [-S, 0, S]) {
        const grd = g.createRadialGradient(x + ox, y + oy, 0, x + ox, y + oy, rad);
        grd.addColorStop(0, `rgba(0,0,0,${a})`);
        grd.addColorStop(1, "rgba(0,0,0,0)");
        g.fillStyle = grd;
        g.fillRect(x + ox - rad, y + oy - rad, rad * 2, rad * 2);
      }
    }
  }
  for (let i = 0; i < 1800; i++) {
    g.fillStyle = `rgba(0,0,0,${0.5 + r() * 0.5})`;
    g.fillRect(r() * S, r() * S, 1 + r() * 2, 1 + r() * 2);
  }
  g.globalCompositeOperation = "source-over";
  worn = toTexture(c, true);
  return worn;
}

let stop: THREE.CanvasTexture | null = null;
// "STOP" alargado (así se pinta de verdad: muy estirado en la dirección de la marcha
// para que se lea bien desde el coche). Arriba del canvas = sentido de la marcha.
export function stopTexture(): THREE.CanvasTexture {
  if (stop) return stop;
  const [c, g] = canvas(512, 1024);
  const r = rng(5);
  g.fillStyle = PAINT;
  g.textAlign = "center";
  g.textBaseline = "middle";
  g.font = "900 250px 'Arial Black', Arial, Helvetica, sans-serif";
  g.save();
  g.translate(256, 512);
  g.scale(0.98, 2.9);
  g.fillText("STOP", 0, 0);
  g.restore();
  // desgaste: desconchones donde pisan las ruedas
  g.globalCompositeOperation = "destination-out";
  for (let i = 0; i < 900; i++) {
    g.fillStyle = `rgba(0,0,0,${0.3 + r() * 0.6})`;
    g.beginPath();
    g.arc(r() * 512, r() * 1024, 1 + r() * 5, 0, Math.PI * 2);
    g.fill();
  }
  g.globalCompositeOperation = "source-over";
  stop = toTexture(c, false);
  stop.anisotropy = 8;
  return stop;
}

function arrowShaft(g: CanvasRenderingContext2D): void {
  g.fillRect(52, 190, 24, 130);
}

let arrowStraight: THREE.CanvasTexture | null = null;
export function arrowStraightTexture(): THREE.CanvasTexture {
  if (arrowStraight) return arrowStraight;
  const [c, g] = canvas(128, 320);
  g.fillStyle = PAINT;
  arrowShaft(g);
  g.fillRect(52, 60, 24, 140);
  g.beginPath();
  g.moveTo(64, 0);
  g.lineTo(110, 80);
  g.lineTo(18, 80);
  g.closePath();
  g.fill();
  arrowStraight = toTexture(c, false);
  return arrowStraight;
}

let arrowLeft: THREE.CanvasTexture | null = null;
// Giro a la izquierda: vástago recto que se curva hacia la izquierda del canvas.
export function arrowLeftTexture(): THREE.CanvasTexture {
  if (arrowLeft) return arrowLeft;
  const [c, g] = canvas(128, 320);
  g.fillStyle = PAINT;
  arrowShaft(g);
  g.strokeStyle = PAINT;
  g.lineWidth = 24;
  g.beginPath();
  g.moveTo(64, 200);
  g.lineTo(64, 140);
  g.quadraticCurveTo(64, 100, 34, 100);
  g.stroke();
  g.beginPath();
  g.moveTo(0, 100);
  g.lineTo(42, 62);
  g.lineTo(42, 138);
  g.closePath();
  g.fill();
  arrowLeft = toTexture(c, false);
  return arrowLeft;
}
