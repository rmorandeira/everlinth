class_name Rural
## Campo (bioma countryside): dibuja las salas rurales que manda el servidor
## (citygen/countryside.ts) sin nada de la ciudad (ni aceras, ni farolas, ni semáforos):
## - prado de base y las parcelas (rastrojo con rodadas, tierra arada, pradera, trigal)
##   con rural_ground.gdshader;
## - trigo en 3D por capas (wheat.gdshader) en las parcelas de trigo, recortado donde
##   pasan carreteras, pistas o hay una granja;
## - carreteras secundarias: asfalto (el de la ciudad), arcén de tierra, líneas blancas
##   de borde y discontinua amarilla en el centro;
## - pistas de tierra con sus rodadas;
## - granjas: graneros, silos, molinos y tractores (modelos del catálogo "countryside/…").
## Todo en tiles globales → unidades de render ((g - origen) * T), troceado por salas.

const T := Protocol.TILE_SIZE
const W := Protocol.SCREEN_WIDTH
const H := Protocol.SCREEN_HEIGHT
const Y := 0.05
const ROAD_HALF := 2.4
const WHEAT_LAYERS := 9
const WHEAT_H := 0.36 # ~1,1 m
const WHEAT_CELL := 3.0 # tiles por lado de cada trozo del trigal

static var _mats := {}


static func ground_mat(mode: int) -> ShaderMaterial:
	var key := "g%d" % mode
	if not _mats.has(key):
		var m := ShaderMaterial.new()
		m.shader = load("res://shaders/rural_ground.gdshader")
		m.set_shader_parameter("mode", mode)
		var base := "res://assets/textures/countryside/%s_%s.jpg"
		m.set_shader_parameter("grass_tex", load(base % ["Grass003", "Color"]))
		m.set_shader_parameter("grass_nrm", load(base % ["Grass003", "NormalGL"]))
		m.set_shader_parameter("dirt_tex", load(base % ["Ground109", "Color"]))
		m.set_shader_parameter("dirt_nrm", load(base % ["Ground109", "NormalGL"]))
		m.set_shader_parameter("soil_tex", load(base % ["Ground048", "Color"]))
		m.set_shader_parameter("soil_nrm", load(base % ["Ground048", "NormalGL"]))
		_mats[key] = m
	return _mats[key]


static func wheat_mat() -> ShaderMaterial:
	if not _mats.has("wheat"):
		var m := ShaderMaterial.new()
		m.shader = load("res://shaders/wheat.gdshader")
		_mats.wheat = m
	return _mats.wheat


static func _dist_seg(p: Vector2, a: Vector2, b: Vector2) -> float:
	return p.distance_to(Geometry2D.get_closest_point_to_segment(p, a, b))


