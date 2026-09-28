class_name HighwaysMesh
## Autovías elevadas, rampas y enlaces (datos de server/src/citygen/highways.ts):
## tablero con asfalto, marcas de carril, mediana y pretiles de hormigón tipo "jersey",
## canto y fondo de hormigón, y pilares con cabezal. Hormigón y asfalto con el shader
## de los modelos (proyección por caras en coordenadas de mundo, recorte translúcido
## junto al personaje, sombras). Todo en tiles globales → unidades de render.

const T := Protocol.TILE_SIZE
const DECK := 0.32 # canto del tablero (unidades)
const BARRIER_H := 0.28
const BARRIER_W := 0.12

static var _mats := {}


static func _mat(key: String, tex_path: String, tile: float, tint := Color.WHITE) -> Material:
	if _mats.has(key):
		return _mats[key]
	var m := ShaderMaterial.new()
	m.shader = load("res://shaders/kenney.gdshader")
	m.set_shader_parameter("albedo_tex", load(tex_path))
	m.set_shader_parameter("albedo_color", tint)
	m.set_shader_parameter("tex_mode", 2)
	m.set_shader_parameter("box_tile", tile)
	m.set_shader_parameter("allow_facade", false)
	_mats[key] = m
	return m


static func concrete() -> Material:
	return _mat("concrete", "res://assets/textures/facades/Concrete034_Color.jpg", 0.9, Color(0.92, 0.91, 0.88))


static func grass() -> Material:
	if _mats.has("grass"):
		return _mats.grass
	var m := StandardMaterial3D.new()
	var n := NoiseTexture2D.new()
	n.seamless = true
	n.noise = FastNoiseLite.new()
	n.noise.frequency = 0.05
	var ramp := Gradient.new()
	ramp.set_color(0, Color("3f5e30"))
	ramp.set_color(1, Color("6f8a45"))
	n.color_ramp = ramp
	m.albedo_texture = n
	m.roughness = 1.0
	_mats.grass = m
	return m


static func asphalt() -> Material:
	return _mat("asphalt", "res://assets/textures/road/asphalt.png", 2.0, Color(0.62, 0.63, 0.65))


