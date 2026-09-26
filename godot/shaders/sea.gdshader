// Mar con oleaje: varias ondas desplazan la malla (mar de fondo del Atlántico) y una
// ondulación fina mueve las normales. El color va del verde azulado sobre la arena al
// azul oscuro donde cubre; espuma pegada a lo que asoma (muro, rocas, orilla) y, en las
// playas, rompientes: franjas de espuma que avanzan hacia la orilla donde hay poco fondo.
// La profundidad del agua sale de la diferencia con lo que hay debajo (textura de
// profundidad), así que funciona igual contra el muro que sobre la arena.
shader_type spatial;
render_mode depth_draw_opaque, cull_disabled;

uniform vec3 deep : source_color = vec3(0.03, 0.13, 0.2);
uniform vec3 shallow : source_color = vec3(0.12, 0.36, 0.37);
uniform vec3 foam_color : source_color = vec3(0.93, 0.96, 0.97);
uniform sampler2D depth_tex : hint_depth_texture, filter_linear;
global uniform float sprite_light;

varying vec3 v_wpos;

vec3 wave(vec2 p, vec2 dir, float amp, float len, float speed, inout vec3 n) {
	float k = TAU / len;
	vec2 d = normalize(dir);
	float f = k * (dot(d, p) - speed * TIME);
	float c = cos(f);
	n.x -= d.x * k * amp * c;
	n.z -= d.y * k * amp * c;
	return vec3(d.x * amp * 0.5 * c, amp * sin(f), d.y * amp * 0.5 * c);
}

float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float noise(vec2 p) {
	vec2 i = floor(p);
	vec2 f = fract(p);
	f = f * f * (3.0 - 2.0 * f);
	return mix(mix(hash(i), hash(i + vec2(1, 0)), f.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), f.x), f.y);
}

void vertex() {
	vec3 w = (MODEL_MATRIX * vec4(VERTEX, 1.0)).xyz;
	vec3 n = vec3(0.0, 1.0, 0.0);
	vec3 off = vec3(0.0);
	off += wave(w.xz, vec2(0.3, -1.0), 0.05, 4.5, 1.1, n);
	off += wave(w.xz, vec2(1.0, -0.6), 0.025, 2.1, 0.9, n);
	off += wave(w.xz, vec2(-0.7, -1.0), 0.012, 1.1, 0.7, n);
	VERTEX += off;
	NORMAL = normalize(n);
	v_wpos = w + off;
}

void fragment() {
	vec2 p = v_wpos.xz;
	// ondulación fina: normales de ruido que se desplazan
	float e = 0.05;
	vec2 q1 = p * 3.0 + vec2(TIME * 0.35, -TIME * 0.2);
	vec2 q2 = p * 5.3 + vec2(-TIME * 0.25, TIME * 0.3);
	float h0 = noise(q1) + 0.5 * noise(q2);
	float hx = noise(q1 + vec2(e, 0.0)) + 0.5 * noise(q2 + vec2(e, 0.0));
	float hz = noise(q1 + vec2(0.0, e)) + 0.5 * noise(q2 + vec2(0.0, e));
	vec3 wn = normalize(vec3(-(hx - h0) / e * 0.08, 1.0, -(hz - h0) / e * 0.08));
	vec3 base_n = (INV_VIEW_MATRIX * vec4(NORMAL, 0.0)).xyz;
	NORMAL = normalize((VIEW_MATRIX * vec4(normalize(base_n + vec3(wn.x, 0.0, wn.z)), 0.0)).xyz);

	// profundidad del agua a lo largo de la visual
	float depth = texture(depth_tex, SCREEN_UV).r;
	vec4 world = INV_PROJECTION_MATRIX * vec4(SCREEN_UV * 2.0 - 1.0, depth, 1.0);
	world.xyz /= world.w;
	float wd = clamp(VERTEX.z - world.z, 0.0, 6.0);
	float t = smoothstep(0.0, 1.6, wd);
	vec3 col = mix(shallow, deep, t);

	// espuma de contacto (muro, rocas, orilla), rota por ruido
	float n1 = noise(p * 9.0 + vec2(TIME * 0.6, TIME * 0.4));
	float contact = 1.0 - smoothstep(0.0, 0.1 + 0.08 * n1, wd);
	// rompientes: franjas que avanzan hacia donde hay menos fondo
	float shoal = 1.0 - smoothstep(0.15, 0.9, wd);
	float band = sin(wd * 18.0 + TIME * 2.2 + n1 * 2.0);
	float breaker = smoothstep(0.75, 0.98, band) * shoal * smoothstep(0.35, 0.7, noise(p * 2.5 + vec2(0.0, TIME * 0.3)));
	float foam = clamp(contact * (0.55 + 0.45 * n1) + breaker * 0.8, 0.0, 1.0);
	col = mix(col, foam_color, foam);
	float day = mix(0.5, 1.0, sprite_light);
	ALBEDO = col * day;
	ROUGHNESS = mix(0.06, 0.6, foam);
	SPECULAR = 0.55;
	ALPHA = clamp(mix(0.55, 0.97, t) + foam, 0.0, 1.0);
}
