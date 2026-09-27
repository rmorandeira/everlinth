extends SceneTree
## Vista previa de un modelo con el cargador y el shader del juego (Kenney.model):
##   godot --path godot -s res://tools/preview_model.gd -- model=retro/detail-barrier-strong-type-a out=C:/ruta/captura.png
## Sin servidor: usa el GLB de assets/models tal cual, con la escala del kit.

var _out := ""
var _frames := 0
var _key := "retro/detail-barrier-strong-type-a"


func _init() -> void:
	for a in OS.get_cmdline_user_args():
		var kv := a.split("=", true, 1)
		if kv.size() == 2 and kv[0] == "model":
			_key = kv[1]
		elif kv.size() == 2 and kv[0] == "out":
			_out = kv[1]
	process_frame.connect(_on_frame)


## Los singletons (Catalog) ya existen: se puede usar el cargador del juego.
func _setup() -> void:
	var key := _key
	var K: GDScript = load("res://scripts/render/kenney.gd")
	var root := Node3D.new()
	get_root().add_child(root)
	(load("res://scripts/render/facades.gd") as GDScript).call("setup")
	RenderingServer.global_shader_parameter_set("cut_keep", 1.0)
	var m: Dictionary = K.call("model", key)
	var s: float = K.call("base_scale", key)
	for part in m.parts:
		var mi := MeshInstance3D.new()
		mi.mesh = part[0]
		mi.transform = Transform3D(Basis.from_scale(Vector3(s, s, s)), Vector3.ZERO) * part[1]
		root.add_child(mi)
	var size: Vector3 = m.size * s
	print("tamaño (unidades de render): ", size, " → metros: ", size * 3.0)
	var floor_mi := MeshInstance3D.new()
	var pm := PlaneMesh.new()
	pm.size = Vector2(6, 6)
	floor_mi.mesh = pm
	var fm := StandardMaterial3D.new()
	fm.albedo_color = Color("6d6c69")
	floor_mi.material_override = fm
	root.add_child(floor_mi)
	var sun := DirectionalLight3D.new()
	sun.rotation_degrees = Vector3(-50, -35, 0)
	sun.shadow_enabled = true
	sun.light_energy = 1.3
	root.add_child(sun)
	var env := WorldEnvironment.new()
	env.environment = Environment.new()
	env.environment.background_mode = Environment.BG_COLOR
	env.environment.background_color = Color("d8dde2")
	env.environment.ambient_light_source = Environment.AMBIENT_SOURCE_COLOR
	env.environment.ambient_light_color = Color("dfe6ee")
	env.environment.ambient_light_energy = 0.6
	root.add_child(env)
	var cam := Camera3D.new()
	root.add_child(cam)
	var d := maxf(size.x, size.z) * 1.1
	cam.look_at_from_position(Vector3(d * 0.75, size.y * 2.2, d * 0.9), Vector3(0, size.y * 0.45, 0), Vector3.UP)
	cam.fov = 40


func _on_frame() -> void:
	_frames += 1
	if _frames == 2:
		_setup()
	if _frames == 30:
		var img := get_root().get_texture().get_image()
		img.save_png(_out)
		print("captura: ", _out)
		quit()
