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
var crosses: Array = []


func _L(gx: float) -> float:
	return (gx - origin_gx) * T


func _Lz(gz: float) -> float:
	return (gz - origin_gz) * T


func _p(gx: float, gz: float, y: float) -> Vector3:
	return Vector3(_L(gx), y, _Lz(gz))


## Registra una instancia (modelo o malla compartida) en la sala que la contiene.
func _place(kind: String, xf: Transform3D, color := Color.WHITE) -> void:
	var gx := xf.origin.x / T + origin_gx
	var gz := xf.origin.z / T + origin_gz
	var ck := "%d,%d" % [floori(gx / W), floori(gz / H)]
	if not chunks.has(ck):
		chunks[ck] = {}
	if not chunks[ck].has(kind):
		chunks[ck][kind] = []
	chunks[ck][kind].append([xf, color])


## Modelo del kit en (x, z) (unidades de render), frente (+Z) hacia (fx, fz).
func _kit_prop(kit: String, name: String, x: float, z: float, fx: float, fz: float, k := 1.0) -> bool:
	var key := kit + "/" + name
	if Kenney.model(key).is_empty():
		return false
	var s: float = Kenney.KIT_SCALE[kit] * k
	_place("model:" + key, Transform3D(Basis(Vector3.UP, atan2(fx, fz)).scaled(Vector3(s, s, s)), Vector3(x, 0.05, z)))
	return true


func _seg_dist(s: Dictionary, px: float, py: float) -> float:
	var vx: float = s.x1 - s.x0
	var vy: float = s.y1 - s.y0
	var l2 := vx * vx + vy * vy
	var t := clampf(((px - s.x0) * vx + (py - s.y0) * vy) / l2, 0.0, 1.0) if l2 > 0.0 else 0.0
	return Vector2(px - (s.x0 + t * vx), py - (s.y0 + t * vy)).length()


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

	_roadway()
	_markings_and_furniture()
	_crossings()
	for bd in building_defs.values():
		if not _kit_building(bd):
			_polygon_building(bd)
	flat.build(root, false)
	solid.build(root, true)
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

		# Farolas y árboles alternando lados; coches junto al bordillo; aceite; charcos.
		var t := 5.0
		while t < length - 2.0:
			var px: float = s.x0 + ux * t
			var py: float = s.y0 + uy * t
			t += 6.0
			if _near_cross(px, py, 2.5):
				continue
			var k := int(jround((px * ux + py * uy) / 6.0))
			var side := 1.0 if k % 2 == 0 else -1.0
			var h := hash2(jround(px * 3.0), jround(py * 3.0))
			var sx := px + nx * side * (half + 0.8)
			var sy := py + ny * side * (half + 0.8)
			if k % 3 == 0:
				_place("streetlight", StreetFurniture.streetlight_xform(_L(sx), _Lz(sy), -nx * side, -ny * side))
			elif h > 0.45:
				var crown: int = CROWNS[int(floorf(h * 97.0)) % CROWNS.size()]
				_kit_prop("suburban", "tree-large" if crown % 2 == 0 else "tree-small", _L(sx), _Lz(sy), 0.0, 1.0, 0.9 + (crown % 7) * 0.05)
			elif h < 0.12:
				var bx := px + nx * side * (half + 1.3)
				var by := py + ny * side * (half + 1.3)
				_kit_prop("retro", "detail-bench", _L(bx), _Lz(by), -nx * side, -ny * side, 0.5)
			elif h < 0.17:
				var ddx := px + nx * side * (half + 1.4)
				var ddy := py + ny * side * (half + 1.4)
				_kit_prop("retro", "detail-dumpster-closed" if h < 0.145 else "detail-dumpster-open", _L(ddx), _Lz(ddy), ux, uy, 0.55)
			var hc := hash2(jround(px * 5.0) + 1.0, jround(py * 5.0))
			var cside := -side
			var cx := px + nx * cside * (half - 0.65)
			var cy := py + ny * cside * (half - 0.65)
			var car_color: Color = CAR_COLORS[int(floorf(h * 131.0)) % CAR_COLORS.size()]
			if hc > 0.95:
				var truck: String = ["truck-grey", "truck-green", "truck-flat"][int(floorf(h * 3.0)) % 3]
				if not _kit_prop("retro", truck, _L(cx), _Lz(cy), ux, uy, 0.62):
					_add_car(_L(cx), _Lz(cy), ang, car_color)
			elif hc > 0.55:
				_add_car(_L(cx), _Lz(cy), ang, car_color)
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
				var side_p := 1.0 if hw > 0.915 else -1.0
				_mark(puddle_mat(), px + nx * side_p * (half + 1.0), py + ny * side_p * (half + 1.0), 1.4, 0.9, ang + hw * 4.0, 0.056)


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
					_mark(white, cwx + nx * w, cwy + ny * w, 1.1, 0.38, ang)
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
				if not higher and not all_way_stop:
					var pole_off := half + 0.7
					var lane_centers: Array
					if one_way:
						lane_centers = [-half * 0.5, half * 0.5] if half >= 3.0 else [0.0]
					else:
						lane_centers = [half * 0.25, half * 0.75] if half >= 3.0 else [half * 0.5]
					var q: Vector2 = at.call(other + 2.6, pole_off)
					var axis := "A" if absf(th.ux * c.through[0].ux + th.uy * c.through[0].uy) > 0.7 else "B"
					StreetFurniture.traffic_signal(solid, _L(q.x), _Lz(q.y), hx, hy, lane_centers.map(func(lc: float) -> float: return (pole_off - lc) * T), axis)
				var wz: Vector2 = at.call(other + 4.5, 0.0 if one_way else half * 0.5)
				_mark(worn, wz.x, wz.y, 5.5, half * 1.8 if one_way else half * 1.1, hang, Y_DECAL - 0.0005)
				if higher or all_way_stop:
					var D := other + 2.35
					var sp: Vector2 = at.call(D, mid)
					_mark(white, sp.x, sp.y, band_w - 0.1, 0.4, hang + PI / 2.0)
					var tp: Vector2 = at.call(D + 2.3, mid)
					_mark(stop, tp.x, tp.y, minf(band_w * 0.92, 2.4), 3.4, hang + PI / 2.0)
					if not one_way:
						var lp: Vector2 = at.call(D + 3.5, 0.0)
						_mark(yellow, lp.x, lp.y, 7.0, 0.13, ang)
					if rnd < 0.7:
						var op: Vector2 = at.call(D + 1.9, mid + (rnd - 0.35) * 0.8)
						_mark(oil, op.x, op.y, 1.5, 1.1, hang + rnd * 3.0, Y_DECAL)
				if th.seg.kind == 2:
					var D := other + 2.0
					for off in [half * 0.5, -half * 0.5]:
						var lp: Vector2 = at.call(D + 4.5, off)
						_mark(white, lp.x, lp.y, 9.0, 0.12, ang)
					var ip: Vector2 = at.call(D + 4.0, half * 0.25)
					_mark(arrow_l, ip.x, ip.y, 0.95, 2.4, hang + PI / 2.0)
					var o2: Vector2 = at.call(D + 4.0, half * 0.75)
					_mark(arrow_s, o2.x, o2.y, 0.95, 2.4, hang + PI / 2.0)
				if rnd > 0.72:
					var L2 := 3.0 + (rnd - 0.72) * 14.0
					var lane := (rnd - 0.86) * half if one_way else half * 0.5
					var kp: Vector2 = at.call(other + 2.2 + L2 / 2.0, lane)
					_mark(skid, kp.x, kp.y, L2, 1.1, hang + (rnd - 0.86) * 0.25, Y_DECAL)


