class_name Coast
## Costa real (OpenStreetMap) de las salas de ciudad OSM:
## - Suelo del paseo recortado exactamente por la costa: marching squares sobre un campo
##   de distancias con signo (costa, playas y muelles) muestreado en las esquinas de tile.
## - Muro del paseo marítimo a lo largo de ese borde: la "coraza" (sillería de granito,
##   algo ataludada, hasta el fondo del mar, con escollera al pie) donde el paseo da al
##   mar, y un muro vertical más bajo donde da a la arena; albardilla de piedra,
##   barandilla blanca y farolas del paseo.
## - Playas en desnivel: arena seca junto al muro que baja hasta el agua y sigue
##   hundiéndose bajo el mar (poca profundidad → espuma y rompientes).
## - El mar: plano con oleaje (sea.gdshader) y un fondo oscuro debajo.
## Todo en tiles globales → unidades de render (City: (g - origen) * T).

const T := Protocol.TILE_SIZE
const W := Protocol.SCREEN_WIDTH
const H := Protocol.SCREEN_HEIGHT
const Y := 0.05           # suelo del paseo
const SEA_Y := -0.75      # nivel del mar (~2,4 m bajo el paseo)
const SEA_FLOOR := -2.1   # fondo junto al muro
const BEACH_TOP := -0.42  # arena seca junto al muro de la playa
const R := 12.0           # alcance del campo de distancias (tiles)
const CELL := 6.0
const PIER_HALF := 2.2
const BEACH_NEAR := 8.0   # una zona de arena es playa si toca la costa (tiles)
const RAIL_H := 0.36      # barandilla (~1,1 m)
const LAMP_EVERY := 16.0  # tiles entre farolas del paseo

## Alturas del terreno para los personajes: Vector2i(tile global) -> Vector2(G, altura
## de la playa). Solo esquinas de salas con costa; el resto del mundo está a Y.
static var corners := {}
static var origin := Vector2i.ZERO
static var _mats := {}


## Campo de distancias con signo a un conjunto de tramos orientados: positivo a la
## izquierda del tramo (con la y hacia el sur: tierra en la costa de OSM, interior en los
## polígonos orientados igual). Exacto hasta R; más lejos, solo el signo (muestreo grueso).
class Field:
	var segs := PackedFloat32Array()
	var grid := {}
	var coarse := {}
	var default_value := -R

	func add(x0: float, y0: float, x1: float, y1: float) -> void:
		if absf(x1 - x0) + absf(y1 - y0) < 0.001:
			return
		segs.append_array([x0, y0, x1, y1])

	func finish() -> void:
		for i in segs.size() / 4:
			var k := i * 4
			var cx0 := floori((minf(segs[k], segs[k + 2]) - R) / CELL)
			var cx1 := floori((maxf(segs[k], segs[k + 2]) + R) / CELL)
			var cy0 := floori((minf(segs[k + 1], segs[k + 3]) - R) / CELL)
			var cy1 := floori((maxf(segs[k + 1], segs[k + 3]) + R) / CELL)
			for cy in range(cy0, cy1 + 1):
				for cx in range(cx0, cx1 + 1):
					var c := Vector2i(cx, cy)
					if not grid.has(c):
						grid[c] = PackedInt32Array()
					grid[c].append(i)

	func is_empty() -> bool:
		return segs.is_empty()

	## Distancia con signo al tramo más cercano de la lista (INF si no hay ninguno).
	func _signed(px: float, py: float, cands) -> float:
		var best := INF
		var line := 0.0
		var sgn := 1.0
		for i in cands:
			var k: int = i * 4
			var x0 := segs[k]
			var y0 := segs[k + 1]
			var vx := segs[k + 2] - x0
			var vy := segs[k + 3] - y0
			var l2 := vx * vx + vy * vy
			var t := clampf(((px - x0) * vx + (py - y0) * vy) / l2, 0.0, 1.0)
			var d := Vector2(px - (x0 + t * vx), py - (y0 + t * vy)).length()
			var cr := vx * (py - y0) - vy * (px - x0)
			var ld := absf(cr) / sqrt(l2)
			# empate en un vértice compartido: manda el tramo más "de frente"
			if d < best - 0.0001 or (d < best + 0.0001 and ld > line):
				best = d
				line = ld
				sgn = -1.0 if cr > 0.0 else 1.0
		return best * sgn

	func value(px: float, py: float) -> float:
		if segs.is_empty():
			return default_value
		var c := Vector2i(floori(px / CELL), floori(py / CELL))
		if grid.has(c):
			var v := _signed(px, py, grid[c])
			if absf(v) < R:
				return v
		var k := Vector2i(roundi(px / CELL), roundi(py / CELL))
		if not coarse.has(k):
			coarse[k] = signf(_signed(k.x * CELL, k.y * CELL, range(segs.size() / 4)))
		return R * coarse[k]


