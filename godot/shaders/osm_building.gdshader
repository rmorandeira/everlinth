// Edificios reales (planta de OpenStreetMap extruida) con fachada procedural:
// - Paredes con los materiales PBR de ambientCG (fac_* de facades.gd): estuco pintado,
//   hormigón, piedra o ladrillo, con el tono de cada edificio.
// - Ventanas por planta (1 planta = 1 unidad = 3 m) y por crujía (el ancho de cada
//   fachada se reparte en huecos enteros: nunca media ventana en una esquina), con
//   marco, alféizar y cristal que refleja el cielo; bajos comerciales con escaparates.
// - Galerías coruñesas: fachadas enteras acristaladas con carpintería blanca.
// - De noche, ventanas encendidas al azar (win_lit / win_glow).
// - Azoteas de grava y tejados de teja; suciedad junto al suelo y chorretones.
// Mismo recorte que los demás edificios (franja del personaje) y plano de corte para los
// derrumbes. Datos por vértice: UV.x = distancia a lo largo de la fachada; UV2 = (ancho
// de la fachada, altura de la cornisa); COLOR = tono; CUSTOM0 = (material, galería,
// semilla, bajo comercial).
shader_type spatial;

global uniform float win_glow;
global uniform float win_lit;
global uniform float sprite_light;
#include "res://shaders/occlusion.gdshaderinc"
global uniform sampler2DArray fac_albedo : source_color, filter_linear_mipmap_anisotropic, repeat_enable;
global uniform sampler2DArray fac_normal : filter_linear_mipmap, repeat_enable;
global uniform sampler2DArray fac_rough : filter_linear_mipmap, repeat_enable;
instance uniform vec4 clip_plane = vec4(0.0);

const float FH = 1.0;       // altura de planta
const float BAY = 0.85;     // crujía objetivo
const float FAC_TILE = 0.9;

varying vec3 v_wpos;
varying vec3 v_wnrm;
varying vec4 v_info;
varying vec2 v_face;
varying float v_hgt; // altura sobre la base del edificio (UV.y)
varying vec4 v_bary;

float h13(vec3 p) {
	p = fract(p * vec3(0.1031, 0.1030, 0.0973));
	p += dot(p, p.yzx + 33.33);
	return fract((p.x + p.y) * p.z);
}

void vertex() {
	v_wpos = (MODEL_MATRIX * vec4(VERTEX, 1.0)).xyz;
	v_wnrm = normalize((MODEL_MATRIX * vec4(NORMAL, 0.0)).xyz);
	v_info = CUSTOM0;
	v_face = vec2(UV.x, UV2.x);
	v_bary = CUSTOM1;
	v_hgt = UV.y;
}

