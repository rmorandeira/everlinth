// Personas y zombis en pixel art (ver pixel_people.gd / people.gd).
shader_type spatial;
render_mode unshaded, cull_disabled, skip_vertex_transform;

#include "res://shaders/sprite_common.gdshaderinc"

global uniform float sprite_light; // luz del día sobre los sprites (1 de día, menos de noche)
global uniform vec4 sprite_flash;  // xyz: fogonazo en el mundo, w: intensidad

varying vec3 v_world;

void vertex() {
	VERTEX = sprite_view_pos(VERTEX, MODEL_MATRIX, INV_VIEW_MATRIX, VIEW_MATRIX, INSTANCE_CUSTOM.z);
	v_world = (INV_VIEW_MATRIX * vec4(VERTEX, 1.0)).xyz;
	v_uv = (INSTANCE_CUSTOM.xy + UV) / grid;
	v_kind = INSTANCE_CUSTOM.w;
}

void fragment() {
	vec4 c = sample_sharp(v_uv);
	// fogonazos cercanos: los sprites se iluminan de naranja
	float fl = sprite_flash.w * max(0.0, 1.0 - distance(v_world, sprite_flash.xyz) / 2.2);
	ALBEDO = c.rgb * sprite_light + vec3(1.0, 0.7, 0.35) * fl * 0.8;
	if (v_kind > 5.5) {
		// mordido: se va poniendo verdoso y parpadea
		ALBEDO = mix(ALBEDO, vec3(0.42, 0.58, 0.32) * sprite_light, 0.35 + 0.2 * sin(TIME * 9.0));
	}
	ALPHA = c.a;
	ALPHA_SCISSOR_THRESHOLD = 0.5;
}
