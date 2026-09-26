// Modelos de Kenney (edificios, casas, mobiliario) con ventanas iluminadas.
// Cada panel de cristal real del modelo lleva en UV2.x un número (0 = no es
// ventana; ver kenney.gd). Ese número más un desplazamiento propio de cada
// edificio (según su posición) decide si el panel está encendido y de qué tono:
// dos edificios iguales no tienen las mismas ventanas encendidas.
shader_type spatial;

uniform sampler2D albedo_tex : source_color, filter_linear_mipmap_anisotropic, repeat_enable;
uniform vec4 albedo_color : source_color = vec4(1.0);
global uniform float win_glow; // 0 de día → ~0,45 de noche
global uniform float win_lit;  // fracción de ventanas encendidas
// Área del personaje sin obstrucciones (puerto de cutaway3d.ts): en pantalla, la
// franja desde la línea horizontal del personaje hacia abajo, del 70 % del ancho.
// Lo que queda por encima del suelo dentro de ella se vuelve translúcido por
// tramado (sigue siendo opaco: escribe profundidad, sin problemas de orden).
global uniform vec4 cut_params; // x: línea (px desde arriba), y: centro x, z: semiancho, w: transición
global uniform vec3 cut_cam_fwd; // eje de la cámara principal (en las pasadas de sombra no se recorta)
global uniform float cut_keep;   // opacidad que conserva lo que tapa la franja

varying float v_win;

void vertex() {
	vec3 o = MODEL_MATRIX[3].xyz;
	float shift = fract(sin(dot(floor(o.xz * 4.0), vec2(12.9898, 78.233))) * 43758.5453);
	v_win = UV2.x > 0.0 ? fract(UV2.x + shift) + 0.0001 : 0.0;
}

void fragment() {
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
	vec4 a = texture(albedo_tex, UV) * albedo_color;
	ALBEDO = a.rgb;
	ROUGHNESS = 0.85;
	SPECULAR = 0.3;
	if (v_win > 0.0 && win_glow > 0.001) {
		float on = step(1.0 - win_lit, v_win);
		vec3 tone = mix(vec3(1.0, 0.74, 0.4), vec3(0.75, 0.85, 1.0), step(0.9, fract(v_win * 7.31)));
		EMISSION = tone * on * win_glow * (0.75 + 0.25 * fract(v_win * 3.7)) * 2.2;
	}
}
