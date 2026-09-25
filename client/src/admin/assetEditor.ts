// Gestor de assets (backoffice, /admin/assets): catálogo de todo lo que tiene
// representación 3D en el juego. Visor 3D (órbita, zoom, desplazamiento), categoría y
// biomas, texturas por material (escala, desplazamiento, rotación, repetición, y
// proyección por caras para fotos de fachada), puntos de unión donde encajar otros
// assets, edición de assets de primitivas y generación con IA (texto + imagen pegada).
import "./assetEditor.css";
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { TransformControls } from "three/addons/controls/TransformControls.js";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import {
  ASSET_CATEGORIES,
  BIOME_CATALOG,
  BIOME_IDS,
  DEFAULT_TEXTURE_PARAMS,
  SOCKET_TYPES,
  type AssetDef,
  type AssetSocket,
  type PrimitiveKind,
  type PrimitivePart,
  type TextureParams,
} from "@roi/shared";
import { KIT_SCALE } from "../render3d/models3d.js";
import { nycStreetlight, nycTrafficSignal, updateSignals } from "../render3d/streetFurniture3d.js";

const $ = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;
const deg = THREE.MathUtils.degToRad;
const toDeg = THREE.MathUtils.radToDeg;
function uid(): string {
  return Math.random().toString(36).slice(2, 9);
}
function clone<T>(v: T): T {
  return JSON.parse(JSON.stringify(v)) as T;
}

// ---------------------------------------------------------------- estado

let assets: AssetDef[] = [];
let current: AssetDef | null = null;
let dirty = false;
let textureLib: Array<{ url: string; name: string; group: string }> = [];
let selectedPart: string | null = null;
let selectedSocket: string | null = null;
let pickingSocket = false;
let aiImage: string | null = null;

function setStatus(text: string): void {
  $("status").textContent = text;
}
function markDirty(): void {
  dirty = true;
  setStatus("● cambios sin guardar");
}

// ---------------------------------------------------------------- visor 3D

const canvas = $<HTMLCanvasElement>("view");
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(2, window.devicePixelRatio));
renderer.shadowMap.enabled = true;
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x1c1f24);
const camera = new THREE.PerspectiveCamera(40, 1, 0.05, 500);
camera.position.set(6, 5, 8);
const orbit = new OrbitControls(camera, canvas);
orbit.enableDamping = true;
orbit.target.set(0, 1, 0);

scene.add(new THREE.HemisphereLight(0xdfe9ff, 0x6a6258, 1.1));
const sun = new THREE.DirectionalLight(0xffffff, 2.2);
sun.position.set(8, 14, 6);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
const sc = sun.shadow.camera;
sc.left = sc.bottom = -12;
sc.right = sc.top = 12;
scene.add(sun);
const ground = new THREE.Mesh(new THREE.PlaneGeometry(60, 60), new THREE.ShadowMaterial({ opacity: 0.35 }));
ground.rotation.x = -Math.PI / 2;
ground.receiveShadow = true;
scene.add(ground);
// 1 cuadro = 1 tile = 1,5 m = 0,5 unidades de render
const grid = new THREE.GridHelper(20, 40, 0x3a4048, 0x2a2e34);
scene.add(grid);

const assetRoot = new THREE.Group();
scene.add(assetRoot);
const socketGroup = new THREE.Group();
scene.add(socketGroup);

const gizmo = new TransformControls(camera, canvas);
gizmo.addEventListener("dragging-changed", (e) => {
  orbit.enabled = !(e as unknown as { value: boolean }).value;
});
scene.add(gizmo.getHelper());

function resize(): void {
  const r = canvas.getBoundingClientRect();
  renderer.setSize(r.width, r.height, false);
  camera.aspect = r.width / Math.max(1, r.height);
  camera.updateProjectionMatrix();
}
window.addEventListener("resize", resize);
resize();

function loop(t: number): void {
  orbit.update();
  updateSignals(t / 1000);
  renderer.render(scene, camera);
  requestAnimationFrame(loop);
}
requestAnimationFrame(loop);

function frameAsset(): void {
  const box = new THREE.Box3().setFromObject(assetRoot);
  if (box.isEmpty()) return;
  const size = box.getSize(new THREE.Vector3());
  const center = box.getCenter(new THREE.Vector3());
  const r = Math.max(size.x, size.y, size.z) * 0.5 + 0.3;
  const dist = r / Math.sin(deg(camera.fov / 2)) * 1.1;
  const dir = new THREE.Vector3(1, 0.7, 1.2).normalize();
  camera.position.copy(center).addScaledVector(dir, dist);
  orbit.target.copy(center);
}

