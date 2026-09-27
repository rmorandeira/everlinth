extends SceneTree
## Assets del bioma "countryside" (campo), modelados en código y exportados a GLB con sus
## texturas PBR dentro (ambientCG, CC0; fuentes en tools/assets-src/countryside):
##   godot --headless --path godot -s res://tools/build_countryside.gd [-- only=silo]
## - silo: silo de grano de chapa galvanizada sobre tolva y bastidor de perfiles, con
##   anillos rigidizadores, cubierta cónica con nervios, barandilla y respiradero.
## - barn-a / barn-b / barn-c: graneros (rojo de cubierta holandesa con puertas
##   correderas en X y fila de ventanas; gris envejecido de dos aguas con chapa; marrón
##   pequeño holandés con puerta del pajar).
## - windmill: molino de bombeo de celosía (rueda de 18 palas, cola, plataforma,
##   escalera y bomba).
## - tractor-red / tractor-green: tractor antiguo con capó y rejilla, ruedas traseras de
##   tacos, delanteras rayadas, asiento, volante y escape oxidado.
## Se modela en metros; el nodo lleva escala 1/3 (1 unidad de render = 3 m; el grupo
## "countryside" no tiene escala propia en el juego ni en el editor).

const SRC := "../tools/assets-src/countryside/%s_%s.jpg"
const OUT := ["../client/public/models/countryside/%s.glb", "res://assets/models/countryside/%s.glb"]
const TEX := 512

var mats := {}   # nombre -> { st, tile, swap, mat }
var _img_cache := {}


func _init() -> void:
	var only := ""
	for a in OS.get_cmdline_user_args():
		if a.begins_with("only="):
			only = a.substr(5)
	var builders := {
		"silo": _silo,
		"barn-a": func() -> void: _barn(0),
		"barn-b": func() -> void: _barn(1),
		"barn-c": func() -> void: _barn(2),
		"windmill": _windmill,
		"tractor-red": func() -> void: _tractor(Color(0.78, 0.2, 0.16)),
		"tractor-green": func() -> void: _tractor(Color(0.2, 0.42, 0.2)),
	}
	DirAccess.make_dir_recursive_absolute(ProjectSettings.globalize_path("res://assets/models/countryside"))
	DirAccess.make_dir_recursive_absolute(ProjectSettings.globalize_path("res://").path_join("../client/public/models/countryside"))
	for name in builders:
		if only != "" and name != only:
			continue
		mats.clear()
		builders[name].call()
		_export(name)
	quit()


# ------------------------------------------------------------------ materiales

func _img(tex: String, kind: String, gray := false) -> Image:
	var key := tex + kind + str(gray)
	if _img_cache.has(key):
		return _img_cache[key]
	var img := Image.load_from_file(ProjectSettings.globalize_path("res://").path_join(SRC % [tex, kind]))
	img.resize(TEX, TEX, Image.INTERPOLATE_LANCZOS)
	if gray:
		img.adjust_bcs(1.15, 1.1, 0.0)
	img.generate_mipmaps()
	_img_cache[key] = img
	return img


## Material nombrado: textura de ambientCG (o ninguna), tono, metros por repetición,
## swap: girar la textura 90° (tablas verticales), gray: pasar a gris antes de teñir.
func _mat(name: String, tex: String, tint: Color, tile: float, swap := false, gray := false, rough := 1.0, metal := 0.0) -> String:
	if mats.has(name):
		return name
	var m := StandardMaterial3D.new()
	m.resource_name = name
	m.albedo_color = tint
	m.roughness = rough
	m.metallic = metal
	if tex != "":
		m.albedo_texture = ImageTexture.create_from_image(_img(tex, "Color", gray))
		m.normal_enabled = true
		m.normal_texture = ImageTexture.create_from_image(_img(tex, "NormalGL"))
		m.roughness_texture = ImageTexture.create_from_image(_img(tex, "Roughness"))
	else:
		# relieve plano: marca el asset como detallado en el juego (sin cambio de fachada)
		var flat := Image.create_empty(4, 4, false, Image.FORMAT_RGBA8)
		flat.fill(Color(0.5, 0.5, 1.0))
		m.normal_enabled = true
		m.normal_texture = ImageTexture.create_from_image(flat)
	var st := SurfaceTool.new()
	st.begin(Mesh.PRIMITIVE_TRIANGLES)
	mats[name] = {"st": st, "tile": tile, "swap": swap, "mat": m}
	return name


