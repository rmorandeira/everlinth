class_name City
## Ciudad vectorial (bioma "city"), puerto de client/src/render3d/city3d.ts: el
## servidor genera calles y edificios con MapGenerator y manda la geometría de cada
## sala (CityData). Aquí se dibuja sin pasar por la rejilla de tiles:
## - Calzadas: cintas (bordillo + asfalto con tono por calle), parches, registros,
##   rodaduras, zanjas y grietas selladas.
## - Marcas: discontinuas por longitud de arco (casan entre salas), doble amarilla en
##   avenidas, flechas en sentido único, pasos de cebra, STOP, frenadas y aceite.
## - Mobiliario: farolas cobra, árboles, bancos, contenedores, coches y camiones,
##   charcos y semáforos de mástil con fases.
## - Edificios: modelos de Kenney ajustados a la parcela, mirando a la calle.
## Todo en coordenadas GLOBALES de tile; lo repetido entre salas se deduplica por id.
## Lo que se repite (edificios, farolas, árboles, coches) va en MultiMesh por sala:
## una llamada de dibujo por modelo y sala, con descarte por cámara de cada sala.

const T := Protocol.TILE_SIZE
const W := Protocol.SCREEN_WIDTH
const H := Protocol.SCREEN_HEIGHT
const ROAD_HALF: Array = Protocol.CITY_ROAD_HALF

const ASPHALT_TONES := [Color("8f9195"), Color("b3b5b8"), Color("d4d3cf")]
const CURB := Color("8a867d")
const PAINT_WHITE := Color("e8e6de")
const PAINT_YELLOW := Color("e0b81a")
const CAR_COLORS := [Color("2f6d9a"), Color("c0392b"), Color("e9e8e3"), Color("111216"), Color("b2b5b8"), Color("f5c518"), Color("3a8a4f"), Color("571f1f")]
const CROWNS := [0x4f8a3a, 0x6aa04a, 0x3f7a4a, 0x86a94a]

# Alturas de las capas de la calle (el suelo de tiles está en y=0.05).
const Y_CURB := 0.056
const Y_ASPHALT := 0.062
const Y_DECAL := 0.065
const Y_PAINT := 0.068
const CURB_W := 0.22
const ASPHALT_UV := 4.0
const PAINT_UV := 1.6

static var _mat_cache := {}
static var _tex_cache := {}
static var _car_mesh: ArrayMesh


# ------------------------------------------------------------------ utilidades

static func hash2(x: float, y: float) -> float:
	var h := sin(x * 127.1 + y * 311.7) * 43758.5453
	return h - floorf(h)


## Hash de texto con aritmética de enteros de 32 bits (como `(h * 31 + c) | 0` en JS).
static func _hash_int(s: String) -> int:
	var h := 0
	for i in s.length():
		h = (h * 31 + s.unicode_at(i)) & 0xFFFFFFFF
		if h >= 0x80000000:
			h -= 0x100000000
	return h


static func hash_str(s: String) -> float:
	var h := _hash_int(s)
	return hash2(float(h % 9973), float((h >> 8) % 7919))


## Math.round de JS (medios hacia +infinito).
static func jround(x: float) -> float:
	return floorf(x + 0.5)


static func _tex(name: String) -> Texture2D:
	if not _tex_cache.has(name):
		_tex_cache[name] = load("res://assets/textures/road/%s.png" % name)
	return _tex_cache[name]


static func _std(key: String, setup: Callable) -> Material:
	if not _mat_cache.has(key):
		var m := StandardMaterial3D.new()
		m.roughness = 0.95
		m.texture_filter = BaseMaterial3D.TEXTURE_FILTER_LINEAR_WITH_MIPMAPS_ANISOTROPIC
		setup.call(m)
		_mat_cache[key] = m
	return _mat_cache[key]


static func asphalt_mat(tone: Color) -> Material:
	return _std("asphalt" + tone.to_html(), func(m: StandardMaterial3D) -> void:
		m.albedo_texture = _tex("asphalt")
		m.albedo_color = tone)


static func paint_mat(c: Color) -> Material:
	return _std("paint" + c.to_html(), func(m: StandardMaterial3D) -> void:
		m.albedo_texture = _tex("worn-paint")
		m.albedo_color = c
		m.transparency = BaseMaterial3D.TRANSPARENCY_ALPHA
		m.render_priority = 2)


static func decal_mat(name: String, opacity := 1.0, priority := 1) -> Material:
	return _std("decal" + name + str(opacity), func(m: StandardMaterial3D) -> void:
		m.albedo_texture = _tex(name)
		m.albedo_color = Color(1, 1, 1, opacity)
		m.transparency = BaseMaterial3D.TRANSPARENCY_ALPHA
		m.render_priority = priority
		m.texture_repeat = true)


static func lambert(c: Color) -> Material:
	return _std("lambert" + c.to_html(), func(m: StandardMaterial3D) -> void:
		m.albedo_color = c
		m.roughness = 1.0)


static func puddle_mat() -> Material:
	if not _mat_cache.has("puddle"):
		var m := ShaderMaterial.new()
		m.shader = load("res://shaders/puddle.gdshader")
		m.set_shader_parameter("shape", _tex("puddle"))
		m.render_priority = 3
		_mat_cache["puddle"] = m
	return _mat_cache["puddle"]


# ------------------------------------------------------------------ construcción

var origin_gx := 0
var origin_gz := 0
var root := Node3D.new()
var flat := GeoBatch.new()     # a ras de suelo: sin sombra
var solid := GeoBatch.new()    # semáforos y demás piezas sueltas: con sombra
var chunks := {}               # "rx,ry" -> { clave de instancia -> [Transform3D | [Transform3D, Color]] }
var segs: Array = []
var cars: Array = []
var props: Array = [] # [Vector2 (tiles globales), radio] ya colocados: nada se solapa
var bpolys: Array = [] # [PackedVector2Array (tiles), Rect2] de los edificios
var litter := GeoBatch.new() # basura del suelo (sin sombra)
var hydrants: Array = [] # Vector2 (tiles): no se aparca a menos de 3 tiles
var audit := {"prop": 0, "edificio": 0, "calzada": 0}
var approaches: Array = [] # llegadas a cruces: { x, y, hx, hy, stop_dist, axis ("A"/"B"/"stop") } (tiles globales)
var buildings := {} # id -> info para Destruction (pos, height, pts, refs, parts, xf, hp, max_hp)
var crosses: Array = []


func _L(gx: float) -> float:
	return (gx - origin_gx) * T


func _Lz(gz: float) -> float:
	return (gz - origin_gz) * T


func _p(gx: float, gz: float, y: float) -> Vector3:
	return Vector3(_L(gx), y, _Lz(gz))


