class_name Trees
## Árboles detallados y ligeros, generados a partir de hojas y cortezas reales
## (ambientCG, CC0; assets/textures/trees):
## - Racimos de hojas: de cada atlas se recortan las hojas sueltas (componentes de su
##   máscara de opacidad) y se estampan, giradas y a varios tamaños, en una textura de
##   racimo con mipmaps. Cada tarjeta de la copa lleva un racimo.
## - Árbol: tronco y ramas (cilindros curvados y afilados con la corteza de su especie),
##   ramas secundarias hacia la copa y 70-120 tarjetas repartidas por la capa exterior
##   de la copa, con normales esféricas (la copa se ilumina como un volumen).
## Especies de A Coruña: plátano de sombra (calles), roble y haya (parques), ciprés/pino
## (montes) y tamarisco (paseo marítimo). Tres variantes por especie; malla en caché para
## MultiMesh (una llamada de dibujo por especie y variante).

const VARIANTS := 3
const SIZE := 0.78 # escala de todos los árboles colocados (algo más pequeños que el modelo)
const CLUSTER := 512

# altura (unidades: 1 = 3 m), radio del tronco, altura de la cruz, radios de la copa
# (horizontal, vertical), forma (0 esfera, 1 cono), hojas, corteza, tarjetas, tamaño de
# tarjeta, tono, reverdecer, ramas
const SPECIES := {
	"platano": {"h": 3.6, "r": 0.1, "fork": 1.35, "cr": 1.35, "cv": 1.15, "shape": 0, "leaf": "LeafSet027", "bark": "Bark004", "cards": 140, "card": 0.66, "tint": Color(0.95, 1.0, 0.9), "green": 0.85, "branches": 6},
	"roble": {"h": 3.1, "r": 0.12, "fork": 0.95, "cr": 1.45, "cv": 1.1, "shape": 0, "leaf": "LeafSet016", "bark": "Bark012", "cards": 145, "card": 0.66, "tint": Color(0.72, 0.85, 0.62), "green": 0.0, "branches": 7},
	"haya": {"h": 2.7, "r": 0.08, "fork": 0.9, "cr": 1.05, "cv": 1.0, "shape": 0, "leaf": "LeafSet005", "bark": "Bark004", "cards": 120, "card": 0.6, "tint": Color(0.9, 1.0, 0.88), "green": 0.0, "branches": 5},
	"pino": {"h": 4.2, "r": 0.1, "fork": 0.9, "cr": 0.95, "cv": 1.7, "shape": 1, "leaf": "LeafSet019", "bark": "Bark014", "cards": 100, "card": 0.6, "tint": Color(0.8, 0.92, 0.8), "green": 0.0, "branches": 8},
	"tamarisco": {"h": 1.8, "r": 0.07, "fork": 0.55, "cr": 0.95, "cv": 0.65, "shape": 0, "leaf": "LeafSet019", "bark": "Bark012", "cards": 95, "card": 0.55, "tint": Color(0.82, 0.9, 0.8), "green": 0.0, "branches": 5},
}

static var _meshes := {}
static var _leaf_tex := {}
static var _mats := {}


## Clave de instancia ("tree:especie:variante") para una posición (determinista).
static func key_for(species: String, gx: float, gy: float) -> String:
	var h := sin(gx * 12.9898 + gy * 78.233) * 43758.5453
	return "tree:%s:%d" % [species, int(floorf((h - floorf(h)) * VARIANTS)) % VARIANTS]


static func mesh_for_key(key: String) -> ArrayMesh:
	var p := key.split(":")
	return mesh(p[1], int(p[2]))


# ------------------------------------------------------------------ texturas

static func _img(path: String) -> Image:
	var tex: Texture2D = load(path)
	var img := tex.get_image()
	if img.is_compressed():
		img.decompress()
	img.clear_mipmaps()
	img.convert(Image.FORMAT_RGBA8)
	return img


