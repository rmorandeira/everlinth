class_name StreetFurniture
## Mobiliario urbano estilo Nueva York (puerto de streetFurniture3d.ts; unidades de
## render, 1 = 3 m):
## - Farola "cobra": poste troncocónico, brazo curvo hacia la calzada y cabeza ovalada
##   luminosa por debajo.
## - Semáforo de mástil: brazo sobre la calzada con una cabeza por carril, otra en el
##   poste y el semáforo peatonal (mano / peatón) mirando al paso.
## Los focos comparten materiales por "eje" del cruce (A/B): update_signals() los
## cambia cada fotograma, así todos los semáforos cambian de fase de verdad.

const POLE := Color("5f656b")
const SIGNAL_YELLOW := Color("e8b400")
const OFF := {"red": Color("3a0e0e"), "amber": Color("3a2a08"), "green": Color("0c2a14"), "walk": Color("2a2a2a"), "hand": Color("2a1606")}
const ON := {"red": Color("ff2a1a"), "amber": Color("ffb020"), "green": Color("33ff7a"), "walk": Color("f4f4f0"), "hand": Color("ff7a1a")}
const CYCLE := 16.0

static var _prims := {}
static var _mats := {}
static var _lens := {} # "A"/"B" -> { lente -> StandardMaterial3D }
static var _streetlight: ArrayMesh


## Material liso con el recorte de la franja del personaje (solid_cut.gdshader).
static func lambert(c: Color) -> Material:
	var k := c.to_html()
	if not _mats.has(k):
		var m := ShaderMaterial.new()
		m.shader = load("res://shaders/solid_cut.gdshader")
		m.set_shader_parameter("albedo", c)
		_mats[k] = m
	return _mats[k]


static func lens(axis: String, name: String) -> StandardMaterial3D:
	if _lens.is_empty():
		for ax in ["A", "B"]:
			_lens[ax] = {}
			for l in ON:
				var m := StandardMaterial3D.new()
				m.shading_mode = BaseMaterial3D.SHADING_MODE_UNSHADED
				m.albedo_color = OFF[l]
				_lens[ax][l] = m
	return _lens[axis][name]


## Primitivas unitarias (como las geometrías compartidas de la web).
static func prim(kind: String) -> Mesh:
	if _prims.has(kind):
		return _prims[kind]
	var m: Mesh
	match kind:
		"cyl":
			var c := CylinderMesh.new()
			c.top_radius = 1.0
			c.bottom_radius = 1.0
			c.height = 1.0
			c.radial_segments = 6
			c.rings = 0
			m = _shifted(c, Vector3(0, 0.5, 0))
		"cone":
			var c := CylinderMesh.new()
			c.top_radius = 0.6
			c.bottom_radius = 1.0
			c.height = 1.0
			c.radial_segments = 6
			c.rings = 0
			m = _shifted(c, Vector3(0, 0.5, 0))
		"box":
			var b := BoxMesh.new()
			b.size = Vector3.ONE
			m = b
		"sphere":
			var s := SphereMesh.new()
			s.radius = 1.0
			s.height = 2.0
			s.radial_segments = 8
			s.rings = 5
			m = s
		"disc":
			var st := SurfaceTool.new()
			st.begin(Mesh.PRIMITIVE_TRIANGLES)
			st.set_normal(Vector3.BACK)
			for i in 12:
				var a0 := TAU * i / 12.0
				var a1 := TAU * (i + 1) / 12.0
				# mira hacia +Z (como CircleGeometry): horario visto desde +Z
				st.add_vertex(Vector3.ZERO)
				st.add_vertex(Vector3(cos(a1), sin(a1), 0))
				st.add_vertex(Vector3(cos(a0), sin(a0), 0))
			m = st.commit()
	_prims[kind] = m
	return m


static func _shifted(src: Mesh, off: Vector3) -> ArrayMesh:
	var b := GeoBatch.new()
	b.mesh(src, Transform3D(Basis(), off), StandardMaterial3D.new())
	var out := ArrayMesh.new()
	var am := b.to_mesh()
	out.add_surface_from_arrays(Mesh.PRIMITIVE_TRIANGLES, am.surface_get_arrays(0))
	return out


