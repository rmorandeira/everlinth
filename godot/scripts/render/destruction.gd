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


# suelo de los cascotes: plano horizontal a la altura del último derrumbe (relieve)
var _ground := StaticBody3D.new()
var _ground_shape: WorldBoundaryShape3D


func _ready() -> void:
	var ground := _ground
	_ground_shape = WorldBoundaryShape3D.new()
	var shape := CollisionShape3D.new()
	var plane := _ground_shape
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
	# ocultar la instancia de la MultiMesh (o el nodo suelto) y animar copias sueltas
	for r in b.refs:
		if r is Callable:
			(r as Callable).call() # edificios fundidos por sala: se rehace la malla sin él
		elif r is Node3D:
			(r as Node3D).visible = false
		else:
			var mm: MultiMesh = r[0]
			mm.set_instance_transform(r[1], Transform3D(Basis.from_scale(Vector3.ZERO), Vector3(0, -100, 0)))
	var base_y: float = b.pos.y
	_ground_shape.plane = Plane(Vector3.UP, base_y)
	var plan := City.collapse_plan(str(b.id), b.pts)
	var h: float = b.height
	var d2: Vector2 = plan.dir
	var dir := Vector3(d2.x, 0, d2.y)
	var c2: Vector2 = plan.center
	var pieces: Array = []
	match int(plan.mode):
		0:
			pieces.append(_piece(b, "sink", 0.0, Vector3.ZERO, Vector3.ZERO))
		1:
			var piv := Vector3(c2.x, base_y, c2.y) + dir * float(plan.edge)
			pieces.append(_piece(b, "topple", 0.0, piv, Vector3.ZERO))
		2:
			var cut_y: float = base_y + h * float(plan.cut)
			var piv := Vector3(c2.x, cut_y, c2.y) + dir * float(plan.edge)
			var cut_p := Vector3(c2.x, cut_y, c2.y)
			var low := _piece(b, "sink", 0.7, Vector3.ZERO, Vector3.ZERO)
			low.clip = [Vector3.UP, cut_p] # se quita lo de encima del corte
			pieces.append(low)
			var top := _piece(b, "top", 0.0, piv, Vector3.ZERO)
			top.clip = [Vector3.DOWN, cut_p] # se quita lo de debajo del corte
			top.cut_h = cut_y - base_y
			pieces.append(top)
	_collapsing.append({"t": 0.0, "info": b, "plan": plan, "dir": dir, "pieces": pieces, "impact": false})
	_dust(b, 26)
	_spawn_debris(b, 20, Vector3.ZERO)
	if fx:
		fx.explosion(b.pos)


func _piece(b: Dictionary, anim: String, delay: float, pivot: Vector3, _unused: Vector3) -> Dictionary:
	var node := Node3D.new()
	add_child(node)
	for p in b.parts:
		var mi := MeshInstance3D.new()
		mi.mesh = p[0]
		mi.transform = p[1]
		node.add_child(mi)
	node.transform = b.xf
	return {"node": node, "base": b.xf, "anim": anim, "delay": delay, "pivot": pivot, "clip": null, "cut_h": 0.0}


## Transformación de una pieza en el instante t (y si ya ha terminado).
func _piece_xf(p: Dictionary, t: float, h: float, dir: Vector3) -> Array:
	var base: Transform3D = p.base
	var tt := t - float(p.delay)
	match p.anim:
		"sink":
			var shake := 0.035 * (1.0 - clampf(tt / SINK_TIME, 0.0, 1.0))
			var k := clampf(tt / SINK_TIME, 0.0, 1.0)
			var xf := base
			xf.origin += Vector3(sin(t * 70.0) * shake, -k * k * h * 1.02, cos(t * 63.0) * shake)
			return [xf, tt >= SINK_TIME]
		"topple", "top":
			var axis := Vector3.UP.cross(dir).normalized()
			var fall_t := 1.6 if p.anim == "topple" else 1.3
			var e := clampf(tt / fall_t, 0.0, 1.0)
			var ang := (PI * 0.47 if p.anim == "topple" else PI * 0.62) * e * e
			var piv: Vector3 = p.pivot
			var rot := Transform3D(Basis(axis, ang), Vector3.ZERO)
			var xf := Transform3D(Basis(), piv) * rot * Transform3D(Basis(), -piv) * base
			if p.anim == "top":
				# el trozo se desprende: además de girar, cae hasta el suelo
				var drop := minf(float(p.cut_h), 6.0 * maxf(0.0, tt - 0.35) * maxf(0.0, tt - 0.35))
				xf.origin.y -= drop
			# ya tumbado: se hunde en el suelo (los escombros ocupan su lugar)
			var s := clampf((tt - fall_t - 0.3) / 0.9, 0.0, 1.0)
			xf.origin.y -= s * s * maxf(1.2, h * 0.5)
			return [xf, tt >= fall_t + 1.2]
	return [base, true]


