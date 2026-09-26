class_name Hud
extends CanvasLayer
## Interfaz (como la web): login, nombre/nivel/XP y barra de vida arriba a la
## izquierda, interruptor de zombis (tecla Z) y control de la hora del día (0-24 h,
## "Real" vuelve a la hora del reloj) arriba a la derecha, medidor de FPS (F3) y
## minimapa abajo a la izquierda. Los ajustes se recuerdan entre sesiones.

signal join_requested(username: String, server: String)
signal zombies_toggled(enabled: bool)
signal hour_changed(hour: float) # < 0 = hora real

const SETTINGS := "user://ajustes.cfg"

var login_panel := PanelContainer.new()
var name_edit := LineEdit.new()
var server_edit := LineEdit.new()
var status_label := Label.new()
var stats := Label.new()
var hp_bar := ProgressBar.new()
var zombie_toggle := CheckButton.new()
var hour_slider := HSlider.new()
var hour_label := Label.new()
var real_btn := Button.new()
var fps_label := Label.new()
var discovery := Label.new()
var minimap := Minimap.new()
var _cfg := ConfigFile.new()


func _ready() -> void:
	layer = 1
	_cfg.load(SETTINGS)
	# servidor recordado (salvo que venga en la línea de comandos)
	if not Config.server_from_args:
		Config.server_url = _cfg.get_value("juego", "servidor", Config.server_url)

	login_panel.set_anchors_and_offsets_preset(Control.PRESET_CENTER)
	var box := VBoxContainer.new()
	box.custom_minimum_size = Vector2(320, 0)
	var title := Label.new()
	title.text = "EVERLINTH"
	title.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	title.add_theme_font_size_override("font_size", 32)
	box.add_child(title)
	name_edit.placeholder_text = "Nombre del personaje"
	name_edit.text = _cfg.get_value("juego", "nombre", "")
	name_edit.text_submitted.connect(func(_t: String) -> void: _join())
	box.add_child(name_edit)
	server_edit.placeholder_text = "Servidor (ws://host:3000)"
	server_edit.text = Config.server_url
	server_edit.text_submitted.connect(func(_t: String) -> void: _join())
	box.add_child(server_edit)
	var btn := Button.new()
	btn.text = "Entrar"
	btn.pressed.connect(_join)
	box.add_child(btn)
	status_label.autowrap_mode = TextServer.AUTOWRAP_WORD
	box.add_child(status_label)
	login_panel.add_child(box)
	add_child(login_panel)

	var tl := VBoxContainer.new()
	tl.position = Vector2(14, 10)
	hp_bar.custom_minimum_size = Vector2(200, 10)
	hp_bar.show_percentage = false
	var fill := StyleBoxFlat.new()
	fill.bg_color = Color("d64545")
	hp_bar.add_theme_stylebox_override("fill", fill)
	var bg := StyleBoxFlat.new()
	bg.bg_color = Color(0, 0, 0, 0.5)
	hp_bar.add_theme_stylebox_override("background", bg)
	tl.add_child(hp_bar)
	stats.add_theme_color_override("font_shadow_color", Color.BLACK)
	tl.add_child(stats)
	add_child(tl)

	var tr := VBoxContainer.new()
	tr.set_anchors_and_offsets_preset(Control.PRESET_TOP_RIGHT)
	tr.position += Vector2(-270, 8)
	tr.custom_minimum_size = Vector2(260, 0)
	zombie_toggle.text = "Zombis"
	zombie_toggle.button_pressed = _cfg.get_value("juego", "zombis", true)
	zombie_toggle.toggled.connect(_on_zombies)
	zombie_toggle.focus_mode = Control.FOCUS_NONE
	tr.add_child(zombie_toggle)
	var hrow := HBoxContainer.new()
	var hl := Label.new()
	hl.text = "Hora"
	hrow.add_child(hl)
	hour_slider.min_value = 0.0
	hour_slider.max_value = 24.0
	hour_slider.step = 0.25
	hour_slider.custom_minimum_size = Vector2(120, 0)
	hour_slider.focus_mode = Control.FOCUS_NONE
	hour_slider.value_changed.connect(func(v: float) -> void: _set_hour(v))
	hrow.add_child(hour_slider)
	hour_label.custom_minimum_size = Vector2(44, 0)
	hrow.add_child(hour_label)
	real_btn.text = "Real"
	real_btn.focus_mode = Control.FOCUS_NONE
	real_btn.pressed.connect(func() -> void: _set_hour(-1.0))
	hrow.add_child(real_btn)
	tr.add_child(hrow)
	fps_label.add_theme_color_override("font_color", Color("99ff99"))
	fps_label.add_theme_color_override("font_shadow_color", Color.BLACK)
	tr.add_child(fps_label)
	add_child(tr)

	discovery.set_anchors_and_offsets_preset(Control.PRESET_CENTER_TOP)
	discovery.position.y += 60
	discovery.add_theme_color_override("font_color", Color("f0c419"))
	discovery.add_theme_color_override("font_shadow_color", Color.BLACK)
	discovery.visible = false
	add_child(discovery)

	minimap.set_anchors_and_offsets_preset(Control.PRESET_BOTTOM_LEFT)
	minimap.position = Vector2(14, -184)
	add_child(minimap)
	set_playing(false)


