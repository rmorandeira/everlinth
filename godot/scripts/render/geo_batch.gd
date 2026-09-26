class_name GeoBatch
## Acumulador de geometría fusionada por material (como la clase Batch de city3d.ts):
## miles de cuadriláteros de calzada, marcas y manchas acaban en una malla por material.

var _lists := {} # Material -> [PackedVector3Array, PackedVector3Array, PackedVector2Array]


func _list(mat: Material) -> Array:
	if not _lists.has(mat):
		_lists[mat] = [PackedVector3Array(), PackedVector3Array(), PackedVector2Array()]
	return _lists[mat]


func is_empty() -> bool:
	return _lists.is_empty()


## Triángulo con normal n; el orden se corrige para que mire hacia n (Godot: horario = frente).
func tri(mat: Material, a: Vector3, b: Vector3, c: Vector3, n: Vector3, ua: Vector2, ub: Vector2, uc: Vector2) -> void:
	var l := _list(mat)
	if (b - a).cross(c - a).dot(n) > 0.0:
		l[0].append_array([a, c, b])
		l[2].append_array([ua, uc, ub])
	else:
		l[0].append_array([a, b, c])
		l[2].append_array([ua, ub, uc])
	l[1].append_array([n, n, n])


## Rectángulo plano centrado en c: largo `length` en la dirección `ang` (plano XZ) y
## ancho `w`. uv_world > 0: UV según la posición en el mundo (texturas que se repiten).
## uv_x: repeticiones de la textura a lo largo del rectángulo.
func quad(mat: Material, c: Vector3, length: float, w: float, ang: float, uv_world := 0.0, uv_x := 1.0) -> void:
	var a := Vector3(cos(ang), 0.0, sin(ang)) * (length * 0.5)
	var b := Vector3(-sin(ang), 0.0, cos(ang)) * (w * 0.5)
	var p00 := c - a - b
	var p10 := c + a - b
	var p11 := c + a + b
	var p01 := c - a + b
	var u00 := Vector2(0, 0)
	var u10 := Vector2(uv_x, 0)
	var u11 := Vector2(uv_x, 1)
	var u01 := Vector2(0, 1)
	if uv_world > 0.0:
		u00 = Vector2(p00.x, p00.z) / uv_world
		u10 = Vector2(p10.x, p10.z) / uv_world
		u11 = Vector2(p11.x, p11.z) / uv_world
		u01 = Vector2(p01.x, p01.z) / uv_world
	tri(mat, p00, p10, p11, Vector3.UP, u00, u10, u11)
	tri(mat, p00, p11, p01, Vector3.UP, u00, u11, u01)


func disc(mat: Material, c: Vector3, r: float, uv_world := 0.0, segments := 14) -> void:
	for i in segments:
		var a0 := TAU * i / segments
		var a1 := TAU * (i + 1) / segments
		var p0 := c + Vector3(cos(a0), 0.0, sin(a0)) * r
		var p1 := c + Vector3(cos(a1), 0.0, sin(a1)) * r
		var uc := Vector2(0.5, 0.5)
		var u0 := Vector2(0.5 + cos(a0) * 0.5, 0.5 + sin(a0) * 0.5)
		var u1 := Vector2(0.5 + cos(a1) * 0.5, 0.5 + sin(a1) * 0.5)
		if uv_world > 0.0:
			uc = Vector2(c.x, c.z) / uv_world
			u0 = Vector2(p0.x, p0.z) / uv_world
			u1 = Vector2(p1.x, p1.z) / uv_world
		tri(mat, c, p0, p1, Vector3.UP, uc, u0, u1)


## Añade las superficies de una malla transformada (primitivas de Godot incluidas).
## mat: material de todas sus superficies (null = el de cada superficie).
func mesh(m: Mesh, xf: Transform3D, mat: Material = null) -> void:
	# Una escala con determinante negativo invierte el sentido de los triángulos.
	var flip := xf.basis.determinant() < 0.0
	var nxf := Transform3D(xf.basis.inverse().transposed(), Vector3.ZERO)
	for s in m.get_surface_count():
		var flat := _flat_arrays(m, s, flip)
		var mm: Material = mat if mat else m.surface_get_material(s)
		var l := _list(mm)
		l[0].append_array(xf * (flat[0] as PackedVector3Array))
		l[1].append_array(nxf * (flat[1] as PackedVector3Array))
		l[2].append_array(flat[2])


## Vértices sin índices de una superficie (en caché: leerlos del servidor de render es caro).
static var _flat_cache := {}
static func _flat_arrays(m: Mesh, s: int, flip: bool) -> Array:
	var key := "%d:%d:%s" % [m.get_instance_id(), s, flip]
	if _flat_cache.has(key):
		return _flat_cache[key]
	var arrays := m.surface_get_arrays(s)
	var verts: PackedVector3Array = arrays[Mesh.ARRAY_VERTEX]
	var normals: PackedVector3Array = arrays[Mesh.ARRAY_NORMAL] if arrays[Mesh.ARRAY_NORMAL] != null else PackedVector3Array()
	var uvs: PackedVector2Array = arrays[Mesh.ARRAY_TEX_UV] if arrays[Mesh.ARRAY_TEX_UV] != null else PackedVector2Array()
	var idx: PackedInt32Array = arrays[Mesh.ARRAY_INDEX] if arrays[Mesh.ARRAY_INDEX] != null else PackedInt32Array()
	var count := idx.size() if idx.size() > 0 else verts.size()
	var v := PackedVector3Array()
	var n := PackedVector3Array()
	var uv := PackedVector2Array()
	v.resize(count)
	n.resize(count)
	uv.resize(count)
	for i in count:
		var k := i
		if flip:
			k = i - (i % 3) + (2 - (i % 3))
		var j := idx[k] if idx.size() > 0 else k
		v[i] = verts[j]
		n[i] = normals[j] if normals.size() > 0 else Vector3.UP
		uv[i] = uvs[j] if uvs.size() > 0 else Vector2.ZERO
	_flat_cache[key] = [v, n, uv]
	return _flat_cache[key]


## Una ArrayMesh con una superficie por material.
func to_mesh() -> ArrayMesh:
	var out := ArrayMesh.new()
	for mat in _lists:
		var l: Array = _lists[mat]
		if l[0].size() == 0:
			continue
		var a := []
		a.resize(Mesh.ARRAY_MAX)
		a[Mesh.ARRAY_VERTEX] = l[0]
		a[Mesh.ARRAY_NORMAL] = l[1]
		a[Mesh.ARRAY_TEX_UV] = l[2]
		out.add_surface_from_arrays(Mesh.PRIMITIVE_TRIANGLES, a)
		out.surface_set_material(out.get_surface_count() - 1, mat)
	return out


## Un MeshInstance3D por material, colgado de parent.
func build(parent: Node3D, cast_shadows := false) -> void:
	for mat in _lists:
		var l: Array = _lists[mat]
		if l[0].size() == 0:
			continue
		var a := []
		a.resize(Mesh.ARRAY_MAX)
		a[Mesh.ARRAY_VERTEX] = l[0]
		a[Mesh.ARRAY_NORMAL] = l[1]
		a[Mesh.ARRAY_TEX_UV] = l[2]
		var am := ArrayMesh.new()
		am.add_surface_from_arrays(Mesh.PRIMITIVE_TRIANGLES, a)
		am.surface_set_material(0, mat)
		var mi := MeshInstance3D.new()
		mi.mesh = am
		mi.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_ON if cast_shadows else GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
		parent.add_child(mi)
