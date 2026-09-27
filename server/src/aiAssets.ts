// Generación de assets con IA (Claude, API de Anthropic): a partir de una descripción
// (y, si se pega, una imagen de referencia) Claude compone el asset con las primitivas
// del editor (caja, cilindro, cono, esfera, tejado a dos aguas, pirámide). Se le obliga
// a responder con la herramienta `crear_asset` (JSON con esquema), se valida todo lo que
// devuelve y se guarda en el catálogo como cualquier asset de primitivas.
// La clave va en server/.env (ANTHROPIC_API_KEY); el modelo, en ANTHROPIC_MODEL.
import { randomUUID } from "node:crypto";
import { ASSET_CATEGORIES, BIOME_IDS, SOCKET_TYPES, type AssetDef, type AssetSocket, type BiomeId, type PrimitiveKind, type PrimitivePart } from "@roi/shared";

const API_URL = process.env.ANTHROPIC_API_URL?.trim() || "https://api.anthropic.com/v1/messages"; // (pruebas: servidor simulado)
const DEFAULT_MODEL = "claude-opus-5-5";
const KINDS: PrimitiveKind[] = ["box", "cylinder", "cone", "sphere", "gable", "pyramid"];
const MAX_PARTS = 400;

const SYSTEM = `Eres un artista 3D técnico de "Everlinth", un juego de zombis en una ciudad real (A Coruña) con vista isométrica y tono ultrarrealista.
Compones assets con primitivas geométricas. Responde SIEMPRE usando la herramienta crear_asset.

Sistema de coordenadas y unidades:
- Y hacia arriba; el suelo es y = 0 y nada debe quedar por debajo. X a la derecha, Z hacia el espectador (la fachada principal mira a +Z).
- Unidades de render: 1 unidad = 3 metros. Una planta de edificio mide 1 unidad; una persona, 0,6; una puerta, 0,75 de alto y 0,35 de ancho; una ventana típica, 0,4 × 0,5; un coche, 1,5 × 0,5 × 0,65 (largo × alto × ancho).
- Cada pieza: kind, pos (centro de la pieza), rot (grados, Euler X→Y→Z), size (tamaño a lo largo de X, Y, Z antes de girar), color (#rrggbb).
- Las primitivas son de tamaño unidad y centradas en su pos:
  · box: caja.
  · cylinder: cilindro con el eje en Y (size.x = diámetro en X, size.z = diámetro en Z, size.y = alto).
  · cone: cono con la punta hacia +Y.
  · sphere: esfera (size = diámetros).
  · gable: prisma triangular para tejados a dos aguas; la cumbrera va a lo largo de Z, arriba del todo; size.x = ancho de la base, size.y = alto del tejado, size.z = largo de la cumbrera. Gíralo 90° en Y si la cumbrera debe ir a lo largo de X.
  · pyramid: pirámide de base cuadrada (tejados a cuatro aguas, remates), punta hacia +Y.
- Para que una pieza apoye en otra: pos.y = (altura de la de abajo) + size.y / 2.

Criterios de calidad:
- Proporciones y escala reales (usa las medidas de arriba). Detalle a la escala de la vista: marcos de ventanas, zócalo, cornisa, puertas, balcones, barandillas, chimeneas, rótulos… con piezas finas (0,02-0,05) algo salientes de la fachada (0,01-0,03) para que se lean.
- Colores realistas y apagados (materiales reales: estuco, piedra, ladrillo, metal, vidrio oscuro #2a3440…), nada saturado salvo que se pida.
- Coherencia: piezas que se tocan, sin huecos ni piezas flotando; simetría cuando el objeto la tiene.
- Si hay imagen de referencia, respeta su forma, proporciones y colores.
- Usa entre 20 y ${MAX_PARTS} piezas según la complejidad; prioriza la silueta y los elementos que se ven desde arriba en diagonal.
- Puntos de unión (sockets) solo si tienen sentido: tipos ${SOCKET_TYPES.join(", ")}.
- Nombre corto en español. Categoría de la lista. Biomas: normalmente ["city"].`;