## Pieza: primitiva escalada, girada (euler XYZ, como three.js) y colocada.
static func part(b: GeoBatch, parent: Transform3D, kind: String, mat: Material, s: Vector3, p: Vector3, rot := Vector3.ZERO) -> void:
	var basis := Basis.from_euler(rot, EULER_ORDER_XYZ) * Basis.from_scale(s)
	b.mesh(prim(kind), parent * Transform3D(basis, p), mat)


## Malla de la farola en su marco local (+X = hacia la calzada, base en y=0).
static func streetlight_mesh() -> ArrayMesh:
	if _streetlight:
		return _streetlight
	var b := GeoBatch.new()
	var g := Transform3D()
	var H := 2.9
	part(b, g, "cyl", lambert(POLE), Vector3(0.075, 0.25, 0.075), Vector3.ZERO)
	part(b, g, "cone", lambert(POLE), Vector3(0.045, H, 0.045), Vector3(0, 0.25, 0))
	var R := 0.35
	var top := 0.25 + H
	var px := 0.0
	var py := top - R
	for i in range(1, 4):
		var a := (i / 3.0) * (PI / 2.0)
		var nx := R - cos(a) * R
		var ny := top - R + sin(a) * R
		var l := Vector2(nx - px, ny - py).length()
		part(b, g, "cyl", lambert(POLE), Vector3(0.025, l, 0.025), Vector3(px, py, 0), Vector3(0, 0, -atan2(nx - px, ny - py)))
		px = nx
		py = ny
	var arm_len := 0.85
	part(b, g, "cyl", lambert(POLE), Vector3(0.024, arm_len, 0.024), Vector3(px, py, 0), Vector3(0, 0, -PI / 2.0 + 0.06))
	var hx := px + arm_len
	var hy := py - 0.05
	part(b, g, "sphere", lambert(Color("7a8088")), Vector3(0.2, 0.06, 0.1), Vector3(hx, hy, 0))
	var glow := StandardMaterial3D.new()
	glow.shading_mode = BaseMaterial3D.SHADING_MODE_UNSHADED
	glow.albedo_color = Color("fff0c8")
	part(b, g, "disc", glow, Vector3(0.15, 0.075, 1), Vector3(hx, hy - 0.045, 0), Vector3(PI / 2.0, 0, 0))
	_streetlight = b.to_mesh()
	return _streetlight


## Transformación de una farola en (x, z) con el brazo hacia (dx, dz).
static func streetlight_xform(x: float, z: float, dx: float, dz: float) -> Transform3D:
	return Transform3D(Basis(Vector3.UP, -atan2(dz, dx)), Vector3(x, 0.05, z))


static func _signal_head(b: GeoBatch, g: Transform3D, p: Vector3, axis: String) -> void:
	var h := g * Transform3D(Basis(), p)
	part(b, h, "box", lambert(SIGNAL_YELLOW), Vector3(0.12, 0.36, 0.1), Vector3.ZERO)
	var lenses := ["red", "amber", "green"]
	for i in 3:
		part(b, h, "disc", lens(axis, lenses[i]), Vector3.ONE * 0.036, Vector3(0, 0.11 - i * 0.11, 0.051))
		part(b, h, "box", lambert(Color("1c1c1c")), Vector3(0.09, 0.012, 0.05), Vector3(0, 0.11 - i * 0.11 + 0.045, 0.075))


static func _ped_head(b: GeoBatch, g: Transform3D, axis: String) -> void:
	part(b, g, "box", lambert(SIGNAL_YELLOW), Vector3(0.13, 0.13, 0.07), Vector3.ZERO)
	part(b, g, "box", lens(axis, "hand"), Vector3(0.05, 0.06, 0.005), Vector3(-0.03, 0, 0.036))
	part(b, g, "box", lens(axis, "walk"), Vector3(0.03, 0.07, 0.005), Vector3(0.035, 0, 0.036))


