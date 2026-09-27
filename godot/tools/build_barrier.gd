extends SceneTree
## Genera las barreras "Detail Barrier Strong" como barreras New Jersey de hormigón
## realistas ("barrera Detroit") y las exporta a GLB (con sus texturas dentro) para el
## juego y el gestor de assets:
##   godot --headless --path godot -s res://tools/build_barrier.gd -- variant=a|b|damaged
## - a: la barrera limpia.
## - b: con cinta reflectante de advertencia pegada (franjas rojas y blancas en alta
##   resolución, pieza fina aparte con su propia textura: desgaste, suciedad, una punta
##   despegada).
## - damaged: rota por un extremo (hormigón fresco y armaduras oxidadas a la vista),
##   desconchones grandes, grietas, hollín de un fuego en la base y chorretes de óxido.
## - Perfil New Jersey real: 61 cm de base, pie vertical de 7,5 cm, talud a 55° hasta
##   33 cm, casi vertical hasta 81 cm, coronación de 15 cm. Largo 3,7 m.
## - Ranura de enganche vertical en cada testero, dos huecos inferiores (desagüe y
##   horquillas de la carretilla) y dos agujeros de izado en la coronación.
## - Aristas desconchadas en los testeros y la coronación, suciedad al pie, chorretones
##   y manchas (color por vértice sobre la textura).
## - Hormigón PBR de ambientCG (Concrete030, CC0): color aclarado al gris del prefabricado,
##   relieve y rugosidad. Fuente en tools/assets-src/concrete030 (no va al repositorio).
## Se modela en metros y se escala a las unidades del kit retro de Kenney (render = modelo
## × 2,1, 1 unidad = 3 m): así sale a su tamaño real en el juego y en el editor web.

const L := 3.7
const TOE := 0.305
const PROFILE := [Vector2(-0.305, 0.0), Vector2(0.305, 0.0), Vector2(0.305, 0.075), Vector2(0.125, 0.33), Vector2(0.078, 0.81), Vector2(-0.078, 0.81), Vector2(-0.125, 0.33), Vector2(-0.305, 0.075)]
const NOTCH_Y := 0.09
const NOTCHES := [[-1.3, -0.6], [0.6, 1.3]]
const SLOT_W := 0.045 # media anchura de la ranura del testero
const SLOT_Y := [0.075, 0.64]
const SLOT_D := 0.07
const MAX_EDGE := 0.1
const TEX_M := 1.3 # metros por repetición de la textura
const SCALE := 1.0 / (3.0 * 2.1)
const SRC := "../tools/assets-src/concrete030/Concrete030_%s.jpg"
const NAMES := {"a": "detail-barrier-strong-type-a", "b": "detail-barrier-strong-type-b", "damaged": "detail-barrier-strong-damaged"}
const OUT := ["../client/public/models/retro/%s.glb", "res://assets/models/retro/%s.glb"]
const TAPE_Y := [0.52, 0.66] # banda de la cinta (altura en la cara alta)
const TAPE_X := 1.7 # media longitud de la cinta
const TAPE_PX := 2048

var st := SurfaceTool.new()
var tape := SurfaceTool.new()
var variant := "a"
var damaged := false