func _dust(b: Dictionary, n: int) -> void:
	if fx == null:
		return
	var pts: PackedVector2Array = b.pts
	for i in n:
		var p := pts[randi() % pts.size()].lerp(Vector2(b.pos.x, b.pos.z), randf() * 0.6)
		var up := randf() * minf(2.5, b.height)
		fx.emit(Vector3(p.x, 0.1 + up * 0.3, p.y), Vector3((randf() - 0.5) * 1.6, 0.3 + randf() * 0.6, (randf() - 0.5) * 1.6), 3.0 + randf() * 3.0, 0.6, 2.6 + randf() * 1.8, 0.7, 0, Color("b9b3a8"), false, 0.02)


func _spawn_debris(b: Dictionary, n: int, bias: Vector3) -> void:
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
		body.linear_velocity = Vector3(out.x * (1.0 + randf() * 3.0), randf() * 3.0, out.y * (1.0 + randf() * 3.0)) + bias * (1.0 + randf() * 3.0)
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
		var b: Dictionary = c.info
		var h: float = b.height
		var dir: Vector3 = c.dir
		var all_done := true
		for p in c.pieces:
			var r := _piece_xf(p, c.t, h, dir)
			var xf: Transform3D = r[0]
			p.node.transform = xf
			if not r[1]:
				all_done = false
			if p.clip != null:
				var delta: Transform3D = xf * (p.base as Transform3D).affine_inverse()
				var n: Vector3 = (delta.basis * (p.clip[0] as Vector3)).normalized()
				var pw: Vector3 = delta * (p.clip[1] as Vector3)
				for mi in p.node.get_children():
					(mi as GeometryInstance3D).set_instance_shader_parameter("clip_plane", Vector4(n.x, n.y, n.z, n.dot(pw)))
		# golpe contra el suelo de lo que cae de lado: polvo a lo largo y cascotes
		if int(c.plan.mode) != 0 and not c.impact and c.t > (1.5 if int(c.plan.mode) == 1 else 1.2):
			c.impact = true
			var start: Vector2 = c.plan.center + c.plan.dir * float(c.plan.edge)
			var length: float = h * (0.85 if int(c.plan.mode) == 1 else (1.0 - float(c.plan.cut)))
			if fx:
				for k in 30:
					var q: Vector2 = start + c.plan.dir * (randf() * length)
					fx.emit(Vector3(q.x, 0.15, q.y), Vector3((randf() - 0.5) * 2.0, 0.4 + randf() * 0.5, (randf() - 0.5) * 2.0), 3.0 + randf() * 3.0, 0.7, 3.0 + randf() * 1.5, 0.75, 0, Color("b9b3a8"), false, 0.02)
			_spawn_debris(b, 18, dir * 1.5)
		if randf() < dt * 20.0:
			_dust(b, 2)
		if randf() < dt * 8.0:
			_spawn_debris(b, 1, dir * (0.0 if int(c.plan.mode) == 0 else 0.8))
		if all_done:
			for p in c.pieces:
				p.node.queue_free()
			var mi := MeshInstance3D.new()
			mi.mesh = City.rubble_mesh(b.pts, str(b.id), h)
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
