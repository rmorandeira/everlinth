class_name Cars
extends Node3D
## Coches aparcados destructibles con los modelos del Car Kit de Kenney (CC0): una
## MultiMesh por pieza de cada modelo (carrocería y cada rueda) para todos los coches.
## El daño de cada coche se guarda por su posición global (se conserva al cambiar de
## sala). Impactos cosméticos (la bala del servidor no se para): sacudida, pierde ruedas
## (salen rodando y el coche se hunde de ese lado), salta alguna pieza, explota (luz,
## bolas de fuego, puertas, parachoques y ruedas por el aire) y queda calcinado ardiendo.

const CAR_HP := 12
const L := 1.5 # largo (unidades) para los impactos
const W := 0.62
const BURNT := Color(0.22, 0.2, 0.19)
const MAX := 300
const MODELS := ["cars/sedan", "cars/sedan-sports", "cars/hatchback-sports", "cars/suv", "cars/suv-luxury", "cars/taxi", "cars/van", "cars/delivery"]
# ruedas por nombre de pieza del Car Kit → índice (delantera izq/dcha, trasera izq/dcha)
const WHEELS := {"wheel-front-left": 0, "wheel-front-right": 1, "wheel-back-left": 2, "wheel-back-right": 3}
const WHEEL_POS := [Vector3(0.48, 0.11, W / 2.0), Vector3(0.48, 0.11, -W / 2.0), Vector3(-0.48, 0.11, W / 2.0), Vector3(-0.48, 0.11, -W / 2.0)]
const DEBRIS := ["cars/debris-door", "cars/debris-door-window", "cars/debris-bumper", "cars/debris-plate-a", "cars/debris-plate-b", "cars/debris-plate-small-a", "cars/debris-spoiler-a", "cars/debris-tire"]

var fx: Fx
## Punto de la cámara (unidades de render): solo se dibujan los coches cercanos.
var focus := Vector3.ZERO
const DRAW_DIST := 20.0
var _mm := {} # modelo -> [[MultiMeshInstance3D, Transform3D de la pieza, índice de rueda o -1], ...]
var _state := {} # clave -> coche (persiste entre salas)
var _cars: Array = []
var _debris: Array = [] # { node, v, spin, rest }


func _parts(model: String) -> Array:
	if _mm.has(model):
		return _mm[model]
	var out: Array = []
	var m := Kenney.model(model)
	if not m.is_empty():
		for p in m.parts:
			var mm := MultiMesh.new()
			mm.transform_format = MultiMesh.TRANSFORM_3D
			mm.use_colors = true
			mm.mesh = p[0]
			mm.instance_count = MAX
			mm.visible_instance_count = 0
			var mmi := MultiMeshInstance3D.new()
			mmi.multimesh = mm
			mmi.custom_aabb = AABB(Vector3(-1000, -10, -1000), Vector3(2000, 40, 2000))
			add_child(mmi)
			out.append([mmi, p[1], WHEELS.get(str(p[2]) if p.size() > 2 else "", -1), p[0]])
	_mm[model] = out
	return out


## specs: [{ key, x, z, ang, color }] (unidades de render de la escena actual).
func set_cars(specs: Array) -> void:
	_cars.clear()
	for sp in specs:
		var c: Dictionary = _state.get(sp.key, {})
		if c.is_empty():
			c = {"hp": CAR_HP, "shake": 0.0, "wheels": [true, true, true, true], "hood": true, "burnt": false, "burn_t": 0.0, "tilt": Vector2.ZERO, "ang": sp.ang,
				"model": MODELS[absi(hash(sp.key)) % MODELS.size()]}
			_state[sp.key] = c
		c.x = sp.x
		c.z = sp.z
		_cars.append(c)


func _world_of(c: Dictionary, local: Vector3) -> Vector3:
	var cs := cos(c.ang)
	var sn := sin(c.ang)
	return Vector3(c.x + local.x * cs - local.z * sn, local.y + 0.05, c.z + local.x * sn + local.z * cs)


