extends SceneTree
## Genera "Detail Barrier Strong Type A" como barrera New Jersey de hormigón realista y
## la exporta a GLB (con sus texturas dentro) para el juego y el gestor de assets:
##   godot --headless --path godot -s res://tools/build_barrier.gd
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
const OUT := ["../client/public/models/retro/detail-barrier-strong-type-a.glb", "res://assets/models/retro/detail-barrier-strong-type-a.glb"]

var st := SurfaceTool.new()


func _init() -> void:
	st.begin(Mesh.PRIMITIVE_TRIANGLES)
	_build()
	st.generate_tangents()
	var mesh := st.commit()
	mesh.surface_set_material(0, _material())
	var root := Node3D.new()
	root.name = "detail-barrier-strong-type-a"
	var mi := MeshInstance3D.new()
	mi.name = "detail-barrier-strong-type-a"
	mi.mesh = mesh
	root.add_child(mi)
	mi.owner = root
	for path in OUT:
		var doc := GLTFDocument.new()
		var state := GLTFState.new()
		var err := doc.append_from_scene(root, state)
		if err == OK:
			err = doc.write_to_filesystem(state, ProjectSettings.globalize_path(path) if path.begins_with("res://") else ProjectSettings.globalize_path("res://").path_join(path))
		print("%s → %s" % [path, "ok" if err == OK else "error %d" % err])
	print("triángulos: %d" % (mesh.surface_get_array_len(0) / 3))
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
	var ex := absf(p.x) - (L * 0.5 - 0.06)
	if ex > 0.0:
		var k := ex / 0.06
		var n := _noise(Vector3(p.y * 14.0, p.z * 14.0, signf(p.x) * 3.0))
		var n2 := _noise(Vector3(p.y * 40.0, p.z * 40.0, signf(p.x) * 7.0))
		q.x -= signf(p.x) * k * k * (0.012 + 0.03 * maxf(0.0, n - 0.45) + 0.006 * n2)
	if p.y > 0.77:
		var k := (p.y - 0.77) / 0.04
		var n := _noise(Vector3(p.x * 9.0, signf(p.z) * 5.0, 1.0))
		var bite := maxf(0.0, n - 0.5) * 0.03 * k
		q.y -= bite
		q.z -= signf(p.z) * bite * 0.6
	return q


## Suciedad y desgaste (color por vértice, multiplica la textura).
func _dirt(p: Vector3, n: Vector3) -> Color:
	var c := 1.0
	var warm := 0.0
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
		st.set_color(_dirt(src, n) * tint)
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
