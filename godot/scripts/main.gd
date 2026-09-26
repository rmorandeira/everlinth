extends Node3D
## Escena principal del cliente Godot (ver docs/migracion-godot.md): conexión, ciudad,
## personaje y horda como sprites de pixel art, disparo con ratón o mando, efectos,
## coches destructibles, sonido, HUD y calidad adaptativa. Coordenadas como en el
## cliente web: "tiles locales" relativos a la sala actual; render = tiles × TILE_SIZE.

const W := Protocol.SCREEN_WIDTH
const H := Protocol.SCREEN_HEIGHT
const T := Protocol.TILE_SIZE
const DIR_CYCLE := ["N", "E", "S", "W"]
const MAX_CORPSES := 350
const STRIDE := 1.1 # tiles entre pisadas
const AIM_RADIUS := 6.0 # tiles: punto de mira del stick derecho alrededor del personaje

var cam := IsoCamera.new()
var ground := Ground.new()
var lighting := Lighting.new()
var people := People.new()
var fx := Fx.new()
var cars := Cars.new()
var destruction := Destruction.new()
var sfx := Sfx.new()
var quality := Quality.new()
var hud := Hud.new()
var city_root: Node3D
var city_key := ""

var you: Dictionary = {}
var screen: Dictionary = {}
var neighbors: Array = []
var you_display := Vector2.ZERO
var others := {} # username -> { p, x, y, label, variant }
var zombie_targets := {} # id -> Vector3(gx, gy, giant)
var zombie_display := {} # id -> Vector2(gx, gy)
var corpses: Array = [] # { gx, gy, variant, pose, scale }
var last_dirs := {"N": false, "S": false, "E": false, "W": false}
var time := 0.0
var joined_at := -1.0
var capturing := false
var zombies_on := true

# disparo y apuntado
var aim := Vector2(0, 1) # dirección de mira (tiles; x = columna, y = fila)
var aim_active_until := 0.0
var firing := false
var last_shot := 0.0
var stride_acc := 0.0
var last_you := Vector2.ZERO
var recent_kills: Array = []
var last_laugh := -1e9


var _bench_frames := 0
var _bench_time := 0.0
var _bench_cpu := 0.0
var _bench_gpu := 0.0
var _bench_rcpu := 0.0


func _ready() -> void:
	if Config.bench:
		DisplayServer.window_set_vsync_mode(DisplayServer.VSYNC_DISABLED)
		quality.set_process(false)
		if "lowres" in Config.off:
			quality.tier = 0
		RenderingServer.viewport_set_measure_render_time(get_viewport().get_viewport_rid(), true)
	add_child(lighting)
	add_child(cam)
	cam.current = true
	add_child(ground)
	add_child(people)
	add_child(fx)
	cars.fx = fx
	add_child(cars)
	destruction.fx = fx
	add_child(destruction)
	add_child(sfx)
	quality.env = lighting.env
	add_child(quality)
	if not ("tilt" in Config.off):
		_build_post()
	add_child(hud)
	hud.join_requested.connect(_on_join_requested)
	hud.zombies_toggled.connect(_on_zombies_toggled)
	hud.hour_changed.connect(func(h: float) -> void: lighting.hour_override = h)
	zombies_on = hud.zombie_toggle.button_pressed
	if Config.bench:
		lighting.env.ssao_enabled = not ("ssao" in Config.off)
		lighting.env.glow_enabled = not ("glow" in Config.off)
		if "msaa" in Config.off:
			get_viewport().msaa_3d = Viewport.MSAA_DISABLED
		lighting.sun.shadow_enabled = not ("shadow" in Config.off)
	hud.restore()
	Net.message.connect(_on_message)
	Net.opened.connect(_on_opened)
	# catálogo del gestor web: al cambiar un asset se rehace la ciudad con él
	Catalog.changed.connect(func(_id: String) -> void:
		if not screen.is_empty():
			city_key = ""
			_build_city())
	Net.closed.connect(func() -> void: hud.status_label.text = "Sin conexión con %s" % Config.server_url)
	hud.status_label.text = "Conectando con %s…" % Config.server_url
	Net.connect_to(Config.server_url)


## Posproceso de pantalla (tilt-shift + color): debajo del HUD, que no se desenfoca.
func _build_post() -> void:
	var post := CanvasLayer.new()
	post.layer = 0
	add_child(post)
	var rect := ColorRect.new()
	rect.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	rect.mouse_filter = Control.MOUSE_FILTER_IGNORE
	var mat := ShaderMaterial.new()
	mat.shader = load("res://shaders/tilt_blur.gdshader")
	rect.material = mat
	post.add_child(rect)


var _pending_join := ""


