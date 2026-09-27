class_name Landmarks
## Edificios singulares de A Coruña con modelo propio:
## - Estadio de Riazor (hito del servidor: centro, largo, ancho y orientación reales):
##   campo de 105 × 68 m con sus líneas, graderío continuo en pendiente con asientos
##   azules y blancos, fachada exterior de chapa, cubierta volada sobre pilares.
## - Palacio de los Deportes de Riazor (edificio de OSM por nombre): su planta real con
##   muros acristalados y la gran cúpula rebajada de chapa.

const T := Protocol.TILE_SIZE
const PITCH := Vector2(70.0, 45.33) # 105 × 68 m en tiles
const K := 6                         # puntos por esquina redondeada
const S := 10                        # tramos por lado recto

static var _mats := {}


static func mat(mode: int, tone := Color.WHITE) -> Material:
	var key := "%d%s" % [mode, tone.to_html()]
	if not _mats.has(key):
		var m := ShaderMaterial.new()
		m.shader = load("res://shaders/stadium.gdshader")
		m.set_shader_parameter("mode", mode)
		m.set_shader_parameter("tone", tone)
		_mats[key] = m
	return _mats[key]


## Anillo de rectángulo redondeado (coordenadas locales a lo largo / a lo ancho), con el
## mismo número de puntos para cualquier tamaño: los anillos se unen punto a punto.
static func ring(ha: float, hb: float, r: float) -> PackedVector2Array:
	var out := PackedVector2Array()
	var cs := [Vector2(ha - r, hb - r), Vector2(-(ha - r), hb - r), Vector2(-(ha - r), -(hb - r)), Vector2(ha - r, -(hb - r))]
	for q in 4:
		for k in K + 1:
			var a := (q + float(k) / K) * PI * 0.5
			out.append(cs[q] + Vector2(cos(a), sin(a)) * r)
		var from: Vector2 = cs[q] + Vector2(cos((q + 1) * PI * 0.5), sin((q + 1) * PI * 0.5)) * r
		var q2 := (q + 1) % 4
		var to: Vector2 = cs[q2] + Vector2(cos(q2 * PI * 0.5), sin(q2 * PI * 0.5)) * r
		for s in range(1, S):
			out.append(from.lerp(to, float(s) / S))
	return out


static func _quad(b: GeoBatch, m: Material, p0: Vector3, p1: Vector3, p2: Vector3, p3: Vector3, u0: Vector2, u1: Vector2, u2: Vector2, u3: Vector2, outward: Vector3) -> void:
	var n := (p1 - p0).cross(p3 - p0).normalized()
	if n.dot(outward) < 0.0:
		n = -n
	b.tri(m, p0, p1, p2, n, u0, u1, u2)
	b.tri(m, p0, p2, p3, n, u0, u2, u3)


static func build(root: Node3D, l: Dictionary, ogx: int, ogz: int) -> void:
	if str(l.kind) == "stadium":
		_stadium(root, l, ogx, ogz)