# ------------------------------------------------------------------ edificios

## Modelo de Kenney ajustado a la parcela: rectángulo orientado según su arista más
## larga, frente hacia la calle más cercana, elegido por plantas entre los que caben,
## escalado para caber y estirado en vertical hacia las plantas pedidas.
func _kit_building(bd: Dictionary) -> bool:
	var pts: Array = bd.pts
	if pts.size() < 3:
		return false
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
	var kit := "suburban" if set == sets.house else "commercial"
	var ks: float = Kenney.KIT_SCALE[kit]
	var fit := func(key: String) -> float:
		var sz := Kenney.size(key)
		if sz == Vector3.ZERO:
			return 0.0
		return minf((frontage * 0.94) / (sz.x * ks), (depth * 0.94) / (sz.z * ks))
	var options := set.filter(func(k: String) -> bool: return fit.call(k) >= 0.75)
	if options.is_empty():
		options = sets.tiny.filter(func(k: String) -> bool: return fit.call(k) >= 0.6)
	if options.is_empty():
		return false
	var key: String = options[int(floorf(r2 * options.size())) % options.size()]
	var sz := Kenney.size(key)
	var m := minf(1.45, fit.call(key))
	var base := ks * m
	var natural_h := sz.y * base
	var stretch := 1.0 if kit == "suburban" else clampf((floors * 1.0) / natural_h, 0.85, 1.6)
	var xf := Transform3D(Basis(Vector3.UP, atan2(fx, fy)) * Basis.from_scale(Vector3(base, base * stretch, base)), Vector3((cx - origin_gx) * T, 0.05, (cy - origin_gz) * T))
	_place("model:" + key, xf)
	return true


## Respaldo: planta poligonal extruida (parcelas donde no cabe ningún modelo).
func _polygon_building(bd: Dictionary) -> void:
	var pts: Array = bd.pts
	if pts.size() < 3:
		return
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
		solid.tri(mat, Vector3(a.x, top, a.y), Vector3(b.x, top, b.y), Vector3(c.x, top, c.y), Vector3.UP, Vector2.ZERO, Vector2.ZERO, Vector2.ZERO)
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
		solid.tri(mat, a0, b0, b1, n, Vector2.ZERO, Vector2.ZERO, Vector2.ZERO)
		solid.tri(mat, a0, b1, a1, n, Vector2.ZERO, Vector2.ZERO, Vector2.ZERO)


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
	var mmi := MultiMeshInstance3D.new()
	mmi.multimesh = mm
	root.add_child(mmi)
