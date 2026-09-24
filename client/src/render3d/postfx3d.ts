// Fase 6 (ver plan): aberración cromática y calor como post-proceso real
// (EffectComposer + un ShaderPass propio) en vez de recorrer píxeles en un
// canvas 2D. Solo se usa el composer cuando algún efecto está activo — con
// ambos a 0 se renderiza directo, así se conserva el antialiasing nativo y no
// se paga el coste de los render targets intermedios.
import * as THREE from "three";
import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";
import { RenderPass } from "three/addons/postprocessing/RenderPass.js";
import { ShaderPass } from "three/addons/postprocessing/ShaderPass.js";
import { UnrealBloomPass } from "three/addons/postprocessing/UnrealBloomPass.js";
import { OutputPass } from "three/addons/postprocessing/OutputPass.js";

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
      // Tilt-shift: banda nítida en el centro; el desenfoque crece con la distancia vertical.
      float blur = smoothstep(0.18, 0.5, abs(vUv.y - 0.5)) * tilt * 3.5;
      vec2 px = blur / resolution;
      vec3 acc = vec3(0.0);
      float wsum = 0.0;
      for (int i = -4; i <= 4; i++) {
        float w = exp(-float(i * i) * 0.12);
        vec2 o = vec2(float(i) * px.x, float(i) * px.y * 0.6);
        float r = texture2D(tDiffuse, uv + o + vec2(off, 0.0)).r;
        float g = texture2D(tDiffuse, uv + o).g;
        float b = texture2D(tDiffuse, uv + o - vec2(off, 0.0)).b;
        acc += vec3(r, g, b) * w;
        wsum += w;
      }
      vec3 col = acc / wsum;
      // Viñeta suave y algo más de saturación (look diorama).
      float lum = dot(col, vec3(0.299, 0.587, 0.114));
      col = mix(vec3(lum), col, 1.15);
      col *= 1.0 - 0.28 * smoothstep(0.45, 0.95, length(vUv - 0.5) * 1.3);
      vec4 g = vec4(col, 1.0);
      gl_FragColor = g;
    }
  `,
};

export interface PostFx3D {
  resize(width: number, height: number, pixelRatio: number): void;
  /** Renderiza la escena; usa el composer solo si aberration o heat > 0. */
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
      const target = new THREE.WebGLRenderTarget(width * pixelRatio, height * pixelRatio, { type: THREE.HalfFloatType, samples: 4 });
      composer = new EffectComposer(renderer, target);
      renderPass = new RenderPass(scene, camera);
      fxPass = new ShaderPass(FxShader);
      composer.addPass(renderPass);
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
    width = w;
    height = h;
    pixelRatio = pr;
    if (composer) {
      composer.setPixelRatio(pr);
      composer.setSize(w, h);
    }
  }

  function render(scene: THREE.Scene, camera: THREE.Camera, time: number, aberration: number, heat: number): void {
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