func _export(name: String) -> void:
	var mesh := ArrayMesh.new()
	var tris := 0
	for k in mats:
		var e: Dictionary = mats[k]
		var st: SurfaceTool = e.st
		st.generate_tangents()
		st.commit(mesh)
		mesh.surface_set_material(mesh.get_surface_count() - 1, e.mat)
		tris += mesh.surface_get_array_len(mesh.get_surface_count() - 1) / 3
	var root := Node3D.new()
	root.name = name
	var mi := MeshInstance3D.new()
	mi.name = name
	mi.mesh = mesh
	mi.scale = Vector3.ONE / 3.0
	root.add_child(mi)
	mi.owner = root
	for p in OUT:
		var path: String = p % name
		var abs_path := ProjectSettings.globalize_path(path) if path.begins_with("res://") else ProjectSettings.globalize_path("res://").path_join(path)
		var doc := GLTFDocument.new()
		var state := GLTFState.new()
		var err := doc.append_from_scene(root, state)
		if err == OK:
			err = doc.write_to_filesystem(state, abs_path)
		if err != OK:
			print("  error %d en %s" % [err, path])
	print("%s: %d triángulos, %d materiales" % [name, tris, mats.size()])
	root.free()


# ------------------------------------------------------------------ primitivas

## UV por proyección según la normal (metros / repetición del material).
func _uv(m: Dictionary, p: Vector3, n: Vector3) -> Vector2:
	var a := n.abs()
	var uv: Vector2
	if a.y >= a.x and a.y >= a.z:
		uv = Vector2(p.x, p.z)
	elif a.x >= a.z:
		uv = Vector2(p.z, -p.y)
	else:
		uv = Vector2(p.x, -p.y)
	if m.swap:
		uv = Vector2(uv.y, uv.x)
	return uv / float(m.tile)


## Triángulo (el orden se corrige para mirar hacia n si se da; si no, su propia normal).
func tri(mn: String, a: Vector3, b: Vector3, c: Vector3, n := Vector3.ZERO, uvs: Array = []) -> void:
	var m: Dictionary = mats[mn]
	var st: SurfaceTool = m.st
	var fn := (b - a).cross(c - a)
	if fn.length() < 1e-9:
		return
	fn = fn.normalized()
	if n != Vector3.ZERO and fn.dot(n) < 0.0:
		fn = -fn
		var t := b
		b = c
		c = t
		if uvs.size() == 3:
			uvs = [uvs[0], uvs[2], uvs[1]]
	# Godot: frente en sentido horario visto desde fuera → se emite a, c, b
	var pts := [a, c, b]
	var us: Array = [uvs[0], uvs[2], uvs[1]] if uvs.size() == 3 else []
	for i in 3:
		st.set_normal(fn)
		st.set_uv(us[i] if us.size() == 3 else _uv(m, pts[i], fn))
		st.add_vertex(pts[i])


func quad(mn: String, a: Vector3, b: Vector3, c: Vector3, d: Vector3, n := Vector3.ZERO) -> void:
	tri(mn, a, b, c, n)
	tri(mn, a, c, d, n)


## Caja: centro, tamaño y giro.
func box(mn: String, c: Vector3, s: Vector3, basis := Basis()) -> void:
	var h := s * 0.5
	var P := func(x: float, y: float, z: float) -> Vector3: return c + basis * Vector3(x * h.x, y * h.y, z * h.z)
	var faces := [[Vector3.RIGHT, [1, -1, -1], [1, 1, -1], [1, 1, 1], [1, -1, 1]], [Vector3.LEFT, [-1, -1, 1], [-1, 1, 1], [-1, 1, -1], [-1, -1, -1]],
		[Vector3.UP, [-1, 1, -1], [-1, 1, 1], [1, 1, 1], [1, 1, -1]], [Vector3.DOWN, [-1, -1, 1], [-1, -1, -1], [1, -1, -1], [1, -1, 1]],
		[Vector3.BACK, [-1, -1, 1], [1, -1, 1], [1, 1, 1], [-1, 1, 1]], [Vector3.FORWARD, [1, -1, -1], [-1, -1, -1], [-1, 1, -1], [1, 1, -1]]]
	for f in faces:
		var q: Array = []
		for k in range(1, 5):
			q.append(P.call(f[k][0], f[k][1], f[k][2]))
		quad(mn, q[0], q[1], q[2], q[3], basis * (f[0] as Vector3))