func _init() -> void:
	for a in OS.get_cmdline_user_args():
		var kv := a.split("=", true, 1)
		if kv.size() == 2 and kv[0] == "variant" and NAMES.has(kv[1]):
			variant = kv[1]
	damaged = variant == "damaged"
	var name: String = NAMES[variant]
	st.begin(Mesh.PRIMITIVE_TRIANGLES)
	_build()
	st.generate_tangents()
	var mesh := st.commit()
	mesh.surface_set_material(0, _material())
	if variant == "b":
		tape.begin(Mesh.PRIMITIVE_TRIANGLES)
		_tape()
		tape.generate_tangents()
		tape.commit(mesh)
		mesh.surface_set_material(1, _tape_material())
	var root := Node3D.new()
	root.name = name
	var mi := MeshInstance3D.new()
	mi.name = name
	mi.mesh = mesh
	root.add_child(mi)
	mi.owner = root
	for p in OUT:
		var path: String = p % name
		var doc := GLTFDocument.new()
		var state := GLTFState.new()
		var err := doc.append_from_scene(root, state)
		if err == OK:
			err = doc.write_to_filesystem(state, ProjectSettings.globalize_path(path) if path.begins_with("res://") else ProjectSettings.globalize_path("res://").path_join(path))
		print("%s → %s" % [path, "ok" if err == OK else "error %d" % err])
	var tris := 0
	for s in mesh.get_surface_count():
		tris += mesh.surface_get_array_len(s) / 3
	print("%s: %d triángulos" % [name, tris])
	root.free()
	quit()


# ------------------------------------------------------------------ material

func _tex(kind: String, size: int, adjust: Callable) -> ImageTexture:
	var img := Image.load_from_file(ProjectSettings.globalize_path("res://").path_join(SRC % kind))
	img.resize(size, size, Image.INTERPOLATE_LANCZOS)
	adjust.call(img)
	img.generate_mipmaps()
	return ImageTexture.create_from_image(img)


func _material() -> StandardMaterial3D:
	var m := StandardMaterial3D.new()
	m.resource_name = "concrete"
	# el hormigón de la foto es más claro y neutro que el de la textura
	m.albedo_texture = _tex("Color", 1024, func(img: Image) -> void: img.adjust_bcs(1.55, 0.9, 0.55))
	m.vertex_color_use_as_albedo = true
	m.normal_enabled = true
	m.normal_texture = _tex("NormalGL", 1024, func(_img: Image) -> void: pass)
	m.roughness_texture = _tex("Roughness", 512, func(_img: Image) -> void: pass)
	m.roughness = 1.0
	return m


# ------------------------------------------------------------------ geometría

func _hash(x: float, y: float, z: float) -> float:
	var h := sin(x * 127.1 + y * 311.7 + z * 74.7) * 43758.5453
	return h - floorf(h)


## Ruido de valor suave en 3D (determinista por posición).
func _noise(p: Vector3) -> float:
	var i := p.floor()
	var f := p - i
	f = f * f * (Vector3(3, 3, 3) - 2.0 * f)
	var n000 := _hash(i.x, i.y, i.z)
	var n100 := _hash(i.x + 1, i.y, i.z)
	var n010 := _hash(i.x, i.y + 1, i.z)
	var n110 := _hash(i.x + 1, i.y + 1, i.z)
	var n001 := _hash(i.x, i.y, i.z + 1)
	var n101 := _hash(i.x + 1, i.y, i.z + 1)
	var n011 := _hash(i.x, i.y + 1, i.z + 1)
	var n111 := _hash(i.x + 1, i.y + 1, i.z + 1)
	return lerpf(lerpf(lerpf(n000, n100, f.x), lerpf(n010, n110, f.x), f.y), lerpf(lerpf(n001, n101, f.x), lerpf(n011, n111, f.x), f.y), f.z)