func _spawn_debris(mesh: Mesh, pos: Vector3, rot: float, v: Vector3, scale := 1.0, tint := Color.WHITE) -> void:
	var mi := MeshInstance3D.new()
	mi.mesh = mesh
	mi.position = pos
	mi.rotation.y = rot
	mi.scale = Vector3.ONE * scale
	if tint != Color.WHITE:
		var m := StandardMaterial3D.new()
		m.albedo_color = tint
		mi.material_override = m
	add_child(mi)
	_debris.append({"node": mi, "v": v, "spin": Vector3((randf() - 0.5) * 12, (randf() - 0.5) * 6, (randf() - 0.5) * 12), "rest": false})
	if _debris.size() > 120:
		var old: Dictionary = _debris.pop_front()
		old.node.queue_free()


func _kit_piece(name: String) -> Mesh:
	var m := Kenney.model(name)
	return m.parts[0][0] if not m.is_empty() else null


func _wheel_mesh(c: Dictionary, i: int) -> Mesh:
	for p in _parts(c.model):
		if p[2] == i:
			return p[3]
	return _kit_piece("cars/debris-tire")


func _explode(c: Dictionary) -> void:
	c.burnt = true
	c.burn_t = 14.0
	fx.explosion(Vector3(c.x, 0.0, c.z))
	var ks := Kenney.base_scale("cars/sedan")
	for i in 4:
		if c.wheels[i]:
			c.wheels[i] = false
			var wm := _wheel_mesh(c, i)
			if wm:
				_spawn_debris(wm, _world_of(c, WHEEL_POS[i]), c.ang, Vector3((randf() - 0.5) * 5, 3 + randf() * 3, (randf() - 0.5) * 5), ks)
	for k in 3:
		var piece := _kit_piece(DEBRIS[randi() % DEBRIS.size()])
		if piece:
			_spawn_debris(piece, _world_of(c, Vector3(randf_range(-0.5, 0.5), 0.4, randf_range(-0.2, 0.2))), randf() * TAU, Vector3((randf() - 0.5) * 4, 5 + randf() * 3, (randf() - 0.5) * 4), ks, BURNT)
	c.tilt = Vector2.ZERO


func _damage(c: Dictionary) -> void:
	if c.burnt:
		c.shake = minf(1.0, c.shake + 0.3)
		return
	c.hp -= 1
	c.shake = 1.0
	var ks := Kenney.base_scale("cars/sedan")
	if c.hp == 8 or c.hp == 5:
		var left: Array = []
		for i in 4:
			if c.wheels[i]:
				left.append(i)
		if not left.is_empty():
			var i: int = left[randi() % left.size()]
			c.wheels[i] = false
			var side := 1.0 if WHEEL_POS[i].z > 0 else -1.0
			var cs := cos(c.ang)
			var sn := sin(c.ang)
			var wm := _wheel_mesh(c, i)
			if wm:
				_spawn_debris(wm, _world_of(c, WHEEL_POS[i]), c.ang, Vector3(-sn * side * 2.2, 1.2, cs * side * 2.2), ks)
			var t: Vector2 = c.tilt
			t.x += -0.08 if WHEEL_POS[i].x > 0 else 0.08
			t.y += side * 0.1
			c.tilt = t
	if c.hp == 3 and c.hood:
		# salta una pieza de chapa y empieza a humear
		c.hood = false
		var piece := _kit_piece("cars/debris-plate-a")
		if piece:
			_spawn_debris(piece, _world_of(c, Vector3(0.5, 0.4, 0)), c.ang, Vector3((randf() - 0.5) * 1.5, 5.5, (randf() - 0.5) * 1.5), ks)
		fx.emit(_world_of(c, Vector3(0.5, 0.45, 0)), Vector3(0, 0.5, 0), 2.5, 0.4, 1.4, 0.55, 0, Color("3c3a37"), false)
	if c.hp <= 0:
		_explode(c)


