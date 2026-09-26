// Fuego, fogonazos y chispas (mezcla aditiva).
shader_type spatial;
render_mode unshaded, cull_disabled, skip_vertex_transform, depth_draw_never, blend_add;

#define ADDITIVE
#include "res://shaders/fx_particle.gdshaderinc"
