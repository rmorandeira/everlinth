// Tronco y ramas: corteza PBR de ambientCG (CC0) con las UV de la malla (vuelta al
// tronco × a lo largo), relieve y rugosidad, algo de musgo y suciedad junto al suelo.
shader_type spatial;

uniform sampler2D albedo_tex : source_color, filter_linear_mipmap_anisotropic, repeat_enable;
uniform sampler2D normal_tex : hint_normal, filter_linear_mipmap, repeat_enable;
uniform sampler2D rough_tex : filter_linear_mipmap, repeat_enable;
uniform vec3 tint : source_color = vec3(1.0);
#include "res://shaders/occlusion.gdshaderinc"

varying float v_h;

void vertex() {
	v_h = VERTEX.y;
}

void fragment() {
	{
		vec3 owp = (INV_VIEW_MATRIX * vec4(VERTEX, 1.0)).xyz;
		float oc = occl_amount(owp, FRAGCOORD.xy, INV_VIEW_MATRIX);
		if (oc > 0.001 && oc * 0.85 > occl_dither(FRAGCOORD.xy)) {
			discard;
		}
	}
	vec3 c = texture(albedo_tex, UV).rgb * tint;
	c *= mix(0.7, 1.0, smoothstep(0.0, 0.35, v_h)); // suciedad al pie
	ALBEDO = c;
	ROUGHNESS = texture(rough_tex, UV).r;
	NORMAL_MAP = texture(normal_tex, UV).rgb;
}
