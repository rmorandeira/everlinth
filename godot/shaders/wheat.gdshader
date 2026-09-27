// Trigal en 3D por capas ("shell texturing"): la parcela se dibuja como una pila de
// láminas horizontales (UV2.x = altura de la lámina, 0 abajo .. 1 arriba). En cada lámina
// solo quedan los píxeles que caen dentro de una caña: una rejilla fina con una caña por
// celda (posición, grosor y altura al azar). Abajo, cañas finas de paja; arriba, la espiga
// más gruesa y dorada. El viento dobla las puntas en ráfagas que recorren el campo. Desde
// la vista isométrica se lee como una masa de trigo con volumen, con los bordes de la
// parcela cortados en vertical, a un coste de unas pocas láminas.
shader_type spatial;
render_mode cull_disabled;

uniform float density = 16.0;  // cañas por unidad (1 unidad = 3 m)
uniform vec3 straw : source_color = vec3(0.8, 0.64, 0.32);
uniform vec3 ear : source_color = vec3(0.93, 0.76, 0.38);
global uniform float sprite_light;

varying float v_layer;
varying vec3 v_wpos;

float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
vec2 hash2(vec2 p) { return vec2(hash(p), hash(p + 17.31)); }
float vnoise(vec2 p) {
	vec2 i = floor(p);
	vec2 f = fract(p);
	f = f * f * (3.0 - 2.0 * f);
	return mix(mix(hash(i), hash(i + vec2(1, 0)), f.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), f.x), f.y);
}

void vertex() {
	v_layer = UV2.x;
	v_wpos = (MODEL_MATRIX * vec4(VERTEX, 1.0)).xyz;
}

void fragment() {
	float t = v_layer;
	vec2 p = v_wpos.xz;
	// viento: ráfagas lentas que recorren el campo; dobla más las puntas
	float gust = vnoise(p * 0.15 + vec2(TIME * 0.35, TIME * 0.12));
	vec2 wind = vec2(0.8, 0.35) * (sin(TIME * 1.7 + p.x * 0.9 + p.y * 0.6) * 0.3 + gust) * 0.06 * t * t;
	vec2 q = (p - wind) * density;
	vec2 cell = floor(q);
	vec2 f = fract(q);
	// una caña por celda, algo desplazada dentro de ella (una sola muestra: barato)
	vec2 o = hash2(cell) * 0.3 + 0.35;
	float best = length(f - o);
	float seed = hash(cell + 3.7);
	// altura de cada caña: el trigal ondula por zonas y alguna espiga sobresale
	float hgt = 0.7 + 0.25 * vnoise(cell * 0.07) + 0.12 * seed;
	if (t > hgt) {
		discard;
	}
	float top = smoothstep(hgt - 0.28, hgt - 0.05, t); // 0 caña .. 1 espiga
	float radius = mix(0.2, 0.5, top) * (1.0 - smoothstep(hgt - 0.04, hgt, t) * 0.5);
	if (best > radius) {
		discard;
	}
	vec3 c = mix(straw * 0.8, ear, top);
	c *= 0.82 + 0.3 * seed;
	// abajo, en la espesura, más oscuro (sombra entre las cañas)
	c *= mix(0.55, 1.0, smoothstep(0.0, 0.85, t));
	// manchas de trigo más verde o más seco por la parcela
	c = mix(c, c * vec3(0.9, 1.0, 0.75), smoothstep(0.55, 0.8, vnoise(p * 0.3)) * 0.5);
	ALBEDO = c;
	ROUGHNESS = 0.85;
	SPECULAR = 0.25;
	BACKLIGHT = c * 0.35;
}