const TOOL = {
  name: "crear_asset",
  description: "Crea el asset de primitivas con sus piezas, nombre, categoría y puntos de unión.",
  input_schema: {
    type: "object",
    properties: {
      name: { type: "string", description: "Nombre corto en español" },
      category: { type: "string", enum: ASSET_CATEGORIES },
      biomes: { type: "array", items: { type: "string", enum: BIOME_IDS } },
      notes: { type: "string", description: "Una o dos frases sobre qué es y cómo está hecho" },
      parts: {
        type: "array",
        maxItems: MAX_PARTS,
        items: {
          type: "object",
          properties: {
            kind: { type: "string", enum: KINDS },
            pos: { type: "array", items: { type: "number" }, minItems: 3, maxItems: 3 },
            rot: { type: "array", items: { type: "number" }, minItems: 3, maxItems: 3 },
            size: { type: "array", items: { type: "number" }, minItems: 3, maxItems: 3 },
            color: { type: "string", description: "#rrggbb" },
          },
          required: ["kind", "pos", "size", "color"],
        },
      },
      sockets: {
        type: "array",
        items: {
          type: "object",
          properties: {
            name: { type: "string" },
            type: { type: "string", enum: SOCKET_TYPES },
            pos: { type: "array", items: { type: "number" }, minItems: 3, maxItems: 3 },
            rot: { type: "array", items: { type: "number" }, minItems: 3, maxItems: 3 },
          },
          required: ["name", "type", "pos"],
        },
      },
    },
    required: ["name", "category", "parts"],
  },
};

export class AiError extends Error {
  constructor(
    message: string,
    public status = 502,
  ) {
    super(message);
  }
}

export interface GenerateInput {
  prompt: string;
  image?: string | null; // data URL (data:image/png;base64,…)
  base?: AssetDef | null; // asset del que partir (modificarlo)
}

export interface GenerateResult {
  asset: Omit<AssetDef, "id">;
  info: string;
}

const num = (v: unknown, def: number, lo: number, hi: number): number => {
  const n = Number(v);
  return Number.isFinite(n) ? Math.max(lo, Math.min(hi, n)) : def;
};
const vec3 = (v: unknown, def: [number, number, number], lo: number, hi: number): [number, number, number] => {
  const a = Array.isArray(v) ? v : [];
  return [num(a[0], def[0], lo, hi), num(a[1], def[1], lo, hi), num(a[2], def[2], lo, hi)];
};

/** Lo que devuelve la IA → piezas y puntos válidos (nunca se confía en su forma). */
function toAsset(input: Record<string, unknown>): Omit<AssetDef, "id"> {
  const parts: PrimitivePart[] = [];
  for (const p of (Array.isArray(input.parts) ? input.parts : []).slice(0, MAX_PARTS) as Array<Record<string, unknown>>) {
    if (!p || !KINDS.includes(p.kind as PrimitiveKind)) continue;
    const color = typeof p.color === "string" && /^#[0-9a-f]{6}$/i.test(p.color) ? p.color.toLowerCase() : "#c9c2b4";
    parts.push({
      id: randomUUID().slice(0, 8),
      kind: p.kind as PrimitiveKind,
      pos: vec3(p.pos, [0, 0.5, 0], -60, 60),
      rot: vec3(p.rot, [0, 0, 0], -360, 360),
      size: vec3(p.size, [1, 1, 1], 0.003, 60),
      color,
    });
  }
  if (parts.length === 0) throw new AiError("La IA no ha devuelto ninguna pieza válida; prueba a describirlo de otra forma.");
  const sockets: AssetSocket[] = [];
  for (const s of (Array.isArray(input.sockets) ? input.sockets : []).slice(0, 32) as Array<Record<string, unknown>>) {
    if (!s || !SOCKET_TYPES.includes(String(s.type))) continue;
    sockets.push({ id: randomUUID().slice(0, 8), name: String(s.name ?? s.type).slice(0, 40), type: String(s.type), pos: vec3(s.pos, [0, 0, 0], -60, 60), rot: vec3(s.rot, [0, 0, 0], -360, 360) });
  }
  const biomes = (Array.isArray(input.biomes) ? input.biomes : []).filter((b): b is BiomeId => (BIOME_IDS as string[]).includes(String(b)));
  const category = ASSET_CATEGORIES.includes(String(input.category)) ? String(input.category) : "otro";
  return {
    name: String(input.name ?? "Asset IA").slice(0, 80),
    source: { type: "primitives", parts },
    category,
    biomes: biomes.length ? biomes : ["city"],
    scale: 1,
    textures: {},
    sockets,
    notes: typeof input.notes === "string" ? input.notes.slice(0, 2000) : undefined,
  };
}