## Racimo de hojas horneado a partir de un atlas de hojas sueltas.
static func leaf_texture(set: String) -> Texture2D:
	if _leaf_tex.has(set):
		return _leaf_tex[set]
	var col := _img("res://assets/textures/trees/%s_Color.png" % set)
	var op := _img("res://assets/textures/trees/%s_Opacity.png" % set)
	# a 512 (hojas de ~100 px) y la opacidad en el canal alfa (por bytes: rápido)
	col.resize(512, 512, Image.INTERPOLATE_BILINEAR)
	op.resize(512, 512, Image.INTERPOLATE_BILINEAR)
	op.convert(Image.FORMAT_L8)
	var rgba := col.get_data()
	var alpha := op.get_data()
	for i in alpha.size():
		rgba[i * 4 + 3] = alpha[i]
	col.set_data(512, 512, false, Image.FORMAT_RGBA8, rgba)
	var leaves := _find_leaves(col)
	var r := RandomNumberGenerator.new()
	r.seed = hash(set)
	var out := Image.create_empty(CLUSTER, CLUSTER, false, Image.FORMAT_RGBA8)
	out.fill(Color(0.2, 0.3, 0.12, 0.0)) # color de fondo verde (sin halos al filtrar)
	# variantes giradas de cada hoja (rotaciones de 90° y espejos, a dos tamaños)
	var stamps: Array[Image] = []
	for rect in leaves:
		var leaf := col.get_region(rect)
		for k in 4:
			for s in [0.55, 0.8]:
				var im: Image = leaf.duplicate()
				var long := maxf(im.get_width(), im.get_height())
				var target: float = CLUSTER * 0.2 * s
				im.resize(maxi(4, int(im.get_width() * target / long)), maxi(4, int(im.get_height() * target / long)), Image.INTERPOLATE_BILINEAR)
				if k & 1:
					im.rotate_90(CLOCKWISE)
				if k & 2:
					im.flip_x()
				stamps.append(im)
	if stamps.is_empty():
		return null
	# racimo: más denso en el centro, borde irregular
	var n := 70
	for i in n:
		var a := r.randf() * TAU
		var d := sqrt(r.randf()) * CLUSTER * 0.36
		var im: Image = stamps[r.randi() % stamps.size()]
		var p := Vector2i(int(CLUSTER * 0.5 + cos(a) * d - im.get_width() * 0.5), int(CLUSTER * 0.5 + sin(a) * d - im.get_height() * 0.5))
		# las del fondo, algo más oscuras (profundidad dentro del racimo)
		var dim := im.duplicate() as Image
		if i < n / 2:
			dim.adjust_bcs(0.72, 1.0, 1.0)
		out.blend_rect(dim, Rect2i(Vector2i.ZERO, dim.get_size()), p)
	out.generate_mipmaps()
	var tex := ImageTexture.create_from_image(out)
	_leaf_tex[set] = tex
	return tex


## Rectángulos de las hojas sueltas del atlas (componentes de la máscara de opacidad).
static func _find_leaves(img: Image) -> Array[Rect2i]:
	var S := 64
	var k := img.get_width() / S
	var mask := PackedByteArray()
	mask.resize(S * S)
	for y in S:
		for x in S:
			mask[y * S + x] = 1 if img.get_pixel(x * k + k / 2, y * k + k / 2).a > 0.3 else 0
	var seen := PackedByteArray()
	seen.resize(S * S)
	var out: Array[Rect2i] = []
	for i in S * S:
		if mask[i] == 0 or seen[i] == 1:
			continue
		var stack := [i]
		seen[i] = 1
		var lo := Vector2i(S, S)
		var hi := Vector2i(-1, -1)
		var count := 0
		while not stack.is_empty():
			var j: int = stack.pop_back()
			var p := Vector2i(j % S, j / S)
			lo = lo.min(p)
			hi = hi.max(p)
			count += 1
			for d in [Vector2i(1, 0), Vector2i(-1, 0), Vector2i(0, 1), Vector2i(0, -1)]:
				var q: Vector2i = p + d
				if q.x < 0 or q.y < 0 or q.x >= S or q.y >= S:
					continue
				var qi := q.y * S + q.x
				if mask[qi] == 1 and seen[qi] == 0:
					seen[qi] = 1
					stack.append(qi)
		if count < 6:
			continue
		var rect := Rect2i(lo * k - Vector2i(k, k), (hi - lo + Vector2i(3, 3)) * k)
		out.append(rect.intersection(Rect2i(0, 0, img.get_width(), img.get_height())))
	return out


