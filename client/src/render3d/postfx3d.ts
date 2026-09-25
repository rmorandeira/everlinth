// Post-proceso: escena → oclusión ambiental (GTAO: contacto entre edificios y suelo,
// esquinas, bajos de coches) → bloom suave → pase propio (tilt-shift de maqueta,
// aberración cromática, calor, color) → salida.
import * as THREE from "three";
import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";
import { RenderPass } from "three/addons/postprocessing/RenderPass.js";
import { ShaderPass } from "three/addons/postprocessing/ShaderPass.js";
import { UnrealBloomPass } from "three/addons/postprocessing/UnrealBloomPass.js";
import { OutputPass } from "three/addons/postprocessing/OutputPass.js";
import { GTAOPass } from "three/addons/postprocessing/GTAOPass.js";

// GTAO calcula la oclusión con un pase de normales/profundidad de toda la escena: los
// objetos translúcidos (edificios fantasma, marcas de pintura) no deben ocluir, y los
// sprites (etiquetas) tampoco.
class SceneAOPass extends GTAOPass {
  _overrideVisibility(): void {
    const cache = (this as unknown as { _visibilityCache: THREE.Object3D[] })._visibilityCache;
    this.scene.traverse((o) => {
      if (!o.visible) return;
      const mat = (o as THREE.Mesh).material as THREE.Material | undefined;
      if ((o as THREE.Sprite).isSprite || (o as THREE.Points).isPoints || (o as THREE.Line).isLine || (mat && !Array.isArray(mat) && mat.transparent)) {
        o.visible = false;
        cache.push(o);
      }
    });
  }
}

const MAX_ABERRATION_PX = 18; // separación máxima de canales rojo/azul, en píxeles de pantalla completa

const FxShader = {
  uniforms: {
    tDiffuse: { value: null as THREE.Texture | null },
    resolution: { value: new THREE.Vector2(1, 1) },
    time: { value: 0 },
    aberration: { value: 0 },
    heat: { value: 0 },
    tilt: { value: 1 },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform vec2 resolution;
    uniform float time;
    uniform float aberration;
    uniform float heat;
    uniform float tilt;
    varying vec2 vUv;
    void main() {
      vec2 uv = vUv;
      // Calor: franjas horizontales onduladas (mismas ondas que applyHeatShimmer en 2D).
      float yPx = uv.y * resolution.y;
      float wobble = sin(yPx * 0.05 + time * 3.0) * 3.5 + sin(yPx * 0.011 + time * 1.3) * 2.0;
      uv.x += heat * wobble / resolution.x;
      // Aberración: rojo hacia un lado, azul hacia el otro, verde centrado.
      float off = aberration * ${MAX_ABERRATION_PX.toFixed(1)} / resolution.x;
      // Tilt-shift de maqueta: franja nítida estrecha en el centro y desenfoque de
      // disco (16 muestras en espiral de ángulo áureo) que crece rápido hacia arriba
      // y hacia abajo, como el objetivo descentrado de una foto de miniatura.
      float d = abs(vUv.y - 0.5);
      float blur = pow(smoothstep(0.07, 0.46, d), 1.2) * tilt * 15.0 * (resolution.y / 900.0);
      vec3 acc = vec3(0.0);
      float wsum = 0.0;
      for (int i = 0; i < 16; i++) {
        float fi = float(i);
        float r = sqrt((fi + 0.5) / 16.0) * blur;
        float a = fi * 2.39996;
        vec2 o = vec2(cos(a), sin(a)) * r / resolution;
        float cr = texture2D(tDiffuse, uv + o + vec2(off, 0.0)).r;
        float cg = texture2D(tDiffuse, uv + o).g;
        float cb = texture2D(tDiffuse, uv + o - vec2(off, 0.0)).b;
        acc += vec3(cr, cg, cb);
        wsum += 1.0;
      }
      vec3 col = acc / wsum;
      // Colores de juguete: más saturación y contraste, viñeta.
      float lum = dot(col, vec3(0.299, 0.587, 0.114));
      col = mix(vec3(lum), col, 1.35);
      col = (col - 0.5) * 1.1 + 0.5;
      col *= 1.0 - 0.32 * smoothstep(0.45, 0.95, length(vUv - 0.5) * 1.3);
      vec4 g = vec4(col, 1.0);
      gl_FragColor = g;
    }
  `,
};

export interface PostFx3D {
  resize(width: number, height: number, pixelRatio: number): void;
  /** Renderiza la escena con todo el post-proceso. */
  render(scene: THREE.Scene, camera: THREE.Camera, time: number, aberration: number, heat: number): void;
}

export function createPostFx3D(renderer: THREE.WebGLRenderer): PostFx3D {
  let composer: EffectComposer | null = null;
  let renderPass: RenderPass | null = null;
  let fxPass: ShaderPass | null = null;
  let width = 1;
  let height = 1;
  let pixelRatio = 1;

  function ensureComposer(scene: THREE.Scene, camera: THREE.Camera): EffectComposer {
    if (!composer) {
      const target = new THREE.WebGLRenderTarget(width * pixelRatio, height * pixelRatio, { type: THREE.HalfFloatType, samples: 2 });
      composer = new EffectComposer(renderer, target);
      renderPass = new RenderPass(scene, camera);
      fxPass = new ShaderPass(FxShader);
      composer.addPass(renderPass);
      const ao = new SceneAOPass(scene, camera, width * pixelRatio, height * pixelRatio);
      ao.updateGtaoMaterial({ radius: 0.9, distanceExponent: 1.6, thickness: 2.0, scale: 1.3, samples: 12 });
      ao.updatePdMaterial({ lumaPhi: 10, depthPhi: 2, normalPhi: 3, radius: 6, rings: 2, samples: 12 });
      ao.blendIntensity = 1.0;
      composer.addPass(ao);
      composer.addPass(new UnrealBloomPass(new THREE.Vector2(width, height), 0.28, 0.6, 0.88));
      composer.addPass(fxPass);
      composer.addPass(new OutputPass());
      composer.setPixelRatio(pixelRatio);
      composer.setSize(width, height);
    }
    renderPass!.scene = scene;
    renderPass!.camera = camera;
    return composer;
  }

  function resize(w: number, h: number, pr: number): void {
    // Con el juego oculto (pantalla de login) el canvas mide 0: no se redimensiona a 0
    // (los render targets de 0 px dejan el framebuffer incompleto).
    if (w < 2 || h < 2) return;
    width = w;
    height = h;
    pixelRatio = pr;
    if (composer) {
      composer.setPixelRatio(pr);
      composer.setSize(w, h);
    }
  }

  function render(scene: THREE.Scene, camera: THREE.Camera, time: number, aberration: number, heat: number): void {
    if (width < 2 || height < 2) return;
    const c = ensureComposer(scene, camera);
    const u = fxPass!.uniforms;
    u.time.value = time;
    u.aberration.value = aberration;
    u.heat.value = heat;
    u.resolution.value.set(width * pixelRatio, height * pixelRatio);
    c.render();
  }

  return { resize, render };
}
