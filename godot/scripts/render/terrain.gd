class_name Terrain
## Relieve de la ciudad real: cada sala trae su rejilla de alturas (CityData.elev, en
## unidades de render, 1 = 3 m) y aquí se interpola para cualquier punto. Todo lo que se
## apoya en el suelo (acera, calles, mobiliario, edificios, personas, coches, cámara) suma
## esta altura. Sin datos (salas procedurales), 0: el mundo plano de siempre.

const T := Protocol.TILE_SIZE
const W := Protocol.SCREEN_WIDTH
const H := Protocol.SCREEN_HEIGHT

static var grids := {} # Vector2i(sx, sy) -> { step, w, h, z: PackedFloat32Array }
static var origin := Vector2i.ZERO


## rooms: salas del servidor (screen y vecinas). origin: tile global del origen de la escena.
static func set_rooms(rooms: Array, ogx: int, ogz: int) -> void:
	grids.clear()
	origin = Vector2i(ogx, ogz)
	for r in rooms:
		if not r.has("city"):
			continue
		var e: Dictionary = r.city.get("elev", {})
		if e.is_empty():
			continue
		grids[Vector2i(int(r.sx), int(r.sy))] = {"step": int(e.step), "w": int(e.w), "h": int(e.h), "z": PackedFloat32Array(e.z)}


static func is_flat() -> bool:
	return grids.is_empty()


## Altura en un punto (tiles globales).
static func h(gx: float, gy: float) -> float:
	if grids.is_empty():
		return 0.0
	var sx := floori(gx / W)
	var sy := floori(gy / H)
	var g: Dictionary = grids.get(Vector2i(sx, sy), {})
	if g.is_empty():
		# fuera de las salas cargadas: la más cercana (borde)
		var best := INF
		for k in grids:
			var d := Vector2(k.x * W + W * 0.5 - gx, k.y * H + H * 0.5 - gy).length()
			if d < best:
				best = d
				sx = k.x
				sy = k.y
		g = grids[Vector2i(sx, sy)]
	var step: float = g.step
	var fx := clampf((gx - sx * W) / step, 0.0, g.w - 1.001)
	var fy := clampf((gy - sy * H) / step, 0.0, g.h - 1.001)
	var i := int(fx)
	var j := int(fy)
	var a := fx - i
	var b := fy - j
	var z: PackedFloat32Array = g.z
	var w: int = g.w
	return lerpf(lerpf(z[j * w + i], z[j * w + i + 1], a), lerpf(z[(j + 1) * w + i], z[(j + 1) * w + i + 1], a), b)


## Altura en un punto en unidades de render de la escena actual.
static func at(x: float, z: float) -> float:
	if grids.is_empty():
		return 0.0
	return h(x / T + origin.x, z / T + origin.y)
