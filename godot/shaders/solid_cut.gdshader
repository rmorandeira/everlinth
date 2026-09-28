// Color liso (mobiliario: farolas, semáforos, señales, papeleras…). Los objetos pequeños
// no se ocultan con el halo de visión del personaje (solo los edificios).
shader_type spatial;

uniform vec4 albedo : source_color = vec4(1.0);
uniform float roughness = 0.9;
uniform bool unshaded_glow = false;

void fragment() {
	ALBEDO = albedo.rgb;
	ROUGHNESS = roughness;
	if (unshaded_glow) {
		EMISSION = albedo.rgb * 1.2;
	}
}