## Desconchones: los testeros y las aristas de la coronación se comen un poco, de forma
## irregular. Solo depende de la posición: las aristas compartidas no se abren.
func _chip(p: Vector3) -> Vector3:
	var q := p
	if damaged:
		# extremo roto: la parte alta se ha partido en una superficie irregular
		var cap := _break_top(p)
		if q.y > cap:
			q.y = cap
		# desconchones grandes en los costados (el hormigón saltado)
		for sp in SPALLS:
			var c: Vector3 = sp[0]
			var d := Vector2(p.x - c.x, p.y - c.y).length()
			if signf(p.z) == signf(c.z) and absf(p.z) > 0.06 and d < sp[1]:
				var k: float = 1.0 - d / float(sp[1])
				var n := _noise(Vector3(p.x * 30.0, p.y * 30.0, c.z * 9.0))
				q.z -= signf(p.z) * k * k * sp[2] * (0.6 + 0.8 * n)
	var ex := absf(p.x) - (L * 0.5 - 0.06)
	if ex > 0.0:
		var k := ex / 0.06
		var n := _noise(Vector3(p.y * 14.0, p.z * 14.0, signf(p.x) * 3.0))
		var n2 := _noise(Vector3(p.y * 40.0, p.z * 40.0, signf(p.x) * 7.0))
		q.x -= signf(p.x) * k * k * (0.012 + 0.03 * maxf(0.0, n - 0.45) + 0.006 * n2)
	if p.y > 0.77:
		var k := (p.y - 0.77) / 0.04
		var n := _noise(Vector3(p.x * 9.0, signf(p.z) * 5.0, 1.0))
		var bite := maxf(0.0, n - 0.5) * (0.09 if damaged else 0.03) * k
		q.y -= bite
		q.z -= signf(p.z) * bite * 0.6
	return q


## Rotura del extremo (+x): altura de la superficie partida en cada punto.
const BREAK_X := 1.15
func _break_top(p: Vector3) -> float:
	if p.x < BREAK_X:
		return 10.0
	var t := smoothstep(BREAK_X, L * 0.5, p.x)
	var n := _noise(Vector3(p.x * 7.0, p.z * 9.0, 4.2))
	var n2 := _noise(Vector3(p.x * 21.0, p.z * 25.0, 1.3))
	return 0.81 - t * 0.47 + (n - 0.5) * 0.12 * t + (n2 - 0.5) * 0.035


# desconchones: [centro (x, y, lado z), radio, profundidad] (metros)
const SPALLS := [[Vector3(-1.2, 0.62, 1.0), 0.16, 0.035], [Vector3(-0.2, 0.2, 1.0), 0.12, 0.03], [Vector3(0.55, 0.7, -1.0), 0.2, 0.04], [Vector3(-1.55, 0.35, -1.0), 0.14, 0.03], [Vector3(0.9, 0.45, 1.0), 0.1, 0.025]]
const FIRE := Vector3(-0.35, 0.0, 1.0) # fuego al pie, del lado +z: hollín que sube


## Hollín del fuego: columna que se abre al subir y se aclara arriba.
func _soot(p: Vector3) -> float:
	var side := 1.0 if signf(p.z) == FIRE.z or absf(p.z) < 0.09 else 0.75
	var sigma := 0.22 + 0.55 * p.y
	var dx := p.x - FIRE.x
	var plume := exp(-dx * dx / (2.0 * sigma * sigma))
	var n := _noise(Vector3(p.x * 5.0, p.y * 3.0, p.z * 4.0))
	var n2 := _noise(Vector3(p.x * 17.0, p.y * 11.0, 2.0))
	return clampf(plume * side * (1.25 - 0.4 * p.y) * (0.55 + 0.45 * n) + 0.12 * (n2 - 0.5), 0.0, 0.97)