## Registra una instancia (modelo o malla compartida) en la sala que la contiene.
func _place(kind: String, xf: Transform3D, color := Color.WHITE, building_id := "") -> void:
	var gx := xf.origin.x / T + origin_gx
	var gz := xf.origin.z / T + origin_gz
	var ck := "%d,%d" % [floori(gx / W), floori(gz / H)]
	if not chunks.has(ck):
		chunks[ck] = {}
	if not chunks[ck].has(kind):
		chunks[ck][kind] = []
	chunks[ck][kind].append([xf, color, building_id])


## Modelo del kit en (x, z) (unidades de render), frente (+Z) hacia (fx, fz).
func _kit_prop(kit: String, name: String, x: float, z: float, fx: float, fz: float, k := 1.0) -> bool:
	var key := kit + "/" + name
	if Kenney.model(key).is_empty():
		return false
	var s: float = Kenney.base_scale(key) * k
	_place("model:" + key, Transform3D(Basis(Vector3.UP, atan2(fx, fz)).scaled(Vector3(s, s, s)), Vector3(x, 0.05, z)))
	return true


func _seg_dist(s: Dictionary, px: float, py: float) -> float:
	var vx: float = s.x1 - s.x0
	var vy: float = s.y1 - s.y0
	var l2 := vx * vx + vy * vy
	var t := clampf(((px - s.x0) * vx + (py - s.y0) * vy) / l2, 0.0, 1.0) if l2 > 0.0 else 0.0
	return Vector2(px - (s.x0 + t * vx), py - (s.y0 + t * vy)).length()


## ¿Hay sitio para un objeto de radio r en (px, py) (tiles)? Ni otro objeto, ni un
## edificio (a menos de margin de su fachada), ni la calzada (si sidewalk).
func _free(px: float, py: float, r: float, margin := 0.4, sidewalk := true) -> bool:
	var p := Vector2(px, py)
	for o in props:
		if p.distance_to(o[0]) < r + o[1]:
			audit.prop += 1
			return false
	for bp in bpolys:
		var box: Rect2 = bp[1]
		if not box.grow(r + margin).has_point(p):
			continue
		if Geometry2D.is_point_in_polygon(p, bp[0]) or _poly_dist(p, bp[0]) < r + margin:
			audit.edificio += 1
			return false
	if sidewalk:
		for sg in segs:
			if _seg_dist(sg, px, py) < ROAD_HALF[sg.kind] + CURB_W + r * 0.5:
				audit.calzada += 1
				return false
	return true


func _claim(px: float, py: float, r: float) -> void:
	props.append([Vector2(px, py), r])


static func _poly_dist(p: Vector2, poly: PackedVector2Array) -> float:
	var best := INF
	for i in poly.size():
		var a := poly[i]
		var b := poly[(i + 1) % poly.size()]
		best = minf(best, p.distance_to(Geometry2D.get_closest_point_to_segment(p, a, b)))
	return best


func _near_cross(px: float, py: float, extra: float) -> bool:
	for c in crosses:
		if Vector2(px - c.x, py - c.y).length() < c.max_half + extra:
			return true
	return false


static func _line_key(sg: Dictionary) -> String:
	var id: String = sg.id
	return id.substr(0, id.rfind(":"))


func _tone_of(sg: Dictionary) -> Color:
	return ASPHALT_TONES[int(floorf(hash_str(_line_key(sg) + "t") * ASPHALT_TONES.size())) % ASPHALT_TONES.size()]


## Sentido de cada segmento para el tráfico: { one_way, dir } por id.
func _segs_info() -> Dictionary:
	var out := {}
	for s in segs:
		out[s.id] = _line_info(s)
	return out


func _line_info(sg: Dictionary) -> Dictionary:
	var key := _line_key(sg)
	return {"one_way": int(sg.kind) == 0 and hash_str(key) < 0.5, "dir": 1 if hash_str(key + "d") < 0.5 else -1}


## Calcomanía / pintura en coordenadas de tile: len a lo largo de ang, w a través.
func _mark(mat: Material, gx: float, gy: float, length: float, w: float, ang: float, y := Y_PAINT) -> void:
	var is_paint := mat == paint_mat(PAINT_WHITE) or mat == paint_mat(PAINT_YELLOW)
	flat.quad(mat, _p(gx, gy, y), length * T, w * T, ang, PAINT_UV if is_paint else 0.0)


## datas: CityData de la sala actual y sus vecinas. origin: tile global del origen de
## la escena (esquina de la sala actual).
static func build(datas: Array, ogx: int, ogz: int) -> Node3D:
	var c := City.new()
	c.origin_gx = ogx
	c.origin_gz = ogz
	c._build(datas)
	c.root.set_meta("cars", c.cars)
	c.root.set_meta("segs", c.segs)
	c.root.set_meta("approaches", c.approaches)
	c.root.set_meta("info", c._segs_info())
	c.root.set_meta("buildings", c.buildings)
	return c.root


func _build(datas: Array) -> void:
	var roads := {}
	var nodes := {}
	var building_defs := {}
	for d in datas:
		for r in d.roads:
			roads[r.id] = r
		for n in d.nodes:
			nodes["%d,%d" % [jround(n[0] * 4.0), jround(n[1] * 4.0)]] = n
		for b in d.buildings:
			building_defs[b.id] = b
	if roads.is_empty() and building_defs.is_empty():
		return
	segs = roads.values()
	for s in segs:
		s.kind = int(s.kind)

	# Cruces: calles que pasan por cada nodo y el semiancho mayor.
	for n in nodes.values():
		var c := {"x": float(n[0]), "y": float(n[1]), "through": [], "max_half": 0.0}
		for s in segs:
			if _seg_dist(s, c.x, c.y) > ROAD_HALF[s.kind] * 0.5 + 0.3:
				continue
			var l := Vector2(s.x1 - s.x0, s.y1 - s.y0).length()
			if l == 0.0:
				l = 1.0
			c.through.append({"seg": s, "ux": (s.x1 - s.x0) / l, "uy": (s.y1 - s.y0) / l})
			c.max_half = maxf(c.max_half, ROAD_HALF[s.kind])
		crosses.append(c)

	for bd in building_defs.values():
		if bd.has("hp") and float(bd.hp) <= 0.0:
			continue
		var poly := PackedVector2Array()
		var box := Rect2()
		for i in bd.pts.size():
			var p := Vector2(bd.pts[i][0], bd.pts[i][1])
			poly.append(p)
			box = Rect2(p, Vector2.ZERO) if i == 0 else box.expand(p)
		bpolys.append([poly, box])
	_roadway()
	_crossings()
	_corners()
	_markings_and_furniture()
	for bd in building_defs.values():
		if not _kit_building(bd):
			_polygon_building(bd)
	flat.build(root, false)
	litter.build(root, false)
	solid.build(root, true)
	HighwaysMesh.build(root, datas, origin_gx, origin_gz, paint_mat(PAINT_WHITE), paint_mat(PAINT_YELLOW))
	var hws := {}
	for d in datas:
		for h in d.get("highways", []):
			hws[h.id] = h
	root.set_meta("highways", hws.values())
	if Config.bench:
		print("reglas: descartados por solape=%d edificio=%d calzada=%d" % [audit.prop, audit.edificio, audit.calzada])
	_instantiate_chunks()


