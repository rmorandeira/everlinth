// Tilt-shift de maqueta (puerto de postfx3d.ts): desenfoque gaussiano separable
// (un pase horizontal y otro vertical, 13 muestras) cuyo radio crece con la
// distancia vertical a la franja nítida (a la altura del personaje, 40 % desde abajo).
// El pase vertical aplica además los colores de juguete: saturación, contraste y viñeta.
shader_type canvas_item;

uniform sampler2D screen_tex : hint_screen_texture, filter_linear, repeat_disable;
uniform vec2 dir = vec2(1.0, 0.0);
uniform float focus = 0.42; // altura de la franja nítida, desde abajo
uniform bool grade = false;

vec3 to_linear(vec3 c) { return pow(c, vec3(2.2)); }
vec3 to_srgb(vec3 c) { return pow(max(c, vec3(0.0)), vec3(1.0 / 2.2)); }

void fragment() {
	vec2 uv = SCREEN_UV;
	vec2 res = 1.0 / SCREEN_PIXEL_SIZE;
	float d = abs((1.0 - uv.y) - focus);
	float radius = smoothstep(0.06, 0.5, d) * 11.0 * (res.y / 900.0);
	vec4 col;
	if (radius < 0.3) {
		col = texture(screen_tex, uv);
	} else {
		vec2 step_uv = dir * (radius / 6.0) * SCREEN_PIXEL_SIZE;
		vec4 acc = vec4(0.0);
		float wsum = 0.0;
		for (int i = -6; i <= 6; i++) {
			float fi = float(i);
			float w = exp(-fi * fi / 18.0);
			acc += texture(screen_tex, uv + step_uv * fi) * w;
			wsum += w;
		}
		col = acc / wsum;
	}
	if (grade) {
		vec3 c = to_linear(col.rgb);
		float lum = dot(c, vec3(0.299, 0.587, 0.114));
		c = mix(vec3(lum), c, 1.35);
		c = (c - 0.5) * 1.1 + 0.5;
		c *= 1.0 - 0.32 * smoothstep(0.45, 0.95, length(uv - 0.5) * 1.3);
		col.rgb = to_srgb(c);
	}
	COLOR = vec4(col.rgb, 1.0);
}