## Suciedad y desgaste (color por vértice, multiplica la textura).
func _dirt(p: Vector3, n: Vector3) -> Color:
	var c := 1.0
	var warm := 0.0
	if damaged and p.y >= _break_top(p) - 0.005:
		# rotura: hormigón fresco, más claro y con el árido a la vista
		var g := 0.95 + 0.15 * _noise(p * 40.0)
		return Color(g, g * 0.97, g * 0.92)
	# pie: salpicaduras de la calzada, más marrón
	var foot := 1.0 - smoothstep(0.0, 0.22, p.y)
	c *= 1.0 - 0.3 * foot
	warm += 0.5 * foot
	# chorretones verticales en los taludes
	if absf(n.y) < 0.9:
		var s := _noise(Vector3(p.x * 6.0, 0.0, signf(p.z))) * _noise(Vector3(p.x * 22.0, p.y * 1.5, signf(p.z) * 2.0))
		c *= 1.0 - 0.18 * smoothstep(0.2, 0.6, s) * smoothstep(0.2, 0.7, p.y)
	# manchas y aguas grandes
	var b := _noise(p * 2.2)
	c *= 0.9 + 0.14 * b
	# rincón entre pie y talud: algo de sombra acumulada
	c *= 1.0 - 0.1 * (1.0 - smoothstep(0.0, 0.04, absf(p.y - 0.075))) * (1.0 - absf(n.y))
	# coronación y aristas gastadas, más claras
	if n.y > 0.9 and p.y > 0.7:
		c *= 1.06
	var col := Color(c, c * (1.0 - 0.02 * warm), c * (1.0 - 0.06 * warm))
	if damaged:
		# chorretes de óxido bajo las armaduras que asoman en la rotura
		for rx in REBAR_X:
			var dx := absf(p.x - rx) / (0.025 + 0.03 * (0.6 - p.y))
			if dx < 1.0 and p.y < _break_top(Vector3(rx, 0, p.z)) and absf(p.z) > 0.05:
				var k := (1.0 - dx) * smoothstep(0.0, 0.5, p.y) * (0.6 + 0.4 * _noise(Vector3(p.x * 50.0, p.y * 8.0, 1.0)))
				col = col.lerp(Color(0.55, 0.32, 0.18) * c, k * 0.7)
		# hollín del fuego
		col = col.lerp(Color(0.07, 0.065, 0.06), _soot(p))
	return col.clamp(Color(0, 0, 0), Color(1, 1, 1))


func _uv(p: Vector3, n: Vector3) -> Vector2:
	if absf(n.y) > 0.7:
		return Vector2(p.x, p.z) / TEX_M
	if absf(n.x) > 0.7:
		return Vector2(p.z, -p.y) / TEX_M
	return Vector2(p.x, -p.y) / TEX_M


## Triángulo plano (en metros), partido hasta aristas de MAX_EDGE, con desconchones,
## normal de cada trozo ya deformado, UV por su cara y suciedad.
func _tri(a: Vector3, b: Vector3, c: Vector3, n: Vector3, tint := Color.WHITE) -> void:
	var ab := a.distance_to(b)
	var bc := b.distance_to(c)
	var ca := c.distance_to(a)
	var m := maxf(ab, maxf(bc, ca))
	if m > MAX_EDGE:
		if m == ab:
			var p := (a + b) * 0.5
			_tri(a, p, c, n, tint)
			_tri(p, b, c, n, tint)
		elif m == bc:
			var p := (b + c) * 0.5
			_tri(a, b, p, n, tint)
			_tri(a, p, c, n, tint)
		else:
			var p := (c + a) * 0.5
			_tri(a, b, p, n, tint)
			_tri(p, b, c, n, tint)
		return
	var pa := _chip(a)
	var pb := _chip(b)
	var pc := _chip(c)
	var fn := (pb - pa).cross(pc - pa).normalized()
	if fn.dot(n) < 0.0:
		fn = -fn
	# Godot: frente en sentido horario visto desde fuera
	var order := [[a, pa], [c, pc], [b, pb]] if (b - a).cross(c - a).dot(n) > 0.0 else [[a, pa], [b, pb], [c, pc]]
	for o in order:
		var src: Vector3 = o[0]
		var p: Vector3 = o[1]
		st.set_normal(fn)
		st.set_uv(_uv(src, n))
		st.set_color((_dirt(src, n) * tint).srgb_to_linear()) # glTF y el shader: color lineal
		st.add_vertex(p * SCALE)


## Polígono convexo plano (puntos en orden), en abanico.
func _poly(pts: Array, n: Vector3, tint := Color.WHITE) -> void:
	for i in range(1, pts.size() - 1):
		_tri(pts[0], pts[i], pts[i + 1], n, tint)