# ------------------------------------------------------------------ calzada

func _roadway() -> void:
	var curb := lambert(CURB)
	var joint_count := {}
	for sg in segs:
		for e in [[sg.x0, sg.y0], [sg.x1, sg.y1]]:
			var k := "%s@%.2f,%.2f" % [_line_key(sg), e[0], e[1]]
			joint_count[k] = joint_count.get(k, 0) + 1
	var tire := decal_mat("tire-track", 0.7)
	var seal := decal_mat("crack-seal", 0.8)
	for s in segs:
		var half: float = ROAD_HALF[s.kind]
		var dx: float = s.x1 - s.x0
		var dy: float = s.y1 - s.y0
		var length := Vector2(dx, dy).length()
		if length < 0.01:
			continue
		var ang := atan2(dy, dx)
		var mx: float = (s.x0 + s.x1) / 2.0
		var my: float = (s.y0 + s.y1) / 2.0
		var tone := _tone_of(s)
		var amat := asphalt_mat(tone)
		flat.quad(curb, _p(mx, my, Y_CURB), length * T, (half + CURB_W) * 2.0 * T, ang)
		flat.quad(amat, _p(mx, my, Y_ASPHALT), length * T, half * 2.0 * T, ang, ASPHALT_UV)
		var ux0 := dx / length
		var uy0 := dy / length
		var t := 3.0
		while t < length - 3.0:
			var px: float = s.x0 + ux0 * t
			var py: float = s.y0 + uy0 * t
			var hp := hash2(jround(px * 2.3) + 7.0, jround(py * 2.3) - 3.0)
			if hp > 0.8:
				var side := 1.0 if hp > 0.9 else -1.0
				var w := half * (0.6 + fmod(hp, 0.1) * 5.0)
				var off := side * (half - w / 2.0) * 0.9
				var ti := ASPHALT_TONES.find(tone)
				var ptone: Color = ASPHALT_TONES[(ti + 1 + (1 if hp > 0.87 else 0)) % ASPHALT_TONES.size()]
				flat.quad(asphalt_mat(ptone), _p(px - uy0 * off, py + ux0 * off, Y_ASPHALT + 0.001), (1.6 + hp * 3.0) * T, w * T, ang + (hp - 0.85) * 0.1, ASPHALT_UV)
			elif hp < 0.07:
				var off := (1.0 if hp < 0.035 else -1.0) * half * 0.45
				flat.disc(lambert(Color("3f4145")), _p(px - uy0 * off, py + ux0 * off, Y_ASPHALT + 0.003), 0.42 * T)
				flat.disc(lambert(Color("2c2e31")), _p(px - uy0 * off, py + ux0 * off, Y_ASPHALT + 0.004), 0.32 * T)
			t += 9.0
		for e in [[s.x0, s.y0], [s.x1, s.y1]]:
			if joint_count.get("%s@%.2f,%.2f" % [_line_key(s), e[0], e[1]], 0) < 2:
				continue
			flat.disc(curb, _p(e[0], e[1], Y_CURB), (half + CURB_W) * T)
			flat.disc(amat, _p(e[0], e[1], Y_ASPHALT), half * T, ASPHALT_UV)
		# Rodaduras: dos bandas por carril.
		var nx0 := -uy0
		var ny0 := ux0
		var one_way_s: bool = s.kind == 0 and hash_str(_line_key(s)) < 0.5
		var lanes: Array = [0.0] if one_way_s else ([-half * 0.75, -half * 0.25, half * 0.25, half * 0.75] if s.kind == 2 else [-half * 0.5, half * 0.5])
		for lc in lanes:
			for w in [-0.42, 0.42]:
				var off: float = lc + w
				flat.quad(tire, _p(mx + nx0 * off, my + ny0 * off, Y_DECAL - 0.001), length * T, 0.3 * T, ang, 0.0, length * T / 1.5)
		# Zanjas reparadas y grietas selladas.
		t = 6.0
		while t < length - 4.0:
			var px: float = s.x0 + ux0 * t
			var py: float = s.y0 + uy0 * t
			var hz := hash2(jround(px * 1.7) - 11.0, jround(py * 1.7) + 4.0)
			if hz > 0.9:
				var ztone: Color = ASPHALT_TONES[(ASPHALT_TONES.find(tone) + 2) % ASPHALT_TONES.size()]
				flat.quad(asphalt_mat(ztone), _p(px, py, Y_ASPHALT + 0.0015), (0.9 + hz * 0.6) * T, half * 2.0 * T * 0.98, ang + PI / 2.0 + (hz - 0.95) * 0.3, ASPHALT_UV)
			elif hz < 0.22:
				flat.quad(seal, _p(px + nx0 * (hz - 0.11) * half * 6.0, py + ny0 * (hz - 0.11) * half * 6.0, Y_DECAL), 2.2 * T, 2.2 * T, ang + hz * 20.0)
			t += 13.0


# ------------------------------------------------------------------ marcas y mobiliario

