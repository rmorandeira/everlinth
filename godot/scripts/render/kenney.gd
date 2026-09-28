class_name Kenney
## Modelos del juego a partir del catálogo del gestor web (ver catalog.gd): modelos de
## Kenney incluidos en el proyecto (CC0, ver assets/models/*/License.txt), modelos GLB
## descargados del servidor y assets de primitivas (cajas, cilindros, tejados… creados
## en /admin/assets o por IA). Cada modelo se prepara una vez: se normaliza (base en
## y=0, centrado en X/Z, frente hacia +Z) y se marcan sus paneles de cristal para las
## ventanas iluminadas (UV2.x, ver kenney.gdshader). Encima se aplica lo que diga el
## catálogo: escala y texturas por ranura de material (repetición, desplazamiento,
## giro y proyección por caras).
##
## Claves: "kit/nombre" (modelo de Kenney, asset "kenney.kit.nombre") o "asset:<id>".

## Escala de cada kit a unidades de render (1 unidad = 3 m).
const KIT_SCALE := {"commercial": 2.9, "suburban": 2.7, "retro": 2.1, "cars": 0.59}
## Modelos sueltos con su propia escala (vehículos de Poly Pizza: 12 m y 1,8 m).
const MODEL_SCALE := {"transport/bus": 0.0254, "transport/bicycle": 0.000366}

const COMMERCIAL_LOW := ["building-a", "building-b", "building-c", "building-d", "building-e", "building-h", "building-k"]
const COMMERCIAL_MID := ["building-f", "building-g", "building-i", "building-j", "building-l", "building-m", "building-n"]
const SKYSCRAPERS := ["building-skyscraper-a", "building-skyscraper-b", "building-skyscraper-c", "building-skyscraper-d", "building-skyscraper-e"]

static var _sets := {}
static var _base := {} # ruta GLB -> { parts: [[superficies, Transform3D]], size } (caro: una vez)
static var _models := {} # clave -> { parts: [[Mesh, Transform3D]], size } (con el catálogo aplicado)
static var _images := {} # textura -> Image
static var _materials := {} # textura + color + ajustes -> ShaderMaterial
static var _shader: Shader


## El catálogo ha cambiado: se rehacen los modelos (lo caro, la preparación, se conserva).
static func invalidate() -> void:
	_models.clear()
	_sets.clear()
	_materials.clear()


## Asset del catálogo que corresponde a una clave ({} si no hay catálogo o no existe).
static func def_of(key: String) -> Dictionary:
	if key.begins_with("asset:"):
		return Catalog.get_def(key.substr(6))
	return Catalog.get_def("kenney." + key.replace("/", "."))


static func _key_of(def: Dictionary) -> String:
	if def.source.type == "glb" and str(def.id).begins_with("kenney."):
		return str(def.source.path)
	return "asset:" + str(def.id)


## Escala natural a unidades de render (kit × escala del catálogo).
static func base_scale(key: String) -> float:
	var def := def_of(key)
	var s: float = float(def.get("scale", 1.0))
	if key.begins_with("asset:"):
		if def.get("source", {}).get("type", "") == "glb":
			s *= KIT_SCALE.get(str(def.source.path).split("/")[0], 1.0)
		return s
	if MODEL_SCALE.has(key):
		return MODEL_SCALE[key] * s
	return KIT_SCALE.get(key.split("/")[0], 1.0) * s


## ¿Es una casa? (no se estira en altura como los edificios de oficinas)
static func is_house(key: String) -> bool:
	var def := def_of(key)
	if not def.is_empty():
		return def.category == "casa"
	return key.begins_with("suburban/")


