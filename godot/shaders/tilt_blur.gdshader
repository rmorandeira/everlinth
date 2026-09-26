// Tilt-shift de maqueta (como en la web) en UNA pasada: el radio de desenfoque crece
// con la distancia vertical a la franja nítida (a la altura del personaje, 40 % desde
// abajo). En vez de dos pasadas gaussianas se muestrean los mipmaps de la pantalla
// (ya reducidos y filtrados) en un disco de pocas muestras: mismo aspecto, mucho más
// barato. Después, los colores de juguete: saturación, contraste y viñeta.
shader_type canvas_item;

uniform sampler2D screen_tex : hint_screen_texture, filter_linear_mipmap, repeat_disable;
uniform float focus = 0.42; // altura de la franja nítida, desde abajo

vec3 to_linear(vec3 c) { return pow(c, vec3(2.2)); }
vec3 to_srgb(vec3 c) { return pow(max(c, vec3(0.0)), vec3(1.0 / 2.2)); }

void fragment() {
	vec2 uv = SCREEN_UV;
	vec2 res = 1.0 / SCREEN_PIXEL_SIZE;
	float d = abs((1.0 - uv.y) - focus);
	// radio (px) del desenfoque: 0 en la franja, hasta ~11 px (a 900 px de alto) en los bordes
	float radius = smoothstep(0.06, 0.5, d) * 11.0 * (res.y / 900.0);
	vec3 col;
	if (radius < 0.5) {
		col = textureLod(screen_tex, uv, 0.0).rgb;
	} else {
		float lod = max(0.0, log2(radius) - 1.3);
		vec2 r = radius * 0.45 * SCREEN_PIXEL_SIZE;
		col = textureLod(screen_tex, uv, lod).rgb * 0.28;
		col += textureLod(screen_tex, uv + vec2(r.x, r.y * 0.35), lod).rgb * 0.18;
		col += textureLod(screen_tex, uv + vec2(-r.x * 0.35, r.y), lod).rgb * 0.18;
		col += textureLod(screen_tex, uv + vec2(-r.x, -r.y * 0.35), lod).rgb * 0.18;
		col += textureLod(screen_tex, uv + vec2(r.x * 0.35, -r.y), lod).rgb * 0.18;
	}
	vec3 c = to_linear(col);
	float lum = dot(c, vec3(0.299, 0.587, 0.114));
	c = mix(vec3(lum), c, 1.35);
	c = (c - 0.5) * 1.1 + 0.5;
	c *= 1.0 - 0.32 * smoothstep(0.45, 0.95, length(uv - 0.5) * 1.3);
	COLOR = vec4(to_srgb(c), 1.0);
}
