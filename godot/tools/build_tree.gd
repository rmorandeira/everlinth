extends SceneTree
## Genera "Tree Large" (kits retro y suburban) como un arce real de calle, estilo foto de
## referencia: tronco recto de corteza oscura y agrietada, cruz a ~4 m, ramas que suben
## abiertas y una copa ovalada densa de hojas de arce verde lima (hojas reales de
## ambientCG horneadas en racimos, ver trees.gd). Exporta GLB con texturas dentro:
##   godot --headless --path godot -s res://tools/build_tree.gd
## Las tarjetas de hojas van a dos caras (el shader del juego no desactiva el culling) y
## con normales esféricas (la copa se ilumina como un volumen). Se modela en metros; el
## nodo lleva la escala de cada kit (render = modelo × escala del kit, 1 unidad = 3 m).

const OUT := {"retro": 2.1, "suburban": 2.7}
const H := 13.0          # altura total (m)
const FORK := 4.2        # cruz
const CROWN_C := Vector3(0.2, 8.6, 0.0)
const CROWN_R := Vector3(4.4, 4.9, 4.2) # semiejes de la copa
const CARDS := 600

var bark := SurfaceTool.new()
var leaf := SurfaceTool.new()
var r := RandomNumberGenerator.new()


func _init() -> void:
	r.seed = 20260927
	bark.begin(Mesh.PRIMITIVE_TRIANGLES)
	leaf.begin(Mesh.PRIMITIVE_TRIANGLES)
	var tips := _branches()
	_leaves(tips)
	bark.generate_tangents()
	leaf.generate_tangents()
	var mesh := bark.commit()
	mesh.surface_set_material(0, _bark_mat())
	leaf.commit(mesh)
	mesh.surface_set_material(1, _leaf_mat())
	for kit in OUT:
		var k: float = 1.0 / (3.0 * float(OUT[kit]))
		var root := Node3D.new()
		root.name = "tree-large"
		var mi := MeshInstance3D.new()
		mi.name = "tree-large"
		mi.mesh = mesh
		mi.scale = Vector3(k, k, k)
		root.add_child(mi)
		mi.owner = root
		for path in ["../client/public/models/%s/tree-large.glb" % kit, "res://assets/models/%s/tree-large.glb" % kit]:
			var doc := GLTFDocument.new()
			var state := GLTFState.new()
			var err := doc.append_from_scene(root, state)
			var abs_path := ProjectSettings.globalize_path(path) if path.begins_with("res://") else ProjectSettings.globalize_path("res://").path_join(path)
			if err == OK:
				err = doc.write_to_filesystem(state, abs_path)
			print("%s → %s" % [path, "ok" if err == OK else "error %d" % err])
		root.free()
	print("triángulos: corteza %d · hojas %d" % [mesh.surface_get_array_len(0) / 3, mesh.surface_get_array_len(1) / 3])
	quit()


# ------------------------------------------------------------------ materiales

func _flat_normal() -> ImageTexture:
	var img := Image.create_empty(4, 4, false, Image.FORMAT_RGBA8)
	img.fill(Color(0.5, 0.5, 1.0))
	return ImageTexture.create_from_image(img)


func _img(path: String) -> Image:
	var tex: Texture2D = load(path)
	var img := tex.get_image()
	if img.is_compressed():
		img.decompress()
	img.clear_mipmaps()
	img.convert(Image.FORMAT_RGBA8)
	return img


func _bark_mat() -> StandardMaterial3D:
	var m := StandardMaterial3D.new()
	m.resource_name = "corteza"
	# corteza de la foto: gris casi negro, muy agrietada
	var col := _img("res://assets/textures/trees/Bark012_Color.png")
	col.adjust_bcs(0.62, 1.25, 0.35)
	col.generate_mipmaps()
	m.albedo_texture = ImageTexture.create_from_image(col)
	var nrm := _img("res://assets/textures/trees/Bark012_NormalGL.png")
	nrm.generate_mipmaps()
	m.normal_enabled = true
	m.normal_texture = ImageTexture.create_from_image(nrm)
	m.roughness = 0.95
	return m


func _leaf_mat() -> StandardMaterial3D:
	var m := StandardMaterial3D.new()
	m.resource_name = "hojas"
	var src: Texture2D = Trees.leaf_texture("LeafSet027")
	var img := src.get_image()
	img.clear_mipmaps()
	img.convert(Image.FORMAT_RGBA8)
	# arce de verano: el atlas de otoño pasa a verde lima, conservando el detalle
	var data := img.get_data()
	for i in range(0, data.size(), 4):
		var l := (data[i] * 0.3 + data[i + 1] * 0.55 + data[i + 2] * 0.15) / 255.0
		data[i] = clampi(int(l * 0.56 * 1.7 * 255.0), 0, 255)
		data[i + 1] = clampi(int(l * 0.74 * 1.7 * 255.0), 0, 255)
		data[i + 2] = clampi(int(l * 0.2 * 1.7 * 255.0), 0, 255)
	img.set_data(img.get_width(), img.get_height(), false, Image.FORMAT_RGBA8, data)
	img.generate_mipmaps()
	m.albedo_texture = ImageTexture.create_from_image(img)
	m.transparency = BaseMaterial3D.TRANSPARENCY_ALPHA_SCISSOR
	m.alpha_scissor_threshold = 0.45
	m.cull_mode = BaseMaterial3D.CULL_DISABLED
	m.vertex_color_use_as_albedo = true
	m.normal_enabled = true
	m.normal_texture = _flat_normal()
	m.roughness = 0.8
	return m


