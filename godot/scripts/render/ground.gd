class_name Ground
extends Node3D
## Suelo por tiles de la sala actual y sus vecinas (lo que manda el servidor en
## "screen"), dibujado con MultiMesh: una llamada de dibujo para todo el suelo.
## Provisional hasta la fase 2: los tiles de edificio se levantan como bloques
## grises para ver la trama de la ciudad; luego los sustituyen los modelos reales.

const T := Protocol.TILE_SIZE
const W := Protocol.SCREEN_WIDTH
const H := Protocol.SCREEN_HEIGHT

const GRASS := [Color("5cb85c"), Color("4fa350"), Color("66c266")]
const WATER := [Color("2e6fc4"), Color("3479cf")]
const DIRT := Color("b8a06a")
const ROAD := Color("3b3d40")
const SIDEWALK := Color("bdb8ac")
const Y := 0.05 # altura del suelo (como en la web: las calles van encima)

var _key := ""
var _floor := MultiMeshInstance3D.new()
var _blocks := MeshInstance3D.new()
var _block_mat := StandardMaterial3D.new()
var _urban := MeshInstance3D.new() # salas de ciudad: acera de hormigón (shader)
var _urban_mat := ShaderMaterial.new()


func _ready() -> void:
	var plane := PlaneMesh.new()
	plane.size = Vector2(T, T)
	var floor_mat := StandardMaterial3D.new()
	floor_mat.vertex_color_use_as_albedo = true
	floor_mat.vertex_color_is_srgb = true
	floor_mat.roughness = 0.95
	plane.material = floor_mat
	_floor.multimesh = _new_multimesh(plane)
	add_child(_floor)

	_block_mat.vertex_color_use_as_albedo = true
	_block_mat.vertex_color_is_srgb = true
	_block_mat.roughness = 0.8
	add_child(_blocks)
	_urban_mat.shader = load("res://shaders/sidewalk.gdshader")
	_urban.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	add_child(_urban)


func _new_multimesh(mesh: Mesh) -> MultiMesh:
	var mm := MultiMesh.new()
	mm.transform_format = MultiMesh.TRANSFORM_3D
	mm.use_colors = true
	mm.mesh = mesh
	return mm


## Ruido determinista barato por celda (el mismo hash2 que el cliente web).
static func hash2(x: float, y: float) -> float:
	var h := sin(x * 127.1 + y * 311.7) * 43758.5453
	return h - floorf(h)


## Reconstruye el suelo si ha cambiado la sala (coordenadas relativas a ella).
func build(screen: Dictionary, neighbors: Array) -> void:
	var sx := int(screen.sx)
	var sy := int(screen.sy)
	var key := "%d,%d" % [sx, sy]
	if key == _key:
		return
	_key = key
	var floor_cells: Array = []
	var block_cells: Array = []
	var urban := GeoBatch.new()
	if screen.has("city"):
		_urban_room(urban, 0, 0)
	else:
		_collect(screen.tiles, 0, 0, sx, sy, floor_cells, block_cells, false)
	for n in neighbors:
		var nx := int(n.sx)
		var ny := int(n.sy)
		if n.has("city"):
			_urban_room(urban, (nx - sx) * W, (ny - sy) * H)
		else:
			_collect(n.tiles, (nx - sx) * W, (ny - sy) * H, nx, ny, floor_cells, block_cells, false)

	var fm := _floor.multimesh
	fm.instance_count = floor_cells.size()
	for i in floor_cells.size():
		var c: Array = floor_cells[i]
		fm.set_instance_transform(i, Transform3D(Basis(), Vector3(c[0] * T, Y, c[1] * T)))
		fm.set_instance_color(i, c[2])

	_blocks.mesh = _merge_blocks(block_cells) if block_cells.size() > 0 else null
	_urban.mesh = urban.to_mesh() if not urban.is_empty() else null


## Sala de ciudad: un plano de acera (las calles y los edificios van encima).
func _urban_room(b: GeoBatch, ox: int, oz: int) -> void:
	var c := Vector3((ox + W * 0.5 - 0.5) * T, Y, (oz + H * 0.5 - 0.5) * T)
	b.quad(_urban_mat, c, W * T, H * T, 0.0)