## Conjuntos de edificios por altura: low, mid, tall, tiny, house. Con catálogo: los
## assets de categoría edificio / rascacielos / casa del bioma ciudad (así, quitar un
## modelo del bioma en el gestor lo saca de la ciudad, y un asset nuevo entra en ella).
static func building_sets() -> Dictionary:
	if not _sets.is_empty():
		return _sets
	if Catalog.loaded:
		_sets = {"low": [], "mid": [], "tall": [], "tiny": [], "house": []}
		for def in Catalog.by_category(["edificio", "rascacielos", "casa"], "city"):
			var key := _key_of(def)
			if model(key).is_empty():
				continue
			var name: String = str(def.id)
			if def.category == "rascacielos":
				_sets.tall.append(key)
			elif def.category == "casa":
				_sets.house.append(key)
			elif name.contains("low-detail"):
				_sets.tiny.append(key)
			else:
				var h := size(key).y * base_scale(key)
				_sets["mid" if h >= 5.0 else "low"].append(key)
		for k in ["low", "mid", "tall", "house"]:
			if _sets[k].is_empty():
				_sets[k] = _sets.low if not _sets.low.is_empty() else _sets.mid
		return _sets
	var tiny: Array = []
	for c in "abcdefghijklm":
		tiny.append("commercial/low-detail-building-" + c)
	var house: Array = []
	for c in "abcdefghijklmnopqrstu":
		house.append("suburban/building-type-" + c)
	_sets = {
		"low": COMMERCIAL_LOW.map(func(n: String) -> String: return "commercial/" + n),
		"mid": COMMERCIAL_MID.map(func(n: String) -> String: return "commercial/" + n),
		"tall": SKYSCRAPERS.map(func(n: String) -> String: return "commercial/" + n),
		"tiny": tiny,
		"house": house,
	}
	return _sets


## Tamaño del modelo normalizado, en unidades del modelo (Vector3.ZERO si no existe).
static func size(key: String) -> Vector3:
	var m := model(key)
	return m.size if not m.is_empty() else Vector3.ZERO


## Piezas del modelo: [[Mesh, Transform3D relativo a la base normalizada, nombre], ...].
static func model(key: String) -> Dictionary:
	if _models.has(key):
		return _models[key]
	var def := def_of(key)
	var base: Dictionary = {}
	var src_type: String = def.get("source", {}).get("type", "glb")
	if src_type == "primitives":
		base = _primitives_base(def.source.parts)
	elif src_type == "glb":
		var path: String = str(def.source.path) if not def.is_empty() else key
		base = _glb_base(path)
	if base.is_empty():
		_models[key] = {}
		return {}
	var textures: Dictionary = def.get("textures", {})
	var parts: Array = []
	for p in base.parts:
		var mesh := ArrayMesh.new()
		for surf in p[0]:
			mesh.add_surface_from_arrays(Mesh.PRIMITIVE_TRIANGLES, surf.arrays, [], {}, Occlusion.format())
			var tp: Dictionary = textures.get(surf.slot, {})
			mesh.surface_set_material(mesh.get_surface_count() - 1, _material_for(surf.albedo, surf.color, tp, surf.get("normal"), surf.get("rough"), surf.get("cut", false)))
		parts.append([mesh, p[1], p[2] if p.size() > 2 else ""])
	_models[key] = {"parts": parts, "size": base.size}
	return _models[key]


static func _glb_base(path: String) -> Dictionary:
	if _base.has(path):
		return _base[path]
	var res := "res://assets/models/%s.glb" % path
	var root: Node
	if ResourceLoader.exists(res):
		root = (load(res) as PackedScene).instantiate()
	else:
		var n := Catalog.glb(path) # descarga del servidor (llega más tarde)
		if n == null:
			return {}
		root = n.duplicate()
	var parts: Array = []
	_collect(root, Transform3D(), parts)
	root.free()
	_base[path] = _normalized(parts)
	return _base[path]


static func _normalized(parts: Array) -> Dictionary:
	if parts.is_empty():
		return {}
	var box := AABB()
	var first := true
	for p in parts:
		for surf in p[0]:
			var b: AABB = p[1] * _aabb_of(surf.arrays[Mesh.ARRAY_VERTEX])
			box = b if first else box.merge(b)
			first = false
	var center := box.get_center()
	var off := Transform3D(Basis(), Vector3(-center.x, -box.position.y, -center.z))
	for p in parts:
		p[1] = off * p[1]
	return {"parts": parts, "size": box.size}


static func _aabb_of(v: PackedVector3Array) -> AABB:
	var b := AABB(v[0], Vector3.ZERO)
	for p in v:
		b = b.expand(p)
	return b


static func _collect(n: Node, parent: Transform3D, out: Array) -> void:
	var xf := parent
	if n is Node3D:
		xf = parent * (n as Node3D).transform
	if n is MeshInstance3D and (n as MeshInstance3D).mesh:
		out.append([_prepare_surfaces((n as MeshInstance3D).mesh), xf, str(n.name)])
	for c in n.get_children():
		_collect(c, xf, out)


