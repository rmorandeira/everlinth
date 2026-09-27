class_name Terrain
## Relieve de la ciudad real: cada sala trae su rejilla de alturas (CityData.elev, en
## unidades de render, 1 = 3 m) y aquí se juntan las de la escena en una sola rejilla
## (acceso directo, sin buscar la sala: se consulta cientos de miles de veces al
## construir). Todo lo que se apoya en el suelo (acera, calles, mobiliario, edificios,
## personas, coches, cámara) suma esta altura. Sin datos (salas procedurales), 0.

const T := Protocol.TILE_SIZE
const W := Protocol.SCREEN_WIDTH
const H := Protocol.SCREEN_HEIGHT

static var origin := Vector2i.ZERO
static var _flat := true
static var _step := 3.0
static var _x0 := 0.0 # tile global de la primera muestra
static var _y0 := 0.0
static var _w := 0
static var _h := 0
static var _z := PackedFloat32Array()


## rooms: salas del servidor (screen y vecinas). origin: tile global del origen de la escena.
static func set_rooms(rooms: Array, ogx: int, ogz: int) -> void:
	origin = Vector2i(ogx, ogz)
	_flat = true
	var grids: Array = []
	var lo := Vector2i(1 << 30, 1 << 30)
	var hi := Vector2i(-(1 << 30), -(1 << 30))
	for r in rooms:
		if not r.has("city"):
			continue
		var e: Dictionary = r.city.get("elev", {})
		if e.is_empty():
			continue
		var k := Vector2i(int(r.sx), int(r.sy))
		grids.append([k, e])
		lo = lo.min(k)
		hi = hi.max(k)
		_step = float(e.step)
	if grids.is_empty():
		return
	_flat = false
	var per_x := int(W / _step)
	var per_y := int(H / _step)
	_x0 = lo.x * W
	_y0 = lo.y * H
	_w = (hi.x - lo.x + 1) * per_x + 1
	_h = (hi.y - lo.y + 1) * per_y + 1
	_z = PackedFloat32Array()
	_z.resize(_w * _h)
	for g in grids:
		var k: Vector2i = g[0]
		var e: Dictionary = g[1]
		var z: Array = e.z
		var ew := int(e.w)
		var ox := (k.x - lo.x) * per_x
		var oy := (k.y - lo.y) * per_y
		for j in int(e.h):
			for i in ew:
				_z[(oy + j) * _w + ox + i] = float(z[j * ew + i])
	# salas sin datos dentro del rectángulo: se quedan a 0 (no pasa en la ciudad real)


static func is_flat() -> bool:
	return _flat


## Altura en un punto (tiles globales).
static func h(gx: float, gy: float) -> float:
	if _flat:
		return 0.0
	var fx := clampf((gx - _x0) / _step, 0.0, _w - 1.001)
	var fy := clampf((gy - _y0) / _step, 0.0, _h - 1.001)
	var i := int(fx)
	var j := int(fy)
	var a := fx - i
	var b := fy - j
	var k := j * _w + i
	return lerpf(lerpf(_z[k], _z[k + 1], a), lerpf(_z[k + _w], _z[k + _w + 1], a), b)


## Altura en un punto en unidades de render de la escena actual.
static func at(x: float, z: float) -> float:
	if _flat:
		return 0.0
	return h(x / T + origin.x, z / T + origin.y)
