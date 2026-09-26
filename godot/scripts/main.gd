extends Node3D
## Escena principal del cliente Godot (fase 1 de docs/migracion-godot.md):
## login, conexión, suelo de la sala y vecinas, personaje, otros jugadores,
## horda provisional y cámara isométrica. Coordenadas como en el cliente web:
## "tiles locales" relativos a la sala actual; render = tiles × TILE_SIZE.

const W := Protocol.SCREEN_WIDTH
const H := Protocol.SCREEN_HEIGHT
const T := Protocol.TILE_SIZE
const DIR_CYCLE := ["N", "E", "S", "W"]
const MAX_ZOMBIES := 1024

var cam := IsoCamera.new()
var ground := Ground.new()
var lighting := Lighting.new()
var city_root: Node3D
var city_key := ""
var player_node: Node3D
var others := {} # username -> { node, x, y }
var zombie_mm := MultiMeshInstance3D.new()

var you: Dictionary = {}
var screen: Dictionary = {}
var neighbors: Array = []
var you_display := Vector2.ZERO
var zombie_targets := {} # id -> Vector3(gx, gy, giant)
var zombie_display := {} # id -> Vector2(gx, gy)
var last_dirs := {"N": false, "S": false, "E": false, "W": false}
var time := 0.0
var joined_at := -1.0
var capturing := false

var login_panel: PanelContainer
var name_edit: LineEdit
var status_label: Label
var hud_label: Label
var fps_label: Label


func _ready() -> void:
	_build_world()
	_build_ui()
	Net.message.connect(_on_message)
	Net.opened.connect(_on_opened)
	Net.closed.connect(func() -> void: status_label.text = "Sin conexión con %s" % Config.server_url)
	status_label.text = "Conectando con %s…" % Config.server_url
	Net.connect_to(Config.server_url)


# ---------------------------------------------------------------- escena

func _build_world() -> void:
	if Config.hour >= 0.0:
		lighting.hour_override = Config.hour
	add_child(lighting)


	add_child(cam)
	cam.current = true
	add_child(ground)

	player_node = _make_figure(Color("f0f0f0"))
	add_child(player_node)

	var capsule := CapsuleMesh.new()
	capsule.radius = 0.07
	capsule.height = 0.55
	var zmat := StandardMaterial3D.new()
	zmat.albedo_color = Color("5b8f45")
	capsule.material = zmat
	var mm := MultiMesh.new()
	mm.transform_format = MultiMesh.TRANSFORM_3D
	mm.mesh = capsule
	mm.instance_count = MAX_ZOMBIES
	mm.visible_instance_count = 0
	zombie_mm.multimesh = mm
	add_child(zombie_mm)


## Figura provisional (fase 3 la sustituye por el personaje estilizado): 1,8 m = 0,6 unidades.
func _make_figure(color: Color) -> Node3D:
	var root := Node3D.new()
	var body := MeshInstance3D.new()
	var capsule := CapsuleMesh.new()
	capsule.radius = 0.08
	capsule.height = 0.6
	var mat := StandardMaterial3D.new()
	mat.albedo_color = color
	capsule.material = mat
	body.mesh = capsule
	body.position.y = 0.3
	root.add_child(body)
	return root


# ---------------------------------------------------------------- interfaz

func _build_ui() -> void:
	# Posproceso de pantalla (tilt-shift + color): debajo del HUD, que no se desenfoca.
	var post := CanvasLayer.new()
	post.layer = 0
	add_child(post)
	var blur_shader: Shader = load("res://shaders/tilt_blur.gdshader")
	for pass_dir in [Vector2(1, 0), Vector2(0, 1)]:
		var bb := BackBufferCopy.new()
		bb.copy_mode = BackBufferCopy.COPY_MODE_VIEWPORT
		post.add_child(bb)
		var rect := ColorRect.new()
		rect.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
		rect.mouse_filter = Control.MOUSE_FILTER_IGNORE
		var mat := ShaderMaterial.new()
		mat.shader = blur_shader
		mat.set_shader_parameter("dir", pass_dir)
		mat.set_shader_parameter("grade", pass_dir.y > 0.5)
		rect.material = mat
		post.add_child(rect)

	var layer := CanvasLayer.new()
	layer.layer = 1
	add_child(layer)

	login_panel = PanelContainer.new()
	login_panel.set_anchors_and_offsets_preset(Control.PRESET_CENTER)
	var box := VBoxContainer.new()
	box.custom_minimum_size = Vector2(320, 0)
	var title := Label.new()
	title.text = "EVERLINTH"
	title.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	title.add_theme_font_size_override("font_size", 32)
	box.add_child(title)
	name_edit = LineEdit.new()
	name_edit.placeholder_text = "Nombre del personaje"
	name_edit.text_submitted.connect(func(_t: String) -> void: _join(name_edit.text))
	box.add_child(name_edit)
	var btn := Button.new()
	btn.text = "Entrar"
	btn.pressed.connect(func() -> void: _join(name_edit.text))
	box.add_child(btn)
	status_label = Label.new()
	status_label.autowrap_mode = TextServer.AUTOWRAP_WORD
	box.add_child(status_label)
	login_panel.add_child(box)
	layer.add_child(login_panel)

	hud_label = Label.new()
	hud_label.position = Vector2(14, 10)
	hud_label.add_theme_color_override("font_shadow_color", Color.BLACK)
	layer.add_child(hud_label)

	fps_label = Label.new()
	fps_label.set_anchors_and_offsets_preset(Control.PRESET_TOP_RIGHT)
	fps_label.position += Vector2(-150, 70)
	fps_label.add_theme_color_override("font_color", Color("99ff99"))
	fps_label.add_theme_color_override("font_shadow_color", Color.BLACK)
	layer.add_child(fps_label)


