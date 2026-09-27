class_name Traffic
extends Node3D
## Tráfico (cosmético, en cada cliente): vehículos que circulan por la red de calles
## de la ciudad (City) por su carril (por la derecha), giran en los cruces, paran en
## los semáforos en rojo (mismas fases que StreetFurniture) y en los STOP, guardan la
## distancia con el de delante y frenan ante zombis, paseantes y jugadores. De vez en
## cuando pasan autobuses y vehículos de emergencia (policía, bomberos, ambulancia)
## con luces giratorias, que no paran en rojo. Todos en MultiMesh por modelo.

const T := Protocol.TILE_SIZE
const ROAD_HALF: Array = Protocol.CITY_ROAD_HALF
const MAX_VEHICLES := 36
const CAP_PER_MODEL := 48
const CIVIL := ["cars/sedan", "cars/sedan-sports", "cars/hatchback-sports", "cars/suv", "cars/suv-luxury", "cars/taxi", "cars/van", "cars/delivery", "cars/truck"]
const EMERGENCY := ["cars/police", "cars/firetruck", "cars/ambulance"]
const BUS := "transport/bus"

var origin_gx := 0
var origin_gz := 0
var segs: Array = []
var info := {}
var approaches: Array = []
var _ends := {} # "x,y" redondeado -> [ [seg, extremo 0|1], ... ]
var _veh: Array = []
# autovías: carriles como polilíneas [PackedVector3Array (x, y tiles; z altura), longitudes acumuladas]
var _hw_lanes: Array = []
var _hw_veh: Array = [] # { lane, d, speed, model }
var _mm := {} # modelo -> [[MultiMeshInstance3D, Transform3D de la pieza], ...]
var _lights: Array[OmniLight3D] = []
var _obstacles: Array = [] # Vector2 en tiles globales (zombis, paseantes, jugador)
var _focus := Vector3.ZERO # cámara (render): solo se dibujan los vehículos cercanos


func _ready() -> void:
	for i in 4:
		var l := OmniLight3D.new()
		l.omni_range = 3.0
		l.light_energy = 0.0
		l.shadow_enabled = false
		add_child(l)
		_lights.append(l)


func set_city(meta_root: Node3D, ogx: int, ogz: int) -> void:
	origin_gx = ogx
	origin_gz = ogz
	segs = meta_root.get_meta("segs", [])
	info = meta_root.get_meta("info", {})
	approaches = meta_root.get_meta("approaches", [])
	# llegadas a cruces por celda de 3 tiles: cada coche solo mira las de su final de tramo
	_agrid.clear()
	for a in approaches:
		var c := Vector2i(floori(a.x / 3.0), floori(a.y / 3.0))
		if _agrid.has(c):
			_agrid[c].append(a)
		else:
			_agrid[c] = [a]
	_ends.clear()
	for s in segs:
		for e in 2:
			var k := _end_key(s.x1 if e == 1 else s.x0, s.y1 if e == 1 else s.y0)
			if not _ends.has(k):
				_ends[k] = []
			_ends[k].append([s, e])
	_veh.clear()
	_fill = true
	_build_hw_lanes(meta_root.get_meta("highways", []))


var _fill := false
var _agrid := {} # Vector2i (celda de 3 tiles) -> [llegada a cruce]
var _ogrid := {} # Vector2i (celda de 4 tiles) -> [Vector2]


