class_name Lighting
extends Node3D
## Luz del día y la noche (puerto de lighting3d.ts + daynight.ts): el sol recorre el
## cielo con la hora (sale por el este a las 6, se pone por el oeste a las 18, nunca
## por debajo de ~35° para no dejar la ciudad en sombra); de noche, luna azulada alta.
## Luz de relleno de cielo (azulada desde arriba, cálida rebotada desde el suelo),
## niebla por distancia hacia el fondo, oclusión ambiental y bloom suave.

const DAY_SKY := Color("8fc7e8")
const NIGHT_SKY := Color("05070f")
const GLOW_TINT := Color("ff8c3c")
const NIGHT_AMBIENT := Color("6b7fb8")
const MOON := Color("9fb4e8")
const GLOW_SUN := Color("ffb066")
const CAMERA_DIST := IsoCamera.DIST
const FOG_RADIUS := 40.0

var sun := DirectionalLight3D.new()
var env := Environment.new()
var sky_mat := ProceduralSkyMaterial.new()
## Hora fijada a mano (0-24) o < 0 para la hora real.
var hour_override := -1.0


func _ready() -> void:
	env.background_mode = Environment.BG_COLOR
	env.background_color = DAY_SKY
	# Luz ambiente "hemisférica": cielo arriba, suelo cálido abajo.
	var sky := Sky.new()
	sky.sky_material = sky_mat
	env.sky = sky
	env.ambient_light_source = Environment.AMBIENT_SOURCE_COLOR
	env.reflected_light_source = Environment.REFLECTION_SOURCE_SKY
	env.tonemap_mode = Environment.TONE_MAPPER_LINEAR
	# Niebla hacia el fondo (la cámara está a CAMERA_DIST del personaje).
	env.fog_enabled = true
	env.fog_mode = Environment.FOG_MODE_DEPTH
	env.fog_density = 1.0
	env.fog_sky_affect = 0.0
	# Oclusión ambiental (contacto entre edificios y suelo, esquinas, bajos de coches).
	env.ssao_enabled = true
	env.ssao_radius = 0.9
	env.ssao_intensity = 1.6
	env.ssao_power = 1.4
	env.ssao_detail = 0.6
	# Bloom suave (farolas, ventanas, fogonazos).
	env.glow_enabled = true
	env.glow_intensity = 0.55
	env.glow_strength = 0.9
	env.glow_bloom = 0.0
	env.glow_hdr_threshold = 0.88
	env.glow_blend_mode = Environment.GLOW_BLEND_MODE_SOFTLIGHT
	var we := WorldEnvironment.new()
	we.environment = env
	add_child(we)

	sun.shadow_enabled = true
	# Cámara ortográfica a CAMERA_DIST: las divisiones de sombra se concentran en el
	# tramo de distancias donde está la escena visible (~35-80).
	sun.directional_shadow_mode = DirectionalLight3D.SHADOW_PARALLEL_4_SPLITS
	sun.directional_shadow_max_distance = 100.0
	sun.directional_shadow_split_1 = 0.42
	sun.directional_shadow_split_2 = 0.55
	sun.directional_shadow_split_3 = 0.72
	sun.directional_shadow_blend_splits = true
	sun.shadow_bias = 0.06
	sun.shadow_normal_bias = 1.5
	add_child(sun)


func get_hour() -> float:
	if hour_override >= 0.0:
		return hour_override
	var t := Time.get_time_dict_from_system()
	return t.hour + t.minute / 60.0


static func _tri(h: float, center: float, width: float) -> float:
	return maxf(0.0, 1.0 - absf(h - center) / width)


## darkness: 0 pleno día → 1 noche cerrada; glow: resplandor de amanecer/atardecer.
func day_night() -> Vector2:
	var h := get_hour()
	var darkness := 1.0
	if h >= 7.0 and h < 18.0:
		darkness = 0.0
	elif h >= 18.0 and h < 20.0:
		darkness = (h - 18.0) / 2.0
	elif h >= 5.0 and h < 7.0:
		darkness = 1.0 - (h - 5.0) / 2.0
	var glow := maxf(_tri(h, 6.0, 1.5), _tri(h, 19.0, 1.5)) * (1.0 - darkness * 0.3)
	return Vector2(darkness, glow)


func update(_px: float, _pz: float) -> void:
	var dn := day_night()
	var darkness := dn.x
	var glow := dn.y
	var h := get_hour()
	var day_t := clampf((h - 6.0) / 12.0, 0.0, 1.0)
	var is_day := h >= 6.0 and h <= 18.0
	var az := PI * (1.0 - day_t) if is_day else PI * 0.35
	var elev := lerpf(0.6, 1.25, sin(PI * day_t)) if is_day else 1.1
	var R := 26.0
	var to_sun := Vector3(cos(az) * cos(elev) * R, sin(elev) * R, sin(az) * cos(elev) * R * 0.7 + 4.0)
	sun.transform = Transform3D(Basis.looking_at(-to_sun.normalized(), Vector3.UP), Vector3.ZERO)

	var sky := NIGHT_SKY.lerp(DAY_SKY, 1.0 - darkness)
	if glow > 0.01:
		sky = sky.lerp(GLOW_TINT, glow * 0.35)
	env.background_color = sky
	env.fog_light_color = sky

	# Luz hemisférica de la web (cielo dfe9ff, suelo 9a8a74): su media para las
	# fachadas, algo inclinada hacia el cielo (las azoteas y el suelo miran arriba).
	# (de noche solo el cielo se vuelve azulado; el rebote del suelo sigue cálido)
	env.ambient_light_color = Color("dfe9ff").lerp(NIGHT_AMBIENT, darkness).lerp(Color("9a8a74"), 0.4)
	# three.js divide la luz difusa entre π (BRDF de Lambert) y Godot no: mismas
	# intensidades que la web, divididas entre π.
	env.ambient_light_energy = lerpf(1.05, 0.55, darkness) / PI
	sun.light_energy = lerpf(1.9, 0.6, darkness) / PI
	sun.light_color = Color.WHITE.lerp(GLOW_SUN, glow).lerp(MOON, darkness)

	env.fog_depth_begin = CAMERA_DIST + FOG_RADIUS * 0.15
	env.fog_depth_end = CAMERA_DIST + FOG_RADIUS * 1.42

	RenderingServer.global_shader_parameter_set("win_glow", smoothstep(0.15, 0.85, darkness) * 0.45 + glow * 0.08)
