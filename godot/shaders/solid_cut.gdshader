// Color liso (mobiliario: farolas, semáforos, señales, papeleras…) con el mismo recorte
// que los edificios: lo que tapa la franja del personaje desaparece (la vista desde la
// cámara hasta el personaje queda siempre libre).
shader_type spatial;

uniform vec4 albedo : source_color = vec4(1.0);
uniform float roughness = 0.9;
uniform bool unshaded_glow = false;
global uniform vec4 cut_params;
global uniform vec3 cut_cam_fwd;
global uniform float cut_keep;

void fragment() {
	if (dot(INV_VIEW_MATRIX[2].xyz, cut_cam_fwd) > 0.999) {
		vec3 wp = (INV_VIEW_MATRIX * vec4(VERTEX, 1.0)).xyz;
		if (wp.y > 0.12) {
			float f = cut_params.w;
			float in_y = smoothstep(cut_params.x - 0.5 * f, cut_params.x + f, FRAGCOORD.y);
			float in_x = 1.0 - smoothstep(cut_params.z - f, cut_params.z + f, abs(FRAGCOORD.x - cut_params.y));
			float cut = in_y * in_x;
			float ign = fract(52.9829189 * fract(dot(FRAGCOORD.xy, vec2(0.06711056, 0.00583715))));
			if (cut > 0.001 && mix(1.0, cut_keep, cut) < ign) {
				discard;
			}
		}
	}
	ALBEDO = albedo.rgb;
	ROUGHNESS = roughness;
	if (unshaded_glow) {
		EMISSION = albedo.rgb * 1.2;
	}
}
