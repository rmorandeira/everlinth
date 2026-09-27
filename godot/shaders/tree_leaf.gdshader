// Copa de los árboles: tarjetas con racimos de hojas reales (ambientCG, horneados en
// trees.gd), recortadas por transparencia, a dos caras y translúcidas a contraluz. Cada
// árbol tiene su tono (según su posición) y se mece con el viento: más en las puntas y
// con ráfagas que recorren la calle. Mismo recorte que el resto de la ciudad en la franja
// del personaje.
shader_type spatial;
render_mode cull_disabled;

uniform sampler2D leaves : source_color, filter_linear_mipmap_anisotropic;
uniform vec3 tint : source_color = vec3(1.0);
uniform float greenify = 0.0; // hojas de otoño → verde de verano (conserva el detalle)
uniform float sway = 1.0;
global uniform vec4 cut_params;
global uniform vec3 cut_cam_fwd;
global uniform float cut_keep;
global uniform float sprite_light;

varying float v_var;
varying float v_h;

void vertex() {
	vec3 o = MODEL_MATRIX[3].xyz;
	v_var = fract(sin(dot(o.xz, vec2(12.9898, 78.233))) * 43758.5453);
	v_h = VERTEX.y;
	// viento: ráfagas lentas que recorren el mundo + temblor fino por hoja
	float gust = 0.6 + 0.4 * sin(TIME * 0.7 + o.x * 0.15 + o.z * 0.1);
	float k = clamp(VERTEX.y * 0.25, 0.0, 1.0) * sway;
	vec3 w = vec3(sin(TIME * 1.3 + o.x * 0.7 + VERTEX.y), 0.0, cos(TIME * 1.1 + o.z * 0.6 + VERTEX.x)) * 0.035 * gust * k;
	w += vec3(sin(TIME * 5.0 + VERTEX.x * 9.0 + VERTEX.z * 7.0), sin(TIME * 4.3 + VERTEX.z * 8.0) * 0.5, cos(TIME * 5.7 + VERTEX.y * 9.0)) * 0.008 * k;
	VERTEX += w;
}

void fragment() {
	vec4 c = texture(leaves, UV);
	if (dot(INV_VIEW_MATRIX[2].xyz, cut_cam_fwd) > 0.999) {
		vec3 wp = (INV_VIEW_MATRIX * vec4(VERTEX, 1.0)).xyz;
		float f = cut_params.w;
		float in_y = smoothstep(cut_params.x - 0.5 * f, cut_params.x + f, FRAGCOORD.y);
		float in_x = 1.0 - smoothstep(cut_params.z - f, cut_params.z + f, abs(FRAGCOORD.x - cut_params.y));
		float cut = in_y * in_x;
		float ign = fract(52.9829189 * fract(dot(FRAGCOORD.xy, vec2(0.06711056, 0.00583715))));
		if (cut > 0.001 && mix(1.0, cut_keep, cut) < ign) {
			discard;
		}
	}
	vec3 col = c.rgb;
	if (greenify > 0.0) {
		float l = dot(col, vec3(0.3, 0.55, 0.15));
		col = mix(col, vec3(0.42, 0.62, 0.26) * l * 1.9, greenify);
	}
	// tono por árbol y más oscuro hacia dentro/abajo de la copa
	col *= tint * mix(vec3(0.86, 0.9, 0.82), vec3(1.08, 1.05, 0.95), v_var);
	col *= mix(0.62, 1.0, smoothstep(0.4, 2.2, v_h));
	ALBEDO = col;
	ALPHA = c.a;
	ALPHA_SCISSOR_THRESHOLD = 0.45;
	ROUGHNESS = 0.75;
	SPECULAR = 0.25;
	BACKLIGHT = vec3(0.45, 0.55, 0.3) * col;
}