## Carriles de las autovías: dos por sentido, por la derecha, a lo largo de cada una.
func _build_hw_lanes(hws: Array) -> void:
	_hw_lanes.clear()
	_hw_veh.clear()
	var groups := {}
	for h in hws:
		if int(h.kind) != 0:
			continue
		var key: String = str(h.id).split(":")[0]
		if not groups.has(key):
			groups[key] = []
		groups[key].append(h)
	for key in groups:
		var list: Array = groups[key]
		list.sort_custom(func(a: Dictionary, b: Dictionary) -> bool: return float(a.s0) < float(b.s0))
		var center := PackedVector3Array()
		for h in list:
			if center.is_empty():
				center.append(Vector3(h.x0, h.y0, h.z0))
			center.append(Vector3(h.x1, h.y1, h.z1))
		if center.size() < 3:
			continue
		for off in [1.8, 4.2, -1.8, -4.2]:
			var pts := PackedVector3Array()
			for i in center.size():
				var a := center[max(0, i - 1)]
				var b := center[min(center.size() - 1, i + 1)]
				var d := Vector2(b.x - a.x, b.y - a.y).normalized()
				var r: Vector2 = Vector2(-d.y, d.x) * off
				pts.append(Vector3(center[i].x + r.x, center[i].y + r.y, center[i].z))
			if off < 0.0:
				pts.reverse() # sentido contrario: se recorre al revés (siempre por su derecha)
			var cum := PackedFloat32Array([0.0])
			for i in range(1, pts.size()):
				cum.append(cum[i - 1] + Vector2(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y).length())
			_hw_lanes.append([pts, cum])


func _hw_at(lane: Array, d: float) -> Array:
	var pts: PackedVector3Array = lane[0]
	var cum: PackedFloat32Array = lane[1]
	var i := cum.bsearch(d) - 1
	i = clampi(i, 0, pts.size() - 2)
	var t := clampf((d - cum[i]) / maxf(0.001, cum[i + 1] - cum[i]), 0.0, 1.0)
	var p := pts[i].lerp(pts[i + 1], t)
	var h := Vector2(pts[i + 1].x - pts[i].x, pts[i + 1].y - pts[i].y).normalized()
	return [p, h]


func _update_hw(dt: float) -> void:
	if _hw_lanes.is_empty():
		return
	while _hw_veh.size() < _hw_lanes.size() * 3:
		var li := randi() % _hw_lanes.size()
		var cum: PackedFloat32Array = _hw_lanes[li][1]
		var r := randf()
		_hw_veh.append({"lane": li, "d": randf() * cum[cum.size() - 1], "speed": randf_range(5.0, 6.5) if li % 2 == 0 else randf_range(4.2, 5.2),
			"model": (EMERGENCY[randi() % EMERGENCY.size()] if r < 0.05 else (BUS if r < 0.12 else CIVIL[randi() % CIVIL.size()]))})
	for v in _hw_veh:
		var cum: PackedFloat32Array = _hw_lanes[v.lane][1]
		v.d += v.speed * dt
		if v.d > cum[cum.size() - 1]:
			v.d = 0.0


## Personas y zombis en una rejilla de celdas de 4 tiles: cada coche solo mira las
## celdas de su alrededor.
func set_obstacles(list: Array) -> void:
	_obstacles = list
	_ogrid.clear()
	for o in list:
		var c := Vector2i(floori(o.x / 4.0), floori(o.y / 4.0))
		if _ogrid.has(c):
			_ogrid[c].append(o)
		else:
			_ogrid[c] = [o]


static func _end_key(x: float, y: float) -> String:
	return "%d,%d" % [roundi(x * 2.0), roundi(y * 2.0)]


func _model_parts(key: String) -> Array:
	if _mm.has(key):
		return _mm[key]
	var out: Array = []
	var m := Kenney.model(key)
	if not m.is_empty():
		for p in m.parts:
			var mm := MultiMesh.new()
			mm.transform_format = MultiMesh.TRANSFORM_3D
			mm.mesh = p[0]
			mm.instance_count = CAP_PER_MODEL
			mm.visible_instance_count = 0
			var mmi := MultiMeshInstance3D.new()
			mmi.multimesh = mm
			mmi.custom_aabb = AABB(Vector3(-1000, -10, -1000), Vector3(2000, 40, 2000))
			add_child(mmi)
			out.append([mmi, p[1]])
	_mm[key] = out
	return out