## Construye las autovías de la escena. origin: tile global del origen de la escena.
static func build(root: Node3D, datas: Array, ogx: int, ogz: int, paint_white: Material, paint_yellow: Material) -> Array:
	var segs := {}
	var pillars := {}
	var greens := {}
	for d in datas:
		for h in d.get("highways", []):
			segs[h.id] = h
		for p in d.get("pillars", []):
			pillars["%.1f,%.1f" % [p[0], p[1]]] = p
		for g in d.get("greens", []):
			greens["%.1f,%.1f" % [g[0], g[1]]] = g
	if segs.is_empty():
		return []
	var L := func(gx: float, gz: float, y: float) -> Vector3:
		return Vector3((gx - ogx) * T, y, (gz - ogz) * T)
	var solid := GeoBatch.new()
	var flat := GeoBatch.new()
	solid.terrain = true
	flat.terrain = true
	solid.terrain = true
	flat.terrain = true
	var cmat := concrete()
	var amat := asphalt()
	for h in segs.values():
		var a: Vector3 = L.call(h.x0, h.y0, float(h.z0))
		var b: Vector3 = L.call(h.x1, h.y1, float(h.z1))
		var dir := Vector3(b.x - a.x, 0, b.z - a.z)
		if dir.length() < 0.001:
			continue
		dir = dir.normalized()
		var side := Vector3(-dir.z, 0, dir.x)
		var w: float = float(h.half) * T
		# un poco de solape entre tramos para que no queden rendijas en las curvas
		a -= dir * 0.03
		b += dir * 0.03
		var al := a - side * w
		var ar := a + side * w
		var bl := b - side * w
		var br := b + side * w
		# tablero: asfalto arriba, hormigón en los cantos y por debajo
		_quad(solid, amat, al, bl, br, ar, Vector3.UP)
		var dn := Vector3(0, -DECK, 0)
		_quad(solid, cmat, ar + dn, br + dn, bl + dn, al + dn, Vector3.DOWN)
		_quad(solid, cmat, al, al + dn, bl + dn, bl, -side)
		_quad(solid, cmat, ar, br, br + dn, ar + dn, side)
		# pretiles de hormigón en los bordes (y mediana en la autovía)
		for s in ([-1.0, 1.0, 0.0] if int(h.kind) == 0 else [-1.0, 1.0]):
			var o: Vector3 = side * (s * (w - BARRIER_W * 0.5))
			_barrier(solid, cmat, a + o, b + o, side)
		# marcas: líneas de borde continuas y separación de carriles discontinua
		var length := a.distance_to(b)
		var mid := (a + b) * 0.5 + Vector3(0, 0.012, 0)
		var ang := atan2(dir.z, dir.x)
		if int(h.kind) == 0:
			for s in [-1.0, 1.0]:
				flat.quad(paint_white, mid + side * s * (w - 0.3 * T), length, 0.1 * T * 1.5, ang, 1.6)
				flat.quad(paint_yellow, mid + side * s * (0.7 * T), length, 0.1 * T * 1.5, ang, 1.6)
				# discontinua entre los dos carriles de cada sentido (por longitud de arco)
				var s0: float = float(h.s0)
				var ph := fposmod(s0, 6.0)
				if ph < 3.0:
					flat.quad(paint_white, mid + side * s * (w * 0.52), minf(length, 2.0 * T), 0.09 * T * 1.5, ang, 1.6)
		else:
			for s in [-1.0, 1.0]:
				flat.quad(paint_white, mid + side * s * (w - 0.25 * T), length, 0.1 * T * 1.4, ang, 1.6)
	# césped en el interior de los bucles del trébol
	for g in greens.values():
		flat.disc(grass(), L.call(g[0], g[1], 0.054), float(g[2]) * T, 1.5, 40)
	# pilares: columna y cabezal bajo el tablero
	var box := StreetFurniture.prim("box")
	for p in pillars.values():
		var top: float = float(p[2]) - DECK
		if top < 0.15:
			continue
		var base: Vector3 = L.call(p[0], p[1], 0.05)
		var bang: float = float(p[4])
		var bas := Basis(Vector3.UP, -bang)
		var col := 0.42 if float(p[3]) > 5.0 else 0.28
		solid.mesh(box, Transform3D(bas.scaled(Vector3(col, top, col)), base + Vector3(0, top * 0.5, 0)), cmat)
		# cabezal: viga transversal a la vía
		var cap_w: float = float(p[3]) * T
		solid.mesh(box, Transform3D((bas * Basis(Vector3.UP, PI / 2.0)).scaled(Vector3(cap_w, 0.28, col * 1.1)), base + Vector3(0, top - 0.14, 0)), cmat)
	var out: Array = []
	for b in [solid, flat]:
		var mesh: ArrayMesh = b.to_mesh()
		if mesh.get_surface_count() == 0:
			continue
		var mi := MeshInstance3D.new()
		mi.mesh = mesh
		mi.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_ON if b == solid else GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
		mi.set_instance_shader_parameter("occluder", 1.0) # las autovías tapan: se ocultan con el halo
		root.add_child(mi)
		out.append(mi)
	return out


static func _quad(b: GeoBatch, m: Material, p0: Vector3, p1: Vector3, p2: Vector3, p3: Vector3, n: Vector3) -> void:
	b.tri(m, p0, p1, p2, n, Vector2.ZERO, Vector2.ZERO, Vector2.ZERO)
	b.tri(m, p0, p2, p3, n, Vector2.ZERO, Vector2.ZERO, Vector2.ZERO)


## Pretil tipo "jersey": prisma a lo largo de a → b.
static func _barrier(b: GeoBatch, m: Material, a: Vector3, e: Vector3, side: Vector3) -> void:
	var hw := side * (BARRIER_W * 0.5)
	var up := Vector3(0, BARRIER_H, 0)
	var top_w := side * (BARRIER_W * 0.22)
	_quad(b, m, a - hw, e - hw, e - top_w + up, a - top_w + up, -side)
	_quad(b, m, a + hw, a + top_w + up, e + top_w + up, e + hw, side)
	_quad(b, m, a - top_w + up, e - top_w + up, e + top_w + up, a + top_w + up, Vector3.UP)