static func _stadium(root: Node3D, l: Dictionary, ogx: int, ogz: int) -> void:
	var ang := float(l.ang)
	var A := Vector2(sin(ang), -cos(ang)) # eje largo (tiles)
	var B := Vector2(cos(ang), sin(ang))
	var c := Vector2(float(l.x), float(l.y))
	var to3 := func(p: Vector2, y: float) -> Vector3:
		var g: Vector2 = c + A * p.x + B * p.y
		return Vector3((g.x - ogx) * T, y, (g.y - ogz) * T)
	var ha := float(l.len) * 0.5
	var hb := float(l.wid) * 0.5
	var inner := ring(PITCH.x * 0.5 + 5.0, PITCH.y * 0.5 + 4.5, 5.0)
	var outer := ring(ha, hb, 16.0)
	var n := inner.size()
	var top := PackedVector2Array()
	var roof_in := PackedVector2Array()
	for i in n:
		top.append(inner[i].lerp(outer[i], 0.9))
		roof_in.append(inner[i].lerp(outer[i], 0.3))
	var H_TOP := 7.0
	var Y_IN := 0.35
	var H_ROOF := H_TOP + 1.7
	var b := GeoBatch.new()
	var flat := GeoBatch.new()
	var seats := mat(1)
	var conc := mat(2, Color(0.72, 0.71, 0.68))
	var skin := mat(2, Color(0.86, 0.88, 0.9))
	var blue := mat(2, Color(0.14, 0.3, 0.62))
	var roof := mat(2, Color(0.93, 0.93, 0.92))
	# campo y su entorno
	var cc: Vector3 = to3.call(Vector2.ZERO, 0.0)
	var pitch_ang := atan2(A.y, A.x)
	flat.quad(StreetFurniture.lambert(Color("2c5a24")), cc + Vector3(0, 0.058, 0), (PITCH.x + 12.0) * T, (PITCH.y + 11.0) * T, pitch_ang)
	var pc: Array = []
	for s in [Vector2(-1, -1), Vector2(1, -1), Vector2(1, 1), Vector2(-1, 1)]:
		pc.append(to3.call(Vector2(s.x * PITCH.x * 0.5, s.y * PITCH.y * 0.5), 0.062))
	var pu := [Vector2(0, 0), Vector2(1, 0), Vector2(1, 1), Vector2(0, 1)]
	_quad(flat, mat(0), pc[0], pc[1], pc[2], pc[3], pu[0], pu[1], pu[2], pu[3], Vector3.UP)
	# graderío, pasarela superior, fachada y cubierta, tramo a tramo
	var acc := 0.0
	var cols := 0
	for i in n:
		var j := (i + 1) % n
		var seg := inner[i].distance_to(inner[j]) * T
		var up := inner[i].distance_to(top[i]) * T
		var up_j := inner[j].distance_to(top[j]) * T
		var p_in_i: Vector3 = to3.call(inner[i], Y_IN)
		var p_in_j: Vector3 = to3.call(inner[j], Y_IN)
		var p_top_i: Vector3 = to3.call(top[i], H_TOP)
		var p_top_j: Vector3 = to3.call(top[j], H_TOP)
		var inward: Vector3 = (cc - p_in_i).normalized()
		_quad(b, seats, p_in_i, p_in_j, p_top_j, p_top_i, Vector2(acc, 0), Vector2(acc + seg, 0), Vector2(acc + seg, up_j), Vector2(acc, up), inward + Vector3.UP)
		# murete del campo
		var g_i: Vector3 = to3.call(inner[i], 0.05)
		var g_j: Vector3 = to3.call(inner[j], 0.05)
		_quad(b, blue, g_i, g_j, p_in_j, p_in_i, Vector2(acc, 0), Vector2(acc + seg, 0), Vector2(acc + seg, 0.3), Vector2(acc, 0.3), inward)
		# pasarela superior
		var o_i: Vector3 = to3.call(outer[i], H_TOP + 0.4)
		var o_j: Vector3 = to3.call(outer[j], H_TOP + 0.4)
		_quad(b, conc, p_top_i, p_top_j, o_j, o_i, Vector2(acc, 0), Vector2(acc + seg, 0), Vector2(acc + seg, 1), Vector2(acc, 1), Vector3.UP)
		# fachada exterior: zócalo azul y chapa clara
		var og_i: Vector3 = to3.call(outer[i], -3.0)
		var og_j: Vector3 = to3.call(outer[j], -3.0)
		var om_i: Vector3 = to3.call(outer[i], 1.2)
		var om_j: Vector3 = to3.call(outer[j], 1.2)
		var ow := -inward
		_quad(b, blue, og_i, og_j, om_j, om_i, Vector2(acc, 0), Vector2(acc + seg, 0), Vector2(acc + seg, 1.15), Vector2(acc, 1.15), ow)
		_quad(b, skin, om_i, om_j, o_j, o_i, Vector2(acc, 1.2), Vector2(acc + seg, 1.2), Vector2(acc + seg, H_TOP + 0.4), Vector2(acc, H_TOP + 0.4), ow)
		# cubierta volada: de la fachada hacia el campo, algo inclinada, con canto
		var r_o_i: Vector3 = to3.call(outer[i], H_ROOF)
		var r_o_j: Vector3 = to3.call(outer[j], H_ROOF)
		var r_i_i: Vector3 = to3.call(roof_in[i], H_ROOF - 0.35)
		var r_i_j: Vector3 = to3.call(roof_in[j], H_ROOF - 0.35)
		var dn := Vector3(0, -0.14, 0)
		_quad(b, roof, r_o_i, r_o_j, r_i_j, r_i_i, Vector2(acc, 0), Vector2(acc + seg, 0), Vector2(acc + seg, 1), Vector2(acc, 1), Vector3.UP)
		_quad(b, conc, r_o_i + dn, r_o_j + dn, r_i_j + dn, r_i_i + dn, Vector2(acc, 0), Vector2(acc + seg, 0), Vector2(acc + seg, 1), Vector2(acc, 1), Vector3.DOWN)
		_quad(b, roof, r_i_i, r_i_j, r_i_j + dn, r_i_i + dn, Vector2(acc, 0), Vector2(acc + seg, 0), Vector2(acc + seg, 0.14), Vector2(acc, 0.14), inward)
		_quad(b, skin, o_i, o_j, r_o_j, r_o_i, Vector2(acc, 0), Vector2(acc + seg, 0), Vector2(acc + seg, 1), Vector2(acc, 1), ow)
		# pilares de la cubierta y focos bajo el borde
		cols += 1
		if cols % 3 == 0:
			var box := StreetFurniture.prim("box")
			var pm: Vector3 = to3.call(outer[i].lerp(top[i], 0.5), 0.0)
			b.mesh(box, Transform3D(Basis().scaled(Vector3(0.12, 1.4, 0.12)), pm + Vector3(0, H_TOP + 0.4 + 0.7, 0)), conc)
			var lp: Vector3 = to3.call(roof_in[i].lerp(outer[i], 0.04), H_ROOF - 0.55)
			b.mesh(box, Transform3D(Basis().scaled(Vector3(0.22, 0.08, 0.22)), lp), StreetFurniture.lambert(Color("f4f6ff")))
		acc += seg
	for pair in [[b, true], [flat, false]]:
		var mesh: ArrayMesh = pair[0].to_mesh()
		var mi := MeshInstance3D.new()
		mi.mesh = mesh
		mi.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_ON if pair[1] else GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
		mi.position.y = Terrain.h(c.x, c.y) # el estadio, en su explanada
		root.add_child(mi)