func _markings_and_furniture() -> void:
	var white := paint_mat(PAINT_WHITE)
	var yellow := paint_mat(PAINT_YELLOW)
	var oil := decal_mat("oil", 0.85)
	var arrow_s := decal_mat("arrow-straight")
	for s in segs:
		var half: float = ROAD_HALF[s.kind]
		var dx: float = s.x1 - s.x0
		var dy: float = s.y1 - s.y0
		var length := Vector2(dx, dy).length()
		if length < 0.5:
			continue
		var ux := dx / length
		var uy := dy / length
		var nx := -uy
		var ny := ux
		var ang := atan2(dy, dx)
		var info := _line_info(s)
		var one_way: bool = info.one_way
		var dir: int = info.dir

		# Marcas por longitud de arco (s0 viene del servidor).
		var pieces := func(period: float, dash: float, fn: Callable) -> void:
			var a: float = s.s0
			var b_end: float = s.s0 + length
			var k := floori(a / period)
			while k * period < b_end:
				var d0 := maxf(a, k * period)
				var d1 := minf(b_end, k * period + dash)
				k += 1
				if d1 - d0 < 0.15:
					continue
				var tm := (d0 + d1) / 2.0 - a
				fn.call(s.x0 + ux * tm, s.y0 + uy * tm, d1 - d0)
		if not one_way:
			if s.kind == 2:
				pieces.call(2.0, 2.0, func(px: float, py: float, l: float) -> void:
					if _near_cross(px, py, 0.6):
						return
					for side in [-1.0, 1.0]:
						_mark(yellow, px + nx * side * 0.15, py + ny * side * 0.15, l + 0.02, 0.12, ang))
			else:
				pieces.call(6.0, 2.0, func(px: float, py: float, l: float) -> void:
					if not _near_cross(px, py, 0.8):
						_mark(yellow, px, py, l, 0.13, ang))
		if s.kind == 2:
			pieces.call(6.0, 2.0, func(px: float, py: float, l: float) -> void:
				if _near_cross(px, py, 9.0):
					return
				for side in [-1.0, 1.0]:
					_mark(white, px + nx * side * half * 0.5, py + ny * side * half * 0.5, l, 0.11, ang))
		if one_way:
			var t := 7.0
			while t < length - 3.0:
				var px: float = s.x0 + ux * t
				var py: float = s.y0 + uy * t
				t += 14.0
				if _near_cross(px, py, 5.0):
					continue
				var heading := ang if dir > 0 else ang + PI
				_mark(arrow_s, px, py, 0.8, 2.2, heading + PI / 2.0)

		# Mobiliario, aparcamiento y basura a lo largo de la manzana (docs/reglas-calle.md):
		# cada objeto reserva su sitio (_free/_claim): nada se solapa, nada invade un
		# edificio ni la calzada.
		var rng := RandomNumberGenerator.new()
		rng.seed = _hash_int(str(s.id))
		var t := 1.5
		while t < length - 1.0:
			var px: float = s.x0 + ux * t
			var py: float = s.y0 + uy * t
			var k := int(jround((float(s.s0) + t) / 3.0))
			t += 3.0
			var h := hash2(jround(px * 3.0), jround(py * 3.0))
			_scatter_litter(px, py, ux, uy, nx, ny, half, rng)
			if _near_cross(px, py, 1.0):
				continue
			var side := 1.0 if (k / 2) % 2 == 0 else -1.0
			var fx := px + nx * side * (half + 0.8)
			var fy := py + ny * side * (half + 0.8)
			if k % 6 == 0 and not _near_cross(px, py, 4.0):
				# farola cada ~27 m, alternando lados, fuera de los cruces
				if _free(fx, fy, 0.3, 0.3):
					_place("streetlight", StreetFurniture.streetlight_xform(_L(fx), _Lz(fy), -nx * side, -ny * side))
					_claim(fx, fy, 1.2)
			elif k % 3 == 1 and h > 0.3 and not _near_cross(px, py, 6.0):
				# árbol en alcorque, lejos de los cruces y de farolas / hidrantes
				if _free(fx, fy, 0.5, 0.4):
					var crown: int = CROWNS[int(floorf(h * 97.0)) % CROWNS.size()]
					_kit_prop("suburban", "tree-large" if crown % 2 == 0 else "tree-small", _L(fx), _Lz(fy), 0.0, 1.0, 0.9 + (crown % 7) * 0.05)
					_claim(fx, fy, 0.8)
			elif h < 0.07 and not _near_cross(px, py, 5.0):
				var bx := px + nx * side * (half + 1.3)
				var by := py + ny * side * (half + 1.3)
				if _free(bx, by, 0.35, 0.3):
					_kit_prop("retro", "detail-bench", _L(bx), _Lz(by), -nx * side, -ny * side, 0.5)
					_claim(bx, by, 0.5)
			elif h < 0.11 and not _near_cross(px, py, 5.0):
				var ddx := px + nx * side * (half + 1.4)
				var ddy := py + ny * side * (half + 1.4)
				if _free(ddx, ddy, 0.55, 0.15):
					_kit_prop("retro", "detail-dumpster-closed" if h < 0.09 else "detail-dumpster-open", _L(ddx), _Lz(ddy), ux, uy, 0.55)
					_claim(ddx, ddy, 0.7)
			elif h < 0.21 and not _near_cross(px, py, 4.0):
				# bolsas de basura apiladas junto al bordillo (Nueva York)
				var tx := px + nx * side * (half + 0.6)
				var ty := py + ny * side * (half + 0.6)
				if _free(tx, ty, 0.35, 0.3):
					StreetFurniture.trash_bags(solid, _L(tx), _Lz(ty), rng)
					_claim(tx, ty, 0.45)
			elif h > 0.92 and not _near_cross(px, py, 4.0):
				# bicicleta aparcada junto al bordillo, paralela a la calle
				var cx2 := px + nx * side * (half + 0.75)
				var cy2 := py + ny * side * (half + 0.75)
				if _free(cx2, cy2, 0.35, 0.3):
					var bs := Kenney.base_scale("transport/bicycle")
					if not Kenney.model("transport/bicycle").is_empty():
						_place("model:transport/bicycle", Transform3D(Basis(Vector3.UP, atan2(ux, uy)).scaled(Vector3(bs, bs, bs)), Vector3(_L(cx2), 0.05, _Lz(cy2))))
						_claim(cx2, cy2, 0.45)
			# Aparcamiento (reparto real de la calzada): calle pequeña de sentido único →
			# junto al bordillo de un solo lado (+n); calle principal → en ambos lados;
			# calle pequeña de doble sentido y avenidas → no. Nunca a menos de 4 tiles de
			# un cruce ni de 3 de un hidrante.
			var hc := hash2(jround(px * 5.0) + 1.0, jround(py * 5.0))
			var coff := 0.0
			if s.kind == 0 and one_way:
				coff = half - 0.65
			elif s.kind == 1:
				coff = (half - 0.55) * (-side)
			if coff != 0.0 and not _near_cross(px, py, 4.0):
				var cx := px + nx * coff
				var cy := py + ny * coff
				var near_hydrant := false
				for hy in hydrants:
					if Vector2(cx, cy).distance_to(hy) < 3.0:
						near_hydrant = true
				var car_color: Color = CAR_COLORS[int(floorf(h * 131.0)) % CAR_COLORS.size()]
				if near_hydrant:
					pass
				elif hc > 0.95 and _free(cx, cy, 0.9, 0.0, false):
					var truck: String = ["truck-grey", "truck-green", "truck-flat"][int(floorf(h * 3.0)) % 3]
					if not _kit_prop("retro", truck, _L(cx), _Lz(cy), ux, uy, 0.62):
						_add_car(_L(cx), _Lz(cy), ang, car_color)
					_claim(cx, cy, 1.3)
				elif hc > 0.55 and _free(cx, cy, 0.7, 0.0, false):
					_add_car(_L(cx), _Lz(cy), ang, car_color)
					_claim(cx, cy, 0.8)
				elif hc < 0.14:
					_mark(oil, cx, cy, 1.4, 1.0, ang + h * 2.0, Y_DECAL)
			var ho := hash2(jround(px * 7.0) + 3.0, jround(py * 7.0) + 1.0)
			if ho > 0.9:
				var lane := 0.0 if one_way else (1.0 if ho > 0.95 else -1.0) * half * 0.5
				_mark(oil, px + nx * lane, py + ny * lane, 1.1, 0.8, ang + ho * 5.0, Y_DECAL)
			var hw := hash2(jround(px * 4.0) - 5.0, jround(py * 4.0) + 9.0)
			if hw < 0.16:
				var side_p := 1.0 if hw < 0.08 else -1.0
				_mark(puddle_mat(), px + nx * side_p * (half - 0.4), py + ny * side_p * (half - 0.4), 1.6 + hw * 14.0, 0.8 + hw * 3.0, ang + (hw - 0.08) * 0.5, Y_DECAL + 0.002)
			elif hw > 0.95:
				_mark(puddle_mat(), px + nx * half * 0.4, py + ny * half * 0.4, 1.3, 1.0, ang + hw * 9.0, Y_DECAL + 0.002)
			elif hw > 0.88:
				# charco en la acera: por encima del suelo (0,05) y del bordillo (0,056)
				var side_p := 1.0 if hw > 0.915 else -1.0
				_mark(puddle_mat(), px + nx * side_p * (half + 1.0), py + ny * side_p * (half + 1.0), 1.4, 0.9, ang + hw * 4.0, 0.059)