## Aplica los ajustes guardados (llamar cuando la escena ya está lista).
func restore() -> void:
	var h: float = _cfg.get_value("juego", "hora", -1.0)
	if Config.hour >= 0.0:
		h = Config.hour
	_set_hour(h)


func _join() -> void:
	var n := name_edit.text.strip_edges()
	if n == "":
		status_label.text = "Escribe un nombre."
		return
	var srv := server_edit.text.strip_edges()
	if srv == "":
		srv = Config.server_url
	if not srv.begins_with("ws://") and not srv.begins_with("wss://"):
		srv = "ws://" + srv
	_cfg.set_value("juego", "nombre", n)
	_cfg.set_value("juego", "servidor", srv)
	_cfg.save(SETTINGS)
	join_requested.emit(n, srv)


func _on_zombies(on: bool) -> void:
	_cfg.set_value("juego", "zombis", on)
	_cfg.save(SETTINGS)
	zombies_toggled.emit(on)


func _set_hour(h: float) -> void:
	_cfg.set_value("juego", "hora", h)
	_cfg.save(SETTINGS)
	real_btn.disabled = h < 0.0
	if h >= 0.0 and not is_equal_approx(hour_slider.value, h):
		hour_slider.set_value_no_signal(h)
	hour_changed.emit(h)


func show_hour(h: float) -> void:
	hour_label.text = "%02d:%02d" % [int(h) % 24, int(roundf((h - floorf(h)) * 60.0)) % 60]
	if real_btn.disabled:
		hour_slider.set_value_no_signal(h)


func set_playing(on: bool) -> void:
	login_panel.visible = not on
	for c in get_children():
		if c != login_panel:
			c.visible = on and c != discovery
	if not on:
		name_edit.grab_focus()


func set_stats(you: Dictionary) -> void:
	hp_bar.max_value = float(you.maxHp)
	hp_bar.value = float(you.hp)
	stats.text = "%s · Nv %d · XP %d · (%d,%d)" % [you.username, int(you.level), int(you.xp), int(you.sx), int(you.sy)]


func show_discovery(tier: String, xp: int) -> void:
	discovery.text = "● Pantalla descubierta (%s) +%d XP" % [tier, xp]
	discovery.visible = true
	get_tree().create_timer(3.5).timeout.connect(func() -> void: discovery.visible = false)


func _unhandled_input(ev: InputEvent) -> void:
	if login_panel.visible or not (ev is InputEventKey) or not ev.pressed or ev.echo:
		return
	match ev.physical_keycode:
		KEY_Z:
			zombie_toggle.button_pressed = not zombie_toggle.button_pressed
		KEY_F3:
			fps_label.visible = not fps_label.visible
