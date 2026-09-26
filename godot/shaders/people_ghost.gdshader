// Silueta de las personas cuando quedan tapadas (detrás de un edificio): se pinta
// solo donde la escena está más cerca de la cámara que el propio sprite.
shader_type spatial;
render_mode unshaded, cull_disabled, skip_vertex_transform, depth_test_disabled, depth_draw_never, blend_mix;

#include "res://shaders/sprite_common.gdshaderinc"

uniform sampler2D depth_tex : hint_depth_texture, filter_nearest;
global uniform vec4 cut_params; // franja del personaje (ver kenney.gdshader)

void vertex() {
	VERTEX = sprite_view_pos(VERTEX, MODEL_MATRIX, INV_VIEW_MATRIX, VIEW_MATRIX, INSTANCE_CUSTOM.z);
	v_uv = (INSTANCE_CUSTOM.xy + UV) / grid;
	v_kind = INSTANCE_CUSTOM.w;
}

void fragment() {
	if (v_kind > 3.5) {
		discard;
	}
	vec4 c = sample_sharp(v_uv);
	if (c.a < 0.5) {
		discard;
	}
	// dentro de la franja del personaje los edificios ya son translúcidos: sin silueta
	float f = cut_params.w;
	float in_y = smoothstep(cut_params.x - 0.5 * f, cut_params.x + f, FRAGCOORD.y);
	float in_x = 1.0 - smoothstep(cut_params.z - f, cut_params.z + f, abs(FRAGCOORD.x - cut_params.y));
	if (in_y * in_x > 0.3) {
		discard;
	}
	// profundidad inversa: mayor = más cerca de la cámara
	float scene = texture(depth_tex, SCREEN_UV).r;
	if (scene <= FRAGCOORD.z + 0.00015) {
		discard;
	}
	vec3 col = v_kind < 0.5 ? vec3(1.0, 0.23, 0.23) : (v_kind < 1.5 ? vec3(1.0, 0.54, 0.1) : (v_kind < 2.5 ? vec3(1.0) : vec3(0.23, 0.63, 0.88)));
	ALBEDO = col;
	ALPHA = 0.6;
}
