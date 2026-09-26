class_name People
extends Node3D
## Personas (personaje, otros jugadores) y horda de zombis como sprites de pixel art
## (ver pixel_people.gd): todos en una MultiMesh de rectángulos orientados a la
## cámara (una llamada de dibujo), más su silueta cuando quedan tapados, su sombra
## de píxeles en el suelo y los cadáveres. update() recibe cada fotograma la lista
## de entidades; el estado de cada una (fase del andar, orientación) vive aquí.

const PX := 0.6 / 26.0 # unidades de mundo por píxel del sprite (1,8 m = 26 px)
const MAX_WALKERS := 2048
const MAX_CORPSES := 1024
const OTHER_VARIANTS := 7
const ZOMBIE_VARIANTS := 32
const ZOMBIE_BASE := 1 + OTHER_VARIANTS
const CIVILIAN_VARIANTS := 24
const CIVILIAN_BASE := ZOMBIE_BASE + ZOMBIE_VARIANTS

## Tipos (INSTANCE_CUSTOM.w; decide el color de la silueta).
const KIND_ZOMBIE := 0
const KIND_GIANT := 1
const KIND_PLAYER := 2
const KIND_OTHER := 3
const KIND_CIVILIAN := 5 # sin silueta
const KIND_BITTEN := 6 # mordido: se tambalea, tinte verdoso

var _walkers := MultiMeshInstance3D.new()
var _corpses := MultiMeshInstance3D.new()
var _shadows := MultiMeshInstance3D.new()
var _state := {} # id -> { x, z, phase, fx, fz }


func _ready() -> void:
	var specs: Array = [PixelPeople.player_spec()]
	for i in OTHER_VARIANTS:
		specs.append(PixelPeople.random_spec(1000 + i, false, true))
	var zspecs: Array = []
	for i in ZOMBIE_VARIANTS:
		zspecs.append(PixelPeople.random_spec(2000 + i * 13, true))
	specs.append_array(zspecs)
	for i in CIVILIAN_VARIANTS:
		specs.append(PixelPeople.random_spec(3000 + i * 17, false))
	var atlas := ImageTexture.create_from_image(PixelPeople.build_atlas(specs))
	var corpse_atlas := ImageTexture.create_from_image(PixelPeople.build_corpse_atlas(zspecs))

	var quad := QuadMesh.new()
	var mat := ShaderMaterial.new()
	mat.shader = load("res://shaders/people.gdshader")
	mat.set_shader_parameter("atlas", atlas)
	mat.set_shader_parameter("grid", Vector2(PixelPeople.DIRS, specs.size() * PixelPeople.FRAMES))
	mat.set_shader_parameter("cell_world", Vector2(PixelPeople.CW, PixelPeople.CH) * PX)
	mat.set_shader_parameter("feet_frac", float(PixelPeople.CH - PixelPeople.FEET_ROW) / PixelPeople.CH)
	var ghost := ShaderMaterial.new()
	ghost.shader = load("res://shaders/people_ghost.gdshader")
	for p in ["atlas", "grid", "cell_world", "feet_frac"]:
		ghost.set_shader_parameter(p, mat.get_shader_parameter(p))
	ghost.render_priority = 10
	mat.next_pass = ghost
	_setup(_walkers, quad, mat, MAX_WALKERS, true)

	var kmat := ShaderMaterial.new()
	kmat.shader = mat.shader
	kmat.set_shader_parameter("atlas", corpse_atlas)
	kmat.set_shader_parameter("grid", Vector2(2, ZOMBIE_VARIANTS))
	kmat.set_shader_parameter("cell_world", Vector2(PixelPeople.KW, PixelPeople.KH) * PX)
	kmat.set_shader_parameter("feet_frac", float(PixelPeople.KH - PixelPeople.KFEET_ROW) / PixelPeople.KH)
	_setup(_corpses, quad, kmat, MAX_CORPSES, true)

	var plane := PlaneMesh.new()
	plane.size = Vector2(0.34, 0.34)
	var smat := StandardMaterial3D.new()
	smat.albedo_texture = ImageTexture.create_from_image(PixelPeople.shadow_image())
	smat.texture_filter = BaseMaterial3D.TEXTURE_FILTER_NEAREST
	smat.transparency = BaseMaterial3D.TRANSPARENCY_ALPHA
	smat.shading_mode = BaseMaterial3D.SHADING_MODE_UNSHADED
	smat.render_priority = 4
	plane.material = smat
	_setup(_shadows, plane, null, MAX_WALKERS, false)
	_shadows.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF


