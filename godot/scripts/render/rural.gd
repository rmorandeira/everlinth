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