## Viga de sección w × h entre a y b.
func beam(mn: String, a: Vector3, b: Vector3, w: float, h := -1.0) -> void:
	if h < 0.0:
		h = w
	var d := b - a
	var l := d.length()
	if l < 1e-5:
		return
	var z := d / l
	var x := z.cross(Vector3.UP)
	if x.length() < 0.1:
		x = z.cross(Vector3.RIGHT)
	x = x.normalized()
	var y := z.cross(x).normalized()
	box(mn, (a + b) * 0.5, Vector3(w, h, l), Basis(x, y, z))


## Tronco de cono / cilindro de eje Y desde `base`, con UV cilíndricas (arco × altura).
func cyl(mn: String, base: Vector3, r0: float, r1: float, height: float, sides: int, cap_top := true, cap_bot := false, basis := Basis()) -> void:
	var m: Dictionary = mats[mn]
	var tile: float = m.tile
	for i in sides:
		var a0 := TAU * i / sides
		var a1 := TAU * (i + 1) / sides
		var d0 := Vector3(cos(a0), 0, sin(a0))
		var d1 := Vector3(cos(a1), 0, sin(a1))
		var p00 := base + basis * (d0 * r0)
		var p10 := base + basis * (d1 * r0)
		var p01 := base + basis * (d0 * r1 + Vector3(0, height, 0))
		var p11 := base + basis * (d1 * r1 + Vector3(0, height, 0))
		var slope := (r0 - r1) / maxf(height, 1e-5)
		var n0 := (basis * (d0 + Vector3(0, slope, 0))).normalized()
		var n1 := (basis * (d1 + Vector3(0, slope, 0))).normalized()
		var u0 := a0 * maxf(r0, r1) / tile
		var u1 := a1 * maxf(r0, r1) / tile
		var v1 := height / tile
		var us := [Vector2(u0, 0), Vector2(u1, 0), Vector2(u1, -v1), Vector2(u0, -v1)]
		if m.swap:
			us = us.map(func(u: Vector2) -> Vector2: return Vector2(u.y, u.x))
		var st: SurfaceTool = m.st
		# lateral con normales suaves (horario visto desde fuera)
		for k in [[p00, n0, us[0]], [p10, n1, us[1]], [p01, n0, us[3]], [p10, n1, us[1]], [p11, n1, us[2]], [p01, n0, us[3]]]:
			st.set_normal(k[1])
			st.set_uv(k[2])
			st.add_vertex(k[0])
		if cap_top and r1 > 0.001:
			tri(mn, base + basis * Vector3(0, height, 0), p01, p11, basis * Vector3.UP)
		if cap_bot and r0 > 0.001:
			tri(mn, base, p00, p10, basis * Vector3.DOWN)


## Anillo (toro de sección cuadrada) de radio r y grosor t a la altura y.
func ring(mn: String, c: Vector3, r: float, t: float, sides := 32, basis := Basis()) -> void:
	for i in sides:
		var a0 := TAU * i / sides
		var a1 := TAU * (i + 1) / sides
		beam(mn, c + basis * Vector3(cos(a0) * r, 0, sin(a0) * r), c + basis * Vector3(cos(a1) * r, 0, sin(a1) * r), t, t)


## Polígono convexo plano en abanico.
func poly(mn: String, pts: Array, n: Vector3) -> void:
	for i in range(1, pts.size() - 1):
		tri(mn, pts[0], pts[i], pts[i + 1], n)


# ------------------------------------------------------------------ silo