// ---------------------------------------------------------------- construcción del asset

const gltfLoader = new GLTFLoader();
const gltfCache = new Map<string, THREE.Object3D>();
async function loadGlb(path: string): Promise<THREE.Object3D> {
  let g = gltfCache.get(path);
  if (!g) {
    g = (await gltfLoader.loadAsync(`/models/${path}.glb`)).scene;
    gltfCache.set(path, g);
  }
  return g.clone(true);
}

// Geometrías unidad de las primitivas (centradas; base en -0.5).
function gableGeometry(): THREE.BufferGeometry {
  const A = [-0.5, -0.5, 0.5], B = [0.5, -0.5, 0.5], C = [0, 0.5, 0.5];
  const D = [-0.5, -0.5, -0.5], E = [0.5, -0.5, -0.5], F = [0, 0.5, -0.5];
  const tris = [A, B, C, E, D, F, A, C, D, C, F, D, B, E, C, C, E, F, A, D, B, B, D, E];
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(tris.flat(), 3));
  const uv: number[] = [];
  for (let i = 0; i < tris.length; i++) uv.push(tris[i][0] + 0.5, tris[i][1] + 0.5);
  g.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
  g.computeVertexNormals();
  return g;
}
const PRIM_GEOS: Record<PrimitiveKind, THREE.BufferGeometry> = {
  box: new THREE.BoxGeometry(1, 1, 1),
  cylinder: new THREE.CylinderGeometry(0.5, 0.5, 1, 24),
  cone: new THREE.ConeGeometry(0.5, 1, 24),
  sphere: new THREE.SphereGeometry(0.5, 24, 16),
  gable: gableGeometry(),
  pyramid: new THREE.ConeGeometry(Math.SQRT1_2, 1, 4).rotateY(Math.PI / 4),
};

interface Slot {
  key: string;
  meshes: THREE.Mesh[];
  original: THREE.Material;
}
let slots: Slot[] = [];
const partMeshes = new Map<string, THREE.Mesh>();
const originalGeometry = new WeakMap<THREE.Mesh, THREE.BufferGeometry>();
let buildToken = 0;

async function buildAsset(): Promise<void> {
  const token = ++buildToken;
  gizmo.detach();
  assetRoot.clear();
  partMeshes.clear();
  slots = [];
  if (!current) return;
  const def = current;
  let obj: THREE.Object3D;
  if (def.source.type === "glb") {
    const kit = def.source.path.split("/")[0] as keyof typeof KIT_SCALE;
    obj = await loadGlb(def.source.path);
    if (token !== buildToken) return;
    // normalizar: base en y=0, centrado en X/Z, escala del kit
    const box = new THREE.Box3().setFromObject(obj);
    const center = box.getCenter(new THREE.Vector3());
    obj.position.set(-center.x, -box.min.y, -center.z);
    const wrap = new THREE.Group();
    wrap.add(obj);
    wrap.scale.setScalar((KIT_SCALE[kit] ?? 1) * def.scale);
    obj = wrap;
  } else if (def.source.type === "procedural") {
    obj = def.source.generator === "nyc-traffic-signal" ? nycTrafficSignal(0, 0, 0, -1, [0.8, 1.6], "A") : nycStreetlight(0, 0, 1, 0);
    obj.position.set(0, 0, 0);
    const wrap = new THREE.Group();
    wrap.add(obj);
    wrap.scale.setScalar(def.scale);
    obj = wrap;
  } else {
    const wrap = new THREE.Group();
    for (const p of def.source.parts) {
      const mesh = new THREE.Mesh(PRIM_GEOS[p.kind], new THREE.MeshStandardMaterial({ color: p.color, roughness: 0.85 }));
      mesh.position.set(...p.pos);
      mesh.rotation.set(deg(p.rot[0]), deg(p.rot[1]), deg(p.rot[2]));
      mesh.scale.set(...p.size);
      mesh.userData.partId = p.id;
      partMeshes.set(p.id, mesh);
      wrap.add(mesh);
    }
    wrap.scale.setScalar(def.scale);
    obj = wrap;
  }

  // Ranuras de material: una por material distinto (modelos) o por pieza (primitivas).
  const byMat = new Map<THREE.Material, Slot>();
  let n = 0;
  obj.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh) return;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    if (Array.isArray(mesh.material)) return;
    const partId = mesh.userData.partId as string | undefined;
    const mat = mesh.material;
    let slot = partId ? undefined : byMat.get(mat);
    if (!slot) {
      const key = partId ? `pieza:${partId}` : mat.name || `material ${++n}`;
      slot = { key, meshes: [], original: mat };
      if (!partId) byMat.set(mat, slot);
      slots.push(slot);
    }
    // cada ranura trabaja sobre su propia copia del material (no toca la caché)
    mesh.material = mat.clone();
    originalGeometry.set(mesh, mesh.geometry);
    slot.meshes.push(mesh);
  });
  assetRoot.add(obj);
  assetRoot.updateMatrixWorld(true);
  for (const s of slots) applyTexture(s);
  buildSockets();
  renderParts();
  renderTextures();
}