## Carril de un segmento en un sentido: desplazamiento lateral (tiles, a la derecha
## del sentido de la marcha). Mismo reparto de la calzada que el aparcamiento de City.
func _lane(s: Dictionary, forward: bool) -> float:
	var li: Dictionary = info.get(s.id, {"one_way": false, "dir": 1})
	match int(s.kind):
		0:
			if li.one_way:
				# aparcamiento en +n (derecha del sentido del segmento): el carril, al otro lado
				return -0.65 if forward else 0.65
			return 0.8
		1:
			return 0.55
	return 0.85 if randf() < 0.5 else 2.55


func _can_go(s: Dictionary, forward: bool) -> bool:
	var li: Dictionary = info.get(s.id, {"one_way": false, "dir": 1})
	if li.get("closed", false):
		return false # cortada por un control de barreras
	if not li.one_way:
		return true
	return (li.dir > 0) == forward


func _spawn(near: Vector2, far_only: bool) -> void:
	if segs.is_empty():
		return
	for attempt in 12:
		var s: Dictionary = segs[randi() % segs.size()]
		if info.get(s.id, {}).get("closed", false):
			continue # calle cortada por un control
		var fwd := randf() < 0.5
		if not _can_go(s, fwd):
			fwd = not fwd
		var length := Vector2(s.x1 - s.x0, s.y1 - s.y0).length()
		if length < 2.0:
			continue
		var d := randf() * length
		var p := _pos_on(s, fwd, d, 0.0)
		var dist := p.distance_to(near)
		if dist > 70.0 or (far_only and dist < 26.0):
			continue
		var r := randf()
		var model: String
		var kind := "civil"
		if r < 0.07:
			model = EMERGENCY[randi() % EMERGENCY.size()]
			kind = "emergency"
		elif r < 0.13:
			model = BUS
			kind = "bus"
		else:
			model = CIVIL[randi() % CIVIL.size()]
		var top: float = {"emergency": 4.2, "bus": 2.2, "civil": 3.0}[kind]
		_veh.append({"seg": s, "fwd": fwd, "d": d, "lane": _lane(s, fwd), "speed": top * 0.6, "top": top * randf_range(0.9, 1.1), "model": model, "kind": kind, "wait": 0.0, "stopped_at": null})
		return


## Punto (tiles globales) a distancia d del inicio del segmento en ese sentido, con carril.
func _pos_on(s: Dictionary, fwd: bool, d: float, lane: float) -> Vector2:
	var a := Vector2(s.x0, s.y0) if fwd else Vector2(s.x1, s.y1)
	var b := Vector2(s.x1, s.y1) if fwd else Vector2(s.x0, s.y0)
	var u := (b - a).normalized()
	var right := Vector2(-u.y, u.x)
	return a + u * d + right * lane


func _dir_of(s: Dictionary, fwd: bool) -> Vector2:
	var u := Vector2(s.x1 - s.x0, s.y1 - s.y0).normalized()
	return u if fwd else -u


## Siguiente tramo al llegar al final: sigue recto casi siempre, a veces gira.
func _next(v: Dictionary) -> bool:
	var s: Dictionary = v.seg
	var end := Vector2(s.x1, s.y1) if v.fwd else Vector2(s.x0, s.y0)
	var h := _dir_of(s, v.fwd)
	var options: Array = []
	for e in _ends.get(_end_key(end.x, end.y), []):
		var ns: Dictionary = e[0]
		if ns == s:
			continue
		var fwd: bool = e[1] == 0 # sale desde ese extremo
		if not _can_go(ns, fwd):
			continue
		var nh := _dir_of(ns, fwd)
		var dot := h.dot(nh)
		if dot < -0.3:
			continue
		options.append([ns, fwd, dot])
	if options.is_empty():
		return false
	options.sort_custom(func(a: Array, b: Array) -> bool: return a[2] > b[2])
	var pick: Array = options[0] if (randf() < 0.65 or options.size() == 1) else options[1 + randi() % (options.size() - 1)]
	v.seg = pick[0]
	v.fwd = pick[1]
	v.d = 0.0
	v.lane = _lane(pick[0], pick[1])
	v.stopped_at = null
	return true