static func _pbr(key: String, tex: String, tile: float, tint: Color, algae := 0.0, wet := 0.2) -> Material:
	if _mats.has(key):
		return _mats[key]
	var m := ShaderMaterial.new()
	m.shader = load("res://shaders/coast_pbr.gdshader")
	m.set_shader_parameter("albedo_tex", load("res://assets/textures/coast/%s_Color.jpg" % tex))
	m.set_shader_parameter("normal_tex", load("res://assets/textures/coast/%s_NormalGL.jpg" % tex))
	m.set_shader_parameter("rough_tex", load("res://assets/textures/coast/%s_Roughness.jpg" % tex))
	m.set_shader_parameter("tile", tile)
	m.set_shader_parameter("tint", tint)
	m.set_shader_parameter("sea_y", SEA_Y)
	m.set_shader_parameter("algae", algae)
	m.set_shader_parameter("wet_band", wet)
	_mats[key] = m
	return m


static func stone() -> Material:
	return _pbr("stone", "Bricks066", 1.1, Color(0.86, 0.84, 0.8), 1.0, 0.28)


static func coping() -> Material:
	return _pbr("coping", "Bricks066", 3.0, Color(1.05, 1.03, 0.98))


static func sand() -> Material:
	return _pbr("sand", "Ground093A", 1.4, Color(1.02, 0.98, 0.9), 0.0, 0.3)


static func rock() -> Material:
	return _pbr("rock", "Rock030", 0.8, Color(0.8, 0.8, 0.78), 1.0, 0.3)


static func sidewalk() -> Material:
	if not _mats.has("sidewalk"):
		var m := ShaderMaterial.new()
		m.shader = load("res://shaders/sidewalk.gdshader")
		_mats.sidewalk = m
	return _mats.sidewalk


static func sea_mat() -> Material:
	if not _mats.has("sea"):
		var m := ShaderMaterial.new()
		m.shader = load("res://shaders/sea.gdshader")
		_mats.sea = m
	return _mats.sea


## Altura del suelo en (x, z) (unidades de render de la escena actual).
static func height_at(x: float, z: float) -> float:
	if corners.is_empty():
		return Y
	var gx := x / T + origin.x
	var gy := z / T + origin.y
	var ix := floori(gx)
	var iy := floori(gy)
	var c00: Vector2 = corners.get(Vector2i(ix, iy), Vector2(1, Y))
	var c10: Vector2 = corners.get(Vector2i(ix + 1, iy), Vector2(1, Y))
	var c01: Vector2 = corners.get(Vector2i(ix, iy + 1), Vector2(1, Y))
	var c11: Vector2 = corners.get(Vector2i(ix + 1, iy + 1), Vector2(1, Y))
	var fx := gx - ix
	var fy := gy - iy
	var g := lerpf(lerpf(c00.x, c10.x, fx), lerpf(c01.x, c11.x, fx), fy)
	if g > 0.0:
		return Y
	return maxf(SEA_Y, lerpf(lerpf(c00.y, c10.y, fx), lerpf(c01.y, c11.y, fx), fy))


