class_name Kenney
## Modelos low-poly de Kenney (CC0, ver assets/models/*/License.txt): edificios del
## City Kit Commercial, casas del City Kit Suburban y mobiliario del Retro Urban Kit
## (mismo reparto que client/src/render3d/models3d.ts). Cada modelo se prepara una
## vez: se normaliza (base en y=0, centrado en X/Z, frente hacia +Z) y se marcan sus
## paneles de cristal para las ventanas iluminadas (UV2.x, ver kenney.gdshader).

## Escala de cada kit a unidades de render (1 unidad = 3 m).
const KIT_SCALE := {"commercial": 2.9, "suburban": 2.7, "retro": 2.1}

const COMMERCIAL_LOW := ["building-a", "building-b", "building-c", "building-d", "building-e", "building-h", "building-k"]
const COMMERCIAL_MID := ["building-f", "building-g", "building-i", "building-j", "building-l", "building-m", "building-n"]
const SKYSCRAPERS := ["building-skyscraper-a", "building-skyscraper-b", "building-skyscraper-c", "building-skyscraper-d", "building-skyscraper-e"]

static var _sets := {}
static var _models := {} # key -> { parts: [[Mesh, Transform3D]], size: Vector3 } ({} si no existe)
static var _images := {} # ruta de textura -> Image
static var _materials := {} # ruta de textura + color -> ShaderMaterial
static var _shader: Shader


## Conjuntos de edificios por altura: low, mid, tall, tiny, house (claves "kit/nombre").
static func building_sets() -> Dictionary:
	if _sets.is_empty():
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


## Tamaño del modelo normalizado, en unidades del kit (Vector3.ZERO si no existe).
static func size(key: String) -> Vector3:
	var m := model(key)
	return m.size if not m.is_empty() else Vector3.ZERO


## Piezas del modelo: [[Mesh, Transform3D relativo a la base normalizada], ...].
static func model(key: String) -> Dictionary:
	if _models.has(key):
		return _models[key]
	var path := "res://assets/models/%s.glb" % key
	if not ResourceLoader.exists(path):
		push_warning("Modelo no encontrado: " + key)
		_models[key] = {}
		return {}
	var root: Node = (load(path) as PackedScene).instantiate()
	var parts: Array = []
	_collect(root, Transform3D(), parts)
	root.free()
	var box := AABB()
	for i in parts.size():
		var b: AABB = parts[i][1] * (parts[i][0] as Mesh).get_aabb()
		box = b if i == 0 else box.merge(b)
	var center := box.get_center()
	var off := Transform3D(Basis(), Vector3(-center.x, -box.position.y, -center.z))
	for p in parts:
		p[1] = off * p[1]
	_models[key] = {"parts": parts, "size": box.size}
	return _models[key]


static func _collect(n: Node, parent: Transform3D, out: Array) -> void:
	var xf := parent
	if n is Node3D:
		xf = parent * (n as Node3D).transform
	if n is MeshInstance3D and (n as MeshInstance3D).mesh:
		out.append([_prepare_mesh((n as MeshInstance3D).mesh), xf])
	for c in n.get_children():
		_collect(c, xf, out)


static func _material_for(src: Material) -> Material:
	if not (src is StandardMaterial3D):
		return src
	var std := src as StandardMaterial3D
	var tex := std.albedo_texture
	var key := (tex.resource_path if tex else "-") + str(std.albedo_color)
	if _materials.has(key):
		return _materials[key]
	if _shader == null:
		_shader = load("res://shaders/kenney.gdshader")
	var m := ShaderMaterial.new()
	m.shader = _shader
	if tex:
		m.set_shader_parameter("albedo_tex", tex)
	else:
		m.set_shader_parameter("albedo_tex", _white())
	m.set_shader_parameter("albedo_color", std.albedo_color)
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
	var k := tex.resource_path
	if _images.has(k):
		return _images[k]
	var img := tex.get_image()
	if img and img.is_compressed():
		img.decompress()
	_images[k] = img
	return img


## Copia la malla sin índices, con UV2.x = semilla del panel de cristal (0 si no lo es)
## y el material del shader de Kenney.
static func _prepare_mesh(src: Mesh) -> ArrayMesh:
	var out := ArrayMesh.new()
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
		var tex: Texture2D = (mat as StandardMaterial3D).albedo_texture if mat is StandardMaterial3D else null
		var uv2 := _window_seeds(v, uv, _image_of(tex))
		var a := []
		a.resize(Mesh.ARRAY_MAX)
		a[Mesh.ARRAY_VERTEX] = v
		a[Mesh.ARRAY_NORMAL] = n
		a[Mesh.ARRAY_TEX_UV] = uv
		a[Mesh.ARRAY_TEX_UV2] = uv2
		out.add_surface_from_arrays(Mesh.PRIMITIVE_TRIANGLES, a)
		out.surface_set_material(out.get_surface_count() - 1, _material_for(mat))
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
