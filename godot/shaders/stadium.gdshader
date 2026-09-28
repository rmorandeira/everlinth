// Estadio: césped con franjas de siega y líneas del campo (mode 0), gradas con filas
// de asientos (mode 1; azul y blanco, con pasillos) y chapa de cubiertas y fachadas
// (mode 2; paneles con juntas). UV: en el césped 0..1 a lo largo y a lo ancho del campo;
// en las gradas x = distancia a lo largo (unidades), y = distancia subiendo; en la chapa,
// x a lo largo e y en vertical.
shader_type spatial;

uniform int mode = 0;
uniform vec3 tone : source_color = vec3(1.0);
global uniform float sprite_light;
#include "res://shaders/occlusion.gdshaderinc"
const vec4 v_bary = vec4(0.0);

float h(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }

float line(float d, float w) { return 1.0 - smoothstep(w * 0.6, w, abs(d)); }

void fragment() {
	vec3 wp = (INV_VIEW_MATRIX * vec4(VERTEX, 1.0)).xyz;
	float occ_line = 0.0;
	// derivadas (arista) fuera de ramas: en una rama divergente dan basura
	float occ_edge_v = occl_edge(v_bary);
	{
		float oc = occl_amount(wp, FRAGCOORD.xy, INV_VIEW_MATRIX);
		if (oc > 0.001 && oc > occl_dither(FRAGCOORD.xy)) {
			occ_line = occ_edge_v;
			if (occ_line < 0.5) {
				discard;
			}
		}
	}
	vec2 uv = UV;
	if (mode == 0) {
		// campo de 105 × 68 m; uv (0..1, 0..1)
		vec2 m = uv * vec2(105.0, 68.0);
		float stripe = step(0.5, fract(m.x / 10.5));
		vec3 g = mix(vec3(0.16, 0.36, 0.13), vec3(0.2, 0.43, 0.16), stripe);
		g *= 0.92 + 0.08 * h(floor(m * 3.0));
		float w = 0.12;
		float l = 0.0;
		l = max(l, line(m.x, w) + line(m.x - 105.0, w) + line(m.y, w) + line(m.y - 68.0, w));
		l = max(l, line(m.x - 52.5, w));
		l = max(l, line(length(m - vec2(52.5, 34.0)) - 9.15, w));
		// áreas grandes y pequeñas
		for (int s = 0; s < 2; s++) {
			float x0 = s == 0 ? 0.0 : 105.0;
			float dir = s == 0 ? 1.0 : -1.0;
			float ax = (m.x - x0) * dir;
			l = max(l, line(ax - 16.5, w) * step(abs(m.y - 34.0), 20.16));
			l = max(l, line(abs(m.y - 34.0) - 20.16, w) * step(ax, 16.5) * step(0.0, ax));
			l = max(l, line(ax - 5.5, w) * step(abs(m.y - 34.0), 9.16));
			l = max(l, line(abs(m.y - 34.0) - 9.16, w) * step(ax, 5.5) * step(0.0, ax));
			float arc = line(length(vec2(ax - 11.0, m.y - 34.0)) - 9.15, w) * step(16.5, ax);
			l = max(l, arc);
		}
		g = mix(g, vec3(0.92), clamp(l, 0.0, 1.0));
		ALBEDO = g;
		ROUGHNESS = 0.9;
	} else if (mode == 1) {
		float row = fract(uv.y / 0.29);
		float seat = step(0.18, row) * step(row, 0.62);
		float aisle = step(fract(uv.x / 7.0), 0.05);
		float sector = h(vec2(floor(uv.x / 7.0), 1.0));
		vec3 sc = sector > 0.8 ? vec3(0.9, 0.9, 0.92) : vec3(0.06, 0.24, 0.62);
		// algún asiento suelto de otro color
		sc = mix(sc, vec3(0.85, 0.86, 0.9), step(0.97, h(floor(vec2(uv.x / 0.17, uv.y / 0.29)))));
		vec3 conc = vec3(0.62, 0.61, 0.58);
		vec3 c = mix(conc, sc, seat * (1.0 - aisle));
		c *= mix(0.75, 1.0, smoothstep(0.62, 0.7, row) + seat); // sombra bajo el escalón
		ALBEDO = c;
		ROUGHNESS = 0.7;
	} else {
		float rib = step(0.93, fract(uv.x / 0.6));
		ALBEDO = tone * (1.0 - 0.18 * rib) * (0.97 + 0.03 * h(floor(uv * 4.0)));
		ROUGHNESS = 0.45;
		METALLIC = 0.35;
		SPECULAR = 0.5;
	}
}