func _silo() -> void:
	var steel := _mat("chapa", "CorrugatedSteel005", Color(0.92, 0.93, 0.95), 1.6, false, false, 1.0, 0.55)
	var frame := _mat("perfiles", "CorrugatedSteel005", Color(0.8, 0.82, 0.84), 3.0, false, false, 1.0, 0.6)
	var dark := _mat("oscuro", "", Color(0.18, 0.18, 0.19), 1.0, false, false, 0.6, 0.3)
	var R := 3.0
	var base_y := 2.6 # altura de la tolva
	var wall := 7.2
	# bastidor: anillo en el suelo, postes y diagonales
	var posts := 14
	ring(frame, Vector3(0, 0.08, 0), R * 0.98, 0.14, posts * 2)
	ring(frame, Vector3(0, base_y - 0.1, 0), R * 0.98, 0.14, posts * 2)
	for i in posts:
		var a := TAU * i / posts
		var p := Vector3(cos(a) * R * 0.98, 0, sin(a) * R * 0.98)
		beam(frame, p, p + Vector3(0, base_y, 0), 0.12)
		if i % 2 == 0:
			var a2 := TAU * (i + 1) / posts
			var q := Vector3(cos(a2) * R * 0.98, base_y - 0.1, sin(a2) * R * 0.98)
			beam(frame, p + Vector3(0, 0.1, 0), q, 0.06)
	# tolva cónica y boca de descarga
	cyl(steel, Vector3(0, 0.9, 0), 0.35, R, base_y - 0.9, 32, false, false)
	cyl(dark, Vector3(0, 0.35, 0), 0.25, 0.25, 0.6, 12, false, true)
	box(dark, Vector3(0, 0.3, 0), Vector3(0.7, 0.3, 0.5))
	# cuerpo y anillos rigidizadores
	cyl(steel, Vector3(0, base_y, 0), R, R, wall, 48, false, false)
	var bands := 8
	for k in bands + 1:
		ring(frame, Vector3(0, base_y + wall * k / bands, 0), R + 0.03, 0.06, 48)
	# cubierta cónica con nervios, alero y remate
	var roof_h := 2.3
	cyl(steel, Vector3(0, base_y + wall, 0), R + 0.12, 0.45, roof_h, 48, false, false)
	for i in 18:
		var a := TAU * i / 18.0
		beam(frame, Vector3(cos(a) * (R + 0.1), base_y + wall + 0.03, sin(a) * (R + 0.1)), Vector3(cos(a) * 0.5, base_y + wall + roof_h, sin(a) * 0.5), 0.05)
	cyl(steel, Vector3(0, base_y + wall + roof_h, 0), 0.6, 0.6, 0.18, 24)
	cyl(frame, Vector3(0, base_y + wall + roof_h + 0.18, 0), 0.08, 0.04, 1.2, 8)
	beam(frame, Vector3(0, base_y + wall + roof_h + 1.3, 0), Vector3(1.2, base_y + wall + roof_h + 0.4, 0.3), 0.02)
	# barandilla de la cumbrera y registro con tapa
	ring(frame, Vector3(0, base_y + wall + roof_h * 0.62 + 0.4, 0), 1.35, 0.04, 32)
	for i in 8:
		var a := TAU * i / 8.0
		var r := 1.35
		var y := base_y + wall + roof_h * (1.0 - (r - 0.45) / (R + 0.12 - 0.45))
		beam(frame, Vector3(cos(a) * r, y, sin(a) * r), Vector3(cos(a) * r, base_y + wall + roof_h * 0.62 + 0.4, sin(a) * r), 0.03)
	cyl(steel, Vector3(1.4, base_y + wall + 0.9, 1.2), 0.45, 0.45, 0.25, 20, true, false, Basis(Vector3(1, 0, 1).normalized(), 0.55))
	cyl(dark, Vector3(R, base_y + wall - 0.9, 0), 0.08, 0.08, 0.05, 10, true, false, Basis(Vector3.BACK, -PI / 2.0))


# ------------------------------------------------------------------ graneros

