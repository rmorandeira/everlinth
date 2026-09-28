# Assets

## Catálogo (gestor web)

`http://localhost:3000/admin/assets` es la fuente de verdad del catálogo (tabla `assets`
de SQLite). Cada asset tiene:
- **Fuente:** modelo GLB, generador procedural o composición de primitivas.
- **Clasificación:** categoría y biomas.
- **Ajustes:** escala, texturas por ranura de material y puntos de unión.

- **Autorregistro:** al arrancar, el servidor registra los GLB de `client/public/models/<kit>/` que no estén aún en el catálogo. Lo ya editado no se sobrescribe. El grupo `countryside` entra con el bioma Campo.
- **Recarga en caliente:** al guardar un asset, el servidor avisa (`assetsChanged`) y el juego rehace la ciudad.
- **El catálogo decide qué sale en el juego:**
  - la categoría y el bioma determinan qué edificios salen en cada sitio;
  - los assets marcados con el bioma **Campo** aparecen en las granjas;
  - la categoría decide si un asset se oculta con el halo de visión (edificio, rascacielos, casa o pieza de edificio) o no (vehículos, mobiliario…).
- **Assets nuevos:** se crean desde Claude Code, con la misma API del catálogo (`POST /admin/assets`, `PUT /admin/assets/:id`). La generación con IA dentro de la web se quitó (ver DECISIONES).

## Modelos generados en código (`godot/tools/`)

Se ejecutan con Godot sin ventana y exportan GLB con las texturas dentro. Cada modelo se
escribe en dos sitios: `client/public/models/<kit>/` (para la web) y
`godot/assets/models/<kit>/` (para el juego).

| Herramienta | Modelos | Uso |
|---|---|---|
| `build_barrier.gd` | Barreras New Jersey: `detail-barrier-strong-type-a` (limpia), `-type-b` (cinta de advertencia), `-damaged` (rota, armaduras, hollín, óxido) | `-- variant=a\|b\|damaged` |
| `build_tree.gd` | `tree-large` (arce de calle de 13 m), kits retro y suburban | — |
| `build_countryside.gd` | `silo`, `barn-a/b/c`, `windmill`, `tractor-red/green` (kit `countryside`) | `-- only=<nombre>` |
| `preview_model.gd` | Vista previa con el cargador del juego | `-- model=<kit/nombre> out=<png>` |

```bash
godot --headless --path godot -s res://tools/build_barrier.gd -- variant=b
godot --path godot --resolution 900x900 -s res://tools/preview_model.gd -- model=countryside/silo out=silo.png
```

Las texturas originales de estas herramientas están en `tools/assets-src/`, fuera del
repositorio. Se descargan de ambientCG: los nombres están en la cabecera de cada
herramienta y en los `LICENCIA.md`.

El cargador de Godot (`kenney.gd`) respeta de estos GLB detallados:
- el color por vértice (suciedad, desgaste);
- las tangentes;
- los mapas de relieve y rugosidad;
- la transparencia recortada (cintas y hojas).

A estos modelos no se les aplican las fachadas ni las ventanas de Kenney.

## Árboles de calle y parque (`godot/scripts/render/trees.gd`)

Se generan al vuelo, no son GLB. Las hojas sueltas de los atlas de ambientCG se hornean
en racimos, y el árbol se forma con un tronco y ramas curvadas y 95-145 tarjetas de hojas.

| Especie | Dónde |
|---|---|
| Plátano de sombra | Calles |
| Roble, haya y pino | Parques |
| Tamarisco | Junto al mar |

`Trees.SIZE` escala todos los árboles.

## Texturas en el juego (`godot/assets/textures/`)

| Carpeta | Contenido | Fuente |
|---|---|---|
| `facades/` | Ladrillos, hormigones, estuco, grava de azotea | ambientCG CC0 |
| `road/` | Asfalto Road015A/Road012A y marcas procedurales | ambientCG CC0 / proyecto |
| `coast/` | Sillería, arena, escollera | ambientCG CC0 |
| `trees/` | Hojas (LeafSet) y cortezas (Bark) | ambientCG CC0 |
| `countryside/` | Prado, tierra, tierra arada | ambientCG CC0 |

Cada carpeta lleva su `LICENCIA.md`.