## Recorte de un polígono convexo 2D por el semiplano dot(p, axis) >= d.
func _clip(poly: Array, axis: Vector2, d: float) -> Array:
	var out: Array = []
	for i in poly.size():
		var a: Vector2 = poly[i]
		var b: Vector2 = poly[(i + 1) % poly.size()]
		var da := a.dot(axis) - d
		var db := b.dot(axis) - d
		if da >= 0.0:
			out.append(a)
		if (da >= 0.0) != (db >= 0.0):
			out.append(a.lerp(b, da / (da - db)))
	return out


func _at(p: Vector2, x: float) -> Vector3:
	return Vector3(x, p.y, p.x)


## Tramo extruido del perfil entre x0 y x1 (caras laterales, suelo y coronación).
func _section(prof: Array, x0: float, x1: float) -> void:
	for i in prof.size():
		var a: Vector2 = prof[i]
		var b: Vector2 = prof[(i + 1) % prof.size()]
		var e := b - a
		var n2 := Vector2(e.y, -e.x).normalized() # hacia fuera (perfil antihorario)
		var n := Vector3(0.0, n2.y, n2.x)
		_poly([_at(a, x0), _at(b, x0), _at(b, x1), _at(a, x1)], n)


## Testero con la ranura de enganche (en x = xe, mirando hacia sx).
func _end(xe: float, sx: float) -> void:
	var n := Vector3(sx, 0, 0)
	var left := _clip(PROFILE, Vector2(-1, 0), SLOT_W)
	var right := _clip(PROFILE, Vector2(1, 0), SLOT_W)
	var mid := _clip(_clip(PROFILE, Vector2(1, 0), -SLOT_W), Vector2(-1, 0), -SLOT_W)
	var bottom := _clip(mid, Vector2(0, -1), -SLOT_Y[0])
	var top := _clip(mid, Vector2(0, 1), SLOT_Y[1])
	for poly in [left, right, bottom, top]:
		if poly.size() >= 3:
			_poly(poly.map(func(p: Vector2) -> Vector3: return _at(p, xe)), n)
	# ranura: fondo y paredes, algo más oscuros
	var xi := xe - sx * SLOT_D
	var dark := Color(0.8, 0.8, 0.8)
	var z0 := -SLOT_W
	var z1 := SLOT_W
	var y0: float = SLOT_Y[0]
	var y1: float = SLOT_Y[1]
	_poly([Vector3(xi, y0, z0), Vector3(xi, y0, z1), Vector3(xi, y1, z1), Vector3(xi, y1, z0)], n, dark)
	_poly([Vector3(xi, y0, z0), Vector3(xe, y0, z0), Vector3(xe, y1, z0), Vector3(xi, y1, z0)], Vector3(0, 0, 1), dark)
	_poly([Vector3(xi, y0, z1), Vector3(xi, y1, z1), Vector3(xe, y1, z1), Vector3(xe, y0, z1)], Vector3(0, 0, -1), dark)
	_poly([Vector3(xi, y0, z0), Vector3(xi, y0, z1), Vector3(xe, y0, z1), Vector3(xe, y0, z0)], Vector3(0, 1, 0), dark)
	_poly([Vector3(xi, y1, z0), Vector3(xe, y1, z0), Vector3(xe, y1, z1), Vector3(xi, y1, z1)], Vector3(0, -1, 0), dark)