## Modelo propio para un edificio de OSM con nombre (o [] si no lo tiene).
static func named_building(name: String, poly: PackedVector2Array, floors: int) -> Array:
	var low := name.to_lower()
	if low.contains("palacio de los deportes") or low.contains("pazo dos deportes"):
		return _dome_hall(poly, name)
	return []


## Pabellón con muros acristalados y cúpula rebajada de chapa sobre su planta real.
static func _dome_hall(poly: PackedVector2Array, id: String) -> Array:
	var walls := 4
	var built := OsmBuilding.build(poly, walls, "commercial", id, 0.0, true)
	var mesh: ArrayMesh = built[0]
	var base: float = built[2]
	var c := Vector2.ZERO
	for p in poly:
		c += p
	c /= poly.size()
	var radius := 0.0
	for p in poly:
		radius = maxf(radius, p.distance_to(c))
	var dh := clampf(radius * 0.28, 1.2, 4.0)
	var rings := 6
	var st := SurfaceTool.new()
	st.begin(Mesh.PRIMITIVE_TRIANGLES)
	var pts := poly
	if Geometry2D.is_polygon_clockwise(pts):
		pts = pts.duplicate()
		pts.reverse()
	var level := func(k: int, p: Vector2) -> Vector3:
		var r := 1.0 - float(k) / rings
		var q := c + (p - c) * r
		return Vector3(q.x, base + dh * sqrt(maxf(0.0, 1.0 - r * r)), q.y)
	var n := pts.size()
	for k in rings:
		var acc := 0.0
		for i in n:
			var j := (i + 1) % n
			var a0: Vector3 = level.call(k, pts[i])
			var b0: Vector3 = level.call(k, pts[j])
			var a1: Vector3 = level.call(k + 1, pts[i])
			var b1: Vector3 = level.call(k + 1, pts[j])
			var seg := a0.distance_to(b0)
			var quad := [[a0, Vector2(acc, a0.y)], [b0, Vector2(acc + seg, b0.y)], [b1, Vector2(acc + seg, b1.y)], [a1, Vector2(acc, a1.y)]]
			for tri in [[0, 1, 2], [0, 2, 3]]:
				var v0: Vector3 = quad[tri[0]][0]
				var v1: Vector3 = quad[tri[1]][0]
				var v2: Vector3 = quad[tri[2]][0]
				var nrm := (v1 - v0).cross(v2 - v0)
				if nrm.length() < 0.00001:
					continue
				nrm = nrm.normalized()
				var order: Array = tri
				if nrm.y < 0.0:
					nrm = -nrm
				else:
					order = [tri[0], tri[2], tri[1]]
				for o in order:
					st.set_normal(nrm)
					st.set_uv(quad[o][1])
					st.add_vertex(quad[o][0])
			acc += seg
	st.commit(mesh)
	mesh.surface_set_material(mesh.get_surface_count() - 1, mat(2, Color(0.74, 0.77, 0.8)))
	return [mesh, walls + dh]