## Bloques fusionados en una sola malla, sin caras interiores: de cada celda solo
## se emiten la tapa y los tramos de pared que asoman por encima de la vecina.
func _merge_blocks(cells: Array) -> ArrayMesh:
	var heights := {}
	for c in cells:
		heights[Vector2i(c[0], c[1])] = c[2]
	var st := SurfaceTool.new()
	st.begin(Mesh.PRIMITIVE_TRIANGLES)
	var sides := [[Vector2i(1, 0), Vector3.RIGHT], [Vector2i(-1, 0), Vector3.LEFT], [Vector2i(0, 1), Vector3.BACK], [Vector2i(0, -1), Vector3.FORWARD]]
	for c in cells:
		var p := Vector2i(c[0], c[1])
		var h: float = c[2]
		var col: Color = c[3]
		var cx := p.x * T
		var cz := p.y * T
		var e := T * 0.5
		st.set_color(col)
		_quad(st, Vector3(cx - e, h, cz - e), Vector3(cx + e, h, cz - e), Vector3(cx + e, h, cz + e), Vector3(cx - e, h, cz + e), Vector3.UP)
		for sd in sides:
			var nh: float = heights.get(p + sd[0], 0.0)
			if nh >= h:
				continue
			var n: Vector3 = sd[1]
			# esquinas de la pared en la cara que mira hacia n
			var t := Vector3(-n.z, 0.0, n.x) * e
			var base := Vector3(cx, 0.0, cz) + n * e
			var a := base - t
			var b := base + t
			st.set_color(col.darkened(0.04))
			_quad(st, Vector3(a.x, h, a.z), Vector3(b.x, h, b.z), Vector3(b.x, nh, b.z), Vector3(a.x, nh, a.z), n)
	st.set_material(_block_mat)
	return st.commit()


## Cuadrilátero a-b-c-d; el orden se corrige para que mire hacia n.
static func _quad(st: SurfaceTool, a: Vector3, b: Vector3, c: Vector3, d: Vector3, n: Vector3) -> void:
	if (b - a).cross(c - a).dot(n) > 0.0:
		var tmp := b
		b = d
		d = tmp
	st.set_normal(n)
	for v in [a, b, c, a, c, d]:
		st.add_vertex(v)


## urban: sala con ciudad vectorial (todo el suelo es pavimento; calles y edificios los pone City).
func _collect(tiles: Array, ox: int, oz: int, room_x: int, room_y: int, floor_cells: Array, block_cells: Array, urban: bool) -> void:
	var gx0 := room_x * W
	var gz0 := room_y * H
	for row in tiles.size():
		var line: Array = tiles[row]
		for col in line.size():
			var tile := int(line[col])
			var x := col + ox
			var z := row + oz
			var n := hash2(gx0 + col, gz0 + row)
			if urban:
				floor_cells.append([x, z, SIDEWALK])
				continue
			floor_cells.append([x, z, _floor_color(tile, n)])
			if tile == Protocol.TileType.Building:
				# Altura por manzana (hash de la celda de 6×6 que la contiene): bloques coherentes.
				var b := hash2(floorf((gx0 + col) / 6.0), floorf((gz0 + row) / 6.0))
				var shade := 0.55 + 0.25 * b
				block_cells.append([x, z, 0.8 + b * 4.0, Color(shade, shade * 0.97, shade * 0.93)])


func _floor_color(tile: int, n: float) -> Color:
	match tile:
		Protocol.TileType.Water:
			return WATER[int(n * WATER.size()) % WATER.size()]
		Protocol.TileType.Path:
			return DIRT
		Protocol.TileType.Road:
			return ROAD.lightened(n * 0.04)
		Protocol.TileType.Sidewalk, Protocol.TileType.Building:
			return SIDEWALK.darkened(n * 0.05)
	return GRASS[int(n * GRASS.size()) % GRASS.size()]