// ---------------------------------------------------------------- texturas

const texLoader = new THREE.TextureLoader();
const texCache = new Map<string, THREE.Texture>();
function baseTexture(url: string): THREE.Texture {
  let t = texCache.get(url);
  if (!t) {
    t = texLoader.load(url);
    t.colorSpace = THREE.SRGBColorSpace;
    texCache.set(url, t);
  }
  return t;
}

// Proyección por caras: paredes → u a lo largo del muro, v en altura; suelos y techos →
// u = x, v = z. En unidades de render reales (tras escalar), divididas por el tamaño de
// una repetición: así una foto de fachada mide lo mismo en cualquier edificio.
function boxProjected(mesh: THREE.Mesh, tile: number): THREE.BufferGeometry {
  const src0 = originalGeometry.get(mesh) ?? mesh.geometry;
  const src = src0.index ? src0.toNonIndexed() : src0.clone();
  const pos = src.getAttribute("position") as THREE.BufferAttribute;
  const m = mesh.matrixWorld;
  const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3(), nrm = new THREE.Vector3(), p = new THREE.Vector3();
  const uv = new Float32Array(pos.count * 2);
  for (let t = 0; t < pos.count / 3; t++) {
    a.fromBufferAttribute(pos, t * 3).applyMatrix4(m);
    b.fromBufferAttribute(pos, t * 3 + 1).applyMatrix4(m);
    c.fromBufferAttribute(pos, t * 3 + 2).applyMatrix4(m);
    nrm.subVectors(b, a).cross(p.subVectors(c, a)).normalize();
    for (let v = 0; v < 3; v++) {
      p.fromBufferAttribute(pos, t * 3 + v).applyMatrix4(m);
      let u: number, w: number;
      if (Math.abs(nrm.y) > 0.6) {
        u = p.x;
        w = p.z;
      } else {
        u = p.x * -nrm.z + p.z * nrm.x;
        w = p.y;
      }
      uv[(t * 3 + v) * 2] = u / tile;
      uv[(t * 3 + v) * 2 + 1] = w / tile;
    }
  }
  src.setAttribute("uv", new THREE.BufferAttribute(uv, 2));
  return src;
}

function slotParams(key: string): TextureParams {
  return { ...DEFAULT_TEXTURE_PARAMS, ...(current?.textures[key] ?? {}) };
}

function applyTexture(slot: Slot): void {
  const tp = slotParams(slot.key);
  for (const mesh of slot.meshes) {
    const mat = mesh.material as THREE.MeshStandardMaterial;
    const orig = slot.original as THREE.MeshStandardMaterial;
    if (!tp.texture) {
      mat.map = orig.map ?? null;
      mat.color.copy(orig.color ?? new THREE.Color(0xffffff));
      mesh.geometry = originalGeometry.get(mesh) ?? mesh.geometry;
    } else {
      const t = baseTexture(tp.texture).clone();
      t.wrapS = t.wrapT = THREE.RepeatWrapping;
      t.repeat.set(tp.repeatX, tp.repeatY);
      t.offset.set(tp.offsetX, tp.offsetY);
      t.center.set(0.5, 0.5);
      t.rotation = deg(tp.rotation);
      t.needsUpdate = true;
      mat.map = t;
      mat.color.set(0xffffff);
      mesh.geometry = tp.mapping === "box" ? boxProjected(mesh, tp.tile) : originalGeometry.get(mesh) ?? mesh.geometry;
    }
    mat.needsUpdate = true;
  }
}

function setSlotParams(key: string, patch: Partial<TextureParams>): void {
  if (!current) return;
  const tp = { ...slotParams(key), ...patch };
  if (!tp.texture && tp.mapping === "uv" && tp.repeatX === 1 && tp.repeatY === 1 && !tp.offsetX && !tp.offsetY && !tp.rotation) delete current.textures[key];
  else current.textures[key] = tp;
  const slot = slots.find((s) => s.key === key);
  if (slot) applyTexture(slot);
  markDirty();
}