func _build() -> void:
	var notch := _clip(PROFILE, Vector2(0, 1), NOTCH_Y)
	# tramos a lo largo: macizo / hueco inferior / macizo / hueco / macizo
	var cuts := [-L * 0.5, NOTCHES[0][0], NOTCHES[0][1], NOTCHES[1][0], NOTCHES[1][1], L * 0.5]
	for i in cuts.size() - 1:
		var hollow := i % 2 == 1
		_section(notch if hollow else PROFILE, cuts[i], cuts[i + 1])
	# paredes de los huecos inferiores (la parte del perfil bajo NOTCH_Y)
	var under := _clip(PROFILE, Vector2(0, -1), -NOTCH_Y)
	for nt in NOTCHES:
		_poly(under.map(func(p: Vector2) -> Vector3: return _at(p, nt[0])), Vector3(1, 0, 0))
		_poly(under.map(func(p: Vector2) -> Vector3: return _at(p, nt[1])), Vector3(-1, 0, 0))
	_end(L * 0.5, 1.0)
	_end(-L * 0.5, -1.0)
	# agujeros de izado en la coronación
	for hx in [-0.95, 0.95]:
		var c := Vector3(hx, 0.8105, 0.0)
		var ring: Array = []
		for k in 10:
			var a := TAU * k / 10.0
			ring.append(c + Vector3(cos(a) * 0.022, 0.0, sin(a) * 0.022))
		for k in 10:
			_tri(c, ring[k], ring[(k + 1) % 10], Vector3.UP, Color(0.18, 0.18, 0.18))
	if damaged:
		_rebar()
		_cracks()


# ------------------------------------------------------------------ daños

const REBAR_X := [1.42, 1.58, 1.74]


## Tubo fino a lo largo de una curva (armaduras), sin partir ni desconchar.
func _tube(pts: Array, r: float, tint: Color) -> void:
	var sides := 6
	for i in pts.size() - 1:
		var a: Vector3 = pts[i]
		var b: Vector3 = pts[i + 1]
		var t := (b - a).normalized()
		var s := t.cross(Vector3.UP)
		if s.length() < 0.1:
			s = t.cross(Vector3.RIGHT)
		s = s.normalized()
		var u := s.cross(t).normalized()
		for k in sides:
			var a0 := TAU * k / sides
			var a1 := TAU * (k + 1) / sides
			var d0 := s * cos(a0) + u * sin(a0)
			var d1 := s * cos(a1) + u * sin(a1)
			var q := [a + d0 * r, b + d0 * r, b + d1 * r, a + d1 * r]
			var nm := (d0 + d1).normalized()
			for o in [0, 2, 1, 0, 3, 2]:
				st.set_normal(nm)
				st.set_uv(Vector2(float(k) / sides, float(i)) * 0.2)
				st.set_color(tint.srgb_to_linear())
				st.add_vertex((q[o] as Vector3) * SCALE)


## Armaduras oxidadas que asoman por la rotura, dobladas.
func _rebar() -> void:
	var rust := Color(0.42, 0.24, 0.14)
	var r := RandomNumberGenerator.new()
	r.seed = 77
	for rx in REBAR_X:
		for z in [-0.05, 0.05]:
			var top := _break_top(Vector3(rx, 0, z))
			var pts: Array = []
			var p := Vector3(rx, top - 0.12, z)
			var dir := Vector3(r.randf_range(-0.3, 0.6), 1.0, r.randf_range(-0.4, 0.4)).normalized()
			for i in 6:
				pts.append(p)
				p += dir * r.randf_range(0.04, 0.07)
				dir = (dir + Vector3(r.randf_range(0.0, 0.5), -0.25, r.randf_range(-0.3, 0.3))).normalized()
			_tube(pts, 0.008, rust)


## Grietas: franjas finas y oscuras que siguen la cara alta, desde la rotura y los
## desconchones (encima de la superficie, sin desconchar).
func _cracks() -> void:
	var r := RandomNumberGenerator.new()
	r.seed = 1234
	var starts := [Vector2(1.15, 0.7), Vector2(1.2, 0.5), Vector2(-1.2, 0.62), Vector2(0.55, 0.7), Vector2(-0.3, 0.75), Vector2(0.2, 0.4)]
	for s0 in starts:
		for side in [-1.0, 1.0]:
			if r.randf() < 0.35:
				continue
			var p: Vector2 = s0
			var ang := r.randf_range(PI * 0.55, PI * 1.45) if p.x > 1.0 else r.randf_range(0.0, TAU)
			var w := 0.006
			for i in 14:
				var q := p + Vector2(cos(ang), sin(ang)) * r.randf_range(0.03, 0.07)
				q.y = clampf(q.y, 0.35, 0.8)
				_crack_seg(p, q, side, w)
				p = q
				ang += r.randf_range(-0.7, 0.7)
				w *= 0.93