## v: 0 rojo holandés grande, 1 gris envejecido de dos aguas, 2 marrón holandés pequeño.
func _barn(v: int) -> void:
	var L: float = [30.0, 20.0, 14.0][v]
	var W: float = [12.0, 10.0, 8.0][v]
	var H: float = [4.4, 4.0, 3.2][v]
	var wall_col: Color = [Color(0.66, 0.16, 0.12), Color(0.66, 0.66, 0.63), Color(0.45, 0.28, 0.17)][v]
	var walls := _mat("tablas", "WoodSiding009", wall_col, 2.2, true, true, 1.0)
	var trim := _mat("molduras", "WoodSiding009", Color(0.93, 0.93, 0.9), 2.2, false, true, 1.0)
	var roofm := _mat("cubierta", "CorrugatedSteel005" if v == 1 else "RoofingTiles006", Color(0.62, 0.48, 0.4) if v == 1 else Color(0.42, 0.47, 0.55), 2.0 if v == 1 else 1.4, v == 1, v != 1, 1.0, 0.3 if v == 1 else 0.0)
	var glass := _mat("cristal", "", Color(0.08, 0.1, 0.12), 1.0, false, false, 0.15, 0.2)
	var concrete := _mat("zocalo", "WoodSiding009", Color(0.75, 0.74, 0.7), 3.0, false, true, 1.0)
	var hw := W * 0.5
	var ov := 0.35
	# perfil de la cubierta (medio perfil, de alero a cumbrera)
	var prof: Array
	if v == 1:
		prof = [Vector2(hw + ov, H - 0.25), Vector2(0, H + W * 0.32)]
	else:
		var knee_x := hw * 0.66
		var knee_y := H + W * 0.3
		prof = [Vector2(hw + ov, H - 0.3), Vector2(knee_x, knee_y), Vector2(0, knee_y + W * 0.17)]
	# zócalo y paredes laterales
	for s: float in [-1.0, 1.0]:
		quad(walls, Vector3(-L / 2, 0.25, s * hw), Vector3(L / 2, 0.25, s * hw), Vector3(L / 2, H, s * hw), Vector3(-L / 2, H, s * hw), Vector3(0, 0, s))
		box(concrete, Vector3(0, 0.12, s * (hw + 0.02)), Vector3(L + 0.1, 0.25, 0.12))
		box(trim, Vector3(0, H - 0.05, s * (hw + 0.03)), Vector3(L, 0.12, 0.08))
	# hastiales (pared del frente y del fondo, con el perfil de la cubierta)
	for s: float in [-1.0, 1.0]:
		var x := s * L / 2
		var outline: Array = [Vector2(-hw, 0.25), Vector2(hw, 0.25), Vector2(hw, H)]
		for p in prof.slice(1):
			outline.append(Vector2(minf(p.x, hw), p.y))
		for i in range(prof.size() - 2, 0, -1):
			outline.append(Vector2(-minf(prof[i].x, hw), prof[i].y))
		outline.append(Vector2(-hw, H))
		var pts: Array = outline.map(func(p: Vector2) -> Vector3: return Vector3(x, p.y, p.x))
		poly(walls, pts, Vector3(s, 0, 0))
		box(concrete, Vector3(s * (L / 2 + 0.02), 0.12, 0), Vector3(0.12, 0.25, W + 0.1))
		# molduras blancas siguiendo el borde de la cubierta
		for i in prof.size() - 1:
			for side: float in [-1.0, 1.0]:
				var a: Vector2 = prof[i]
				var b: Vector2 = prof[i + 1]
				beam(trim, Vector3(x + s * 0.12, a.y + 0.05, side * a.x), Vector3(x + s * 0.12, b.y + 0.05, side * b.x), 0.25, 0.14)
	# cubierta: faldones entre los puntos del perfil, a los dos lados
	for side: float in [-1.0, 1.0]:
		for i in prof.size() - 1:
			var a: Vector2 = prof[i]
			var b: Vector2 = prof[i + 1]
			var la := Vector3(-L / 2 - ov, a.y, side * a.x)
			var lb := Vector3(-L / 2 - ov, b.y, side * b.x)
			var ra := Vector3(L / 2 + ov, a.y, side * a.x)
			var rb := Vector3(L / 2 + ov, b.y, side * b.x)
			var up := Vector3(0, 1, 0) + Vector3(0, 0, side) * 0.3
			quad(roofm, la, ra, rb, lb, up)
			quad(roofm, la - Vector3(0, 0.08, 0), lb - Vector3(0, 0.08, 0), rb - Vector3(0, 0.08, 0), ra - Vector3(0, 0.08, 0), -up)
		# canto del alero
		var e: Vector2 = prof[0]
		quad(trim, Vector3(-L / 2 - ov, e.y, side * e.x), Vector3(L / 2 + ov, e.y, side * e.x), Vector3(L / 2 + ov, e.y - 0.12, side * e.x), Vector3(-L / 2 - ov, e.y - 0.12, side * e.x), Vector3(0, 0, side))
	# frente (+x): puertas correderas con cruz en X, guía, puerta del pajar
	var fx := L / 2 + 0.06
	var door_w: float = [4.4, 3.6, 2.6][v]
	var door_h: float = [3.6, 3.2, 2.6][v]
	for s: float in [-1.0, 1.0]:
		var dz := s * door_w * 0.25
		box(walls, Vector3(fx, 0.25 + door_h / 2, dz), Vector3(0.1, door_h, door_w / 2 - 0.02))
		var z0 := dz - door_w * 0.25
		var z1 := dz + door_w * 0.25
		var y0 := 0.3
		var y1 := 0.25 + door_h
		for fr in [[Vector3(fx + 0.07, y0, z0), Vector3(fx + 0.07, y1, z0)], [Vector3(fx + 0.07, y0, z1), Vector3(fx + 0.07, y1, z1)], [Vector3(fx + 0.07, y0, z0), Vector3(fx + 0.07, y0, z1)], [Vector3(fx + 0.07, y1, z0), Vector3(fx + 0.07, y1, z1)], [Vector3(fx + 0.07, y0, z0), Vector3(fx + 0.07, y1, z1)], [Vector3(fx + 0.07, y0, z1), Vector3(fx + 0.07, y1, z0)]]:
			beam(trim, fr[0], fr[1], 0.16, 0.05)
	box(trim, Vector3(fx + 0.1, 0.25 + door_h + 0.25, door_w * 0.15), Vector3(0.1, 0.14, door_w * 1.6))
	# ventana / puerta del pajar en el hastial
	var ly := H + 0.9
	var lw := 1.6 if v != 2 else 1.4
	var lh := 2.0 if v != 2 else 1.6
	box(glass, Vector3(fx - 0.02, ly + lh / 2, 0), Vector3(0.05, lh, lw))
	for fr in [[Vector3(fx + 0.02, ly, -lw / 2), Vector3(fx + 0.02, ly + lh, -lw / 2)], [Vector3(fx + 0.02, ly, lw / 2), Vector3(fx + 0.02, ly + lh, lw / 2)], [Vector3(fx + 0.02, ly, -lw / 2), Vector3(fx + 0.02, ly, lw / 2)], [Vector3(fx + 0.02, ly + lh, -lw / 2), Vector3(fx + 0.02, ly + lh, lw / 2)], [Vector3(fx + 0.02, ly + lh / 2, -lw / 2), Vector3(fx + 0.02, ly + lh / 2, lw / 2)], [Vector3(fx + 0.02, ly, 0), Vector3(fx + 0.02, ly + lh, 0)]]:
		beam(trim, fr[0], fr[1], 0.14, 0.06)
	# ventanas: dos en el frente y una fila en cada costado
	var win := func(c: Vector3, n: Vector3) -> void:
		var t := Vector3(-n.z, 0, n.x)
		box(glass, c, (t * 0.9 + Vector3(0, 1.0, 0) + n * 0.04).abs())
		var o := c + n * 0.04
		for fr in [[o - t * 0.48 - Vector3(0, 0.55, 0), o - t * 0.48 + Vector3(0, 0.55, 0)], [o + t * 0.48 - Vector3(0, 0.55, 0), o + t * 0.48 + Vector3(0, 0.55, 0)], [o - t * 0.48 - Vector3(0, 0.55, 0), o + t * 0.48 - Vector3(0, 0.55, 0)], [o - t * 0.48 + Vector3(0, 0.55, 0), o + t * 0.48 + Vector3(0, 0.55, 0)], [o - Vector3(0, 0.55, 0), o + Vector3(0, 0.55, 0)], [o - t * 0.48, o + t * 0.48]]:
			beam(trim, fr[0], fr[1], 0.1, 0.1)
	for s: float in [-1.0, 1.0]:
		win.call(Vector3(fx - 0.01, 1.9, s * (door_w * 0.5 + (hw - door_w * 0.5) * 0.5)), Vector3.RIGHT)
	var nwin := int(L / 3.6)
	for i in nwin:
		var x := -L / 2 + (i + 0.5) * L / nwin
		for s: float in [-1.0, 1.0]:
			if v == 1 and i % 2 == 1:
				continue
			win.call(Vector3(x, 2.1, s * (hw + 0.01)), Vector3(0, 0, s))
	# granero gris: rampa del portón trasero y chimenea de ventilación
	if v == 1:
		box(concrete, Vector3(-L / 2 - 1.0, 0.1, 0), Vector3(2.0, 0.2, 3.5))
	if v == 0:
		# cupulino de ventilación en la cumbrera
		var top: Vector2 = prof[prof.size() - 1]
		box(trim, Vector3(0, top.y + 0.6, 0), Vector3(1.4, 1.2, 1.4))
		cyl(roofm, Vector3(0, top.y + 1.2, 0), 1.1, 0.05, 0.8, 4, false, false, Basis(Vector3.UP, PI / 4.0))


