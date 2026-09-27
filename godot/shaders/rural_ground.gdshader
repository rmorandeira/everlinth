// Suelo del campo (bioma countryside), texturas PBR de ambientCG (CC0) en coordenadas de
// mundo. mode:
//   0 prado base: hierba (Grass003) con manchas secas amarillentas y calvas de tierra,
//     como la foto aérea.
//   1 base del trigal: tierra pajiza bajo las espigas.
//   2 rastrojo: paja segada en hileras según la labor y rodadas del tractor por pares, que
//     giran en U en las cabeceras de la finca (foto de referencia).
//   3 tierra arada: surcos según la labor y cabeceras.
//   4 pradera de la finca: hierba más verde y uniforme.
//   5 pista de tierra: tierra (Ground109) con dos carriles de rodada y hierba en medio
//     (UV.y = de un borde a otro de la pista).
// Parcelas: centro, medio tamaño (unidades) y giro de la labor por instancia.
shader_type spatial;

uniform int mode = 0;
uniform sampler2D grass_tex : source_color, filter_linear_mipmap_anisotropic, repeat_enable;
uniform sampler2D grass_nrm : hint_normal, filter_linear_mipmap, repeat_enable;
uniform sampler2D dirt_tex : source_color, filter_linear_mipmap_anisotropic, repeat_enable;
uniform sampler2D dirt_nrm : hint_normal, filter_linear_mipmap, repeat_enable;
uniform sampler2D soil_tex : source_color, filter_linear_mipmap_anisotropic, repeat_enable;
uniform sampler2D soil_nrm : hint_normal, filter_linear_mipmap, repeat_enable;
instance uniform vec2 rect_c = vec2(0.0);
instance uniform vec2 rect_h = vec2(10.0);
instance uniform float rect_ang = 0.0;

varying vec3 v_wpos;

float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float vnoise(vec2 p) {
	vec2 i = floor(p);
	vec2 f = fract(p);
	f = f * f * (3.0 - 2.0 * f);
	return mix(mix(hash(i), hash(i + vec2(1, 0)), f.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), f.x), f.y);
}
float fbm(vec2 p) { return vnoise(p) * 0.6 + vnoise(p * 2.3) * 0.3 + vnoise(p * 5.1) * 0.1; }

void vertex() {
	v_wpos = (MODEL_MATRIX * vec4(VERTEX, 1.0)).xyz;
}

// Coordenadas de la parcela: u a lo largo de la labor, v a través (unidades desde el centro).
vec2 local(vec2 p) {
	vec2 d = p - rect_c;
	float c = cos(rect_ang);
	float s = sin(rect_ang);
	return vec2(d.x * c + d.y * s, -d.x * s + d.y * c);
}

// Rodadas por pares con giro en U en las cabeceras (distancia a la rodada más cercana).
float tractor_lines(vec2 l, vec2 h, float period) {
	float u_half = abs(rect_ang) < 0.1 ? h.x : h.y;
	float v_half = abs(rect_ang) < 0.1 ? h.y : h.x;
	float head = 1.6; // cabecera (unidades)
	float k = floor((l.y + v_half) / period);
	float vc = -v_half + (k + 0.5) * period; // centro del par
	float gap = 0.35;
	float d;
	if (abs(l.x) < u_half - head) {
		d = min(abs(l.y - (vc - gap)), abs(l.y - (vc + gap)));
	} else {
		// semicírculo en la cabecera que une las dos rodadas del par
		vec2 cc = vec2(sign(l.x) * (u_half - head), vc);
		float r = length((l - cc) * vec2(1.0, 1.0));
		d = abs(r - gap);
		if (sign(l.x) * (l.x - cc.x) < 0.0) d = 10.0;
	}
	return 1.0 - smoothstep(0.03, 0.09, d);
}

void fragment() {
	vec2 p = v_wpos.xz;
	vec3 grass = texture(grass_tex, p / 1.2).rgb;
	vec3 dirt = texture(dirt_tex, p / 1.5).rgb;
	vec3 soil = texture(soil_tex, p / 1.3).rgb;
	vec3 col;
	vec3 nm = vec3(0.5, 0.5, 1.0);
	float rough = 0.95;
	if (mode == 0 || mode == 4) {
		// hierba agostada del campo gallego en verano: verde apagado con manchas pajizas
		float dry = smoothstep(0.35, 0.75, fbm(p * 0.12));
		float bare = smoothstep(0.78, 0.9, fbm(p * 0.35 + 5.0));
		col = grass * mix(vec3(1.0), vec3(1.25, 1.12, 0.62), dry * (mode == 0 ? 0.8 : 0.35));
		col = mix(col, dirt * 1.1, bare * (mode == 0 ? 0.6 : 0.2));
		col *= 0.92 + 0.16 * vnoise(p * 1.7);
		nm = texture(grass_nrm, p / 1.2).rgb;
	} else if (mode == 1) {
		col = mix(dirt * vec3(1.05, 0.95, 0.72), vec3(0.62, 0.52, 0.3), 0.5) * (0.85 + 0.2 * vnoise(p * 3.0));
		nm = texture(dirt_nrm, p / 1.5).rgb;
	} else if (mode == 2) {
		vec2 l = local(p);
		float rows = 0.5 + 0.5 * sin(l.y * 45.0 + vnoise(p * 2.0) * 2.0);
		col = mix(vec3(0.66, 0.56, 0.36), vec3(0.78, 0.68, 0.46), rows) * (0.85 + 0.25 * fbm(p * 0.8));
		col = mix(col, dirt * 0.8, 0.25);
		float t = tractor_lines(l, rect_h, 4.0);
		col = mix(col, col * 0.62, t);
		nm = texture(dirt_nrm, p / 1.5).rgb;
	} else if (mode == 3) {
		vec2 l = local(p);
		float f = sin(l.y * 30.0);
		col = soil * vec3(1.25, 1.18, 1.1) * (0.8 + 0.22 * f) * (0.9 + 0.2 * fbm(p * 0.5));
		float t = tractor_lines(l, rect_h, 6.0);
		col = mix(col, col * 0.75, t * 0.6);
		nm = normalize(texture(soil_nrm, p / 1.3).rgb + vec3(0.0, cos(l.y * 30.0) * 0.25, 0.0));
		rough = 1.0;
	} else {
		// pista: dos carriles de rodada y hierba en el centro y en los bordes
		float v = UV.y;
		float rut = 1.0 - smoothstep(0.1, 0.2, min(abs(v - 0.3), abs(v - 0.7)));
		float mid = 1.0 - smoothstep(0.08, 0.16, abs(v - 0.5));
		float edge = smoothstep(0.38, 0.5, abs(v - 0.5));
		col = dirt * vec3(1.05, 0.98, 0.9) * (0.9 + 0.2 * vnoise(p * 2.0));
		col = mix(col, col * 0.78, rut);
		col = mix(col, grass * 0.95, max(mid * 0.7, edge) * (0.6 + 0.4 * vnoise(p * 3.0)));
		nm = texture(dirt_nrm, p / 1.5).rgb;
	}
	ALBEDO = col;
	ROUGHNESS = rough;
	NORMAL_MAP = nm;
}