## rooms: [{ sx, sy, city }] de las salas rurales. root: nodo de la escena.
static func build(root: Node3D, rooms: Array, ogx: int, ogz: int) -> void:
	var L := func(gx: float, gy: float, y: float) -> Vector3:
		return Vector3((gx - ogx) * T, y, (gy - ogz) * T)
	var roads := {}
	var tracks := {}
	var fields := {}
	var props := {}
	for r in rooms:
		var c: Dictionary = r.city
		for s in c.get("roads", []):
			roads[s.id] = s
		for t in c.get("tracks", []):
			tracks["%.2f,%.2f,%.2f,%.2f" % [t[0], t[1], t[2], t[3]]] = t
		for f in c.get("fields", []):
			fields[f.id] = f
		for p in c.get("props", []):
			props[p.id] = p
	var chunk := Vector2(W * T, H * T)
	# prado de base, una lámina por sala
	var base := GeoBatch.new()
	base.chunk = chunk
	for r in rooms:
		var gx0 := int(r.sx) * W
		var gy0 := int(r.sy) * H
		base.quad(ground_mat(0), L.call(gx0 + W * 0.5, gy0 + H * 0.5, Y), W * T, H * T, 0.0)
	base.build(root, false)
	# parcelas (cada una su instancia: centro, tamaño y labor para el shader)
	var modes := {"wheat": 1, "stubble": 2, "plowed": 3, "pasture": 4}
	for f in fields.values():
		var c: Vector3 = L.call((f.x0 + f.x1) * 0.5, (f.y0 + f.y1) * 0.5, Y + 0.002)
		var sx: float = (f.x1 - f.x0) * T
		var sz: float = (f.y1 - f.y0) * T
		var pm := PlaneMesh.new()
		pm.size = Vector2(sx, sz)
		var mi := MeshInstance3D.new()
		mi.mesh = pm
		mi.material_override = ground_mat(modes.get(f.kind, 4))
		mi.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
		mi.position = c
		mi.set_instance_shader_parameter("rect_c", Vector2(c.x, c.z))
		mi.set_instance_shader_parameter("rect_h", Vector2(sx, sz) * 0.5)
		mi.set_instance_shader_parameter("rect_ang", float(f.ang))
		root.add_child(mi)
	# obstáculos del trigal: carreteras, pistas y granjas (tiles)
	var blocks: Array = [] # [a, b, radio]
	for s in roads.values():
		blocks.append([Vector2(s.x0, s.y0), Vector2(s.x1, s.y1), ROAD_HALF + 1.4])
	for t in tracks.values():
		blocks.append([Vector2(t[0], t[1]), Vector2(t[2], t[3]), float(t[4]) + 0.8])
	for p in props.values():
		blocks.append([Vector2(p.x, p.y), Vector2(p.x, p.y), 16.0 if str(p.m).contains("barn") else 5.0])
	var blocked := func(g: Vector2) -> bool:
		for b in blocks:
			if _dist_seg(g, b[0], b[1]) < b[2]:
				return true
		return false
	_wheat(root, fields.values(), blocked, L)
	# carreteras: arcén, asfalto, líneas y juntas
	var flat := GeoBatch.new()
	flat.chunk = chunk
	var shoulder := ground_mat(5)
	var asphalt := City.asphalt_mat(Color("9a9b9c"))
	var white := City.paint_mat(Color("e8e6de"))
	var yellow := City.paint_mat(Color("e0b81a"))
	for s in roads.values():
		var a := Vector2(s.x0, s.y0)
		var b := Vector2(s.x1, s.y1)
		var d := b - a
		var l := d.length()
		if l < 0.1:
			continue
		var u := d / l
		var n := Vector2(-u.y, u.x)
		var ang := atan2(d.y, d.x)
		var mid := (a + b) * 0.5
		flat.quad(shoulder, L.call(mid.x, mid.y, Y + 0.004), (l + 0.6) * T, (ROAD_HALF + 1.2) * 2.0 * T, ang)
		flat.quad(asphalt, L.call(mid.x, mid.y, Y + 0.012), (l + 0.3) * T, ROAD_HALF * 2.0 * T, ang, 1.4)
		flat.disc(asphalt, L.call(b.x, b.y, Y + 0.011), ROAD_HALF * T, 1.4, 16)
		for side: float in [-1.0, 1.0]:
			var e := mid + n * side * (ROAD_HALF - 0.25)
			flat.quad(white, L.call(e.x, e.y, Y + 0.018), (l + 0.2) * T, 0.12 * T, ang, 1.6)
		# discontinua amarilla por longitud de arco (casa entre tramos y salas)
		var s0: float = s.s0
		var k := floori(s0 / 6.0)
		while k * 6.0 < s0 + l:
			var d0 := maxf(s0, k * 6.0)
			var d1 := minf(s0 + l, k * 6.0 + 3.0)
			k += 1
			if d1 - d0 < 0.2:
				continue
			var tm := (d0 + d1) * 0.5 - s0
			var pc := a + u * tm
			flat.quad(yellow, L.call(pc.x, pc.y, Y + 0.018), (d1 - d0) * T, 0.12 * T, ang, 1.6)
	# pistas de tierra
	var track := ground_mat(5)
	for t in tracks.values():
		var a := Vector2(t[0], t[1])
		var b := Vector2(t[2], t[3])
		var d := b - a
		var l := d.length()
		if l < 0.1:
			continue
		var mid := (a + b) * 0.5
		flat.quad(track, L.call(mid.x, mid.y, Y + 0.006), (l + 1.0) * T, float(t[4]) * 2.4 * T, atan2(d.y, d.x), 0.0, l / 3.0)
	flat.build(root, false)
	_utility(root, roads.values(), L)
	_fences(root, fields.values(), blocked, L)
	# granjas
	for p in props.values():
		var key: String = p.m
		var model := Kenney.model(key)
		if model.is_empty():
			continue
		var s := Kenney.base_scale(key)
		var xf := Transform3D(Basis(Vector3.UP, -float(p.a)).scaled(Vector3(s, s, s)), L.call(p.x, p.y, Y))
		for part in model.parts:
			var mi := MeshInstance3D.new()
			mi.mesh = part[0]
			mi.transform = xf * (part[1] as Transform3D)
			root.add_child(mi)


