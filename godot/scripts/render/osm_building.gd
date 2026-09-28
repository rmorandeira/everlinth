class_name OsmBuilding
## Edificio real: la planta de OpenStreetMap extruida hasta sus plantas (1 planta = 1
## unidad = 3 m), con la fachada procedural de osm_building.gdshader (material, tono,
## galerías y bajos comerciales según el tipo y una semilla por edificio). Las casas
## bajas de planta rectangular llevan tejado a cuatro aguas de teja; el resto, azotea.

const Y0 := 0.05
# Paleta de fachadas de A Coruña: blancos, cremas, ocres suaves, gris granito, algún pastel.
const TINTS := [Color("eeeae0"), Color("e9dfc8"), Color("e2cf9f"), Color("d8c7a6"), Color("cfd3d3"), Color("e6d3c4"), Color("c9d3da"), Color("dcc59a"), Color("f2efe8"), Color("b9b4aa")]
const HOUSES := ["house", "detached", "semidetached_house", "terrace", "bungalow", "farm", "hut", "shed", "garage"]
const SHOPS := ["commercial", "retail", "apartments", "residential", "yes", "hotel", "office", "mixed_use"]

static var _mat: ShaderMaterial


static func material() -> ShaderMaterial:
	if _mat == null:
		_mat = ShaderMaterial.new()
		_mat.shader = load("res://shaders/osm_building.gdshader")
	return _mat


static func _hash(s: String, k: int) -> float:
	var h := hash(s + str(k))
	return float(h & 0xFFFF) / 65535.0


## poly: planta en unidades de render (x, z). Devuelve [malla, altura].
## grounded: apoyado en el relieve (la base sigue la parte baja del solar y los muros
## bajan un poco bajo tierra; la cornisa, sobre la parte alta).
static func build(poly: PackedVector2Array, floors: int, t: String, id: String, center_dist: float, grounded := false) -> Array:
	if Geometry2D.is_polygon_clockwise(poly):
		poly.reverse()
	var r1 := _hash(id, 1)
	var r2 := _hash(id, 2)
	var r3 := _hash(id, 3)
	var lo := 0.0
	var hi := 0.0
	if grounded and not Terrain.is_flat():
		lo = INF
		hi = -INF
		for p in poly:
			var e := Terrain.at(p.x, p.y)
			lo = minf(lo, e)
			hi = maxf(hi, e)
	var base := Y0 + lo
	var top := Y0 + hi + maxf(1.0, float(floors)) * 1.0
	var h := top - base
	# material: 0-2 ladrillo, 3 hormigón claro, 4 estuco, 5 hormigón viejo (granito)
	var layer := 4.0
	if r1 > 0.62:
		layer = 3.0
	if r1 > 0.74:
		layer = 5.0
	if r1 > 0.84:
		layer = 2.0
	if r1 > 0.92:
		layer = 0.0
	if r1 > 0.97:
		layer = 1.0
	var tint: Color = TINTS[int(r2 * TINTS.size()) % TINTS.size()]
	var gal := 0.0
	var gal_p := 0.3 if center_dist < 900.0 else 0.06
	if floors >= 3 and floors <= 9 and t in ["apartments", "residential", "yes"] and r3 < gal_p:
		gal = 1.0
	var shop := 1.0 if floors >= 3 and t in SHOPS and _hash(id, 4) < 0.8 else 0.0
	var st := SurfaceTool.new()
	st.begin(Mesh.PRIMITIVE_TRIANGLES)
	st.set_custom_format(0, SurfaceTool.CUSTOM_RGBA_FLOAT)
	var custom := Color(layer, gal, r3, shop)
	# paredes
	var n := poly.size()
	for i in n:
		var a := poly[i]
		var b := poly[(i + 1) % n]
		var e := b - a
		var len := e.length()
		if len < 0.001:
			continue
		# polígono antihorario (visto desde arriba, con z hacia abajo en pantalla): la normal
		# exterior queda a la derecha del sentido de recorrido en XZ
		var nrm := Vector3(e.y, 0.0, -e.x).normalized()
		var mid := (a + b) * 0.5 + Vector2(nrm.x, nrm.z) * 0.01
		if Geometry2D.is_point_in_polygon(mid, poly):
			nrm = -nrm
		var v := [Vector3(a.x, base - 0.15, a.y), Vector3(b.x, base - 0.15, b.y), Vector3(b.x, top, b.y), Vector3(a.x, top, a.y)]
		var uvs := [Vector2(0, -0.15), Vector2(len, -0.15), Vector2(len, h), Vector2(0, h)]
		var order := [0, 1, 2, 0, 2, 3]
		if (v[1] - v[0]).cross(v[2] - v[0]).dot(nrm) > 0.0:
			order = [0, 2, 1, 0, 3, 2]
		for k in order:
			st.set_normal(nrm)
			st.set_color(tint)
			st.set_uv(uvs[k])
			st.set_uv2(Vector2(len, h))
			st.set_custom(0, custom)
			st.add_vertex(v[k])
	# cubierta
	var hip := t in HOUSES and floors <= 3 and n == 4
	if hip:
		_hip_roof(st, poly, top, tint, custom, h)
	else:
		var tris := Geometry2D.triangulate_polygon(poly)
		for i in range(0, tris.size(), 3):
			var pa := poly[tris[i]]
			var pb := poly[tris[i + 1]]
			var pc := poly[tris[i + 2]]
			var va := Vector3(pa.x, top, pa.y)
			var vb := Vector3(pb.x, top, pb.y)
			var vc := Vector3(pc.x, top, pc.y)
			var tri := [va, vb, vc]
			if (vb - va).cross(vc - va).y > 0.0:
				tri = [va, vc, vb]
			for vv in tri:
				st.set_normal(Vector3.UP)
				st.set_color(tint)
				st.set_uv(Vector2.ZERO)
				st.set_uv2(Vector2(0, h))
				st.set_custom(0, custom)
				st.add_vertex(vv)
	# los datos quedan también en memoria: la malla fundida por sala se hace con ellos
	var arrays := st.commit_to_arrays()
	arrays[Mesh.ARRAY_CUSTOM1] = Occlusion.edge_bary(arrays[Mesh.ARRAY_VERTEX])
	var mesh := ArrayMesh.new()
	mesh.add_surface_from_arrays(Mesh.PRIMITIVE_TRIANGLES, arrays, [], {}, Occlusion.format(true))
	mesh.surface_set_material(0, material())
	return [mesh, h + (0.4 if hip else 0.0), top, arrays]