## Bala de (x0, z0) a (x1, z1) (render): daña el primer coche que atraviesa.
func hit(x0: float, z0: float, x1: float, z1: float) -> void:
	var dx := x1 - x0
	var dz := z1 - z0
	var length := sqrt(dx * dx + dz * dz)
	if length < 1e-4:
		return
	var ux := dx / length
	var uz := dz / length
	var best: Dictionary = {}
	var best_t := length + 0.3
	for c in _cars:
		var cs := cos(-c.ang)
		var sn := sin(-c.ang)
		var ox: float = (x0 - c.x) * cs - (z0 - c.z) * sn
		var oz: float = (x0 - c.x) * sn + (z0 - c.z) * cs
		var lx := ux * cs - uz * sn
		var lz := ux * sn + uz * cs
		var tmin := 0.0
		var tmax := best_t
		for a in [[ox, lx, L / 2.0 + 0.05], [oz, lz, W / 2.0 + 0.05]]:
			var o: float = a[0]
			var d: float = a[1]
			var h: float = a[2]
			if absf(d) < 1e-6:
				if absf(o) > h:
					tmax = -1.0
			else:
				var t1 := (-h - o) / d
				var t2 := (h - o) / d
				if t1 > t2:
					var tmp := t1
					t1 = t2
					t2 = tmp
				tmin = maxf(tmin, t1)
				tmax = minf(tmax, t2)
		if tmax >= tmin and tmin < best_t:
			best_t = tmin
			best = c
	if not best.is_empty():
		_damage(best)


func _process(dt: float) -> void:
	var time := Time.get_ticks_msec() / 1000.0
	var counts := {}
	var hidden := Transform3D(Basis.from_scale(Vector3.ZERO), Vector3(0, -100, 0))
	for c in _cars:
		if absf(c.x - focus.x) > DRAW_DIST or absf(c.z - focus.z) > DRAW_DIST:
			if c.burn_t > 0.0:
				c.burn_t -= dt
			continue
		c.shake = maxf(0.0, c.shake - dt * 4.0)
		var jig: float = c.shake * 0.06
		var sx: float = sin(time * 60.0 + c.x) * jig
		var sz: float = cos(time * 53.0 + c.z) * jig
		var lost := 0
		for w in c.wheels:
			if not w:
				lost += 1
		var tilt: Vector2 = c.tilt
		var basis := Basis(Vector3.UP, -c.ang) * Basis.from_euler(Vector3(tilt.y + sz * 0.8, 0, tilt.x + sx * 0.8), EULER_ORDER_XYZ)
		var car := Transform3D(basis, Vector3(c.x + sx * 0.2, 0.05 - lost * 0.025 - (0.05 if c.burnt else 0.0), c.z + sz * 0.2))
		# el eje largo del coche es +X local; el modelo del kit mira a +Z
		var s := Kenney.base_scale(c.model)
		var model_xf := car * Transform3D(Basis(Vector3.UP, PI / 2.0).scaled(Vector3(s, s, s)), Vector3.ZERO)
		var n: int = counts.get(c.model, 0)
		if n >= MAX:
			continue
		var tint: Color = BURNT if c.burnt else Color.WHITE
		for p in _parts(c.model):
			var mm: MultiMesh = p[0].multimesh
			var wi: int = p[2]
			if wi >= 0 and not c.wheels[wi]:
				mm.set_instance_transform(n, hidden)
			else:
				mm.set_instance_transform(n, model_xf * (p[1] as Transform3D))
			mm.set_instance_color(n, tint)
		counts[c.model] = n + 1
		if c.burn_t > 0.0:
			c.burn_t -= dt
			if randf() < dt * 14.0:
				fx.emit(Vector3(c.x + (randf() - 0.5) * 0.9, 0.45, c.z + (randf() - 0.5) * 0.5), Vector3(0, 1.4, 0), 0.5 + randf() * 0.4, 0.4, 0.2, 1.0, 1, Color("ff9a40"), true, 0.0)
			if randf() < dt * 5.0:
				fx.emit(Vector3(c.x, 0.8, c.z), Vector3(0, 0.9, 0), 3.0 + randf() * 2.0, 0.6, 2.4, 0.55, 0, Color("3c3a37"), false)
	for k in _mm:
		for p in _mm[k]:
			p[0].multimesh.visible_instance_count = counts.get(k, 0)

	for d in _debris:
		if d.rest:
			continue
		var v: Vector3 = d.v
		v.y -= 14.0 * dt
		var node: Node3D = d.node
		node.position += v * dt
		node.rotation += d.spin * dt
		if node.position.y < 0.1:
			node.position.y = 0.1
			v = Vector3(v.x * 0.7, absf(v.y) * 0.35, v.z * 0.7)
			d.spin = d.spin * 0.6
			if v.length() < 0.4:
				d.rest = true
		d.v = v