static func beach_height(d: float) -> float:
	if d >= 0.0:
		return lerpf(SEA_Y + 0.05, BEACH_TOP, smoothstep(0.0, 11.0, d))
	return maxf(SEA_FLOOR + 0.3, SEA_Y + 0.05 + d * 0.055)


## rooms: [{ sx, sy, city, sea (sala entera de mar sin costa cerca) }]. El suelo de las
## salas OSM lo pone esto (Ground no les pone el plano de acera).
static func build(root: Node3D, rooms: Array, ogx: int, ogz: int) -> void:
	corners.clear()
	origin = Vector2i(ogx, ogz)
	var ground := GeoBatch.new()
	var walls := GeoBatch.new()
	var beach := GeoBatch.new()
	var any_water := false
	var lo := Vector2(INF, INF)
	var hi := Vector2(-INF, -INF)
	for room in rooms:
		var r := _Room.new()
		r.setup(room, ogx, ogz)
		r.build(ground, walls, beach)
		any_water = any_water or r.has_water
		lo = lo.min(Vector2(r.gx0, r.gy0))
		hi = hi.max(Vector2(r.gx0 + W, r.gy0 + H))
	for b in [[ground, false], [beach, false], [walls, true]]:
		var mesh: ArrayMesh = b[0].to_mesh()
		if mesh.get_surface_count() == 0:
			continue
		var mi := MeshInstance3D.new()
		mi.mesh = mesh
		mi.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_ON if b[1] else GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
		root.add_child(mi)
	if any_water:
		_sea(root, lo, hi, ogx, ogz)


static func _sea(root: Node3D, lo: Vector2, hi: Vector2, ogx: int, ogz: int) -> void:
	var size := (hi - lo) * T + Vector2(8, 8)
	var c := ((lo + hi) * 0.5 - Vector2(ogx, ogz)) * T
	var pm := PlaneMesh.new()
	pm.size = size
	pm.subdivide_width = int(size.x * 2.0)
	pm.subdivide_depth = int(size.y * 2.0)
	var sea := MeshInstance3D.new()
	sea.mesh = pm
	sea.material_override = sea_mat()
	sea.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	sea.position = Vector3(c.x, SEA_Y, c.y)
	root.add_child(sea)
	var bed_mesh := PlaneMesh.new()
	bed_mesh.size = size
	var bed := MeshInstance3D.new()
	bed.mesh = bed_mesh
	bed.material_override = _pbr("seabed", "Ground093A", 2.0, Color(0.42, 0.44, 0.38))
	bed.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	bed.position = Vector3(c.x, SEA_FLOOR, c.y)
	root.add_child(bed)