## Entrar: si se ha cambiado el servidor (o no hay conexión), se conecta primero.
func _on_join_requested(n: String, server: String) -> void:
	if server != Config.server_url or not Net.is_open():
		Config.server_url = server
		_pending_join = n
		hud.status_label.text = "Conectando con %s…" % server
		Net.connect_to(server)
		Catalog.refresh("")
		return
	Net.send({"type": "join", "username": n})


func _on_opened() -> void:
	hud.status_label.text = ""
	if _pending_join != "":
		Net.send({"type": "join", "username": _pending_join})
		_pending_join = ""
	elif Config.auto_user != "":
		Net.send({"type": "join", "username": Config.auto_user})


func _on_zombies_toggled(on: bool) -> void:
	zombies_on = on
	Net.send({"type": "setZombies", "enabled": on})
	if not on:
		zombie_targets.clear()
		zombie_display.clear()


# ---------------------------------------------------------------- red

func _on_message(msg: Dictionary) -> void:
	match msg.type:
		"joined":
			you = msg.you
			you_display = Vector2(you.x, you.y)
			last_you = you_display
			hud.set_playing(true)
			joined_at = time
			Net.send({"type": "setZombies", "enabled": zombies_on})
			hud.set_stats(you)
		"screen":
			var s: Dictionary = msg.screen
			if not screen.is_empty() and (int(screen.sx) != int(s.sx) or int(screen.sy) != int(s.sy)):
				# El mundo se re-basa en la sala nueva: se desplaza la posición suavizada
				# lo mismo, así personaje y cámara siguen donde estaban.
				var d := Vector2((int(screen.sx) - int(s.sx)) * W, (int(screen.sy) - int(s.sy)) * H)
				you_display += d
				last_you += d
			screen = s
			neighbors = msg.neighbors
			for u in others.keys():
				others[u].label.queue_free()
			others.clear()
			for p in msg.players:
				_set_other(p)
			ground.build(screen, neighbors)
			_build_city()
			hud.minimap.set_rooms(screen, neighbors)
		"playerUpdate":
			_set_other(msg.player)
		"playerLeft":
			if others.has(msg.username):
				others[msg.username].label.queue_free()
				others.erase(msg.username)
		"youUpdate":
			you = msg.you
			hud.set_stats(you)
		"discovery":
			hud.show_discovery(str(msg.tier), int(msg.xp))
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
		"zombieDied":
			corpses.append({"gx": float(msg.gx), "gy": float(msg.gy), "variant": randi() % People.ZOMBIE_VARIANTS, "pose": randi() % 2, "scale": Protocol.GIANT_SCALE if msg.giant else 1.0})
			if corpses.size() > MAX_CORPSES:
				corpses.pop_front()
		"kill":
			var now := time
			recent_kills.append(now)
			while not recent_kills.is_empty() and now - recent_kills[0] > 8.0:
				recent_kills.pop_front()
			if recent_kills.size() >= 4 and now - last_laugh > 12.0:
				last_laugh = now
				recent_kills.clear()
				sfx.laugh(0.9)
		"shot":
			_on_shot(msg)
		"buildingDamaged":
			destruction.on_damage(str(msg.id), float(msg.hp), float(msg.maxHp))
			if Config.bench:
				print("edificio %s: %d/%d" % [msg.id, msg.hp, msg.maxHp])
		"died":
			you = {}
			hud.set_playing(false)
			hud.status_label.text = "Has muerto. Tu personaje se ha perdido para siempre."
		"error":
			hud.status_label.text = str(msg.message)


func _on_shot(msg: Dictionary) -> void:
	if screen.is_empty():
		return
	var ox := int(screen.sx) * W
	var oy := int(screen.sy) * H
	var fx0: float = (msg.from.gx - ox) * T
	var fz0: float = (msg.from.gy - oy) * T
	var tx: float = (msg.to.gx - ox) * T
	var tz: float = (msg.to.gy - oy) * T
	fx.tracer(fx0, fz0, tx, tz)
	fx.impact(tx, tz)
	cars.hit(fx0, fz0, tx, tz)
	if msg.hit == "wall" and randf() < 0.18:
		var shot_len := Vector2(msg.to.gx - msg.from.gx, msg.to.gy - msg.from.gy).length()
		var d := Vector2(tx - fx0, tz - fz0).normalized()
		fx.ricochet(tx, tz, d.x, d.y, shot_len > 14.0)
	if not you.is_empty():
		# disparo de otro jugador: su fogonazo y su sonido, atenuado con la distancia
		var dist := Vector2(msg.from.gx - (ox + you_display.x), msg.from.gy - (oy + you_display.y)).length()
		if dist > 1.5:
			var d := Vector2(tx - fx0, tz - fz0).normalized()
			fx.fire(fx0, fz0, d.x, d.y)
			sfx.gunshot(maxf(0.08, 0.8 / (1.0 + dist / 12.0)))


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
		cars.set_cars([])
		return
	city_root = City.build(datas, int(screen.sx) * W, int(screen.sy) * H)
	add_child(city_root)
	cars.set_cars(city_root.get_meta("cars", []))
	destruction.set_buildings(city_root.get_meta("buildings", {}))


