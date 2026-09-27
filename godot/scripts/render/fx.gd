class_name Fx
extends Node3D
## Efectos de combate (puerto de gunfx3d.ts, trazadoras de scene3d.ts y fuego de
## cars3d.ts): partículas de humo y fuego, fogonazo con luces reales (foco hacia donde
## se dispara y luz cálida alrededor del tirador), chispa con luz en el impacto,
## trazadoras finas y discontinuas, y rebotes con parábola (lejos) o secos (cerca).
## Todo instanciado: una MultiMesh por modo de mezcla y otra para los trazos.

const FLASH_TIME := 0.05
const MUZZLE_H := 0.42
const MAX_PARTICLES := 600
const MAX_STREAKS := 256
const TRACER_SPEED := 95.0
const TRACER_EVERY := 3
const TRACER_COLORS := [Color("ffe08a"), Color("fff0b8"), Color("ffd060"), Color("ffb347"), Color("ffc978"), Color("ff8f4a")]
const RICO_COLORS := [Color("ffe08a"), Color("ffc060"), Color("ff9a50")]

var _smoke := MultiMeshInstance3D.new()
var _glow := MultiMeshInstance3D.new()
var _streaks := MultiMeshInstance3D.new()
var _parts: Array = [] # { p, v, age, life, s0, s1, alpha, kind, rot, color, add, rise }
var _tracers: Array = [] # { o, u, len, d, streak, color }
var _bounces: Array = [] # { p, v, age, life, color }
var _tracer_count := 0

var spot := SpotLight3D.new()
var muzzle := OmniLight3D.new()
var hit_light := OmniLight3D.new()
var boom_light := OmniLight3D.new()
var _flash_t := 0.0
var _flash_power := 1.0
var _hit_t := 0.0
var _boom_t := 0.0
var _flash_pos := Vector3.ZERO


func _ready() -> void:
	var quad := QuadMesh.new()
	var smat := ShaderMaterial.new()
	smat.shader = load("res://shaders/fx_smoke.gdshader")
	smat.render_priority = 5
	var gmat := ShaderMaterial.new()
	gmat.shader = load("res://shaders/fx_glow.gdshader")
	gmat.render_priority = 6
	_mm(_smoke, quad, smat, MAX_PARTICLES, true)
	_mm(_glow, quad, gmat, MAX_PARTICLES, true)

	var box := BoxMesh.new()
	box.size = Vector3(1.0, 0.012, 0.012)
	var stmat := StandardMaterial3D.new()
	stmat.shading_mode = BaseMaterial3D.SHADING_MODE_UNSHADED
	stmat.vertex_color_use_as_albedo = true
	stmat.blend_mode = BaseMaterial3D.BLEND_MODE_ADD
	stmat.transparency = BaseMaterial3D.TRANSPARENCY_ALPHA
	stmat.no_depth_test = false
	stmat.disable_fog = true
	_mm(_streaks, box, stmat, MAX_STREAKS, false)

	spot.light_color = Color("ffc27a")
	spot.spot_range = 16.0
	spot.spot_angle = 38.0
	spot.spot_attenuation = 1.6
	spot.light_energy = 0.0
	add_child(spot)
	for l in [muzzle, hit_light, boom_light]:
		l.light_energy = 0.0
		l.shadow_enabled = false
		add_child(l)
	muzzle.light_color = Color("ffb060")
	muzzle.omni_range = 7.0
	muzzle.omni_attenuation = 1.8
	hit_light.light_color = Color("ffd090")
	hit_light.omni_range = 3.5
	boom_light.light_color = Color("ff8a30")
	boom_light.omni_range = 10.0


func _mm(mmi: MultiMeshInstance3D, mesh: Mesh, mat: Material, cap: int, custom: bool) -> void:
	var mm := MultiMesh.new()
	mm.transform_format = MultiMesh.TRANSFORM_3D
	mm.use_colors = true
	mm.use_custom_data = custom
	mm.mesh = mesh
	mm.instance_count = cap
	mm.visible_instance_count = 0
	mmi.multimesh = mm
	mmi.material_override = mat
	mmi.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	mmi.custom_aabb = AABB(Vector3(-1000, -10, -1000), Vector3(2000, 60, 2000))
	add_child(mmi)


## Partícula. kind: 0 humo, 1 fuego/bola, 2 destello. add: mezcla aditiva.
func emit(p: Vector3, v: Vector3, life: float, s0: float, s1: float, alpha: float, kind: int, color: Color, add: bool, rise := 0.05) -> void:
	if _parts.size() >= MAX_PARTICLES * 2 - 4:
		_parts.pop_front()
	_parts.append({"p": p, "v": v, "age": 0.0, "life": life, "s0": s0, "s1": s1, "alpha": alpha, "kind": kind, "rot": randf() * TAU, "color": color, "add": add, "rise": rise})


