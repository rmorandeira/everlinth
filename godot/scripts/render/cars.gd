class_name Cars
extends Node3D
## Coches aparcados destructibles (puerto de cars3d.ts). Una MultiMesh por pieza para
## todos los coches; el daño de cada coche se guarda por su posición global, así se
## conserva al cambiar de sala. Impactos cosméticos (la bala del servidor no se para):
## sacudida, pierde ruedas (salen rodando y se hunde), salta el capó, explota (luz,
## bolas de fuego, restos) y queda calcinado ardiendo un rato.

const CAR_HP := 12
const L := 1.5
const W := 0.62
const BURNT := Color("2a2522")
const MAX := 400
const PARTS := {
	"body": [Vector3(L, 0.3, W), Vector3(0, 0.21, 0)],
	"under": [Vector3(L * 1.01, 0.09, W * 1.02), Vector3(0, 0.09, 0)],
	"cabin": [Vector3(0.8, 0.26, W * 0.9), Vector3(-0.05, 0.49, 0)],
	"glass": [Vector3(0.82, 0.16, W * 0.93), Vector3(-0.05, 0.48, 0)],
	"hood": [Vector3(0.46, 0.03, W * 0.94), Vector3(0.5, 0.375, 0)],
}
const WHEEL_POS := [Vector3(0.48, 0.11, W / 2.0), Vector3(0.48, 0.11, -W / 2.0), Vector3(-0.48, 0.11, W / 2.0), Vector3(-0.48, 0.11, -W / 2.0)]

var fx: Fx
var _meshes := {}
var _wheels := MultiMeshInstance3D.new()
var _wheel_mesh: CylinderMesh
var _dark := StandardMaterial3D.new()
var _state := {} # clave -> coche (persiste entre salas)
var _cars: Array = []
var _debris: Array = [] # { node, v, spin, rest }


func _ready() -> void:
	var paint := StandardMaterial3D.new()
	paint.vertex_color_use_as_albedo = true
	paint.roughness = 0.5
	_dark.albedo_color = Color("1a1a1a")
	var glass := StandardMaterial3D.new()
	glass.albedo_color = Color("26323f")
	glass.roughness = 0.2
	for k in PARTS:
		var box := BoxMesh.new()
		box.size = PARTS[k][0]
		box.material = _dark if k == "under" else (glass if k == "glass" else paint)
		var mmi := MultiMeshInstance3D.new()
		mmi.multimesh = _new_mm(box, true)
		mmi.custom_aabb = AABB(Vector3(-1000, -10, -1000), Vector3(2000, 40, 2000))
		add_child(mmi)
		_meshes[k] = mmi
	_wheel_mesh = CylinderMesh.new()
	_wheel_mesh.top_radius = 0.11
	_wheel_mesh.bottom_radius = 0.11
	_wheel_mesh.height = 0.08
	_wheel_mesh.radial_segments = 12
	_wheel_mesh.material = _dark
	_wheels.multimesh = _new_mm(_wheel_mesh, false, MAX * 4)
	_wheels.custom_aabb = AABB(Vector3(-1000, -10, -1000), Vector3(2000, 40, 2000))
	add_child(_wheels)


func _new_mm(mesh: Mesh, colors: bool, cap := MAX) -> MultiMesh:
	var mm := MultiMesh.new()
	mm.transform_format = MultiMesh.TRANSFORM_3D
	mm.use_colors = colors
	mm.mesh = mesh
	mm.instance_count = cap
	mm.visible_instance_count = 0
	return mm


## specs: [{ key, x, z, ang, color }] (unidades de render de la escena actual).
func set_cars(specs: Array) -> void:
	_cars.clear()
	for sp in specs:
		var c: Dictionary = _state.get(sp.key, {})
		if c.is_empty():
			c = {"hp": CAR_HP, "shake": 0.0, "wheels": [true, true, true, true], "hood": true, "burnt": false, "burn_t": 0.0, "tilt": Vector2.ZERO, "color": sp.color, "ang": sp.ang}
			_state[sp.key] = c
		c.x = sp.x
		c.z = sp.z
		_cars.append(c)


func _world_of(c: Dictionary, local: Vector3) -> Vector3:
	var cs := cos(c.ang)
	var sn := sin(c.ang)
	return Vector3(c.x + local.x * cs - local.z * sn, local.y + 0.05, c.z + local.x * sn + local.z * cs)