function renderTextures(): void {
  const box = $("textures");
  box.innerHTML = "";
  if (!current) return;
  if (slots.length === 0) {
    box.innerHTML = '<div class="meta">Este asset no tiene materiales editables.</div>';
    return;
  }
  const groups = new Map<string, typeof textureLib>();
  for (const t of textureLib) {
    const l = groups.get(t.group) ?? [];
    l.push(t);
    groups.set(t.group, l);
  }
  for (const slot of slots) {
    if (slot.key.startsWith("pieza:") && selectedPart && slot.key !== `pieza:${selectedPart}`) continue;
    const tp = slotParams(slot.key);
    const div = document.createElement("div");
    div.className = "tex";
    const opts = ['<option value="">— original —</option>']
      .concat([...groups].map(([g, list]) => `<optgroup label="${g}">${list.map((t) => `<option value="${t.url}" ${t.url === tp.texture ? "selected" : ""}>${t.name}</option>`).join("")}</optgroup>`))
      .join("");
    const range = (name: string, label: string, min: number, max: number, step: number, value: number): string =>
      `<span>${label}</span><input type="range" data-k="${name}" min="${min}" max="${max}" step="${step}" value="${value}"><span class="v" data-v="${name}">${value}</span>`;
    div.innerHTML = `
      <div class="slot">${slot.key.startsWith("pieza:") ? "Pieza seleccionada" : slot.key}</div>
      <select data-k="texture">${opts}</select>
      ${tp.texture ? `<img class="preview" src="${tp.texture}" alt="">` : ""}
      <label>Proyección <select data-k="mapping"><option value="uv" ${tp.mapping === "uv" ? "selected" : ""}>UV del modelo</option><option value="box" ${tp.mapping === "box" ? "selected" : ""}>Por caras (fachadas)</option></select></label>
      <div class="grid">
        ${range("repeatX", "Repetir X", 0.1, 10, 0.1, tp.repeatX)}
        ${range("repeatY", "Repetir Y", 0.1, 10, 0.1, tp.repeatY)}
        ${range("offsetX", "Desplazar X", -1, 1, 0.01, tp.offsetX)}
        ${range("offsetY", "Desplazar Y", -1, 1, 0.01, tp.offsetY)}
        ${range("rotation", "Rotación °", 0, 360, 1, tp.rotation)}
        ${tp.mapping === "box" ? range("tile", "Tamaño (u)", 0.25, 12, 0.25, tp.tile) : ""}
      </div>`;
    div.querySelectorAll<HTMLInputElement | HTMLSelectElement>("[data-k]").forEach((el) => {
      const k = el.dataset.k as keyof TextureParams;
      el.addEventListener(el.tagName === "SELECT" ? "change" : "input", () => {
        const value = el.tagName === "SELECT" ? el.value : Number(el.value);
        if (k === "texture") setSlotParams(slot.key, { texture: (value as string) || null });
        else setSlotParams(slot.key, { [k]: value } as Partial<TextureParams>);
        const out = div.querySelector(`[data-v="${k}"]`);
        if (out) out.textContent = String(value);
        if (k === "texture" || k === "mapping") renderTextures();
      });
    });
    box.appendChild(div);
  }
}

// ---------------------------------------------------------------- puntos de unión

const socketColors: Record<string, number> = { tejado: 0xe8b400, fachada: 0x3ba0e0, puerta: 0x4caf6d, esquina: 0xff7a1a, suelo: 0xaaaaaa, poste: 0xc07ae0, anclaje: 0xff3b6b };
const socketMarkers = new Map<string, THREE.Object3D>();

function buildSockets(): void {
  socketGroup.clear();
  socketMarkers.clear();
  if (!current) return;
  for (const s of current.sockets) {
    const g = new THREE.Group();
    const ball = new THREE.Mesh(new THREE.SphereGeometry(0.07, 12, 8), new THREE.MeshBasicMaterial({ color: socketColors[s.type] ?? 0xffffff, depthTest: false }));
    ball.renderOrder = 20;
    g.add(ball, new THREE.AxesHelper(0.35));
    g.position.set(...s.pos);
    g.rotation.set(deg(s.rot[0]), deg(s.rot[1]), deg(s.rot[2]));
    g.userData.socketId = s.id;
    socketGroup.add(g);
    socketMarkers.set(s.id, g);
  }
  renderSockets();
}