## Tejado a cuatro aguas sobre una planta de cuatro lados: cumbrera por el eje largo.
static func _hip_roof(st: SurfaceTool, p: PackedVector2Array, top: float, tint: Color, custom: Color, h: float) -> void:
	var c := (p[0] + p[1] + p[2] + p[3]) * 0.25
	var l0 := p[0].distance_to(p[1]) + p[2].distance_to(p[3])
	var l1 := p[1].distance_to(p[2]) + p[3].distance_to(p[0])
	var axis := ((p[1] - p[0]) + (p[2] - p[3])).normalized() if l0 >= l1 else ((p[2] - p[1]) + (p[3] - p[0])).normalized()
	var long := maxf(l0, l1) * 0.5
	var short := minf(l0, l1) * 0.5
	var rh := short * 0.36
	var half := maxf(0.0, (long - short) * 0.5)
	var r0 := c - axis * half
	var r1 := c + axis * half
	var R0 := Vector3(r0.x, top + rh, r0.y)
	var R1 := Vector3(r1.x, top + rh, r1.y)
	for i in 4:
		var a := p[i]
		var b := p[(i + 1) % 4]
		var ea := R0 if a.distance_to(r0) <= a.distance_to(r1) else R1
		var eb := R0 if b.distance_to(r0) <= b.distance_to(r1) else R1
		var A := Vector3(a.x, top, a.y)
		var B := Vector3(b.x, top, b.y)
		var faces: Array = [[A, B, eb]]
		if ea != eb:
			faces.append([A, eb, ea])
		for f in faces:
			var nrm: Vector3 = (f[1] - f[0]).cross(f[2] - f[0]).normalized()
			if nrm.y < 0.0:
				nrm = -nrm
				f = [f[0], f[2], f[1]]
			# Godot: frente en sentido horario visto desde fuera
			var tri: Array = [f[0], f[2], f[1]]
			for vv in tri:
				st.set_normal(nrm)
				st.set_color(tint)
				st.set_uv(Vector2.ZERO)
				st.set_uv2(Vector2(0, h))
				st.set_custom(0, custom)
				st.add_vertex(vv)
