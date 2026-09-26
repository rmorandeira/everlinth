extends Node
## Catálogo de assets del gestor web (/admin/assets): el servidor es la fuente de
## verdad. Se descarga /assets.json al arrancar y cada vez que el servidor avisa de un
## cambio (mensaje assetsChanged); entonces se emite `changed` y el juego se rehace con
## los assets nuevos, sin reiniciar. También descarga (y guarda en caché en user://)
## las texturas y los modelos GLB que no vienen incluidos en el proyecto.

signal changed(id: String)

var assets := {} # id -> AssetDef (Dictionary, como en shared/src/index.ts)
var loaded := false
var _tex := {} # url -> Texture2D (o null mientras se descarga)
var _glb := {} # ruta -> PackedScene/Node (o null mientras se descarga)
var _fetching := false
var _again := false


func _ready() -> void:
	DirAccess.make_dir_recursive_absolute("user://cache")
	Net.message.connect(func(msg: Dictionary) -> void:
		if msg.type == "assetsChanged":
			refresh(str(msg.id)))
	refresh("")


func refresh(changed_id: String) -> void:
	if _fetching:
		_again = true
		return
	_fetching = true
	var req := HTTPRequest.new()
	add_child(req)
	req.request_completed.connect(func(result: int, code: int, _h: PackedStringArray, body: PackedByteArray) -> void:
		req.queue_free()
		_fetching = false
		if result == HTTPRequest.RESULT_SUCCESS and code == 200:
			var list: Variant = JSON.parse_string(body.get_string_from_utf8())
			if list is Array:
				var next := {}
				for a in list:
					next[str(a.id)] = a
				assets = next
				loaded = true
				Kenney.invalidate()
				changed.emit(changed_id)
		if _again:
			_again = false
			refresh(changed_id))
	req.request(Config.http_base() + "/assets.json")


func get_def(id: String) -> Dictionary:
	return assets.get(id, {})


## Assets de una categoría (o varias) disponibles en un bioma.
func by_category(categories: Array, biome: String) -> Array:
	var out: Array = []
	for id in assets:
		var a: Dictionary = assets[id]
		if a.category in categories and biome in a.biomes:
			out.append(a)
	return out


## Textura de una URL del servidor (/textures/…): de la caché, o se descarga y cuando
## llega se avisa con `changed` para que se aplique.
func texture(url: String) -> Texture2D:
	if url == "":
		return null
	if _tex.has(url):
		return _tex[url]
	_tex[url] = null
	var file := "user://cache/" + url.md5_text() + "." + url.get_extension()
	if FileAccess.file_exists(file):
		var img := Image.load_from_file(ProjectSettings.globalize_path(file))
		if img:
			img.generate_mipmaps()
			_tex[url] = ImageTexture.create_from_image(img)
			return _tex[url]
	_download(url, file, func() -> void:
		var img := Image.load_from_file(ProjectSettings.globalize_path(file))
		if img:
			img.generate_mipmaps()
			_tex[url] = ImageTexture.create_from_image(img)
			Kenney.invalidate()
			changed.emit(""))
	return null


## Modelo GLB que no viene en el proyecto (subido al servidor): se descarga y se carga
## en tiempo de ejecución. Devuelve el nodo raíz (sin instanciar en escena) o null.
func glb(path: String) -> Node:
	if _glb.has(path):
		return _glb[path]
	_glb[path] = null
	var file := "user://cache/" + path.replace("/", "_") + ".glb"
	if FileAccess.file_exists(file):
		_glb[path] = _load_glb(file)
		return _glb[path]
	_download("/models/%s.glb" % path, file, func() -> void:
		_glb[path] = _load_glb(file)
		Kenney.invalidate()
		changed.emit(""))
	return null


func _load_glb(file: String) -> Node:
	var doc := GLTFDocument.new()
	var state := GLTFState.new()
	if doc.append_from_file(ProjectSettings.globalize_path(file), state) != OK:
		return null
	return doc.generate_scene(state)


func _download(url: String, file: String, done: Callable) -> void:
	var req := HTTPRequest.new()
	req.download_file = file
	add_child(req)
	req.request_completed.connect(func(result: int, code: int, _h: PackedStringArray, _b: PackedByteArray) -> void:
		req.queue_free()
		if result == HTTPRequest.RESULT_SUCCESS and code == 200:
			done.call()
		else:
			DirAccess.remove_absolute(ProjectSettings.globalize_path(file))
			push_warning("No se pudo descargar " + url))
	req.request(Config.http_base() + url)
