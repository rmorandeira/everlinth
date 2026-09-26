class_name Destruction
extends Node3D
## Edificios destructibles (el servidor decide el daño, ver server/src/buildings.ts):
## - dañados (menos de la mitad de vida): columna de humo; muy dañados: además fuego;
## - derrumbe: el edificio tiembla y se hunde entre nubes de polvo mientras salen
##   despedidos cascotes con física (Jolt), y deja un montón de escombros.
## Los edificios de la ciudad se dibujan con MultiMesh; para derrumbar uno se oculta su
## instancia y se anima una copia suelta.

const SINK_TIME := 2.4
const MAX_DEBRIS := 160
const DEBRIS_COLORS := [Color("c9c8cf"), Color("9a9fab"), Color("6b7080"), Color("4a4d57"), Color("b8b2a6")]

var fx: Fx
var buildings := {} # id -> info (ver City: pos, height, pts, refs, parts, xf, hp, max_hp)
var _collapsing: Array = [] # { node, t, height, base, info }
var _debris: Array = [] # { body, t }
var _emit_acc := 0.0
var _debris_mats: Array[StandardMaterial3D] = []


func _ready() -> void:
	var ground := StaticBody3D.new()
	var shape := CollisionShape3D.new()
	var plane := WorldBoundaryShape3D.new()
	plane.plane = Plane(Vector3.UP, 0.05)
	shape.shape = plane
	ground.add_child(shape)
	add_child(ground)
	for c in DEBRIS_COLORS:
		var m := StandardMaterial3D.new()
		m.albedo_color = c
		m.roughness = 0.95
		_debris_mats.append(m)


func set_buildings(info: Dictionary) -> void:
	buildings = info


## Mensaje del servidor: nuevo escalón de daño o derrumbe (hp 0).
func on_damage(id: String, hp: float, max_hp: float) -> void:
	var b: Dictionary = buildings.get(id, {})
	if b.is_empty():
		return
	var was: float = b.get("hp", max_hp)
	b.hp = hp
	b.max_hp = max_hp
	if hp <= 0.0 and was > 0.0:
		_collapse(b)


func _collapse(b: Dictionary) -> void:
	# ocultar la instancia de la MultiMesh (o el nodo suelto) y animar una copia
	for r in b.refs:
		if r is Node3D:
			(r as Node3D).visible = false
		else:
			var mm: MultiMesh = r[0]
			mm.set_instance_transform(r[1], Transform3D(Basis.from_scale(Vector3.ZERO), Vector3(0, -100, 0)))
	var node := Node3D.new()
	add_child(node)
	for p in b.parts:
		var mi := MeshInstance3D.new()
		mi.mesh = p[0]
		mi.transform = p[1]
		node.add_child(mi)
	var base: Transform3D = b.xf
	node.transform = base
	_collapsing.append({"node": node, "t": 0.0, "height": b.height, "base": base, "info": b})
	# primera nube de polvo y lluvia de cascotes
	_dust(b, 26)
	_spawn_debris(b, 26)
	if fx:
		fx.explosion(b.pos)


func _dust(b: Dictionary, n: int) -> void:
	if fx == null:
		return
	var pts: PackedVector2Array = b.pts
	for i in n:
		var p := pts[randi() % pts.size()].lerp(Vector2(b.pos.x, b.pos.z), randf() * 0.6)
		var up := randf() * minf(2.5, b.height)
		fx.emit(Vector3(p.x, 0.1 + up * 0.3, p.y), Vector3((randf() - 0.5) * 1.6, 0.3 + randf() * 0.6, (randf() - 0.5) * 1.6), 3.0 + randf() * 3.0, 0.6, 2.6 + randf() * 1.8, 0.7, 0, Color("b9b3a8"), false, 0.02)


