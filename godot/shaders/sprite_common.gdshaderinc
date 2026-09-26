// Común a los sprites de personas (people.gdshader, people_ghost.gdshader):
// rectángulo orientado a la cámara con los pies en el punto de la instancia y
// muestreo "píxel nítido" (bordes de píxel limpios a cualquier escala, sin temblor).
// INSTANCE_CUSTOM: x = columna, y = fila de la celda en el atlas, z = escala,
// w = tipo (0 zombi, 1 gigante, 2 personaje, 3 otro jugador, 4 cadáver).

uniform sampler2D atlas : source_color, filter_linear, repeat_disable;
uniform vec2 grid = vec2(8.0, 128.0);          // celdas del atlas (columnas, filas)
uniform vec2 cell_world = vec2(0.554, 0.738);  // tamaño de una celda en el mundo
uniform float feet_frac = 0.09375;             // altura de los pies en la celda, desde abajo

varying vec2 v_uv;
varying float v_kind;

vec3 sprite_view_pos(vec3 vtx, mat4 model, mat4 inv_view, mat4 view, float s) {
	vec3 origin = model[3].xyz;
	vec3 right = normalize(inv_view[0].xyz);
	vec3 up = normalize(inv_view[1].xyz);
	vec3 back = normalize(inv_view[2].xyz);
	vec2 q = vtx.xy + vec2(0.0, 0.5);
	// algo hacia la cámara: los pies no se hunden en bordillos y marcas del suelo
	vec3 w = origin + right * (q.x * cell_world.x * s) + up * ((q.y - feet_frac) * cell_world.y * s) + back * 0.15;
	return (view * vec4(w, 1.0)).xyz;
}

vec4 sample_sharp(vec2 uv) {
	vec2 ts = vec2(textureSize(atlas, 0));
	vec2 p = uv * ts;
	vec2 seam = floor(p + 0.5);
	vec2 d = max(fwidth(p), vec2(1e-5));
	p = seam + clamp((p - seam) / d, -0.5, 0.5);
	return texture(atlas, p / ts);
}