## Trigal por capas: trozos de WHEAT_CELL tiles dentro de cada parcela de trigo (salvo
## donde lo pisa algo), con WHEAT_LAYERS láminas cada uno; una malla por sala.
static func _wheat(root: Node3D, fields: Array, blocked: Callable, L: Callable) -> void:
	var per_room := {}
	for f in fields:
		if f.kind != "wheat":
			continue
		var x: float = f.x0 + 0.5
		while x < f.x1 - 0.5:
			var x1 := minf(x + WHEAT_CELL, f.x1 - 0.5)
			var y: float = f.y0 + 0.5
			while y < f.y1 - 0.5:
				var y1 := minf(y + WHEAT_CELL, f.y1 - 0.5)
				var c := Vector2((x + x1) * 0.5, (y + y1) * 0.5)
				if not blocked.call(c):
					var k := Vector2i(floori(c.x / W), floori(c.y / H))
					if not per_room.has(k):
						var st := SurfaceTool.new()
						st.begin(Mesh.PRIMITIVE_TRIANGLES)
						per_room[k] = st
					var st2: SurfaceTool = per_room[k]
					for i in WHEAT_LAYERS:
						var t := float(i) / (WHEAT_LAYERS - 1)
						var h := Y + 0.01 + t * WHEAT_H
						var q := [L.call(x, y, h), L.call(x1, y, h), L.call(x1, y1, h), L.call(x, y1, h)]
						for o in [0, 2, 1, 0, 3, 2]:
							st2.set_normal(Vector3.UP)
							st2.set_uv(Vector2.ZERO)
							st2.set_uv2(Vector2(t, 0))
							st2.add_vertex(q[o])
				y = y1
			x = x1
	for k in per_room:
		var mesh: ArrayMesh = (per_room[k] as SurfaceTool).commit()
		mesh.surface_set_material(0, wheat_mat())
		var mi := MeshInstance3D.new()
		mi.mesh = mesh
		mi.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
		root.add_child(mi)


# ------------------------------------------------------------------ tendido y farolas

const M := 1.0 / 3.0 # metros → unidades de render
const POLE_EVERY := 20.0 # tiles entre postes (30 m)
const POLE_OFF := ROAD_HALF + 2.6 # desde el eje de la carretera (tiles)
const LAMP_EVERY := 3 # uno de cada tres postes lleva farola

static var _lamps: Array = [] # OmniLight3D de las farolas del campo
static var _night := 0.0


## De noche se encienden las farolas (luz suave amarilla); lo llama Lighting cada fotograma.
static func set_night(n: float) -> void:
	if absf(n - _night) < 0.01:
		return
	_night = n
	var on := n > 0.02
	var alive: Array = []
	for l in _lamps:
		if is_instance_valid(l):
			(l as OmniLight3D).visible = on
			(l as OmniLight3D).light_energy = n * 1.6
			alive.append(l)
	_lamps = alive
	if _mats.has("bulb"):
		(_mats.bulb as StandardMaterial3D).emission_energy_multiplier = n * 5.0


static func bulb_mat() -> StandardMaterial3D:
	if not _mats.has("bulb"):
		var m := StandardMaterial3D.new()
		m.albedo_color = Color("fff2cc")
		m.emission_enabled = true
		m.emission = Color("ffc873")
		m.emission_energy_multiplier = _night * 5.0
		_mats.bulb = m
	return _mats.bulb


static func pool_mat() -> ShaderMaterial:
	if not _mats.has("pool"):
		var m := ShaderMaterial.new()
		m.shader = load("res://shaders/lamp_pool.gdshader")
		m.render_priority = 6
		_mats.pool = m
	return _mats.pool


## Viga de sección w (unidades) entre a y b.
static func _beam(b: GeoBatch, mat: Material, a: Vector3, c: Vector3, w: float) -> void:
	var d := c - a
	var l := d.length()
	if l < 1e-4:
		return
	var z := d / l
	var x := z.cross(Vector3.UP)
	if x.length() < 0.1:
		x = z.cross(Vector3.RIGHT)
	x = x.normalized()
	var y := z.cross(x).normalized()
	b.mesh(StreetFurniture.prim("box"), Transform3D(Basis(x * w, y * w, z * l), (a + c) * 0.5), mat)


