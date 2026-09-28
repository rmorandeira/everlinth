// Charco de luz bajo las farolas del campo: disco que se suma a la escena con un amarillo
// sodio suave, más intenso en el centro, que se enciende al anochecer (night, de
// Rural.set_night). De día no dibuja nada.
shader_type spatial;
render_mode unshaded, blend_add, depth_draw_never, cull_disabled;

uniform vec3 tint : source_color = vec3(1.0, 0.78, 0.42);
global uniform float win_glow;

void fragment() {
	float night = clamp(win_glow / 0.45, 0.0, 1.0);
	float r = length(UV - vec2(0.5)) * 2.0;
	float fall = pow(clamp(1.0 - r, 0.0, 1.0), 2.2);
	ALBEDO = tint * fall * night * 0.55;
	ALPHA = 1.0;
}
