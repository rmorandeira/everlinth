// Fase 4 de la migración a 3D (ver plan): sustituye los tres post-procesos de
// canvas 2D (daynight.ts, edgeblur.ts, flashlight.ts) por iluminación e
// niebla REALES de three.js, en vez de overlays de píxeles sobre el frame ya
// compuesto.
//
// - Día/noche: reutiliza getDayNight() de render/daynight.ts (lógica pura,
//   sin canvas, basada en la hora real) pero en vez de pintar un rectángulo
//   semitransparente encima, anima el color/intensidad de luces reales
//   (THREE.DirectionalLight = sol, THREE.AmbientLight) y el color del cielo.
// - Niebla de visión: en 2D hacía falta una máscara elíptica + blur porque el
//   "centro nítido" era la posición en PANTALLA del jugador, que no siempre
//   coincidía con el centro del canvas. En 3D la cámara ya recentra sobre el
//   jugador cada frame (ver isoCamera.ts), así que "niebla por distancia a la
//   cámara" (THREE.Fog, de serie en three.js) YA es "niebla por distancia al
//   jugador" — no hace falta reproyectar nada. Los mismos ajustes del
//   backoffice (VisionFogSettings) se re-mapean a near/far.
// - Linterna: THREE.SpotLight real, con destino calculado con un raycast del
//   cursor contra el plano de suelo (y=0) en vez de un cono de gradiente 2D.
import * as THREE from "three";
import type { VisionFogSettings } from "@roi/shared";
import { getDayNight } from "../render/daynight.js";
import { ISO_CAMERA_DIST } from "./isoCamera.js";

// Dos frecuencias superpuestas (no un único seno), igual que organicJitter en
// edgeblur.ts, para que la niebla "respire" de forma orgánica y no como un
// pulso mecánico predecible.
function organicJitter(time: number, speedA: number, speedB: number, phase: number): number {
  return Math.sin(time * speedA) * 0.7 + Math.sin(time * speedB + phase) * 0.3;
}

const DAY_SKY = new THREE.Color(0x8fc7e8);
const NIGHT_SKY = new THREE.Color(0x05070f);
const GLOW_TINT = new THREE.Color(0xff8c3c);
const NIGHT_AMBIENT = new THREE.Color(0x33406b);
const GLOW_SUN = new THREE.Color(0xffb066);
const WHITE = new THREE.Color(0xffffff);

const FOG_RADIUS = 40; // = VIEW_HALF_HEIGHT en scene3d.ts: cuánto mundo es "visible" antes de la niebla

export interface FlashlightParams {
  enabled: boolean;
  cursorNdcX: number;
  cursorNdcY: number;
}

export interface Lighting3D {
  update(
    playerX: number,
    playerZ: number,
    time: number,
    vision: VisionFogSettings,
    flashlight: FlashlightParams,
    camera: THREE.Camera
  ): void;
}

export function createLighting3D(scene: THREE.Scene): Lighting3D {
  const sun = new THREE.DirectionalLight(0xffffff, 1.4);
  sun.position.set(6, 12, 4);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  const sc = sun.shadow.camera;
  sc.left = -20;
  sc.right = 20;
  sc.top = 20;
  sc.bottom = -20;
  sc.near = 1;
  sc.far = 60;
  sc.updateProjectionMatrix();
  sun.shadow.bias = -0.0005;
  sun.shadow.normalBias = 0.03;
  scene.add(sun);
  scene.add(sun.target);

  // Luz de relleno de cielo (azulada desde arriba, cálida rebotada desde el suelo):
  // las zonas en sombra no se quedan planas ni negras.
  const ambient = new THREE.HemisphereLight(0xdfe9ff, 0x9a8a74, 0.9);
  scene.add(ambient);

  const bgColor = DAY_SKY.clone();
  scene.background = bgColor;
  // THREE.Fog mide la distancia a lo largo del eje de visión de la CÁMARA, no
  // al jugador — y la cámara isométrica está siempre a ISO_CAMERA_DIST del
  // jugador (ver isoCamera.ts), así que near/far hay que centrarlos ahí, no
  // en 0 (si no, con la cámara a 50 unidades, todo el mundo visible cae
  // "más allá" de un far pensado para un radio de ~9 y sale niebla sólida).
  const fog = new THREE.Fog(DAY_SKY.getHex(), ISO_CAMERA_DIST, ISO_CAMERA_DIST + FOG_RADIUS);
  scene.fog = fog;

  const flashlight = new THREE.SpotLight(0xffe6b3, 0, 9, THREE.MathUtils.degToRad(26), 0.35, 0.9);
  scene.add(flashlight);
  scene.add(flashlight.target);

  const raycaster = new THREE.Raycaster();
  const groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  const ndc = new THREE.Vector2();
  const hitPoint = new THREE.Vector3();
  const skyMix = new THREE.Color();

  function update(
    playerX: number,
    playerZ: number,
    time: number,
    vision: VisionFogSettings,
    fl: FlashlightParams,
    camera: THREE.Camera
  ): void {
    const dn = getDayNight();
    // Sol alto (~70°): en una ciudad de rascacielos un sol bajo deja casi todo en sombra.
    sun.position.set(playerX - 5, 24, playerZ + 7);
    sun.target.position.set(playerX, 0, playerZ);
    sun.target.updateMatrixWorld();

    skyMix.copy(NIGHT_SKY).lerp(DAY_SKY, 1 - dn.darkness);
    if (dn.glow > 0.01) skyMix.lerp(GLOW_TINT, dn.glow * 0.35);
    bgColor.copy(skyMix);
    fog.color.copy(skyMix);

    ambient.intensity = THREE.MathUtils.lerp(1.05, 0.2, dn.darkness);
    ambient.color.copy(WHITE).lerp(NIGHT_AMBIENT, dn.darkness);
    sun.intensity = THREE.MathUtils.lerp(1.9, 0.25, dn.darkness);
    sun.color.copy(WHITE).lerp(GLOW_SUN, dn.glow);

    // Mismos ajustes del backoffice que en 2D, remapeados a near/far
    // alrededor de ISO_CAMERA_DIST (ver comentario junto al new THREE.Fog):
    // el lado hacia la cámara siempre queda nítido (no aporta nada difuminar
    // ahí), y sharpFraction/blurStrength deciden cuánto tarda en difuminarse
    // el lado de la escena que se aleja de la cámara. vibration anima ambos
    // con la misma onda orgánica que usaba edgeblur.ts.
    const radius = FOG_RADIUS * vision.ellipseScale;
    const jitter = organicJitter(time, 0.9, 2.6, 0.4) * vision.vibration;
    const near = ISO_CAMERA_DIST + radius * 0.15 * (1 + jitter * 0.06);
    const far = ISO_CAMERA_DIST + radius * (0.7 + vision.sharpFraction) * Math.max(0.3, vision.blurStrength) * (1 + jitter * 0.1);
    fog.near = near;
    fog.far = far;

    flashlight.visible = fl.enabled;
    if (fl.enabled) {
      ndc.set(fl.cursorNdcX, fl.cursorNdcY);
      raycaster.setFromCamera(ndc, camera);
      flashlight.position.set(playerX, 0.5, playerZ);
      if (raycaster.ray.intersectPlane(groundPlane, hitPoint)) {
        flashlight.target.position.copy(hitPoint);
      } else {
        flashlight.target.position.set(playerX, 0, playerZ);
      }
      flashlight.target.updateMatrixWorld();
      flashlight.intensity = 0.9 + dn.darkness * 5;
    }
  }

  return { update };
}
