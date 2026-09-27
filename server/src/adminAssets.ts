// Catálogo de assets del juego (herramienta /admin/assets, ver client/admin-assets.html).
// Cada asset (modelo GLB, generador procedural o composición de primitivas) se guarda
// como JSON en la tabla `assets`. Al arrancar se registran automáticamente los modelos
// que haya en client/public/models (y los generadores procedurales conocidos) que aún
// no estén en el catálogo: lo ya editado nunca se sobrescribe.
import { EventEmitter } from "node:events";
import { Router } from "express";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { BIOME_IDS, DEFAULT_TEXTURE_PARAMS, type AssetDef, type BiomeId } from "@roi/shared";
import { db } from "./db.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CLIENT = path.join(__dirname, "..", "..", "client");
const PUBLIC = path.join(CLIENT, "public");

db.exec(`
  CREATE TABLE IF NOT EXISTS assets (
    id TEXT PRIMARY KEY,
    data TEXT NOT NULL,
    updated_at INTEGER NOT NULL
  );
`);

const listStmt = db.prepare("SELECT data FROM assets ORDER BY id");
const getStmt = db.prepare("SELECT data FROM assets WHERE id = ?");
const upsertStmt = db.prepare("INSERT INTO assets (id, data, updated_at) VALUES (?, ?, ?) ON CONFLICT(id) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at");
const insertIgnoreStmt = db.prepare("INSERT OR IGNORE INTO assets (id, data, updated_at) VALUES (?, ?, ?)");
const deleteStmt = db.prepare("DELETE FROM assets WHERE id = ?");

function listAssets(): AssetDef[] {
  return (listStmt.all() as Array<{ data: string }>).map((r) => JSON.parse(r.data) as AssetDef);
}
function getAsset(id: string): AssetDef | null {
  const r = getStmt.get(id) as { data: string } | undefined;
  return r ? (JSON.parse(r.data) as AssetDef) : null;
}
function saveAsset(def: AssetDef): void {
  def.updatedAt = Date.now();
  upsertStmt.run(def.id, JSON.stringify(def), def.updatedAt);
}

// ---- Registro automático ----

function guessCategory(kit: string, name: string): string {
  if (kit === "countryside") return name.startsWith("tractor") ? "vehículo" : name === "windmill" ? "decoración" : "edificio";
  if (name.includes("skyscraper")) return "rascacielos";
  if (kit === "suburban" && name.startsWith("building")) return "casa";
  if (name.startsWith("building") || name.startsWith("low-detail-building")) return "edificio";
  if (name.startsWith("tree")) return "vegetación";
  if (name.includes("light-traffic")) return "semáforo";
  if (name.includes("light")) return "farola";
  if (name.startsWith("truck")) return "vehículo";
  if (/^(road|grass|cliff|path|driveway)/.test(name)) return "terreno";
  if (/^(wall|roof|balcony|door|scaffolding|window|stairs|detail-beam)/.test(name)) return "pieza de edificio";
  if (/^(fence|planter|detail)/.test(name)) return "mobiliario";
  return "otro";
}