## Coche aparcado (los dibuja y destruye Cars; clave = posición global).
func _add_car(x: float, z: float, ang: float, color: Color) -> void:
	cars.append({"key": "%.1f,%.1f" % [x / T + origin_gx, z / T + origin_gz], "x": x, "z": z, "ang": ang, "color": color})


## Coche aparcado provisional (la fase 4 trae los destructibles): la carrocería toma
## el color de cada instancia; cristales y bajos son fijos.
static func car_mesh() -> ArrayMesh:
	if _car_mesh:
		return _car_mesh
	var body := StandardMaterial3D.new()
	body.vertex_color_use_as_albedo = true
	body.roughness = 0.5
	var b := GeoBatch.new()
	var box := StreetFurniture.prim("box")
	var add := func(mat: Material, w: float, h: float, d: float, px: float, py: float) -> void:
		b.mesh(box, Transform3D(Basis.from_scale(Vector3(w, h, d)), Vector3(px, py + h * 0.5, 0)), mat)
	add.call(body, 1.5, 0.3, 0.62, 0.0, 0.06)
	add.call(body, 0.8, 0.26, 0.56, -0.05, 0.36)
	add.call(lambert(Color("26323f")), 0.82, 0.16, 0.58, -0.05, 0.4)
	add.call(lambert(Color("1a1a1a")), 1.52, 0.09, 0.64, 0.0, 0.04)
	_car_mesh = b.to_mesh()
	return _car_mesh


# ------------------------------------------------------------------ cruces

func _crossings() -> void:
	var white := paint_mat(PAINT_WHITE)
	var yellow := paint_mat(PAINT_YELLOW)
	var oil := decal_mat("oil", 0.85)
	var skid := decal_mat("skid", 0.8)
	var stop := decal_mat("stop")
	var arrow_s := decal_mat("arrow-straight")
	var arrow_l := decal_mat("arrow-left")
	var worn := decal_mat("worn-zone", 0.35, 0)
	for c in crosses:
		if c.through.size() < 2:
			continue
		var ckey := "%.1f,%.1f" % [c.x, c.y]
		var all_minor := true
		for o in c.through:
			if o.seg.kind != 0:
				all_minor = false
		var all_way_stop := all_minor and hash_str(ckey) < 0.45
		for th in c.through:
			var half: float = ROAD_HALF[th.seg.kind]
			var other := 0.0
			var higher := false
			for o in c.through:
				if absf(o.ux * th.ux + o.uy * th.uy) >= 0.9:
					continue
				other = maxf(other, ROAD_HALF[o.seg.kind])
				if o.seg.kind > th.seg.kind:
					higher = true
			if other == 0.0:
				continue
			var nx: float = -th.uy
			var ny: float = th.ux
			var ang := atan2(th.uy, th.ux)
			var info := _line_info(th.seg)
			var one_way: bool = info.one_way
			var dir: int = info.dir
			for sgn in [-1.0, 1.0]:
				var cwx: float = c.x + th.ux * sgn * (other + 1.3)
				var cwy: float = c.y + th.uy * sgn * (other + 1.3)
				if _seg_dist(th.seg, cwx, cwy) > 0.5:
					continue
				var w := -half + 0.4
				while w <= half - 0.3:
					_mark(white, cwx + nx * w, cwy + ny * w, 1.6, 0.4, ang)
					w += 0.75
				var hx: float = -th.ux * sgn
				var hy: float = -th.uy * sgn
				var rx := -hy
				var ry := hx
				var hang := atan2(hy, hx)
				var approaching: bool = not one_way or dir * sgn < 0
				if not approaching:
					continue
				var lo := -half if one_way else 0.15
				var hi := half
				var mid := (lo + hi) / 2.0
				var band_w := hi - lo
				var at := func(dist: float, off: float) -> Vector2:
					return Vector2(c.x - hx * dist + rx * off, c.y - hy * dist + ry * off)
				var rnd := hash_str(ckey + str(int(sgn)) + str(th.seg.id))
				approaches.append({"x": c.x, "y": c.y, "hx": hx, "hy": hy, "stop_dist": other + 2.35, "axis": "stop" if (higher or all_way_stop) else ("A" if absf(th.ux * c.through[0].ux + th.uy * c.through[0].uy) > 0.7 else "B")})
				if not higher and not all_way_stop:
					var pole_off := half + 0.7
					var lane_centers: Array
					if one_way:
						lane_centers = [-half * 0.5, half * 0.5] if half >= 3.0 else [0.0]
					else:
						lane_centers = [half * 0.25, half * 0.75] if half >= 3.0 else [half * 0.5]
					# lado lejano (MUTCD): esquina de la derecha una vez cruzado
					var q: Vector2 = at.call(-(other + 2.1), pole_off)
					_claim(q.x, q.y, 0.35)
					var axis := "A" if absf(th.ux * c.through[0].ux + th.uy * c.through[0].uy) > 0.7 else "B"
					StreetFurniture.traffic_signal(solid, _L(q.x), _Lz(q.y), hx, hy, lane_centers.map(func(lc: float) -> float: return (pole_off - lc) * T), axis)
				var wz: Vector2 = at.call(other + 4.5, 0.0 if one_way else half * 0.5)
				_mark(worn, wz.x, wz.y, 5.5, half * 1.8 if one_way else half * 1.1, hang, Y_DECAL - 0.0005)
				# línea de detención (con semáforo o STOP), 1 tile antes del paso de peatones
				var D := other + 2.35
				var sp: Vector2 = at.call(D, mid)
				_mark(white, sp.x, sp.y, band_w - 0.1, 0.4, hang + PI / 2.0)
				if higher or all_way_stop:
					# señal de STOP en la esquina derecha, a la altura de la línea
					var ss: Vector2 = at.call(D + 0.2, half + 0.6)
					StreetFurniture.stop_sign(solid, _L(ss.x), _Lz(ss.y), hx, hy)
					_claim(ss.x, ss.y, 0.3)
					var tp: Vector2 = at.call(D + 2.3, mid)
					_mark(stop, tp.x, tp.y, minf(band_w * 0.92, 2.4), 3.4, hang + PI / 2.0)
					if not one_way:
						var lp: Vector2 = at.call(D + 3.5, 0.0)
						_mark(yellow, lp.x, lp.y, 7.0, 0.13, ang)
					if rnd < 0.7:
						var op: Vector2 = at.call(D + 1.9, mid + (rnd - 0.35) * 0.8)
						_mark(oil, op.x, op.y, 1.5, 1.1, hang + rnd * 3.0, Y_DECAL)
				if th.seg.kind == 2:
					var DA := other + 2.0
					for off in [half * 0.5, -half * 0.5]:
						var lp: Vector2 = at.call(DA + 4.5, off)
						_mark(white, lp.x, lp.y, 9.0, 0.12, ang)
					var ip: Vector2 = at.call(DA + 4.0, half * 0.25)
					_mark(arrow_l, ip.x, ip.y, 0.95, 2.4, hang + PI / 2.0)
					var o2: Vector2 = at.call(DA + 4.0, half * 0.75)
					_mark(arrow_s, o2.x, o2.y, 0.95, 2.4, hang + PI / 2.0)
				if rnd > 0.72:
					var L2 := 3.0 + (rnd - 0.72) * 14.0
					var lane := (rnd - 0.86) * half if one_way else half * 0.5
					var kp: Vector2 = at.call(other + 2.2 + L2 / 2.0, lane)
					_mark(skid, kp.x, kp.y, L2, 1.1, hang + (rnd - 0.86) * 0.25, Y_DECAL)


