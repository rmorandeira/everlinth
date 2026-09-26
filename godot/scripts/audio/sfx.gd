class_name Sfx
extends Node
## Sonido del juego (puerto de audio.ts): pasos (recortes cortos al azar, sin repetir
## el anterior, con variación de tono y volumen), ametralladora (cada disparo es uno de
## los golpes de la ráfaga grabada, al soltar suena la cola de eco) y risa tras una
## racha de muertes (acelerada, más aguda).

const GUN_SHOTS := [0.025, 0.105, 0.19, 0.28, 0.36]
const SHOT_LEN := 0.11
const TAIL_START := 0.86

var _steps: Array[AudioStream] = []
var _gun: AudioStream
var _laugh: AudioStream
var _pool: Array[AudioStreamPlayer] = []
var _stop_at := {} # player -> segundo de parada
var _last_step := -1


func _ready() -> void:
	for i in range(1, 9):
		var s: AudioStream = load("res://assets/sounds/step-%d.wav" % i)
		if s:
			_steps.append(s)
	_gun = load("res://assets/sounds/machinegun.mp3")
	_laugh = load("res://assets/sounds/laugh.mp3")
	for i in 16:
		var p := AudioStreamPlayer.new()
		add_child(p)
		_pool.append(p)


func _player() -> AudioStreamPlayer:
	for p in _pool:
		if not p.playing:
			return p
	return _pool[randi() % _pool.size()]


func _play(stream: AudioStream, from: float, dur: float, volume: float, pitch: float) -> void:
	if stream == null or volume <= 0.001:
		return
	var p := _player()
	p.stream = stream
	p.volume_db = linear_to_db(volume * 0.8)
	p.pitch_scale = pitch
	p.play(from)
	if dur > 0.0:
		_stop_at[p] = Time.get_ticks_msec() / 1000.0 + dur / pitch
	else:
		_stop_at.erase(p)


func _process(_dt: float) -> void:
	var now := Time.get_ticks_msec() / 1000.0
	for p in _stop_at.keys():
		if now >= _stop_at[p]:
			p.stop()
			_stop_at.erase(p)


func step(volume := 1.0) -> void:
	if _steps.is_empty():
		return
	var i := randi() % _steps.size()
	if i == _last_step and _steps.size() > 1:
		i = (i + 1) % _steps.size()
	_last_step = i
	_play(_steps[i], 0.0, 0.0, volume * (0.75 + randf() * 0.25), 1.1 + randf() * 0.16)


func gunshot(volume := 1.0) -> void:
	_play(_gun, GUN_SHOTS[randi() % GUN_SHOTS.size()], SHOT_LEN, volume, 0.96 + randf() * 0.08)


func gun_tail(volume := 1.0) -> void:
	_play(_gun, TAIL_START, 0.0, volume * 0.9, 1.0)


func laugh(volume := 1.0) -> void:
	_play(_laugh, 0.0, 0.0, volume, 1.3)


## Explosión: la cola de eco de la ametralladora muy grave suena a estruendo.
func boom(volume := 1.0) -> void:
	_play(_gun, TAIL_START - 0.1, 0.0, volume, 0.45)
	_play(_gun, GUN_SHOTS[0], 0.3, volume * 0.9, 0.35)
