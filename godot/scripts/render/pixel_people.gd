class_name PixelPeople
## Generador procedural de personas en pixel art (estilo de las referencias: figuras
## diminutas de colores planos, cabeza con pelo o sombrero, ropa muy reconocible).
## Cada figura se dibuja píxel a píxel a partir de una "ficha" (piel, pelo, sombrero,
## prenda de arriba, de abajo, calzado…) en 8 direcciones relativas a la cámara y 4
## fotogramas de andar; los zombis son las mismas personas convertidas (piel verdosa,
## ropa apagada, sangre, ojos oscuros, brazos al frente, encorvados).
##
## Atlas de figuras (celdas de CW×CH): columna = dirección (0 N, 1 NE, 2 E, 3 SE, 4 S,
## 5 SO, 6 O, 7 NO; "N" = de espaldas a la cámara), fila = variante × 4 + fotograma.
## Atlas de cadáveres (celdas de KW×KH): columna = postura (cabeza a un lado u otro),
## fila = variante.

const CW := 24
const CH := 32
const FEET_ROW := 29 # primera fila bajo los pies
const KW := 32
const KH := 12
const KFEET_ROW := 10
const FRAMES := 4
const DIRS := 8

const SKIN_H := ["f1c27d", "e0ac69", "c68642", "8d5524", "ffdbac", "d9a07a"]
const SKIN_Z := ["9fb08a", "8fa07e", "a9b39a", "7f8f70", "b3b8a0", "93a38f"]
const HAIR := ["2b1d14", "4a2f1b", "7a4a24", "c9a15a", "d06a2a", "8a8a86", "1a1a1a", "5a3a22"]
const CLOTH := ["c0392b", "2e5e8c", "3a7d44", "d4a017", "6c3483", "e8e8e4", "2b2b2e", "7f5539", "1f3a5f", "9b9b98", "c56a2d", "2f5d50", "a8324a", "4f6d7a", "e3a0b0", "556b2f"]
const PANTS := ["23323f", "2c4a6e", "2b2b2e", "5b4a3a", "6b6b68", "3b3326", "1f2a36"]
const SHOES := ["1a1a1c", "3d2a1e", "e8e8e4", "5a3a22"]
const TOPS := ["tshirt", "shirt", "jacket", "suit", "sweater", "overalls", "dress", "apron", "habit", "tshirt", "shirt", "dress"]
const HAIRS := ["short", "short", "long", "bun", "bald", "short", "long"]
const HATS := ["none", "none", "none", "none", "fedora", "cap", "beanie"]

const BLOOD := "7a1414"
const BLOOD_DARK := "4a0c0c"
const GUN := "2a2a2e"
const GUN_HI := "5a5a60"


# ------------------------------------------------------------------ fichas

## Personaje del jugador (la referencia): sombrero, pelo pelirrojo, chaqueta abierta
## marrón oscuro, camisa blanca, vaqueros oscuros, botas y ametralladora.
static func player_spec() -> Dictionary:
	return {"skin": "f0b890", "hair": "short", "hair_color": "d06a2a", "hat": "fedora", "hat_color": "2a2624", "band": "c8c8c0",
		"top": "jacket", "top_color": "3a2a22", "inner": "e8e8e4", "accent": "3a2a22", "bottom": "pants", "bottom_color": "23323f",
		"shoes": "4a3020", "zombie": false, "armed": true, "seed": 1}


