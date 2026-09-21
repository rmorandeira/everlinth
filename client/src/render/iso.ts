// Proyección isométrica 2:1 (estilo Infiltrator/las isométricas clásicas de 8 bits).
export const TILE_W = 64; // ancho del rombo en px
export const TILE_H = 32; // alto del rombo en px

export function toScreen(col: number, row: number): { x: number; y: number } {
  return {
    x: (col - row) * (TILE_W / 2),
    y: (col + row) * (TILE_H / 2),
  };
}
