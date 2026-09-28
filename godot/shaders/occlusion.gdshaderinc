// Halo de visión del personaje (común a los shaders de edificios, hitos y árboles).
// Un fragmento se oculta si se interpone entre la cámara y el personaje: cae dentro del
// halo (círculo alrededor del personaje en pantalla) y está más cerca de la cámara que
// él. Lo que queda detrás del personaje, o fuera del halo, se ve siempre. Solo en la
// cámara principal (en las pasadas de sombra no se recorta: el edificio sigue dando
// sombra). De lo oculto quedan las aristas del modelo (occl_edge) como silueta.
global uniform vec4 occ_char;    // xyz: centro del personaje (mundo); w: 1 si hay personaje
global uniform vec4 occ_halo;    // xy: centro en pantalla (px); z: radio (px); w: borde suave (px)
global uniform vec3 cut_cam_fwd; // eje de la cámara principal

// 0 = visible … 1 = oculto del todo.
float occl_amount(vec3 wp, vec2 frag, mat4 inv_view) {
	if (occ_char.w < 0.5 || dot(inv_view[2].xyz, cut_cam_fwd) < 0.999) {
		return 0.0;
	}
	// más cerca de la cámara que el personaje (el +Z de la cámara apunta hacia ella)
	float ahead = dot(wp - occ_char.xyz, inv_view[2].xyz);
	float in_front = smoothstep(0.1, 0.35, ahead);
	float d = length(frag - occ_halo.xy);
	return in_front * (1.0 - smoothstep(occ_halo.z - occ_halo.w, occ_halo.z, d));
}

// Tramado fino y estable (ruido de gradiente entrelazado) para el borde del halo.
float occl_dither(vec2 frag) {
	return fract(52.9829189 * fract(dot(frag, vec2(0.06711056, 0.00583715))));
}

// Arista del modelo: bary = coordenadas baricéntricas del triángulo con las aristas
// interiores (entre caras coplanarias) anuladas a 1 (Occlusion.edge_bary); w = 1 si el
// modelo las trae. Devuelve 1 sobre la arista (unos 1,5 px de grosor).
float occl_edge(vec4 bary) {
	if (bary.w < 0.5) {
		return 0.0;
	}
	vec3 b = bary.xyz;
	vec3 w = fwidth(b) * 1.5;
	vec3 e = smoothstep(vec3(0.0), w, b);
	return 1.0 - min(min(e.x, e.y), e.z);
}

const vec3 OCCL_LINE = vec3(0.96, 0.94, 0.86);