static func leaf_mat(species: String) -> Material:
	var key := "leaf:" + species
	if not _mats.has(key):
		var sp: Dictionary = SPECIES[species]
		var m := ShaderMaterial.new()
		m.shader = load("res://shaders/tree_leaf.gdshader")
		m.set_shader_parameter("leaves", leaf_texture(sp.leaf))
		m.set_shader_parameter("tint", sp.tint)
		m.set_shader_parameter("greenify", sp.green)
		_mats[key] = m
	return _mats[key]


static func bark_mat(bark: String) -> Material:
	var key := "bark:" + bark
	if not _mats.has(key):
		var m := ShaderMaterial.new()
		m.shader = load("res://shaders/tree_bark.gdshader")
		m.set_shader_parameter("albedo_tex", load("res://assets/textures/trees/%s_Color.png" % bark))
		m.set_shader_parameter("normal_tex", load("res://assets/textures/trees/%s_NormalGL.png" % bark))
		m.set_shader_parameter("rough_tex", load("res://assets/textures/trees/%s_Roughness.png" % bark))
		_mats[key] = m
	return _mats[key]


# ------------------------------------------------------------------ geometría

## Rama: tubo afilado a lo largo de una curva (puntos), con UV de corteza.
static func _tube(st: SurfaceTool, pts: Array, r0: float, r1: float, sides: int) -> void:
	var n := pts.size()
	var rings: Array = []
	var along := 0.0
	for i in n:
		var p: Vector3 = pts[i]
		var t: Vector3 = ((pts[mini(i + 1, n - 1)] as Vector3) - (pts[maxi(i - 1, 0)] as Vector3)).normalized()
		var side := t.cross(Vector3.UP)
		if side.length() < 0.01:
			side = t.cross(Vector3.RIGHT)
		side = side.normalized()
		var up := side.cross(t).normalized()
		var rad := lerpf(r0, r1, float(i) / (n - 1))
		if i > 0:
			along += p.distance_to(pts[i - 1])
		var ring: Array = []
		for s in sides + 1:
			var a := TAU * s / sides
			var nrm := (side * cos(a) + up * sin(a))
			ring.append([p + nrm * rad, nrm, Vector2(float(s) / sides * maxf(1.0, round(rad * 40.0)) * 0.5, along * 1.6)])
		rings.append(ring)
	for i in n - 1:
		for s in sides:
			var a: Array = rings[i][s]
			var b: Array = rings[i][s + 1]
			var c: Array = rings[i + 1][s + 1]
			var d: Array = rings[i + 1][s]
			for v in [a, c, b, a, d, c]:
				st.set_normal(v[1])
				st.set_uv(v[2])
				st.add_vertex(v[0])


## Curva de a a b que se arquea hacia arriba (ramas) con algo de ruido.
static func _curve(a: Vector3, b: Vector3, r: RandomNumberGenerator, segs: int, lift: float) -> Array:
	var out: Array = []
	var jit := Vector3(r.randf_range(-1, 1), 0, r.randf_range(-1, 1)) * a.distance_to(b) * 0.12
	for i in segs + 1:
		var t := float(i) / segs
		var p := a.lerp(b, t)
		p.y += sin(t * PI) * lift
		p += jit * sin(t * PI)
		out.append(p)
	return out


## Punto de la capa exterior de la copa (centro c, radios rh/rv) en la dirección dada.
static func _crown_point(sp: Dictionary, c: Vector3, dir: Vector3, shell: float) -> Vector3:
	var rh: float = sp.cr
	var rv: float = sp.cv
	if int(sp.shape) == 1:
		# cono: el radio horizontal mengua con la altura
		var y := dir.y * rv
		var k := clampf(0.5 - y / (2.0 * rv), 0.05, 1.0)
		return c + Vector3(dir.x * rh * k * 1.6, y, dir.z * rh * k * 1.6) * shell
	return c + Vector3(dir.x * rh, dir.y * rv, dir.z * rh) * shell


