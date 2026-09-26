extends SceneTree
# Genera atlas de prueba de PixelPeople y los guarda ampliados (x4) para revisarlos.
# Uso: godot --headless --path godot --script res://tools/preview_people.gd -- <carpeta>
func _init() -> void:
	var out: String = OS.get_cmdline_user_args()[0]
	var specs: Array = [PixelPeople.player_spec()]
	for i in 5:
		specs.append(PixelPeople.random_spec(100 + i, false))
	for i in 3:
		var p := PixelPeople.random_spec(3000 + i * 17, false)
		p.panic = true
		specs.append(p)
	for i in 3:
		specs.append(PixelPeople.random_spec(200 + i, true))
	var img := PixelPeople.build_atlas(specs)
	# solo fotograma 0 y 1 de cada variante, para que quepa
	var sheet := Image.create(img.get_width(), specs.size() * 2 * PixelPeople.CH, false, Image.FORMAT_RGBA8)
	sheet.fill(Color("5f5655"))
	for v in specs.size():
		for f in 2:
			var src := Rect2i(0, (v * 4 + f) * PixelPeople.CH, img.get_width(), PixelPeople.CH)
			sheet.blend_rect(img, src, Vector2i(0, (v * 2 + f) * PixelPeople.CH))
	sheet.resize(sheet.get_width() * 4, sheet.get_height() * 4, Image.INTERPOLATE_NEAREST)
	sheet.save_png(out + "/people.png")
	var k := PixelPeople.build_corpse_atlas(specs.slice(6))
	var ks := Image.create(k.get_width(), k.get_height(), false, Image.FORMAT_RGBA8)
	ks.fill(Color("5f5655"))
	ks.blend_rect(k, Rect2i(Vector2i.ZERO, k.get_size()), Vector2i.ZERO)
	ks.resize(ks.get_width() * 6, ks.get_height() * 6, Image.INTERPOLATE_NEAREST)
	ks.save_png(out + "/corpses.png")
	quit()
