// Modelos de Kenney (edificios, casas, mobiliario) con ventanas iluminadas.
// Cada panel de cristal real del modelo lleva en UV2.x un número (0 = no es
// ventana; ver kenney.gd). Ese número más un desplazamiento propio de cada
// edificio (según su posición) decide si el panel está encendido y de qué tono:
// dos edificios iguales no tienen las mismas ventanas encendidas.
shader_type spatial;

uniform sampler2D albedo_tex : source_color, filter_linear_mipmap_anisotropic, repeat_enable;
uniform vec4 albedo_color : source_color = vec4(1.0);
// Textura del catálogo (/admin/assets): 0 = la original del modelo; 1 = otra textura
// con las UV del modelo; 2 = proyección por caras (fotos de fachada), en unidades de
// mundo. Repetición, desplazamiento y giro como en three.js (centro 0,5).
uniform int tex_mode = 0;
uniform vec2 uv_repeat = vec2(1.0);
uniform vec2 uv_offset = vec2(0.0);
uniform float uv_rotation = 0.0;
uniform float box_tile = 3.0;
global uniform float win_glow; // 0 de día → ~0,45 de noche
global uniform float win_lit;  // fracción de ventanas encendidas
// Área del personaje sin obstrucciones (puerto de cutaway3d.ts): en pantalla, la
// franja desde la línea horizontal del personaje hacia abajo, del 70 % del ancho.
// Lo que queda por encima del suelo dentro de ella se vuelve translúcido por
// tramado (sigue siendo opaco: escribe profundidad, sin problemas de orden).
global uniform vec4 cut_params; // x: línea (px desde arriba), y: centro x, z: semiancho, w: transición
global uniform vec3 cut_cam_fwd; // eje de la cámara principal (en las pasadas de sombra no se recorta)
global uniform float cut_keep;   // opacidad que conserva lo que tapa la franja

// Plano de corte (derrumbes: la parte de arriba se parte y cae por separado): se
// descarta lo que queda del lado positivo del plano (xyz = normal, w = distancia).
instance uniform vec4 clip_plane = vec4(0.0);
// Fachadas realistas (facades.gd): materiales PBR de ambientCG (CC0) en un array de
// texturas; cada edificio usa uno (según su posición). Solo se sustituyen las paredes
// lisas claras del modelo (no ventanas, marcos ni molduras) y las azoteas (grava).
global uniform sampler2DArray fac_albedo : source_color, filter_linear_mipmap_anisotropic, repeat_enable;
global uniform sampler2DArray fac_normal : filter_linear_mipmap, repeat_enable;
global uniform sampler2DArray fac_rough : filter_linear_mipmap, repeat_enable;
global uniform float facade_on;
uniform bool allow_facade = true; // no en hormigón de autovías, etc.
// Assets detallados (texturas PBR propias del modelo): relieve y rugosidad.
uniform sampler2D normal_tex : hint_normal, filter_linear_mipmap_anisotropic, repeat_enable;
uniform bool has_normal = false;
uniform sampler2D rough_tex : filter_linear_mipmap, repeat_enable;
uniform bool has_rough = false;
const float FAC_WALLS = 6.0;   // capas 0-5: paredes
const float FAC_ROOF = 6.0;    // capa 6: grava de azotea
const float FAC_TILE = 0.9;    // unidades por repetición (≈2,7 m: algo mayor que el real para que se lea a esta distancia)

varying float v_win;
varying vec3 v_wpos;
varying vec3 v_wnrm;
varying float v_mat;

void vertex() {
	vec3 o = MODEL_MATRIX[3].xyz;
	float shift = fract(sin(dot(floor(o.xz * 4.0), vec2(12.9898, 78.233))) * 43758.5453);
	v_win = UV2.x > 0.0 ? fract(UV2.x + shift) + 0.0001 : 0.0;
	v_mat = floor(fract(shift * 7.13 + 0.37) * FAC_WALLS);
	v_wpos = (MODEL_MATRIX * vec4(VERTEX, 1.0)).xyz;
	v_wnrm = normalize((MODEL_MATRIX * vec4(NORMAL, 0.0)).xyz);
}

vec2 catalog_uv(vec2 uv) {
	if (tex_mode == 2) {
		vec3 n = normalize(v_wnrm);
		if (abs(n.y) > 0.6) {
			uv = v_wpos.xz / box_tile;
		} else {
			uv = vec2(v_wpos.x * -n.z + v_wpos.z * n.x, v_wpos.y) / box_tile;
		}
	}
	float c = cos(uv_rotation);
	float s = sin(uv_rotation);
	vec2 r;
	r.x = uv_repeat.x * (c * uv.x + s * uv.y) - uv_repeat.x * (c * 0.5 + s * 0.5) + 0.5 + uv_offset.x;
	r.y = uv_repeat.y * (-s * uv.x + c * uv.y) - uv_repeat.y * (-s * 0.5 + c * 0.5) + 0.5 + uv_offset.y;
	// las texturas sueltas de three.js tienen el origen abajo (flipY)
	return vec2(r.x, 1.0 - r.y);
}