function renderSockets(): void {
  const ul = $("sockets");
  ul.innerHTML = "";
  if (!current) return;
  if (current.sockets.length === 0) ul.innerHTML = '<li class="meta" style="cursor:default">Sin puntos. Usa «+ Punto de unión» y haz clic sobre el modelo.</li>';
  for (const s of current.sockets) {
    const li = document.createElement("li");
    li.className = s.id === selectedSocket ? "sel" : "";
    li.innerHTML = `<span>${s.name}</span><span class="meta">${s.type}</span>`;
    li.addEventListener("click", () => selectSocket(s.id));
    ul.appendChild(li);
  }
  const s = current.sockets.find((x) => x.id === selectedSocket);
  $("socket-detail").classList.toggle("hidden", !s);
  if (s) {
    $<HTMLInputElement>("s-name").value = s.name;
    $<HTMLSelectElement>("s-type").value = s.type;
  }
}

function selectSocket(id: string | null): void {
  selectedSocket = id;
  selectedPart = null;
  const m = id ? socketMarkers.get(id) : null;
  if (m) gizmo.attach(m);
  else gizmo.detach();
  renderSockets();
  renderParts();
  renderTextures();
}

// ---------------------------------------------------------------- primitivas

function partsOf(): PrimitivePart[] | null {
  return current && current.source.type === "primitives" ? current.source.parts : null;
}

const PART_NAMES: Record<PrimitiveKind, string> = { box: "Caja", cylinder: "Cilindro", cone: "Cono", sphere: "Esfera", gable: "Tejado", pyramid: "Pirámide" };

function renderParts(): void {
  const parts = partsOf();
  $("parts-section").classList.toggle("hidden", !parts);
  if (!parts) return;
  const ul = $("parts");
  ul.innerHTML = "";
  parts.forEach((p, i) => {
    const li = document.createElement("li");
    li.className = p.id === selectedPart ? "sel" : "";
    li.innerHTML = `<span>${i + 1}. ${PART_NAMES[p.kind]}</span><span class="meta">${p.size.map((v) => v.toFixed(2)).join("×")}</span>`;
    li.addEventListener("click", () => selectPart(p.id));
    ul.appendChild(li);
  });
  const p = parts.find((x) => x.id === selectedPart);
  $("part-detail").classList.toggle("hidden", !p);
  if (p) $<HTMLInputElement>("p-color").value = p.color;
}

function selectPart(id: string | null): void {
  selectedPart = id;
  selectedSocket = null;
  const m = id ? partMeshes.get(id) : null;
  if (m) gizmo.attach(m);
  else gizmo.detach();
  renderParts();
  renderSockets();
  renderTextures();
}

async function addPart(kind: PrimitiveKind): Promise<void> {
  const parts = partsOf();
  if (!parts) return;
  const size: [number, number, number] = kind === "gable" || kind === "pyramid" ? [2, 0.8, 2] : [1, 1, 1];
  const part: PrimitivePart = { id: uid(), kind, pos: [0, size[1] / 2, 0], rot: [0, 0, 0], size, color: kind === "gable" || kind === "pyramid" ? "#8a4a3a" : "#c9c2b4" };
  parts.push(part);
  markDirty();
  await buildAsset();
  selectPart(part.id);
}

gizmo.addEventListener("objectChange", () => {
  if (!current) return;
  const obj = gizmo.object;
  if (!obj) return;
  if (obj.userData.partId) {
    const p = partsOf()?.find((x) => x.id === obj.userData.partId);
    if (!p) return;
    p.pos = [obj.position.x, obj.position.y, obj.position.z];
    p.rot = [toDeg(obj.rotation.x), toDeg(obj.rotation.y), toDeg(obj.rotation.z)];
    p.size = [Math.abs(obj.scale.x), Math.abs(obj.scale.y), Math.abs(obj.scale.z)];
    renderParts();
  } else if (obj.userData.socketId) {
    const s = current.sockets.find((x) => x.id === obj.userData.socketId);
    if (!s) return;
    s.pos = [obj.position.x, obj.position.y, obj.position.z];
    s.rot = [toDeg(obj.rotation.x), toDeg(obj.rotation.y), toDeg(obj.rotation.z)];
  }
  markDirty();
});
gizmo.addEventListener("mouseUp", () => {
  // las proyecciones por caras dependen del tamaño real: recalcular al soltar
  if (gizmo.object?.userData.partId) for (const s of slots) applyTexture(s);
});

// ---------------------------------------------------------------- clic en el visor