## Semáforo de mástil en la esquina (x, z). heading (hx, hz): sentido de los coches
## que llegan; lane_offsets: distancias desde el poste a cada carril (unidades).
static func traffic_signal(b: GeoBatch, x: float, z: float, hx: float, hz: float, lane_offsets: Array, axis: String) -> void:
	var g := Transform3D(Basis(Vector3.UP, atan2(-hx, -hz)), Vector3(x, 0.05, z))
	var H := 2.3
	part(b, g, "cyl", lambert(POLE), Vector3(0.07, 0.2, 0.07), Vector3.ZERO)
	part(b, g, "cone", lambert(POLE), Vector3(0.042, H, 0.042), Vector3(0, 0.2, 0))
	var reach := 0.6
	for o in lane_offsets:
		reach = maxf(reach, o)
	reach += 0.25
	part(b, g, "cyl", lambert(POLE), Vector3(0.028, reach, 0.028), Vector3(0, H - 0.1, 0), Vector3(0, 0, PI / 2.0 - 0.12))
	for off in lane_offsets:
		_signal_head(b, g, Vector3(-off, H - 0.1 + off * 0.12 - 0.22, 0), axis)
	_signal_head(b, g, Vector3(-0.1, 1.6, 0), axis)
	var ped := g * Transform3D(Basis(Vector3.UP, -PI / 2.0), Vector3(-0.08, 1.05, 0))
	_ped_head(b, ped, "B" if axis == "A" else "A")
	part(b, g, "box", lambert(Color("2f6b3f")), Vector3(0.36, 0.07, 0.01), Vector3(0.1, 2.05, 0.03))


static func _axis_state(t: float, axis: String) -> String:
	var u := fposmod(t + (CYCLE / 2.0 if axis == "B" else 0.0), CYCLE)
	return "green" if u < 6.0 else ("amber" if u < 8.0 else "red")


## Ciclo de 16 s: eje A verde 0-6, ámbar 6-8, rojo 8-16; eje B desfasado medio ciclo.
## Los peatones cruzan cuando los coches de su eje están en rojo.
static func update_signals(time: float) -> void:
	if _lens.is_empty():
		return
	for axis in ["A", "B"]:
		var st := _axis_state(time, axis)
		var m: Dictionary = _lens[axis]
		for l in ["red", "amber", "green"]:
			m[l].albedo_color = ON[l] if st == l else OFF[l]
		var u := fposmod(time + (CYCLE / 2.0 if axis == "B" else 0.0), CYCLE)
		var walk := u >= 8.5 and u < 13.5
		var flashing := u >= 13.5 and u < 15.5 and int(floorf(time * 2.0)) % 2 == 0
		m.walk.albedo_color = ON.walk if walk else OFF.walk
		m.hand.albedo_color = ON.hand if (not walk and not flashing) else OFF.hand


# ------------------------------------------------------------------ más mobiliario (docs/reglas-calle.md)

## Señal de STOP: octógono rojo de 0,75 m (0,25 u) con borde blanco en un poste de 2,1 m,
## mirando a los coches que llegan (heading = su sentido de marcha).
static func stop_sign(b: GeoBatch, x: float, z: float, hx: float, hz: float) -> void:
	var g := Transform3D(Basis(Vector3.UP, atan2(-hx, -hz)), Vector3(x, 0.05, z))
	part(b, g, "cyl", lambert(Color("8a8f96")), Vector3(0.018, 0.72, 0.018), Vector3.ZERO)
	var oct := _octagon()
	b.mesh(oct, g * Transform3D(Basis.from_scale(Vector3(0.135, 0.135, 1.0)), Vector3(0, 0.76, 0.012)), lambert(Color("f2f2ee")))
	b.mesh(oct, g * Transform3D(Basis.from_scale(Vector3(0.122, 0.122, 1.0)), Vector3(0, 0.76, 0.016)), lambert(Color("c8141e")))
	# dorso gris de la placa
	b.mesh(oct, g * Transform3D(Basis(Vector3.UP, PI).scaled(Vector3(0.135, 0.135, 1.0)), Vector3(0, 0.76, 0.008)), lambert(Color("6b7078")))