# ------------------------------------------------------------------ primitivas

# Tejado a dos aguas unidad (mismos triángulos que gableGeometry del editor web).
const GABLE := [[-0.5, -0.5, 0.5], [0.5, -0.5, 0.5], [0, 0.5, 0.5], [0.5, -0.5, -0.5], [-0.5, -0.5, -0.5], [0, 0.5, -0.5],
	[-0.5, -0.5, 0.5], [0, 0.5, 0.5], [-0.5, -0.5, -0.5], [0, 0.5, 0.5], [0, 0.5, -0.5], [-0.5, -0.5, -0.5],
	[0.5, -0.5, 0.5], [0.5, -0.5, -0.5], [0, 0.5, 0.5], [0, 0.5, 0.5], [0.5, -0.5, -0.5], [0, 0.5, -0.5],
	[-0.5, -0.5, 0.5], [-0.5, -0.5, -0.5], [0.5, -0.5, 0.5], [0.5, -0.5, 0.5], [-0.5, -0.5, -0.5], [0.5, -0.5, -0.5]]
static var _unit := {}


## Primitiva unidad (centrada, como las del editor web).
static func _unit_prim(kind: String) -> Mesh:
	if _unit.has(kind):
		return _unit[kind]
	var m: Mesh = null
	match kind:
		"box":
			var b := BoxMesh.new()
			b.size = Vector3.ONE
			m = b
		"cylinder", "cone", "pyramid":
			var c := CylinderMesh.new()
			c.height = 1.0
			c.bottom_radius = sqrt(2.0) * 0.5 if kind == "pyramid" else 0.5
			c.top_radius = 0.5 if kind == "cylinder" else 0.0
			c.radial_segments = 4 if kind == "pyramid" else 24
			c.rings = 1
			m = c
		"sphere":
			var s := SphereMesh.new()
			s.radius = 0.5
			s.height = 1.0
			m = s
		"gable":
			var st := SurfaceTool.new()
			st.begin(Mesh.PRIMITIVE_TRIANGLES)
			for i in range(0, GABLE.size(), 3):
				var a := Vector3(GABLE[i][0], GABLE[i][1], GABLE[i][2])
				var b := Vector3(GABLE[i + 1][0], GABLE[i + 1][1], GABLE[i + 1][2])
				var c := Vector3(GABLE[i + 2][0], GABLE[i + 2][1], GABLE[i + 2][2])
				# three.js: antihorario = frente; Godot: horario (se invierte el orden)
				for v in [a, c, b]:
					st.set_uv(Vector2(v.x + 0.5, 0.5 - v.y))
					st.add_vertex(v)
			st.generate_normals()
			m = st.commit()
	_unit[kind] = m
	return m


static func _primitives_base(parts_def: Array) -> Dictionary:
	var parts: Array = []
	for p in parts_def:
		var mesh := _unit_prim(str(p.kind))
		if mesh == null:
			continue
		var rot := Vector3(deg_to_rad(p.rot[0]), deg_to_rad(p.rot[1]), deg_to_rad(p.rot[2]))
		var xf := Transform3D(Basis.from_euler(rot, EULER_ORDER_XYZ) * Basis.from_scale(Vector3(p.size[0], p.size[1], p.size[2])), Vector3(p.pos[0], p.pos[1], p.pos[2]))
		var surfs := _prepare_surfaces(mesh)
		for s in surfs:
			s.slot = "pieza:" + str(p.id)
			s.color = Color(str(p.color))
			s.albedo = null
		parts.append([surfs, xf])
	return _normalized(parts)


# ------------------------------------------------------------------ materiales

