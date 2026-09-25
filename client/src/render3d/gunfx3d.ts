// Efectos de la ametralladora:
// - Fogonazo: destello aditivo en la boca del cañón + luz REAL de corta duración: un
//   foco (SpotLight) que alumbra hacia donde se dispara (calle, fachadas, coches…) y
//   una luz puntual cálida que ilumina el entorno inmediato del tirador.
// - Impacto: chispa y una luz puntual pequeña donde acaba la bala.
// - Humo: bocanadas que salen del cañón en la dirección del disparo, suben, se
//   ensanchan y se disipan; algo de polvo en el impacto.
// Las luces existen siempre (intensidad 0 en reposo) para que three.js no recompile
// los shaders cada vez que aparece o desaparece una luz.
import * as THREE from "three";

const FLASH_TIME = 0.05; // s que dura el fogonazo
const MUZZLE_H = 0.42; // altura de la boca del cañón (unidades de render)
const MAX_SMOKE = 90;

function radialTexture(inner: string, outer: string, noise: boolean): THREE.CanvasTexture {
  const S = 128;
  const c = document.createElement("canvas");
  c.width = c.height = S;
  const g = c.getContext("2d")!;
  const grd = g.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
  grd.addColorStop(0, inner);
  grd.addColorStop(1, outer);
  g.fillStyle = grd;
  g.fillRect(0, 0, S, S);
  if (noise) {
    // grumos para que el humo no sea una bola perfecta
    g.globalCompositeOperation = "destination-out";
    for (let i = 0; i < 40; i++) {
      const x = Math.random() * S;
      const y = Math.random() * S;
      const r = 6 + Math.random() * 18;
      const h = g.createRadialGradient(x, y, 0, x, y, r);
      h.addColorStop(0, "rgba(0,0,0,0.35)");
      h.addColorStop(1, "rgba(0,0,0,0)");
      g.fillStyle = h;
      g.fillRect(x - r, y - r, r * 2, r * 2);
    }
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

// Destello en estrella (cuatro puntas) para la boca del cañón.
function flashTexture(): THREE.CanvasTexture {
  const S = 128;
  const c = document.createElement("canvas");
  c.width = c.height = S;
  const g = c.getContext("2d")!;
  const grd = g.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
  grd.addColorStop(0, "rgba(255,250,220,1)");
  grd.addColorStop(0.25, "rgba(255,200,90,0.9)");
  grd.addColorStop(1, "rgba(255,120,20,0)");
  g.fillStyle = grd;
  g.fillRect(0, 0, S, S);
  g.globalCompositeOperation = "lighter";
  g.fillStyle = "rgba(255,230,160,0.8)";
  for (const a of [0, Math.PI / 2]) {
    g.save();
    g.translate(S / 2, S / 2);
    g.rotate(a);
    g.beginPath();
    g.moveTo(-S / 2, 0);
    g.lineTo(0, -5);
    g.lineTo(S / 2, 0);
    g.lineTo(0, 5);
    g.closePath();
    g.fill();
    g.restore();
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

interface Puff {
  sprite: THREE.Sprite;
  vx: number;
  vy: number;
  vz: number;
  age: number;
  life: number;
  size0: number;
  size1: number;
  alpha: number;
}

export interface GunFx {
  /** Disparo desde (x,z) hacia la dirección (dx,dz) unitaria, en unidades de render. */
  fire(x: number, z: number, dx: number, dz: number): void;
  /** Impacto de la bala en (x,z). */
  impact(x: number, z: number): void;
  update(dt: number): void;
}

export function createGunFx(scene: THREE.Scene): GunFx {
  // Foco hacia donde se dispara (alumbra calle y fachadas por delante del tirador).
  const spot = new THREE.SpotLight(0xffc27a, 0, 16, THREE.MathUtils.degToRad(38), 0.55, 1.6);
  scene.add(spot, spot.target);
  // Luz puntual cálida alrededor del tirador (suelo, paredes cercanas, el propio jugador).
  const muzzle = new THREE.PointLight(0xffb060, 0, 7, 1.8);
  scene.add(muzzle);
  // Chispa en el impacto.
  const hit = new THREE.PointLight(0xffd090, 0, 3.5, 2);
  scene.add(hit);

  const flashMat = new THREE.SpriteMaterial({ map: flashTexture(), blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, fog: false });
  const flash = new THREE.Sprite(flashMat);
  flash.visible = false;
  scene.add(flash);
  const sparkMat = new THREE.SpriteMaterial({ map: flashTexture(), blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, fog: false });
  const spark = new THREE.Sprite(sparkMat);
  spark.visible = false;
  scene.add(spark);

  const smokeTex = radialTexture("rgba(200,198,192,0.55)", "rgba(200,198,192,0)", true);
  const puffs: Puff[] = [];
  for (let i = 0; i < MAX_SMOKE; i++) {
    const mat = new THREE.SpriteMaterial({ map: smokeTex, transparent: true, depthWrite: false, opacity: 0, color: 0xcfcac2 });
    const s = new THREE.Sprite(mat);
    s.visible = false;
    scene.add(s);
    puffs.push({ sprite: s, vx: 0, vy: 0, vz: 0, age: 1, life: 1, size0: 0.2, size1: 1, alpha: 0 });
  }
  let nextPuff = 0;
  function emitSmoke(x: number, y: number, z: number, vx: number, vy: number, vz: number, life: number, size0: number, size1: number, alpha: number): void {
    const p = puffs[nextPuff];
    nextPuff = (nextPuff + 1) % puffs.length;
    p.sprite.position.set(x, y, z);
    p.sprite.material.rotation = Math.random() * Math.PI * 2;
    p.vx = vx;
    p.vy = vy;
    p.vz = vz;
    p.age = 0;
    p.life = life;
    p.size0 = size0;
    p.size1 = size1;
    p.alpha = alpha;
    p.sprite.visible = true;
  }

  let flashT = 0;
  let hitT = 0;
  let flashPower = 1;

  function fire(x: number, z: number, dx: number, dz: number): void {
    const mx = x + dx * 0.38;
    const mz = z + dz * 0.38;
    flashT = FLASH_TIME;
    flashPower = 0.75 + Math.random() * 0.5;
    flash.position.set(mx, MUZZLE_H, mz);
    flash.material.rotation = Math.random() * Math.PI;
    flash.visible = true;
    muzzle.position.set(mx, MUZZLE_H + 0.1, mz);
    spot.position.set(mx - dx * 0.3, MUZZLE_H + 0.35, mz - dz * 0.3);
    spot.target.position.set(x + dx * 8, 0, z + dz * 8);
    spot.target.updateMatrixWorld();
    // Humo: sale hacia delante, frena, sube y se ensancha.
    const n = Math.random() < 0.6 ? 1 : 2;
    for (let i = 0; i < n; i++) {
      const sp = 0.8 + Math.random() * 0.8;
      emitSmoke(mx + dx * 0.1, MUZZLE_H, mz + dz * 0.1, dx * sp + (Math.random() - 0.5) * 0.3, 0.25 + Math.random() * 0.2, dz * sp + (Math.random() - 0.5) * 0.3, 1.6 + Math.random() * 1.2, 0.18, 0.9 + Math.random() * 0.6, 0.5);
    }
  }

  function impact(x: number, z: number): void {
    hitT = FLASH_TIME * 1.4;
    hit.position.set(x, 0.3, z);
    spark.position.set(x, 0.25, z);
    spark.material.rotation = Math.random() * Math.PI;
    spark.visible = true;
    if (Math.random() < 0.5) emitSmoke(x, 0.15, z, (Math.random() - 0.5) * 0.2, 0.2, (Math.random() - 0.5) * 0.2, 1 + Math.random() * 0.6, 0.12, 0.6, 0.35);
  }

  function update(dt: number): void {
    flashT = Math.max(0, flashT - dt);
    const f = flashT / FLASH_TIME; // 1 → 0
    const k = f * f * flashPower;
    spot.intensity = 90 * k;
    muzzle.intensity = 25 * k;
    flash.visible = flashT > 0;
    flash.scale.setScalar(0.55 + 0.35 * f);
    flashMat.opacity = f;

    hitT = Math.max(0, hitT - dt);
    const h = hitT / (FLASH_TIME * 1.4);
    hit.intensity = 8 * h * h;
    spark.visible = hitT > 0;
    spark.scale.setScalar(0.25 + 0.2 * h);
    sparkMat.opacity = h;

    for (const p of puffs) {
      if (!p.sprite.visible) continue;
      p.age += dt;
      if (p.age >= p.life) {
        p.sprite.visible = false;
        continue;
      }
      const t = p.age / p.life;
      const drag = Math.exp(-2.5 * dt);
      p.vx *= drag;
      p.vz *= drag;
      p.vy = p.vy * Math.exp(-0.8 * dt) + 0.05 * dt; // sigue subiendo despacio
      p.sprite.position.x += p.vx * dt;
      p.sprite.position.y += p.vy * dt;
      p.sprite.position.z += p.vz * dt;
      p.sprite.scale.setScalar(p.size0 + (p.size1 - p.size0) * Math.sqrt(t));
      p.sprite.material.opacity = p.alpha * Math.min(1, t * 8) * (1 - t) * (1 - t);
    }
  }

  return { fire, impact, update };
}