func _on_opened() -> void:
	status_label.text = ""
	if Config.auto_user != "":
		_join(Config.auto_user)
	else:
		name_edit.grab_focus()


func _join(username: String) -> void:
	username = username.strip_edges()
	if username == "":
		status_label.text = "Escribe un nombre."
		return
	Net.send({"type": "join", "username": username})


func _update_hud() -> void:
	if you.is_empty():
		return
	hud_label.text = "%s · Nv %d · XP %d · Vida %d/%d · (%d,%d)" % [
		you.username, int(you.level), int(you.xp), int(you.hp), int(you.maxHp), int(you.sx), int(you.sy)]


# ---------------------------------------------------------------- red

func _on_message(msg: Dictionary) -> void:
	match msg.type:
		"joined":
			you = msg.you
			you_display = Vector2(you.x, you.y)
			login_panel.visible = false
			joined_at = time
			Net.send({"type": "setZombies", "enabled": true})
			_update_hud()
		"screen":
			var s: Dictionary = msg.screen
			if not screen.is_empty() and (int(screen.sx) != int(s.sx) or int(screen.sy) != int(s.sy)):
				# El mundo se re-basa en la sala nueva: se desplaza la posición suavizada
				# lo mismo, así personaje y cámara siguen donde estaban.
				you_display.x += (int(screen.sx) - int(s.sx)) * W
				you_display.y += (int(screen.sy) - int(s.sy)) * H
			screen = s
			neighbors = msg.neighbors
			for u in others.keys():
				others[u].node.queue_free()
			others.clear()
			for p in msg.players:
				_set_other(p)
			ground.build(screen, neighbors)
			_build_city()
		"playerUpdate":
			_set_other(msg.player)
		"playerLeft":
			if others.has(msg.username):
				others[msg.username].node.queue_free()
				others.erase(msg.username)
		"youUpdate":
			you = msg.you
			_update_hud()
		"zombies":
			zombie_targets.clear()
			for z in msg.zombies:
				var id := int(z.id)
				zombie_targets[id] = Vector3(z.gx, z.gy, 1.0 if z.get("giant", false) else 0.0)
				if not zombie_display.has(id):
					zombie_display[id] = Vector2(z.gx, z.gy)
			for id in zombie_display.keys():
				if not zombie_targets.has(id):
					zombie_display.erase(id)
		"died":
			you = {}
			login_panel.visible = true
			status_label.text = "Has muerto. Tu personaje se ha perdido para siempre."
		"error":
			status_label.text = str(msg.message)


## Ciudad vectorial de la sala actual y sus vecinas (se rehace al cambiar de sala).
func _build_city() -> void:
	var key := "%d,%d" % [int(screen.sx), int(screen.sy)]
	if key == city_key:
		return
	city_key = key
	if city_root:
		city_root.queue_free()
		city_root = null
	var datas: Array = []
	if screen.has("city"):
		datas.append(screen.city)
	for n in neighbors:
		if n.has("city"):
			datas.append(n.city)
	if datas.is_empty():
		return
	var t0 := Time.get_ticks_msec()
	city_root = City.build(datas, int(screen.sx) * W, int(screen.sy) * H)
	add_child(city_root)
	print("ciudad construida en %d ms (%d nodos)" % [Time.get_ticks_msec() - t0, city_root.get_child_count()])


func _set_other(p: Dictionary) -> void:
	if not you.is_empty() and p.username == you.username:
		return
	if not others.has(p.username):
		var node := _make_figure(Color("3ba0e0"))
		add_child(node)
		others[p.username] = {"node": node, "x": float(p.x), "y": float(p.y)}
	others[p.username].p = p


# ---------------------------------------------------------------- bucle

static func lerp_towards(current: float, target: float, dt: float, rate := 18.0) -> float:
	return current + (target - current) * (1.0 - exp(-rate * dt))


func _unhandled_input(ev: InputEvent) -> void:
	if ev is InputEventKey and ev.pressed and not ev.echo and not login_panel.visible:
		match ev.physical_keycode:
			KEY_Q:
				cam.rotate_step(-1)
				_send_dirs(last_dirs, true)
			KEY_R:
				cam.rotate_step(1)
				_send_dirs(last_dirs, true)
			KEY_F3:
				fps_label.visible = not fps_label.visible