## Ficha aleatoria (determinista por semilla).
static func random_spec(seed: int, zombie: bool, armed := false) -> Dictionary:
	var r := RandomNumberGenerator.new()
	r.seed = seed * 7919 + 17
	var top: String = TOPS[r.randi() % TOPS.size()]
	var hat: String = HATS[r.randi() % HATS.size()]
	var hair: String = HAIRS[r.randi() % HAIRS.size()]
	if top == "habit":
		hat = "veil"
	var bottom := "pants"
	if top in ["dress", "apron"]:
		bottom = "legs"
	elif top != "habit" and r.randf() < 0.18:
		bottom = "shorts" if r.randf() < 0.5 else "skirt"
	var s := {
		"skin": (SKIN_Z if zombie else SKIN_H)[r.randi() % 6],
		"hair": hair, "hair_color": HAIR[r.randi() % HAIR.size()],
		"hat": hat, "hat_color": ["2a2624", "3d2a1e", "c0392b", "1f3a5f", "5a5a5a"][r.randi() % 5], "band": "c8c8c0",
		"top": top, "top_color": CLOTH[r.randi() % CLOTH.size()], "inner": "e8e8e4" if r.randf() < 0.7 else CLOTH[r.randi() % CLOTH.size()],
		"accent": CLOTH[r.randi() % CLOTH.size()],
		"bottom": bottom, "bottom_color": PANTS[r.randi() % PANTS.size()], "shoes": SHOES[r.randi() % SHOES.size()],
		"zombie": zombie, "armed": armed, "seed": seed,
	}
	if top == "habit":
		s.top_color = "1c1c1f"
		s.inner = "e8e8e4"
	if top == "suit":
		s.top_color = ["2b2b2e", "1f2a36", "3b3326", "4a4a4e"][r.randi() % 4]
		s.bottom_color = s.top_color
	if top == "overalls":
		s.accent = ["2c4a6e", "3a5f8a", "5b4a3a"][r.randi() % 3]
	return s


# ------------------------------------------------------------------ atlas

## Atlas con las variantes dadas (una ficha por variante).
static func build_atlas(specs: Array) -> Image:
	var img := Image.create(CW * DIRS, CH * FRAMES * specs.size(), false, Image.FORMAT_RGBA8)
	for v in specs.size():
		for f in FRAMES:
			var cells := {}
			for view in ["N", "NE", "E", "SE", "S"]:
				var c := Image.create(CW, CH, false, Image.FORMAT_RGBA8)
				_Painter.new(c, specs[v]).figure(view, f)
				cells[view] = c
			var order := ["N", "NE", "E", "SE", "S", "SE", "E", "NE"]
			for d in DIRS:
				var c: Image = cells[order[d]]
				if d >= 5:
					c = c.duplicate()
					c.flip_x()
				img.blit_rect(c, Rect2i(0, 0, CW, CH), Vector2i(d * CW, (v * FRAMES + f) * CH))
	return img


## Cadáveres: la figura de perfil, tumbada, sobre un charco de sangre.
static func build_corpse_atlas(specs: Array) -> Image:
	var img := Image.create(KW * 2, KH * specs.size(), false, Image.FORMAT_RGBA8)
	for v in specs.size():
		var spec: Dictionary = specs[v].duplicate()
		spec.armed = false
		spec.corpse = true
		var c := Image.create(CW, CH, false, Image.FORMAT_RGBA8)
		_Painter.new(c, spec).figure("E", 0)
		c.rotate_90(CLOCKWISE) # cabeza a la derecha, 32 de ancho × 24 de alto
		var r := RandomNumberGenerator.new()
		r.seed = int(spec.seed) * 31 + 5
		for pose in 2:
			var cell := Image.create(KW, KH, false, Image.FORMAT_RGBA8)
			# charco de sangre bajo el cuerpo (solo los zombis abatidos; los caídos, no)
			var bc := Color(BLOOD) if spec.zombie else Color(0, 0, 0, 0)
			var cx := 14 + r.randi_range(-2, 2)
			for y in range(4, KH):
				for x in KW:
					var dx := (x - cx) / 8.5
					var dy := (y - 8.5) / 2.6
					if dx * dx + dy * dy < 1.0 - r.randf() * 0.12:
						cell.set_pixel(x, y, bc if r.randf() < 0.85 else Color(BLOOD_DARK))
			# cuerpo: franja de la figura girada (filas 8..16 → tumbado de lado)
			for y in range(0, 24):
				for x in range(0, 32):
					var p := c.get_pixel(x, y)
					if p.a < 0.5:
						continue
					var ty := y - 8 + 1
					var tx := x - 1
					if ty < 0 or ty >= KH - 2 or tx < 0 or tx >= KW:
						continue
					cell.set_pixel(tx, ty, p)
			if pose == 1:
				cell.flip_x()
			img.blit_rect(cell, Rect2i(0, 0, KW, KH), Vector2i(pose * KW, v * KH))
	return img