## Cable colgado en catenaria (aproximada por parábola) entre dos puntos.
static func _wire(b: GeoBatch, mat: Material, a: Vector3, c: Vector3, sag: float) -> void:
	var n := 8
	var prev := a
	for i in range(1, n + 1):
		var t := float(i) / n
		var p := a.lerp(c, t) - Vector3(0, sag * 4.0 * t * (1.0 - t), 0)
		_beam(b, mat, prev, p, 0.022 * M)
		prev = p


## Postes de madera a un lado de cada carretera (cada 30 m por longitud de arco: casan
## entre tramos y salas), línea eléctrica de tres conductores y telefónica de dos,
## colgadas entre postes, y farola con charco de luz en uno de cada tres.
static func _utility(root: Node3D, roads: Array, L: Callable) -> void:
	var poles := {} # "familia:k" -> [pos (tiles), dirección, normal hacia fuera, k]
	for s in roads:
		var fam: String = str(s.id).split(":")[0]
		var a := Vector2(s.x0, s.y0)
		var b := Vector2(s.x1, s.y1)
		var d := b - a
		var l := d.length()
		if l < 0.1:
			continue
		var u := d / l
		var side := 1.0 if hash(fam) % 2 == 0 else -1.0
		var nrm := Vector2(-u.y, u.x) * side
		var s0: float = s.s0
		var k := ceili(s0 / POLE_EVERY)
		while k * POLE_EVERY < s0 + l:
			var t := (k * POLE_EVERY - s0) / l
			poles["%s:%d" % [fam, k]] = [a + d * t + nrm * POLE_OFF, u, nrm, k]
			k += 1
	var solid := GeoBatch.new()
	var wires := GeoBatch.new()
	var wood := StreetFurniture.lambert(Color("5d4a3a"))
	var metal := StreetFurniture.lambert(Color("7a7d80"))
	var porcelain := StreetFurniture.lambert(Color("cfd4d6"))
	var cable := StreetFurniture.lambert(Color("1b1b1d"))
	var tops := {} # clave -> [puntos de amarre (unidades)]
	for key in poles:
		var pl: Array = poles[key]
		var p: Vector2 = pl[0]
		var nrm: Vector2 = pl[2]
		var base: Vector3 = L.call(p.x, p.y, Y)
		var n3 := Vector3(nrm.x, 0, nrm.y)
		var hgt := 9.0 * M
		# fuste de madera algo inclinado al azar, cruceta alta y cruceta baja de teléfono
		var lean := Vector3(hash(key) % 7 - 3, 0, hash(str(key) + "z") % 7 - 3) * 0.004
		var top := base + Vector3(0, hgt, 0) + lean
		_beam(solid, wood, base, top, 0.26 * M)
		var arm_h := top - Vector3(0, 0.45 * M, 0)
		_beam(solid, wood, arm_h - n3 * 1.2 * M, arm_h + n3 * 1.2 * M, 0.12 * M)
		var tel_h := base + Vector3(0, 6.6 * M, 0) + lean * 0.7
		_beam(solid, wood, tel_h - n3 * 0.55 * M, tel_h + n3 * 0.55 * M, 0.1 * M)
		var pts: Array = []
		for o: float in [-1.05, 0.0, 1.05]:
			var q: Vector3 = arm_h + n3 * o * M + Vector3(0, 0.06 * M, 0)
			if o == 0.0:
				q = top + Vector3(0, 0.15 * M, 0)
			StreetFurniture.part(solid, Transform3D(), "cyl", porcelain, Vector3(0.05 * M, 0.18 * M, 0.05 * M), q - Vector3(0, 0.12 * M, 0))
			pts.append(q + Vector3(0, 0.06 * M, 0))
		for o: float in [-0.4, 0.4]:
			pts.append(tel_h + n3 * o * M + Vector3(0, 0.05 * M, 0))
		tops[key] = pts
		# farola: brazo hacia la calzada, luminaria, bombilla, luz y charco
		if int(pl[3]) % LAMP_EVERY == 0:
			var arm0 := base + Vector3(0, 7.6 * M, 0) + lean
			var arm1 := arm0 - n3 * 2.1 * M + Vector3(0, 0.25 * M, 0)
			_beam(solid, metal, arm0, arm1, 0.06 * M)
			solid.mesh(StreetFurniture.prim("box"), Transform3D(Basis.looking_at(-n3, Vector3.UP).scaled(Vector3(0.28, 0.12, 0.55) * M), arm1 - n3 * 0.2 * M), metal)
			var bulb := arm1 - n3 * 0.2 * M - Vector3(0, 0.08 * M, 0)
			solid.mesh(StreetFurniture.prim("box"), Transform3D(Basis.looking_at(-n3, Vector3.UP).scaled(Vector3(0.22, 0.04, 0.4) * M), bulb), bulb_mat())
			var light := OmniLight3D.new()
			light.light_color = Color("ffcf87")
			light.omni_range = 4.2
			light.omni_attenuation = 1.3
			light.light_energy = _night * 1.6
			light.visible = _night > 0.02
			light.shadow_enabled = false
			light.position = bulb - Vector3(0, 0.15, 0)
			root.add_child(light)
			_lamps.append(light)
			var pool := MeshInstance3D.new()
			var pm := PlaneMesh.new()
			pm.size = Vector2(5.5, 5.5)
			pool.mesh = pm
			pool.material_override = pool_mat()
			pool.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
			pool.position = Vector3(bulb.x, Y + 0.02, bulb.z)
			root.add_child(pool)
	# cables entre postes consecutivos de la misma carretera
	for key in tops:
		var parts: PackedStringArray = str(key).rsplit(":", true, 1)
		var nxt := "%s:%d" % [parts[0], int(parts[1]) + 1]
		if not tops.has(nxt):
			continue
		var a: Array = tops[key]
		var b: Array = tops[nxt]
		for i in a.size():
			_wire(wires, cable, a[i], b[i], (0.75 if i < 3 else 0.55) * M)
	solid.build(root, true)
	wires.build(root, false)