## Disparo desde (x, z) hacia (dx, dz) unitario (unidades de render).
func fire(x: float, z: float, dx: float, dz: float) -> void:
	var m := Vector3(x + dx * 0.38, MUZZLE_H + Terrain.at(x, z), z + dz * 0.38)
	_flash_t = FLASH_TIME
	_flash_power = 0.75 + randf() * 0.5
	_flash_pos = m
	emit(m, Vector3.ZERO, FLASH_TIME, 0.5, 0.35, 1.0, 2, Color("ffd890"), true, 0.0)
	muzzle.position = m + Vector3(0, 0.1, 0)
	spot.position = m + Vector3(-dx * 0.3, 0.35, -dz * 0.3)
	var target := Vector3(x + dx * 8.0, Terrain.at(x + dx * 8.0, z + dz * 8.0), z + dz * 8.0)
	if not spot.position.is_equal_approx(target):
		spot.look_at(target, Vector3.UP)
	var n := 1 if randf() < 0.6 else 2
	for i in n:
		var sp := 0.8 + randf() * 0.8
		emit(m + Vector3(dx, 0, dz) * 0.1, Vector3(dx * sp + (randf() - 0.5) * 0.3, 0.25 + randf() * 0.2, dz * sp + (randf() - 0.5) * 0.3), 1.6 + randf() * 1.2, 0.18, 0.9 + randf() * 0.6, 0.5, 0, Color("cfcac2"), false)


func impact(x: float, z: float) -> void:
	_hit_t = FLASH_TIME * 1.4
	var gy := Terrain.at(x, z)
	hit_light.position = Vector3(x, 0.3 + gy, z)
	emit(Vector3(x, 0.25 + gy, z), Vector3.ZERO, FLASH_TIME * 1.4, 0.25, 0.2, 1.0, 2, Color("ffe0a0"), true, 0.0)
	if randf() < 0.5:
		emit(Vector3(x, 0.15 + gy, z), Vector3((randf() - 0.5) * 0.2, 0.2, (randf() - 0.5) * 0.2), 1.0 + randf() * 0.6, 0.12, 0.6, 0.35, 0, Color("cfcac2"), false)


## Trazadora (una de cada TRACER_EVERY balas), en unidades de render.
func tracer(x0: float, z0: float, x1: float, z1: float) -> void:
	_tracer_count += 1
	if _tracer_count % TRACER_EVERY != 1:
		return
	var d := Vector3(x1 - x0, 0, z1 - z0)
	var l := d.length()
	if l < 0.05:
		return
	_tracers.append({"o": Vector3(x0, 0.4 + Terrain.at(x0, z0), z0), "u": d / l, "len": l, "d": 0.35, "streak": 0.45 + randf() * 0.3, "color": TRACER_COLORS[randi() % TRACER_COLORS.size()]})


## Rebote de trazadora en (x, z) viniendo en (dx, dz); far: impacto lejano (parábola).
func ricochet(x: float, z: float, dx: float, dz: float, far: bool) -> void:
	var na := atan2(-dz, -dx) + (randf() - 0.5) * 1.8
	var nx := cos(na)
	var nz := sin(na)
	var dot := dx * nx + dz * nz
	var r := Vector2(dx - 2.0 * dot * nx, dz - 2.0 * dot * nz).normalized()
	var speed := 7.0 + randf() * 4.0 if far else 16.0 + randf() * 8.0
	var k := 0.6 if far else 1.0
	_bounces.append({"p": Vector3(x, 0.4 + randf() * 0.4 + Terrain.at(x, z), z), "v": Vector3(r.x * speed * k, 5.0 + randf() * 4.0 if far else 0.5 + randf() * 1.5, r.y * speed * k),
		"age": 0.0, "life": 1.1 + randf() * 0.5 if far else 0.22 + randf() * 0.15, "color": RICO_COLORS[randi() % RICO_COLORS.size()]})


## Explosión (coches): luz, bolas de fuego.
func explosion(p: Vector3) -> void:
	_boom_t = 0.45
	boom_light.position = p + Vector3(0, 0.8, 0)
	for i in 6:
		emit(p + Vector3((randf() - 0.5) * 0.6, 0.4 + randf() * 0.4, (randf() - 0.5) * 0.6), Vector3(0, 1.5, 0), 0.5 + randf() * 0.3, 0.6, 3.0 + randf() * 1.4, 1.0, 1, Color("ffb050"), true, 0.0)