func _set_other(p: Dictionary) -> void:
	if not you.is_empty() and p.username == you.username:
		return
	if not others.has(p.username):
		var label := Label3D.new()
		label.text = p.username
		label.billboard = BaseMaterial3D.BILLBOARD_ENABLED
		label.pixel_size = 0.004
		label.font_size = 28
		label.outline_size = 8
		label.no_depth_test = true
		label.modulate = Color("cfe8ff")
		add_child(label)
		var h := 0
		for i in p.username.length():
			h = (h * 31 + p.username.unicode_at(i)) & 0x7fffffff
		others[p.username] = {"x": float(p.x), "y": float(p.y), "label": label, "variant": 1 + h % People.OTHER_VARIANTS}
	others[p.username].p = p


# ---------------------------------------------------------------- entrada

static func lerp_towards(current: float, target: float, dt: float, rate := 18.0) -> float:
	return current + (target - current) * (1.0 - exp(-rate * dt))


func _unhandled_input(ev: InputEvent) -> void:
	if not hud.login_panel.visible and ev is InputEventKey and ev.pressed and not ev.echo:
		match ev.physical_keycode:
			KEY_Q:
				cam.rotate_step(-1)
				_send_dirs(last_dirs, true)
			KEY_R:
				cam.rotate_step(1)
				_send_dirs(last_dirs, true)
	if ev is InputEventMouseMotion:
		aim_active_until = time + 2.0


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
	if hud.login_panel.visible:
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


## Mira: el cursor del ratón sobre el suelo, o el stick derecho (en círculo alrededor
## del personaje, relativo a la pantalla). Devuelve la dirección en tiles.
func _update_aim() -> void:
	var rx := Input.get_joy_axis(0, JOY_AXIS_RIGHT_X)
	var ry := Input.get_joy_axis(0, JOY_AXIS_RIGHT_Y)
	if Vector2(rx, ry).length() > 0.3:
		var r := cam.global_transform.basis.x
		var f := -cam.global_transform.basis.z
		var d := Vector2(r.x, r.z).normalized() * rx + Vector2(f.x, f.z).normalized() * -ry
		aim = d.normalized()
		aim_active_until = time + 2.0
		return
	if Config.aim != Vector2.ZERO:
		aim = Config.aim.normalized()
		return
	var g := cam.screen_to_ground(get_viewport().get_mouse_position())
	var d := Vector2(g.x / T - you_display.x, g.z / T - you_display.y)
	if d.length() > 0.2:
		aim = d.normalized()


func _update_fire() -> void:
	var want := false
	if not hud.login_panel.visible:
		want = Input.is_mouse_button_pressed(MOUSE_BUTTON_LEFT) or Input.get_joy_axis(0, JOY_AXIS_TRIGGER_RIGHT) > 0.25 or Config.fire
	if want and time - last_shot >= Protocol.GUN_FIRE_MS / 1000.0:
		last_shot = time
		Net.send({"type": "shoot", "dx": aim.x, "dz": aim.y})
		fx.fire(you_display.x * T, you_display.y * T, aim.x, aim.y)
		sfx.gunshot(0.8)
		aim_active_until = time + 2.0
	if firing and not want:
		sfx.gun_tail(0.8)
	firing = want


# ---------------------------------------------------------------- bucle

func _process(dt: float) -> void:
	var _t0 := Time.get_ticks_usec()
	_process_game(dt)
	if Config.bench and time - joined_at > 1.0:
		_bench_cpu += (Time.get_ticks_usec() - _t0) / 1000.0


