// Tronco y ramas: corteza PBR de ambientCG (CC0) con las UV de la malla (vuelta al
// tronco × a lo largo), relieve y rugosidad, algo de musgo y suciedad junto al suelo.
shader_type spatial;

uniform sampler2D albedo_tex : source_color, filter_linear_mipmap_anisotropic, repeat_enable;
uniform sampler2D normal_tex : hint_normal, filter_linear_mipmap, repeat_enable;
uniform sampler2D rough_tex : filter_linear_mipmap, repeat_enable;
uniform vec3 tint : source_color = vec3(1.0);
global uniform vec4 cut_params;
global uniform vec3 cut_cam_fwd;
global uniform float cut_keep;

varying float v_h;

void vertex() {
	v_h = VERTEX.y;
}

void fragment() {
	if (dot(INV_VIEW_MATRIX[2].xyz, cut_cam_fwd) > 0.999) {
		float f = cut_params.w;
		float in_y = smoothstep(cut_params.x - 0.5 * f, cut_params.x + f, FRAGCOORD.y);
		float in_x = 1.0 - smoothstep(cut_params.z - f, cut_params.z + f, abs(FRAGCOORD.x - cut_params.y));
		float cut = in_y * in_x;
		float ign = fract(52.9829189 * fract(dot(FRAGCOORD.xy, vec2(0.06711056, 0.00583715))));
		if (cut > 0.001 && mix(1.0, cut_keep, cut) < ign) {
			discard;
		}
	}
	vec3 c = texture(albedo_tex, UV).rgb * tint;
	c *= mix(0.7, 1.0, smoothstep(0.0, 0.35, v_h)); // suciedad al pie
	ALBEDO = c;
	ROUGHNESS = texture(rough_tex, UV).r;
	NORMAL_MAP = texture(normal_tex, UV).rgb;
}
