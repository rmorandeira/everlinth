class_name Facades
## Fachadas realistas: materiales PBR de ambientCG (CC0, ver assets/textures/facades)
## en tres arrays de texturas (color, relieve, rugosidad) que el shader de los modelos
## (kenney.gdshader) usa para las paredes lisas y las azoteas de todos los edificios.
## Capas 0-5: ladrillo rojo, ladrillo marrón, ladrillo claro, hormigón claro, estuco y
## hormigón viejo (cada edificio el suyo); capa 6: grava de azotea.

const MATS := ["Bricks085", "Bricks101", "Bricks075A", "Concrete034", "Plaster003", "Concrete036", "Gravel043"]
const SIZE := 1024


static func setup() -> void:
	var sets := {"Color": "fac_albedo", "NormalGL": "fac_normal", "Roughness": "fac_rough"}
	for kind in sets:
		var images: Array[Image] = []
		for m in MATS:
			var tex: Texture2D = load("res://assets/textures/facades/%s_%s.jpg" % [m, kind])
			if tex == null:
				push_warning("Falta la textura de fachada %s_%s" % [m, kind])
				return
			var img := tex.get_image()
			if img.is_compressed():
				img.decompress()
			img.clear_mipmaps()
			img.convert(Image.FORMAT_RGBA8)
			if img.get_width() != SIZE or img.get_height() != SIZE:
				img.resize(SIZE, SIZE, Image.INTERPOLATE_BILINEAR)
			img.generate_mipmaps()
			images.append(img)
		var arr := Texture2DArray.new()
		arr.create_from_images(images)
		RenderingServer.global_shader_parameter_set(sets[kind], arr)
	RenderingServer.global_shader_parameter_set("facade_on", 1.0)