void fragment() {
	if (dot(clip_plane.xyz, clip_plane.xyz) > 0.25 && dot(v_wpos, clip_plane.xyz) > clip_plane.w) {
		discard;
	}
	float occ_line = 0.0;
	// derivadas (arista) fuera de ramas: en una rama divergente dan basura
	float occ_edge_v = occl_edge(v_bary);
	{
		float oc = occl_amount(v_wpos, FRAGCOORD.xy, INV_VIEW_MATRIX);
		if (oc > 0.001 && oc > occl_dither(FRAGCOORD.xy)) {
			occ_line = occ_edge_v;
			if (occ_line < 0.5) {
				discard;
			}
		}
	}
	vec3 n = normalize(v_wnrm);
	vec3 tint = COLOR.rgb;
	float layer = v_info.x;
	bool gal = v_info.y > 0.5;
	float seed = v_info.z;
	bool shop = v_info.w > 0.5;
	float day = mix(0.35, 1.0, sprite_light);

	if (n.y > 0.95) {
		// azotea: grava, algo más oscura en los bordes por las juntas del pretil
		// cubierta: teja cerámica, pizarra o azotea de grava según el edificio
		vec2 uv = v_wpos.xz / 1.35;
		vec3 alb = texture(fac_albedo, vec3(uv, 6.0)).rgb * mix(vec3(0.78), vec3(0.95, 0.92, 0.88), seed);
		float kind = fract(seed * 13.7);
		if (kind < 0.45) {
			float row = floor(v_wpos.z * 14.0);
			float r = h13(vec3(floor(v_wpos.x * 9.0 + row * 0.5), row, seed * 71.0));
			vec3 terra = mix(vec3(0.52, 0.24, 0.15), vec3(0.66, 0.35, 0.22), r);
			alb = terra * mix(0.7, 1.0, smoothstep(0.0, 0.3, fract(v_wpos.z * 14.0))) * (0.85 + 0.3 * dot(alb, vec3(0.33)));
		} else if (kind < 0.78) {
			float row = floor(v_wpos.z * 12.0);
			float r = h13(vec3(floor(v_wpos.x * 7.0 + row * 0.5), row, seed * 37.0));
			alb = mix(vec3(0.2, 0.22, 0.25), vec3(0.3, 0.32, 0.35), r) * mix(0.75, 1.0, smoothstep(0.0, 0.2, fract(v_wpos.z * 12.0)));
		}
		ALBEDO = alb;
		ROUGHNESS = kind < 0.78 && kind >= 0.45 ? 0.55 : 0.9;
		vec3 nt = texture(fac_normal, vec3(uv, 6.0)).xyz * 2.0 - 1.0;
		NORMAL = normalize((VIEW_MATRIX * vec4(normalize(vec3(nt.x, max(nt.z, 0.3), -nt.y)), 0.0)).xyz);
	} else if (n.y > 0.2) {
		// tejado de teja cerámica: hiladas horizontales y tejas sueltas de otro tono
		vec3 hn = normalize(vec3(n.x, 0.0, n.z));
		float along = dot(v_wpos, vec3(-hn.z, 0.0, hn.x));
		float row = floor(v_wpos.y * 16.0);
		float tile = floor(along * 9.0 + row * 0.5);
		float r = h13(vec3(tile, row, seed * 100.0));
		vec3 terra = mix(vec3(0.5, 0.22, 0.14), vec3(0.62, 0.32, 0.2), r);
		float groove = smoothstep(0.0, 0.25, fract(v_wpos.y * 16.0));
		ALBEDO = terra * mix(0.62, 1.0, groove);
		ROUGHNESS = 0.8;
	} else {

	float y = v_hgt;
	float top = UV2.y;
	float elen = v_face.y;
	float u_face = v_face.x;
	vec2 fuv = vec2(u_face, y) / FAC_TILE;
	vec3 alb = texture(fac_albedo, vec3(fuv, layer)).rgb;
	// el estuco y el hormigón toman el color de la fachada; el ladrillo y la piedra, poco
	alb *= (layer >= 3.0) ? tint * 1.12 : mix(vec3(1.0), tint, 0.25);
	float rough = texture(fac_rough, vec3(fuv, layer)).r;
	vec3 nt = texture(fac_normal, vec3(fuv, layer)).xyz * 2.0 - 1.0;
	vec3 t_axis = normalize(vec3(-n.z, 0.0, n.x));
	vec3 wn = normalize(t_axis * nt.x + vec3(0.0, 1.0, 0.0) * nt.y + n * max(nt.z, 0.2));

	// suciedad junto al suelo y chorretones bajo las ventanas
	float ground = 1.0 - smoothstep(0.02, 0.6, y);
	float nb = max(1.0, floor(elen / BAY + 0.5));
	float bw = elen / nb;
	float u = u_face / bw;
	float bi = floor(u);
	float fu = fract(u);
	float fl = floor(y / FH);
	float fy = fract(y / FH);
	float streak = smoothstep(0.35, 0.0, abs(fu - 0.5)) * smoothstep(0.0, 0.6, 1.0 - fy) * 0.12;
	alb *= 1.0 - 0.3 * ground - streak * step(1.0, fl);

	// cornisa y remate
	float cornice = step(top - 0.1, y) * step(y, top - 0.03);
	alb = mix(alb, alb * 1.18 + 0.04, cornice);
	float band = step(0.97, fy) * step(1.0, fl) * step(y, top - 0.12);
	alb = mix(alb, alb * 0.85, band * 0.6); // línea de forjado

	float glass = 0.0;
	float frame = 0.0;
	float sill = 0.0;
	bool windows = elen > 0.45 && y > 0.0 && y < top - 0.14;
	if (windows) {
		if (fl < 0.5) {
			if (shop) {
				// escaparate y rótulo
				glass = step(0.06, fu) * step(fu, 0.94) * step(0.05, fy) * step(fy, 0.72);
				frame = step(0.03, fu) * step(fu, 0.97) * step(0.02, fy) * step(fy, 0.75) * (1.0 - glass);
				float sign_band = step(0.78, fy) * step(fy, 0.92) * step(0.04, fu) * step(fu, 0.96);
				vec3 sc = mix(vec3(0.12, 0.13, 0.15), vec3(0.55, 0.12, 0.1), step(0.7, h13(vec3(bi, seed * 50.0, 3.0))));
				alb = mix(alb, sc, sign_band * step(0.35, h13(vec3(bi, seed * 91.0, 7.0))));
			} else {
				glass = step(0.3, fu) * step(fu, 0.7) * step(0.3, fy) * step(fy, 0.82);
			}
		} else if (gal) {
			// galería: carpintería blanca, montantes en tercios y un travesaño
			float in_g = step(0.04, fu) * step(fu, 0.96) * step(0.06, fy) * step(fy, 0.94);
			float f3 = fract(fu * 3.0);
			float mull = clamp(step(min(f3, 1.0 - f3), 0.03) + step(abs(fy - 0.7), 0.022), 0.0, 1.0);
			glass = in_g * (1.0 - mull);
			frame = 1.0 - glass;
		} else {
			float wx = step(0.29, fu) * step(fu, 0.71);
			float wy = step(0.24, fy) * step(fy, 0.8);
			glass = step(0.32, fu) * step(fu, 0.68) * step(0.27, fy) * step(fy, 0.78);
			frame = wx * wy * (1.0 - glass);
			sill = step(0.26, fu) * step(fu, 0.74) * step(0.19, fy) * step(fy, 0.24);
		}
	}
	vec3 frame_col = gal ? vec3(0.92, 0.92, 0.9) : mix(vec3(0.85, 0.84, 0.8), vec3(0.2, 0.2, 0.22), step(0.6, seed));
	alb = mix(alb, frame_col, frame);
	alb = mix(alb, vec3(0.78, 0.76, 0.72), sill);
	ALBEDO = alb;
	ROUGHNESS = mix(rough, 0.5, max(frame, sill));
	SPECULAR = 0.3;
	vec3 out_n = mix(wn, n, max(frame, sill));
	if (glass > 0.5) {
		// cristal: oscuro, con reflejo del cielo más claro arriba y cortinas por ventana
		float wid = h13(vec3(bi + elen * 13.7, fl, seed * 173.0));
		vec3 sky = mix(vec3(0.26, 0.32, 0.38), vec3(0.5, 0.58, 0.66), fy);
		vec3 g = mix(vec3(0.06, 0.07, 0.08), sky * day, 0.45);
		g = mix(g, vec3(0.55, 0.5, 0.42) * day, step(0.8, wid) * 0.35); // cortinas
		ALBEDO = g;
		ROUGHNESS = 0.07;
		SPECULAR = 0.75;
		METALLIC = 0.2;
		out_n = n;
		if (win_glow > 0.001) {
			float on = step(1.0 - win_lit, fract(wid * 7.13));
			vec3 tone = mix(vec3(1.0, 0.74, 0.42), vec3(0.78, 0.86, 1.0), step(0.88, fract(wid * 3.1)));
			EMISSION = tone * on * win_glow * (0.7 + 0.3 * fract(wid * 5.3)) * (shop && fl < 0.5 ? 2.8 : 2.2);
		}
	}
	NORMAL = normalize((VIEW_MATRIX * vec4(out_n, 0.0)).xyz);
	}
	if (occ_line > 0.5) {
		// silueta del edificio oculto
		ALBEDO = OCCL_LINE;
		EMISSION = OCCL_LINE * 0.7;
		ROUGHNESS = 1.0;
	}
}