## Llegadas a cruces a menos de 1,5 tiles (celdas vecinas de la rejilla).
func _near_approaches(p: Vector2) -> Array:
	var out: Array = []
	var cx := floori(p.x / 3.0)
	var cy := floori(p.y / 3.0)
	for dy in [-1, 0, 1]:
		for dx in [-1, 0, 1]:
			var l: Array = _agrid.get(Vector2i(cx + dx, cy + dy), [])
			if not l.is_empty():
				out.append_array(l)
	return out


## ¿Hay que parar antes del cruce del final del tramo? Devuelve la distancia (tiles)
## hasta la línea de detención, o INF si puede seguir.
func _stop_distance(v: Dictionary, length: float, time: float) -> float:
	if v.kind == "emergency":
		return INF
	var s: Dictionary = v.seg
	var end := Vector2(s.x1, s.y1) if v.fwd else Vector2(s.x0, s.y0)
	var h := _dir_of(s, v.fwd)
	for a in _near_approaches(end):
		if absf(a.x - end.x) > 1.5 or absf(a.y - end.y) > 1.5:
			continue
		if Vector2(a.hx, a.hy).dot(h) < 0.9:
			continue
		var line: float = length - float(a.stop_dist)
		if line < v.d - 0.5:
			return INF # ya ha pasado la línea
		if a.axis == "stop":
			if v.stopped_at == end:
				return INF
			return line - v.d
		var st := StreetFurniture._axis_state(time, a.axis)
		if st == "green":
			return INF
		if st == "amber" and line - v.d < 1.5:
			return INF # demasiado cerca para frenar: pasa
		return line - v.d
	return INF


func update(dt: float, time: float, player: Vector2) -> void:
	_focus = Vector3((player.x - origin_gx) * T, 0.0, (player.y - origin_gz) * T)
	if segs.is_empty():
		for k in _mm:
			for p in _mm[k]:
				p[0].multimesh.visible_instance_count = 0
		return
	# al cargar la ciudad, las calles ya tienen tráfico; luego, los nuevos entran de lejos
	if _fill:
		_fill = false
		for k in MAX_VEHICLES * 3:
			if _veh.size() >= MAX_VEHICLES * 0.8:
				break
			_spawn(player, false)
	elif _veh.size() < MAX_VEHICLES:
		_spawn(player, true)
	var positions: Array = []
	for v in _veh:
		positions.append(_pos_on(v.seg, v.fwd, v.d, v.lane))
	var keep: Array = []
	for i in _veh.size():
		var v: Dictionary = _veh[i]
		var s: Dictionary = v.seg
		var length := Vector2(s.x1 - s.x0, s.y1 - s.y0).length()
		var p: Vector2 = positions[i]
		var h := _dir_of(s, v.fwd)
		var target: float = v.top
		# semáforo o STOP
		var sd := _stop_distance(v, length, time)
		if sd < INF:
			if sd < 0.3:
				target = 0.0
				if v.speed < 0.05:
					v.wait += dt
					# STOP: tras detenerse un momento, sigue
					var end := Vector2(s.x1, s.y1) if v.fwd else Vector2(s.x0, s.y0)
					if v.wait > 1.2 and _stop_distance(v, length, time) < INF:
						for a in _near_approaches(end):
							if a.axis == "stop" and absf(a.x - end.x) < 1.5 and absf(a.y - end.y) < 1.5:
								v.stopped_at = end
								v.wait = 0.0
			else:
				target = minf(target, sd * 1.2)
		# el de delante
		for j in _veh.size():
			if j == i:
				continue
			var q: Vector2 = positions[j] - p
			var ahead := q.dot(h)
			if ahead > 0.0 and ahead < 7.0 and absf(q.dot(Vector2(-h.y, h.x))) < 1.0:
				target = minf(target, maxf(0.0, (ahead - 4.2) * 1.2))
		# personas y zombis en la calzada por delante
		var crowd := 0
		for cy in range(floori((p.y - 6.0) / 4.0), floori((p.y + 6.0) / 4.0) + 1):
			for cx in range(floori((p.x - 6.0) / 4.0), floori((p.x + 6.0) / 4.0) + 1):
				var cell: Array = _ogrid.get(Vector2i(cx, cy), [])
				for o in cell:
					var q: Vector2 = o - p
					var ahead := q.dot(h)
					if ahead > -1.0 and ahead < 5.0 and absf(q.dot(Vector2(-h.y, h.x))) < 1.6:
						target = minf(target, maxf(0.0, (ahead - 2.2) * 1.0))
					if q.length_squared() < 36.0:
						crowd += 1
		if crowd >= 6 and v.kind != "emergency":
			target = 0.0 # la horda lo rodea: se queda parado
		var acc := 3.0 if target > v.speed else 7.0
		v.speed = move_toward(v.speed, target, acc * dt)
		v.d += v.speed * dt
		if v.d >= length:
			if not _next(v):
				continue
		if p.distance_to(player) > 80.0:
			continue
		keep.append(v)
	_veh = keep
	_update_hw(dt)
	_draw(time)


