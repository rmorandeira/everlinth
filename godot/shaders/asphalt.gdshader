// Calzada de asfalto fotográfica (ambientCG Road015A, CC0): color, relieve y rugosidad
// en coordenadas de mundo (todos los tramos, cruces y parches casan entre sí).
// - Sin repetición visible: dos muestras a escalas y giros distintos mezcladas por un
//   ruido grande, más variación de tono por zonas (asfalto más nuevo / más gastado).
// - Árido que brilla: el relieve de la textura, y la rugosidad baja en lo pulido.
// - Humedad de A Coruña: manchas mojadas (más oscuras y casi espejo) donde el ruido lo
//   dice y en las zonas bajas de la calzada (bordes, junto al bordillo).
// - tone: tono de cada calle (y de los parches de reparación); patch_tex: otra textura
//   para los parches.
shader_type spatial;

uniform sampler2D albedo_tex : source_color, filter_linear_mipmap_anisotropic, repeat_enable;
uniform sampler2D normal_tex : hint_normal, filter_linear_mipmap_anisotropic, repeat_enable;
uniform sampler2D rough_tex : filter_linear_mipmap, repeat_enable;
uniform vec3 tone : source_color = vec3(1.0);
uniform float tile = 1.4;      // unidades de mundo por repetición (1 = 3 m)
uniform float wetness = 0.35;  // cuánto de la calzada está mojado
global uniform float sprite_light;

varying vec3 v_wpos;

float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float vnoise(vec2 p) {
	vec2 i = floor(p);
	vec2 f = fract(p);
	f = f * f * (3.0 - 2.0 * f);
	return mix(mix(hash(i), hash(i + vec2(1, 0)), f.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), f.x), f.y);
}

void vertex() {
	v_wpos = (MODEL_MATRIX * vec4(VERTEX, 1.0)).xyz;
}

void fragment() {
	vec2 p = v_wpos.xz;
	vec2 uv1 = p / tile;
	// segunda muestra: otra escala y girada 37°, para romper la repetición
	mat2 rot = mat2(vec2(0.7986, 0.6018), vec2(-0.6018, 0.7986));
	vec2 uv2 = rot * p / (tile * 1.73) + vec2(0.37, 0.61);
	float m = smoothstep(0.3, 0.7, vnoise(p * 0.11));
	vec3 c = mix(texture(albedo_tex, uv1).rgb, texture(albedo_tex, uv2).rgb, m);
	vec3 n1 = texture(normal_tex, uv1).rgb;
	vec3 n2 = texture(normal_tex, uv2).rgb;
	float rgh = mix(texture(rough_tex, uv1).r, texture(rough_tex, uv2).r, m);
	// zonas: asfalto más nuevo (oscuro) o más gastado (claro, gris)
	float zone = vnoise(p * 0.045 + 3.1);
	c *= mix(0.82, 1.12, zone);
	c *= tone;
	// humedad: manchas mojadas grandes con bordes irregulares
	float wet = smoothstep(0.62 - wetness * 0.35, 0.72 - wetness * 0.35, vnoise(p * 0.18 + 7.7) * 0.75 + vnoise(p * 0.9) * 0.25);
	ALBEDO = c * mix(1.0, 0.62, wet);
	ROUGHNESS = mix(clamp(rgh * 1.05, 0.45, 1.0), 0.08, wet);
	SPECULAR = mix(0.4, 0.6, wet);
	// en lo mojado el agua rellena el árido: relieve más suave
	NORMAL_MAP = mix(mix(n1, n2, m), vec3(0.5, 0.5, 1.0), wet * 0.75);
	NORMAL_MAP_DEPTH = 1.2;
}