func _process_game(dt: float) -> void:
	time += dt
	hud.fps_label.text = "%d FPS · calidad %d/%d" % [Engine.get_frames_per_second(), Quality.TIERS.size() - quality.tier, Quality.TIERS.size()]
	hud.show_hour(lighting.get_hour())
	if you.is_empty() or screen.is_empty():
		return
	if time - joined_at > 1.0:
		_bench_frames += 1
		_bench_time += dt
		if Config.bench:
			var vp := get_viewport().get_viewport_rid()
			_bench_gpu += RenderingServer.viewport_get_measured_render_time_gpu(vp)
			_bench_rcpu += RenderingServer.viewport_get_measured_render_time_cpu(vp)
	_send_dirs(_read_dirs())
	_update_aim()
	_update_fire()

	you_display.x = lerp_towards(you_display.x, float(you.x), dt)
	you_display.y = lerp_towards(you_display.y, float(you.y), dt)
	stride_acc += you_display.distance_to(last_you)
	last_you = you_display
	if stride_acc >= STRIDE:
		stride_acc = 0.0
		sfx.step(0.6)

	var sx := int(screen.sx)
	var sy := int(screen.sy)
	var zox := sx * W
	var zoy := sy * H
	var ents: Array = []
	var dots: Array = []
	var face = null
	if firing or time < aim_active_until:
		face = aim
	var me := {"id": "you", "x": you_display.x * T, "z": you_display.y * T, "variant": 0, "scale": 1.0, "kind": People.KIND_PLAYER}
	if face != null:
		me.face = face
	ents.append(me)
	for u in others:
		var o: Dictionary = others[u]
		var p: Dictionary = o.p
		o.x = lerp_towards(o.x, (int(p.sx) - sx) * W + float(p.x), dt)
		o.y = lerp_towards(o.y, (int(p.sy) - sy) * H + float(p.y), dt)
		ents.append({"id": "p:" + u, "x": o.x * T, "z": o.y * T, "variant": o.variant, "scale": 1.0, "kind": People.KIND_OTHER})
		o.label.position = Vector3(o.x * T, 0.85, o.y * T)
		dots.append([Vector2(zox + o.x, zoy + o.y), Color("3ba0e0"), 1.6])
	for id in zombie_display:
		var d: Vector2 = zombie_display[id]
		var t: Vector3 = zombie_targets.get(id, Vector3(d.x, d.y, 0.0))
		d.x = lerp_towards(d.x, t.x, dt, 14.0)
		d.y = lerp_towards(d.y, t.y, dt, 14.0)
		zombie_display[id] = d
		var giant := t.z > 0.5
		ents.append({"id": "z%d" % id, "x": (d.x - zox) * T, "z": (d.y - zoy) * T, "variant": People.ZOMBIE_BASE + id % People.ZOMBIE_VARIANTS,
			"scale": Protocol.GIANT_SCALE if giant else 1.0, "kind": People.KIND_GIANT if giant else People.KIND_ZOMBIE})
		dots.append([d, Color("ff8a1a") if giant else Color("e04040"), 2.2 if giant else 1.0])
	var ks: Array = []
	for c in corpses:
		var cx: float = c.gx - zox
		var cz: float = c.gy - zoy
		if absf(cx - you_display.x) > 70.0 or absf(cz - you_display.y) > 50.0:
			continue
		ks.append({"x": cx * T, "z": cz * T, "variant": c.variant, "pose": c.pose, "scale": c.scale})
	people.update(ents, ks, cam)

	var dn := lighting.day_night()
	RenderingServer.global_shader_parameter_set("sprite_light", 1.0 - dn.x * 0.55)
	RenderingServer.global_shader_parameter_set("sprite_flash", fx.flash_uniform())
	lighting.update(you_display.x * T, you_display.y * T)
	StreetFurniture.update_signals(time)
	cam.follow(you_display.x * T, you_display.y * T, time, dt)
	_update_cutaway()
	var facing := atan2(aim.x, aim.y)
	hud.minimap.update_view(zox + you_display.x, zoy + you_display.y, facing, cam.yaw, dots)
	_maybe_capture()


## Franja de pantalla del personaje (desde su cabeza hacia abajo, 70 % del ancho).
func _update_cutaway() -> void:
	# en píxeles del render 3D (que puede ir a menor resolución que la ventana)
	var vp := get_viewport()
	var k := vp.scaling_3d_scale
	var size := vp.get_visible_rect().size * k
	var head := cam.unproject_position(Vector3(you_display.x * T, 0.8, you_display.y * T)) * k
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
	if Config.bench and _bench_frames > 0:
		print("BENCH scripts %.2f ms · render CPU %.2f ms · GPU %.2f ms · dibujos %d · primitivas %d" % [_bench_cpu / _bench_frames, _bench_rcpu / _bench_frames, _bench_gpu / _bench_frames, Performance.get_monitor(Performance.RENDER_TOTAL_DRAW_CALLS_IN_FRAME), Performance.get_monitor(Performance.RENDER_TOTAL_PRIMITIVES_IN_FRAME)])
	print("captura guardada en %s · %d FPS (media %.1f) · calidad %d · %d zombis" % [path, Engine.get_frames_per_second(), _bench_frames / maxf(_bench_time, 0.001), quality.tier, zombie_display.size()])
	get_tree().quit()