# ------------------------------------------------------------------ esquinas y basura

## Esquinas de los cruces (docs/reglas-calle.md): papelera en cada esquina, hidrante en
## esquinas alternas (pasado el paso de peatones) y farola en una diagonal de los cruces
## con calles principales. Todo en la zona de mobiliario, sin invadir el paso.
func _corners() -> void:
	for c in crosses:
		if c.through.size() < 2:
			continue
		var legs: Array = []
		var major := false
		for th in c.through:
			if th.seg.kind >= 1:
				major = true
			var other := 0.0
			for o in c.through:
				if absf(o.ux * th.ux + o.uy * th.uy) < 0.9:
					other = maxf(other, ROAD_HALF[o.seg.kind])
			for sgn in [-1.0, 1.0]:
				var u: Vector2 = Vector2(th.ux, th.uy) * sgn
				if _seg_dist(th.seg, c.x + u.x * (other + 1.3), c.y + u.y * (other + 1.3)) > 0.5:
					continue
				legs.append([u.angle(), u, float(ROAD_HALF[th.seg.kind])])
		if legs.size() < 2:
			continue
		legs.sort_custom(func(a: Array, b: Array) -> bool: return a[0] < b[0])
		var alt := int(hash_str("%.1f,%.1f" % [c.x, c.y]) * 10.0)
		var center := Vector2(c.x, c.y)
		for i in legs.size():
			var la: Array = legs[i]
			var lb: Array = legs[(i + 1) % legs.size()]
			var da := wrapf(lb[0] - la[0], 0.0, TAU)
			if da < 0.5 or da > 2.7:
				continue # no es una esquina (calles casi alineadas o hueco enorme)
			var ua: Vector2 = la[1]
			var ub: Vector2 = lb[1]
			var ha: float = la[2]
			var hb: float = lb[2]
			var corner := center + ua * (hb + 1.3) + ub * (ha + 1.3)
			if _free(corner.x, corner.y, 0.25, 0.3):
				StreetFurniture.litter_basket(solid, _L(corner.x), _Lz(corner.y))
				_claim(corner.x, corner.y, 0.4)
			if (i + alt) % 2 == 0:
				var hp := center + ua * (hb + 3.6) + ub * (ha + 0.6)
				if _free(hp.x, hp.y, 0.2, 0.3):
					StreetFurniture.hydrant(solid, _L(hp.x), _Lz(hp.y), ua.angle())
					_claim(hp.x, hp.y, 0.6)
					hydrants.append(hp)
			if major and i % 2 == 0:
				var lp := center + ua * (hb + 3.0) + ub * (ha + 0.8)
				if _free(lp.x, lp.y, 0.3, 0.3):
					_place("streetlight", StreetFurniture.streetlight_xform(_L(lp.x), _Lz(lp.y), -ub.x, -ub.y))
					_claim(lp.x, lp.y, 1.0)


# Basura del suelo: celdas del atlas de StreetTextures y su tamaño real (unidades).
const LITTER_SIZE := [0.1, 0.07, 0.14, 0.2, 0.04, 0.04, 0.05, 0.12, 0.1, 0.06, 0.09, 0.08, 0.07, 0.1, 0.06, 0.08]


static func litter_mat() -> Material:
	return _std("litter", func(m: StandardMaterial3D) -> void:
		m.albedo_texture = StreetTextures.litter_atlas()
		m.transparency = BaseMaterial3D.TRANSPARENCY_ALPHA_SCISSOR
		m.alpha_scissor_threshold = 0.5
		m.texture_filter = BaseMaterial3D.TEXTURE_FILTER_LINEAR_WITH_MIPMAPS
		m.roughness = 1.0)


## Papeles, periódicos, latas, colillas, hojas… sobre todo en la cuneta (junto al
## bordillo) y algo por la acera.
func _scatter_litter(px: float, py: float, ux: float, uy: float, nx: float, ny: float, half: float, r: RandomNumberGenerator) -> void:
	var n := r.randi() % 5
	for i in n:
		var side := 1.0 if r.randf() < 0.5 else -1.0
		var gutter := r.randf() < 0.55
		var off := (half - r.randf_range(0.05, 0.4)) if gutter else (half + CURB_W + r.randf_range(0.1, 1.3))
		var along := r.randf_range(-1.5, 1.5)
		var x := px + ux * along + nx * side * off
		var y := py + uy * along + ny * side * off
		var item := r.randi() % 16
		var sz: float = LITTER_SIZE[item] * r.randf_range(0.8, 1.25)
		var cell := Rect2((item % 4) * 0.25, (item / 4) * 0.25, 0.25, 0.25)
		litter.quad_uv(litter_mat(), _p(x, y, 0.066 if gutter else 0.053), sz, sz, r.randf() * TAU, cell)


# ------------------------------------------------------------------ edificios