## Tramo de grieta en la cara alta (x, altura) del lado dado.
func _crack_seg(a: Vector2, b: Vector2, side: float, w: float) -> void:
	var za := lerpf(0.125, 0.078, (a.y - 0.33) / 0.48) * side
	var zb := lerpf(0.125, 0.078, (b.y - 0.33) / 0.48) * side
	var n := Vector3(0, 0.1, side).normalized()
	var A := _chip(Vector3(a.x, a.y, za)) + n * 0.002
	var B := _chip(Vector3(b.x, b.y, zb)) + n * 0.002
	if A.y > _break_top(A) - 0.01 or B.y > _break_top(B) - 0.01:
		return
	var e := (B - A).normalized().cross(n).normalized() * w * 0.5
	var q := [A - e, B - e, B + e, A + e]
	var dark := Color(0.12, 0.11, 0.1)
	var order := [0, 1, 2, 0, 2, 3] if (q[1] - q[0]).cross(q[2] - q[0]).dot(n) < 0.0 else [0, 2, 1, 0, 3, 2]
	for o in order:
		st.set_normal(n)
		st.set_uv(Vector2(A.x, A.y) / TEX_M)
		st.set_color(dark.srgb_to_linear())
		st.add_vertex((q[o] as Vector3) * SCALE)


# ------------------------------------------------------------------ cinta (variante b)

## Textura de la cinta reflectante: franjas diagonales rojas y blancas, con arañazos,
## suciedad hacia abajo, bordes gastados y algún trozo arrancado (transparente).
func _tape_images() -> Array:
	var w := TAPE_PX
	var h := 128
	var img := Image.create_empty(w, h, false, Image.FORMAT_RGBA8)
	var rough := Image.create_empty(w, h, false, Image.FORMAT_RGBA8)
	var r := RandomNumberGenerator.new()
	r.seed = 99
	var red := Color(0.72, 0.06, 0.08)
	var white := Color(0.93, 0.93, 0.9)
	var px_per_m := float(w) / (TAPE_X * 2.0)
	var band := (TAPE_Y[1] - TAPE_Y[0]) * px_per_m # alto de la cinta en px "reales"
	var stripe := 0.1 * px_per_m
	# arañazos: segmentos casi horizontales
	var scratches: Array = []
	for i in 180:
		scratches.append([Vector2(r.randf() * w, r.randf() * h), r.randf_range(-0.25, 0.25), r.randf_range(15.0, 120.0), r.randf_range(0.6, 1.0)])
	for y in h:
		for x in w:
			var yy := float(y) / h * band
			var t := fposmod(float(x) + yy, stripe * 2.0)
			var c := red if t < stripe else white
			var fy := float(y) / h
			# suciedad hacia el borde de abajo y manchas
			var dirt := smoothstep(0.35, 1.0, fy) * 0.25 + 0.12 * _noise(Vector3(x * 0.01, y * 0.03, 0.0))
			c = c.lerp(Color(0.35, 0.32, 0.28), clampf(dirt, 0.0, 0.6))
			# bordes gastados
			var edge := minf(fy, 1.0 - fy)
			var a := 1.0
			if edge < 0.04 + 0.03 * _noise(Vector3(x * 0.05, fy * 4.0, 3.0)):
				a = 0.0
			var ro := 0.35 + 0.15 * dirt
			img.set_pixel(x, y, Color(c.r, c.g, c.b, a))
			rough.set_pixel(x, y, Color(0, ro, 0))
	for s in scratches:
		var p: Vector2 = s[0]
		var d := Vector2(cos(s[1]), sin(s[1]))
		for k in int(s[2]):
			var q := p + d * k
			if q.x < 0 or q.y < 0 or q.x >= w or q.y >= h:
				break
			var c := img.get_pixelv(Vector2i(q))
			if c.a > 0.0:
				img.set_pixelv(Vector2i(q), c.lerp(Color(0.8, 0.78, 0.74, 1.0), 0.45 * s[3]))
	# trozos arrancados: huecos irregulares
	for i in 5:
		var cx := r.randf_range(80, w - 80)
		var cy := r.randf_range(0, h)
		var rad := r.randf_range(10, 30)
		for y in range(maxi(0, int(cy - rad)), mini(h, int(cy + rad))):
			for x in range(maxi(0, int(cx - rad * 2)), mini(w, int(cx + rad * 2))):
				var d := Vector2((x - cx) / 2.0, y - cy).length() / rad
				if d < 0.7 + 0.4 * _noise(Vector3(x * 0.1, y * 0.1, i)):
					img.set_pixel(x, y, Color(0, 0, 0, 0))
	img.generate_mipmaps()
	rough.generate_mipmaps()
	return [ImageTexture.create_from_image(img), ImageTexture.create_from_image(rough)]


