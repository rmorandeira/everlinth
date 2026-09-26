// Genera godot/scripts/net/protocol.gd a partir de las constantes de @roi/shared
// (shared/dist, compilado con `npm run build --workspace=shared`), para que el
// cliente Godot y el servidor nunca se desincronicen en tamaños, velocidades, etc.
//   node tools/godot/gen-protocol.mjs
import { writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const shared = await import(pathToFileURL(path.join(root, "shared", "dist", "index.js")).href);

function gd(v) {
  if (typeof v === "string") return JSON.stringify(v);
  if (typeof v === "boolean") return v ? "true" : "false";
  if (typeof v === "number") return Number.isInteger(v) ? String(v) : String(v);
  if (v instanceof Set) return gd([...v]);
  if (Array.isArray(v)) return "[" + v.map(gd).join(", ") + "]";
  if (v && typeof v === "object") return "{" + Object.entries(v).map(([k, x]) => `${JSON.stringify(k)}: ${gd(x)}`).join(", ") + "}";
  return null;
}

const isEnum = (v) =>
  v && typeof v === "object" && !Array.isArray(v) && Object.entries(v).some(([k, x]) => typeof x === "number" && v[x] === k);

const lines = [
  "# GENERADO por tools/godot/gen-protocol.mjs a partir de shared/src/index.ts.",
  "# No editar a mano: cambia shared y vuelve a generar.",
  "class_name Protocol",
  "",
];
for (const name of Object.keys(shared).sort()) {
  const v = shared[name];
  if (typeof v === "function") continue;
  if (isEnum(v)) {
    const members = Object.entries(v).filter(([, x]) => typeof x === "number");
    lines.push(`enum ${name} { ${members.map(([k, x]) => `${k} = ${x}`).join(", ")} }`);
    continue;
  }
  if (!/^[A-Z][A-Z0-9_]*$/.test(name)) continue; // solo constantes en MAYÚSCULAS
  const s = gd(v);
  if (s === null) continue;
  lines.push(`const ${name} = ${s}`);
}
const out = path.join(root, "godot", "scripts", "net", "protocol.gd");
writeFileSync(out, lines.join("\n") + "\n");
console.log("escrito", path.relative(root, out), `(${lines.length - 4} símbolos)`);