## Las direcciones son relativas a la PANTALLA; con la cámara girada k cuartos de
## vuelta, "arriba" es la dirección de servidor k pasos más allá en N → E → S → W.
func _send_dirs(dirs: Dictionary, force := false) -> void:
	if not force and dirs == last_dirs:
		return
	last_dirs = dirs
	var out := {"N": false, "S": false, "E": false, "W": false}
	for i in 4:
		if dirs[DIR_CYCLE[i]]:
			out[DIR_CYCLE[(i + cam.step) % 4]] = true
	Net.send({"type": "input", "dirs": out})


func _read_dirs() -> Dictionary:
	if login_panel.visible:
		return {"N": false, "S": false, "E": false, "W": false}
	if Config.walk != "":
		return {"N": "N" in Config.walk, "S": "S" in Config.walk, "E": "E" in Config.walk, "W": "W" in Config.walk}
	var ax := Input.get_joy_axis(0, JOY_AXIS_LEFT_X)
	var ay := Input.get_joy_axis(0, JOY_AXIS_LEFT_Y)
	return {
		"N": Input.is_physical_key_pressed(KEY_W) or Input.is_physical_key_pressed(KEY_UP) or ay < -0.4,
		"S": Input.is_physical_key_pressed(KEY_S) or Input.is_physical_key_pressed(KEY_DOWN) or ay > 0.4,
		"E": Input.is_physical_key_pressed(KEY_D) or Input.is_physical_key_pressed(KEY_RIGHT) or ax > 0.4,
		"W": Input.is_physical_key_pressed(KEY_A) or Input.is_physical_key_pressed(KEY_LEFT) or ax < -0.4,
	}


func _process(dt: float) -> void:
	time += dt
	fps_label.text = "%d FPS" % Engine.get_frames_per_second()
	if you.is_empty() or screen.is_empty():
		return
	_send_dirs(_read_dirs())

	you_display.x = lerp_towards(you_display.x, float(you.x), dt)
	you_display.y = lerp_towards(you_display.y, float(you.y), dt)
	player_node.position = Vector3(you_display.x * T, 0.05, you_display.y * T)

	var sx := int(screen.sx)
	var sy := int(screen.sy)
	for u in others:
		var o: Dictionary = others[u]
		var p: Dictionary = o.p
		var tx := (int(p.sx) - sx) * W + float(p.x)
		var ty := (int(p.sy) - sy) * H + float(p.y)
		o.x = lerp_towards(o.x, tx, dt)
		o.y = lerp_towards(o.y, ty, dt)
		o.node.position = Vector3(o.x * T, 0.0, o.y * T)

	_update_zombies(dt, sx * W, sy * H)
	lighting.update(you_display.x * T, you_display.y * T)
	StreetFurniture.update_signals(time)
	cam.follow(you_display.x * T, you_display.y * T, time, dt)
	_update_cutaway()
	_maybe_capture()


func _update_zombies(dt: float, zox: int, zoy: int) -> void:
	var mm := zombie_mm.multimesh
	var n := 0
	for id in zombie_display:
		if n >= MAX_ZOMBIES:
			break
		var d: Vector2 = zombie_display[id]
		var t: Vector3 = zombie_targets.get(id, Vector3(d.x, d.y, 0.0))
		d.x = lerp_towards(d.x, t.x, dt, 14.0)
		d.y = lerp_towards(d.y, t.y, dt, 14.0)
		zombie_display[id] = d
		var s := Protocol.GIANT_SCALE if t.z > 0.5 else 1.0
		var basis := Basis.from_scale(Vector3(s, s, s))
		mm.set_instance_transform(n, Transform3D(basis, Vector3((d.x - zox) * T, 0.275 * s, (d.y - zoy) * T)))
		n += 1
	mm.visible_instance_count = n


## Franja de pantalla del personaje (desde su cabeza hacia abajo, 70 % del ancho).
func _update_cutaway() -> void:
	var size := get_viewport().get_visible_rect().size
	var head := cam.unproject_position(player_node.position + Vector3(0, 0.75, 0))
	RenderingServer.global_shader_parameter_set("cut_params", Vector4(head.y, size.x * 0.5, size.x * 0.7 * 0.5, size.y * 0.05))
	RenderingServer.global_shader_parameter_set("cut_cam_fwd", cam.global_transform.basis.z)


## Verificación sin pantalla: guarda una captura tras N segundos de partida y sale.
func _maybe_capture() -> void:
	if Config.capture_path == "" or capturing or joined_at < 0.0 or time - joined_at < Config.capture_after:
		return
	capturing = true
	await RenderingServer.frame_post_draw
	var img := get_viewport().get_texture().get_image()
	var path := Config.capture_path
	if path.begins_with("res://") or path.begins_with("user://"):
		path = ProjectSettings.globalize_path(path)
	img.save_png(path)
	print("captura guardada en ", path)
	get_tree().quit()