void fragment() {
	if (dot(clip_plane.xyz, clip_plane.xyz) > 0.25 && dot(v_wpos, clip_plane.xyz) > clip_plane.w) {
		discard;
	}
	if (dot(INV_VIEW_MATRIX[2].xyz, cut_cam_fwd) > 0.999) {
		vec3 wp = (INV_VIEW_MATRIX * vec4(VERTEX, 1.0)).xyz;
		if (wp.y > 0.12) {
			float f = cut_params.w;
			float in_y = smoothstep(cut_params.x - 0.5 * f, cut_params.x + f, FRAGCOORD.y);
			float in_x = 1.0 - smoothstep(cut_params.z - f, cut_params.z + f, abs(FRAGCOORD.x - cut_params.y));
			float cut = in_y * in_x;
			if (cut > 0.001) {
				// ruido de gradiente entrelazado (Jimenez): tramado fino y uniforme
				float ign = fract(52.9829189 * fract(dot(FRAGCOORD.xy, vec2(0.06711056, 0.00583715))));
				if (mix(1.0, cut_keep, cut) < ign) {
					discard;
				}
			}
		}
	}
	vec4 a = texture(albedo_tex, tex_mode == 0 ? UV : catalog_uv(UV)) * albedo_color;
	ALBEDO = a.rgb * COLOR.rgb;
	ROUGHNESS = 0.85;
	SPECULAR = 0.3;
	if (has_normal) {
		NORMAL_MAP = texture(normal_tex, UV).rgb;
	}
	if (has_rough) {
		ROUGHNESS = texture(rough_tex, UV).g;
	}
	if (tex_mode == 0 && allow_facade && !has_normal && facade_on > 0.5 && v_win == 0.0) {
		vec3 n = normalize(v_wnrm);
		float lum = dot(a.rgb, vec3(0.299, 0.587, 0.114));
		float sat = max(a.r, max(a.g, a.b)) - min(a.r, min(a.g, a.b));
		bool wall = abs(n.y) < 0.35 && lum > 0.55 && sat < 0.14;
		bool roof = n.y > 0.8 && sat < 0.14 && v_wpos.y > 0.35;
		if (wall || roof) {
			vec2 uv;
			vec3 t;
			vec3 bt;
			float layer;
			if (wall) {
				uv = vec2(v_wpos.x * -n.z + v_wpos.z * n.x, v_wpos.y) / FAC_TILE;
				t = normalize(vec3(-n.z, 0.0, n.x));
				bt = vec3(0.0, 1.0, 0.0);
				layer = v_mat;
			} else {
				uv = v_wpos.xz / (FAC_TILE * 1.5);
				t = vec3(1.0, 0.0, 0.0);
				bt = vec3(0.0, 0.0, -1.0);
				layer = FAC_ROOF;
			}
			vec3 alb = texture(fac_albedo, vec3(uv, layer)).rgb;
			// conserva algo del sombreado del modelo (esquinas, bandas)
			alb *= mix(1.0, clamp(lum / 0.8, 0.6, 1.1), 0.35);
			if (wall) {
				// suciedad: más cerca del suelo, y chorretones verticales
				float ground = 1.0 - smoothstep(0.05, 0.7, v_wpos.y);
				float streak = fract(sin(floor(uv.x * 2.0) * 91.7) * 43758.5) * smoothstep(0.0, 3.0, fract(v_wpos.y * 0.35 + uv.x * 0.07));
				alb *= 1.0 - 0.28 * ground - 0.1 * streak;
			}
			ALBEDO = alb * COLOR.rgb;
			ROUGHNESS = texture(fac_rough, vec3(uv, layer)).r;
			vec3 nt = texture(fac_normal, vec3(uv, layer)).xyz * 2.0 - 1.0;
			vec3 wn = normalize(t * nt.x + bt * nt.y + n * max(nt.z, 0.2));
			NORMAL = normalize((VIEW_MATRIX * vec4(wn, 0.0)).xyz);
		}
	}
	if (v_win > 0.0 && win_glow > 0.001) {
		float on = step(1.0 - win_lit, v_win);
		vec3 tone = mix(vec3(1.0, 0.74, 0.4), vec3(0.75, 0.85, 1.0), step(0.9, fract(v_win * 7.31)));
		EMISSION = tone * on * win_glow * (0.75 + 0.25 * fract(v_win * 3.7)) * 2.2;
	}
}
