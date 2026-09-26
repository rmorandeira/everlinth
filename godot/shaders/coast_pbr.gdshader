// Materiales PBR de la costa (ambientCG, CC0): sillería del muro del paseo marítimo,
// arena de playa y roca de escollera. Proyección por caras en coordenadas de mundo (sin
// UV del modelo), relieve y rugosidad de la textura, y humedad junto al agua: la parte
// que moja el mar se oscurece, brilla y (en piedra) coge verdín.
shader_type spatial;

uniform sampler2D albedo_tex : source_color, filter_linear_mipmap_anisotropic, repeat_enable;
uniform sampler2D normal_tex : filter_linear_mipmap, repeat_enable;
uniform sampler2D rough_tex : filter_linear_mipmap, repeat_enable;
uniform vec4 tint : source_color = vec4(1.0);
uniform float tile = 1.0;       // unidades de mundo por repetición
uniform float sea_y = -0.75;
uniform float wet_band = 0.2;   // altura mojada por encima del nivel del mar
uniform float algae = 0.0;      // verdín bajo la línea del agua (piedra)
global uniform vec4 cut_params;
global uniform vec3 cut_cam_fwd;
global uniform float cut_keep;

varying vec3 v_wpos;
varying vec3 v_wnrm;

void vertex() {
	v_wpos = (MODEL_MATRIX * vec4(VERTEX, 1.0)).xyz;
	v_wnrm = normalize((MODEL_MATRIX * vec4(NORMAL, 0.0)).xyz);
}

void fragment() {
	if (dot(INV_VIEW_MATRIX[2].xyz, cut_cam_fwd) > 0.999 && v_wpos.y > 0.12) {
		float f = cut_params.w;
		float in_y = smoothstep(cut_params.x - 0.5 * f, cut_params.x + f, FRAGCOORD.y);
		float in_x = 1.0 - smoothstep(cut_params.z - f, cut_params.z + f, abs(FRAGCOORD.x - cut_params.y));
		float cut = in_y * in_x;
		float ign = fract(52.9829189 * fract(dot(FRAGCOORD.xy, vec2(0.06711056, 0.00583715))));
		if (cut > 0.001 && mix(1.0, cut_keep, cut) < ign) {
			discard;
		}
	}
	vec3 n = normalize(v_wnrm);
	vec2 uv;
	vec3 t;
	vec3 bt;
	if (abs(n.y) > 0.7) {
		uv = v_wpos.xz / tile;
		t = vec3(1.0, 0.0, 0.0);
		bt = vec3(0.0, 0.0, -1.0);
	} else {
		vec3 h = normalize(vec3(n.x, 0.0, n.z));
		t = vec3(-h.z, 0.0, h.x);
		uv = vec2(dot(v_wpos, t), v_wpos.y) / tile;
		bt = vec3(0.0, 1.0, 0.0);
	}
	vec3 alb = texture(albedo_tex, uv).rgb * tint.rgb;
	float rough = texture(rough_tex, uv).r;
	float wet = 1.0 - smoothstep(sea_y - 0.03, sea_y + wet_band, v_wpos.y);
	float under = 1.0 - smoothstep(sea_y - 0.05, sea_y + 0.06, v_wpos.y);
	alb = mix(alb, alb * vec3(0.55, 0.75, 0.5) + vec3(0.0, 0.03, 0.0), under * algae);
	alb *= mix(1.0, 0.58, wet);
	rough = mix(rough, 0.22, wet * 0.85);
	ALBEDO = alb;
	ROUGHNESS = rough;
	SPECULAR = mix(0.35, 0.6, wet);
	vec3 nt = texture(normal_tex, uv).xyz * 2.0 - 1.0;
	vec3 wn = normalize(t * nt.x + bt * nt.y + n * max(nt.z, 0.2));
	NORMAL = normalize((VIEW_MATRIX * vec4(wn, 0.0)).xyz);
}