## Sombra en el suelo: elipse de píxeles oscura.
static func shadow_image() -> Image:
	var img := Image.create(12, 12, false, Image.FORMAT_RGBA8)
	for y in 12:
		for x in 12:
			var dx := (x - 5.5) / 5.8
			var dy := (y - 5.5) / 5.8
			if dx * dx + dy * dy <= 1.0:
				img.set_pixel(x, y, Color(0, 0, 0, 0.38))
	return img


# ------------------------------------------------------------------ pintor

class _Painter:
	var img: Image
	var s: Dictionary
	var cx := 12
	var rng := RandomNumberGenerator.new()
	var zombie := false
	var cur_frame := 0

	func _init(image: Image, spec: Dictionary) -> void:
		img = image
		s = spec
		zombie = spec.zombie
		rng.seed = int(spec.seed) * 131 + 7

	func col(key: String) -> Color:
		var c := Color(s[key]) if s.has(key) else Color(key)
		if zombie and key != "skin":
			# ropa apagada y sucia
			var l := c.get_luminance()
			c = c.lerp(Color(l, l, l), 0.45).darkened(0.18)
		return c

	func px(x: int, y: int, c: Color) -> void:
		if x >= 0 and y >= 0 and x < img.get_width() and y < img.get_height():
			img.set_pixel(x, y, c)

	func rect(x0: int, y0: int, w: int, h: int, c: Color) -> void:
		for y in range(y0, y0 + h):
			for x in range(x0, x0 + w):
				px(x, y, c)

	func line(x0: float, y0: float, x1: float, y1: float, w: int, c: Color) -> void:
		var n := int(maxf(absf(x1 - x0), absf(y1 - y0))) + 1
		for i in n + 1:
			var t := float(i) / n
			var x := int(roundf(lerpf(x0, x1, t)))
			var y := int(roundf(lerpf(y0, y1, t)))
			rect(x, y, w, 1, c)

	## view: N, NE, E, SE, S (O/NO/SO son el espejo). frame: 0-3 del andar.
	func figure(view: String, frame: int) -> void:
		cur_frame = frame
		var hunch := 1 if zombie else 0
		var fwd := 1 if (zombie and view in ["E", "SE", "NE"]) else 0
		var head_y := 4 + hunch
		var torso_y := 9 + hunch
		var legs_y := 18
		var side := view == "E"
		var back := view in ["N", "NE"]
		var three_q := view in ["SE", "NE"]
		var hx := cx + (1 if three_q else 0) + fwd # desplazamiento de la cabeza
		var step: int = [0, 1, 0, -1][frame]
		if zombie:
			step = [0, 1, 0, -1][frame] as int

		_legs(view, legs_y, step)
		_torso(view, torso_y, legs_y, step)
		_head(view, hx, head_y, back, side, three_q)
		if not side and not zombie:
			pass
		_blood()

	# ---- piernas y calzado
	func _legs(view: String, y0: int, step: int) -> void:
		var bottom: String = s.bottom
		var top: String = s.top
		var pants := col("bottom_color")
		var skin := col("skin")
		var shoes := col("shoes")
		var leg_c := pants
		var bare_from := 99 # fila desde la que se ve la pierna desnuda
		if bottom == "shorts":
			bare_from = y0 + 4
		elif bottom in ["skirt", "legs"]:
			bare_from = y0 + 5
		if top == "habit":
			bare_from = 99
			leg_c = col("top_color")
		var stride := 1 if zombie else (3 if s.get("panic", false) else 2)
		if view == "E":
			# de perfil: piernas como trazos de la cadera al pie, la lejana más oscura
			var far := step * -stride
			var near := step * stride
			var legs := [[far, true], [near, false]]
			for lg in legs:
				var fx: int = cx + lg[0]
				var dark: bool = lg[1]
				for y in range(y0, y0 + 10):
					var t := float(y - y0) / 9.0
					var x := int(roundf(lerpf(cx, fx, t)))
					var c := skin if y >= bare_from else leg_c
					if dark:
						c = c.darkened(0.25)
					rect(x, y, 2, 1, c)
				var sc := shoes.darkened(0.25) if dark else shoes
				rect(fx, y0 + 10, 3, 1, sc)
		else:
			var lift_l := 1 if step > 0 else 0
			var lift_r := 1 if step < 0 else 0
			var off := step if view in ["SE", "NE"] else 0
			for leg in [[cx - 2, lift_l, -off], [cx + 1, lift_r, off]]:
				var lx: int = leg[0] + leg[2]
				var lift: int = leg[1]
				for y in range(y0, y0 + 10 - lift):
					var c := skin if y >= bare_from else leg_c
					if y >= bare_from:
						rect(lx + (1 if leg[0] < cx else 0), y, 1, 1, c)
					else:
						rect(lx, y, 2, 1, c)
				rect(lx, y0 + 10 - lift, 2, 1, shoes)
		# faldas, vestidos y hábitos por encima de las piernas
		if bottom in ["skirt", "legs"] or top == "habit":
			var c := col("top_color") if bottom == "legs" or top == "habit" else col("bottom_color")
			var rows := 10 if top == "habit" else 5
			for y in range(y0, y0 + rows):
				var w := 5 if y == y0 else 7
				if view == "E":
					rect(cx - 2, y, 6 if y > y0 else 4, 1, c)
				else:
					rect(cx - (w / 2), y, w, 1, c)
			if top == "apron" and view in ["S", "SE"]:
				rect(cx - 1, y0, 3, 4, col("inner"))

	# ---- torso y brazos
	func _torso(view: String, y0: int, legs_y: int, step: int) -> void:
		var top: String = s.top
		var main := col("top_color")
		var inner := col("inner")
		var accent := col("accent")
		var skin := col("skin")
		var h := legs_y - y0
		var back := view in ["N", "NE"]
		var armed: bool = s.get("armed", false)
		var sleeve := main
		if top == "overalls":
			sleeve = col("top_color")
			main = col("top_color")
		var short_sleeves := top in ["tshirt"]
		if view == "E":
			rect(cx - 1, y0, 4, h, main)
			if top in ["jacket"]:
				rect(cx + 2, y0, 1, h, inner)
			elif top == "suit":
				rect(cx + 2, y0, 1, 3, inner)
			elif top == "overalls":
				rect(cx - 1, y0 + 3, 4, h - 3, accent)
			elif top == "apron":
				rect(cx + 2, y0 + 3, 1, h - 3, inner)
			elif top == "sweater":
				rect(cx - 1, y0 + 4, 4, 1, accent)
			# brazo cercano
			if s.get("panic", false):
				var wv := cur_frame % 2
				line(cx, y0, cx + 1 + wv, y0 - 5, 2, sleeve)
				rect(cx + 1 + wv, y0 - 6, 2, 1, skin)
			elif zombie:
				rect(cx + 1, y0 + 1, 5, 2, sleeve)
				rect(cx + 6, y0 + 1, 2, 2, skin)
			elif armed:
				rect(cx, y0 + 1, 2, 3, sleeve)
				rect(cx + 1, y0 + 3, 3, 2, sleeve)
				rect(cx + 4, y0 + 3, 1, 2, skin)
				_gun_side(cx + 3, y0 + 3)
			else:
				var hand := step * 2
				for y in range(y0, y0 + h):
					var t := float(y - y0) / (h - 1)
					var x := int(roundf(lerpf(cx, cx + hand, t)))
					var c := skin if (short_sleeves and y > y0 + 2) else sleeve
					rect(x, y, 2, 1, c)
				rect(cx + hand, y0 + h, 2, 1, skin)
			return
		# frente / espalda / tres cuartos
		var three_q := view in ["SE", "NE"]
		var bx := cx - 2
		var bw := 5
		rect(bx, y0, bw, h, main)
		if not back:
			match top:
				"jacket":
					rect(cx - 1, y0, 3, h, inner)
					if three_q:
						rect(cx - 1, y0, 1, h, main)
				"suit":
					rect(cx - 1, y0, 3, 1, inner)
					px(cx, y0 + 1, inner)
					rect(cx, y0 + 1, 1, 5, accent.darkened(0.2))
				"overalls":
					rect(bx, y0 + 3, bw, h - 3, accent)
					rect(cx - 1, y0, 1, 3, accent)
					rect(cx + 1, y0, 1, 3, accent)
				"sweater":
					rect(bx - 1, y0 + 4, bw + 2, 1, accent)
				"apron":
					rect(cx - 1, y0 + 3, 3, h - 3, inner)
					px(cx, y0 + 1, inner)
					px(cx, y0 + 2, inner)
				"habit":
					rect(cx - 1, y0, 3, 1, inner)
		else:
			if top == "overalls":
				rect(bx, y0 + 3, bw, h - 3, accent)
				rect(cx - 1, y0, 1, 3, accent)
				rect(cx + 1, y0, 1, 3, accent)
			elif top == "apron":
				rect(cx - 1, y0 + 3, 3, 1, inner)
		# brazos a los lados
		var arm_x := [cx - 3, cx + 3]
		if three_q:
			arm_x = [cx + 3] # el lejano queda oculto
		for i in arm_x.size():
			var ax: int = arm_x[i]
			if s.get("panic", false):
				var out := -1 if ax < cx else 1
				var wv := (cur_frame + i) % 2
				rect(ax, y0 - 4, 1, 5, sleeve)
				px(ax + out * wv, y0 - 5, skin)
				px(ax + out * wv, y0 - 6, skin)
				continue
			if zombie:
				# brazos al frente: vistos de frente se acortan (manos a la altura del pecho)
				rect(ax, y0, 1, 3, sleeve)
				if not back:
					px(ax, y0 + 3, skin)
					if three_q:
						rect(ax + 1, y0 + 2, 2, 1, sleeve)
						px(ax + 3, y0 + 2, skin)
				continue
			if armed and not back:
				rect(ax, y0, 1, 4, sleeve)
				continue
			var swing := step if i == 0 else -step
			var arm_len := h - swing
			for y in range(y0, y0 + arm_len):
				var c := skin if (short_sleeves and y > y0 + 2) else sleeve
				px(ax, y, c)
			px(ax, y0 + arm_len, skin)
		if armed and not back:
			# manos juntas delante con la ametralladora
			if view == "S":
				rect(cx - 2, y0 + 4, 5, 1, sleeve)
				rect(cx - 1, y0 + 5, 3, 1, skin)
				rect(cx, y0 + 6, 1, 3, Color(GUN))
				px(cx, y0 + 9, Color(GUN_HI))
				px(cx + 1, y0 + 6, Color(GUN))
			else:
				rect(cx + 2, y0 + 4, 2, 1, sleeve)
				px(cx + 4, y0 + 5, skin)
				line(cx + 3, y0 + 5, cx + 8, y0 + 8, 1, Color(GUN))
				px(cx + 8, y0 + 8, Color(GUN_HI))
				px(cx + 4, y0 + 7, Color(GUN))

	func _gun_side(x: int, y: int) -> void:
		rect(x, y - 1, 7, 1, Color(GUN))
		rect(x + 1, y, 2, 2, Color(GUN))
		px(x + 7, y - 1, Color(GUN_HI))
		px(x - 1, y - 1, Color(GUN))

	# ---- cabeza, pelo y sombrero
	func _head(view: String, hx: int, y0: int, back: bool, side: bool, three_q: bool) -> void:
		var skin := col("skin")
		var hair := col("hair_color")
		var style: String = s.hair
		var hat: String = s.hat
		var w := 4 if side else 5
		var x0 := hx - 1 if side else hx - 2
		rect(x0, y0, w, 5, skin)
		if side:
			px(x0 + w, y0 + 2, skin) # nariz
		# pelo
		if style != "bald" or back:
			if back:
				rect(x0, y0 - 1, w, 5, hair)
				if style == "long":
					rect(x0, y0 + 4, w, 2, hair)
				if style == "bald":
					rect(x0, y0 - 1, w, 5, skin)
					px(x0, y0 + 1, hair)
					px(x0 + w - 1, y0 + 1, hair)
			elif side:
				rect(x0, y0 - 1, w, 1, hair)
				rect(x0, y0, 2, 1, hair)
				rect(x0, y0 + 1, 1, 2, hair)
				if style == "long":
					rect(x0 - 1, y0, 2, 6, hair)
			else:
				rect(x0, y0 - 1, w, 1, hair)
				rect(x0, y0, w, 1, hair)
				px(x0, y0 + 1, hair)
				px(x0 + w - 1, y0 + 1, hair)
				if three_q:
					rect(x0, y0 + 1, 1, 2, hair)
				if style == "long":
					rect(x0 - (0 if three_q else 1), y0, 1 if three_q else 2, 6, hair)
					rect(x0 + w - 1, y0, 2, 6, hair)
			if style == "bun" and not side:
				rect(hx, y0 - 2, 2, 1, hair)
			elif style == "bun":
				rect(x0 - 1, y0 - 1, 2, 2, hair)
		elif style == "bald":
			px(x0, y0 + 1, hair)
			px(x0 + w - 1, y0 + 1, hair)
		if s.get("panic", false) and not back and not side:
			px(hx + (1 if three_q else 0), y0 + 4, Color("3a1c14"))
		# cara del zombi: ojos oscuros y boca
		if zombie and not back:
			var eye := Color("2a1010")
			if side:
				px(x0 + w - 2, y0 + 2, eye)
				px(x0 + w - 1, y0 + 4, Color(BLOOD))
			else:
				px(hx - 1 + (1 if three_q else 0), y0 + 2, eye)
				px(hx + 1 + (1 if three_q else 0), y0 + 2, eye)
				px(hx + (1 if three_q else 0), y0 + 4, Color(BLOOD))
		# sombrero
		var hc := col("hat_color")
		match hat:
			"fedora":
				var bw := 8 if side else 9
				var bx := x0 - 2
				rect(bx, y0 - 1, bw, 1, hc)
				rect(x0, y0 - 3, w, 2, hc)
				rect(x0, y0 - 2, w, 1, col("band"))
				rect(x0 + 1, y0 - 4, w - 2, 1, hc)
			"cap":
				rect(x0, y0 - 2, w, 2, hc)
				if side:
					rect(x0 + w - 1, y0, 3, 1, hc.darkened(0.2))
				elif not back:
					rect(x0 - 1, y0, w + 2, 1, hc.darkened(0.2))
			"beanie":
				rect(x0, y0 - 2, w, 3, hc)
				rect(x0, y0, w, 1, hc.darkened(0.25))
			"veil":
				var vc := col("top_color")
				if back:
					rect(x0 - 1, y0 - 2, w + 2, 9, vc)
				else:
					rect(x0 - 1, y0 - 2, w + 2, 2, vc)
					rect(x0, y0, w, 1, col("inner"))
					rect(x0 - 1, y0, 1, 7, vc)
					rect(x0 + w, y0, 1, 7, vc)

	# ---- sangre y desgarros (solo zombis)
	func _blood() -> void:
		if not zombie:
			return
		var n := 3 + rng.randi() % 5
		for i in n:
			var x := cx - 3 + rng.randi() % 8
			var y := 9 + rng.randi() % 16
			if img.get_pixel(x, y).a > 0.5:
				px(x, y, Color(BLOOD) if rng.randf() < 0.7 else Color(BLOOD_DARK))
				if rng.randf() < 0.4 and img.get_pixel(x, y + 1).a > 0.5:
					px(x, y + 1, Color(BLOOD_DARK))