# ------------------------------------------------------------------ molino

func _windmill() -> void:
	var paint := _mat("pintura", "PaintedMetal013", Color(0.62, 0.5, 0.52), 1.5, false, true, 1.0, 0.35)
	var dark := _mat("hierro", "Metal021", Color(0.45, 0.43, 0.42), 1.0, false, false, 1.0, 0.5)
	var wood := _mat("tablero", "WoodSiding005", Color(0.6, 0.5, 0.45), 1.5, false, true, 1.0)
	var top_y := 9.0
	var base := 1.6
	var topw := 0.35
	var legs: Array = []
	for s in [[-1, -1], [1, -1], [1, 1], [-1, 1]]:
		legs.append([Vector3(s[0] * base, 0, s[1] * base), Vector3(s[0] * topw, top_y, s[1] * topw)])
	for l in legs:
		beam(paint, l[0], l[1], 0.1)
	# anillos horizontales y cruces
	var levels := 6
	for k in levels + 1:
		var t := float(k) / levels
		var y := t * (top_y - 0.6)
		var hwid := lerpf(base, topw, y / top_y)
		var c := [Vector3(-hwid, y, -hwid), Vector3(hwid, y, -hwid), Vector3(hwid, y, hwid), Vector3(-hwid, y, hwid)]
		for i in 4:
			beam(paint, c[i], c[(i + 1) % 4], 0.07)
		if k < levels:
			var y2 := float(k + 1) / levels * (top_y - 0.6)
			var h2 := lerpf(base, topw, y2 / top_y)
			var c2 := [Vector3(-h2, y2, -h2), Vector3(h2, y2, -h2), Vector3(h2, y2, h2), Vector3(-h2, y2, h2)]
			for i in 4:
				beam(dark, c[i], c2[(i + 1) % 4], 0.03)
	# plataforma de tablas y escalera por una cara
	var py := top_y * 0.62
	var pw := lerpf(base, topw, py / top_y) + 0.35
	for i in 5:
		box(wood, Vector3(-pw + (i + 0.5) * pw * 2 / 5, py, 0), Vector3(pw * 2 / 5 - 0.03, 0.06, pw * 2))
	for s: float in [-0.25, 0.25]:
		beam(paint, Vector3(base + 0.05, 0, s), Vector3(lerpf(base, topw, py / top_y) + 0.05, py, s), 0.05)
	for k in int(py / 0.4):
		var y := (k + 0.5) * 0.4
		var x := lerpf(base, topw, y / top_y) + 0.05 + (1.0 - y / py) * 0.0
		beam(paint, Vector3(x, y, -0.25), Vector3(x, y, 0.25), 0.03)
	# cabezal, rueda de 18 palas con aro, eje y cola
	var hub := Vector3(0, top_y + 0.4, 0)
	box(dark, hub, Vector3(0.9, 0.4, 0.35))
	var wheel_c := hub + Vector3(0.6, 0.2, 0)
	var wb := Basis(Vector3.BACK, PI / 2.0) # rueda en el plano YZ, mirando a +x
	var R := 1.8
	ring(dark, wheel_c, R * 0.55, 0.04, 36, wb)
	ring(dark, wheel_c, R * 0.98, 0.04, 36, wb)
	cyl(dark, wheel_c - Vector3(0.1, 0, 0), 0.15, 0.15, 0.3, 12, true, true, wb)
	for i in 18:
		var a := TAU * i / 18.0
		var dir := Vector3(0, cos(a), sin(a))
		beam(dark, wheel_c, wheel_c + dir * R * 0.55, 0.03)
		# pala: tablilla inclinada de 0,55 a 1,0 R
		var mid := wheel_c + dir * R * 0.78
		var side := Vector3(0, -sin(a), cos(a))
		var b := Basis(dir.cross(side).normalized(), dir, side).rotated(dir, 0.45)
		box(paint, mid, Vector3(0.02, R * 0.46, 0.26), b)
	# cola: brazo y veleta
	beam(dark, hub, hub + Vector3(-2.6, 0.2, 0), 0.05)
	beam(dark, hub + Vector3(0, 0.3, 0), hub + Vector3(-2.6, 0.5, 0), 0.03)
	box(paint, hub + Vector3(-3.1, 0.35, 0), Vector3(1.3, 1.5, 0.04))
	# varilla de la bomba y depósito al pie
	beam(dark, hub - Vector3(0, 0.2, 0), Vector3(0, 0.9, 0), 0.03)
	cyl(dark, Vector3(0.15, 0, 0.1), 0.3, 0.3, 0.9, 14, true, false)


