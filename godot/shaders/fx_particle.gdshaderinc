// (incluido por fx_smoke.gdshader y fx_glow.gdshader, que definen ADDITIVE o no)
// Partículas de efectos (humo, fuego, fogonazos, chispas): rectángulo orientado a la
// cámara con una mancha procedural. INSTANCE_CUSTOM: x = tamaño, y = opacidad,
// z = tipo (0 humo, 1 fuego, 2 destello en estrella), w = giro. COLOR = tinte.

varying vec4 v_custom;
varying vec4 v_color;

void vertex() {
	vec3 origin = MODEL_MATRIX[3].xyz;
	vec3 right = normalize(INV_VIEW_MATRIX[0].xyz);
	vec3 up = normalize(INV_VIEW_MATRIX[1].xyz);
	float a = INSTANCE_CUSTOM.w;
	vec2 q = mat2(vec2(cos(a), sin(a)), vec2(-sin(a), cos(a))) * VERTEX.xy;
	vec3 w = origin + (right * q.x + up * q.y) * INSTANCE_CUSTOM.x;
	VERTEX = (VIEW_MATRIX * vec4(w, 1.0)).xyz;
	v_custom = INSTANCE_CUSTOM;
	v_color = COLOR;
}

float hash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
float noise(vec2 p) {
	vec2 i = floor(p);
	vec2 f = fract(p);
	f = f * f * (3.0 - 2.0 * f);
	return mix(mix(hash(i), hash(i + vec2(1, 0)), f.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), f.x), f.y);
}

void fragment() {
	vec2 p = UV * 2.0 - 1.0;
	float r = length(p);
	float kind = v_custom.z;
	float a;
	if (kind < 0.5) {
		// humo con grumos
		a = (1.0 - smoothstep(0.2, 1.0, r)) * (0.55 + 0.45 * noise(UV * 5.0 + v_custom.w * 3.0));
	} else if (kind < 1.5) {
		a = 1.0 - smoothstep(0.0, 1.0, r);
		a *= a;
	} else {
		// destello: núcleo y cuatro puntas
		float core = 1.0 - smoothstep(0.0, 0.7, r);
		float rays = max(1.0 - smoothstep(0.0, 0.08, abs(p.x)) , 1.0 - smoothstep(0.0, 0.08, abs(p.y))) * (1.0 - r);
		a = max(core * core, rays);
	}
	a *= v_custom.y;
#ifdef ADDITIVE
	{
		ALBEDO = v_color.rgb * a * 2.0;
		ALPHA = a;
	}
#else
	ALBEDO = v_color.rgb;
	ALPHA = a;
#endif
}
