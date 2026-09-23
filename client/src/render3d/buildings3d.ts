// Ampliación de la Fase 1 (ver plan): edificios procedurales reales usando el
// SkyscraperGenerator real de three.js (examples/jsm/generators/city), no una
// caseta hecha a mano. No se le pasa material de nodo (TSL/WebGPU): sin
// material explícito cae a un MeshStandardMaterial normal (ver el propio
// SkyscraperGenerator.js), así que funciona tal cual sobre nuestro
// WebGLRenderer — aquí solo le damos un material propio con la paleta cálida
// del resto de la escena en vez del gris por defecto.
//
// Límite real del generador (no de nuestra elección): tiene mínimos
// arquitectónicos grabados a fuego (un "ladrillo" de 0.6×0.3, mínimo 3
// plantas, floorHeight mínimo 1.8 unidades, más la cornisa/arcada de base que
// sobresale del footprint pedido) — medido en vivo, no baja de ~6.66×6.66
// unidades de base × ~7.3 de alto por mucho que se le pida un footprint/
// totalHeight menor. Como eso no cabe de alto en una pantalla de 9 tiles,
// aquí se reescala la malla YA construida al tamaño real del hueco que
// worldgen.ts reservó, en vez de pelear con los mínimos internos.
import * as THREE from "three";
import { SkyscraperGenerator } from "three/addons/generators/city/SkyscraperGenerator.js";

const BUILDING_PALETTE = [0xf1e6d0, 0xd9c9a8, 0xc9b896, 0xe8d9c0];

function hash2(x: number, z: number): number {
  const h = Math.sin(x * 127.1 + z * 311.7) * 43758.5453;
  return h - Math.floor(h);
}

// Cada torre es una geometría única (seed propia, no comparte buffers como
// las demás variantes de obstáculo), así que hay que poder liberarla al
// cambiar de pantalla — ver disposeSkyscrapers(), llamado desde scene3d.ts.
const activeGenerators: SkyscraperGenerator[] = [];

// anchorX/anchorZ: esquina superior-izquierda del hueco reservado en
// worldgen (en unidades de mundo). footprintTiles: lado del hueco (tiles) —
// la malla se reescala para que su base quepa con un pequeño margen dentro
// de ese hueco, sea cual sea el tamaño mínimo que imponga el generador.
export function buildSkyscraper(anchorX: number, anchorZ: number, footprintTiles: number): THREE.Object3D {
  const n = hash2(anchorX + 0.33, anchorZ + 0.77);
  const seed = Math.floor(n * 1_000_000);
  const color = BUILDING_PALETTE[Math.floor(n * 97) % BUILDING_PALETTE.length];

  const generator = new SkyscraperGenerator(
    {
      seed,
      floorHeight: 1.8,
      totalHeight: 3,
      bayWidth: 1.8,
      pierWidth: 0.6,
      pierDepth: 0.4,
      chamferWidth: 0,
      setbackDepth: 0,
      footprint: { width: 3.6, depth: 3.6 }, // el mínimo del propio generador; el tamaño final lo decide el reescalado de abajo
    },
    new THREE.MeshStandardMaterial({ color, roughness: 0.85 })
  );
  activeGenerators.push(generator);
  const mesh = generator.build();

  mesh.geometry.computeBoundingBox();
  const bbox = mesh.geometry.boundingBox!;
  const actualWidth = Math.max(bbox.max.x - bbox.min.x, bbox.max.z - bbox.min.z);
  const targetWidth = footprintTiles * 0.85; // margen dentro del hueco reservado
  mesh.scale.setScalar(targetWidth / actualWidth);

  return mesh;
}

export function disposeSkyscrapers(): void {
  for (const g of activeGenerators) g.dispose();
  activeGenerators.length = 0;
}