# ------------------------------------------------------------------ tractor

func _tractor(body: Color) -> void:
	var paint := _mat("pintura", "PaintedMetal004", body, 2.6, false, true, 1.0, 0.25)
	var rust := _mat("oxido", "Metal021", Color(0.75, 0.55, 0.42), 0.8, false, false, 1.0, 0.4)
	var rubber := _mat("goma", "", Color(0.07, 0.07, 0.075), 1.0, false, false, 0.85, 0.0)
	var rim := _mat("llanta", "PaintedMetal004", Color(0.9, 0.62, 0.35), 0.8, false, true, 1.0, 0.3)
	var dark := _mat("negro", "", Color(0.12, 0.12, 0.12), 1.0, false, false, 0.6, 0.4)
	# chasis y capó (el tractor mira a +x)
	box(paint, Vector3(0.1, 0.95, 0), Vector3(2.4, 0.35, 0.5))
	box(paint, Vector3(0.55, 1.35, 0), Vector3(1.7, 0.5, 0.62))
	box(paint, Vector3(0.55, 1.62, 0), Vector3(1.66, 0.08, 0.5))
	# morro redondeado con rejilla
	cyl(paint, Vector3(1.4, 0.95, 0), 0.34, 0.34, 0.2, 14, true, true, Basis(Vector3.BACK, -PI / 2.0))
	box(paint, Vector3(1.45, 1.25, 0), Vector3(0.3, 0.75, 0.66))
	for k in 9:
		box(dark, Vector3(1.61, 0.98 + k * 0.07, 0), Vector3(0.02, 0.035, 0.5))
	# asiento, volante y columna
	box(paint, Vector3(-0.85, 1.55, 0), Vector3(0.45, 0.08, 0.45))
	box(paint, Vector3(-1.05, 1.75, 0), Vector3(0.08, 0.4, 0.45))
	beam(dark, Vector3(-0.5, 1.2, 0), Vector3(-0.35, 1.9, 0), 0.05)
	ring(dark, Vector3(-0.33, 1.95, 0), 0.2, 0.03, 16, Basis(Vector3.BACK, 0.5))
	# escape oxidado y filtro de aire
	cyl(rust, Vector3(0.95, 1.6, 0.15), 0.06, 0.06, 0.9, 10, true, false)
	cyl(rust, Vector3(0.95, 2.0, 0.15), 0.1, 0.1, 0.35, 10, true, false)
	cyl(paint, Vector3(0.95, 1.6, -0.18), 0.05, 0.08, 0.3, 10, true, false)
	# eje delantero y guardabarros traseros
	box(paint, Vector3(1.25, 0.55, 0), Vector3(0.15, 0.12, 1.5))
	for s: float in [-1.0, 1.0]:
		# guardabarros: arco de chapa sobre la rueda trasera
		var fc := Vector3(-0.75, 0.72, s * 0.95)
		for i in 6:
			var a0 := lerpf(0.35, PI - 0.35, i / 6.0)
			var a1 := lerpf(0.35, PI - 0.35, (i + 1) / 6.0)
			beam(paint, fc + Vector3(cos(a0), sin(a0), 0) * 0.86, fc + Vector3(cos(a1), sin(a1), 0) * 0.86, 0.5, 0.03)
	# ruedas: traseras grandes con tacos en V, delanteras con estrías
	for s: float in [-1.0, 1.0]:
		_wheel(rubber, rim, Vector3(-0.75, 0.72, s * 0.95), 0.72, 0.4, s, true)
		_wheel(rubber, rim, Vector3(1.25, 0.38, s * 0.72), 0.38, 0.18, s, false)