func flash_uniform() -> Vector4:
	var f := _flash_t / FLASH_TIME
	return Vector4(_flash_pos.x, _flash_pos.y, _flash_pos.z, f * f * _flash_power)


func _process(dt: float) -> void:
	_flash_t = maxf(0.0, _flash_t - dt)
	var f := _flash_t / FLASH_TIME
	var k := f * f * _flash_power
	spot.light_energy = 9.0 * k
	muzzle.light_energy = 3.0 * k
	_hit_t = maxf(0.0, _hit_t - dt)
	var h := _hit_t / (FLASH_TIME * 1.4)
	hit_light.light_energy = 1.5 * h * h
	_boom_t = maxf(0.0, _boom_t - dt)
	boom_light.light_energy = 16.0 * pow(_boom_t / 0.45, 2.0)

	# partículas
	var sm := _smoke.multimesh
	var gm := _glow.multimesh
	var ns := 0
	var ng := 0
	var i := _parts.size() - 1
	while i >= 0:
		var p: Dictionary = _parts[i]
		p.age += dt
		if p.age >= p.life:
			_parts.remove_at(i)
			i -= 1
			continue
		var t: float = p.age / p.life
		var v: Vector3 = p.v
		var drag := exp(-2.5 * dt)
		v.x *= drag
		v.z *= drag
		v.y = v.y * exp(-0.8 * dt) + p.rise * dt
		p.v = v
		p.p += v * dt
		var size: float = p.s0 + (p.s1 - p.s0) * sqrt(t)
		var a: float
		if p.kind == 0:
			a = p.alpha * minf(1.0, t * 8.0) * (1.0 - t) * (1.0 - t)
		else:
			a = p.alpha * (1.0 - t)
		var xf := Transform3D(Basis(), p.p)
		var cd := Color(size, a, p.kind, p.rot)
		if p.add:
			if ng < MAX_PARTICLES:
				gm.set_instance_transform(ng, xf)
				gm.set_instance_color(ng, p.color)
				gm.set_instance_custom_data(ng, cd)
				ng += 1
		elif ns < MAX_PARTICLES:
			sm.set_instance_transform(ns, xf)
			sm.set_instance_color(ns, p.color)
			sm.set_instance_custom_data(ns, cd)
			ns += 1
		i -= 1
	sm.visible_instance_count = ns
	gm.visible_instance_count = ng

	# trazadoras y rebotes (cajas alargadas según su dirección)
	var tm := _streaks.multimesh
	var n := 0
	i = _tracers.size() - 1
	while i >= 0:
		var tr: Dictionary = _tracers[i]
		tr.d += TRACER_SPEED * dt
		var head := minf(tr.d, tr.len)
		var tail := maxf(0.0, tr.d - tr.streak)
		if tail >= tr.len:
			_tracers.remove_at(i)
			i -= 1
			continue
		if n < MAX_STREAKS:
			var u: Vector3 = tr.u
			var mid: Vector3 = tr.o + u * ((head + tail) * 0.5)
			var l := maxf(0.001, head - tail)
			var basis := Basis(u * l, Vector3.UP, Vector3(-u.z, 0, u.x))
			tm.set_instance_transform(n, Transform3D(basis, mid))
			tm.set_instance_color(n, tr.color)
			n += 1
		i -= 1
	i = _bounces.size() - 1
	while i >= 0:
		var b: Dictionary = _bounces[i]
		b.age += dt
		var v: Vector3 = b.v
		v.y -= 14.0 * dt
		var pos: Vector3 = b.p + v * dt
		if pos.y < 0.06:
			pos.y = 0.06
			v = Vector3(v.x * 0.5, absf(v.y) * 0.3, v.z * 0.5)
		b.v = v
		b.p = pos
		var t: float = b.age / b.life
		if t >= 1.0:
			_bounces.remove_at(i)
			i -= 1
			continue
		if n < MAX_STREAKS:
			var sp := v.length()
			var dir := v / maxf(sp, 0.001)
			var l := minf(1.2, 0.05 * sp + 0.1)
			var side := dir.cross(Vector3.UP)
			if side.length() < 0.01:
				side = Vector3.RIGHT
			side = side.normalized()
			var up := side.cross(dir).normalized()
			tm.set_instance_transform(n, Transform3D(Basis(dir * l, up * 2.5, side * 2.5), pos - dir * l * 0.5))
			var c: Color = b.color
			c.a = 1.0 - t * t
			tm.set_instance_color(n, c)
			n += 1
		i -= 1
	tm.visible_instance_count = n
