extends Node
## Ajustes de arranque. Se pueden pasar tras "--" en la línea de comandos:
##   godot --path godot -- server=ws://localhost:3000 user=Prueba capture=res://../shot.png capture_after=4
## - server: URL WebSocket del servidor (por defecto ws://localhost:3000).
## - user: entra directamente con ese nombre (sin pantalla de login).
## - capture / capture_after: guarda una captura PNG tras N segundos de partida y sale
##   (sirve para verificar el render sin mirar la pantalla).
## - hour: fija la hora del día (0-24).

var server_url := "ws://localhost:3000"
var auto_user := ""
var capture_path := ""
var capture_after := 4.0
var hour := -1.0
var walk := ""


func _init() -> void:
	for arg in OS.get_cmdline_user_args():
		var kv := arg.split("=", true, 1)
		if kv.size() != 2:
			continue
		match kv[0]:
			"server":
				server_url = kv[1]
			"user":
				auto_user = kv[1]
			"capture":
				capture_path = kv[1]
			"capture_after":
				capture_after = float(kv[1])
			"walk":
				walk = kv[1]
			"hour":
				hour = float(kv[1])


## Base HTTP del servidor (catálogo de assets, modelos, texturas).
func http_base() -> String:
	return server_url.replace("wss://", "https://").replace("ws://", "http://")