func _spawn_debris(b: Dictionary, n: int) -> void:
	var pts: PackedVector2Array = b.pts
	for i in n:
		var s := Vector3(0.08 + randf() * 0.22, 0.06 + randf() * 0.14, 0.08 + randf() * 0.2)
		var body := RigidBody3D.new()
		var col := CollisionShape3D.new()
		var box := BoxShape3D.new()
		box.size = s
		col.shape = box
		body.add_child(col)
		var mi := MeshInstance3D.new()
		var bm := BoxMesh.new()
		bm.size = s
		mi.mesh = bm
		mi.material_override = _debris_mats[randi() % _debris_mats.size()]
		body.add_child(mi)
		body.mass = s.x * s.y * s.z * 400.0
		var edge := pts[randi() % pts.size()]
		var c := Vector2(b.pos.x, b.pos.z)
		var out := (edge - c).normalized()
		var h: float = randf() * b.height
		body.position = Vector3(edge.x, 0.1 + h, edge.y)
		body.linear_velocity = Vector3(out.x * (1.0 + randf() * 3.0), randf() * 3.0, out.y * (1.0 + randf() * 3.0))
		body.angular_velocity = Vector3(randf() - 0.5, randf() - 0.5, randf() - 0.5) * 12.0
		add_child(body)
		_debris.append({"body": body, "t": 0.0})
	while _debris.size() > MAX_DEBRIS:
		var old: Dictionary = _debris.pop_front()
		old.body.queue_free()


func _process(dt: float) -> void:
	# derrumbes en curso
	var i := _collapsing.size() - 1
	while i >= 0:
		var c: Dictionary = _collapsing[i]
		c.t += dt
		var k := clampf(c.t / SINK_TIME, 0.0, 1.0)
		var sink: float = k * k * (c.height * 1.02)
		var shake: float = (1.0 - k) * 0.035
		var base: Transform3D = c.base
		var xf := base
		xf.origin += Vector3(sin(c.t * 70.0) * shake, -sink, cos(c.t * 63.0) * shake)
		xf.basis = Basis(Vector3(1, 0, 0), sin(c.t * 3.0) * 0.03 * k) * base.basis
		c.node.transform = xf
		if randf() < dt * 20.0:
			_dust(c.info, 2)
		if randf() < dt * 8.0:
			_spawn_debris(c.info, 1)
		if k >= 1.0:
			c.node.queue_free()
			var rubble := City.rubble_mesh(c.info.pts, str(c.info.id))
			var mi := MeshInstance3D.new()
			mi.mesh = rubble
			add_child(mi)
			_collapsing.remove_at(i)
		i -= 1
	# cascotes: se congelan al rato (ya no gastan física)
	for d in _debris:
		d.t += dt
		if d.t > 10.0 and not d.body.freeze:
			d.body.freeze = true
	# humo y fuego de los edificios dañados cercanos a la cámara
	_emit_acc += dt
	if _emit_acc < 0.1 or fx == null:
		return
	var step := _emit_acc
	_emit_acc = 0.0
	for id in buildings:
		var b: Dictionary = buildings[id]
		if not b.has("hp") or b.hp <= 0.0 or b.max_hp <= 0.0:
			continue
		var f: float = b.hp / b.max_hp
		if f > 0.5:
			continue
		var top: Vector3 = b.pos + Vector3(0, b.height * 0.9, 0)
		if randf() < step * (6.0 * (1.0 - f)):
			fx.emit(top + Vector3((randf() - 0.5) * 0.4, 0, (randf() - 0.5) * 0.4), Vector3(0.1, 0.8, 0.05), 4.0 + randf() * 2.0, 0.5, 2.8, 0.55, 0, Color("3c3a37"), false, 0.05)
		if f < 0.25 and randf() < step * 10.0:
			var pts: PackedVector2Array = b.pts
			var e := pts[randi() % pts.size()].lerp(Vector2(b.pos.x, b.pos.z), 0.2)
			fx.emit(Vector3(e.x, randf() * b.height * 0.8 + 0.2, e.y), Vector3(0, 0.9, 0), 0.5 + randf() * 0.4, 0.35, 0.15, 1.0, 1, Color("ff9a40"), true, 0.0)