const raycaster = new THREE.Raycaster();
let downAt: { x: number; y: number } | null = null;
canvas.addEventListener("pointerdown", (e) => {
  downAt = { x: e.clientX, y: e.clientY };
});
canvas.addEventListener("pointerup", (e) => {
  if (!downAt || Math.hypot(e.clientX - downAt.x, e.clientY - downAt.y) > 4 || gizmo.dragging) return;
  downAt = null;
  const r = canvas.getBoundingClientRect();
  const ndc = new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
  raycaster.setFromCamera(ndc, camera);
  const hits = raycaster.intersectObject(assetRoot, true);
  if (pickingSocket && current) {
    pickingSocket = false;
    $("add-socket").classList.remove("active");
    if (hits.length === 0) return;
    const h = hits[0];
    const n = h.face ? h.face.normal.clone().transformDirection(h.object.matrixWorld) : new THREE.Vector3(0, 1, 0);
    const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), n);
    const eul = new THREE.Euler().setFromQuaternion(q);
    const type = Math.abs(n.y) > 0.7 ? (n.y > 0 ? "tejado" : "suelo") : "fachada";
    const s: AssetSocket = { id: uid(), name: `${type} ${current.sockets.length + 1}`, type, pos: [h.point.x, h.point.y, h.point.z], rot: [toDeg(eul.x), toDeg(eul.y), toDeg(eul.z)] };
    current.sockets.push(s);
    markDirty();
    buildSockets();
    selectSocket(s.id);
    return;
  }
  // selección de piezas con clic
  const partHit = hits.find((h) => h.object.userData.partId);
  if (partHit) selectPart(partHit.object.userData.partId as string);
  else if (hits.length === 0) {
    selectPart(null);
    selectSocket(null);
  }
});

// ---------------------------------------------------------------- lista y formulario

function renderList(): void {
  const q = $<HTMLInputElement>("search").value.toLowerCase();
  const cat = $<HTMLSelectElement>("filter-category").value;
  const bio = $<HTMLSelectElement>("filter-biome").value;
  const ul = $("asset-list");
  ul.innerHTML = "";
  const badge: Record<string, string> = { glb: "modelo", procedural: "procedural", primitives: "primitivas" };
  for (const a of assets) {
    if (q && !a.name.toLowerCase().includes(q) && !a.id.includes(q)) continue;
    if (cat && a.category !== cat) continue;
    if (bio && !a.biomes.includes(bio as AssetDef["biomes"][number])) continue;
    const li = document.createElement("li");
    li.className = current?.id === a.id ? "sel" : "";
    li.innerHTML = `<div>${a.name}<span class="badge">${badge[a.source.type]}</span></div><div class="cat">${a.category} · ${a.biomes.join(", ") || "sin bioma"}</div>`;
    li.addEventListener("click", () => void openAsset(a.id));
    ul.appendChild(li);
  }
}

function fillForm(): void {
  if (!current) return;
  $("empty").classList.add("hidden");
  $("editor").classList.remove("hidden");
  $<HTMLInputElement>("f-name").value = current.name;
  $<HTMLSelectElement>("f-category").value = current.category;
  $<HTMLInputElement>("f-scale").value = String(current.scale);
  $<HTMLTextAreaElement>("f-notes").value = current.notes ?? "";
  const src = current.source.type === "glb" ? `Modelo: /models/${current.source.path}.glb` : current.source.type === "procedural" ? `Generador procedural: ${current.source.generator}` : `Primitivas: ${current.source.parts.length} piezas`;
  $("f-source").textContent = `${current.id} — ${src}`;
  const box = $("f-biomes");
  box.innerHTML = "";
  for (const b of BIOME_IDS) {
    const l = document.createElement("label");
    l.innerHTML = `<input type="checkbox" value="${b}" ${current.biomes.includes(b) ? "checked" : ""}> ${BIOME_CATALOG[b].label}`;
    l.querySelector("input")!.addEventListener("change", (e) => {
      if (!current) return;
      const on = (e.target as HTMLInputElement).checked;
      current.biomes = on ? [...new Set([...current.biomes, b])] : current.biomes.filter((x) => x !== b);
      markDirty();
    });
    box.appendChild(l);
  }
  $("delete").classList.toggle("hidden", current.source.type !== "primitives");
}

async function openAsset(id: string): Promise<void> {
  if (dirty && !confirm("Hay cambios sin guardar. ¿Descartarlos?")) return;
  const a = assets.find((x) => x.id === id);
  if (!a) return;
  current = clone(a);
  dirty = false;
  selectedPart = null;
  selectedSocket = null;
  setStatus("");
  fillForm();
  renderList();
  await buildAsset();
  frameAsset();
}