## Material del shader de Kenney: textura original del modelo o la del catálogo (tp).
## normal / rough: mapas de relieve y rugosidad del propio modelo (assets detallados).
static func _material_for(albedo: Texture2D, color: Color, tp: Dictionary, normal: Texture2D = null, rough: Texture2D = null, cut := false) -> Material:
	var tex_url: String = str(tp.texture) if tp.get("texture") != null else ""
	var override: Texture2D = Catalog.texture(tex_url) if tex_url != "" else null
	var key := "%s|%s|%s|%s|%s" % [str(albedo.get_instance_id()) if albedo else "-", color, JSON.stringify(tp) if override else "", str(normal.get_instance_id()) if normal else "-", str(rough.get_instance_id()) if rough else "-"] + ("|cut" if cut else "")
	if _materials.has(key):
		return _materials[key]
	if _shader == null:
		_shader = load("res://shaders/kenney.gdshader")
	var m := ShaderMaterial.new()
	m.shader = _shader
	if override:
		m.set_shader_parameter("albedo_tex", override)
		m.set_shader_parameter("albedo_color", Color.WHITE)
		m.set_shader_parameter("tex_mode", 2 if tp.get("mapping", "uv") == "box" else 1)
		m.set_shader_parameter("uv_repeat", Vector2(float(tp.get("repeatX", 1)), float(tp.get("repeatY", 1))))
		m.set_shader_parameter("uv_offset", Vector2(float(tp.get("offsetX", 0)), float(tp.get("offsetY", 0))))
		m.set_shader_parameter("uv_rotation", deg_to_rad(float(tp.get("rotation", 0))))
		m.set_shader_parameter("box_tile", float(tp.get("tile", 3)))
	else:
		m.set_shader_parameter("albedo_tex", albedo if albedo else _white())
		m.set_shader_parameter("albedo_color", color)
	if normal:
		m.set_shader_parameter("normal_tex", normal)
		m.set_shader_parameter("has_normal", true)
	if rough:
		m.set_shader_parameter("rough_tex", rough)
		m.set_shader_parameter("has_rough", true)
	if cut:
		m.set_shader_parameter("alpha_cut", true)
	_materials[key] = m
	return m


static var _white_tex: Texture2D
static func _white() -> Texture2D:
	if _white_tex == null:
		var img := Image.create(1, 1, false, Image.FORMAT_RGBA8)
		img.fill(Color.WHITE)
		_white_tex = ImageTexture.create_from_image(img)
	return _white_tex


static func _image_of(tex: Texture2D) -> Image:
	if tex == null:
		return null
	var k := tex.get_instance_id()
	if _images.has(k):
		return _images[k]
	var img := tex.get_image()
	if img and img.is_compressed():
		img.decompress()
	_images[k] = img
	return img


## Superficies de una malla, sin índices, con UV2.x = semilla del panel de cristal
## (0 si no lo es): [{ arrays, slot (nombre del material), albedo, color }].
static func _prepare_surfaces(src: Mesh) -> Array:
	var out: Array = []
	for s in src.get_surface_count():
		var arrays := src.surface_get_arrays(s)
		var mat := src.surface_get_material(s)
		var verts: PackedVector3Array = arrays[Mesh.ARRAY_VERTEX]
		var normals: PackedVector3Array = arrays[Mesh.ARRAY_NORMAL] if arrays[Mesh.ARRAY_NORMAL] != null else PackedVector3Array()
		var uvs: PackedVector2Array = arrays[Mesh.ARRAY_TEX_UV] if arrays[Mesh.ARRAY_TEX_UV] != null else PackedVector2Array()
		var idx: PackedInt32Array = arrays[Mesh.ARRAY_INDEX] if arrays[Mesh.ARRAY_INDEX] != null else PackedInt32Array()
		var v := PackedVector3Array()
		var n := PackedVector3Array()
		var uv := PackedVector2Array()
		var count := idx.size() if idx.size() > 0 else verts.size()
		v.resize(count)
		n.resize(count)
		uv.resize(count)
		for i in count:
			var j := idx[i] if idx.size() > 0 else i
			v[i] = verts[j]
			n[i] = normals[j] if normals.size() > 0 else Vector3.UP
			uv[i] = uvs[j] if uvs.size() > 0 else Vector2.ZERO
		var std := mat as StandardMaterial3D
		var tex: Texture2D = std.albedo_texture if std else null
		var a := []
		a.resize(Mesh.ARRAY_MAX)
		a[Mesh.ARRAY_VERTEX] = v
		a[Mesh.ARRAY_NORMAL] = n
		a[Mesh.ARRAY_TEX_UV] = uv
		# assets detallados: color por vértice (suciedad, desgaste), tangentes (relieve) y
		# mapas de relieve y rugosidad propios
		var src_col: PackedColorArray = arrays[Mesh.ARRAY_COLOR] if arrays[Mesh.ARRAY_COLOR] != null else PackedColorArray()
		var src_tan: PackedFloat32Array = arrays[Mesh.ARRAY_TANGENT] if arrays[Mesh.ARRAY_TANGENT] != null else PackedFloat32Array()
		if src_col.size() > 0:
			var col := PackedColorArray()
			col.resize(count)
			for i in count:
				col[i] = src_col[idx[i] if idx.size() > 0 else i]
			a[Mesh.ARRAY_COLOR] = col
		if src_tan.size() > 0:
			var tan := PackedFloat32Array()
			tan.resize(count * 4)
			for i in count:
				var j := idx[i] if idx.size() > 0 else i
				for c in 4:
					tan[i * 4 + c] = src_tan[j * 4 + c]
			a[Mesh.ARRAY_TANGENT] = tan
		var normal: Texture2D = std.normal_texture if std and std.normal_enabled else null
		var rough: Texture2D = std.roughness_texture if std else null
		var cut := std != null and std.transparency == BaseMaterial3D.TRANSPARENCY_ALPHA_SCISSOR
		if normal == null:
			a[Mesh.ARRAY_TEX_UV2] = _window_seeds(v, uv, _image_of(tex))
		else:
			# las ventanas iluminadas solo tienen sentido en la paleta de Kenney
			var none := PackedVector2Array()
			none.resize(count)
			a[Mesh.ARRAY_TEX_UV2] = none
		# aristas reales del modelo (silueta cuando el halo de visión lo oculta)
		a[Mesh.ARRAY_CUSTOM1] = Occlusion.edge_bary(v)
		var slot: String = mat.resource_name if mat and mat.resource_name != "" else "material %d" % (s + 1)
		out.append({"arrays": a, "slot": slot, "albedo": tex, "color": std.albedo_color if std else Color.WHITE, "normal": normal, "rough": rough, "cut": cut})
	return out


