class_name TreeFall
extends Node3D
## Árboles que se rompen a balazos (en el cliente, como los coches: cada cliente recibe
## los mismos disparos y llega al mismo resultado):
## - cada bala que pasa por el tronco suelta astillas de corteza y una lluvia de hojas;
## - al acumular bastantes impactos (según la especie y el tamaño), el tronco se parte:
##   queda un tocón astillado y la copa se desploma en la dirección del disparo,
##   acelerando como al caer de verdad, rebota un poco y se queda tumbada.
## Los árboles vuelven a estar enteros al recargar la zona (no se guarda en el servidor).

const TRUNK_R := 0.22        # radio de impacto alrededor del tronco (unidades)
const HIT_Y := 0.4           # altura de las balas
const HP := {"platano": 9.0, "roble": 11.0, "haya": 7.0, "pino": 8.0, "tamarisco": 4.0}
const BREAK_Y := 0.28        # altura del corte (unidades, antes de escalar)
const FALL_T := 1.5          # segundos de caída

var fx: Fx
var _trees: Array = []       # { key, mm, i, xf, hp, pos (Vector3) }
var _falling: Array = []     # { node, pivot, axis, t, angle }


func set_trees(list: Array) -> void:
	_trees.clear()
	# zona nueva: fuera tocones y árboles caídos de la anterior
	for c in get_children():
		c.queue_free()
	_falling.clear()
	for t in list:
		var e: Dictionary = t.duplicate()
		var xf: Transform3D = e.xf
		var sc := xf.basis.get_scale().x
		var sp: String = str(e.key).split(":")[1]
		e.hp = float(HP.get(sp, 8.0)) * (0.6 + 0.6 * sc)
		e.pos = xf.origin
		_trees.append(e)


## Árbol entero más cercano (pruebas).
func nearest(p: Vector3) -> Vector3:
	var best := Vector3.INF
	var bd := INF
	for t in _trees:
		if t.hp > 0.0 and (t.pos as Vector3).distance_to(p) < bd:
			bd = (t.pos as Vector3).distance_to(p)
			best = t.pos
	return best


## Bala de (x0, z0) a (x1, z1) (unidades de render): daña los árboles cuyo tronco cruza.
func hit(x0: float, z0: float, x1: float, z1: float) -> void:
	var a := Vector2(x0, z0)
	var b := Vector2(x1, z1)
	var dir := (b - a).normalized()
	for t in _trees:
		if t.hp <= 0.0:
			continue
		var p := Vector2(t.pos.x, t.pos.z)
		var q := Geometry2D.get_closest_point_to_segment(p, a, b)
		var sc: float = (t.xf as Transform3D).basis.get_scale().x
		if p.distance_to(q) > TRUNK_R * sc + 0.05:
			continue
		# el tiro que empieza pegado al tronco (el propio tirador) no cuenta
		if p.distance_to(a) < 0.25:
			continue
		t.hp -= 1.0
		_chips(Vector3(q.x, t.pos.y + HIT_Y, q.y), dir, t)
		if t.hp <= 0.0:
			_break(t, dir)
		return # la bala se queda en el primer tronco


## Astillas de corteza en el impacto y hojas que caen de la copa.
func _chips(p: Vector3, dir: Vector2, t: Dictionary) -> void:
	if fx == null:
		return
	for i in 5:
		var v := Vector3(-dir.x * randf_range(0.4, 1.4) + randf_range(-0.6, 0.6), randf_range(0.6, 1.6), -dir.y * randf_range(0.4, 1.4) + randf_range(-0.6, 0.6))
		fx.emit(p, v, 0.5 + randf() * 0.4, 0.05, 0.04, 1.0, 0, Color("6b4f36"), false, 1.2)
	var sc: float = (t.xf as Transform3D).basis.get_scale().x
	for i in 6:
		var c: Vector3 = t.pos + Vector3(randf_range(-0.9, 0.9) * sc, randf_range(1.6, 2.8) * sc, randf_range(-0.9, 0.9) * sc)
		var v := Vector3(randf_range(-0.2, 0.2) + dir.x * 0.2, -randf_range(0.2, 0.5), randf_range(-0.2, 0.2) + dir.y * 0.2)
		fx.emit(c, v, 2.2 + randf() * 1.5, 0.06, 0.05, 0.9, 0, Color("5c7a34") if randf() < 0.7 else Color("8a8a3a"), false, 0.0)