func _draw(time: float) -> void:
	var counts := {}
	var light := 0
	for v in _veh:
		var p := _pos_on(v.seg, v.fwd, v.d, v.lane)
		if absf((p.x - origin_gx) * T - _focus.x) > 20.0 or absf((p.y - origin_gz) * T - _focus.z) > 20.0:
			continue
		var h := _dir_of(v.seg, v.fwd)
		var s := Kenney.base_scale(v.model)
		# cabeceo en las cuestas: pendiente del terreno a lo largo del sentido de la marcha
		var climb := atan2(Terrain.h(p.x + h.x * 1.5, p.y + h.y * 1.5) - Terrain.h(p.x - h.x * 1.5, p.y - h.y * 1.5), 3.0 * T)
		var xf := Transform3D((Basis(Vector3.UP, atan2(h.x, h.y)) * Basis(Vector3.RIGHT, -climb)).scaled(Vector3(s, s, s)), Vector3((p.x - origin_gx) * T, 0.06 + Terrain.h(p.x, p.y), (p.y - origin_gz) * T))
		var parts := _model_parts(v.model)
		var n: int = counts.get(v.model, 0)
		if n >= CAP_PER_MODEL:
			continue
		for part in parts:
			part[0].multimesh.set_instance_transform(n, xf * (part[1] as Transform3D))
		counts[v.model] = n + 1
		# luces giratorias de emergencia (rojo/azul alternando)
		if v.kind == "emergency" and light < _lights.size():
			var l := _lights[light]
			light += 1
			var on := int(time * 6.0) % 2 == 0
			l.light_color = Color("ff2a2a") if on else Color("2a5cff")
			l.light_energy = 2.2
			l.position = xf.origin + Vector3(0, 0.6, 0)
	# autovías
	for v in _hw_veh:
		var r := _hw_at(_hw_lanes[v.lane], v.d)
		var p: Vector3 = r[0]
		if absf((p.x - origin_gx) * T - _focus.x) > 22.0 or absf((p.y - origin_gz) * T - _focus.z) > 22.0:
			continue
		var h: Vector2 = r[1]
		var s := Kenney.base_scale(v.model)
		var xf := Transform3D(Basis(Vector3.UP, atan2(h.x, h.y)).scaled(Vector3(s, s, s)), Vector3((p.x - origin_gx) * T, p.z + 0.01 + Terrain.h(p.x, p.y), (p.y - origin_gz) * T))
		var n: int = counts.get(v.model, 0)
		if n >= CAP_PER_MODEL:
			continue
		for part in _model_parts(v.model):
			part[0].multimesh.set_instance_transform(n, xf * (part[1] as Transform3D))
		counts[v.model] = n + 1
	for i in range(light, _lights.size()):
		_lights[i].light_energy = 0.0
	for k in _mm:
		for part in _mm[k]:
			part[0].multimesh.visible_instance_count = counts.get(k, 0)