static func mesh(species: String, variant: int) -> ArrayMesh:
	var key := "%s:%d" % [species, variant]
	if _meshes.has(key):
		return _meshes[key]
	var sp: Dictionary = SPECIES[species]
	var r := RandomNumberGenerator.new()
	r.seed = hash(key)
	var hgt: float = sp.h * r.randf_range(0.88, 1.12)
	var fork: float = sp.fork * r.randf_range(0.9, 1.1)
	var crown_c := Vector3(r.randf_range(-0.08, 0.08), fork + (hgt - fork) * 0.5, r.randf_range(-0.08, 0.08))
	var bark := SurfaceTool.new()
	bark.begin(Mesh.PRIMITIVE_TRIANGLES)
	# tronco (en el pino, hasta la punta)
	var trunk_top := Vector3(crown_c.x * 0.6, (hgt * 0.92) if int(sp.shape) == 1 else fork + 0.25, crown_c.z * 0.6)
	_tube(bark, _curve(Vector3.ZERO, trunk_top, r, 5, 0.0), sp.r, sp.r * (0.25 if int(sp.shape) == 1 else 0.7), 7)
	# ramas principales y secundarias hacia la copa
	var tips: Array = []
	var nb: int = sp.branches
	for i in nb:
		var a := (float(i) + r.randf_range(-0.3, 0.3)) / nb * TAU
		var up := r.randf_range(-0.1, 0.75) if int(sp.shape) == 0 else r.randf_range(-0.6, 0.5)
		var dir := Vector3(cos(a), up, sin(a)).normalized()
		var start := Vector3.ZERO.lerp(trunk_top, r.randf_range(0.75, 1.0) if int(sp.shape) == 0 else r.randf_range(0.3, 0.9))
		var end := _crown_point(sp, crown_c, dir, r.randf_range(0.6, 0.85))
		if int(sp.shape) == 1:
			end.y = minf(end.y, start.y + 0.3)
		var pts := _curve(start, end, r, 4, 0.12 if int(sp.shape) == 0 else -0.05)
		_tube(bark, pts, sp.r * 0.55, sp.r * 0.15, 4)
		tips.append(end)
		for j in 2:
			var mid: Vector3 = pts[2 + j]
			var d2 := (dir + Vector3(r.randf_range(-0.8, 0.8), r.randf_range(0.0, 0.6), r.randf_range(-0.8, 0.8))).normalized()
			var e2 := _crown_point(sp, crown_c, d2, r.randf_range(0.7, 0.9))
			_tube(bark, _curve(mid, e2, r, 2, 0.06), sp.r * 0.22, sp.r * 0.06, 3)
			tips.append(e2)
	var out := bark.commit()
	out.surface_set_material(0, bark_mat(sp.bark))
	# copa: tarjetas de racimos en la capa exterior y junto a las puntas de las ramas
	var leaf := SurfaceTool.new()
	leaf.begin(Mesh.PRIMITIVE_TRIANGLES)
	var cards: int = sp.cards
	for i in cards:
		var p: Vector3
		if i < tips.size() * 3:
			var t: Vector3 = tips[i % tips.size()]
			p = t + Vector3(r.randf_range(-0.25, 0.25), r.randf_range(-0.15, 0.25), r.randf_range(-0.25, 0.25))
		else:
			var dir := Vector3(r.randf_range(-1, 1), r.randf_range(-0.75, 1), r.randf_range(-1, 1)).normalized()
			p = _crown_point(sp, crown_c, dir, r.randf_range(0.55, 1.0))
		var nrm := (p - crown_c).normalized()
		nrm = (nrm + Vector3.UP * 0.35).normalized()
		var size: float = sp.card * r.randf_range(0.8, 1.2)
		# orientación: de cara hacia fuera, con giro y cabeceo aleatorios
		var axis_u := nrm.cross(Vector3.UP)
		if axis_u.length() < 0.1:
			axis_u = Vector3.RIGHT
		axis_u = axis_u.normalized().rotated(nrm, r.randf() * TAU)
		var axis_v := nrm.cross(axis_u).normalized()
		var tilt := Basis(axis_u, r.randf_range(-0.6, 0.6))
		axis_v = tilt * axis_v
		var hs := size * 0.5
		var q := [p - axis_u * hs - axis_v * hs, p + axis_u * hs - axis_v * hs, p + axis_u * hs + axis_v * hs, p - axis_u * hs + axis_v * hs]
		var uv := [Vector2(0, 1), Vector2(1, 1), Vector2(1, 0), Vector2(0, 0)]
		for k in [0, 2, 1, 0, 3, 2]:
			leaf.set_normal(nrm)
			leaf.set_uv(uv[k])
			leaf.add_vertex(q[k])
	leaf.commit(out)
	out.surface_set_material(1, leaf_mat(species))
	_meshes[key] = out
	return out
