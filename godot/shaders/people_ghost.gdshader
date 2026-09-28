// Silueta de las personas cuando quedan tapadas (detrás de un edificio): se pinta
// solo donde la escena está más cerca de la cámara que el propio sprite.
shader_type spatial;
render_mode unshaded, cull_disabled, skip_vertex_transform, depth_test_disabled, depth_draw_never, blend_mix;

#include "res://shaders/sprite_common.gdshaderinc"

uniform sampler2D depth_tex : hint_depth_texture, filter_nearest;
global uniform vec4 occ_halo; // halo de visión del personaje (occlusion.gdshaderinc)

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
	// dentro del halo los edificios que tapan ya se han quitado: sin silueta
	if (length(FRAGCOORD.xy - occ_halo.xy) < occ_halo.z - occ_halo.w) {
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