# ------------------------------------------------------------------ cierres de fincas

## Vallas de alambre con postes de madera por el linde de algo más de la mitad de las
## fincas, abiertas donde pasa una pista, una carretera o hay una granja.
static func _fences(root: Node3D, fields: Array, blocked: Callable, L: Callable) -> void:
	var posts: Array[Transform3D] = []
	var wires := GeoBatch.new()
	var wire_m := StreetFurniture.lambert(Color("4a4a48"))
	var post_s := Vector3(0.1, 1.3, 0.1) * M
	for f in fields:
		if hash(str(f.id) + "valla") % 100 >= 55:
			continue
		var x0: float = f.x0 + 0.6
		var y0: float = f.y0 + 0.6
		var x1: float = f.x1 - 0.6
		var y1: float = f.y1 - 0.6
		var corners := [Vector2(x0, y0), Vector2(x1, y0), Vector2(x1, y1), Vector2(x0, y1)]
		for e in 4:
			var a: Vector2 = corners[e]
			var b: Vector2 = corners[(e + 1) % 4]
			var n := maxi(1, ceili(a.distance_to(b) / 2.0))
			var run_start := Vector3.ZERO
			var run_len := 0
			var last := Vector3.ZERO
			for i in n + 1:
				var p := a.lerp(b, float(i) / n)
				var ok: bool = not blocked.call(p)
				var q: Vector3 = L.call(p.x, p.y, Y)
				if ok:
					var tilt := Basis(Vector3(1, 0, 0), (hash(p) % 9 - 4) * 0.01)
					posts.append(Transform3D(tilt.scaled(post_s), q + Vector3(0, post_s.y * 0.5, 0)))
					if run_len == 0:
						run_start = q
					run_len += 1
					last = q
				if (not ok or i == n) and run_len > 1:
					for hy: float in [0.45, 0.8, 1.15]:
						var up := Vector3(0, hy * M, 0)
						_beam(wires, wire_m, run_start + up, last + up, 0.02 * M)
				if not ok:
					run_len = 0
	if not posts.is_empty():
		var mm := MultiMesh.new()
		mm.transform_format = MultiMesh.TRANSFORM_3D
		mm.mesh = StreetFurniture.prim("box")
		mm.instance_count = posts.size()
		for i in posts.size():
			mm.set_instance_transform(i, posts[i])
		var mmi := MultiMeshInstance3D.new()
		mmi.multimesh = mm
		mmi.material_override = StreetFurniture.lambert(Color("6b5a47"))
		mmi.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
		root.add_child(mmi)
	wires.build(root, false)