$<HTMLInputElement>("f-name").addEventListener("input", (e) => {
  if (current) current.name = (e.target as HTMLInputElement).value;
  markDirty();
});
$<HTMLSelectElement>("f-category").addEventListener("change", (e) => {
  if (current) current.category = (e.target as HTMLSelectElement).value;
  markDirty();
});
$<HTMLInputElement>("f-scale").addEventListener("change", (e) => {
  if (!current) return;
  const v = Number((e.target as HTMLInputElement).value);
  if (v > 0) current.scale = v;
  markDirty();
  void buildAsset();
});
$<HTMLTextAreaElement>("f-notes").addEventListener("input", (e) => {
  if (current) current.notes = (e.target as HTMLTextAreaElement).value;
  markDirty();
});
$<HTMLInputElement>("s-name").addEventListener("input", (e) => {
  const s = current?.sockets.find((x) => x.id === selectedSocket);
  if (!s) return;
  s.name = (e.target as HTMLInputElement).value;
  markDirty();
  renderSockets();
});
$<HTMLSelectElement>("s-type").addEventListener("change", (e) => {
  const s = current?.sockets.find((x) => x.id === selectedSocket);
  if (!s) return;
  s.type = (e.target as HTMLSelectElement).value;
  markDirty();
  buildSockets();
  selectSocket(s.id);
});
$("s-del").addEventListener("click", () => {
  if (!current || !selectedSocket) return;
  current.sockets = current.sockets.filter((x) => x.id !== selectedSocket);
  markDirty();
  selectSocket(null);
  buildSockets();
});
$<HTMLInputElement>("p-color").addEventListener("input", (e) => {
  const p = partsOf()?.find((x) => x.id === selectedPart);
  if (!p) return;
  p.color = (e.target as HTMLInputElement).value;
  const mesh = partMeshes.get(p.id);
  if (mesh && !current?.textures[`pieza:${p.id}`]?.texture) (mesh.material as THREE.MeshStandardMaterial).color.set(p.color);
  const slot = slots.find((s) => s.key === `pieza:${p.id}`);
  if (slot) (slot.original as THREE.MeshStandardMaterial).color.set(p.color);
  markDirty();
});
$("p-dup").addEventListener("click", async () => {
  const parts = partsOf();
  const p = parts?.find((x) => x.id === selectedPart);
  if (!parts || !p || !current) return;
  const copy: PrimitivePart = { ...clone(p), id: uid(), pos: [p.pos[0] + 0.5, p.pos[1], p.pos[2]] };
  parts.push(copy);
  const tex = current.textures[`pieza:${p.id}`];
  if (tex) current.textures[`pieza:${copy.id}`] = clone(tex);
  markDirty();
  await buildAsset();
  selectPart(copy.id);
});
$("p-del").addEventListener("click", async () => {
  const parts = partsOf();
  if (!parts || !selectedPart || !current) return;
  const i = parts.findIndex((x) => x.id === selectedPart);
  if (i >= 0) parts.splice(i, 1);
  delete current.textures[`pieza:${selectedPart}`];
  selectedPart = null;
  markDirty();
  await buildAsset();
});
document.querySelectorAll<HTMLButtonElement>("#add-part button").forEach((b) => b.addEventListener("click", () => void addPart(b.dataset.kind as PrimitiveKind)));

// Barra del visor
function setMode(mode: "translate" | "rotate" | "scale"): void {
  gizmo.setMode(mode);
  document.querySelectorAll<HTMLButtonElement>("#toolbar [data-mode]").forEach((b) => b.classList.toggle("active", b.dataset.mode === mode));
}
document.querySelectorAll<HTMLButtonElement>("#toolbar [data-mode]").forEach((b) => b.addEventListener("click", () => setMode(b.dataset.mode as "translate" | "rotate" | "scale")));
$("frame").addEventListener("click", frameAsset);
$("add-socket").addEventListener("click", () => {
  pickingSocket = !pickingSocket;
  $("add-socket").classList.toggle("active", pickingSocket);
  setStatus(pickingSocket ? "Haz clic sobre el modelo para colocar el punto de unión" : "");
});
window.addEventListener("keydown", (e) => {
  if ((e.target as HTMLElement).closest("input, textarea, select")) return;
  if (e.key === "w" || e.key === "W") setMode("translate");
  if (e.key === "e" || e.key === "E") setMode("rotate");
  if (e.key === "r" || e.key === "R") setMode("scale");
  if (e.key === "f" || e.key === "F") frameAsset();
  if (e.key === "Delete" && selectedPart) $("p-del").click();
  if ((e.ctrlKey || e.metaKey) && e.key === "s") {
    e.preventDefault();
    void save();
  }
});