func _tape_material() -> StandardMaterial3D:
	var tx := _tape_images()
	var m := StandardMaterial3D.new()
	m.resource_name = "cinta"
	m.albedo_texture = tx[0]
	m.transparency = BaseMaterial3D.TRANSPARENCY_ALPHA_SCISSOR
	m.alpha_scissor_threshold = 0.5
	m.roughness_texture = tx[1]
	m.roughness = 1.0
	m.metallic = 0.0
	# un relieve plano marca el asset como detallado (sin cambio de fachada en el juego)
	var flat := Image.create_empty(4, 4, false, Image.FORMAT_RGBA8)
	flat.fill(Color(0.5, 0.5, 1.0))
	m.normal_enabled = true
	m.normal_texture = ImageTexture.create_from_image(flat)
	return m


## Cinta pegada en la cara alta de los dos lados; la punta de un extremo, despegada.
func _tape() -> void:
	for side in [-1.0, 1.0]:
		var n := Vector3(0, 0.1, side).normalized()
		var segs := 24
		for i in segs:
			var x0 := lerpf(-TAPE_X, TAPE_X, float(i) / segs)
			var x1 := lerpf(-TAPE_X, TAPE_X, float(i + 1) / segs)
			var u0 := float(i) / segs
			var u1 := float(i + 1) / segs
			if side < 0.0:
				u0 = 1.0 - u0
				u1 = 1.0 - u1
			var q: Array = []
			for c in [[x0, TAPE_Y[0]], [x1, TAPE_Y[0]], [x1, TAPE_Y[1]], [x0, TAPE_Y[1]]]:
				var y: float = c[1]
				var z: float = lerpf(0.125, 0.078, (y - 0.33) / 0.48) * side
				var p := _chip(Vector3(c[0], y, z)) + n * 0.0015
				# la punta del extremo +x en el lado +z se ha despegado y cuelga un poco
				if side > 0.0 and c[0] > TAPE_X - 0.12:
					var k: float = (c[0] - (TAPE_X - 0.12)) / 0.12
					p += n * k * k * 0.03 + Vector3(0, -k * k * 0.015, 0)
				q.append(p)
			var uv := [Vector2(u0, 1), Vector2(u1, 1), Vector2(u1, 0), Vector2(u0, 0)]
			var fn: Vector3 = ((q[1] - q[0]) as Vector3).cross(q[3] - q[0]).normalized()
			if fn.dot(n) < 0.0:
				fn = -fn
			var order := [0, 1, 2, 0, 2, 3] if ((q[1] - q[0]) as Vector3).cross(q[2] - q[0]).dot(fn) < 0.0 else [0, 2, 1, 0, 3, 2]
			for o in order:
				tape.set_normal(fn)
				tape.set_uv(uv[o])
				tape.add_vertex((q[o] as Vector3) * SCALE)