## Modelo de Kenney ajustado a la parcela: rectángulo orientado según su arista más
## larga, frente hacia la calle más cercana, elegido por plantas entre los que caben,
## escalado para caber y estirado en vertical hacia las plantas pedidas.
func _kit_building(bd: Dictionary) -> bool:
	var pts: Array = bd.pts
	if pts.size() < 3:
		return false
	if bd.has("hp") and float(bd.hp) <= 0.0:
		_add_rubble(bd)
		return true
	var best := 0.0
	var theta := 0.0
	for i in pts.size():
		var q: Array = pts[(i + 1) % pts.size()]
		var l := Vector2(q[0] - pts[i][0], q[1] - pts[i][1]).length()
		if l > best:
			best = l
			theta = atan2(q[1] - pts[i][1], q[0] - pts[i][0])
	var ax := cos(theta)
	var ay := sin(theta)
	var bx := -ay
	var by := ax
	var min_a := INF
	var max_a := -INF
	var min_b := INF
	var max_b := -INF
	for p in pts:
		var pa: float = p[0] * ax + p[1] * ay
		var pb: float = p[0] * bx + p[1] * by
		min_a = minf(min_a, pa)
		max_a = maxf(max_a, pa)
		min_b = minf(min_b, pb)
		max_b = maxf(max_b, pb)
	var ca := (min_a + max_a) / 2.0
	var cb := (min_b + max_b) / 2.0
	var cx := ax * ca + bx * cb
	var cy := ay * ca + by * cb
	var ext_a := max_a - min_a
	var ext_b := max_b - min_b

	var nd := INF
	var vx := 0.0
	var vy := 1.0
	for sg in segs:
		var ex: float = sg.x1 - sg.x0
		var ey: float = sg.y1 - sg.y0
		var l2 := ex * ex + ey * ey
		var t := clampf(((cx - sg.x0) * ex + (cy - sg.y0) * ey) / l2, 0.0, 1.0) if l2 > 0.0 else 0.0
		var px: float = sg.x0 + t * ex - cx
		var py: float = sg.y0 + t * ey - cy
		var d := Vector2(px, py).length()
		if d < nd and d > 0.01:
			nd = d
			vx = px / d
			vy = py / d
	var along_a := absf(vx * ax + vy * ay) > absf(vx * bx + vy * by)
	var sgn_f := signf(vx * ax + vy * ay) if along_a else signf(vx * bx + vy * by)
	if sgn_f == 0.0:
		sgn_f = 1.0
	var fx := (ax if along_a else bx) * sgn_f
	var fy := (ay if along_a else by) * sgn_f
	var frontage := (ext_b if along_a else ext_a) * T
	var depth := (ext_a if along_a else ext_b) * T

	var h := _hash_int(str(bd.id))
	var r1 := hash2(float(h % 10007) * 0.013, 1.7)
	var r2 := hash2(float(h % 10009) * 0.017, 5.3)
	var floors := int(bd.floors)
	var sets := Kenney.building_sets()
	var set: Array = sets.house if floors <= 4 and r1 < 0.35 else (sets.tall if floors >= 14 else (sets.mid if floors >= 7 else sets.low))
	var fit := func(key: String) -> float:
		var sz := Kenney.size(key)
		if sz == Vector3.ZERO:
			return 0.0
		var ks := Kenney.base_scale(key)
		return minf((frontage * 0.94) / (sz.x * ks), (depth * 0.94) / (sz.z * ks))
	var options := set.filter(func(k: String) -> bool: return fit.call(k) >= 0.75)
	if options.is_empty():
		options = sets.tiny.filter(func(k: String) -> bool: return fit.call(k) >= 0.6)
	if options.is_empty():
		return false
	var key: String = options[int(floorf(r2 * options.size())) % options.size()]
	var sz := Kenney.size(key)
	var m := minf(1.45, fit.call(key))
	var base := Kenney.base_scale(key) * m
	var natural_h := sz.y * base
	var stretch := 1.0 if Kenney.is_house(key) else clampf((floors * 1.0) / natural_h, 0.85, 1.6)
	var xf := Transform3D(Basis(Vector3.UP, atan2(fx, fy)) * Basis.from_scale(Vector3(base, base * stretch, base)), Vector3((cx - origin_gx) * T, 0.05, (cy - origin_gz) * T))
	_place("model:" + key, xf, Color.WHITE, str(bd.id))
	_register(bd, xf, sz.y * base * stretch, Kenney.model(key).parts, [])
	return true


func _render_pts(bd: Dictionary) -> PackedVector2Array:
	var out := PackedVector2Array()
	for p in bd.pts:
		out.append(Vector2(_L(p[0]), _Lz(p[1])))
	return out


func _register(bd: Dictionary, xf: Transform3D, height: float, parts: Array, refs: Array) -> void:
	var pts := _render_pts(bd)
	var c := Vector2.ZERO
	for p in pts:
		c += p
	c /= pts.size()
	var info := {"id": str(bd.id), "pos": Vector3(c.x, 0.05, c.y), "height": height, "pts": pts, "refs": refs, "parts": parts, "xf": xf}
	if bd.has("hp"):
		info.hp = float(bd.hp)
		info.max_hp = float(bd.maxHp)
	buildings[str(bd.id)] = info


func _add_rubble(bd: Dictionary) -> void:
	var mi := MeshInstance3D.new()
	mi.mesh = rubble_mesh(_render_pts(bd), str(bd.id), maxf(1.0, float(bd.floors)))
	root.add_child(mi)


## Cómo se derrumba cada edificio (determinista por su id, igual en todos los
## clientes): 0 se hunde en su sitio, 1 se vuelca entero hacia un lado, 2 la parte de
## arriba se parte y cae de lado mientras el resto se hunde. dir: hacia dónde cae;
## edge: distancia del centro al borde de la planta en esa dirección; cut: altura del
## corte (fracción) en el modo 2.
static func collapse_plan(id: String, pts: PackedVector2Array) -> Dictionary:
	var r := RandomNumberGenerator.new()
	r.seed = _hash_int(id + "caida")
	var u := r.randf()
	var mode := 0 if u < 0.35 else (1 if u < 0.7 else 2)
	var a := r.randf() * TAU
	var dir := Vector2(cos(a), sin(a))
	var c := Vector2.ZERO
	for p in pts:
		c += p
	c /= maxf(1.0, pts.size())
	var edge := 0.0
	for p in pts:
		edge = maxf(edge, (p - c).dot(dir))
	return {"mode": mode, "dir": dir, "center": c, "edge": edge, "cut": r.randf_range(0.45, 0.7)}