func _wheel(rubber: String, rim: String, c: Vector3, r: float, w: float, s: float, lugs: bool) -> void:
	var b := Basis(Vector3.RIGHT, PI / 2.0) # eje de la rueda a lo largo de z
	cyl(rubber, c - Vector3(0, 0, w / 2), r, r, w, 28, true, true, b)
	cyl(rim, c - Vector3(0, 0, w / 2 + 0.01 * s), r * 0.62, r * 0.62, w + 0.02, 20, true, true, b)
	cyl(rim, c + Vector3(0, 0, s * (w / 2 + 0.02)), r * 0.16, r * 0.1, 0.08, 10, true, false, Basis(Vector3.RIGHT, -PI / 2.0 * s))
	if lugs:
		for i in 22:
			var a := TAU * i / 22.0
			var d := Vector3(cos(a), sin(a), 0)
			for k: float in [-1.0, 1.0]:
				var p := c + d * (r - 0.005) + Vector3(0, 0, k * w * 0.22)
				var t := Vector3(-sin(a), cos(a), 0)
				box(rubber, p + t * k * 0.04, Vector3(0.07, 0.07, w * 0.42), Basis(d.cross(Vector3(0, 0, 1)).normalized(), d, Vector3(0, 0, 1)).rotated(d, k * 0.5))
	else:
		for k: float in [-1.0, 0.0, 1.0]:
			ring(rubber, c + Vector3(0, 0, k * w * 0.3), r + 0.01, 0.025, 28, b)
