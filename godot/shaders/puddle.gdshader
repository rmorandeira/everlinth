// Charcos: agua oscura muy brillante (refleja el sol, las farolas y los fogonazos).
// La forma sale del canal verde de la textura (mapa de alfa, como en la web).
shader_type spatial;
render_mode depth_draw_never, cull_disabled;

uniform sampler2D shape : filter_linear_mipmap, repeat_disable;
uniform vec4 water_color : source_color = vec4(0.169, 0.2, 0.239, 1.0);
uniform float opacity = 0.8;

void fragment() {
	ALBEDO = water_color.rgb;
	ROUGHNESS = 0.06;
	SPECULAR = 0.9;
	METALLIC = 0.2;
	ALPHA = texture(shape, UV).g * opacity;
}