## Una sala: campos, suelo, muros y playa.
class _Room:
	var gx0 := 0
	var gy0 := 0
	var ogx := 0
	var ogz := 0
	var coast := Field.new()
	var sand := Field.new()
	var shore := Field.new() # orilla de las playas (de ahí sube la arena)
	var piers := PackedFloat32Array()
	var g := PackedFloat32Array()   # valor del campo del paseo por esquina
	var d := PackedFloat32Array()   # distancia a la orilla por esquina (+ en la arena, - bajo el mar)
	var s := PackedFloat32Array()   # distancia a la playa por esquina
	var has_water := false
	var sea_room := false
	var tiles: Array = []

	func setup(room: Dictionary, ox: int, oz: int) -> void:
		ogx = ox
		ogz = oz
		gx0 = int(room.sx) * W
		gy0 = int(room.sy) * H
		sea_room = room.get("sea", false)
		tiles = room.get("tiles", [])
		var city: Dictionary = room.city
		for c in city.get("coast", []):
			coast.add(float(c[0]), float(c[1]), float(c[2]), float(c[3]))
		coast.default_value = -R if sea_room else R
		coast.finish()
		for p in city.get("piers", []):
			piers.append_array([float(p[0]), float(p[1]), float(p[2]), float(p[3])])
		# playas: zonas de arena que tocan la costa, orientadas con el interior a la izquierda
		for poly in city.get("sand", []):
			if poly.size() < 3 or not _touches_coast(poly):
				continue
			var a2 := 0.0
			for i in poly.size():
				var q: Array = poly[(i + 1) % poly.size()]
				a2 += float(poly[i][0]) * float(q[1]) - float(q[0]) * float(poly[i][1])
			var n: int = poly.size()
			for i in n:
				var p0: Array = poly[i]
				var p1: Array = poly[(i + 1) % n]
				var a := Vector2(float(p0[0]), float(p0[1]))
				var b := Vector2(float(p1[0]), float(p1[1]))
				if a2 > 0.0:
					var tmp := a
					a = b
					b = tmp
				sand.add(a.x, a.y, b.x, b.y)
				# orilla: los lados de la playa que dan al mar (hacia fuera del polígono)
				var e := b - a
				if e.length() > 0.001:
					var o := (a + b) * 0.5 + Vector2(-e.y, e.x).normalized() * 1.0
					if coast.value(o.x, o.y) < 0.0:
						shore.add(a.x, a.y, b.x, b.y)
		sand.default_value = -R
		sand.finish()
		shore.finish()

	func _touches_coast(poly: Array) -> bool:
		if coast.is_empty():
			return false
		for p in poly:
			if absf(coast.value(float(p[0]), float(p[1]))) < BEACH_NEAR:
				return true
		return false

	func pier_value(px: float, py: float) -> float:
		var best := R
		for k in range(0, piers.size(), 4):
			var x0 := piers[k]
			var y0 := piers[k + 1]
			var vx := piers[k + 2] - x0
			var vy := piers[k + 3] - y0
			var l2 := vx * vx + vy * vy
			var t := clampf(((px - x0) * vx + (py - y0) * vy) / l2, 0.0, 1.0) if l2 > 0.0 else 0.0
			best = minf(best, Vector2(px - (x0 + t * vx), py - (y0 + t * vy)).length())
		return PIER_HALF - best

	func field(px: float, py: float) -> Vector3:
		var dv := coast.value(px, py)
		var sv := sand.value(px, py)
		var land := dv
		if not piers.is_empty():
			land = maxf(land, pier_value(px, py))
		# distancia a la orilla: dentro de la arena, positiva (sube hacia el paseo); fuera,
		# negativa (el fondo baja mar adentro)
		var e := dv
		if not shore.is_empty():
			e = absf(shore.value(px, py)) * (1.0 if sv > 0.0 else -1.0)
		return Vector3(minf(land, -sv), e, sv)

	func _i(x: int, y: int) -> int:
		return y * (W + 1) + x

	func _L(gx: float, gy: float, y: float) -> Vector3:
		return Vector3((gx - ogx) * T, y, (gy - ogz) * T)

	func build(ground: GeoBatch, walls: GeoBatch, beach: GeoBatch) -> void:
		var n := (W + 1) * (H + 1)
		g.resize(n)
		d.resize(n)
		s.resize(n)
		var all_land := true
		var all_sea := true
		for y in H + 1:
			for x in W + 1:
				var f := field(gx0 + x, gy0 + y)
				var i := _i(x, y)
				g[i] = f.x
				d[i] = f.y
				s[i] = f.z
				all_land = all_land and f.x > 0.0
				all_sea = all_sea and f.x <= 0.0
				if f.x <= 0.0:
					Coast.corners[Vector2i(gx0 + x, gy0 + y)] = Vector2(f.x, Coast.beach_height(f.y))
		has_water = not all_land
		var mat := Coast.sidewalk()
		_grass(ground)
		if all_land:
			ground.quad(mat, _L(gx0 + W * 0.5, gy0 + H * 0.5, Y), W * T, H * T, 0.0)
			return
		for y in H + 1:
			for x in W + 1:
				var i := _i(x, y)
				if g[i] > 0.0:
					Coast.corners[Vector2i(gx0 + x, gy0 + y)] = Vector2(g[i], Y)
		var contour: Array = [] # [a, b] en tiles globales (Vector2)
		for y in H:
			for x in W:
				_cell(x, y, ground, beach, mat, contour)
		_walls(contour, walls)

	## Parques y jardines (casillas de hierba del servidor): contorno suavizado con
	## marching squares sobre la media de las cuatro casillas de cada esquina.
	func _grass(ground: GeoBatch) -> void:
		if tiles.is_empty():
			return
		var gm := HighwaysMesh.grass()
		var gv := PackedFloat32Array()
		gv.resize((W + 1) * (H + 1))
		var any := false
		for y in H + 1:
			for x in W + 1:
				var sum := 0.0
				for dy in [-1, 0]:
					for dx in [-1, 0]:
						var ty := clampi(y + dy, 0, H - 1)
						var tx := clampi(x + dx, 0, W - 1)
						if int(tiles[ty][tx]) == Protocol.TileType.Grass:
							sum += 0.25
				gv[_i(x, y)] = sum - 0.45
				any = any or sum > 0.0
		if not any:
			return
		for y in H:
			for x in W:
				var pos := [Vector2(x, y), Vector2(x + 1, y), Vector2(x + 1, y + 1), Vector2(x, y + 1)]
				var v := [gv[_i(x, y)], gv[_i(x + 1, y)], gv[_i(x + 1, y + 1)], gv[_i(x, y + 1)]]
				var poly: Array = []
				for k in 4:
					var k2 := (k + 1) % 4
					if v[k] > 0.0:
						poly.append(pos[k])
					if (v[k] > 0.0) != (v[k2] > 0.0):
						poly.append(pos[k].lerp(pos[k2], v[k] / (v[k] - v[k2])))
				for k in range(1, poly.size() - 1):
					var p0: Vector3 = _L(gx0 + poly[0].x, gy0 + poly[0].y, Y + 0.003)
					var p1: Vector3 = _L(gx0 + poly[k].x, gy0 + poly[k].y, Y + 0.003)
					var p2: Vector3 = _L(gx0 + poly[k + 1].x, gy0 + poly[k + 1].y, Y + 0.003)
					ground.tri(gm, p0, p1, p2, Vector3.UP, Vector2(p0.x, p0.z) / 1.5, Vector2(p1.x, p1.z) / 1.5, Vector2(p2.x, p2.z) / 1.5)

	## Marching squares de una celda: el trozo de paseo (G > 0) y el tramo de borde.
	func _cell(x: int, y: int, ground: GeoBatch, beach: GeoBatch, mat: Material, contour: Array) -> void:
		var ids := [_i(x, y), _i(x + 1, y), _i(x + 1, y + 1), _i(x, y + 1)]
		var pos := [Vector2(x, y), Vector2(x + 1, y), Vector2(x + 1, y + 1), Vector2(x, y + 1)]
		var v := [g[ids[0]], g[ids[1]], g[ids[2]], g[ids[3]]]
		var inside := 0
		for k in 4:
			if v[k] > 0.0:
				inside += 1
		# playa: la celda se dibuja si hay arena cerca y no queda entera bajo el paseo
		if inside < 4 and (s[ids[0]] > -10.0 or s[ids[1]] > -10.0 or s[ids[2]] > -10.0 or s[ids[3]] > -10.0):
			var p := []
			for k in 4:
				p.append(_L(gx0 + pos[k].x, gy0 + pos[k].y, Coast.beach_height(d[ids[k]])))
			var nn: Vector3 = (p[1] - p[0]).cross(p[3] - p[0]).normalized()
			if nn.y < 0.0:
				nn = -nn
			beach.tri(Coast.sand(), p[0], p[1], p[2], nn, Vector2.ZERO, Vector2.ZERO, Vector2.ZERO)
			beach.tri(Coast.sand(), p[0], p[2], p[3], nn, Vector2.ZERO, Vector2.ZERO, Vector2.ZERO)
		if inside == 0:
			return
		if inside == 4:
			ground.quad(mat, _L(gx0 + x + 0.5, gy0 + y + 0.5, Y), T, T, 0.0)
			return
		var poly: Array = []
		var cuts: Array = []
		for k in 4:
			var k2 := (k + 1) % 4
			if v[k] > 0.0:
				poly.append(pos[k])
			if (v[k] > 0.0) != (v[k2] > 0.0):
				var t: float = v[k] / (v[k] - v[k2])
				var q: Vector2 = pos[k].lerp(pos[k2], t)
				poly.append(q)
				cuts.append(q)
		for k in range(1, poly.size() - 1):
			ground.tri(mat, _L(gx0 + poly[0].x, gy0 + poly[0].y, Y), _L(gx0 + poly[k].x, gy0 + poly[k].y, Y), _L(gx0 + poly[k + 1].x, gy0 + poly[k + 1].y, Y), Vector3.UP, Vector2.ZERO, Vector2.ZERO, Vector2.ZERO)
		for k in range(0, cuts.size() - 1, 2):
			contour.append([Vector2(gx0, gy0) + cuts[k], Vector2(gx0, gy0) + cuts[k + 1]])

	## Gradiente del campo (diferencias centradas en las esquinas, interpolado): continuo.
	func grad(p: Vector2) -> Vector2:
		var lx := clampf(p.x - gx0, 0.0, W - 0.001)
		var ly := clampf(p.y - gy0, 0.0, H - 0.001)
		var ix := int(lx)
		var iy := int(ly)
		var fx := lx - ix
		var fy := ly - iy
		var c00 := _cgrad(ix, iy)
		var c10 := _cgrad(ix + 1, iy)
		var c01 := _cgrad(ix, iy + 1)
		var c11 := _cgrad(ix + 1, iy + 1)
		return c00.lerp(c10, fx).lerp(c01.lerp(c11, fx), fy)

	func _cgrad(x: int, y: int) -> Vector2:
		var xa := maxi(0, x - 1)
		var xb := mini(W, x + 1)
		var ya := maxi(0, y - 1)
		var yb := mini(H, y + 1)
		return Vector2((g[_i(xb, y)] - g[_i(xa, y)]) / float(xb - xa), (g[_i(x, yb)] - g[_i(x, ya)]) / float(yb - ya))

	## Muro a lo largo del borde del paseo: coraza hacia el mar, muro bajo hacia la arena.
	func _walls(contour: Array, b: GeoBatch) -> void:
		var st := Coast.stone()
		var cp := Coast.coping()
		var white := StreetFurniture.lambert(Color("e9e9e4"))
		var box := StreetFurniture.prim("box")
		var rng := RandomNumberGenerator.new()
		for seg in contour:
			var a: Vector2 = seg[0]
			var e: Vector2 = seg[1]
			var len := a.distance_to(e)
			if len < 0.01:
				continue
			var mid := (a + e) * 0.5
			var na := -grad(a).normalized()
			var ne := -grad(e).normalized()
			var nm := (na + ne).normalized()
			var probe := field(mid.x + nm.x * 1.5, mid.y + nm.y * 1.5)
			var to_beach := probe.z > -1.5
			var bottom: float = Coast.beach_height(probe.y) - 0.08 if to_beach else SEA_FLOOR
			var drop := Y - bottom
			var batter := 0.0 if to_beach else 0.22 # talud de la coraza (horizontal por vertical)
			var ta := _L(a.x, a.y, Y)
			var te := _L(e.x, e.y, Y)
			var ba := _L(a.x + na.x * drop * batter / T, a.y + na.y * drop * batter / T, bottom)
			var be := _L(e.x + ne.x * drop * batter / T, e.y + ne.y * drop * batter / T, bottom)
			var face_n := Vector3(nm.x, batter, nm.y).normalized()
			b.tri(st, ta, te, be, face_n, Vector2.ZERO, Vector2.ZERO, Vector2.ZERO)
			b.tri(st, ta, be, ba, face_n, Vector2.ZERO, Vector2.ZERO, Vector2.ZERO)
			# albardilla: losa que vuela un poco sobre el muro
			var dir := (e - a) / len
			var ang := atan2(dir.y, dir.x)
			var c3 := _L(mid.x + nm.x * 0.12, mid.y + nm.y * 0.12, Y + 0.035)
			b.mesh(box, Transform3D(Basis(Vector3.UP, -ang).scaled(Vector3(len * T + 0.02, 0.07, 0.34 * T)), c3), cp)
			# barandilla (no en los muelles del puerto)
			if not piers.is_empty() and pier_value(mid.x, mid.y) > -1.0:
				continue
			var rail_c := _L(mid.x + nm.x * 0.12, mid.y + nm.y * 0.12, 0.0)
			for hy in [RAIL_H, RAIL_H * 0.5]:
				b.mesh(box, Transform3D(Basis(Vector3.UP, -ang).scaled(Vector3(len * T + 0.01, 0.022, 0.022)), rail_c + Vector3(0, Y + 0.07 + hy, 0)), white)
			# postes y farolas donde el tramo cruza múltiplos fijos (en tiles globales) de su
			# eje dominante: el mismo reparto en todas las salas y clientes
			var ax := 0 if absf(dir.x) >= absf(dir.y) else 1
			var u0 := a.x if ax == 0 else a.y
			var u1 := e.x if ax == 0 else e.y
			for step: float in [1.2, LAMP_EVERY]:
				var k0 := ceilf(minf(u0, u1) / step)
				var k1 := floorf(maxf(u0, u1) / step)
				var k := k0
				while k <= k1:
					var t := (k * step - u0) / (u1 - u0) if absf(u1 - u0) > 0.0001 else 0.5
					var p := a.lerp(e, clampf(t, 0.0, 1.0))
					if step < 2.0:
						b.mesh(box, Transform3D(Basis().scaled(Vector3(0.028, RAIL_H, 0.028)), _L(p.x + nm.x * 0.12, p.y + nm.y * 0.12, Y + 0.07 + RAIL_H * 0.5)), white)
					else:
						Coast._lamp(b, _L(p.x - nm.x * 0.6, p.y - nm.y * 0.6, Y))
					k += 1.0
			# escollera al pie de la coraza
			if not to_beach:
				rng.seed = hash(Vector2i(floori(mid.x * 2.0), floori(mid.y * 2.0)))
				var nb := int(len * 1.6)
				for k in nb:
					var p := a.lerp(e, rng.randf())
					var out := drop * batter / T + rng.randf_range(0.3, 2.4)
					var sz := rng.randf_range(0.18, 0.42)
					var q := _L(p.x + nm.x * out, p.y + nm.y * out, SEA_Y + rng.randf_range(-0.35, 0.05))
					var basis := Basis.from_euler(Vector3(rng.randf() * TAU, rng.randf() * TAU, rng.randf() * TAU)).scaled(Vector3(sz, sz * rng.randf_range(0.6, 0.9), sz * rng.randf_range(0.7, 1.0)))
					b.mesh(StreetFurniture.prim("sphere"), Transform3D(basis, q), Coast.rock())


static func _hash(x: float, y: float) -> float:
	var h := sin(x * 127.1 + y * 311.7) * 43758.5453
	return h - floorf(h)


## Farola del paseo: fuste de fundición, brazo corto y farol.
static func _lamp(b: GeoBatch, p: Vector3) -> void:
	var dark := StreetFurniture.lambert(Color("2b2f33"))
	var g := Transform3D(Basis(), p)
	StreetFurniture.part(b, g, "cyl", dark, Vector3(0.05, 0.08, 0.05), Vector3.ZERO)
	StreetFurniture.part(b, g, "cyl", dark, Vector3(0.022, 1.25, 0.022), Vector3(0, 0.08, 0))
	StreetFurniture.part(b, g, "cone", dark, Vector3(0.07, 0.06, 0.07), Vector3(0, 1.33, 0))
	var glow := StreetFurniture.lambert(Color("fff1c9"))
	StreetFurniture.part(b, g, "box", glow, Vector3(0.07, 0.1, 0.07), Vector3(0, 1.28, 0))
	StreetFurniture.part(b, g, "cone", dark, Vector3(0.06, 0.05, 0.06), Vector3(0, 1.39, 0), Vector3(PI, 0, 0))