func _spawn_debris(mesh: Mesh, mat: Material, pos: Vector3, rot: float, v: Vector3) -> void:
	var mi := MeshInstance3D.new()
	mi.mesh = mesh
	mi.material_override = mat
	mi.position = pos
	mi.rotation.y = rot
	add_child(mi)
	_debris.append({"node": mi, "v": v, "spin": Vector3((randf() - 0.5) * 12, (randf() - 0.5) * 6, (randf() - 0.5) * 12), "rest": false})
	if _debris.size() > 120:
		var old: Dictionary = _debris.pop_front()
		old.node.queue_free()


func _hood_mesh() -> BoxMesh:
	var b := BoxMesh.new()
	b.size = PARTS.hood[0]
	return b


func _explode(c: Dictionary) -> void:
	c.burnt = true
	c.burn_t = 14.0
	fx.explosion(Vector3(c.x, 0.0, c.z))
	for i in 4:
		if c.wheels[i]:
			c.wheels[i] = false
			_spawn_debris(_wheel_mesh, _dark, _world_of(c, WHEEL_POS[i]), c.ang, Vector3((randf() - 0.5) * 5, 3 + randf() * 3, (randf() - 0.5) * 5))
	if c.hood:
		c.hood = false
		var m := StandardMaterial3D.new()
		m.albedo_color = BURNT
		_spawn_debris(_hood_mesh(), m, _world_of(c, Vector3(0.5, 0.4, 0)), c.ang, Vector3((randf() - 0.5) * 3, 7, (randf() - 0.5) * 3))
	c.tilt = Vector2.ZERO


func _damage(c: Dictionary) -> void:
	if c.burnt:
		c.shake = minf(1.0, c.shake + 0.3)
		return
	c.hp -= 1
	c.shake = 1.0
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
			_spawn_debris(_wheel_mesh, _dark, _world_of(c, WHEEL_POS[i]), c.ang, Vector3(-sn * side * 2.2, 1.2, cs * side * 2.2))
			var t: Vector2 = c.tilt
			t.x += -0.08 if WHEEL_POS[i].x > 0 else 0.08
			t.y += side * 0.1
			c.tilt = t
	if c.hp == 3 and c.hood:
		c.hood = false
		var m := StandardMaterial3D.new()
		m.albedo_color = c.color
		_spawn_debris(_hood_mesh(), m, _world_of(c, Vector3(0.5, 0.4, 0)), c.ang, Vector3((randf() - 0.5) * 1.5, 5.5, (randf() - 0.5) * 1.5))
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
	var n := 0
	var nw := 0
	var wm := _wheels.multimesh
	for c in _cars:
		if n >= MAX:
			break
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
		var car := Transform3D(basis, Vector3(c.x + sx * 0.2, 0.05 - lost * 0.025 - (0.07 if c.burnt else 0.0), c.z + sz * 0.2))
		var col: Color = BURNT if c.burnt else c.color
		for k in PARTS:
			var mm: MultiMesh = _meshes[k].multimesh
			var p: Vector3 = PARTS[k][1]
			if k == "hood" and not c.hood:
				mm.set_instance_transform(n, car * Transform3D(Basis(), p - Vector3(0, 0.02, 0)))
				mm.set_instance_color(n, Color("1c1c1c"))
				continue
			mm.set_instance_transform(n, car * Transform3D(Basis(), p))
			if mm.use_colors:
				mm.set_instance_color(n, col)
		for i in 4:
			if c.wheels[i]:
				wm.set_instance_transform(nw, car * Transform3D(Basis(Vector3.RIGHT, PI / 2.0), WHEEL_POS[i]))
				nw += 1
		n += 1
		if c.burn_t > 0.0:
			c.burn_t -= dt
			if randf() < dt * 14.0:
				fx.emit(Vector3(c.x + (randf() - 0.5) * 0.9, 0.45, c.z + (randf() - 0.5) * 0.5), Vector3(0, 1.4, 0), 0.5 + randf() * 0.4, 0.4, 0.2, 1.0, 1, Color("ff9a40"), true, 0.0)
			if randf() < dt * 5.0:
				fx.emit(Vector3(c.x, 0.8, c.z), Vector3(0, 0.9, 0), 3.0 + randf() * 2.0, 0.6, 2.4, 0.55, 0, Color("3c3a37"), false)
	for k in _meshes:
		_meshes[k].multimesh.visible_instance_count = n
	wm.visible_instance_count = nw

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