## Montón de escombros (determinista por edificio): en la planta y, si el edificio
## cayó de lado, también a lo largo de donde cayó.
static func rubble_mesh(pts: PackedVector2Array, id: String, height := 3.0) -> ArrayMesh:
	var r := RandomNumberGenerator.new()
	r.seed = _hash_int(id)
	var plan := collapse_plan(id, pts)
	var fall_len := 0.0
	if plan.mode == 1:
		fall_len = height * 0.85
	elif plan.mode == 2:
		fall_len = height * (1.0 - plan.cut) * 0.9
	var b := GeoBatch.new()
	var box := StreetFurniture.prim("box")
	var cols := [Color("8f8f96"), Color("6b7080"), Color("4a4d57"), Color("a8a296"), Color("5c5650")]
	var lo := Vector2(INF, INF)
	var hi := Vector2(-INF, -INF)
	for p in pts:
		lo = lo.min(p)
		hi = hi.max(p)
	var c := (lo + hi) * 0.5
	# base: mancha de polvo y cascote menudo
	var tris := Geometry2D.triangulate_polygon(pts)
	var dust := lambert(Color("77736b"))
	for i in range(0, tris.size(), 3):
		var a := pts[tris[i]]
		var bb := pts[tris[i + 1]]
		var cc := pts[tris[i + 2]]
		b.tri(dust, Vector3(a.x, 0.07, a.y), Vector3(bb.x, 0.07, bb.y), Vector3(cc.x, 0.07, cc.y), Vector3.UP, Vector2.ZERO, Vector2.ZERO, Vector2.ZERO)
	var n := 18 + r.randi() % 10
	var placed := 0
	var tries := 0
	while placed < n and tries < n * 6:
		tries += 1
		var p := Vector2(r.randf_range(lo.x, hi.x), r.randf_range(lo.y, hi.y))
		if not Geometry2D.is_point_in_polygon(p, pts):
			continue
		# más alto hacia el centro, como un montón
		var k := 1.0 - clampf(p.distance_to(c) / maxf(0.1, (hi - lo).length() * 0.5), 0.0, 1.0)
		var s := Vector3(r.randf_range(0.12, 0.5), r.randf_range(0.05, 0.12) + k * 0.35, r.randf_range(0.12, 0.45))
		var xf := Transform3D(Basis.from_euler(Vector3(r.randf_range(-0.4, 0.4), r.randf() * TAU, r.randf_range(-0.4, 0.4))).scaled(s), Vector3(p.x, 0.05 + s.y * 0.35, p.y))
		b.mesh(box, xf, lambert(cols[r.randi() % cols.size()]))
		placed += 1
	# lo que cayó de lado: cascotes en una franja desde el borde hacia fuera
	if fall_len > 0.1:
		var dir: Vector2 = plan.dir
		var side := Vector2(-dir.y, dir.x)
		var start: Vector2 = plan.center + dir * plan.edge
		var width := 0.0
		for p in pts:
			width = maxf(width, absf((p - plan.center).dot(side)))
		var m := int(fall_len * 7.0)
		for i in m:
			var t := r.randf()
			var p := start + dir * (t * fall_len) + side * r.randf_range(-width, width) * (1.0 - t * 0.4)
			var s := Vector3(r.randf_range(0.1, 0.4), r.randf_range(0.05, 0.2) * (1.0 - t * 0.5), r.randf_range(0.1, 0.35))
			var xf := Transform3D(Basis.from_euler(Vector3(r.randf_range(-0.5, 0.5), r.randf() * TAU, r.randf_range(-0.5, 0.5))).scaled(s), Vector3(p.x, 0.05 + s.y * 0.35, p.y))
			b.mesh(box, xf, lambert(cols[r.randi() % cols.size()]))
	return b.to_mesh()


## Respaldo: planta poligonal extruida (parcelas donde no cabe ningún modelo).
func _polygon_building(bd: Dictionary) -> void:
	var pts: Array = bd.pts
	if pts.size() < 3:
		return
	if bd.has("hp") and float(bd.hp) <= 0.0:
		_add_rubble(bd)
		return
	var own := GeoBatch.new()
	var poly := PackedVector2Array()
	for p in pts:
		poly.append(Vector2(_L(p[0]), _Lz(p[1])))
	var tris := Geometry2D.triangulate_polygon(poly)
	if tris.is_empty():
		return
	var top := 0.05 + maxf(1.0, float(bd.floors)) * 1.0
	var mat := lambert(Color("b9b2a6").darkened(hash_str(str(bd.id)) * 0.25))
	for i in range(0, tris.size(), 3):
		var a := poly[tris[i]]
		var b := poly[tris[i + 1]]
		var c := poly[tris[i + 2]]
		own.tri(mat, Vector3(a.x, top, a.y), Vector3(b.x, top, b.y), Vector3(c.x, top, c.y), Vector3.UP, Vector2.ZERO, Vector2.ZERO, Vector2.ZERO)
	for i in poly.size():
		var a := poly[i]
		var b := poly[(i + 1) % poly.size()]
		var e := (b - a).normalized()
		var n := Vector3(e.y, 0.0, -e.x)
		# la normal debe apuntar hacia fuera del polígono
		var mid := (a + b) * 0.5 + Vector2(n.x, n.z) * 0.01
		if Geometry2D.is_point_in_polygon(mid, poly):
			n = -n
		var a0 := Vector3(a.x, 0.05, a.y)
		var b0 := Vector3(b.x, 0.05, b.y)
		var a1 := Vector3(a.x, top, a.y)
		var b1 := Vector3(b.x, top, b.y)
		own.tri(mat, a0, b0, b1, n, Vector2.ZERO, Vector2.ZERO, Vector2.ZERO)
		own.tri(mat, a0, b1, a1, n, Vector2.ZERO, Vector2.ZERO, Vector2.ZERO)
	var am := own.to_mesh()
	var mi := MeshInstance3D.new()
	mi.mesh = am
	root.add_child(mi)
	_register(bd, Transform3D(), top - 0.05, [[am, Transform3D()]], [mi])


# ------------------------------------------------------------------ instancias

func _instantiate_chunks() -> void:
	for ck in chunks:
		var kinds: Dictionary = chunks[ck]
		for kind in kinds:
			var list: Array = kinds[kind]
			if kind == "streetlight":
				_multimesh(StreetFurniture.streetlight_mesh(), Transform3D(), list, false)
			elif kind == "car":
				_multimesh(car_mesh(), Transform3D(), list, true)
			else:
				var model := Kenney.model(kind.substr(6))
				for part in model.parts:
					_multimesh(part[0], part[1], list, false)


func _multimesh(mesh: Mesh, part_xf: Transform3D, list: Array, colors: bool) -> void:
	var mm := MultiMesh.new()
	mm.transform_format = MultiMesh.TRANSFORM_3D
	mm.use_colors = colors
	mm.mesh = mesh
	mm.instance_count = list.size()
	for i in list.size():
		mm.set_instance_transform(i, list[i][0] * part_xf)
		if colors:
			mm.set_instance_color(i, list[i][1])
		var bid: String = list[i][2] if list[i].size() > 2 else ""
		if bid != "" and buildings.has(bid):
			buildings[bid].refs.append([mm, i])
	var mmi := MultiMeshInstance3D.new()
	mmi.multimesh = mm
	root.add_child(mmi)