# ------------------------------------------------------------------ geometría

func _crown(dir: Vector3, shell: float) -> Vector3:
	return CROWN_C + Vector3(dir.x * CROWN_R.x, dir.y * CROWN_R.y, dir.z * CROWN_R.z) * shell


## Tronco con líder hasta arriba, ramas principales, secundarias y ramillas. Devuelve
## las puntas (donde se agrupan las hojas).
func _branches() -> Array:
	var tips: Array = []
	# tronco: recto, algo más grueso en la base (raíces), el líder sigue hasta la copa
	var trunk: Array = []
	for i in 9:
		var t := float(i) / 8.0
		trunk.append(Vector3(sin(t * 2.0) * 0.12, t * (H - 1.6), cos(t * 1.7) * 0.06))
	Trees._tube(bark, trunk.slice(0, 5), 0.3, 0.2, 12)
	Trees._tube(bark, trunk.slice(4), 0.2, 0.04, 9)
	# ramas principales: salen de la cruz y del líder, abiertas hacia arriba
	var nb := 11
	for i in nb:
		var a := (float(i) + r.randf_range(-0.35, 0.35)) / nb * TAU
		var h := lerpf(FORK, H - 3.5, float(i) / nb) + r.randf_range(-0.4, 0.4)
		var start := Vector3(sin(h / (H - 1.6) * 2.0) * 0.12, h, 0.0)
		var up := r.randf_range(0.35, 0.9) - float(i) / nb * 0.2
		var dir := Vector3(cos(a), up, sin(a)).normalized()
		var end := _crown(dir, r.randf_range(0.65, 0.85))
		var pts := Trees._curve(start, end, r, 5, 0.5)
		var r0 := lerpf(0.13, 0.06, float(i) / nb)
		Trees._tube(bark, pts, r0, r0 * 0.3, 7)
		# secundarias desde el tramo medio y exterior
		for j in 3:
			var from: Vector3 = pts[2 + j]
			var d2 := (dir + Vector3(r.randf_range(-0.9, 0.9), r.randf_range(-0.1, 0.7), r.randf_range(-0.9, 0.9))).normalized()
			var e2 := _crown(d2, r.randf_range(0.8, 1.0))
			var p2 := Trees._curve(from, e2, r, 3, 0.25)
			Trees._tube(bark, p2, r0 * 0.4, r0 * 0.12, 5)
			tips.append(e2)
			# ramillas en la punta
			for k in 2:
				var e3: Vector3 = e2 + Vector3(r.randf_range(-0.9, 0.9), r.randf_range(-0.4, 0.8), r.randf_range(-0.9, 0.9))
				Trees._tube(bark, Trees._curve(p2[1], e3, r, 2, 0.1), r0 * 0.12, r0 * 0.05, 4)
				tips.append(e3)
		tips.append(end)
	return tips


## Tarjetas de racimos a dos caras: agrupadas junto a las puntas y repartidas por la capa
## exterior de la copa (más densa arriba y al sol).
func _leaves(tips: Array) -> void:
	for i in CARDS:
		var p: Vector3
		if i < tips.size() * 2:
			var t: Vector3 = tips[i % tips.size()]
			p = t + Vector3(r.randf_range(-0.9, 0.9), r.randf_range(-0.6, 0.8), r.randf_range(-0.9, 0.9))
		else:
			var dir := Vector3(r.randf_range(-1, 1), r.randf_range(-0.7, 1), r.randf_range(-1, 1)).normalized()
			p = _crown(dir, lerpf(0.3, 1.0, sqrt(r.randf())))
		# dentro del óvalo de la copa (nada suelto por fuera de la silueta)
		var rel := (p - CROWN_C) / CROWN_R
		if rel.length() > 1.0:
			p = CROWN_C + rel.normalized() * CROWN_R
			rel = rel.normalized()
		var shell := rel.length()
		# más oscuras hacia dentro y hacia abajo (sombra propia de la copa), color lineal
		var g := lerpf(0.5, 1.0, smoothstep(0.45, 1.0, shell)) * lerpf(0.72, 1.05, smoothstep(-0.9, 0.9, rel.y)) * r.randf_range(0.9, 1.08)
		var tint := Color(g, g, g * 0.95).srgb_to_linear()
		var nrm := rel.normalized()
		nrm = (nrm + Vector3.UP * 0.3).normalized()
		var size := r.randf_range(1.2, 1.8)
		var u := nrm.cross(Vector3.UP)
		if u.length() < 0.1:
			u = Vector3.RIGHT
		u = u.normalized().rotated(nrm, r.randf() * TAU)
		var v := nrm.cross(u).normalized()
		v = Basis(u, r.randf_range(-0.7, 0.7)) * v
		var hs := size * 0.5
		var q := [p - u * hs - v * hs, p + u * hs - v * hs, p + u * hs + v * hs, p - u * hs + v * hs]
		var uv := [Vector2(0, 1), Vector2(1, 1), Vector2(1, 0), Vector2(0, 0)]
		# las dos caras (con la misma normal esférica: se iluminan igual por delante y detrás)
		for k in [0, 2, 1, 0, 3, 2, 0, 1, 2, 0, 2, 3]:
			leaf.set_normal(nrm)
			leaf.set_color(tint)
			leaf.set_uv(uv[k])
			leaf.add_vertex(q[k])