function humanName(name: string): string {
  return name.replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

function seedCatalog(): number {
  let added = 0;
  const now = Date.now();
  const modelsDir = path.join(PUBLIC, "models");
  if (fs.existsSync(modelsDir)) {
    for (const kit of fs.readdirSync(modelsDir)) {
      const dir = path.join(modelsDir, kit);
      if (!fs.statSync(dir).isDirectory()) continue;
      for (const f of fs.readdirSync(dir)) {
        if (!f.endsWith(".glb")) continue;
        const name = f.slice(0, -4);
        const def: AssetDef = {
          id: `kenney.${kit}.${name}`,
          name: humanName(name),
          source: { type: "glb", path: `${kit}/${name}` },
          category: guessCategory(kit, name),
          biomes: kit === "countryside" ? ["countryside"] : kit === "suburban" ? ["city", "classic"] : ["city"],
          scale: 1,
          textures: {},
          sockets: [],
        };
        const r = insertIgnoreStmt.run(def.id, JSON.stringify(def), now);
        if (r.changes > 0) added++;
      }
    }
  }
  const procedural: Array<[string, string, string]> = [
    ["nyc-streetlight", "Farola cobra (NY)", "farola"],
    ["nyc-traffic-signal", "Semáforo de mástil (NY)", "semáforo"],
  ];
  for (const [gen, name, category] of procedural) {
    const def: AssetDef = { id: `proc.${gen}`, name, source: { type: "procedural", generator: gen }, category, biomes: ["city"], scale: 1, textures: {}, sockets: [] };
    const r = insertIgnoreStmt.run(def.id, JSON.stringify(def), now);
    if (r.changes > 0) added++;
  }
  return added;
}
const seeded = seedCatalog();
if (seeded > 0) console.log(`Catálogo de assets: ${seeded} assets registrados`);

// ---- Validación mínima de lo que llega del editor ----

function sanitize(input: unknown, id: string): AssetDef | null {
  if (!input || typeof input !== "object") return null;
  const d = input as Partial<AssetDef>;
  if (!d.source || typeof d.source !== "object") return null;
  const biomes = Array.isArray(d.biomes) ? d.biomes.filter((b): b is BiomeId => (BIOME_IDS as string[]).includes(b as string)) : [];
  const textures: AssetDef["textures"] = {};
  if (d.textures && typeof d.textures === "object") {
    for (const [slot, t] of Object.entries(d.textures)) textures[slot] = { ...DEFAULT_TEXTURE_PARAMS, ...(t as object) };
  }
  return {
    id,
    name: String(d.name ?? id).slice(0, 80),
    source: d.source,
    category: String(d.category ?? "otro").slice(0, 40),
    biomes,
    scale: Number.isFinite(d.scale) && (d.scale as number) > 0 ? (d.scale as number) : 1,
    textures,
    sockets: Array.isArray(d.sockets) ? d.sockets.slice(0, 64) : [],
    notes: typeof d.notes === "string" ? d.notes.slice(0, 2000) : undefined,
  };
}

// ---- Rutas ----

export const assetsRouter = Router();

// Avisa de cada asset guardado o borrado (index.ts lo reenvía a los clientes
// conectados, así el juego Godot recarga ese asset en caliente).
export const assetEvents = new EventEmitter();

// Público: el juego lo lee para saber categoría, biomas, texturas y puntos de unión.
assetsRouter.get("/assets.json", (_req, res) => {
  res.json(listAssets());
});

assetsRouter.get("/admin/assets.json", (_req, res) => {
  res.json(listAssets());
});

assetsRouter.put("/admin/assets/:id", (req, res) => {
  const def = sanitize(req.body, req.params.id);
  if (!def) {
    res.status(400).json({ error: "Asset inválido" });
    return;
  }
  saveAsset(def);
  assetEvents.emit("changed", def.id);
  res.json(def);
});

/** Id libre "prim.<nombre>" para un asset nuevo. */
function freeId(name: string): string {
  const base = name
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "") || "asset";
  let id = `prim.${base}`;
  for (let n = 2; getAsset(id); n++) id = `prim.${base}-${n}`;
  return id;
}

// Nuevo asset de primitivas (vacío o con las piezas que manden el editor o Claude Code).
assetsRouter.post("/admin/assets", (req, res) => {
  const body = (req.body ?? {}) as Partial<AssetDef>;
  const id = freeId(String(body.name ?? "Nuevo asset"));
  const def = sanitize({ category: "otro", biomes: ["city"], scale: 1, textures: {}, sockets: [], source: { type: "primitives", parts: [] }, ...body }, id);
  if (!def) {
    res.status(400).json({ error: "Asset inválido" });
    return;
  }
  saveAsset(def);
  assetEvents.emit("changed", def.id);
  res.json(def);
});

assetsRouter.delete("/admin/assets/:id", (req, res) => {
  const def = getAsset(req.params.id);
  if (!def) {
    res.status(404).json({ error: "No existe" });
    return;
  }
  if (def.source.type !== "primitives") {
    res.status(400).json({ error: "Solo se pueden borrar assets de primitivas (los modelos y generadores se registran solos)" });
    return;
  }
  deleteStmt.run(def.id);
  assetEvents.emit("changed", def.id);
  res.json({ ok: true });
});

// Biblioteca de texturas disponibles para aplicar a los assets.
assetsRouter.get("/admin/asset-textures.json", (_req, res) => {
  const out: Array<{ url: string; name: string; group: string }> = [];
  const facades = path.join(PUBLIC, "textures", "buildings");
  if (fs.existsSync(facades)) {
    for (const f of fs.readdirSync(facades)) if (/\.(jpg|png)$/i.test(f)) out.push({ url: `/textures/buildings/${f}`, name: f.replace(/\.\w+$/, ""), group: "Fachadas (fotos)" });
  }
  const models = path.join(PUBLIC, "models");
  if (fs.existsSync(models)) {
    for (const kit of fs.readdirSync(models)) {
      const tdir = path.join(models, kit, "Textures");
      if (!fs.existsSync(tdir)) continue;
      for (const f of fs.readdirSync(tdir)) if (/\.(jpg|png)$/i.test(f)) out.push({ url: `/models/${kit}/Textures/${f}`, name: f.replace(/\.\w+$/, ""), group: `Kenney ${kit}` });
    }
  }
  res.json(out);
});

// El editor es una página del cliente (Vite): client/admin-assets.html.
assetsRouter.get("/admin/assets", (_req, res) => {
  res.sendFile(path.join(CLIENT, "dist", "admin-assets.html"));
});
