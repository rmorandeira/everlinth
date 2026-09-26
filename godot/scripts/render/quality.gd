class_name Quality
extends Node
## Calidad adaptativa (como en la web): se miden los FPS reales; si bajan de ~30 se
## pasa al siguiente escalón (menos resolución interna con reescalado FSR, sin
## oclusión ambiental, sin bloom, sombras más pequeñas, sin MSAA); si sobra
## rendimiento un rato, se vuelve a subir. Así se mantienen los 30 FPS.

const TIERS := [
	{"scale": 0.8, "ssao": true, "glow": true, "shadow": 4096, "msaa": Viewport.MSAA_2X},
	{"scale": 0.72, "ssao": true, "glow": true, "shadow": 4096, "msaa": Viewport.MSAA_2X},
	{"scale": 0.72, "ssao": false, "glow": true, "shadow": 2048, "msaa": Viewport.MSAA_2X},
	{"scale": 0.72, "ssao": false, "glow": false, "shadow": 2048, "msaa": Viewport.MSAA_DISABLED},
	{"scale": 0.6, "ssao": false, "glow": false, "shadow": 1024, "msaa": Viewport.MSAA_DISABLED},
	{"scale": 0.5, "ssao": false, "glow": false, "shadow": 1024, "msaa": Viewport.MSAA_DISABLED},
]

var env: Environment
var tier := 0
var fps := 60.0
var _acc := 0.0
var _frames := 0
var _good := 0
var _cooldown := 0


func _ready() -> void:
	# Oclusión ambiental a media resolución y calidad baja; sombras de borde duro
	# (el filtro suave apenas se nota a esta distancia y cuesta muchas muestras).
	RenderingServer.environment_set_ssao_quality(RenderingServer.ENV_SSAO_QUALITY_LOW, true, 0.5, 2, 50.0, 300.0)
	RenderingServer.directional_soft_shadow_filter_set_quality(RenderingServer.SHADOW_QUALITY_HARD)
	_apply()


func _apply() -> void:
	var t: Dictionary = TIERS[tier]
	var vp := get_viewport()
	vp.scaling_3d_mode = Viewport.SCALING_3D_MODE_FSR if t.scale < 0.99 else Viewport.SCALING_3D_MODE_BILINEAR
	vp.scaling_3d_scale = t.scale
	vp.msaa_3d = t.msaa
	if env:
		env.ssao_enabled = t.ssao
		env.glow_enabled = t.glow
	RenderingServer.directional_shadow_atlas_set_size(t.shadow, true)


func _process(dt: float) -> void:
	if dt > 0.5:
		return # pausas largas (ventana oculta) no cuentan
	_acc += dt
	_frames += 1
	if _acc < 1.0:
		return
	fps = _frames / _acc
	_acc = 0.0
	_frames = 0
	if _cooldown > 0:
		_cooldown -= 1
		return
	if fps < 31.0 and tier < TIERS.size() - 1:
		tier += 1
		_good = 0
		_cooldown = 1
		_apply()
	elif fps > 52.0 and tier > 0:
		_good += 1
		if _good >= 5:
			tier -= 1
			_good = 0
			_cooldown = 2
			_apply()
	else:
		_good = 0
