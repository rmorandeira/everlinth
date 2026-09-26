class_name IsoCamera
extends Camera3D
## Cámara ortográfica de la maqueta (igual que client/src/render3d/isoCamera.ts):
## yaw base de 45° con giros de 90° (Q/R), pitch fijo de 21°, zoom fijo, el
## personaje centrado en horizontal y al 40 % desde abajo, y una deriva lenta
## para que la cámara no se sienta clavada.

const BASE_YAW := PI / 4.0
const PITCH := deg_to_rad(21.0)
const DIST := 50.0
## Mitad del alto visible, en unidades de render (1 unidad = 3 m).
const VIEW_HALF_HEIGHT := 7.0
## Altura del personaje en pantalla, como fracción desde el borde inferior.
const PLAYER_SCREEN_Y := 0.4

var step := 0
var yaw := BASE_YAW


func _ready() -> void:
	projection = PROJECTION_ORTHOGONAL
	keep_aspect = KEEP_HEIGHT
	size = (Config.cenital if Config.cenital > 0.0 else VIEW_HALF_HEIGHT) * 2.0
	near = 0.1
	far = 500.0


func rotate_step(d: int) -> void:
	step = posmod(step + d, 4)


## Encuadra el punto del suelo (x, z) en unidades de render.
func follow(px: float, pz: float, t: float, dt: float) -> void:
	# yaw objetivo por el camino más corto (el paso 3 → 0 no da la vuelta entera)
	var goal := BASE_YAW + step * (PI / 2.0)
	while goal - yaw > PI:
		goal -= TAU
	while goal - yaw < -PI:
		goal += TAU
	yaw += (goal - yaw) * (1.0 - exp(-8.0 * dt))
	# Deriva: varias senoides de periodos largos y distintos, como un dron quieto.
	var y := yaw + sin(t * 0.13) * 0.018 + sin(t * 0.071 + 1.3) * 0.012
	var drift_x := sin(t * 0.11 + 0.4) * 0.22 + sin(t * 0.043) * 0.12
	var drift_z := cos(t * 0.093 + 2.1) * 0.22 + sin(t * 0.057 + 0.7) * 0.12
	var pitch := deg_to_rad(89.0) if Config.cenital > 0.0 else PITCH
	var dir := Vector3(cos(pitch) * cos(y), sin(pitch), cos(pitch) * sin(y))
	var target := Vector3(px + drift_x, 0.0, pz + drift_z)
	global_position = target + dir * DIST
	look_at(target, Vector3.UP)
	if Config.cenital <= 0.0:
		global_position += global_transform.basis.y * (0.5 - PLAYER_SCREEN_Y) * 2.0 * VIEW_HALF_HEIGHT


## Punto del suelo (y = 0) bajo una posición de pantalla, en unidades de render.
func screen_to_ground(p: Vector2) -> Vector3:
	var o := project_ray_origin(p)
	var d := project_ray_normal(p)
	if absf(d.y) < 1e-5:
		return o
	return o + d * (-o.y / d.y)