// Guardar / nuevo / duplicar / borrar
async function save(): Promise<void> {
  if (!current) return;
  const res = await fetch(`/admin/assets/${encodeURIComponent(current.id)}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(current) });
  if (!res.ok) {
    setStatus("Error al guardar");
    return;
  }
  const saved = (await res.json()) as AssetDef;
  const i = assets.findIndex((a) => a.id === saved.id);
  if (i >= 0) assets[i] = saved;
  current = clone(saved);
  dirty = false;
  setStatus("✓ guardado");
  renderList();
}
$("save").addEventListener("click", () => void save());

async function createAsset(body: Partial<AssetDef>): Promise<void> {
  const res = await fetch("/admin/assets", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  if (!res.ok) {
    setStatus("Error al crear");
    return;
  }
  const def = (await res.json()) as AssetDef;
  assets.push(def);
  assets.sort((a, b) => a.id.localeCompare(b.id));
  dirty = false;
  await openAsset(def.id);
}
$("new-asset").addEventListener("click", () => {
  const name = prompt("Nombre del nuevo asset", "Nuevo edificio");
  if (name) void createAsset({ name, source: { type: "primitives", parts: [] } });
});
$("duplicate").addEventListener("click", () => {
  if (!current) return;
  const c = clone(current);
  void createAsset({ ...c, name: `${c.name} (copia)` });
});
$("delete").addEventListener("click", async () => {
  if (!current || !confirm(`¿Eliminar «${current.name}»?`)) return;
  const res = await fetch(`/admin/assets/${encodeURIComponent(current.id)}`, { method: "DELETE" });
  if (!res.ok) {
    setStatus("No se puede eliminar");
    return;
  }
  assets = assets.filter((a) => a.id !== current!.id);
  current = null;
  dirty = false;
  assetRoot.clear();
  socketGroup.clear();
  $("editor").classList.add("hidden");
  $("empty").classList.remove("hidden");
  renderList();
});

// ---------------------------------------------------------------- IA

document.addEventListener("paste", (e) => {
  const item = Array.from(e.clipboardData?.items ?? []).find((i) => i.type.startsWith("image/"));
  if (!item) return;
  const file = item.getAsFile();
  if (!file) return;
  e.preventDefault();
  const reader = new FileReader();
  reader.onload = () => {
    aiImage = String(reader.result);
    $<HTMLImageElement>("ai-image-img").src = aiImage;
    $("ai-image").classList.remove("hidden");
  };
  reader.readAsDataURL(file);
});
$("ai-image-clear").addEventListener("click", () => {
  aiImage = null;
  $("ai-image").classList.add("hidden");
});
$("ai-generate").addEventListener("click", async () => {
  const prompt = $<HTMLTextAreaElement>("ai-prompt").value.trim();
  if (!prompt && !aiImage) return;
  $("ai-result").textContent = "Generando…";
  const res = await fetch("/admin/assets/generate", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ prompt, image: aiImage }) });
  const data = (await res.json().catch(() => ({}))) as { error?: string; asset?: AssetDef };
  if (!res.ok || !data.asset) {
    $("ai-result").textContent = data.error ?? `Error ${res.status}`;
    return;
  }
  $("ai-result").textContent = "✓ generado";
  assets.push(data.asset);
  await openAsset(data.asset.id);
});

// ---------------------------------------------------------------- arranque

async function init(): Promise<void> {
  for (const c of ASSET_CATEGORIES) {
    for (const sel of ["f-category", "filter-category"]) {
      const o = document.createElement("option");
      o.value = c;
      o.textContent = c;
      $(sel).appendChild(o);
    }
  }
  for (const b of BIOME_IDS) {
    const o = document.createElement("option");
    o.value = b;
    o.textContent = BIOME_CATALOG[b].label;
    $("filter-biome").appendChild(o);
  }
  for (const t of SOCKET_TYPES) {
    const o = document.createElement("option");
    o.value = t;
    o.textContent = t;
    $("s-type").appendChild(o);
  }
  for (const id of ["search", "filter-category", "filter-biome"]) $(id).addEventListener("input", renderList);
  const [a, t] = await Promise.all([fetch("/admin/assets.json").then((r) => r.json()), fetch("/admin/asset-textures.json").then((r) => r.json())]);
  assets = a as AssetDef[];
  textureLib = t as typeof textureLib;
  renderList();
  window.addEventListener("beforeunload", (e) => {
    if (dirty) e.preventDefault();
  });
}
void init();
