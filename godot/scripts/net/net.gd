extends Node
## Conexión WebSocket con el servidor de Everlinth. Mismos mensajes JSON que el
## cliente web (ClientMessage / ServerMessage en shared/src/index.ts).

signal message(msg: Dictionary)
signal opened
signal closed

var _ws := WebSocketPeer.new()
var _state := WebSocketPeer.STATE_CLOSED


func connect_to(url: String) -> Error:
	_ws = WebSocketPeer.new()
	# Un "screen" con 15 salas de tiles más la ciudad vectorial ocupa varios cientos de KB.
	_ws.inbound_buffer_size = 32 * 1024 * 1024
	_ws.max_queued_packets = 4096
	_state = WebSocketPeer.STATE_CLOSED
	return _ws.connect_to_url(url)


func is_open() -> bool:
	return _ws.get_ready_state() == WebSocketPeer.STATE_OPEN


func send(msg: Dictionary) -> void:
	if is_open():
		_ws.send_text(JSON.stringify(msg))


func _process(_dt: float) -> void:
	_ws.poll()
	var s := _ws.get_ready_state()
	if s != _state:
		_state = s
		if s == WebSocketPeer.STATE_OPEN:
			opened.emit()
		elif s == WebSocketPeer.STATE_CLOSED:
			closed.emit()
	while _ws.get_available_packet_count() > 0:
		var txt := _ws.get_packet().get_string_from_utf8()
		var msg: Variant = JSON.parse_string(txt)
		if msg is Dictionary:
			message.emit(msg)
