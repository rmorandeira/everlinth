// Acera de hormigón realista (Nueva York): losas de 1,5 m (1 tile = 0,5 unidades) con
// juntas, tono distinto por losa, grano, manchas de suciedad y humedad, chicles
// aplastados, grietas y algún parche. Todo procedural a partir de la posición en el
// mundo (sin texturas, sin coste de carga, sin repeticiones visibles).
shader_type spatial;

uniform float slab = 0.5;              // tamaño de losa (unidades)
uniform vec3 base_color : source_color = vec3(0.70, 0.68, 0.64);

varying vec3 v_wpos;

float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float noise(vec2 p) {
	vec2 i = floor(p);
	vec2 f = fract(p);
	f = f * f * (3.0 - 2.0 * f);
	return mix(mix(hash(i), hash(i + vec2(1, 0)), f.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), f.x), f.y);
}
float fbm(vec2 p) {
	float v = 0.0;
	float a = 0.5;
	for (int i = 0; i < 2; i++) {
		v += a * noise(p);
		p *= 2.03;
		a *= 0.5;
	}
	return v;
}

void vertex() {
	v_wpos = (MODEL_MATRIX * vec4(VERTEX, 1.0)).xyz;
}

void fragment() {
	vec2 p = v_wpos.xz;
	vec2 cell = floor(p / slab);
	vec2 f = fract(p / slab);
	float h = hash(cell);
	// tono de cada losa (unas más nuevas, otras más gastadas)
	vec3 col = base_color * (0.9 + 0.16 * h);
	col = mix(col, col * vec3(1.03, 1.0, 0.95), step(0.8, hash(cell + 7.1)));
	// grano del hormigón
	col *= 0.93 + 0.12 * noise(p * 90.0);
	// suciedad y humedad (manchas grandes y suaves)
	float dirt = smoothstep(0.55, 0.85, fbm(p * 1.3 + 3.0));
	col *= 1.0 - 0.22 * dirt;
	float wet = smoothstep(0.62, 0.8, fbm(p * 0.7 - 11.0));
	col *= 1.0 - 0.18 * wet;
	// juntas entre losas (más oscuras y algo sucias)
	vec2 e = min(f, 1.0 - f) * slab;
	float joint = 1.0 - smoothstep(0.004, 0.011, min(e.x, e.y));
	col *= 1.0 - 0.45 * joint;
	// grietas: algunas losas, líneas quebradas de ruido
	if (hash(cell + 3.3) > 0.78) {
		float n = abs(noise(p * 14.0 + h * 10.0) - 0.5);
		col *= 1.0 - 0.5 * (1.0 - smoothstep(0.0, 0.018, n)) * smoothstep(0.2, 0.5, noise(p * 3.0));
	}
	// parches de hormigón nuevo
	if (hash(cell + 9.7) > 0.93) {
		col = mix(col, base_color * 1.08, 0.6);
	}
	// chicles aplastados (manchas oscuras pequeñas)
	vec2 gp = p * 22.0;
	vec2 gc = floor(gp);
	float g = hash(gc + 1.7);
	if (g > 0.965) {
		vec2 o = vec2(hash(gc + 2.1), hash(gc + 4.3)) * 0.6 + 0.2;
		float d = length(fract(gp) - o);
		col *= 1.0 - 0.45 * (1.0 - smoothstep(0.08, 0.16, d));
	}
	ALBEDO = col;
	ROUGHNESS = 0.92 - 0.35 * wet;
	SPECULAR = 0.35;
}
