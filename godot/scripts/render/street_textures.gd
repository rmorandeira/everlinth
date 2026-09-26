class_name StreetTextures
## Texturas procedurales de la calle (se generan una vez al arrancar):
## - Atlas de basura (4×4 celdas de 64 px): papel, papel arrugado, periódico doblado,
##   periódico abierto, lata roja, lata plateada, tapa de café, bolsa de plástico, bolsa
##   de papel, colillas, hojas secas, folleto, tique, manchas de chicle, envoltorio,
##   botella de vidrio.
## (La acera es un shader: shaders/sidewalk.gdshader.)

const CELL := 64

static var _litter: Texture2D


static func litter_atlas() -> Texture2D:
	if _litter:
		return _litter
	var img := Image.create(CELL * 4, CELL * 4, true, Image.FORMAT_RGBA8)
	var r := RandomNumberGenerator.new()
	r.seed = 1234
	for i in 16:
		var ox := (i % 4) * CELL
		var oy := (i / 4) * CELL
		_draw_item(img, i, ox, oy, r)
	img.generate_mipmaps()
	_litter = ImageTexture.create_from_image(img)
	return _litter


static func _rect(img: Image, ox: int, oy: int, x: int, y: int, w: int, h: int, c: Color) -> void:
	img.fill_rect(Rect2i(ox + x, oy + y, w, h), c)


static func _blob(img: Image, ox: int, oy: int, cx: float, cy: float, rx: float, ry: float, c: Color, r: RandomNumberGenerator, rough := 0.2) -> void:
	for y in CELL:
		for x in CELL:
			var dx := (x - cx) / rx
			var dy := (y - cy) / ry
			var a := atan2(dy, dx)
			var edge := 1.0 + sin(a * 5.0 + cx) * rough * 0.5 + sin(a * 9.0 + cy) * rough * 0.3
			if dx * dx + dy * dy < edge * edge:
				var k := 1.0 - r.randf() * 0.08
				img.set_pixel(ox + x, oy + y, Color(c.r * k, c.g * k, c.b * k, c.a))


static func _draw_item(img: Image, i: int, ox: int, oy: int, r: RandomNumberGenerator) -> void:
	var paper := Color("e9e6dc")
	var ink := Color("8c8a84")
	match i:
		0: # hoja de papel con renglones
			_rect(img, ox, oy, 14, 6, 36, 52, paper)
			for l in 9:
				_rect(img, ox, oy, 18, 12 + l * 5, 22 + r.randi() % 6, 1, ink)
		1: # papel arrugado
			_blob(img, ox, oy, 32, 32, 18, 15, paper, r, 0.5)
			for l in 6:
				var x := 20 + r.randi() % 24
				var y := 22 + r.randi() % 20
				_rect(img, ox, oy, x, y, 6, 1, Color("b9b6ad"))
		2: # periódico doblado
			_rect(img, ox, oy, 8, 14, 48, 34, Color("d6d3ca"))
			_rect(img, ox, oy, 12, 18, 40, 4, Color("3a3a3a"))
			for col in 3:
				for l in 5:
					_rect(img, ox, oy, 12 + col * 14, 26 + l * 4, 11, 2, Color("9a9892"))
		3: # periódico abierto (dos hojas, algo torcidas)
			_rect(img, ox, oy, 2, 10, 30, 42, Color("d2cfc5"))
			_rect(img, ox, oy, 32, 12, 30, 42, Color("dcd9d0"))
			_rect(img, ox, oy, 6, 14, 22, 3, Color("333333"))
			_rect(img, ox, oy, 36, 20, 12, 10, Color("7f7c76"))
			for col in 4:
				for l in 6:
					_rect(img, ox, oy, 6 + col * 14, 34 + l * 3, 10, 1, Color("8e8c86"))
		4: # lata roja (vista de lado, tumbada)
			_rect(img, ox, oy, 12, 24, 40, 16, Color("b21f1f"))
			_rect(img, ox, oy, 12, 30, 40, 4, Color("e8e8e8"))
			_rect(img, ox, oy, 50, 24, 3, 16, Color("b7bcc2"))
		5: # lata plateada
			_rect(img, ox, oy, 12, 24, 40, 16, Color("aeb4ba"))
			_rect(img, ox, oy, 12, 28, 40, 3, Color("2f5d9a"))
			_rect(img, ox, oy, 50, 24, 3, 16, Color("d0d4d8"))
		6: # tapa de vaso de café
			_blob(img, ox, oy, 32, 32, 20, 20, Color("f0efe9"), r, 0.0)
			_blob(img, ox, oy, 32, 32, 9, 9, Color("6b4a2f"), r, 0.0)
		7: # bolsa de plástico
			_blob(img, ox, oy, 32, 34, 24, 18, Color(0.93, 0.93, 0.95, 1.0), r, 0.7)
			_rect(img, ox, oy, 26, 14, 4, 8, Color(0.9, 0.9, 0.92))
			_rect(img, ox, oy, 36, 14, 4, 8, Color(0.9, 0.9, 0.92))
		8: # bolsa de papel marrón
			_rect(img, ox, oy, 16, 12, 32, 40, Color("a57c4f"))
			_rect(img, ox, oy, 16, 12, 32, 6, Color("8e6a42"))
		9: # colillas
			for k in 6:
				var x := 10 + r.randi() % 40
				var y := 10 + r.randi() % 40
				_rect(img, ox, oy, x, y, 7, 3, Color("f2efe6"))
				_rect(img, ox, oy, x + 7, y, 3, 3, Color("d58a3a"))
		10: # hojas secas
			for k in 5:
				_blob(img, ox, oy, 14 + r.randi() % 36, 14 + r.randi() % 36, 7, 4, [Color("8a5a2b"), Color("a8742e"), Color("6e4a28")][k % 3], r, 0.3)
		11: # folleto de colores
			_rect(img, ox, oy, 14, 10, 34, 44, Color("e0b23a"))
			_rect(img, ox, oy, 18, 16, 26, 10, Color("c0392b"))
			for l in 4:
				_rect(img, ox, oy, 18, 32 + l * 5, 24, 2, Color("3a3a3a"))
		12: # tique alargado
			_rect(img, ox, oy, 26, 4, 12, 56, Color("f4f2ea"))
			for l in 9:
				_rect(img, ox, oy, 28, 8 + l * 5, 8, 1, Color("9a9892"))
		13: # manchas de chicle
			for k in 7:
				_blob(img, ox, oy, 10 + r.randi() % 44, 10 + r.randi() % 44, 3 + r.randi() % 3, 3 + r.randi() % 3, Color("4a4845"), r, 0.2)
		14: # envoltorio de comida
			_blob(img, ox, oy, 32, 32, 20, 12, Color("d8322a"), r, 0.6)
			_rect(img, ox, oy, 22, 28, 20, 5, Color("f1c40f"))
		15: # botella de vidrio verde
			_rect(img, ox, oy, 10, 26, 36, 12, Color("2f6b3a"))
			_rect(img, ox, oy, 46, 29, 10, 6, Color("2a5f34"))
			_rect(img, ox, oy, 14, 28, 20, 2, Color("7fb08a"))
