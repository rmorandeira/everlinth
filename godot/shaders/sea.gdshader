// Mar con oleaje, opaco (barato): varias ondas desplazan la malla (mar de fondo del
// Atlántico) y dos capas de ruido precalculado mueven las normales. Lo que hay debajo
// viene en la textura "under" (coast.gd, un texel por tile): R = profundidad del agua,
// G = distancia a la orilla o al muro. Con eso: color del turquesa sobre la arena al azul
// oscuro donde cubre, espuma pegada al muro, las rocas y la orilla, y rompientes que
// avanzan hacia la playa donde hay poco fondo. Las olas se calman donde no cubre.
shader_type spatial;
render_mode cull_disabled;

uniform vec3 deep : source_color = vec3(0.03, 0.13, 0.2);
uniform vec3 shallow : source_color = vec3(0.12, 0.36, 0.37);
uniform vec3 sand : source_color = vec3(0.55, 0.52, 0.4);
uniform vec3 foam_color : source_color = vec3(0.93, 0.96, 0.97);
uniform sampler2D under : filter_linear, repeat_disable;
uniform vec2 under_origin;
uniform vec2 under_size = vec2(1.0);
uniform sampler2D ripple_tex : hint_normal, filter_linear_mipmap, repeat_enable;
uniform sampler2D noise_tex : filter_linear_mipmap, repeat_enable;
global uniform float sprite_light;

varying vec3 v_wpos;
varying vec2 v_under;

vec3 wave(vec2 p, vec2 dir, float amp, float len, float speed, inout vec3 n) {
	float k = TAU / len;
	vec2 d = normalize(dir);
	float f = k * (dot(d, p) - speed * TIME);
	float c = cos(f);
	n.x -= d.x * k * amp * c;
	n.z -= d.y * k * amp * c;
	return vec3(d.x * amp * 0.5 * c, amp * sin(f), d.y * amp * 0.5 * c);
}

void vertex() {
	vec3 w = (MODEL_MATRIX * vec4(VERTEX, 1.0)).xyz;
	vec2 uv = (w.xz - under_origin) / under_size;
	float depth = textureLod(under, uv, 0.0).r;
	// menos ola donde hay poco fondo (en la orilla el agua casi no sube ni baja)
	float calm = smoothstep(0.0, 0.8, depth);
	vec3 n = vec3(0.0, 1.0, 0.0);
	vec3 off = vec3(0.0);
	off += wave(w.xz, vec2(0.3, -1.0), 0.05, 4.5, 1.1, n);
	off += wave(w.xz, vec2(1.0, -0.6), 0.025, 2.1, 0.9, n);
	off += wave(w.xz, vec2(-0.7, -1.0), 0.012, 1.1, 0.7, n);
	off.y *= mix(0.25, 1.0, calm);
	VERTEX += off;
	NORMAL = normalize(mix(vec3(0.0, 1.0, 0.0), n, mix(0.3, 1.0, calm)));
	v_wpos = w + off;
}

void fragment() {
	vec2 p = v_wpos.xz;
	vec2 un = texture(under, (p - under_origin) / under_size).rg;
	float wd = un.r;          // profundidad (unidades)
	float wall = un.g;        // distancia a la orilla/muro (tiles)
	// ondulación fina: normales de ruido que se desplazan
	vec3 r1 = texture(ripple_tex, p * 0.35 + vec2(TIME * 0.04, -TIME * 0.025)).xyz * 2.0 - 1.0;
	vec3 r2 = texture(ripple_tex, p * 0.6 + vec2(-TIME * 0.03, TIME * 0.035)).xyz * 2.0 - 1.0;
	vec3 wn = normalize(vec3((r1.x + r2.x) * 0.35, 1.0, (r1.y + r2.y) * 0.35));
	vec3 base_n = (INV_VIEW_MATRIX * vec4(NORMAL, 0.0)).xyz;
	NORMAL = normalize((VIEW_MATRIX * vec4(normalize(base_n + vec3(wn.x, 0.0, wn.z)), 0.0)).xyz);

	float t = smoothstep(0.0, 1.3, wd);
	// sobre la arena se ve el fondo (turquesa arenoso); mar adentro, azul oscuro
	vec3 col = mix(mix(sand, shallow, smoothstep(0.0, 0.35, wd)), deep, t);
	float n1 = texture(noise_tex, p * 1.1 + vec2(TIME * 0.07, TIME * 0.05)).r;
	// espuma de contacto: en la orilla (poco fondo) y contra el muro y las rocas
	float shore = 1.0 - smoothstep(0.0, 0.07 + 0.06 * n1, wd);
	float at_wall = (1.0 - smoothstep(0.0, 0.7 + 0.6 * n1, wall)) * step(0.3, wd);
	float contact = max(shore, at_wall);
	// rompientes: franjas que avanzan hacia donde hay menos fondo
	float shoal = 1.0 - smoothstep(0.1, 0.8, wd);
	float band = sin(wd * 18.0 + TIME * 2.2 + n1 * 2.0);
	float breaker = smoothstep(0.75, 0.98, band) * shoal * smoothstep(0.35, 0.7, texture(noise_tex, p * 0.3 + vec2(0.0, TIME * 0.035)).r);
	float foam = clamp(contact * (0.55 + 0.45 * n1) + breaker * 0.8, 0.0, 1.0);
	col = mix(col, foam_color, foam);
	ALBEDO = col * mix(0.5, 1.0, sprite_light);
	ROUGHNESS = mix(0.06, 0.6, foam);
	SPECULAR = 0.55;
}
