extends Node
## Ajustes de arranque. Se pueden pasar tras "--" en la línea de comandos:
##   godot --path godot -- server=ws://localhost:3000 user=Prueba capture=res://../shot.png capture_after=4
## - server: URL WebSocket del servidor (por defecto ws://localhost:3000).
## - user: entra directamente con ese nombre (sin pantalla de login).
## - capture / capture_after: guarda una captura PNG tras N segundos de partida y sale
##   (sirve para verificar el render sin mirar la pantalla).
## - hour: fija la hora del día (0-24).
## - walk=NE: mantiene pulsadas esas direcciones de pantalla (pruebas).
## - bench=1: sin sincronía vertical, para medir los FPS reales.
## - aim=x,y / fire=1: apunta en esa dirección (tiles) y dispara sin parar (pruebas).
## - viaje=coruna|generada|nueva: al entrar, cambia de localización (como el desplegable).
## - tp=gx,gy: al entrar, lleva al personaje a ese tile global (servidor con DEBUG_WEAPONS=1).

var server_url := "ws://localhost:3000"
var server_from_args := false
var auto_user := ""
var capture_path := ""
var capture_after := 4.0
var hour := -1.0
var walk := ""
var aim := Vector2.ZERO
var fire := false
var bench := false
var zoom := 0.0 # depuración: mitad de alto visible (unidades) con la inclinación normal
var cenital := 0.0 # depuración: vista desde arriba con esa mitad de alto (unidades)
var boom := 0.0 # pruebas: explosiones a esa distancia (tiles) en la dirección de mira
var travel := "" # pruebas: localización a la que viajar al entrar
var tp := Vector2(INF, INF) # pruebas: tile global al que saltar al entrar
var off: PackedStringArray = [] # efectos apagados para medir (ssao,msaa,glow,tilt,shadow,ghost)


func _init() -> void:
	for arg in OS.get_cmdline_user_args():
		var kv := arg.split("=", true, 1)
		if kv.size() != 2:
			continue
		match kv[0]:
			"server":
				server_url = kv[1]
				server_from_args = true
			"user":
				auto_user = kv[1]
			"capture":
				capture_path = kv[1]
			"capture_after":
				capture_after = float(kv[1])
			"walk":
				walk = kv[1]
			"aim":
				var p := kv[1].split(",")
				aim = Vector2(float(p[0]), float(p[1]))
			"viaje":
				travel = kv[1]
			"tp":
				var q := kv[1].split(",")
				tp = Vector2(float(q[0]), float(q[1]))
			"off":
				off = kv[1].split(",")
			"boom":
				boom = float(kv[1])
			"zoom":
				zoom = float(kv[1])
			"cenital":
				cenital = float(kv[1])
			"bench":
				bench = kv[1] == "1"
			"fire":
				fire = kv[1] == "1"
			"hour":
				hour = float(kv[1])


## Base HTTP del servidor (catálogo de assets, modelos, texturas).
func http_base() -> String:
	return server_url.replace("wss://", "https://").replace("ws://", "http://")