## Triángulos cuyo color en la textura es el azul claro de los cristales de Kenney,
## agrupados en paneles (mismo plano y arista compartida). Cada panel, una semilla.
static func _window_seeds(v: PackedVector3Array, uv: PackedVector2Array, img: Image) -> PackedVector2Array:
	var out := PackedVector2Array()
	out.resize(v.size())
	if img == null:
		return out
	var w := img.get_width()
	var h := img.get_height()
	var tri := v.size() / 3
	var is_win := PackedByteArray()
	is_win.resize(tri)
	var normals: Array[Vector3] = []
	normals.resize(tri)
	var any := false
	for t in tri:
		var u := (uv[t * 3].x + uv[t * 3 + 1].x + uv[t * 3 + 2].x) / 3.0
		var vv := (uv[t * 3].y + uv[t * 3 + 1].y + uv[t * 3 + 2].y) / 3.0
		var px := clampi(int((u - floorf(u)) * w), 0, w - 1)
		var py := clampi(int((vv - floorf(vv)) * h), 0, h - 1)
		var c := img.get_pixel(px, py)
		# solo el azul claro de los cristales, no los marcos gris azulados
		if (c.b - c.r) * 255.0 > 70.0 and c.b * 255.0 > 190.0:
			is_win[t] = 1
			any = true
		normals[t] = (v[t * 3 + 1] - v[t * 3]).cross(v[t * 3 + 2] - v[t * 3]).normalized()
	if not any:
		return out
	var parent := PackedInt32Array()
	parent.resize(tri)
	for t in tri:
		parent[t] = t
	var edges := {}
	for t in tri:
		if is_win[t] == 0:
			continue
		for k in 3:
			var a := v[t * 3 + k].snappedf(0.001)
			var b := v[t * 3 + (k + 1) % 3].snappedf(0.001)
			var ek := [a, b] if str(a) < str(b) else [b, a]
			var ekey := str(ek)
			if not edges.has(ekey):
				edges[ekey] = t
			else:
				var o: int = edges[ekey]
				if normals[o].dot(normals[t]) > 0.98:
					parent[_find(parent, t)] = _find(parent, o)
	for t in tri:
		if is_win[t] == 0:
			continue
		var root := _find(parent, t)
		var sd := fmod(absf(sin(root * 12.9898 + 78.233) * 43758.5453), 1.0)
		var val := sd * 0.999 + 0.0005
		for k in 3:
			out[t * 3 + k] = Vector2(val, 0.0)
	return out


static func _find(parent: PackedInt32Array, i: int) -> int:
	while parent[i] != i:
		parent[i] = parent[parent[i]]
		i = parent[i]
	return i
