class_name Minimap
extends Control
## Minimapa (abajo a la izquierda), puerto de render/minimap.ts: vista cenital de la
## sala y sus vecinas, girada con la cámara ("arriba" = arriba en pantalla). El fondo
## (tiles + calles y edificios de la ciudad) se dibuja una vez por cambio de sala
## (el lienzo guarda sus órdenes de dibujo); cada fotograma solo se recoloca bajo el
## personaje y se pintan encima los puntos (otros jugadores, zombis).

const VIEW_RADIUS := 55.0 # tiles del centro al borde
const TILE_COLORS := {0: "5c9a4c", 1: "a8966a", 2: "3a72b8", 3: "3f7a3a", 4: "7c7c7c", 5: "6a5d52", 6: "8a6b4a", 7: "5f8a3a", 8: "b8b3a7", 9: "b8b3a7"}

var _map := _MapLayer.new()
var _dots := _DotsLayer.new()
var _arrow := _Arrow.new()
var _key := ""


func _ready() -> void:
	custom_minimum_size = Vector2(170, 170)
	size = custom_minimum_size
	clip_children = CanvasItem.CLIP_CHILDREN_AND_DRAW
	mouse_filter = Control.MOUSE_FILTER_IGNORE
	add_child(_map)
	add_child(_dots)
	add_child(_arrow)


func _draw() -> void:
	var c := size / 2.0
	draw_circle(c, c.x - 1.0, Color("1a1c20"))


func set_rooms(screen: Dictionary, neighbors: Array) -> void:
	var key := "%d,%d,%d" % [int(screen.sx), int(screen.sy), neighbors.size()]
	if key == _key:
		return
	_key = key
	_map.rooms = [screen] + neighbors
	_map.queue_redraw()


## Personaje en tiles globales; facing = atan2(dx, dz); yaw de la cámara.
func update_view(pgx: float, pgy: float, facing: float, yaw: float, dots: Array) -> void:
	var c := size / 2.0
	var scale := c.x / VIEW_RADIUS
	var rot := PI / 2.0 - yaw
	var xf := Transform2D(rot, Vector2(scale, scale), 0.0, c) * Transform2D(0.0, -Vector2(pgx, pgy))
	_map.transform = xf
	_dots.transform = xf
	_dots.dots = dots
	_dots.queue_redraw()
	_arrow.position = c
	_arrow.rotation = rot - facing + PI / 2.0
	queue_redraw()


class _MapLayer extends Node2D:
	var rooms: Array = []

	func _draw() -> void:
		var W := Protocol.SCREEN_WIDTH
		var H := Protocol.SCREEN_HEIGHT
		var roads := {}
		var buildings := {}
		for r in rooms:
			var ox: float = int(r.sx) * W
			var oy: float = int(r.sy) * H
			var urban: bool = r.has("city")
			if urban:
				draw_rect(Rect2(ox, oy, W, H), Color("b8b3a7"))
				for s in r.city.roads:
					roads[s.id] = s
				for b in r.city.buildings:
					buildings[b.id] = b
				continue
			var tiles: Array = r.tiles
			for y in tiles.size():
				for x in tiles[y].size():
					draw_rect(Rect2(ox + x, oy + y, 1, 1), Color(TILE_COLORS.get(int(tiles[y][x]), "555555")))
		for s in roads.values():
			var w: float = Protocol.CITY_ROAD_HALF[int(s.kind)] * 2.0
			draw_line(Vector2(s.x0, s.y0), Vector2(s.x1, s.y1), Color("3a3d42"), w)
			draw_circle(Vector2(s.x0, s.y0), w / 2.0, Color("3a3d42"))
			draw_circle(Vector2(s.x1, s.y1), w / 2.0, Color("3a3d42"))
		for b in buildings.values():
			var pts := PackedVector2Array()
			for p in b.pts:
				pts.append(Vector2(p[0], p[1]))
			var l := minf(0.7, 0.34 + float(b.floors) * 0.014)
			if Geometry2D.triangulate_polygon(pts).size() > 0:
				draw_colored_polygon(pts, Color.from_hsv(25.0 / 360.0, 0.12, l))


class _DotsLayer extends Node2D:
	var dots: Array = [] # [Vector2 (tiles globales), Color, radio]

	func _draw() -> void:
		for d in dots:
			draw_circle(d[0], d[2], d[1])


class _Arrow extends Node2D:
	func _draw() -> void:
		var pts := PackedVector2Array([Vector2(7, 0), Vector2(-4.5, 5), Vector2(-2, 0), Vector2(-4.5, -5)])
		draw_colored_polygon(pts, Color.WHITE)
		draw_polyline(pts + PackedVector2Array([pts[0]]), Color.BLACK, 1.0)