export async function generateAsset(req: GenerateInput): Promise<GenerateResult> {
  const key = process.env.ANTHROPIC_API_KEY?.trim();
  if (!key) throw new AiError("Falta la clave de la API de Anthropic: crea server/.env con ANTHROPIC_API_KEY=sk-ant-... y reinicia el servidor.", 503);
  const model = process.env.ANTHROPIC_MODEL?.trim() || DEFAULT_MODEL;
  const content: Array<Record<string, unknown>> = [];
  if (req.image) {
    const m = /^data:(image\/(?:png|jpeg|gif|webp));base64,(.+)$/s.exec(req.image);
    if (!m) throw new AiError("La imagen debe ser PNG, JPEG, GIF o WebP.", 400);
    if (m[2].length > 7_000_000) throw new AiError("La imagen es demasiado grande (máximo ~5 MB).", 400);
    content.push({ type: "image", source: { type: "base64", media_type: m[1], data: m[2] } });
  }
  let text = req.prompt.trim() || "Recrea en 3D el objeto de la imagen.";
  if (req.base && req.base.source.type === "primitives") {
    const parts = req.base.source.parts.map(({ kind, pos, rot, size, color }) => ({ kind, pos, rot, size, color }));
    text = `Parte de este asset existente («${req.base.name}», categoría ${req.base.category}) y aplícale lo que se pide. Devuelve el asset completo resultante.\nPiezas actuales:\n${JSON.stringify(parts)}\n\nPetición: ${text}`;
  }
  content.push({ type: "text", text });
  let res: Response;
  try {
    res = await fetch(API_URL, {
      method: "POST",
      headers: { "content-type": "application/json", "x-api-key": key, "anthropic-version": "2023-06-01" },
      body: JSON.stringify({
        model,
        max_tokens: 32000,
        system: SYSTEM,
        tools: [TOOL],
        tool_choice: { type: "tool", name: TOOL.name },
        messages: [{ role: "user", content }],
      }),
      signal: AbortSignal.timeout(280_000),
    });
  } catch (e) {
    throw new AiError(`No se pudo contactar con la API de Anthropic: ${(e as Error).message}`);
  }
  const data = (await res.json().catch(() => ({}))) as {
    error?: { type?: string; message?: string };
    content?: Array<{ type: string; name?: string; input?: Record<string, unknown> }>;
    usage?: { input_tokens?: number; output_tokens?: number };
    stop_reason?: string;
  };
  if (!res.ok) {
    const msg = data.error?.message ?? `HTTP ${res.status}`;
    if (res.status === 401) throw new AiError("La clave de la API no es válida (revisa ANTHROPIC_API_KEY en server/.env).", 502);
    if (/credit balance/i.test(msg)) throw new AiError("La cuenta de la API no tiene saldo: añade crédito en console.anthropic.com → Billing.", 502);
    throw new AiError(`Error de la API de Anthropic: ${msg}`);
  }
  const call = data.content?.find((c) => c.type === "tool_use" && c.name === TOOL.name);
  if (!call?.input) throw new AiError(data.stop_reason === "max_tokens" ? "La respuesta se cortó por larga; pide algo más sencillo." : "La IA no ha devuelto un asset.");
  const asset = toAsset(call.input);
  const parts = asset.source.type === "primitives" ? asset.source.parts.length : 0;
  const info = `${parts} piezas · ${model} · ${data.usage?.input_tokens ?? "?"} + ${data.usage?.output_tokens ?? "?"} tokens`;
  return { asset, info };
}
