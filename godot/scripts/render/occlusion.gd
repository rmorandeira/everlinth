class_name Occlusion
## Halo de visión del personaje (ver shaders/occlusion.gdshaderinc):
## - update(): cada fotograma, posición del personaje en el mundo y en pantalla, y radio
##   del halo, para los shaders de los edificios.
## - edge_bary(): coordenadas baricéntricas por vértice con las aristas interiores
##   anuladas, para dibujar solo las aristas reales del modelo (la silueta de lo que se
##   oculta), sin las diagonales de los triángulos de una misma cara.

const HALO_UNITS := 2.6 # radio del halo, en unidades de mundo (≈ 8 m) a la escala de la cámara
const SOFT := 0.25      # fracción del radio en la que se funde el borde


static func update(cam: Camera3D, char_pos: Vector3, scale3d: float) -> void:
	var head := cam.unproject_position(char_pos) * scale3d
	# radio en píxeles: HALO_UNITS a la escala actual de la cámara ortográfica
	var vp_h := cam.get_viewport().get_visible_rect().size.y * scale3d
	var r := HALO_UNITS / cam.size * vp_h
	RenderingServer.global_shader_parameter_set("occ_char", Vector4(char_pos.x, char_pos.y, char_pos.z, 1.0))
	RenderingServer.global_shader_parameter_set("occ_halo", Vector4(head.x, head.y, r, r * SOFT))
	RenderingServer.global_shader_parameter_set("cut_cam_fwd", cam.global_transform.basis.z)


## v: vértices sin índices (tres por triángulo). Devuelve RGBA float por vértice (para
## ARRAY_CUSTOM1): xyz baricéntricas, w = 1. La componente de una arista compartida con
## un triángulo coplanario (interior de una cara) se fija a 1: esa arista no se dibuja.
static func edge_bary(v: PackedVector3Array) -> PackedFloat32Array:
	var n := v.size() / 3
	var out := PackedFloat32Array()
	out.resize(v.size() * 4)
	var normals := PackedVector3Array()
	normals.resize(n)
	var edges := {} # arista (clave de posiciones) -> [triángulo, ...]
	for t in n:
		var a := v[t * 3]
		var b := v[t * 3 + 1]
		var c := v[t * 3 + 2]
		normals[t] = (b - a).cross(c - a).normalized()
		for k in 3:
			var key := _edge_key(v[t * 3 + (k + 1) % 3], v[t * 3 + (k + 2) % 3])
			if edges.has(key):
				edges[key].append(t)
			else:
				edges[key] = [t]
	for t in n:
		var hide := [false, false, false]
		for k in 3:
			var key := _edge_key(v[t * 3 + (k + 1) % 3], v[t * 3 + (k + 2) % 3])
			for o in edges[key]:
				if o != t and normals[o].dot(normals[t]) > 0.995:
					hide[k] = true
		for k in 3:
			var i := (t * 3 + k) * 4
			for c in 3:
				out[i + c] = 1.0 if (c == k or hide[c]) else 0.0
			out[i + 3] = 1.0
	return out


static func _edge_key(a: Vector3, b: Vector3) -> String:
	var ka := "%d,%d,%d" % [roundi(a.x * 500.0), roundi(a.y * 500.0), roundi(a.z * 500.0)]
	var kb := "%d,%d,%d" % [roundi(b.x * 500.0), roundi(b.y * 500.0), roundi(b.z * 500.0)]
	return ka + "|" + kb if ka < kb else kb + "|" + ka


## Formato de superficie con ARRAY_CUSTOM1 en RGBA float (y CUSTOM0 si se pide).
static func format(with_custom0 := false) -> int:
	var f := Mesh.ARRAY_CUSTOM_RGBA_FLOAT << Mesh.ARRAY_FORMAT_CUSTOM1_SHIFT
	if with_custom0:
		f |= Mesh.ARRAY_CUSTOM_RGBA_FLOAT << Mesh.ARRAY_FORMAT_CUSTOM0_SHIFT
	return f
