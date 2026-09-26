extends SceneTree
# Uso: godot --headless --path godot --script res://tools/inspect_model.gd -- res://assets/models/commercial/building-a.glb
func _init() -> void:
	for path in OS.get_cmdline_user_args():
		var scene: PackedScene = load(path)
		var root := scene.instantiate()
		_dump(root, 0)
		root.free()
	quit()

func _dump(n: Node, depth: int) -> void:
	var line := "  ".repeat(depth) + n.name + " (" + n.get_class() + ")"
	if n is MeshInstance3D:
		var m: Mesh = n.mesh
		line += " surfaces=%d aabb=%s" % [m.get_surface_count(), m.get_aabb()]
		for s in m.get_surface_count():
			var mat := m.surface_get_material(s)
			var tex = mat.albedo_texture if mat is StandardMaterial3D else null
			var img: Image = tex.get_image() if tex else null
			line += "\n" + "  ".repeat(depth + 1) + "surf %d mat=%s tex=%s img=%s fmt=%s" % [s, mat.get_class() if mat else "-", tex.resource_path if tex else "-", img.get_size() if img else "-", img.get_format() if img else "-"]
	if n is Node3D:
		line += " xform=" + str(n.transform.origin) + " scale=" + str(n.scale)
	print(line)
	for c in n.get_children():
		_dump(c, depth + 1)