static var _oct: ArrayMesh
static func _octagon() -> ArrayMesh:
	if _oct:
		return _oct
	var st := SurfaceTool.new()
	st.begin(Mesh.PRIMITIVE_TRIANGLES)
	st.set_normal(Vector3.BACK)
	for i in 8:
		var a0 := TAU * (i + 0.5) / 8.0
		var a1 := TAU * (i + 1.5) / 8.0
		st.add_vertex(Vector3.ZERO)
		st.add_vertex(Vector3(cos(a1), sin(a1), 0))
		st.add_vertex(Vector3(cos(a0), sin(a0), 0))
	_oct = st.commit()
	return _oct


## Hidrante de Nueva York (cuerpo rojo, capuchón y bocas plateadas), ~0,75 m de alto.
static func hydrant(b: GeoBatch, x: float, z: float, rot: float) -> void:
	var g := Transform3D(Basis(Vector3.UP, rot), Vector3(x, 0.05, z))
	var red := lambert(Color("b3261e"))
	var steel := lambert(Color("a8adb3"))
	part(b, g, "cyl", steel, Vector3(0.05, 0.03, 0.05), Vector3.ZERO)
	part(b, g, "cyl", red, Vector3(0.036, 0.17, 0.036), Vector3(0, 0.03, 0))
	part(b, g, "cyl", red, Vector3(0.042, 0.02, 0.042), Vector3(0, 0.19, 0))
	part(b, g, "sphere", steel, Vector3(0.034, 0.03, 0.034), Vector3(0, 0.215, 0))
	part(b, g, "cyl", steel, Vector3(0.016, 0.07, 0.016), Vector3(0.0, 0.12, 0), Vector3(0, 0, PI / 2.0))
	part(b, g, "cyl", steel, Vector3(0.02, 0.05, 0.02), Vector3(0, 0.12, 0.02), Vector3(PI / 2.0, 0, 0))


## Papelera de rejilla verde (la típica de las esquinas de Nueva York), con algo de basura.
static func litter_basket(b: GeoBatch, x: float, z: float) -> void:
	var g := Transform3D(Basis(), Vector3(x, 0.05, z))
	var green := lambert(Color("2e4a36"))
	part(b, g, "cone", green, Vector3(0.075, 0.28, 0.075), Vector3.ZERO, Vector3(PI, 0, 0))
	part(b, g, "cyl", lambert(Color("1f3326")), Vector3(0.078, 0.02, 0.078), Vector3(0, 0.27, 0))
	part(b, g, "sphere", lambert(Color("d8d4c8")), Vector3(0.05, 0.03, 0.045), Vector3(0.01, 0.285, 0))
	part(b, g, "sphere", lambert(Color("2b2b2e")), Vector3(0.035, 0.025, 0.04), Vector3(-0.02, 0.29, 0.015))


## Montón de bolsas de basura negras y verdes junto al bordillo (rng: determinista).
static func trash_bags(b: GeoBatch, x: float, z: float, r: RandomNumberGenerator) -> void:
	var cols := [Color("141416"), Color("1b1c1f"), Color("233a26"), Color("101012"), Color("5b5f66")]
	var n := 3 + r.randi() % 5
	for i in n:
		var p := Vector3(x + r.randf_range(-0.28, 0.28), 0.05, z + r.randf_range(-0.22, 0.22))
		var s := Vector3(r.randf_range(0.09, 0.14), r.randf_range(0.07, 0.11), r.randf_range(0.08, 0.13))
		var m := StandardMaterial3D.new() if false else lambert(cols[r.randi() % cols.size()])
		part(b, Transform3D(), "sphere", m, s, p + Vector3(0, s.y * 0.8 + (0.06 if i >= 4 else 0.0), 0), Vector3(r.randf_range(-0.4, 0.4), r.randf() * TAU, 0))