## El tronco se parte: fuera la instancia, tocón en su sitio y copa que cae.
func _break(t: Dictionary, dir: Vector2) -> void:
	if Config.bench:
		print("árbol roto: %s" % t.key)
	var mm: MultiMesh = t.mm
	var xf: Transform3D = t.xf
	if is_instance_valid(mm):
		mm.set_instance_transform(t.i, Transform3D(Basis.from_scale(Vector3.ZERO), Vector3(0, -100, 0)))
	var sc := xf.basis.get_scale().x
	var cut_y := BREAK_Y * sc
	# tocón: el tronco hasta el corte, con la corteza de la especie y el corte claro
	var sp: String = str(t.key).split(":")[1]
	var bark: Material = Trees.bark_mat(str(Trees.SPECIES[sp].bark))
	var stump := MeshInstance3D.new()
	var cm := CylinderMesh.new()
	var r: float = float(Trees.SPECIES[sp].r) * sc
	cm.top_radius = r * 0.9
	cm.bottom_radius = r * 1.1
	cm.height = cut_y
	cm.radial_segments = 8
	cm.rings = 1
	cm.material = bark
	stump.mesh = cm
	stump.position = xf.origin + Vector3(0, cut_y * 0.5, 0)
	add_child(stump)
	var splinter := MeshInstance3D.new()
	var sm := CylinderMesh.new()
	sm.top_radius = 0.0
	sm.bottom_radius = r * 0.9
	sm.height = r * 1.6
	sm.radial_segments = 5
	sm.rings = 0
	var wood := StandardMaterial3D.new()
	wood.albedo_color = Color("c9a878")
	wood.roughness = 1.0
	sm.material = wood
	splinter.mesh = sm
	splinter.position = xf.origin + Vector3(r * 0.2, cut_y + r * 0.7, 0)
	splinter.rotation = Vector3(0.25, randf() * TAU, 0.2)
	add_child(splinter)
	# copa y tronco superior: el árbol entero, girando sobre el corte hacia donde iba la bala
	var node := Node3D.new()
	var pivot := xf.origin + Vector3(0, cut_y, 0)
	node.position = pivot
	add_child(node)
	var body := MeshInstance3D.new()
	body.mesh = Trees.mesh_for_key(str(t.key))
	body.transform = Transform3D(xf.basis, Vector3(0, -cut_y, 0))
	node.add_child(body)
	var d := Vector3(dir.x, 0, dir.y) + Vector3(randf_range(-0.25, 0.25), 0, randf_range(-0.25, 0.25))
	var axis := Vector3.UP.cross(d.normalized()).normalized()
	_falling.append({"node": node, "axis": axis, "t": 0.0, "angle": 0.0, "dust": false, "pos": pivot, "dir": d.normalized(), "sc": sc})
	if fx:
		fx.emit(pivot, Vector3(0, 0.4, 0), 0.8, 0.2, 0.5, 0.6, 0, Color("a38b6b"), false, 0.0)


func _process(dt: float) -> void:
	var i := _falling.size() - 1
	while i >= 0:
		var f: Dictionary = _falling[i]
		i -= 1
		if not is_instance_valid(f.node):
			_falling.remove_at(i + 1)
			continue
		f.t += dt
		var u := clampf(f.t / FALL_T, 0.0, 1.0)
		# cae acelerando (como un péndulo invertido) y rebota un poco al llegar al suelo
		var ang := (PI * 0.5 - 0.06) * u * u
		if u >= 1.0:
			var k: float = f.t - FALL_T
			ang = PI * 0.5 - 0.06 - 0.09 * exp(-k * 6.0) * absf(sin(k * 14.0))
			if not f.dust and fx:
				f.dust = true
				var hitp: Vector3 = f.pos + f.dir * 2.0 * f.sc
				for n in 14:
					fx.emit(hitp + Vector3(randf_range(-1.0, 1.0), 0.1, randf_range(-1.0, 1.0)) * f.sc, Vector3(randf_range(-0.8, 0.8), 0.3 + randf() * 0.5, randf_range(-0.8, 0.8)), 1.4 + randf(), 0.25, 0.9, 0.5, 0, Color("8f8466"), false, 0.02)
			if k > 2.0:
				_falling.remove_at(i + 1)
		(f.node as Node3D).basis = Basis(f.axis, ang)