func _setup(mmi: MultiMeshInstance3D, mesh: Mesh, mat: Material, cap: int, custom: bool) -> void:
	var mm := MultiMesh.new()
	mm.transform_format = MultiMesh.TRANSFORM_3D
	mm.use_custom_data = custom
	mm.mesh = mesh
	mm.instance_count = cap
	mm.visible_instance_count = 0
	mmi.multimesh = mm
	if mat:
		mmi.material_override = mat
	mmi.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	# las instancias se mueven por todo el mundo y el rectángulo se construye en el shader
	mmi.custom_aabb = AABB(Vector3(-1000, -10, -1000), Vector3(2000, 40, 2000))
	add_child(mmi)


## Dirección relativa a la cámara (0 N = de espaldas … 4 S = de frente, en sentido horario).
static func octant(fx: float, fz: float, cam: Camera3D) -> int:
	var r := cam.global_transform.basis.x
	var f := -cam.global_transform.basis.z
	var a := atan2(fx * r.x + fz * r.z, fx * f.x + fz * f.z)
	return posmod(int(roundf(a / (PI / 4.0))), 8)


## entities: [{ id, x, z (unidades de render), variant, scale, kind, face? (Vector2 hacia
## donde mira; si no, hacia donde anda) }]. corpses: [{ x, z, variant, pose, scale }].
func update(entities: Array, corpses: Array, cam: Camera3D) -> void:
	var mm := _walkers.multimesh
	var sm := _shadows.multimesh
	var seen := {}
	var n := 0
	for e in entities:
		if n >= MAX_WALKERS:
			break
		var id: String = e.id
		seen[id] = true
		var st: Dictionary = _state.get(id, {})
		if st.is_empty():
			st = {"x": e.x, "z": e.z, "phase": randf() * 10.0, "fx": 0.0, "fz": 1.0}
			_state[id] = st
		var dx: float = e.x - st.x
		var dz: float = e.z - st.z
		var dist := sqrt(dx * dx + dz * dz)
		var s: float = e.scale
		var moving := dist > 0.0005
		if moving:
			var zombie: bool = e.kind <= KIND_GIANT
			st.phase += dist * (16.0 * 0.6 if zombie else 11.0) / s
			st.fx = dx / dist
			st.fz = dz / dist
			st.still = 0
		else:
			st.still = st.get("still", 0) + 1
		st.x = e.x
		st.z = e.z
		var fx: float = st.fx
		var fz: float = st.fz
		if e.has("face"):
			fx = e.face.x
			fz = e.face.y
		var d := octant(fx, fz, cam)
		# quieto unos fotogramas → de pie (fotograma 0)
		var frame := 0 if st.still > 4 else int(floorf(fposmod(st.phase, TAU) / TAU * PixelPeople.FRAMES)) % PixelPeople.FRAMES
		var row: int = e.variant * PixelPeople.FRAMES + frame
		var pos := Vector3(e.x, 0.05, e.z)
		mm.set_instance_transform(n, Transform3D(Basis(), pos))
		mm.set_instance_custom_data(n, Color(d, row, s, e.kind))
		sm.set_instance_transform(n, Transform3D(Basis.from_scale(Vector3(s, 1, s)), Vector3(e.x, 0.072, e.z)))
		n += 1
	mm.visible_instance_count = n
	sm.visible_instance_count = n
	for id in _state.keys():
		if not seen.has(id):
			_state.erase(id)

	var km := _corpses.multimesh
	var k := 0
	for c in corpses:
		if k >= MAX_CORPSES:
			break
		km.set_instance_transform(k, Transform3D(Basis(), Vector3(c.x, 0.05, c.z)))
		km.set_instance_custom_data(k, Color(c.pose, c.variant % ZOMBIE_VARIANTS, c.scale, 4))
		k += 1
	km.visible_instance_count = k
